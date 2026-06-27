// Offline transcribers for the bake-off: each takes a 16 kHz mono Float32 buffer
// and returns text. Same engines the live app uses, called in batch mode so every
// recording is scored identically across engines.

import { ensureRecognizer } from '../adapters/sherpa.ts';

export interface Engine {
  key: string;
  note: string;
  /** Lazy-load the model; returns a transcribe fn. */
  load: (onStatus: (s: string) => void) => Promise<(pcm: Float32Array) => Promise<string>>;
}

type Asr = (audio: Float32Array) => Promise<{ text: string }>;

function whisperEngine(modelId: string, key: string, dtype: 'fp32' | 'fp16' | 'q8' | 'q4' = 'fp32'): Engine {
  return {
    key,
    note: `${modelId} ${dtype} (transformers.js, WebGPU)`,
    load: async (onStatus) => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.allowLocalModels = false;
      const hasGpu = 'gpu' in navigator && (navigator as unknown as { gpu?: unknown }).gpu != null;
      onStatus(`loading ${modelId} (${dtype}, ${hasGpu ? 'webgpu' : 'wasm'})…`);
      const pipe = await pipeline('automatic-speech-recognition', modelId, {
        device: hasGpu ? 'webgpu' : 'wasm', dtype,
      });
      const asr = pipe as unknown as Asr;
      return async (pcm) => (await asr(pcm)).text.trim();
    },
  };
}

const sherpaEngine: Engine = {
  key: 'sherpa-en-20M',
  note: 'sherpa-onnx streaming Zipformer en (WASM/CPU)',
  load: async (onStatus) => {
    const rec = await ensureRecognizer(onStatus);
    return async (pcm) => {
      const stream = rec.createStream();
      stream.acceptWaveform(16000, pcm);
      stream.acceptWaveform(16000, new Float32Array(8000)); // tail padding to flush
      while (rec.isReady(stream)) rec.decode(stream);
      const text = rec.getResult(stream).text.trim();
      rec.reset(stream);
      return text;
    };
  },
};

// The bake-off roster. whisper-base/small are the "is a bigger model worth it" probes.
export const ENGINES: Engine[] = [
  sherpaEngine,
  whisperEngine('onnx-community/whisper-tiny.en', 'whisper-tiny'),
  whisperEngine('onnx-community/whisper-base.en', 'whisper-base'),
  // small at q4 — fp32 (~480 MB) hangs WebGPU compile; q4 (~120 MB) loads + still
  // far stronger than tiny/base, enough to test the "bigger model" lever.
  whisperEngine('onnx-community/whisper-small.en', 'whisper-small', 'q4'),
];
