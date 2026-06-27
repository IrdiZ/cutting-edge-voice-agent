// On-device STT adapter. Runs Whisper-tiny in-browser on WebGPU via
// transformers.js; nothing leaves the machine. M3a: utterance segmentation is now
// Silero VAD (not the old RMS gate) — clean onset/offset + pre-roll. The growing
// buffer is re-transcribed every few frames to produce PARTIALS (fire-on-partial),
// with a final pass on the VAD-provided padded segment.
//
// Whisper is still chunk-based (re-transcribe the buffer) — true streaming is M3b
// (sherpa-onnx Zipformer WASM, behind this same SttAdapter). Numbers here ARE
// on-device, unlike the cloud Web Speech adapter.

import type { AdapterHooks, SttAdapter } from './types.ts';
import { concatFloat32 } from '../audio/mic.ts';
import { SileroVad } from '../audio/vad.ts';

type Asr = (audio: Float32Array, opts?: Record<string, unknown>) => Promise<{ text: string }>;

// Swap to a streaming model in M3b. onnx-community repos ship WebGPU-ready ONNX.
const MODEL_ID = 'onnx-community/whisper-tiny.en';

const PARTIAL_EVERY = 12; // re-transcribe every ~384 ms while speaking (Silero frame ≈ 32 ms)

export class OnDeviceAdapter implements SttAdapter {
  readonly name = 'On-device (WebGPU)';
  readonly note = `${MODEL_ID} + Silero VAD via transformers.js — on-device, nothing leaves the machine`;

  private asr: Asr | null = null;
  private device: 'webgpu' | 'wasm' = 'webgpu';
  private vad = new SileroVad();
  private hooks: AdapterHooks | null = null;

  // utterance state
  private sincePartial = 0;
  private t0 = 0;
  private buf: Float32Array[] = [];
  private busy = false;
  private stopped = false; // set in stop(); blocks any in-flight transcribe from emitting

  constructor(private readonly onStatus: (s: string) => void) {}

  /** Lazy-load + compile the model. Safe to call repeatedly. */
  async load(): Promise<void> {
    if (this.asr) return;
    const { pipeline, env } = await import('@huggingface/transformers');
    env.allowLocalModels = false;
    const hasGpu = 'gpu' in navigator && (navigator as unknown as { gpu?: unknown }).gpu != null;
    this.device = hasGpu ? 'webgpu' : 'wasm';
    this.onStatus(`loading ${MODEL_ID} (${this.device})…`);
    const pipe = await pipeline('automatic-speech-recognition', MODEL_ID, {
      device: this.device,
      dtype: 'fp32',
      progress_callback: (x: { status?: string; file?: string; progress?: number }) => {
        if (x.status === 'progress' && x.file && x.file.endsWith('.onnx')) {
          this.onStatus(`downloading ${x.file.split('/').pop()} · ${Math.round(x.progress ?? 0)}%`);
        }
      },
    });
    this.asr = pipe as unknown as Asr;
    this.onStatus(`ready · ${this.device}`);
  }

  async start(hooks: AdapterHooks): Promise<void> {
    this.hooks = hooks;
    this.stopped = false; // fresh session: re-arm emits
    try {
      await this.load();
      await this.vad.start({
        onSpeechStart: () => this.onSpeechStart(),
        onFrame: (frame) => this.onFrame(frame),
        onSpeechEnd: (audio) => this.onSpeechEnd(audio),
        // Sub-minSpeech blip: VAD opened (onSpeechStart) but won't close — drop the buffer
        // and reset so the next real utterance starts clean (no orphaned partial buffer).
        onMisfire: () => { this.buf = []; this.sincePartial = 0; },
        onError: (msg) => { this.onStatus(`vad error: ${msg}`); hooks.onError?.(msg); },
      });
      this.onStatus(`listening · ${this.device} + Silero VAD`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.onStatus(`error: ${msg}`);
      hooks.onError?.(msg);
    }
  }

  stop(): void {
    this.stopped = true; // any transcribe still awaiting a slot/model must not emit
    this.vad.stop();
    this.buf = [];
    this.sincePartial = 0;
    if (this.asr) this.onStatus(`ready · ${this.device}`);
  }

  private onSpeechStart(): void {
    this.sincePartial = 0;
    this.buf = [];
    this.t0 = performance.now();
    this.hooks?.onUtteranceStart();
  }

  private onFrame(frame: Float32Array): void {
    this.buf.push(frame);
    if (++this.sincePartial >= PARTIAL_EVERY) {
      this.sincePartial = 0;
      void this.transcribe(concatFloat32(this.buf), false);
    }
  }

  private onSpeechEnd(audio: Float32Array): void {
    // VAD hands us the full padded utterance — use it for the final pass.
    void this.transcribe(audio, true);
  }

  private async transcribe(audio: Float32Array, isFinal: boolean): Promise<void> {
    if (!this.asr || audio.length === 0 || this.stopped) return;
    // Single-flight: drop a partial if a transcription is in flight, but never drop
    // the final — wait for the slot.
    if (this.busy && !isFinal) return;
    while (this.busy) await new Promise((r) => setTimeout(r, 8));
    if (this.stopped) return; // stop() may have fired while we waited for the slot

    this.busy = true;
    const t0 = this.t0; // snapshot the segment anchor before the await (a new segment may reset this.t0)
    try {
      const out = await this.asr(audio);
      const text = out.text.trim();
      // Measure AFTER the await: tMs is the time until the hypothesis is actually available,
      // not the time we acquired the slot (which under-reported by the full inference cost).
      const tMs = performance.now() - t0;
      if (text && !this.stopped) this.hooks?.onPartial({ text, isFinal, tMs });
    } catch (e) {
      if (!this.stopped) this.hooks?.onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy = false;
    }
  }
}

export function webGpuAvailable(): boolean {
  return 'gpu' in navigator && (navigator as unknown as { gpu?: unknown }).gpu != null;
}
