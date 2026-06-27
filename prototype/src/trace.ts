// Per-utterance stage-boundary trace. Timestamps are ms since utterance start
// (capture = 0), passed in by the adapter so browser-cloud and synthetic runs
// use one consistent clock. Mirrors the bench's UtteranceTrace.

export interface TraceSummary {
  ttfp: number | null; // capture -> first partial
  decode: number | null; // first partial -> command claim
  m2c: number | null; // capture -> command claim (the headline)
}

export class Trace {
  private marks = new Map<string, number>();

  mark(stage: string, tMs: number): void {
    if (!this.marks.has(stage)) this.marks.set(stage, tMs);
  }

  private span(a: string, b: string): number | null {
    const x = this.marks.get(a);
    const y = this.marks.get(b);
    // Clamp to >=0: under out-of-order tMs (a later mark timestamped before an
    // earlier one) a raw subtraction would report a nonsensical negative duration.
    return x === undefined || y === undefined ? null : Math.max(0, Math.round(y - x));
  }

  summary(): TraceSummary {
    return {
      ttfp: this.span('capture', 'firstPartial'),
      decode: this.span('firstPartial', 'commandClaim'),
      m2c: this.span('capture', 'commandClaim'),
    };
  }
}
