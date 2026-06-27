// M3b — TRUE streaming on-device STT via sherpa-onnx (online Zipformer transducer)
// compiled to WASM. Unlike Whisper (chunked, re-transcribe-the-buffer, hallucinates
// "you" on short clips), this is causal/online: acceptWaveform() + a decode() loop
// that NEVER re-feeds the buffer, emitting stable incremental partials and a real
// endpoint signal. Fixes the short-command failure mode.
//
// Uses the PRE-BUILT k2-fsa WASM bundle (no emscripten build): classic scripts +
// Emscripten Module, vendored under public/sherpa/. Needs cross-origin isolation
// (pthreads/SharedArrayBuffer) — see vite.config.ts.

import type { AdapterHooks, SttAdapter } from './types.ts';
import { Mic, type MicFrame } from '../audio/mic.ts';
import { WORKLIST } from '../commands.ts';

// Minimal shapes for the globals the vendored scripts define.
export interface OnlineStream {
  acceptWaveform: (sampleRate: number, samples: Float32Array) => void;
}
export interface OnlineRecognizer {
  createStream: () => OnlineStream;
  isReady: (s: OnlineStream) => boolean;
  decode: (s: OnlineStream) => void;
  isEndpoint: (s: OnlineStream) => boolean;
  getResult: (s: OnlineStream) => { text: string; tokens?: string[]; timestamps?: number[] };
  reset: (s: OnlineStream) => void;
}
type EmModule = { locateFile: (p: string, dir?: string) => string; onRuntimeInitialized?: () => void; setStatus?: (s: string) => void };
declare global {
  interface Window {
    Module?: EmModule;
    createOnlineRecognizer?: (m: EmModule, config?: unknown) => OnlineRecognizer;
  }
}

const ASSET_DIR = '/sherpa/';

// Master switch for contextual biasing. The prebuilt .data ships only encoder/decoder/
// joiner/tokens (no bpe.vocab), but the Emscripten glue exports FS_createDataFile, so we
// inject a vendored bpe.vocab into the virtual FS at runtime (tryLoadBpeVocab) — no .data
// repack. Hotwords stay OFF (default greedy recognizer) unless this is true AND a matching
// public/sherpa/bpe.vocab is present, so the app is unaffected until the vocab is vendored.
const BUNDLE_HAS_BPE_VOCAB = true;

// Move 2: bias the recognizer toward the worklist names so "open the Anderson case"
// stops decoding to "under song". Hotwords REQUIRE modified_beam_search (greedy
// ignores them) + BPE tokenization. Because passing a config REPLACES the default
// (sherpa-onnx-asr.js:675), we reconstruct the full default config and add hotwords.
// Wrapped in a fallback: if this bundle lacks the bpe vocab, recognizer construction
// throws and we revert to the default greedy recognizer (app never breaks).
function hotwordConfig(): Record<string, unknown> {
  return {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: './encoder.onnx', decoder: './decoder.onnx', joiner: './joiner.onnx' },
      paraformer: { encoder: '', decoder: '' },
      zipformer2Ctc: { model: '' }, nemoCtc: { model: '' }, toneCtc: { model: '' },
      tokens: './tokens.txt', numThreads: 1, provider: 'cpu', debug: 0, modelType: '',
      modelingUnit: 'bpe', bpeVocab: './bpe.vocab',
    },
    decodingMethod: 'modified_beam_search', // hotwords need this, not greedy_search
    // Wider beam (was 4): a hotword can only be boosted if its path is in contention.
    // 8 gives near-homophones like "Anderson" a candidate path to win on. Costs more CPU.
    maxActivePaths: 8,
    enableEndpoint: 1,
    rule1MinTrailingSilence: 2.4, rule2MinTrailingSilence: 1.2, rule3MinUtteranceLength: 20,
    // File-based hotwords (the proven path) + a strong score to actually flip near-homophones
    // like "under sun" → "Anderson". If names start hallucinating in silence/prose, lower it.
    hotwordsFile: './hotwords.txt', hotwordsScore: 4.0,
    hotwordsBuf: '', hotwordsBufSize: 0,
    ctcFstDecoderConfig: { graph: '', maxActive: 3000 },
    ruleFsts: '', ruleFars: '',
  };
}

// Mount a vendored bpe.vocab into the Emscripten virtual FS so modified_beam_search can
// tokenize the worklist-name hotwords. Returns false (→ default recognizer) if the file
// isn't vendored yet or the FS API is missing — every failure mode is non-fatal. The
// bpe.vocab MUST be generated from the SAME model packed in .data (en-2023-06-26) via
// sherpa's export_bpe_vocab.py, or transcription itself breaks (the A/B test catches that).
async function tryLoadBpeVocab(mod: EmModule): Promise<boolean> {
  try {
    const res = await fetch(ASSET_DIR + 'bpe.vocab');
    if (!res.ok) return false; // not vendored → skip hotwords, app still works
    const bytes = new Uint8Array(await res.arrayBuffer());
    const fs = (mod as unknown as { FS_createDataFile?: (parent: string, name: string, data: Uint8Array, canRead: boolean, canWrite: boolean) => void }).FS_createDataFile;
    if (typeof fs !== 'function') return false;
    fs('/', 'bpe.vocab', bytes, true, true); // hotwordConfig() reads it as './bpe.vocab'
    console.log(`[sherpa] bpe.vocab mounted into FS (${bytes.length} bytes)`);
    // Mount the hotwords as a FILE (the documented path both research reports used; the
    // in-memory hotwordsBuf engaged but had no biasing effect). One phrase per line,
    // uppercase to match the model's token casing.
    const hw = WORKLIST.map((w) => w.name.toUpperCase()).join('\n') + '\n';
    fs('/', 'hotwords.txt', new TextEncoder().encode(hw), true, true);
    console.log(`[sherpa] hotwords.txt mounted (${WORKLIST.length} names)`);
    return true;
  } catch (e) {
    console.warn('[sherpa] bpe.vocab injection failed, default recognizer:', e);
    return false;
  }
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(el);
  });
}

// Load + init the WASM runtime exactly once across the page. Exported so the bench
// harness can reuse the same recognizer for offline replay.
let runtimePromise: Promise<OnlineRecognizer> | null = null;
export function ensureRecognizer(onStatus: (s: string) => void): Promise<OnlineRecognizer> {
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    onStatus('loading sherpa runtime…');
    const mod: EmModule = {
      // Pin every Emscripten asset (.wasm/.data) to the vendored ASSET_DIR by basename.
      // (The old `|| dir + p` fallback was dead: the left operand is always a non-empty
      // string, so `||` never reached it. We intentionally ignore Emscripten's own dir
      // prefix because all assets live flat under ASSET_DIR.)
      locateFile: (p) => ASSET_DIR + p.split('/').pop()!,
      setStatus: (s) => { if (s) onStatus(s.replace('Running...', 'initializing recognizer…')); },
    };
    window.Module = mod;
    // 1) wrapper defines createOnlineRecognizer; 2) glue boots the runtime.
    await injectScript(ASSET_DIR + 'sherpa-onnx-asr.js');
    const ready = new Promise<void>((res) => { mod.onRuntimeInitialized = res; });
    await injectScript(ASSET_DIR + 'sherpa-onnx-wasm-main-asr.js');
    await ready;
    if (!window.createOnlineRecognizer) throw new Error('createOnlineRecognizer missing after load');
    onStatus('creating recognizer…');
    // Contextual biasing engages only if enabled AND a matching bpe.vocab mounts into the
    // FS. Either condition failing → default greedy recognizer (the closed-set nearest-name
    // resolver in the decoder still recovers most mistranscribed names). createOnlineRecognizer
    // is also try-wrapped so a vocab/model mismatch can't break startup.
    if (BUNDLE_HAS_BPE_VOCAB && await tryLoadBpeVocab(mod)) {
      try {
        onStatus('creating recognizer (hotwords)…');
        const rec = window.createOnlineRecognizer(window.Module, hotwordConfig());
        console.log(`[sherpa] ✅ hotwords ENABLED (modified_beam_search) — biased toward: ${WORKLIST.map((w) => w.name).join(', ')}`);
        return rec;
      } catch (e) { console.warn('[sherpa] hotword config failed, default fallback:', e); }
    }
    const rec = window.createOnlineRecognizer(window.Module);
    console.log('[sherpa] ⚪ default greedy recognizer (no hotword biasing — bpe.vocab missing or disabled)');
    return rec;
  })();
  return runtimePromise;
}

export class SherpaStreamingAdapter implements SttAdapter {
  readonly name = 'On-device · Streaming (sherpa)';
  readonly note = 'sherpa-onnx online Zipformer (WASM) — true streaming, on-device, nothing leaves the machine';

  private mic = new Mic();
  private recognizer: OnlineRecognizer | null = null;
  private stream: OnlineStream | null = null;
  private hooks: AdapterHooks | null = null;

  private active = false; // inside a non-empty segment
  private t0 = 0;
  private lastText = '';

  constructor(private readonly onStatus: (s: string) => void) {}

  async start(hooks: AdapterHooks): Promise<void> {
    // Idempotent: a second start() while live would spawn a 2nd Mic and orphan the 1st.
    // Tear down cleanly first so we always end on a single fresh session.
    if (this.stream) this.stop();
    this.hooks = hooks;
    try {
      this.recognizer = await ensureRecognizer(this.onStatus);
      this.stream = this.recognizer.createStream();
      this.resetSegment();
      await this.mic.start((f) => this.onFrame(f));
      this.onStatus('listening · streaming WASM (CPU)');
    } catch (e) {
      // mic.start() can throw AFTER createStream(), leaving a dead mic + a stale stream.
      // Release both so a retry starts from a clean slate (recognizer is page-shared, keep it).
      this.mic.stop();
      this.stream = null;
      const msg = e instanceof Error ? e.message : String(e);
      this.onStatus(`error: ${msg}`);
      hooks.onError?.(msg);
    }
  }

  stop(): void {
    this.mic.stop();
    this.resetSegment();
    if (this.recognizer) this.onStatus('ready · streaming WASM');
  }

  private resetSegment(): void {
    this.active = false;
    this.lastText = '';
    if (this.recognizer && this.stream) this.recognizer.reset(this.stream);
  }

  private onFrame(f: MicFrame): void {
    const rec = this.recognizer;
    const stream = this.stream;
    if (!rec || !stream) return;

    stream.acceptWaveform(this.mic.sampleRate, f.pcm);
    while (rec.isReady(stream)) rec.decode(stream);

    const res = rec.getResult(stream);
    const text = res.text.trim();
    const endpoint = rec.isEndpoint(stream);

    // First words of a new segment → utterance start (t0 anchors segment-relative latency).
    if (text && !this.active) {
      this.active = true;
      this.t0 = performance.now();
      this.hooks?.onUtteranceStart();
    }
    if (text && text !== this.lastText) {
      this.lastText = text;
      this.hooks?.onPartial({
        text,
        isFinal: false,
        tMs: performance.now() - this.t0,
        tokens: res.tokens,
        timestamps: res.timestamps,
      });
    }
    if (endpoint) {
      if (text) {
        console.log(`[sherpa] ◆ final: "${text}"`);
        this.hooks?.onPartial({ text, isFinal: true, tMs: performance.now() - this.t0 });
      }
      rec.reset(stream);
      this.active = false;
      this.lastText = '';
    }
  }
}
