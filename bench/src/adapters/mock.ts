// Deterministic mock STT adapter — lets the whole pipeline (trace -> decoder ->
// scorecard) run end-to-end with NO real engine, so the harness is testable
// before any model is wired. It replays the reference transcript word-by-word
// on a configurable latency profile.
//
// The `ttfpMs` / `perWordMs` knobs are intended to be set to the values that
// docs/research/WEB-VERIFICATION.md settles for each candidate engine — so the
// bake-off can be dry-run with literature numbers, then re-run against real
// adapters once those exist. Anything sourced this way MUST keep
// `meta.placeholder = true` until measured locally.

import type { SttAdapter, SttAdapterMeta, SttInput, Partial } from './types.ts';

// Floor on per-word emission: a human can't say word i before ~i*MIN_SAY_MS, so a
// partial carrying word i must not be timestamped earlier than that, no matter how
// fast the (placeholder) engine claims to decode. ~120 ms/word ≈ brisk conversational
// speech (~8 wps); keeps the headline m2c physically plausible.
const MIN_SAY_MS = 120;

export interface MockConfig {
  name: string;
  /** Time-to-first-partial, ms. */
  ttfpMs: number;
  /** Incremental latency added per emitted word, ms. */
  perWordMs: number;
  /**
   * Endpoint/silence wait before the engine declares `isFinal`, ms. This is the
   * dominant term WEB-VERIFICATION.md (F1/F2) identified — it gates anything that
   * waits for the final transcript (e.g. destructive commands), and is exactly
   * why sub-100 ms mouth-to-command is unreachable on the endpointed path on ANY
   * hardware. Fire-on-partial commands sidestep it. Defaults to 300 ms.
   */
  endpointMs?: number;
  footprintMB?: number;
  hardware?: string;
  /** Defaults to true — mock numbers are never "measured". */
  placeholder?: boolean;
}

export class MockSttAdapter implements SttAdapter {
  readonly meta: SttAdapterMeta;
  private readonly cfg: MockConfig;

  constructor(cfg: MockConfig) {
    this.cfg = cfg;
    this.meta = {
      name: cfg.name,
      kind: 'mock',
      footprintMB: cfg.footprintMB,
      hardware: cfg.hardware,
      placeholder: cfg.placeholder ?? true,
    };
  }

  async transcribe(input: SttInput, onPartial: (p: Partial) => void): Promise<void> {
    const words = input.reference.trim().split(/\s+/).filter(Boolean);
    const acc: string[] = [];
    let lastWordT = this.cfg.ttfpMs;
    for (let i = 0; i < words.length; i++) {
      acc.push(words[i]!);
      // A word cannot be emitted before it could physically have been spoken.
      // Floor each emission at i*MIN_SAY_MS so a fast engine's perWordMs can't
      // surface word i earlier than its earliest possible utterance time —
      // otherwise the headline mouth-to-command is inflated by un-sayable speed.
      const tEmit = Math.max(this.cfg.ttfpMs + i * this.cfg.perWordMs, i * MIN_SAY_MS);
      onPartial({ text: acc.join(' '), isFinal: false, tEmitMs: tEmit });
      lastWordT = tEmit;
    }
    // The final transcript is only declared after the endpoint silence wait —
    // the dominant, hardware-independent term. Fire-on-partial consumers see the
    // word above; only consumers that wait for `isFinal` pay this.
    const endpointMs = this.cfg.endpointMs ?? 300;
    onPartial({ text: acc.join(' '), isFinal: true, tEmitMs: lastWordT + endpointMs });
  }
}
