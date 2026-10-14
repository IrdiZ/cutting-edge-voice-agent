# Command Registry Design

The registry is the single source of truth that the local grammar matcher, the semantic
embedder, the LLM fallback, and the action layer all derive from. Authoring a command once
should generate: regex/FST patterns, embedding anchors, an LLM tool schema, and the executor
binding. **One declaration, four consumers.**

## Design goals

- Many **synonyms** per command; tolerant of trailing pleasantries ("…please / for me / now")
  and filler stripping ("uh", "let's", "can you").
- **Hierarchy / context:** commands scoped to a mode (e.g. only valid while a case is open),
  nested sub-commands, and context-dependent disambiguation.
- **Async:** commands that run while dictation continues (e.g. "generate impression" streams in
  the background while the user keeps dictating findings).
- **Clarification:** a command can return a "need disambiguation" result that drives a
  follow-up prompt ("did you mean the chest CT or the abdomen CT?").
- **Extensible:** adding a command is a single typed declaration; no edits to the matcher engine.

## Core data structure (TypeScript shape — illustrative, not yet implemented)

```ts
type CommandId = string; // e.g. "case.open", "report.sign_and_next"

interface CommandDef<Slots = Record<string, unknown>> {
  id: CommandId;
  title: string;                       // human label for clarification UI
  scope: Scope;                        // when this command is valid (see Hierarchy)

  // ── Matching surface (drives all three decoder layers) ──
  patterns: Pattern[];                 // canonical phrasings → compiled to regex/FST + Aho-Corasick
  synonyms: string[];                  // verb/object synonyms expanded into patterns
  anchors: string[];                   // example utterances → embedded for the L2 semantic path
  slots?: SlotDef[];                   // typed parameters extracted from the utterance

  // ── Behavior ──
  async?: boolean;                     // runs in background; dictation continues
  confirm?: ConfirmPolicy;             // 'never' | 'optimistic' | 'always' (destructive ops)
  clarify?: (ctx, partial) => Clarification | null; // ambiguity → follow-up question

  // ── Execution ──
  execute: (slots: Slots, ctx: CommandContext) => Promise<CommandResult> | CommandResult;

  // ── Confidence ──
  minConfidence?: number;              // calibrated threshold (isotonic/conformal, not hand-tuned)
  priority?: number;                   // tie-break when multiple commands match a span
}

interface SlotDef {
  name: string;
  type: 'enum' | 'patientName' | 'anatomy' | 'measurement' | 'free' | 'number';
  resolver?: 'symspell' | 'metaphone' | 'jaro-winkler' | 'exact'; // fuzzy/phonetic for proper nouns
  source?: () => string[];             // dynamic vocab (e.g. today's worklist patient names)
  required?: boolean;
}

interface Scope {
  mode?: AppMode | AppMode[];          // 'worklist' | 'case-open' | 'editing' | 'signing'
  parent?: CommandId;                  // nested command (sub-command of another)
  requires?: (ctx: CommandContext) => boolean; // arbitrary guard
}
```

## How each piece is modeled

### Synonyms + pleasantries + filler
- `patterns` and `synonyms` are expanded at build time into a compiled matcher. Trailing
  pleasantries and fillers are stripped by a **shared normalizer** (a stop-phrase list +
  lemmatizer) before matching, so authors never enumerate "…please/now/for me" variants.
- Example: `case.open` with `synonyms: ["open", "pull up", "load", "bring up"]` and
  `slots: [{name:"patient", type:"patientName", resolver:"metaphone", source: worklistNames}]`
  matches "open the Smith case please", "pull up Smith for me", "load Smith now".

### Proper-noun slots (patient names, anatomy, drugs)
- Resolved with **SymSpell + Double Metaphone + Jaro-Winkler** against a *dynamic* vocab
  (`source`) — e.g. only today's worklist names, which keeps the candidate set tiny and the
  match phonetically robust to STT errors ("Smith" vs "Smyth").

### Hierarchy / context
- `scope.mode` gates a command to an app mode; the matcher only loads in-scope commands, which
  also shrinks the search space (faster + fewer mis-fires).
- `scope.parent` models nested commands: "differential diagnose **those**" is a sub-command
  valid only after findings are selected; "**those**" resolves against current selection context.

### Async commands
- `async: true` dispatches the executor without blocking the dictation lane. Result streams back
  into the UI when ready (e.g. impression generation), with a visible non-modal status chip.

### Clarification (follow-up "did you mean X or Y?")
- `clarify` returns a `Clarification {question, options: CommandId[] | slotValues}` which the
  action layer renders as a transient voice-answerable prompt. A short-lived **clarification
  state** in the session FSM captures the next utterance as the answer, then resumes.

### Confidence + escalation
- Each layer returns a calibrated confidence. `minConfidence` is set by **isotonic/conformal
  calibration on logged utterances**, never hand-tuned. Below threshold on all local layers →
  escalate to the L3 LLM (de-identified). Medium confidence → **optimistic preview-then-confirm**
  (show the action greyed/pending; a quick "yes"/silence commits, "no"/correction reverts) to
  hide LLM latency.

## Commit gate (when a partial actually fires) — `confirm` policy

Streaming partials get *revised* as more audio arrives, so matching a command on the first
partial is not enough — firing then risks a mis-fire on a partial that later changes. Each command
therefore passes through a **cost-tiered commit gate** before its `execute` runs. The
`confirm: ConfirmPolicy` field selects the tier (grounded in the literature — see
[undermind/MERGE-partial-commit-stability.md](research/literature/MERGE-partial-commit-stability.md)):

- **`'optimistic'` (low-cost: navigation, scroll, "next").** Commit on **local agreement N=1–2** —
  the trigger span is stable across 1–2 consecutive partials. May start reversible **subactions
  mid-utterance** and render an optimistic preview. Cheap to undo if a later partial revises.
- **`'never'` (default).** Local agreement **N=2–3** (EffWhiS/Whisper-Streaming style: commit when
  the span appears in ≥2 of the last 3 partials). Lag is **adaptive**, driven by a per-word
  stability score or emission uncertainty rather than a flat delay.
- **`'always'` (destructive: "sign", "delete", "finalize").** Require a **guaranteed-stable
  prefix (revision-window = 0)** *or* drop to a **`clarify` prompt** ("sign and next?") when
  confidence is low under time pressure. This mirrors the human cost-asymmetry strategy (Loth et
  al., PLoS ONE 2018): act on weak evidence only when error cost is low; otherwise wait or ground
  with an echo question. Never fire a destructive op on an unstable partial.

The displayed dictation is independently de-flickered (partial reranking/rewriting) so transcript
churn never reaches the report text regardless of when commands commit.

## Mid-utterance claiming + transcript subtraction

When a command is claimed from a partial, the engine records the **word-timestamp span** that
triggered it. That span is then **subtracted from the dictation buffer** so the spoken command
doesn't pollute the report text — with an **undo log entry** (medico-legal requirement). This is
the mechanism that lets "findings are: …" dictation and "generate, sign and next" commands share
one continuous stream.

## Adding a new command (the extensibility story)

1. Add one `CommandDef` to the registry (a single file per domain area, e.g. `commands/case.ts`).
2. A build step compiles `patterns`/`synonyms` → matcher artifacts, embeds `anchors` → vector
   bank, and emits the LLM tool schema. No engine code changes.
3. Provide `execute`. Done. The command is now reachable via all three decoder layers and the
   clarification system, scoped by its `scope`.

## Open design questions (carry into build)

- Exact confidence-calibration method (isotonic vs conformal) and how much logged data is needed.
- Whether to author anchors by hand or auto-generate paraphrases (and re-embed) per command.
- ~~Policy for fire-on-partial vs wait-k per command type~~ → **decided** (see Commit gate above):
  cost-tiered local-agreement N, not a flat wait-k. Remaining work is bench-tuning N + thresholds.
- Whether Picovoice Rhino's context grammar can be generated from the same `CommandDef` source
  (single-source-of-truth across an on-device speech→intent engine too).
