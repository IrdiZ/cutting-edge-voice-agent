// Silero VAD segmenter (replaces the crude RMS energy gate in mic.ts).
// Wraps @ricky0123/vad-web (Silero v5 via onnxruntime-web/wasm): it owns mic
// capture, emits clean speech onset/offset, and hands us frames during speech +
// the full padded segment on speech end.
//
// Asset paths:
//  - Silero model + VAD worklet: vendored under public/vad/ (fetched as URLs, fine
//    in public/). Re-copy with:
//      cp node_modules/@ricky0123/vad-web/dist/{silero_vad_v5.onnx,vad.worklet.bundle.min.js} public/vad/
//  - ort-wasm: served from node_modules, NOT public/. onnxruntime dynamically
//    import()s its .mjs wasm-loader, and Vite refuses to import() a public/ file
//    ("should not be imported from source code"). The node_modules path is
//    importable AND matches the installed ort version exactly (no CDN version skew).

import { MicVAD } from '@ricky0123/vad-web';

const BASE = '/vad/'; // Vite serves public/ at root (model + worklet)
const ORT_BASE = '/node_modules/onnxruntime-web/dist/'; // importable by Vite; matches installed ort

export interface VadHooks {
  onSpeechStart: () => void;
  /** A Silero frame (512 samples @ 16 kHz ≈ 32 ms) while speech is active. */
  onFrame: (frame: Float32Array) => void;
  /** Full padded utterance audio (Float32 @ 16 kHz) when speech ends. */
  onSpeechEnd: (audio: Float32Array) => void;
  /** A sub-minSpeech blip fired onSpeechStart but produced no onSpeechEnd: the consumer
   *  must unwind the utterance it opened so it never hangs un-terminated. Optional. */
  onMisfire?: () => void;
  onError?: (msg: string) => void;
}

export interface VadConfig {
  redemptionMs?: number;
  minSpeechMs?: number;
  preSpeechPadMs?: number;
  positiveSpeechThreshold?: number;
}

export class SileroVad {
  private vad: MicVAD | null = null;
  // In-flight async teardown from the previous stop(). MicVAD.destroy() is async and
  // tears down the AudioContext; if a new start() races ahead of it we leak the old
  // context. start() awaits this first so teardown always completes before re-acquire.
  private teardown: Promise<void> | null = null;
  readonly sampleRate = 16000;

  constructor(private readonly cfg: VadConfig = {}) {}

  async start(hooks: VadHooks): Promise<void> {
    // Drain any pending teardown so the previous AudioContext is fully gone first.
    if (this.teardown) { await this.teardown; this.teardown = null; }
    try {
      this.vad = await MicVAD.new({
        model: 'v5', // default is the older 'legacy'
        baseAssetPath: BASE,
        onnxWASMBasePath: ORT_BASE,
        // ms-based knobs: redemption = trailing silence before offset (the endpoint floor).
        // Silero detects onset AFTER the first phoneme, so a generous preSpeechPad is
        // essential or the first word is clipped (verified in the bake-off transcripts).
        redemptionMs: this.cfg.redemptionMs ?? 320, // trailing silence before speech-end
        minSpeechMs: this.cfg.minSpeechMs ?? 96, // ignore sub-~100 ms blips
        preSpeechPadMs: this.cfg.preSpeechPadMs ?? 320, // pre-roll so the onset word isn't clipped
        positiveSpeechThreshold: this.cfg.positiveSpeechThreshold ?? 0.5,
        onSpeechStart: () => hooks.onSpeechStart(),
        onFrameProcessed: (_probs: unknown, frame: Float32Array) => hooks.onFrame(frame),
        onSpeechEnd: (audio: Float32Array) => hooks.onSpeechEnd(audio),
        // Fires when onSpeechStart was emitted but the segment was below minSpeechMs, so
        // no onSpeechEnd will come — let the consumer unwind the utterance it opened.
        onVADMisfire: () => hooks.onMisfire?.(),
      });
      this.vad.start();
    } catch (e) {
      hooks.onError?.(e instanceof Error ? e.message : String(e));
    }
  }

  stop(): void {
    const vad = this.vad;
    this.vad = null; // null synchronously so in-flight frame callbacks no-op immediately
    if (!vad) return;
    // destroy() is async (closes the AudioContext). Capture the promise so start() can
    // await it, and swallow any rejection so a failed teardown never escapes as unhandled.
    let p: Promise<void>;
    try { p = vad.destroy(); }
    catch { p = Promise.resolve(); /* sync throw: nothing left to await */ }
    this.teardown = p.catch(() => { /* teardown failure is non-fatal; don't leak a rejection */ });
  }
}
