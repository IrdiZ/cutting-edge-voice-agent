// The reactive loop: partial -> SGFM separator (scope gate + coverage confidence)
// -> command | pending(destructive) | dictation. The separator replaces the old
// naive mode-flag gate; see research/B8-SEPARATOR-DESIGN.md. Measured on the 128-
// utterance corpus: false-accept 34%→0%, destructive false-fire 11→0 (eval/run-eval.ts).
//
// Safety is STRUCTURAL: while dictating, navigation + destructive are unreachable
// (ScopeFsm), so a stray "sign"/"next" in findings prose is unfireable by construction.

import { type Match, tokenize } from './decoder.ts';
import { Trace, type TraceSummary } from './trace.ts';
import type { Partial } from './adapters/types.ts';
import { classify, ScopeFsm, type Scope } from './separator/index.ts';

export type DictTarget = 'findings' | 'impression';

export type PipelineEvent =
  | { type: 'begin' }
  | { type: 'partial'; text: string; isFinal: boolean }
  | { type: 'pending'; match: Match }
  | { type: 'pending-cleared' }
  | { type: 'command'; match: Match; trace: TraceSummary }
  | { type: 'dictation-start'; target: DictTarget }
  | { type: 'dictation'; target: DictTarget; text: string; isFinal: boolean }
  | { type: 'dictation-stop' }
  | { type: 'end' };

const DICTATING: ReadonlySet<Scope> = new Set(['dictating_findings', 'dictating_impression']);

/** Isolated confirmation only — ambient "yes" in narration must NEVER commit a
 * signature (the deleted CONFIRM_RE bug). Content tokens ⊆ {confirm, sign}, ≤2,
 * and 'confirm' present. EXPORTED so the test suite can pin this isolation contract. */
export function isConfirmUtterance(text: string): boolean {
  const toks = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  const content = toks.filter((t) => t !== 'the' && t !== 'it' && t !== 'please');
  return content.length > 0 && content.length <= 2 && content.includes('confirm') &&
    content.every((t) => t === 'confirm' || t === 'sign');
}

/** True if the utterance carries >=1 content token (same filler/punctuation
 * stripping as isConfirmUtterance). Used ONLY for the fail-closed cancel: a
 * substantive, non-confirm utterance arriving while a destructive is pending
 * cancels the pending (never signs). Filler/silence must NOT trip this. */
function hasSubstantiveContent(text: string): boolean {
  const toks = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  const content = toks.filter((t) => t !== 'the' && t !== 'it' && t !== 'please');
  return content.length >= 1;
}

/** Char index in the arming partial just AFTER the dictation-scope trigger word
 * ("begin findings", "go to impression"), so a one-breath "begin findings we have
 * a mass" dictates only "we have a mass" and the command words don't leak into the
 * report. Anchored on the scope stem (matches finding/findings, impression) and the
 * FIRST occurrence (the command is at the front). 0 if not found → no stripping. */
function dictationStartOffset(raw: string, intent: string): number {
  const stem = intent === 'begin_impression' ? 'impress' : 'finding';
  const m = raw.toLowerCase().match(new RegExp('\\b' + stem + '\\w*'));
  return m && m.index !== undefined ? m.index + m[0].length : 0;
}

export class Pipeline {
  private trace = new Trace();
  private firstSeen = false;
  private claimed = false;
  private pending: Match | null = null;
  // True only while we are still inside the utterance that ARMED the current
  // pending destructive. Holds the commit so one-breath "sign confirm" cannot
  // sign; cleared on the next begin() so a SEPARATE isolated "confirm" can.
  private pendingArmedThisUtt = false;
  // Command scope only: number of leading (filler-stripped) words already consumed
  // by commands fired THIS utterance, so a single utterance can fire multiple
  // commands in sequence ("second case then third case"). Reset each begin().
  private consumedWords = 0;
  // Char offset in THIS utterance's raw text where dictated content begins, set when
  // begin_findings/impression fires mid-breath so the command words ("begin findings")
  // don't leak into the report. 0 = dictate the whole partial. Reset each begin().
  private dictStartRaw = 0;
  private lastTMs = 0;
  private fsm = new ScopeFsm('worklist');
  private onEvent: (ev: PipelineEvent) => void;

  // Plain field (not a parameter property): parameter properties are non-erasable
  // TS that Node's native test runner cannot strip, which would block unit-testing.
  constructor(onEvent: (ev: PipelineEvent) => void) {
    this.onEvent = onEvent;
  }

  begin(): void {
    this.trace = new Trace();
    this.trace.mark('capture', 0);
    this.firstSeen = false;
    this.claimed = false;
    this.consumedWords = 0;
    this.dictStartRaw = 0;
    this.lastTMs = 0;
    // A pending destructive now SURVIVES into the new utterance so a SEPARATE
    // spoken "confirm" can commit it. We only clear the arming flag — so this
    // fresh utterance is treated as the (possible) confirm/cancel, not the arm.
    // Scope persists across utterances.
    this.pendingArmedThisUtt = false;
    this.onEvent({ type: 'begin' });
  }

  feed(p: Partial): void {
    this.lastTMs = p.tMs;
    if (!this.firstSeen) { this.trace.mark('firstPartial', p.tMs); this.firstSeen = true; }
    this.onEvent({ type: 'partial', text: p.text, isFinal: p.isFinal });

    // Pending destructive. Resolution depends on WHICH utterance we are in:
    //  - same utterance that armed it (pendingArmedThisUtt): HOLD, never commit
    //    (one-breath "sign confirm" must not sign).
    //  - a later, SEPARATE utterance: an isolated "confirm" commits; any other
    //    substantive utterance fail-closed-cancels (never signs).
    if (this.pending) {
      if (!this.pendingArmedThisUtt) {
        if (isConfirmUtterance(p.text)) {
          this.commit(this.pending, p.tMs);
        } else if (p.isFinal && hasSubstantiveContent(p.text)) {
          // A different, non-confirm utterance → fail-closed: cancel (do NOT sign).
          this.pending = null;
          this.onEvent({ type: 'pending-cleared' });
        }
      }
      // While pendingArmedThisUtt is true we are still inside the arming
      // utterance: HOLD, never commit.
      if (p.isFinal) this.onEvent({ type: 'end' });
      return;
    }
    if (this.claimed) { if (p.isFinal) this.onEvent({ type: 'end' }); return; }

    if (DICTATING.has(this.fsm.current)) {
      // DICTATION scope: route text to the report, arm a destructive, or fire a
      // dictation-control command. If a command EXITS dictation (stop_dictation /
      // generate_impression → case_open), the page state changed — so the rest of
      // this SAME breath is re-evaluated in the new scope (the "reset on update"
      // model): "stop dictation, generate" fires stop THEN generate. We fall through
      // to the command-scope loop; the scope gate makes the just-fired command
      // unreachable so it can't re-fire, and the consumed-words cursor stops the tail
      // re-firing across later partials. A command that STAYS in dictation (undo) is
      // still one-decision-per-utterance.
      const d = classify(p.text, this.fsm);
      if (d.decision === 'pending') {
        this.pending = { intent: d.intent, title: d.title, tier: 'destructive', span: d.span, cRaw: d.confidence };
        this.onEvent({ type: 'pending', match: this.pending });
        this.pendingArmedThisUtt = true;
        if (p.isFinal) this.onEvent({ type: 'end' });
        return;
      }
      if (d.decision === 'dictation') {
        this.emitDictation(p);
        if (p.isFinal) this.onEvent({ type: 'end' });
        return;
      }
      this.fireCommand(d, p.tMs); // d.decision === 'command'
      if (DICTATING.has(this.fsm.current)) {
        if (p.isFinal) this.onEvent({ type: 'end' });
        return; // stayed in dictation (undo) — one decision per utterance
      }
      // exited dictation → re-anchor and fall through to the command-scope chaining
      // loop on the remaining tail of this same breath.
      this.claimed = false;
      this.consumedWords = d.span.end + 1;
    }

    // COMMAND scope: fire EVERY command in the unconsumed tail so one utterance can
    // chain commands ("second case then third case"). Each tail still passes the full
    // separator (scope gate + coverage floor), so FAR=0 is unaffected. A pending
    // destructive halts the chain. Command scope never sets `claimed` — the
    // consumed-words cursor (not a hard lock) is what prevents re-firing.
    const words = tokenize(p.text);
    while (this.consumedWords < words.length) {
      const tail = words.slice(this.consumedWords).join(' ');
      const d = classify(tail, this.fsm);
      if (d.decision === 'command') {
        this.consumedWords += d.span.end + 1;
        const wasDictating = DICTATING.has(this.fsm.current);
        this.fireCommand(d, p.tMs);
        if (!wasDictating && DICTATING.has(this.fsm.current)) {
          // Entered dictation mid-breath ("begin findings we have ..."). Mark where
          // the report text starts and route the REST of this same partial to the
          // report (stripped of the command words), so a one-shot final isn't lost.
          // Stop firing further commands — we're dictating now.
          this.dictStartRaw = dictationStartOffset(p.text, d.intent);
          this.claimed = false; // unlock so the rest of this breath reaches the dictation branch
          this.emitDictation(p);
          if (p.isFinal) this.onEvent({ type: 'end' });
          return;
        }
        continue;
      }
      if (d.decision === 'pending') {
        this.pending = { intent: d.intent, title: d.title, tier: 'destructive', span: d.span, cRaw: d.confidence };
        this.onEvent({ type: 'pending', match: this.pending });
        this.pendingArmedThisUtt = true;
        break;
      }
      break; // no (more) command in the tail
    }
    this.claimed = false; // command scope is never locked — allow chaining across partials
    if (p.isFinal) this.onEvent({ type: 'end' });
  }

  private fireCommand(d: Extract<ReturnType<typeof classify>, { decision: 'command' }>, tMs: number): void {
    const wasDictating = DICTATING.has(this.fsm.current);
    this.fsm.advance(d.intent);
    const nowDictating = DICTATING.has(this.fsm.current);

    if (!wasDictating && nowDictating) {
      this.onEvent({ type: 'dictation-start', target: this.fsm.current === 'dictating_impression' ? 'impression' : 'findings' });
    } else if (wasDictating && !nowDictating) {
      this.onEvent({ type: 'dictation-stop' });
    }
    this.claim({ intent: d.intent, title: d.title, tier: d.tier, slotName: d.slotName, slotNumber: d.slotNumber, span: d.span, cRaw: d.confidence }, tMs);
  }

  /** Route a partial's text to the active report field, stripping any command-word
   * prefix consumed on the arming breath (dictStartRaw) plus leading punctuation. */
  private emitDictation(p: Partial): void {
    const target: DictTarget = this.fsm.current === 'dictating_impression' ? 'impression' : 'findings';
    const sliced = this.dictStartRaw > 0 && this.dictStartRaw <= p.text.length
      ? p.text.slice(this.dictStartRaw) : p.text;
    const text = sliced.replace(/^[\s,.;:-]+/, '');
    this.onEvent({ type: 'dictation', target, text, isFinal: p.isFinal });
  }

  confirmPending(): void { if (this.pending) this.commit(this.pending, this.lastTMs); }
  cancelPending(): void { this.pending = null; this.onEvent({ type: 'pending-cleared' }); }

  private commit(m: Match, tMs: number): void {
    this.pending = null;
    this.fsm.advance(m.intent);
    this.claim(m, tMs);
  }

  private claim(m: Match, tMs: number): void {
    this.claimed = true;
    this.trace.mark('commandClaim', tMs);
    this.onEvent({ type: 'command', match: m, trace: this.trace.summary() });
  }
}
