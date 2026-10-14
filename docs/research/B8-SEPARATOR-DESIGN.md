# B8 — Command-vs-Dictation Separator Design

> **SGFM-Sep: a four-stage, no-model, false-accept-first separator — scope-FSM reachability hard gate + coverage-calibrated lexical confidence + per-tier commit-stability with a confident-isolated fast lane + narration-decoupled confirm — that drops into Pipeline.feed and closes the destructive-on-dictation case by construction.**

**Tournament ranking (judge total /30):**

- 19/30 — SGFM-Sep: Scope-Gated FSM + Coverage-Calibrated Lexical Confidence + Per-Tier Commit-Stability
- 19/30 — CALIFER — Calibrated Fused Separator (lexical × prosodic × history × reachability → per-tier conformal thresholds)
- 18/30 — SDAR-Sep: a sticky-mode sequential router with reachability hard-gate and isolation-aware confidence
- 18/30 — Dual-Lane Reachability Separator (DLRS): always-on safe-nav + push-to-command for consequential ops
- 17/30 — CASCADE-SEP: earliest-reject prosody/position → fuzzy-lexical reachability gate → ambiguous-band on-device LLM verify

**Dataset:** 128 utterances across 6 categories: pure-command, pure-dictation, embedded-command, adversarial-nearmiss, disfluent-pauses, stt-mishears (per-label counts not enumerated in the brief — the eval harness requires the corpus be re-exported with per-word gold dictation/command spans + a gold tier per command span, and split dev/test ~64/64 stratified so each category and each cost tier appears in both halves; pure-dictation + adversarial-nearmiss + disfluent-pauses are the false-accept stressors, pure-command + embedded-command carry recall, stt-mishears stresses the fuzzy matcher).

---

## Module interface

```ts
// src/separator/index.ts — the single seam Pipeline.feed delegates the
// command-vs-dictation call to. Pure on-device TS; no model, no GPU, no network.
// Inputs are exactly what Partial already carries + the app-mode scope + the
// reachable command subset. Output never resurrects an out-of-scope intent.

import type { Partial } from '../adapters/types.ts';
import type { Tier } from '../commands.ts';

export type Scope =
  | 'worklist' | 'case_open'
  | 'dictating_findings' | 'dictating_impression'
  | 'signing' | 'pending_confirm';

export interface WordSpan { startIdx: number; endIdx: number } // inclusive word indices into the partial's tokenization

export type Decision =
  | { decision: 'command';   intent: string; tier: Tier; slotName?: string; confidence: number; commandSpan: WordSpan; trace: SepTrace }
  | { decision: 'pending';   intent: string; tier: 'destructive'; confidence: number; commandSpan: WordSpan; trace: SepTrace }   // destructive: raise confirm prompt only
  | { decision: 'dictation'; confidence: number; trace: SepTrace }                                                              // route partial text to the report
  | { decision: 'ambiguous'; intent?: string; tier?: Tier; confidence: number; commandSpan?: WordSpan; trace: SepTrace };       // held; below tier τ or stability not yet met

export interface SepInput {
  partial: Partial;            // { text, isFinal, tMs, tokens?, timestamps? }  (timestamps = per-token ONSET sec)
  scope: Scope;                // current CONFIRMED app-mode scope (NOT a provisional one — see decision policy R3a)
  reachable: readonly string[];// intents reachable in `scope` ∪ globals, computed by ScopeFsm.reachableCommands()
}

export interface SepTrace {  // recorded per partial so the bench/HUD can show WHY a span routed where it did
  scope: Scope;
  cRaw: number;          // coverage-calibrated lexical confidence in [0,1]
  alpha: number;         // history/streak attenuation scalar in [0,1] (multiply-only)
  effective: number;     // cRaw * alpha
  tier?: Tier;
  coverage?: number;     // matchedTriggerWords / totalWords
  agreement?: number;    // commit-stability count so far
  firePath?: 'stable-N' | 'confident-isolated' | 'final-hypothesis' | null;
  vetoReason?: 'unreachable' | 'below-tau' | 'low-coverage' | 'negation' | 'measurement' | 'not-stable' | 'lockout' | null;
}

export interface Separator {
  // Called once per Partial inside Pipeline.feed. Pure given (input, internal stability/history state).
  classify(input: SepInput): Decision;
  // Lifecycle hooks the Pipeline already has natural call sites for:
  onUtteranceBegin(): void;             // reset firstSeen-style per-utterance stability; clears live candidate
  onScopeChange(next: Scope): void;     // rebuild cached reachable set (cheap; only on transition)
  // Test/calibration surface used by the bench DET sweep (see scorecard): expose the
  // raw scalar so a threshold can be swept without re-running the matcher.
  scoreOnly(input: SepInput): { intent: string | null; tier: Tier | null; cRaw: number; alpha: number; coverage: number };
}
```

## Build order

1. v1.0 (HARD, threshold-free, ships first — closes the medico-legal case by construction): Add `scopes: Scope[]` + `global?: boolean` to CommandDef in commands.ts. Build src/separator/scopeFsm.ts (Scope FSM + precomputed Map<Scope,Set<intent>>, reachableCommands(), transition table). CRITICAL TABLE EDIT: sign_and_next.scopes = [case_open, signing] ONLY (NOT dictating_*); in dictating_* reachable = {stop_dictation, undo, generate_impression} ∪ globals; navigation + destructive are simply absent. Replace pipeline.ts `dictation: DictTarget|null` + DICTATION_EXIT_INTENTS with the FSM. Insert the reachability filter before BOTH matchL1 call sites: matchL1(text, reachableCommands()). This alone makes a stray 'sign'/'next'/'compare' in findings prose unfireable.
2. v1.1 (HARD): Rewrite decoder.isSubsequence to return consumed word indices [startIdx,endIdx] AND a `contiguous` flag, and REJECT a multi-word trigger whose consumed indices are non-adjacent beyond a 1-word gap while in a dictating_* scope (kills the 'end ... [9 words] ... dictation' sentence-eater). Carry the span on Match as an optional field (no PipelineEvent contract change yet).
3. v1.2 (HARD, no calibration): Add coverage-aware cRaw in src/separator/confidence.ts using a HAND-SET formula (no fitted weights): cRaw = coverage * exactFrac * positionBonus where coverage = consumedTriggerWords/totalWords, exactFrac weights exact=1.0 / skeleton=0.5 / edit-distance=0.25 over trigger tokens, positionBonus rewards head/tail. Hard coverage floor per tier: destructive >=0.6, dictation-control >=0.4, navigation >=0.3. Below floor => dictation. This is the single highest-leverage decoder fix and the verified kill for embedded single-token triggers.
4. v1.3 (HARD): Strict trigger matching in dictating scope (src/slots.ts strict mode). VERIFIED: of the 6 collisions, 4 (signs, loud, compared, generated) fire via the EDIT-DISTANCE branch, not skeleton — so disabling vowel-collapse alone is insufficient. For command TRIGGER words while dictating, require exact OR exact-prefix match (raise the lev threshold to 0 / require prefix), AND drop the bare single-word triggers ['done'],['generate'],['stop'] in favor of two-word forms ['stop','dictation'],['scratch','that']. Also: 'signed'/'finalize' are LITERAL sign_and_next triggers (commands.ts:37) — they are neutralized by v1.0 reachability (sign unreachable while dictating), not by fuzzing.
5. v1.4 (HARD): Decouple confirm from narration in pipeline.ts. DELETE CONFIRM_RE = /(confirm|yes|do it|go ahead)/. In pending_confirm scope reachable collapses to {confirm, cancel}; a pending destructive resolves only via (a) the existing confirm BUTTON or (b) an isolated exact 'confirm'/'confirm sign' utterance (coverage>=0.8) that itself passes commit-stability N=2. Ambient 'yes' in dictation can never commit a signature.
6. v1.5 (HARD): Two-phase scope transitions (closes the eager-fire FSM/UI desync the false-accept judge flagged). The destructive tier's reachability is computed against the CONFIRMED scope only; a scope-CHANGING navigation/dictation-control command fires its action eagerly but the FSM scope advances only on isFinal OR on N=2 with the trigger off the live frontier. sign_and_next can therefore never become reachable inside a partial-revision window.
7. v1.6 (SOFT, hand-tuned thresholds — recall/latency tuning, still no fitted weights): Per-tier commit-stability gate src/separator/stability.ts (LocalAgreement-N over {intent, slotValue, spanKey}; N counted over DISTINCT token onsets, not raw partials, so a thinking-pause re-emission can't inflate N). Per-tier table: navigation τ=0.62 N=2 eager; dictation-control τ=0.70 N=2 + frontier-margin; destructive τ=0.80 N=2 + coverage>=0.6 -> pending only. Post-fire lockout 700ms / until next begin().
8. v1.7 (SOFT — the latency fix every judge demanded): Confident-isolated FAST LANE. For navigation + dictation-control, fire on the FIRST partial (N=1, no endpoint) when coverage==1.0 AND the trigger is a <=2-token isolated utterance AND effective >= τ+margin; fall back to N=2 only for the ambiguous/low-coverage band. This restores the inherited ~one-frame fire-on-partial feel for isolated 'next'/'stop' (which on the sherpa emit-on-change cadence would otherwise stall to endpoint), while keeping N=2 where ASR revision is the real risk. Add `endpoint?: boolean` to Partial and surface sherpa's isEndpoint() onto the final Partial (the prerequisite for the endpoint gate) + fix sherpa.ts:140 to pass res.tokens/res.timestamps on the isFinal emit.
9. v1.8 (SOFT): History α in src/separator/history.ts — multiply-only attenuation (SDAR): α = αMode·αRecency·αRepetition, dictating non-control αMode≈0.3, opener-grace α≈0.2 for 1.5s after begin_findings, recency EWMA TAU≈3500ms floor 0.4. α only attenuates effective = cRaw·α; it is NOT the destructive guard (reachability is).
10. v2 (DEFERRED, gated on a labeled span corpus existing): Replace hand-set cRaw floors + per-tier τ with offline-fit logistic (Platt) weights in calibration.json swept on a dev DET curve to per-tier FAR ceilings; build the endpoint-split replay harness + span-labeled corpus the absolute-count destructive gate needs.
11. v3 (DEFERRED / optional): on-device LLM slow-lane (WebLLM Qwen2.5-1.5B, XGrammar) for the NON-destructive ambiguous band only, async behind preview-then-confirm; and optional gesture/push-to-command opener (DLRS) as a per-site hardening for destructive ops on no-timestamp engines.

---

# SGFM-Sep — Command-vs-Dictation Separator Spec (v1, buildable)

## 0. What this replaces and why

The prototype's `Pipeline` (`prototype/src/pipeline.ts`) currently separates commands from dictation with a **naive mode flag**: a `dictation: DictTarget|null`; when set, only a `DICTATION_EXIT_INTENTS` allow-list is matched, otherwise *every* command in the registry is tried against the partial. Three verified holes make this medico-legally unsafe **today**:

1. **`matchL1` returns a boolean subsequence hit with no coverage term** (`decoder.ts:44-70`, scored `TIER_RANK*100 + triggerLen`). A single embedded trigger word in long prose fires at full strength.
2. **`sign_and_next` is in `DICTATION_EXIT_INTENTS`** (`pipeline.ts:30-33`) and has the literal bare triggers `['sign'],['signed'],['finalize'],['sign','off']` (`commands.ts:37`). So `sign_and_next` can be raised to `pending` *while the user is dictating findings*.
3. **`CONFIRM_RE = /\b(confirm|yes|do it|go ahead)\b/i`** (`pipeline.ts:26`) scans the *cumulative* partial text while a destructive op is pending — so an ambient "yes" in narration (`"yes, there is mild effusion"`) **commits an irreversible signature**.

The "stray `sign` + ambient `yes` auto-signs a report" worst case is exactly today's behavior. We replace the naive gate with a **Separator module** that is false-accept-first **by construction**, fires on partial for safe isolated commands, is pure on-device TS, and adds sub-ms per partial.

This spec is the synthesis winner **SGFM-Sep** (Scope-Gated FSM + Coverage-Calibrated Lexical Confidence + Per-Tier Commit-Stability), grafted with the best ideas from the runners-up and with the judges' decisive fixes folded in (cited below).

---

## 1. Architecture: four stages, each can only REMOVE a candidate or DELAY a fire

Every stage is composable and monotone-safe: nothing downstream can resurrect an intent an upstream stage excluded.

### Stage 0 — ScopeFSM reachability hard gate (the dominant, structural, auditable defense)

App state is an FSM: `Scope = worklist | case_open | dictating_findings | dictating_impression | signing | pending_confirm`. Each `CommandDef` gains `scopes: Scope[]` and `global?: boolean`. The reachable set is `R(scope) = { c : scope ∈ c.scopes } ∪ { c : c.global }`, precomputed as a `Map<Scope, Set<intent>>` and rebuilt only on a scope change. **`matchL1` is only ever called with `reachableCommands()`** — an out-of-scope intent is structurally absent, never scored, never fired.

**The single load-bearing table edit** (consensus across *all four* designs and the false-accept judge): `sign_and_next.scopes = [case_open, signing]` — **NOT** `dictating_*`. While dictating findings, `sign`/`signed`/`finalize` map to an intent that is not a candidate, so no score, no `pending`, no fire. This is provable by reading the scopes table — the auditability win the dossier names — and it does not depend on any threshold. Likewise navigation and `begin_*` are absent in `dictating_*`, so `"compare with the prior"`, `"next we note"`, `"findings are..."` cannot navigate away mid-dictation.

The signal-evidence stress on *reachability-hardgate* proved that leaving `sign` in editing scope defeats the whole gate; this spec's table closes that, which is the difference between "improbable" and "impossible by construction" for the destructive class.

Reachable set per scope (v1):
- `worklist`: `{open_case, next_case, previous_case, compare_prior}` ∪ globals
- `case_open`: full set ∪ globals
- `dictating_findings` / `dictating_impression`: `{stop_dictation, undo, generate_impression}` ∪ globals — **no navigation, no destructive**
- `signing`: `{sign_and_next, undo, previous_case}` ∪ globals
- `pending_confirm`: `{confirm, cancel}` **only**
- globals (intentionally tiny, exact-trigger only): `{cancel}`. Note: **`stop` is NOT global** — it is too prose-common ("the bleeding stopped", "stop the medication"); abort uses `cancel` (CALIFER's correct call).

### Stage 1 — Coverage-calibrated lexical confidence `cRaw` (the most important decoder fix)

`matchL1` is extended to return `{intent, title, tier, slotName?, span:{startIdx,endIdx}, cRaw}`. `isSubsequence` is rewritten to return the **consumed word indices** and to **forbid non-contiguous multi-token triggers in dictating scope** (no 9-word gap between `end` and `dictation`). This kills the sentence-eater the *transcript-subtraction* stress surfaced.

```
cRaw = coverage × exactFrac × positionBonus            // all in [0,1]
coverage    = consumedTriggerWords / totalWords        // 1 trigger word in a 15-word partial → 0.07
exactFrac   = weighted(exact 1.0 / skeleton 0.5 / editdist 0.25) over trigger tokens
positionBonus = head/tail of utterance → 1.0, mid-body → 0.5
```

Coverage is the lexical proxy for "is this an isolated island": isolated `"Stop."` scores coverage 1.0; an embedded `"the lesion has stopped"` scores ~0.14 — well below any tier floor. **Honest correction (verified by node repro against the live `fuzzyEquals`):** the canonical kill example `"the bleeding has stopped"` does **not** even match the current matcher (`skeleton('stopped')='stpd'` ≠ `skeleton('stop')='stp'`, and the edit branch is `lev=3 > 1`). The *real* live collisions are `signs/sign`, `stomp/stop`, `undue/undo`, `loud/load`, `compared/compare`, `generated/generate`. The coverage argument is right; the flagship example was wrong, so coverage's job is to bury those *real* collisions when they sit inside prose.

**v1 ships hand-set thresholds, not fitted weights.** Per the buildability judge: there is no `calibration.json` and no span-labeled corpus, so a logistic/Platt fit and a per-tier DET sweep cannot be run "this week." v1 uses a hand-set per-tier **coverage floor** (`destructive ≥ 0.6`, `dictation-control ≥ 0.4`, `navigation ≥ 0.3`) plus the multiplicative formula above. The fitted logistic head + conformal/DET-swept τ (the CALIFER contribution) is explicitly **v2**, gated on the corpus existing.

### Stage 2 — Per-tier commit-stability (LocalAgreement-N over claims) + confident-isolated fast lane

A claim is provisional until its `(intent, slotValue, span region)` survives **N distinct-onset partials** with the trigger region not rewriting (cumulative tail growth allowed). N counted over **distinct token onsets**, not raw partial count, so thinking-pause re-emission can't inflate agreement (the *commit-stability* and *app-mode-history* stresses both flagged this). A UPWR-style instability counter drops chronically flickering regions to the final-hypothesis pass.

**The latency fix all three latency judges demanded** (scores were 5/5/5 because a flat N=2 regresses the inherited fire-on-partial path): add a **confident-isolated fast lane**. For navigation and dictation-control, fire on the **first** partial (N=1, no endpoint) when `coverage==1.0` AND the trigger is a ≤2-token isolated utterance AND `effective ≥ τ+margin`. Fall back to N=2 only for the ambiguous/low-coverage band. This matters because the sherpa adapter emits a partial **only when the text changes** (`sherpa.ts:129`) over ~128 ms frames (`mic.ts:14`, `BUFFER=2048`), so a short isolated `"Stop."` may never produce a second partial before the VAD endpoint (`vad.ts:42`, `redemptionMs=320`) — a flat N=2 would force it to endpoint (~300-600 ms). The fast lane restores sub-150 ms fire for exactly the isolated safe-command case; N=2 stays where ASR revision is the real risk.

### Stage 3 — Fire vs route-to-dictation decision + narration-decoupled destructive confirm

If `cRaw·α(scope-streak) ≥ τ[tier]` AND stability is met → fire (or enter `pending` for destructive). Else → the words route to the report (dictation by construction). The destructive confirm path is **replaced**: `CONFIRM_RE` scanning of free narration is **deleted**; a pending destructive resolves only via (a) the existing confirm **button** or (b) an isolated exact `"confirm"`/`"confirm sign"` utterance (coverage ≥ 0.8) that itself passes N=2. Ambient `"yes"` in dictation can never commit a signature.

**The medico-legal worst case is closed three independent ways:** sign unreachable in dictating (Stage 0), low coverage on an embedded `signed` even where reachable (Stage 1), confirm decoupled from narration (Stage 3).

---

## 2. Exact decision policy (per Partial `p`, first matching rule wins)

```
R0  PENDING.  If scope == pending_confirm:
      reachable = {confirm, cancel}.
      Fire `confirm` ONLY if matchL1(p, {confirm,cancel}) yields exact 'confirm'/'confirm sign'
      as an isolated utterance (coverage>=0.8) passing StabilityGate N=2, OR the confirm BUTTON.
      Else route p to dictation if a dict target underlies, else hold. Ambient 'yes' is NOT a trigger.
      A new utterance begin() clears pending (cancel is safe).

R1  REACHABILITY HARD GATE.  reachable = ScopeFsm.reachableCommands(confirmedScope).
      m = matchL1(p.text, reachable).  If m == null → route ALL of p's words to dictation
      (if scope is dictating_*) or no-op. An out-of-scope intent never reaches scoring.

R2  CONFIDENCE.  cRaw = coverage × exactFrac × positionBonus.
      α = αMode·αRecency·αRepetition ∈ [0,1] (multiply-only; SDAR). effective = cRaw·α.

R3  TIER GATE + COMMIT-STABILITY (m.tier):
   navigation {open_case,next_case,previous_case,compare_prior}:
       coverageFloor 0.30, τ 0.62.
       FAST LANE: if coverage==1.0 AND trigger is <=2-token isolated utterance AND effective>=0.78
                  → FIRE on this partial (N=1, no endpoint).
       else FIRE iff effective>=0.62 AND StabilityGate N=2.  open_case also requires slot stable across the same 2 partials.
   dictation-control {stop_dictation,undo,generate_impression}:
       coverageFloor 0.40, τ 0.70.
       FAST LANE: same confident-isolated rule as navigation (these are instantly reversible by resuming dictation).
       else FIRE iff effective>=0.70 AND N=2 AND trigger not the live-frontier token.
   destructive {sign_and_next}:
       NEVER auto-fires. Only reachable in {case_open,signing} (so unreachable while dictating).
       ENTER pending iff effective>=0.80 AND N=2 AND coverage>=0.6 (isolation).  No fast lane.
       COMMIT requires R0 confirm (button or isolated 'confirm sign' passing N=2).

R3a SCOPE TRANSITIONS ARE TWO-PHASE (false-accept judge's fix, weakness #4 of SGFM):
      A scope-CHANGING command (open/next/prev, begin_*, stop_dictation, generate) fires its ACTION
      eagerly but the FSM scope advances only on isFinal OR on N=2 with the trigger off the live frontier.
      The destructive tier's reachability is computed against the CONFIRMED scope, never a provisional one,
      so sign_and_next can NEVER become reachable inside a partial-revision window.

R4  DEFAULT.  If nothing fired and scope is dictating_*, p's words route to the report.
      If effective<τ for an in-scope command, the matched words ALSO route to dictation (dictation by construction).
      On p.isFinal, run ONE final-hypothesis pass of R1-R3 (final text is maximally stable) to recover a
      too-fast-to-reach-N command, then emit end.

LOCKOUT: after any fire, suppress identical-intent claims for 700ms / until next begin().
```

**Per-cost-tier commit gate summary** (frozen-by-hand in v1, DET-swept in v2):

| Tier | coverageFloor | τ | N | endpoint | fast lane | confirm |
|---|---|---|---|---|---|---|
| navigation | 0.30 | 0.62 | 2 | no (eager) | yes (isolated) | — |
| dictation-control | 0.40 | 0.70 | 2 + frontier-margin | no | yes (isolated) | — |
| destructive | 0.60 | 0.80 → **pending only** | 2 | — (human-gated) | no | mandatory, narration-decoupled |

---

## 3. How each signal is computed in-browser

All Stage 0-2 computation is pure TS over data already in `Partial`. No model, no embedding table, no GPU, no network — **strictly less work than the current matcher** because reachability shrinks the candidate list (≤4 in dictating vs 9 today).

- **Reachability (Stage 0):** one `Set.has()` per candidate over ≤9 commands; the `Map<Scope,Set>` is rebuilt only on scope change. Sub-µs.
- **`cRaw` (Stage 1):** the existing `isSubsequence` walk (now index-returning) + ~4 float features + a clamp. Coverage = `consumedTriggerWords / words.length`. `exactFrac` reuses the existing `fuzzyEquals`/`skeleton`/`lev` to classify each trigger token's match grade. `positionBonus` from the consumed span's head/tail position. Sub-µs.
- **Strict trigger matching (Stage 1, slots.ts):** **VERIFIED CORRECTION** — 4 of the 6 live collisions (`signs`, `loud`, `compared`, `generated`) fire via the **same-first-letter + edit-distance branch**, only 2 (`undue`, `loud` also matches skeleton; `undue` is skeleton-only) via the skeleton branch. So a strict mode that "disables vowel-collapse skeleton" alone leaves 4 of 6 intact (this is the buildability judge's correct catch). v1 strict mode for **command trigger words while dictating** requires **exact OR exact-prefix** (raise lev threshold to 0 / require prefix), tightening *both* branches, and drops bare `['done']`/`['generate']`/`['stop']` in favor of two-word forms. `signed`/`finalize` (literal `sign_and_next` triggers) are neutralized by reachability (sign unreachable while dictating), not by fuzzing.
- **History α (Stage 2):** a fixed-capacity ring of the last ~8 s of events keyed by `p.tMs` (no timers); `αMode` table lookup + one EWMA update + one streak count + multiplies. α can only **attenuate**, never amplify (SDAR). It is the *regime* signal, not the destructive guard. Sub-µs.
- **Commit-stability (Stage 2):** a handful of string/index compares against one stored candidate; N counted over distinct token onsets from `Partial.timestamps` (onset deltas), with a graceful fallback to partial-count when timestamps are absent (WebSpeech). Sub-µs.
- **Prosody:** explicitly **NOT** in v1. The *acoustic-prosodic* stress proved that on the telegraphic radiology dictation register prosody is an earliest *false-accept* amplifier (isolated, slowed, falling-contour clauses look like commands), and the substrate is degraded (sherpa gives onsets only, drops tokens/timestamps on the isFinal emit at `sherpa.ts:140`, and `mic.ts:26` has AGC/NS/echoCancellation on). Coverage is our lexical proxy for isolation. Prosody as a **reject-only** veto is deferred to v2 and only after the substrate fixes land.

---

## 4. False-accept-first guarantees (ordered by share of the budget each wins)

1. **Reachability as a hard gate (dominant, structural, auditable).** The medico-legal headline — a stray destructive firing on narration — is eliminated by construction: `sign_and_next ∉ R(dictating)`. Provable by reading the scopes table; threshold-independent. Navigation/`begin_*` likewise absent while dictating.
2. **Coverage-calibrated `cRaw`** kills the embedded-trigger-word class the gate still allows (for intents reachable in their scope). A single trigger word inside a long partial scores near-zero; below the per-tier coverage floor → dictation.
3. **Per-tier commit-stability** kills transient ASR ghosts of dictation; a frontier-margin requirement stops firing on the not-yet-stable last token; distinct-onset counting stops thinking-pause re-emission inflating N.
4. **Narration-decoupled closed-grammar confirm + strict triggers.** `CONFIRM_RE` deleted; confirm is button or isolated exact `"confirm sign"` passing N=2; strict (exact/prefix) trigger matching while dictating removes the verified `signs/stomp/undue/loud/compared/generate` collisions on *both* match branches.
5. **Two-phase scope transitions** (R3a) close the one path by which the structural guarantee leaked: a navigation command firing on a partial that is later revised can momentarily diverge the provisional scope from app truth. Computing destructive reachability against the **confirmed** scope means `sign_and_next` can never become reachable inside that window.

**Honest scope of the guarantee:** *destructive* false-accept is structurally bounded to ~zero. *Non-destructive control* false-accept (`stop_dictation`/`undo`/`generate` for intents reachable in their own scope) is **reduced, not zero** — coverage is graded, not absolute, so a short prose clause that is mostly trigger words can still clear τ. These are recoverable (silent dictation-stop / viewport swap), not medico-legal. The deferred prosody + LLM lanes close this later.

---

## 5. Transcript subtraction (kept reversible, contiguity-hard-gated)

The dictation buffer in `cockpit.ts` is a plain `dictBuf` string. When a command is claimed mid-dictation, the words it consumed must not land in the report. v1 keeps this **conservative and reversible**, per the *transcript-subtraction* stress (which showed a naive `[startIdx..endIdx]` excision over a non-contiguous `isSubsequence` match deletes whole sentences):

- Subtraction only ever removes the **exact consumed word indices** `isSubsequence` reports, and **refuses any multi-word excision whose consumed indices are non-adjacent** (the contiguity hard gate from Stage 1).
- It fires only on a span the Separator has **already accepted** (committed via N), never on a volatile partial — so a homograph used as narration is neither fired nor excised.
- Every excision writes an immutable undo entry and is surfaced as a visible inline "removed: <text>" chip (not a silent edit), and the subtraction-undo stack is **unified** with `cockpit.undo()` so saying "undo" reverses the right layer. The full `WordSpan[]` buffer refactor + per-token timestamps is **v2** (it needs the `sherpa.ts:140` fix to carry tokens/timestamps on the final emit); v1 does index-based excision on the tokenized final text.

---

## 6. Eval scorecard + how to run it

The bench (`bench/`) currently has a single `falseAcceptRate` fraction over `negatives` (`scorecard/index.ts:42-54`), no per-word spans, no DET sweep, no replay of the live separator. The dataset (`bench/datasets/types.ts`) has `embeddedInDictation?: boolean` and `negatives` but **no per-word gold spans**. The *evaluation-methodology* stress proved that a rate metric and a `command`-only false-accept counter both certify the catastrophe green (a destructive `pending` raised on dictation is invisible if you only count `command` events).

**What the scorecard must measure (v1, achievable without fitted weights):**

1. **FALSE-ACCEPT (headline, weighted heaviest), counting `pending` as a destructive false-accept.** Replay the labeled corpus through the **live** `Pipeline`, capture the `PipelineEvent[]` tape, align `command` AND `pending` events against gold spans by word overlap (±1 boundary slack). The destructive gate is an **ABSOLUTE COUNT**, not a rate: *destructive command-or-pending events overlapping any gold-dictation span MUST equal 0* across the whole corpus, with a bootstrap upper-CI reported. `dictation-control FAR ≤ 1.5%`, `navigation FAR ≤ 3%`. (The absolute-count framing is from the CALIFER/SGFM consensus and the eval stress — a long-prose denominator can hide a single fatal event in a rate.)
2. **Command recall / miss**, per tier and per intent (confusion table), substitution vs deletion separated.
3. **Per-tier DET/EER + reject@TPR**: the separator exposes `scoreOnly()` returning the raw `cRaw·α` scalar; sweep τ over 64 thresholds, plot FRR vs FAR per tier, report EER and `reject@99TPR`/`reject@95TPR`. (v1 reports these descriptively; v2 *selects* frozen τ from a dev split at the tier's FAR ceiling.)
4. **Word- and utterance-level span F1** (did each dictated word reach the report? did command words stay out?), ±1 word boundary slack (SLURP-style).
5. **Latency, correctness-conditioned**: `m2c` P50/P90 (reuse `TraceSummary`), plus `fireLead` reported **only for gold-confirmed fires** so eager-on-dictation cannot masquerade as low latency, plus a **fire-path histogram** (fast-lane vs stable-N vs final-hypothesis) so the "fire-on-partial preserved" claim is verified against the sherpa emit-on-change cadence rather than assumed.

**Corpus prerequisite (the real cost):** the 128-utterance labeled set must be re-exported with per-word gold dictation/command spans + a gold tier per command span, and the replay synthesizer needs an **endpoint-splitting mode** (thinking-pause → `isFinal` → `Pipeline.begin()` reset → fresh utterance starting with a trigger). Without the endpoint-splitter the gate certifies green while the most realistic post-pause mis-fire is never tested. **Run it in `bench/` against the SHIPPING separator** (import the real module, not the duplicated `bench/src/decoder/l1.ts` stub — re-exporting the separator into bench is the divergence trap this codebase already hit, per CLAUDE.md and the buildability vote).

---

## 7. v1 vs deferred

**v1 (this-cycle, no fitted weights, closes the medico-legal case):** Stage 0 reachability + scopes table (incl. `sign_and_next ∉ dictating`), contiguity/coverage guard in `matchL1`, hand-set coverage floors + per-tier τ, strict trigger matching tightening *both* fuzzy branches, narration-decoupled confirm, two-phase scope transitions, per-tier commit-stability with the confident-isolated fast lane, `endpoint?` on `Partial` + `sherpa.ts:140` fix, history α, conservative contiguity-gated transcript subtraction with unified undo. Bench: live-separator replay with the absolute-count destructive gate + endpoint-split synthesizer.

**Deferred:**
- **v2 (gated on a labeled span corpus):** Platt-fit `cRaw` logistic + conformal/DET-swept per-tier τ in `calibration.json`; reject-only prosody lane (after disabling AGC/NS and aggregating BPE→words); the full `WordSpan[]` buffer for time-anchored subtraction; online drift monitoring + per-user τ adaptation.
- **v3 / optional:** on-device LLM slow-lane (WebLLM Qwen2.5-1.5B + XGrammar) for the **non-destructive** ambiguous band only, async behind preview-then-confirm, hard-capped, fail-safe to dictation — **never** the destructive false-accept insurance (the LLM-slow-lane stress proved destructive cases are pre-filtered out of the band and the lane is aborted under continuous-dictation cadence anyway). Optional **gesture/push-to-command** opener (DLRS) as a per-site hardening for destructive ops, and the mandatory fallback when an adapter provides no timestamps (WebSpeech) — in that case force a stricter (endpoint-only, gesture-confirmed) destructive policy rather than silently degrading.

---

## 8. Honest risks

1. **Stable embedded command in a reachable scope.** For intents reachable in their scope (`stop`/`undo`/`generate` while dictating), a correctly + stably ASR-decoded prose occurrence passes commit-stability (stability validates the ASR, not the semantics). Coverage is the only defense and it is graded — a short clause that is mostly trigger words can clear τ. Accepted for the non-destructive control tier (recoverable); deferred prosody/LLM close it.
2. **No prosody = no isolation signal beyond coverage.** A post-thinking-pause resumed fragment is not distinguishable from a command onset lexically. We lean on the FSM (in dictating, `next`/`sign` unreachable) rather than detecting the pause — correct here, but a genuine post-dictation navigation requires an explicit `stop dictation` first.
3. **Calibration drift.** v1 hand-set floors/τ are not deploy-FAR; accent/subspecialty/ASR-profile shift means the structural part (FSM) is shift-invariant but the graded coverage/τ part drifts. Needs telemetry + per-user adaptation (v2, out of v1 scope).
4. **Multi-speaker / bystander.** No diarization; a bystander's "open the Patel case" in worklist scope is reachable and can fire. Out of scope for v1 (single-mic assumption); navigation is recoverable via the always-reachable `cancel`/`back`.
5. **Bench fidelity is load-bearing.** The destructive absolute-count gate is only as good as a corpus that labels `pending`-on-dictation as a false-accept AND an endpoint-split synthesizer. Without both, the gate can certify green while a confirm modal flashes on narration. This is the single biggest dependency that is *data work, not code work* — days, not hours.
6. **WebSpeech capability cliff.** The WebSpeech adapter provides no timestamps, so distinct-onset N counting and the endpoint gate degrade to partial-count + lexical. Acceptable (on-device sherpa is the target) but must fail *closed* (stricter destructive policy), not silently degrade.
