// The STT adapter boundary — the seam that lets M2 swap the cloud Web Speech
// engine for an on-device WebGPU (or native-sidecar) engine WITHOUT touching the
// pipeline / cockpit / HUD. Keep this contract stable.

export interface Partial {
  /** Cumulative hypothesis text for the current utterance. */
  text: string;
  isFinal: boolean;
  /** ms since this utterance's capture start. */
  tMs: number;
  /** Per-token text + onset seconds, when the engine provides them (sherpa streaming). */
  tokens?: string[];
  timestamps?: number[];
}

export interface AdapterHooks {
  onUtteranceStart: () => void;
  onPartial: (p: Partial) => void;
  onError?: (msg: string) => void;
}

export interface SttAdapter {
  readonly name: string;
  /** One-line provenance note shown in the HUD (e.g. cloud vs on-device). */
  readonly note: string;
  start(hooks: AdapterHooks): Promise<void>;
  stop(): void;
}
