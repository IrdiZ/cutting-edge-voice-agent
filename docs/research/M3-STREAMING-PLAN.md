> **STT pick:** sherpa-onnx streaming Zipformer transducer, built to WebAssembly from source (build-wasm-simd-asr.sh), running the csukuangfj/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17 int8 model (~44 MB). This is the only one of the four stacks that delivers genuine incremental streaming partials WITH per-token timestamps in-browser today. NEAR-STREAMING FALLBACK if the WASM build proves too costly to vendor for M3: stay on transformers.js but swap onnx-community/whisper-tiny.en for onnx-community/moonshine-base-ONNX (faster chunked drop-in, same library), VAD-segmented. NATIVE-SIDECAR path (only if browser is later abandoned): sherpa-onnx-node + sherpa-onnx-darwin-arm64, or moonshine v2 streaming via the moonshine-ai native .ort lib.

> **VAD/endpoint pick:** @ricky0123/vad-web@0.0.30 (Silero VAD v5 via onnxruntime-web/wasm) for acoustic onset/offset segmentation — pass model:'v5' (default is 'legacy'). Pair with Pipecat Smart-Turn v3.1 for SEMANTIC endpointing, run through the @huggingface/transformers already in package.json against onnx-community/smart-turn-v3-ONNX (zero new heavy deps). Note: sherpa-onnx ALSO has built-in acoustic endpointing (isEndpoint, trailing-silence rules) so vad-web's primary M3 job is clean onset detection + pre-roll; Smart-Turn handles "finished vs thinking-pause" before finalize.

---
# M3 build plan: in-browser streaming STT + VAD + semantic endpointing

## TL;DR decision

| Concern | Pick | Why |
|---|---|---|
| **Streaming STT** | **sherpa-onnx streaming Zipformer (WASM)**, model `sherpa-onnx-streaming-zipformer-en-20M-2023-02-17` int8 (~44 MB) | Only stack with **true** incremental partials + per-token **timestamps** in-browser today |
| **Acoustic VAD** | **`@ricky0123/vad-web@0.0.30`** (Silero v5) | 1 new dep, ~2 MB model, snappy onset/offset |
| **Semantic endpoint** | **Smart-Turn v3.1** via `@huggingface/transformers` + `onnx-community/smart-turn-v3-ONNX` | reuses lib already in `package.json`, ~8.7 MB int8 |
| **Near-streaming fallback** | `onnx-community/moonshine-base-ONNX` (chunked, drop-in for Whisper) | zero new deps if WASM vendoring slips |

The recommended STT is the **opposite** of the current Whisper problem: sherpa does `acceptWaveform()` + a `decode()` loop and **never re-feeds the buffer** — no growing-buffer re-transcription.

---

## Why sherpa-onnx, and why NOT the alternatives (the M3-relevant truth)

- **Moonshine does NOT solve streaming in-browser.** The only browser-runnable Moonshine is **v1** (`onnx-community/moonshine-*-ONNX`, `MoonshineForConditionalGeneration`, transformers.js [PR #1099](https://github.com/huggingface/transformers.js/pull/1099)) — a `generate()`-based chunked enc-dec, the same *shape* as today's Whisper adapter. The **v2 "ergodic streaming encoder"** ([arXiv:2602.12241](https://arxiv.org/abs/2602.12241)) that actually streams is **PyTorch-safetensors-only** ([UsefulSensors/moonshine-streaming-tiny](https://huggingface.co/UsefulSensors/moonshine-streaming-tiny/tree/main) is 176 MB `.safetensors`, zero `.onnx`); no `onnx-community/moonshine-streaming-*` repo, no `MoonshineStreaming` class in transformers.js, and sherpa-onnx supports only the *old* v1 Moonshine ([k2-fsa/sherpa-onnx#3231](https://github.com/k2-fsa/sherpa-onnx/issues/3231)). No word timestamps on this path either.
- **transformers.js Whisper "streaming" is chunked-rebranded.** `_call_whisper` slices audio into overlapping windows and re-runs `generate()` per window ("NOTE: doing sequentially for now"), no encoder-state carry / KV reuse / stable-prefix guarantee. `TextStreamer`/`WhisperTextStreamer` stream tokens *within one decode* — perceived snappier, but the redundant compute and unstable partials (and shifting word timestamps) remain. See the [canonical realtime-whisper-webgpu demo](https://huggingface.co/spaces/Xenova/realtime-whisper-webgpu) (sliding window, `max_new_tokens:64`) and the known [no-persistent-transcript limitation](https://github.com/xenova/transformers.js/issues/802).
- **sherpa-onnx streaming Zipformer is genuinely online/causal.** Result JSON exposes `text, tokens[], timestamps[]` (float seconds), `is_final` — verified in [c-api.h `GetOnlineStreamResultAsJson`](https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/c-api/c-api.h). I independently confirmed the [WASM build script](https://github.com/k2-fsa/sherpa-onnx/blob/master/build-wasm-simd-asr.sh) (`-DSHERPA_ONNX_ENABLE_WASM_ASR=ON`, outputs to `install/bin/wasm/asr`) and the [en-20M model files](https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17/tree/main) (encoder int8 42.8 MB / decoder 539 KB / joiner 260 KB / `tokens.txt` 5.05 KB) are live. Matches the team's own `research/WEB-VERIFICATION.md` (A3-sherpa: RTF 0.062–0.077 @2 threads, real-time on a Pi 4 → trivially real-time on the M5 Pro).

**Footprint trade-off that is actually a win:** sherpa is **CPU/WASM/SIMD only — no WebGPU path** (confirmed: `provider:'cpu'`, no `webgpu` in the wrapper). So it does **not** contend with the WebGPU lane the M2 Whisper/any LLM uses — it runs on 1-2 CPU cores in parallel with the GPU. Budget the cores; keep it off the main thread.

---

## Integration against the existing `OnDeviceAdapter`

The seam is already clean. `src/adapters/types.ts` defines `SttAdapter { start(hooks), stop() }` with `AdapterHooks { onUtteranceStart, onPartial({text,isFinal,tMs}), onError }`. `pipeline.ts` `feed(Partial)` already fires navigation/dictation commands on the first matching partial and gates destructive ones behind confirm. **None of pipeline/cockpit/HUD changes.**

Two adapter-shape gaps to close for M3:
1. **Add timestamps to `Partial`.** The brief's fire-on-partial command path wants timestamps. Extend the interface:
   ```ts
   export interface Partial { text: string; isFinal: boolean; tMs: number; tokens?: string[]; timestamps?: number[]; }
   ```
   sherpa fills `tokens`/`timestamps` directly from `getResult()`; the chunked fallbacks leave them undefined.
2. **Move off the main thread.** `audio/mic.ts` uses a deprecated `ScriptProcessorNode` and a coarse RMS VAD. M3 should move to an **AudioWorklet** feeding 16 kHz mono Float32 frames, and run STT + VAD in a **Web Worker**. (Files: `src/audio/mic.ts`, new `src/adapters/sherpa.ts`, new worklet + worker.)

### Build + vendor steps (the real integration cost — moderate, NOT npm install)

1. **Build the WASM bundle** (one-time, off your dev box or CI): clone `k2-fsa/sherpa-onnx`, download the en-20M int8 model, rename to `encoder.onnx/decoder.onnx/joiner.onnx` + `tokens.txt`, run `build-wasm-simd-asr.sh`. Output: `sherpa-onnx-wasm-asr-main.js`, `.wasm`, `.data` (+ portable `sherpa-onnx-asr.js`). Start **single-thread SIMD** to avoid the `SharedArrayBuffer` / COOP+COEP header requirement; switch to pthreads later only if you need the speed.
2. **Vendor as Vite static assets** (`public/sherpa/…`). The `.data` is the Emscripten-packed model. (No npm package exists for the browser: `sherpa-onnx`/`sherpa-onnx-node` on npm are **Node-only**, `sherpa-onnx-wasm`/`-asr` 404.)
3. **`src/adapters/sherpa.ts`** implementing `SttAdapter`:
   ```ts
   // after Module ready (from sherpa-onnx-wasm-asr-main.js)
   const rec = createOnlineRecognizer(Module, {
     featConfig: { sampleRate: 16000, featureDim: 80 },
     modelConfig: { transducer: { encoder:'./encoder.onnx', decoder:'./decoder.onnx', joiner:'./joiner.onnx' },
                    tokens:'./tokens.txt', provider:'cpu', numThreads:1, modelType:'zipformer2' },
     enableEndpoint: 1, rule2MinTrailingSilence: 0.8, rule3MinUtteranceLength: 20, // tighten for command latency
   });
   const stream = rec.createStream();
   function onAudioFrame(samples: Float32Array) {        // from AudioWorklet, 16k mono
     stream.acceptWaveform(16000, samples);
     while (rec.isReady(stream)) rec.decode(stream);
     const r = rec.getResult(stream);                    // { text, tokens[], timestamps[], is_final }
     if (r.text) hooks.onPartial({ text:r.text, isFinal:false, tMs:now(), tokens:r.tokens, timestamps:r.timestamps });
     if (rec.isEndpoint(stream)) { hooks.onPartial({ text:r.text, isFinal:true, tMs:now() }); rec.reset(stream); }
   }
   ```
   Map: `start()` = createStream + start mic/worklet; `stop()` = inputFinished + tear down. `isEndpoint` drives the `isFinal:true` partial that `pipeline.feed` already finalizes on.

### VAD + endpointing wiring (orthogonal, drop-in, 1 new dep)

```
vad-web onSpeechStart  ->  hooks.onUtteranceStart()  + ensure sherpa stream is live (pre-roll via preSpeechPadMs)
sherpa partials        ->  hooks.onPartial(...)        <- fire-on-partial command path (with timestamps)
vad-web onSpeechEnd(audio Float32@16k) -> Smart-Turn(audio): prob>=0.5 ? finalize : keep listening
```
- `@ricky0123/vad-web@0.0.30`: **pass `model:'v5'`** (default is `'legacy'`); knobs are ms-based (`redemptionMs ~300`, `minSpeechMs`, `preSpeechPadMs ~300`). Imports `onnxruntime-web/wasm`. **Vite gotcha:** copy `silero_vad_v5.onnx`, `vad.worklet.bundle.min.js`, AND ort's `.wasm` **and `.mjs`** files to served paths; set `baseAssetPath`/`onnxWASMBasePath` (missing `.mjs` = silent init fail).
- **Smart-Turn v3.1** via `@huggingface/transformers` + `onnx-community/smart-turn-v3-ONNX` (no new heavy dep). It takes a **log-mel** `input_features` (the `AutoProcessor`/`pipeline('voice-activity-detection', …)` computes it — do NOT hand-roll FFT, and do NOT hardcode the mel shape: v3 uses **128-bin / 8 s** features, not Whisper-tiny's 80-bin/30 s; let the processor resolve `preprocessor_config.json`). Output is a sigmoid prob, threshold 0.5. Verify the output tensor name via `session.outputNames`/Netron before pinning a dtype (use the `pipeline()` form, which resolves variant names — `q8` is not a real file; it's `model_int8.onnx`).
- **Division of labor:** sherpa's built-in `isEndpoint` (acoustic trailing-silence) gives cheap fast turn cuts; Smart-Turn answers "finished vs paused to think" so you don't finalize on a thinking pause. The **endpoint latency floor is the VAD `redemptionMs` (~300 ms)**, not Smart-Turn compute.

---

## Fallback + native-sidecar path (honest)

- **Near-streaming fallback (if WASM vendoring slips for M3):** keep transformers.js, swap `MODEL_ID` in `ondevice.ts` from `onnx-community/whisper-tiny.en` to **`onnx-community/moonshine-base-ONNX`** (encoder fp32 / decoder q4 on WebGPU, ~150 MB; the [official moonshine-web demo](https://github.com/huggingface/transformers.js-examples/blob/main/moonshine-web/src/worker.js) pattern, VAD-segmented), add a `TextStreamer` + cap `max_new_tokens` + cap the window. This is **faster** and lower-latency per VAD segment, but it is **still chunked** — it does not give stable streaming partials or timestamps. It is a stopgap, not the M3 engine.
- **Native-sidecar path (only if the browser constraint is later dropped):** `sherpa-onnx-node@1.13.2` + `sherpa-onnx-darwin-arm64` (native node-addon, Apple Silicon) runs the same streaming Zipformer off-WASM; or the **moonshine v2** streaming encoder via the `moonshine-ai` native `.ort` lib (macOS/iOS/etc.). Both forfeit "no native install."

---

## Honest risks

1. **No drop-in package — you build + vendor WASM.** Real moderate cost; treat the `.js/.wasm/.data` as static assets in `public/`.
2. **CPU cores, not GPU.** Run STT in a Worker + AudioWorklet; budget 1-2 cores. Single-thread SIMD first to dodge COOP/COEP; pthreads needs `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`.
3. **All WER/latency numbers are vendor/clean-audio.** The `bench/` harness must validate the en-20M model on **real radiology dictation** on the M5 Pro (p50/p95, decomposed by stage). RTF is throughput, not turn latency — turn latency is dominated by chunk look-ahead (~320 ms) + endpoint silence.
4. **English-only model.** en-20M is English; if multilingual is ever needed, the larger en model (`-2023-06-26`, ~73 MB int8) is still English — multilingual streaming Zipformers exist but are larger and need re-bench.
5. **Smart-Turn mel-shape mismatch is a known foot-gun** (use the processor, don't hardcode), and the HF demo Space cited elsewhere as "live proof" is auth-gated — rely on the build scripts + shipped streaming-API source + real model files (all verified here), not the Space.

## Relevant files
- `prototype/src/adapters/types.ts` (extend `Partial` with `tokens`/`timestamps`)
- `prototype/src/adapters/ondevice.ts` (fallback model swap lives here; or keep as the chunked lane)
- `prototype/src/audio/mic.ts` (ScriptProcessor -> AudioWorklet for M3)
- `prototype/src/pipeline.ts` (unchanged — already fire-on-partial + confirm-gated)
- new: `prototype/src/adapters/sherpa.ts` + worker + worklet; vendored WASM under `public/sherpa/`
- `research/WEB-VERIFICATION.md` (A3-sherpa, A3-moonshine, A9-voxtral, C1-smartturn corroborate)
