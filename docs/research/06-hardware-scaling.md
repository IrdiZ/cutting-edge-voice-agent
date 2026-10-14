# 06 — Hardware Scaling: Bottom-Up "Golden Medium" Study

**Scope.** Lowest-latency *voice-to-command* for dictation-heavy reporting: always-on continuous
listening, Next.js frontend, cloud allowed under BAA. This stream maps the
**latency-vs-hardware curve** from the cheapest possible client upward, and finds the
inflection point where adding hardware stops buying meaningful latency.

**Key framing — measure "mouth-to-command," not "mouth-to-ear."**
Most published voice-agent latency numbers (~1.0–1.7 s) are full conversational pipelines
that include an LLM turn **and** a TTS reply. A radiology command system does **not** need
TTS in the hot path. The latency that matters here is:

```
mouth-to-command = VAD endpoint + STT (streaming partial) + intent match (embeddings/regex/small-LLM)
```

For a fixed command vocabulary ("new paragraph", "go to findings", "delete that",
"insert measurement"), STT can emit a usable **partial** before you stop speaking, and
intent matching against a known command set is an embedding/keyword lookup (sub-ms to a
few ms), **not** an autoregressive LLM generation. That single architectural choice is
what makes sub-100 ms perceived latency achievable on cheap hardware — the expensive LLM
generation only happens for free-text dictation or ambiguous/compound commands, where a
few hundred ms is tolerable.

---

## Tier Table

"Mouth-to-command" = time from the operative word leaving the user's mouth to the
command being recognized and dispatched, for a **common short command** matched against a
known vocabulary. Numbers are realistic mid-range estimates, not vendor best-case.

| Tier | Hardware | What runs LOCAL | What runs CLOUD | Mouth-to-command (common cmd) | Marginal gain vs tier below | Approx cost |
|------|----------|-----------------|-----------------|-------------------------------|------------------------------|-------------|
| **0** | Thin client, any browser, no accelerator | Mic capture, WebSocket framing only | STT (Deepgram Nova-3/Flux), embeddings, LLM | **~250–500 ms** typical; ~150–300 ms best-case in-region; 2–4× worse on poor last-mile | (baseline) | ~$0.0077–0.013/min STT; near-zero client |
| **1** | Modern CPU workstation, **no GPU** (typical hospital PC, Ryzen/i7) | Silero VAD (<1 ms/chunk), Moonshine Tiny streaming STT, static/MiniLM embeddings | Optional: LLM only for free-text dictation | **~80–150 ms** | Removes 50–300 ms network leg per hop; STT partial in ~35–70 ms on x86 | ~$0 marginal (existing PC) |
| **2** | Apple Silicon / integrated NPU (M-series, ANE; or browser **WebGPU**) | VAD + Parakeet-on-ANE (FluidAudio) or whisper.cpp+CoreML; embeddings | Optional LLM | **~60–110 ms** | STT encoder 3–6× faster than CPU; ~66 MB RAM on ANE; frees CPU | ~$0 marginal (Macs/iPads already deployed); WebGPU = $0 install |
| **3** | Single consumer GPU (RTX 4060/4070/4090) or shared inference box | faster-whisper/Parakeet streaming STT, embeddings, **+ local small LLM** (Qwen-3B/Llama-8B) | Nothing required | **~50–90 ms** for command; **+TTFT <200 ms** when a local LLM is invoked for dictation/compound | STT per-chunk drops to ~15–22 ms; LLM TTFT goes from seconds (CPU) to <200 ms | ~$300–1,600 GPU one-time; or shared box amortized |

---

## Tier detail with concrete numbers

### Tier 0 — Pure cloud, thin client
- **Deepgram Nova-3 streaming:** time-to-first-token ~**150 ms (US in-region)**, 250–350 ms
  global; sub-300 ms streaming latency; RTF 0.2–0.3×. **Flux** model targets even lower
  latency for voice-agent endpointing.
- **Network is the floor.** Network alone adds **100–600 ms** depending on last-mile and
  datacenter distance; each one-way hop ~50–300 ms. Browser→WebSocket of 16 kHz mono PCM
  is the standard transport; WebRTC (LiveKit-style) keeps the client↔server leg small.
- **Reality check:** vendors' "<300 ms" excludes network/VAD/chunking/finalization;
  real-world is **2–4× higher**. Best-case in-region with interim results and a same-cloud
  deployment ≈ **150–300 ms**; typical ≈ **250–500 ms**.
- **Verdict:** acceptable, simplest to ship, BAA-friendly with Deepgram/AssemblyAI. But the
  network leg is irreducible and jittery — you cannot guarantee sub-100 ms perceived latency.

### Tier 1 — Modern CPU only (no GPU)  ← the big step-change
- **Silero VAD:** <**1 ms** per 30 ms chunk single-thread (ONNX V5 ≈ **189 µs/chunk**,
  RTF ≈ 0.004). Endpointing is essentially free.
- **Moonshine Tiny (streaming), CPU-only:** **34 ms** on MacBook Pro, **69 ms** on Linux
  x86, 237 ms on Raspberry Pi 5, at 12.0% WER (34 M params). Crucially Moonshine's cost
  **scales with audio length** — no Whisper-style 30 s padding floor.
- **Contrast:** Whisper Tiny on the same x86 = **1,141 ms** (and a firm ~500 ms lower bound
  on ARM regardless of clip length). faster-whisper (CTranslate2) is far better than vanilla
  Whisper on CPU but still trails Moonshine for short live commands.
- **Intent matching:** static embeddings via **Model2Vec** (potion-base) ≈ **sub-ms per
  utterance** (~25,000 sentences/s, ~100–400× faster than MiniLM, ~90% accuracy). ONNX
  MiniLM ≈ single-digit-to-tens of ms if you want full quality.
- **End-to-end common command:** VAD (~1 ms) + Moonshine partial (~35–70 ms) + static
  embedding match (~1 ms) ≈ **~80–150 ms**, fully local, no network, no per-minute fee.
- **This is the inflection point.** Going from Tier 0 to Tier 1 removes the entire network
  leg (50–300+ ms of jittery, uncontrollable delay) and is the single largest latency win
  in the whole curve — on hardware the hospital already owns.

### Tier 2 — Apple Silicon / integrated NPU / WebGPU
- **whisper.cpp + CoreML:** encoder on the **ANE** is >**3× faster** than CPU-only
  (e.g., encoder 1030 ms → 174 ms for small model); ANE working set ~**66 MB** vs ~2 GB on
  MLX/GPU.
- **Parakeet-on-ANE (FluidAudio):** fastest on M-series in head-to-head
  (`mac-whisper-speedtest`): large-class per-run ≈ **0.19 s** vs Parakeet-MLX 0.50 s,
  mlx-whisper 1.02 s, whisper.cpp+CoreML 1.23 s. Parakeet TDT 0.6B = 1.69% WER on
  LibriSpeech clean. **WhisperKit** (ANE-native) leads on *streaming* latency with 99-language support.
- **WebGPU in-browser (Transformers.js v3 + ONNX Runtime Web):** Whisper-base / **Moonshine
  Web** run entirely client-side, GPU-accelerated, **offline, zero install, data never
  leaves the device** — attractive for BAA/PHI. Caveat: WebGPU vs WASM can differ **10–15×**;
  WebGPU only wins once compute dominates the CPU↔GPU transfer (large enough model); run
  inference in a Web Worker; Chrome ~4 GB/tab VRAM cap; 200–600 MB model download once.
- **End-to-end common command:** ~**60–110 ms**. Gain over Tier 1 is real but **incremental**
  (STT encoder 3–6× faster, lower CPU contention), not a step-change.

### Tier 3 — Single consumer GPU / shared inference box
- **faster-whisper INT8 on RTX 4090:** a **3 s chunk in <15 ms**; ~25–30× real-time;
  Large-v3-Turbo per-chunk ~**22 ms** (vs ~40 ms Large-v3). **Parakeet TDT** (non-autoregressive,
  single forward pass) hits RTFx >2,000 — built for streaming.
- **Local small LLM (only needed for free-text dictation / compound commands):**
  RTX 4090 **TTFT <200 ms**; Llama-3.1-8B Q4 ≈ 95–110 tok/s, Qwen-3B faster; RTX 4070 ≈
  68 tok/s for 8B; vLLM batches to 3,000+ tok/s for multi-user. **CPU contrast: TTFT is
  seconds** (6.9–12.9 s first token on weak CPUs; 8–25 tok/s generation) — *this* is where a
  GPU genuinely pays off.
- **End-to-end common command:** ~**50–90 ms**. Gain over Tier 2 for *command* recognition
  is small/negligible — STT is already near-instant. The GPU's real value is unlocking a
  **local LLM with sub-200 ms TTFT** for the dictation/NLU path, keeping PHI on-prem and
  removing the cloud LLM round-trip.
- **When a GPU pays off:** only if you (a) need local free-text dictation/correction or
  compound-command NLU under BAA without cloud, or (b) consolidate many users onto a
  shared inference box. For pure command recognition it does **not** beat Tier 1/2 enough to justify.

---

## The Golden Medium

**Pick: Tier 1 (modern CPU, no GPU) for the command hot path, with Tier 2 (Apple Silicon /
ANE or in-browser WebGPU) where the device already has it — and a single shared Tier 3 GPU
box ONLY for the local-LLM dictation/NLU path.**

**Latency it achieves:** ~**80–150 ms** mouth-to-command on a plain CPU workstation
(Silero VAD + Moonshine Tiny streaming + Model2Vec intent match), dropping to ~**60–110 ms**
on Apple Silicon/ANE or WebGPU. Both are at or under the **sub-100 ms perceived-latency**
target for common commands once you exploit streaming partials (the command fires before
the user finishes the phrase, so *perceived* latency is effectively zero).

**Justification:**
1. **The step-change is Tier 0 → Tier 1, not anywhere higher.** Moving STT/VAD/intent on-device
   deletes the 50–300+ ms jittery network leg that dominates and *cannot be controlled* in the
   cloud. That is the single biggest, cheapest win, on hardware already on the user's desk.
2. **Tier 1 → Tier 2 is incremental** (3–6× faster STT encoder, lower CPU load). Take it for
   free where Macs/iPads/WebGPU browsers exist, but don't *buy* hardware for it.
3. **Tier 2 → Tier 3 buys almost nothing for command recognition** — STT is already ~tens of ms.
   The GPU's only decisive advantage is **local LLM TTFT <200 ms** vs **seconds on CPU**, which
   matters solely for the free-text dictation / ambiguous-command path. So put the LLM on **one
   shared GPU box** (or keep that path in cloud under BAA), not a GPU per workstation.

**Inflection point where hardware stops mattering:** at Tier 1/Tier 2 for the command path.
Beyond a modern CPU (and an NPU if free), additional hardware does not move *command*
latency below human perception. The only thing that still scales with GPU is the
**generative dictation/NLU** path, and that is a separate, latency-tolerant lane.

**Recommended split architecture:**
- **Hot path (command):** on-device — Silero VAD → Moonshine streaming (CPU, or
  Parakeet/WhisperKit on ANE, or Moonshine-Web via WebGPU) → Model2Vec/MiniLM intent match.
  Sub-100 ms perceived, $0 marginal, PHI never leaves the device.
- **Cold path (free-text dictation, correction, compound NLU):** cloud STT/LLM under BAA, or a
  single shared RTX 4070/4090 box (TTFT <200 ms). Latency tolerance here is hundreds of ms.

---

## Deeper research paths / open questions
- **Streaming partial stability for clinical terms.** Moonshine/Parakeet WER on radiology
  vocabulary (anatomy, contrast agents, measurements) vs general English — partials may
  flicker on domain terms. Needs a custom test set and possibly a biased/boosted vocabulary.
- **Endpoint vs per-chunk latency.** Silero per-chunk is <1 ms, but speech→silence
  *endpointing* can lag several hundred ms. For always-on listening, evaluate Deepgram Flux
  / TEN-VAD / semantic endpointing to cut the turn-detection tail.
- **WebGPU production maturity (Next.js).** Safari support still experimental; Chrome ~4 GB/tab
  VRAM cap; WASM-vs-WebGPU crossover point for *tiny* models (transfer overhead may make WASM
  faster for Moonshine Tiny). Benchmark Moonshine-Web on target hospital hardware/browsers.
- **Always-on cost/thermals.** Continuous CPU STT on shared hospital PCs — CPU%, battery
  (laptops/tablets), and contention with PACS/viewer software. ANE path (~66 MB, low power)
  may be decisive on portable devices.
- **Shared GPU box sizing.** How many concurrent users per RTX 4090 with vLLM
  continuous batching before TTFT degrades past 200 ms; 4070 (12 GB) vs 4090 (24 GB) headroom
  for Large-v3 + small LLM co-resident.
- **WebRTC vs raw WebSocket** for the cloud fallback leg — measured added RTT on the hospital network.

---

## Sources
- Deepgram — Measuring Streaming Latency: https://developers.deepgram.com/docs/measuring-streaming-latency
- Deepgram — Reducing Latency in STT APIs: https://deepgram.com/learn/understanding-and-reducing-latency-in-speech-to-text-apis
- Deepgram — Interim Results: https://developers.deepgram.com/docs/using-interim-results
- Introl — Voice AI Infrastructure 2025 (Nova-3 metrics): https://introl.com/blog/voice-ai-infrastructure-real-time-speech-agents-asr-tts-guide-2025
- Moonshine paper (arXiv 2410.15608): https://arxiv.org/pdf/2410.15608
- Flavors of Moonshine (arXiv 2509.02523): https://arxiv.org/html/2509.02523v1
- MarkTechPost — Moonshine overview: https://www.marktechpost.com/2024/10/23/moonshine-a-fast-accurate-and-lightweight-speech-to-text-models-for-transcription-and-voice-command-processing-on-edge-devices/
- Moonshine vs faster-whisper-tiny comparison (GitHub): https://github.com/chrisputzu/comparison-moonshine-vs-faster-whisper-tiny-en
- onResonant — Local STT 2026 (Moonshine/Parakeet/Whisper): https://www.onresonant.com/resources/local-stt-models-2026
- whisper.cpp CoreML/ANE discussion #548: https://github.com/ggml-org/whisper.cpp/discussions/548
- whisper.cpp repo: https://github.com/ggml-org/whisper.cpp
- mac-whisper-speedtest (ANE/MLX/CoreML head-to-head): https://github.com/anvanvan/mac-whisper-speedtest
- WhisperKit (arXiv 2507.10860): https://arxiv.org/html/2507.10860v1
- parakeet-mlx (Simon Willison): https://simonwillison.net/2025/Nov/14/parakeet-mlx/
- MacParakeet — Whisper to Parakeet on Neural Engine: https://macparakeet.com/blog/whisper-to-parakeet-neural-engine/
- Spheron — Whisper/Parakeet GPU production guide 2026 (RTX 4090 chunk times): https://www.spheron.network/blog/whisper-v4-asr-gpu-cloud-production-guide/
- Northflank — Best open-source STT 2026 benchmarks: https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks
- Databasemart — RTX 4090 vLLM benchmark (<200 ms TTFT, 3B/8B): https://www.databasemart.com/blog/vllm-gpu-benchmark-rtx4090
- Studio Meyer — Local LLMs 2026 (8B tok/s, CPU vs GPU): https://studiomeyer.io/en/blog/local-llms-2026
- Silero VAD repo (per-chunk µs, RTF): https://github.com/snakers4/silero-vad
- Silero VAD FAQ: https://github.com/snakers4/silero-vad/wiki/FAQ
- Model2Vec repo (500× faster static embeddings): https://github.com/MinishLab/model2vec
- HF — Static embeddings blog: https://huggingface.co/blog/static-embeddings
- Sentence Transformers — efficiency / ONNX: https://sbert.net/docs/sentence_transformer/usage/efficiency.html
- Transformers.js v3 (WebGPU): https://huggingface.co/blog/transformersjs-v3
- SitePoint — WebGPU vs WASM browser inference: https://www.sitepoint.com/webgpu-vs-webasm-transformers-js/
- Whisper WebGPU overview (Medium): https://senoritadeveloper.medium.com/whisper-webgpu-2b1cadfab897
- Twilio — Core latency in voice AI (component breakdown): https://www.twilio.com/en-us/blog/developers/best-practices/guide-core-latency-ai-voice-agents
- LiveKit — Understand & improve agent latency: https://livekit.com/blog/understand-and-improve-agent-latency
- Picovoice — STT latency: https://picovoice.ai/blog/speech-to-text-latency/
- AssemblyAI — Best real-time STT APIs 2026: https://www.assemblyai.com/blog/best-api-models-for-real-time-speech-recognition-and-transcription
