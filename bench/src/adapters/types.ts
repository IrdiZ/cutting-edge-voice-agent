// STT adapter contract — the pluggable boundary for the A2/A3/A9 bake-off.
//
// Any engine (on-device Parakeet/Moonshine/sherpa-onnx, browser Voxtral-WebGPU,
// cloud Deepgram Nova-3 Medical) implements SttAdapter so it can be swapped into
// an experiment without touching the harness. Engines are added AFTER
// research/WEB-VERIFICATION.md settles which are worth wiring (vs stubbing).

export interface Word {
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly confidence?: number;
}

export interface Partial {
  /** Cumulative hypothesis text at this emission. */
  readonly text: string;
  readonly words?: readonly Word[];
  readonly isFinal: boolean;
  /** ms since utterance start (capture) when this partial was emitted — feeds the trace. */
  readonly tEmitMs: number;
}

export type SttKind = 'on-device' | 'cloud' | 'browser-webgpu' | 'mock';

export interface SttAdapterMeta {
  readonly name: string;
  readonly kind: SttKind;
  readonly footprintMB?: number;
  readonly hardware?: string; // e.g. "CPU-only i7", "M3 ANE", "WebGPU"
  /** True when the numbers this adapter produces are placeholders, not measured. */
  readonly placeholder?: boolean;
}

export interface SttInput {
  readonly id: string;
  /** Path to real audio, if present. Synthetic runs leave this undefined. */
  readonly audioPath?: string;
  readonly durationMs: number;
  /** Ground-truth transcript — drives synthetic replay and WER scoring. */
  readonly reference: string;
}

export interface SttAdapter {
  readonly meta: SttAdapterMeta;
  /**
   * Stream partial hypotheses for one utterance. `onPartial` is called per
   * emission, ending with an `isFinal: true` partial.
   */
  transcribe(input: SttInput, onPartial: (p: Partial) => void): Promise<void>;
}
