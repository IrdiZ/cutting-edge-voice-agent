// Stage-boundary timestamp bus — the spine every experiment logs to.
//
// docs/PHASE-0-BENCH.md §B: capture every hop so the per-stage budget can be
// reconstructed. Each timestamp is milliseconds on a single monotonic clock.
// The headline metric is mouth-to-command (capture -> commandClaim).

export const STAGES = [
  'capture', // audio frame captured at the mic
  'vad', // VAD marked speech onset
  'firstPartial', // STT emitted its first partial hypothesis
  'commandClaim', // decoder confidently claimed a command on a partial
  'commit', // commit policy accepted the claim (local-agreement N satisfied)
  'dispatch', // action layer dispatched the command
  'render', // UI/DOM reflected the action
] as const;

export type Stage = (typeof STAGES)[number];

export interface StageMark {
  readonly stage: Stage;
  readonly t: number; // ms on the trace clock
}

/** Monotonic clock in ms. Defaults to performance.now(); injectable for replay/synthetic runs. */
export type Clock = () => number;

export class UtteranceTrace {
  readonly id: string;
  readonly marks: StageMark[] = [];
  private readonly clock: Clock;

  constructor(id: string, clock: Clock = () => performance.now()) {
    this.id = id;
    this.clock = clock;
  }

  /** Record a stage boundary. Pass an explicit `t` for replayed/synthetic timelines. */
  mark(stage: Stage, t: number = this.clock()): void {
    this.marks.push({ stage, t });
  }

  at(stage: Stage): number | undefined {
    return this.marks.find((m) => m.stage === stage)?.t;
  }

  /** ms between two stage boundaries, or undefined if either is missing. */
  span(from: Stage, to: Stage): number | undefined {
    const a = this.at(from);
    const b = this.at(to);
    return a === undefined || b === undefined ? undefined : b - a;
  }

  /** Headline number: capture -> commandClaim (often fires before the speaker stops). */
  mouthToCommand(): number | undefined {
    return this.span('capture', 'commandClaim');
  }

  /** Time-to-first-partial: capture -> firstPartial. */
  ttfp(): number | undefined {
    return this.span('capture', 'firstPartial');
  }
}
