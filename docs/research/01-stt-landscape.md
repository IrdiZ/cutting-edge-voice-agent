# Streaming STT Landscape & Latency Benchmarks — Radiology Reporting Voice-to-Command

**Scope:** Always-on continuous listening, lowest-possible latency, cloud STT under signed HIPAA BAA allowed.
**Goal:** common commands resolve well under 100 ms (perceived); STT partials stream fast.
**Date of research:** May 2026. Prioritized 2024–2026 data.

> **Latency vocabulary used here (terms get conflated by vendors):**
> - **TTFP / time-to-first-partial** — delay from a word being spoken to the first interim/partial result for it. This is what matters for "claim a command mid-utterance."
> - **Partial cadence** — how often interim results refresh while you keep talking.
> - **Finalization / EOT latency** — delay from end-of-speech to the `is_final` / turn-complete result. Dominated by endpointing/VAD silence thresholds, NOT model speed. Tunable.
> - **RTFx / RTF** — batch throughput (audio-seconds processed per wall-second). A throughput metric, *not* a streaming UX metric. High RTFx ≠ low streaming latency.
> - AssemblyAI explicitly warns TTFT can be gamed (providers emit tokens before audio to win benchmarks). Treat single-vendor TTFT numbers skeptically; prefer P50 latency after VAD and independent benches (Coval, Pipecat TTFS, HF Open ASR Leaderboard).

---

## Comparison Table

### Cloud streaming STT

| Provider / model | TTFP / partial latency | Partial cadence | Finalization (EOT) | Protocol | Medical model | WER (English / medical) | BAA / HIPAA | Streaming price |
|---|---|---|---|---|---|---|---|---|
| **Deepgram Nova-3 / Nova-3 Medical** | interim ~150 ms | continuous interims | endpointing default 10 ms (tunable; 300 ms typical) | WebSocket | **Yes — Nova-3 Medical (streaming, 2025)** | 6.84% median WER streaming, 5.26% batch; Medical claims 63.7% rel. WER improvement + keyterm prompting (100 terms) | **Yes, BAA on Enterprise tier** | $0.0077/min stream ($0.462/hr) |
| **Deepgram Flux** (conversational) | Nova-3-level partials | continuous + eager-response events | **model-integrated EOT ~260–300 ms median, p95 ~1.5 s** (no separate VAD) | WebSocket | Nova-3-level accuracy | Nova-3 class | Yes (same as above) | ~Nova-3 class |
| **AssemblyAI Universal-Streaming / Universal-3 Pro** | ~300 ms P50 (US); **U-3 Pro ~150 ms P50 after VAD** | continuous, immutable+ partials | intelligent endpointing | WebSocket | "Medical Mode" (claims 4.97% missed-entity rate) | **6.3% mean WER (U-3 Pro), lowest among majors in indep. bench** | Yes (HIPAA, BAA available) | ~$0.15–0.47/hr range |
| **OpenAI Realtime API** (gpt-realtime-whisper) | **~200–400 ms** partial (live audio) | deltas; tunable minimal→xhigh latency/accuracy | session/VAD driven | **WebRTC / WebSocket** | None dedicated | gpt-4o-transcribe 4.1% LibriSpeech-clean (OpenAI-reported) | OpenAI: limited; **Azure OpenAI Realtime BAA status unclear late-2025** | usage-based |
| **OpenAI file gpt-4o-transcribe (streaming)** | **500–1500 ms to first chunk** (1–2 s observed) | chunked HTTP | n/a | HTTP chunked | None | 4.1% WER | see above | $0.006/min |
| **Google Cloud STT / Chirp 3** | **~300–600 ms** (can hit 500 ms–1 s) | StreamingRecognize results | tunable `ENDPOINTING_SENSITIVITY` (SUPERSHORT for 1-word cmds) | **gRPC** (no native WebSocket); SIPREC for telephony | Custom vocab adaptation + denoiser (no dedicated medical model) | SOTA multilingual; no public medical WER | **Yes (GCP BAA)** | streaming tier pricing |
| **Speechmatics** | floor ~0.25–0.5 s; `max_delay` 0.7–1.5 s for agents | configurable via `max_delay` | `max_delay` controls it; flexible vs fixed entity mode | WebSocket | No dedicated medical | batch-parity at 10 s; ~9% WER (competitor-reported, biased) | Yes; strong **on-prem / data residency** | enterprise |
| **Azure Speech (Speech-to-Text)** | variable cloud (~200–500 ms typ.) | continuous | `stable_partial_threshold` tunable | WebSocket / SDK | Custom clinical model training; Nuance Dragon being sunset → Azure | custom-trainable | **Yes (Microsoft BAA via DPA)**; disconnected containers for on-prem | $0.0167/min stream (batch $0.006) |
| **Soniox** | **sub-200 ms streaming** | starts after first few words | model EOT detection | WebSocket | Healthcare-positioned; audio stays in memory | 6.5% EN WER (vendor-reported, batch bench) | **HIPAA + SOC2 T2 + ISO27001**; confirm BAA w/ sales | usage-based |

### On-device / edge STT

| Engine / model | Latency (end-of-utterance → text, or RTF) | Streaming? | WER | Best hardware | Notes |
|---|---|---|---|---|---|
| **NVIDIA parakeet_realtime_eou_120m-v1** (2025/26) | **80–160 ms**, emits `<EOU>` token (joint ASR+EOU, no separate VAD) | **Yes, native RNNT streaming** | EN only, no punct/caps | NVIDIA GPU; **CoreML port for Apple Silicon**, ONNX edge port | **Best fit for the command path.** Caveat: latency measured on clean TTS audio |
| **NVIDIA FastConformer streaming-multi (114M)** | look-ahead 0 / 80 / 480 / 1040 ms (avg = half); chunks 80/160/540/1120 ms | **Yes, cache-aware** | low | NVIDIA GPU | Switch latency at inference via `att_context_size` `[70,0/1/16/33]` |
| **NVIDIA Parakeet TDT 0.6B v2** | **RTFx ~3380** (batch; 1 hr audio in ~1 s on GPU) | offline/full-attention (not streaming) | **6.05% WER, #1 HF Open ASR Leaderboard** | A100/H100/T4/V100 | Batch champion; use TDT-v3/Canary-1B-v2 for multilingual |
| **Moonshine v2 (Tiny/Small/Medium)** | **Tiny 50 ms, Small 148 ms, Medium 258 ms** (utterance-end→text on M3 MacBook) | **Yes** (variable-length encoder, ergodic streaming) | Tiny ~12.8% avg (≈Whisper Tiny); larger far better | Apple Silicon / CPU / embedded | 5.8×–43.7× faster than equivalent Whisper. Strong edge command engine |
| **whisper.cpp (CoreML/Metal)** | large-v3 ~10× real-time on M5 Pro; turbo ~1.2 s/clip M-series | chunked (not true streaming) | Whisper-class | Apple Silicon (ANE/Metal), RPi→CUDA | No Python/CUDA needed; <2 GB RAM. Best embedded Whisper |
| **faster-whisper (CTranslate2)** | ~3× real-time large-v3 on Mac (**CPU only, no Metal**) | chunked | Whisper-class | NVIDIA GPU (great); Mac=CPU only | Mac handicapped vs whisper.cpp |
| **distil-whisper (distil-large-v3)** | ~6× faster than large-v3, WER within ~1% | chunked | ≈large-v3 −1% | GPU/Metal runtime | **English-only**. Latency-critical recommended pick among Whisper |
| **transformers.js / whisper-web (WebGPU/WASM)** | 30-s chunks w/ 5-s overlap; near-native via WebGPU (Chrome 113+) | pseudo-chunked | Whisper-base 73M class | Browser GPU, WASM fallback | Fully in-browser, offline, private. Not low-latency streaming by default |
| **Web Speech API (browser)** | varies; Chrome routes audio to Google servers | "streaming" but cloud | Google backend | any browser | **NOT on-device, NOT HIPAA** — audio leaves to vendor. Avoid for PHI |
| **sherpa-onnx streaming Zipformer** | **~160 ms on mobile**; real-time on Cortex-A7 | **Yes, true streaming transducer** | model-dependent (good) | CPU/mobile/embedded, 12 langs, WebSocket | 60–80 MB models; runs everywhere offline. Strong on-device streaming option |
| **Vosk / Kaldi** | real-time on CPU | yes (Kaldi/Vosk streaming) | older-gen, higher WER | CPU/embedded | Mature but accuracy behind Zipformer/Parakeet |

---

## Per-option notes (the load-bearing details)

### Cloud

**Deepgram Nova-3 Medical (streaming) — top cloud pick for radiology.**
- Only major with a **dedicated streaming medical model** (released 2025). Built for clinical: HIPAA-architecture, scribe/ambient/telehealth targeting.
- Interim results land within **~150 ms** of speech (`is_final:false`); endpointing default is 10 ms of silence but **tunable** — measure latency on interims only (finals are inflated by EOT waiting).
- **Keyterm Prompting**: up to 100 custom terms (cardiology/neuro/onco vocab) — ideal to bias toward radiology lexicon and command keywords ("measure", "next series", "compare prior").
- WER: 6.84% median streaming / 5.26% batch general; Medical claims 63.7% relative WER + 40.35% keyterm-error improvement over next best (vendor-relative numbers).
- BAA: **Enterprise tier only**, contact sales. $0.0077/min streaming PAYG; on-prem/self-host available (Deepgram cites on-prem <100 ms targets).

**Deepgram Flux — best if you want the model to do turn detection too.**
- World's first "conversational speech recognition": **fuses ASR + end-of-turn into one model**, eliminating separate VAD. Median EOT **~260–300 ms**, p95 ~1.5 s, `eot_threshold` tunable (default 0.7). Emits eager-response events *before* turn completes — directly useful for "claim a command mid-utterance." Nova-3-level accuracy.

**AssemblyAI Universal-3 Pro Streaming.**
- **~150 ms P50 latency after VAD endpointing**, **6.3% mean WER** (lowest among majors in independent benchmarks per AssemblyAI). WebSocket. Has a "Medical Mode" (claims 4.97% missed-entity rate vs 7.32% for Deepgram Nova-3 Medical — competitor-sourced, treat with caution). HIPAA/BAA available.

**OpenAI Realtime API.**
- Live-audio partials **~200–400 ms**; `gpt-realtime-whisper` exposes minimal→xhigh latency/accuracy. **No dedicated medical model.** File-based `gpt-4o-transcribe` streaming is **500–1500 ms** to first chunk — too slow for live commands. HIPAA story is weak: Azure OpenAI Realtime audio-pipeline BAA coverage was **not clearly confirmed** in late 2025. Not recommended as primary for PHI command path.

**Google Chirp 3.**
- Strong accuracy, gRPC StreamingRecognize (no native WebSocket). **~300–600 ms** streaming, sometimes 500 ms–1 s. `ENDPOINTING_SENSITIVITY_SUPERSHORT` is purpose-built for 1-word commands ("yes/no/stop") and finalizes immediately — relevant for a discrete-command grammar. GCP BAA available. Custom vocab + denoiser but no dedicated medical model.

**Speechmatics.**
- Unique explicit `max_delay` knob: **0.7–1.5 s** for agents (<5% rel. WER hit), 2 s optimal (~1% hit), 4 s = batch parity. Latency floor asymptotes ~0.25–0.5 s. Same model batch+realtime. Strong **on-prem/data-residency** story for HIPAA. No dedicated medical model.

**Azure Speech.**
- BAA via Microsoft DPA (Enterprise/M365/CSP). `stable_partial_threshold` tunable. Custom clinical model training; Nuance Dragon Medical being sunset toward Azure. **Disconnected containers** allow fully on-prem/air-gapped — strong for strict PHI. Streaming $0.0167/min.

**Soniox.**
- **Sub-200 ms streaming**, healthcare-positioned, audio kept in-memory, SOC2 T2 + ISO27001 + HIPAA. Confirm BAA directly with sales. 6.5% EN WER (vendor batch bench).

### On-device / edge

- **parakeet_realtime_eou_120m-v1** is the standout for the command path: **80–160 ms** streaming with an integrated `<EOU>` token — no separate VAD, RNNT incremental decoding, CoreML + ONNX ports exist. EN-only, no punctuation (fine for commands, not for dictation prose). Latency caveat: measured on clean TTS audio; expect degradation with mic noise/accents in a reading room.
- **Moonshine v2** removes Whisper's 30-s zero-padding overhead via a variable-length/ergodic-streaming encoder → **Tiny 50 ms, Small 148 ms, Medium 258 ms** end-of-utterance-to-text on an M3. Best general-purpose on-device streaming engine for Apple Silicon.
- **sherpa-onnx streaming Zipformer**: true streaming transducer, ~160 ms on mobile, runs everywhere offline, has a WebSocket server for browser/mobile. Solid open fallback.
- **Whisper family is fundamentally chunked**, not natively streaming — a firm ~500 ms latency floor even for short clips. whisper.cpp (CoreML/Metal) is the best Apple-Silicon Whisper; faster-whisper is CPU-only on Mac. distil-whisper is the latency-critical Whisper choice (English-only). Use Whisper for the *dictation/accuracy* path, not the sub-100 ms command path.
- **Web Speech API**: Chrome ships audio to Google servers — **not on-device, not HIPAA-safe**. Do not use for PHI.

---

## Streaming vs batch architecture & "claim a command mid-utterance"

- **Batch / full-attention** (Parakeet TDT v2, Whisper, Chirp batch) gives best WER and huge RTFx but must wait for an utterance to end → unavoidable latency. Use for the **final dictated report**, not commands.
- **Chunked decoding** (Whisper-web 30-s windows, faster-whisper) is "streaming-ish" but high-latency; overlap windows add redundant compute.
- **True streaming transducers / cache-aware Conformers** (Parakeet streaming, sherpa Zipformer, Deepgram, AssemblyAI) process each frame once, emit **interim results continuously**. This is what enables acting on a command **before** end-of-speech.
- **Interim results are the key primitive for low *perceived* latency.** Pattern: run a fast command grammar/keyword matcher over the rolling interim transcript. When the partial confidently matches a known command ("compare prior", "next image", "measure"), fire it immediately — do NOT wait for `is_final` (which is gated by endpointing silence, typically +150–300 ms of dead air). Deepgram Flux's eager-response events and Parakeet's `<EOU>` token are explicit hooks for exactly this.
- **Endpointing/VAD is the dominant tunable latency knob** for finalization, and it's independent of model speed. For commands, use aggressive endpointing or model-integrated turn detection; for dictation, relax it so phrases aren't cut.

## Lowest *perceived* latency recipe

1. **Stream interims continuously** (don't poll finals).
2. **Match commands against partials**, fire on confident partial → sub-100 ms perceived for common commands.
3. **Keep finals/dictation on a separate, accuracy-favoring config** (relaxed endpointing, keyterm/medical biasing).
4. **Co-locate inference** (on-device or same-region cloud) to kill network round-trip — local STT cuts cloud's 300–800 ms to 50–300 ms.

---

## RECOMMENDATION

**Two-path (dual-decoder) architecture — run both on the same audio stream:**

**A) Command path (latency #1, target <100 ms perceived):**
- **Primary: on-device `nvidia/parakeet_realtime_eou_120m-v1`** (CoreML on Apple Silicon, or GPU/ONNX). 80–160 ms streaming + native `<EOU>`, no VAD round-trip, no network, no PHI leaves the box. Run a command-grammar matcher over its rolling output and fire on confident partial. Fallback engine: **Moonshine v2 Tiny/Small** (50–148 ms) or **sherpa-onnx streaming Zipformer** (~160 ms) if not on NVIDIA/Apple.
- **Cloud alternative if you prefer managed: Deepgram Flux** (model-integrated EOT ~260–300 ms, eager-response events) or **AssemblyAI Universal-3 Pro** (~150 ms P50). Both under BAA. Cloud adds network RTT, so on-device wins the strict <100 ms bar.

**B) Dictation / report path (accuracy #1, latency relaxed):**
- **Primary: Deepgram Nova-3 Medical streaming** under Enterprise BAA — the only major with a purpose-built streaming medical model, ~150 ms interims, keyterm prompting for radiology vocabulary, self-host option (<100 ms on-prem). $0.0077/min.
- **Strong alternatives:** AssemblyAI Universal-3 Pro + Medical Mode (BAA); Azure Speech with custom clinical model + disconnected containers if you need air-gapped PHI; Speechmatics if on-prem/data-residency dominates.

**Net pick:** **On-device Parakeet-Realtime-EOU (commands) + Deepgram Nova-3 Medical streaming under BAA (dictation).** This is the only combination that hits sub-100 ms perceived command latency while keeping clinical-grade, HIPAA-covered dictation.

---

## Deeper research paths / open questions

- **Run your own streaming bench** — vendor TTFP numbers are gameable. Use the [Coval Speech-to-Text Playground](https://www.coval.ai/) and Pipecat's TTFS methodology. Validate Parakeet-EOU's 80–160 ms claim on *real reading-room mic audio* (noise, HVAC, multiple speakers), since NVIDIA measured it on clean TTS.
- **Medical WER reality-check:** Deepgram's 63.7% and AssemblyAI's missed-entity numbers are both vendor-relative. Build a radiology-specific eval set (real dictations, RadLex/SNOMED terms) and measure WER + keyterm/entity error yourself. See [Deepgram Nova-3 Medical Streaming](https://deepgram.com/learn/nova-3-medical-streaming-update) and [AssemblyAI vs Deepgram medical](https://www.assemblyai.com/blog/assemblyai-vs-deepgram-medical-transcription).
- **Cache-aware streaming paper:** ["Stateful Conformer with Cache-based Inference for Streaming ASR"](https://arxiv.org/pdf/2312.17279) — the architecture behind Parakeet/Nemotron streaming; read to tune look-ahead vs latency.
- **Moonshine v2 paper:** ["Moonshine v2: Ergodic Streaming Encoder ASR for Latency-Critical Speech Applications"](https://arxiv.org/html/2602.12241) and the original ["Moonshine"](https://arxiv.org/html/2410.15608v1).
- **Canary-1B-v2 & Parakeet-TDT-v3:** [arXiv 2509.14128](https://arxiv.org/html/2509.14128v1) — multilingual accuracy/throughput tradeoffs if you later need non-English.
- **HF Open ASR Leaderboard** (HF/NVIDIA/Mistral/Cambridge) — neutral batch WER/RTFx, but note it's batch not streaming: <https://huggingface.co/spaces/hf-audio/open_asr_leaderboard>.
- **Nemotron Speech ASR scaling for voice agents:** [HF blog](https://huggingface.co/blog/nvidia/nemotron-speech-asr-scaling-voice-agents) — cache resets at EOU boundaries for interruption handling.
- **Open BAA questions to close with sales:** Soniox BAA terms; exact Nova-3 *Medical* per-minute price (vs general Nova-3 $0.0077); Azure OpenAI Realtime audio-pipeline HIPAA scope (was unconfirmed late 2025).
- **Deepgram Flux for commands:** evaluate `eot_threshold` and eager-response events as the cloud command path; [Flux quickstart](https://developers.deepgram.com/docs/flux/quickstart).
- **Endpointing tuning guide:** [Deepgram measuring streaming latency](https://developers.deepgram.com/docs/measuring-streaming-latency) and [endpointing docs](https://developers.deepgram.com/docs/endpointing).

---

## Sources

- Deepgram Nova-3 Medical Streaming — https://deepgram.com/learn/nova-3-medical-streaming-update
- Deepgram Nova-3 Medical intro — https://deepgram.com/learn/introducing-nova-3-medical-speech-to-text-api
- Deepgram measuring streaming latency — https://developers.deepgram.com/docs/measuring-streaming-latency
- Deepgram endpointing — https://developers.deepgram.com/docs/endpointing
- Deepgram interim results — https://developers.deepgram.com/docs/interim-results
- Deepgram pricing — https://deepgram.com/pricing
- Deepgram Flux launch — https://www.businesswire.com/news/home/20251002758871/en/Deepgram-Launches-Flux---The-Worlds-First-Conversational-Speech-Recognition-Model
- Deepgram Flux quickstart — https://developers.deepgram.com/docs/flux/quickstart
- Deepgram Flux Multilingual — https://www.businesswire.com/news/home/20260429043418/en/Deepgram-Launches-Flux-Multilingual-The-Worlds-First-Multilingual-Conversational-Speech-Recognition-Model
- Nova-3 Medical pricing/specs (CloudPrice) — https://cloudprice.net/models/deepgram-nova-3-medical
- AssemblyAI streaming benchmarks — https://www.assemblyai.com/docs/streaming/benchmarks
- AssemblyAI 300ms rule — https://www.assemblyai.com/blog/low-latency-voice-ai
- AssemblyAI best real-time models 2026 — https://www.assemblyai.com/blog/best-api-models-for-real-time-speech-recognition-and-transcription
- AssemblyAI vs Deepgram medical — https://www.assemblyai.com/blog/assemblyai-vs-deepgram-medical-transcription
- OpenAI Realtime guide — https://platform.openai.com/docs/guides/realtime
- OpenAI realtime transcription — https://developers.openai.com/api/docs/guides/realtime-transcription
- OpenAI audio model updates — https://developers.openai.com/blog/updates-audio-models
- Streaming STT with OpenAI 2026 (DEV) — https://dev.to/tahosin/streaming-speech-to-text-with-openai-in-2026-moving-beyond-whisper-2968
- GPT-4o-Transcribe review (TokenMix) — https://tokenmix.ai/blog/gpt-4o-transcribe-vs-whisper-review-2026
- Google Chirp 3 transcription docs — https://docs.cloud.google.com/speech-to-text/docs/models/chirp-3
- Google Speech-to-Text release notes — https://docs.cloud.google.com/speech-to-text/docs/release-notes
- Google Agent Assist transcription — https://docs.cloud.google.com/agent-assist/docs/transcription
- Best STT models 2026 (nextlevel.ai) — https://nextlevel.ai/best-speech-to-text-models/
- Speechmatics realtime latency docs — https://docs.speechmatics.com/features/realtime-latency
- Speechmatics latency/accuracy blog — https://blog.speechmatics.com/latency_accuracy
- Speechmatics STT metrics for voice agents — https://www.speechmatics.com/company/articles-and-news/speed-you-can-trust-the-stt-metrics-that-matter-for-voice-agents
- Soniox home — https://soniox.com/
- Soniox voice agents — https://soniox.com/use-cases/voice-agents
- Soniox benchmarks 2025 — https://soniox.com/benchmarks
- Soniox vs Speechmatics — https://soniox.com/compare/soniox-vs-speechmatics
- Azure OpenAI Realtime HIPAA Q&A — https://learn.microsoft.com/en-us/answers/questions/5616040/clarification-request-hipaa-eligibility-of-azure-o
- Azure GPT-Realtime BAA Q&A — https://learn.microsoft.com/en-us/answers/questions/5598862/is-the-gpt-realtime-model-in-azure-covered-under-b
- Azure AI BAA/HIPAA — https://learn.microsoft.com/en-us/answers/questions/2265200/azure-ai-baa-hipaa-compliance
- Azure HIPAA medical transcription (MS Community) — https://techcommunity.microsoft.com/blog/azuredevcommunityblog/building-hipaa-compliant-medical-transcription-with-local-ai/4490777
- Azure Speech pricing (BrassTranscripts) — https://brasstranscripts.com/blog/azure-speech-services-pricing-2025-microsoft-ecosystem-costs
- NVIDIA Parakeet TDT 0.6B v2 (HF) — https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2
- NVIDIA speech AI models blog — https://developer.nvidia.com/blog/nvidia-speech-ai-models-deliver-industry-leading-accuracy-and-performance/
- Parakeet TDT v2 launch (VentureBeat) — https://venturebeat.com/ai/nvidia-launches-fully-open-source-transcription-ai-model-parakeet-tdt-0-6b-v2-on-hugging-face
- Canary-1B-v2 & Parakeet-TDT-v3 (arXiv) — https://arxiv.org/html/2509.14128v1
- NVIDIA parakeet_realtime_eou_120m-v1 (HF) — https://huggingface.co/nvidia/parakeet_realtime_eou_120m-v1
- parakeet-realtime-eou CoreML port — https://huggingface.co/FluidInference/parakeet-realtime-eou-120m-coreml
- NVIDIA FastConformer streaming-multi (HF) — https://huggingface.co/nvidia/stt_en_fastconformer_hybrid_large_streaming_multi
- Stateful Conformer cache-based streaming (arXiv) — https://arxiv.org/pdf/2312.17279
- Nemotron speech ASR scaling voice agents (HF blog) — https://huggingface.co/blog/nvidia/nemotron-speech-asr-scaling-voice-agents
- Moonshine (MarkTechPost) — https://www.marktechpost.com/2024/10/23/moonshine-a-fast-accurate-and-lightweight-speech-to-text-models-for-transcription-and-voice-command-processing-on-edge-devices/
- Moonshine original paper — https://arxiv.org/html/2410.15608v1
- Moonshine v2 paper — https://arxiv.org/html/2602.12241
- Moonshine GitHub — https://github.com/moonshine-ai/moonshine
- whisper.cpp vs faster-whisper 2026 — https://www.promptquorum.com/power-local-llm/local-whisper-stt-comparison-2026
- Whisper on Apple Silicon benchmarks — https://www.voicci.com/blog/apple-silicon-whisper-performance.html
- mac-whisper-speedtest — https://github.com/anvanvan/mac-whisper-speedtest
- Choosing Whisper variants (Modal) — https://modal.com/blog/choosing-whisper-variants
- sherpa-onnx streaming Zipformer models — https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-transducer/zipformer-transducer-models.html
- sherpa-onnx GitHub — https://github.com/k2-fsa/sherpa-onnx
- Whisper WebGPU / transformers.js tutorial — https://dev.to/proflead/real-time-audio-to-text-in-your-browser-whisper-webgpu-tutorial-j6d
- whisper-web (Xenova) — https://github.com/xenova/whisper-web
- Browser audio transcription (WebGPU/WASM) — https://whisperstt.com/blog/transcribe-audio-in-browser/
- Best open-source STT 2026 (Northflank) — https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks
- HF Open ASR Leaderboard — https://huggingface.co/spaces/hf-audio/open_asr_leaderboard
