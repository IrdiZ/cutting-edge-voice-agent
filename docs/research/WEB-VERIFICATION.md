# WEB-VERIFICATION.md — Phase-0 Bench Desk-Research Rulings

This document settles the disputed tickets in `OPEN-QUESTIONS.md` for the radiology voice-agent's Phase-0 bench. Every value below was verified against primary sources (vendor model cards, arXiv papers, peer-reviewed studies, official docs) and then adversarially re-reviewed for credibility. Numbers that desk research can defensibly settle are marked resolved; numbers that depend on **target hardware + real user audio** (rather than vendor clean-TTS / GPU / throughput figures) are routed to the bench harness as bench-only. Throughout, apply the two standing caveats: **trust the floor, not the headline** (vendor best-case figures are GPU/clean-audio/high-end-CPU), and **clean-TTS ≠ real-audio** (WER and latency degrade on accented, noisy, real-microphone clinical speech).

## TL;DR — what desk research settled

| Ticket | Settled value | Confidence | Verdict |
|---|---|---|---|
| A2/A3-parakeet | 80–160 ms = configurable streaming **chunk** latency of the 120M EOU model (GPU, clean TTS); 560 ms = a chunk-size **mode**, not CPU compute; GPU time-to-final ~24–90 ms. Parakeet-**TDT-0.6B is offline** — no published streaming first-token latency on CPU or GPU. | high | bench-only |
| A3-moonshine | v2 params Tiny 33.6M / Small 123M / Medium 245M; 8-dataset real-audio avg WER 12.0 / 7.84 / 6.65%; "response latency" (VAD-end → text) Tiny 34–50 ms on M3 only, 69 ms Linux x86, 237 ms Pi 5. Gemini's "<50 ms chunk" is **mislabeled** (it's response latency, not chunk, and Apple-M3-only). | high | resolved |
| A3-sherpa | Streaming Zipformer sub-real-time on CPU: en RTF 0.062–0.077 @2 threads; footprint ~44 MB (en-20M int8) to ~180 MB (en full int8). RTF is **throughput, not turn latency**. | high | resolved |
| A9-voxtral | Voxtral-Mini-4B-Realtime-2602 (Apache 2.0). FLEURS-English: 480 ms→4.90% WER, 160 ms→6.46%. Real in-browser WebGPU build exists. "ms" = algorithmic **transcription_delay**, not wall-clock. | high | resolved |
| A9-assemblyai | Both numbers are **Universal-3 Pro Streaming**: ~150 ms = P50 *post-VAD* latency (not emission); 6.3% = mean streaming WER. Base "Universal Streaming" is ~300–317 ms emission / 8.6% WER. "Corroborated by 3 prior models" is unsupported. | high | resolved |
| A4-deepgram | Param semantics confirmed: `endpointing` default 10 ms (150 is a valid *choice*); `utterance_end_ms=1000` needs `interim_results=true`; `smart_format` number-stall + 3 s silence / `no_delay`. Latency NOT settled. | high | bench-only |
| B1-rhino | Picovoice publishes **no** standalone ms/RTF latency for Rhino — only "No cloud. No latency." + 97.3% accuracy. The ~100 ms/file figure is batch throughput, not response latency. | high | bench-only |
| B2-model2vec | Quality ~91–95% of MiniLM MTEB confirmed (potion-base-32M ~93%). "Sub-1 ms" is **inferred from throughput**, not a published latency. Radiology recall unknown. | high | resolved (speed/quality); bench (radiology recall) |
| C1-smartturn | ~12 ms is vendor best-case single-inference on a high-end cloud CPU (c7a.2xlarge); 20–95 ms on weaker/ARM CPUs; ~70 ms integrated on Pipecat Cloud. Whisper-Tiny encoder + linear head, 8 MB int8. | high | resolved |
| B8-acibench | Paper real (Chen et al., **not** Schaaf et al.; ASRU 2025) and ACI-Bench open. But the 90.4% utterance-F1 / 86.8% word-F1 on Qwen2-1.5B are **gated/unverifiable** from open sources. | medium | unresolved (cite as unverified) |
| E1-deid | Philter ~99% recall is real but a single-tool, token-level, recall-optimized dev-paper number (npj Digital Medicine 2020, **not** JAMIA). Independent head-to-head: Philter ~0.79, Presidio ~0.74. No 3-way and no radiology-specific benchmark exists. | high | resolved (literature) |
| F1/F2-hardware | Sub-100 ms mouth-to-command is gated by **algorithmic + endpointing delay**, not CPU vs Apple Silicon compute — essentially unachievable in a chunked/endpointed pipeline on any hardware. The three quoted CPU ranges conflate compute with delay. | high | bench-only |
| G1-incumbents | 3 of 4 gaps confirmed OPEN (verbal-punctuation, PHI-to-cloud, no zero-click). Accent gap downgraded: "robustness unproven/likely-degraded," not "collapse." | medium | resolved (binary gaps) |
| CITE-2501.00123 | Real ID, **wrong content** — pure-math loop theory. DISCARD. | high | discard citation |
| CITE-2506.23325 | Real paper (XY-Tokenizer speech codec). Keep only if footnoting a tokenizer/codec claim, not a clinical metric. | high | keep with relevance check |

## Bench-only (cannot settle by desk research)

These need measurement on the **actual target workstation with real user audio** (CPU-only, and Apple Silicon/ANE or WebGPU if available), reporting p50/p95.

- **A2/A3-parakeet** — The three disputed numbers are not measurements of the same thing. 80–160 ms is the configurable streaming-chunk latency of the *120M EOU* model on GPU with clean TTS audio; 560 ms is a chunk-size *mode*, not CPU compute; ~24–90 ms GPU time-to-final applies to the streaming models. The product in scope, **Parakeet-TDT-0.6B, is an offline batch model** with no published streaming first-token latency on either CPU or GPU. The only CPU data point is a community offline-throughput benchmark (RTF ~0.033 on an i7-12700K). A defensible interactive CPU command-STT latency (including endpointing/silence-wait on real audio) is unestablished and must be measured.
- **A4-deepgram** — Parameter semantics are settled, but latency is not. Deepgram publishes only a vendor "sub-300 ms" (TTFB-style) claim and a 150–300 ms transcription-latency typical range; it has **no first-partial SLA** and explicitly tells you to compute it yourself from interim transcripts. An independent Coval/Gradium benchmark measured Nova-3 median TTFT ~992 ms under "production" conditions (>3× the marketed figure) — but that source has a competitor conflict-of-interest and an implausible WER, so it is not adoptable either. Bench on real radiology dictation.
- **B1-rhino** — Picovoice publishes no ms/RTF/CPU latency for Rhino at all. A usable standalone number must be bench-measured; RTF is the right metric to capture, noting Rhino's perceived latency is dominated by utterance length + end-pointing, not a fixed per-frame cost.
- **F1/F2-hardware** — No published source gives a single "CPU mouth-to-command" number for a radiology pipeline; the three quoted ranges are estimates that conflate compute with endpoint delay. STT+VAD *compute* on a modern multi-core CPU with a small/quantized model is plausibly <100 ms, but **total** mouth-to-command is gated above 100 ms by endpointing (typically 200–900 ms) on *any* hardware. Apple Silicon/WebGPU helps encoder compute, not the endpoint floor. Measure end-to-end mic-onset → recognized-command, decomposed into (i) VAD, (ii) STT compute, (iii) endpoint/algorithmic delay, (iv) intent decode.
- **B2-model2vec (radiology-recall sub-claim only)** — Speed/quality are settled; radiology paraphrase **recall** is unverified by any source (all numbers are general-domain English MTEB). Distill/load potion-base-32M (or the retrieval-tuned potion-retrieval-32M) and measure recall on an actual radiology paraphrase set.

## Per-ticket detail

### A2/A3-parakeet — Parakeet / EOU / Nemotron TDT-0.6B on-device command-STT latency
**Final finding:** The dispute conflates three different models/metrics. 80–160 ms is the configurable algorithmic chunk latency of `parakeet_realtime_eou_120m-v1` (120M FastConformer+RNNT+EOU) on GPU with clean TTS audio (EOU ~160 ms p50 / ~280 ms p90). 560 ms is one of the runtime chunk modes (80 ms / 160 ms / 560 ms / 1.12 s) of Nemotron cache-aware streaming ASR — not a CPU measurement (measured GPU time-to-final ~24 ms median, ~90 ms on an L40). Parakeet-TDT-0.6B itself is offline (RTFx 3380 @batch=128 GPU; 6.05% WER, #1 Open ASR Leaderboard) with no streaming first-token latency published; the only CPU figure is a community offline-throughput benchmark (RTF ~0.033 on i7-12700K).
**Adversarial verdict:** confirmed (restated as-is). **Credibility:** all four sources real and verified by direct fetch. Vendor NVIDIA figures are clean-TTS/GPU; the CPU number is an unverified community offline-throughput benchmark — not interactive streaming latency.
**Sources:**
- https://huggingface.co/nvidia/parakeet_realtime_eou_120m-v1
- https://huggingface.co/blog/nvidia/nemotron-speech-asr-scaling-voice-agents
- https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2
- https://github.com/groxaxo/parakeet-tdt-0.6b-v3-fastapi-openai/blob/main/README.md

### A3-moonshine — Moonshine v2 on-device STT
**Final finding:** v2 ships Tiny ~33.6M / Small ~123M / Medium ~245M params. 8-dataset real-audio average WER: 12.0 / 7.84 / 6.65% (Medium beats Whisper large-v3 at ~6× smaller). "Response latency" = VAD end-of-speech → transcript: Tiny 34 ms (GitHub) / 50 ms (paper) on Apple M3, 69 ms Linux x86, 237 ms Pi 5; Small 73/165/527 ms; Medium 107/269/802 ms. The Gemini "<50 ms chunk" claim is **mislabeled, not fabricated** — 34–50 ms is Tiny's M3 response latency (not chunk latency), and it fails on edge targets (237 ms on Pi 5). Architecture: 20 ms frames, 16-frame left context, 80 ms per-layer lookahead, 320 ms max finalization.
**Adversarial verdict:** confirmed. **Credibility:** sources real and primary (arXiv:2602.12241v1, vendor GitHub, HF card), but ALL latency/WER numbers are vendor-reported with no third-party reproduction; the two vendor sources self-disagree (34 vs 50 ms). WER is on real-audio public benchmarks (good), not clean-TTS. Confirming "<50 ms" on the actual target hardware needs a bench measurement.
**Sources:**
- https://arxiv.org/html/2602.12241v1
- https://github.com/moonshine-ai/moonshine
- https://huggingface.co/UsefulSensors/moonshine-streaming-tiny
- https://arxiv.org/pdf/2410.15608

### A3-sherpa — sherpa-onnx streaming Zipformer command-STT on CPU
**Final finding:** Runs well below real-time on CPU: en-2023-06-21 @2 threads RTF 0.062 (int8) / 0.076–0.077 (fp32), encoder 337 MB fp32 / 179 MB int8; Korean RTF 0.16/0.10; Chinese int8 RTF 0.15, xlarge 0.46. Small en-20M-2023-02-17: ~44 MB int8 total (encoder 42.8 MB, decoder 539 KB, joiner 260 KB). Docs state all sherpa-onnx models run real-time on a Raspberry Pi 4. **Correction:** the "Cortex A7 target" attribution is NOT on the cited pages — drop it.
**Adversarial verdict:** confirmed (with the Cortex-A7 correction). **Credibility:** authoritative k2-fsa docs + maintainer HF repo; footprints cross-checked against the actual HF file tree. But RTF tables are vendor self-reported on **clean read speech** (LibriSpeech), greedy search, unpinned CPU, no independent reproduction. **Critical caveat preserved:** RTF is throughput (compute / audio duration), NOT turn latency — felt latency = chunk look-ahead (chunk-16-left-64, ~320 ms) + endpoint/silence timeout + per-chunk compute, with endpointing dominating. Bench on target hardware with real noisy command audio before committing a latency SLA.
**Sources:**
- https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-transducer/zipformer-transducer-models.html
- https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17
- https://k2-fsa.github.io/sherpa/onnx/pretrained_models/small-online-models.html
- https://github.com/k2-fsa/sherpa-onnx

### A9-voxtral — Voxtral-Mini-4B-Realtime in-browser WebGPU
**Final finding:** Voxtral-Mini-4B-Realtime-2602 (Apache 2.0; 3.4B LM + 0.6B causal audio encoder; Mistral, Feb 2026). FLEURS-English WER-by-delay matches the official card and arXiv:2602.11298 exactly: 160 ms→6.46%, 240 ms→5.91%, 480 ms→4.90% (vendor-recommended), 960 ms→4.34%, 2400 ms→4.05%. A real official in-browser WebGPU build exists (`mistralai/Voxtral-Realtime-WebGPU` + onnx-community port), so "no-install on-device browser STT" is accurate. Do not conflate with the earlier Xenova WebGPU port of the *offline* Voxtral-Mini-3B.
**Adversarial verdict:** confirmed (framing corrections). **Credibility:** two primary sources fetched (HF card + arXiv); all WER numbers vendor (Mistral) self-reported, no independent reproduction of the realtime curve. **Two framing corrections:** (1) the "ms" figures are the algorithmic `transcription_delay_ms` (streaming commit lag), NOT measured browser wall-clock — real in-browser latency depends on GPU + quantized ONNX build and will be higher. (2) 4.90%/6.46% are the most favorable slice (clean English read-aloud FLEURS); the 13-language average at 480 ms is ~8.72% and broader English macro-average ~8.47%. Expect materially worse on real clinical dictation — bench-only.
**Sources:**
- https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602/blob/main/README.md
- https://huggingface.co/spaces/mistralai/Voxtral-Realtime-WebGPU
- https://huggingface.co/onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX
- https://mistral.ai/news/voxtral-transcribe-2/
- https://huggingface.co/posts/Xenova/793837995432659

### A9-assemblyai — AssemblyAI streaming ~150 ms / 6.3% WER
**Final finding:** Both numbers belong to **Universal-3 Pro Streaming**, not bare "Universal-Streaming," and to different measurement bases. ~150 ms = P50 latency *after VAD endpoint detection* (P90 ~240 ms; ~250 ms P50 time-to-complete-transcript at VAD=100 ms) — NOT word-emission latency. 6.3% = Universal-3 Pro Streaming mean streaming WER (median 6.1%). The base Universal Streaming model is ~307–317 ms P50 emission / 8.6% mean WER (the widely cited "~300 ms immutable transcripts"). The "corroborated by all three prior research models" assertion is **unsupported** by any primary source — a dossier-internal claim.
**Adversarial verdict:** confirmed (claim mis-attributes both numbers). **Credibility:** all three vendor URLs fetched; every figure reproduced verbatim. But entirely vendor-published on AssemblyAI's own suite — AssemblyAI itself warns public benchmarks/TTFT are gameable. Latency is not apples-to-apples: 150 ms is post-VAD turn latency on a model that emits no partials, vs competitors' server-side emission figures. 6.3% is a blended mean across clean (LibriSpeech 1.78%) and noisy sets (CommonVoice 6.11%, Earnings21 9.25%) — not clean-TTS-only.
**Sources:**
- https://www.assemblyai.com/blog/universal-3-pro-streaming
- https://www.assemblyai.com/docs/streaming/benchmarks
- https://www.assemblyai.com/blog/introducing-universal-streaming

### A4-deepgram — Nova-3 Medical first-partial + endpointing config
**Final finding:** Parameter semantics confirmed verbatim: `endpointing` is an integer ms value, **default 10 ms** (so "~150 ms" is a legitimate user *choice*, not a default); `utterance_end_ms=1000` is the canonical example and requires `interim_results=true`; `smart_format=true` causes a number-stall (waits for entity completion OR finalizes after 3 s of silence; `no_delay=true` forces immediate finalization but skips formatting). Latency is NOT settled: the disputed 80/150/300 ms first-partial trio is not vendor-stated; Deepgram publishes only "sub-300 ms" (TTFB) + a 150–300 ms transcription range + 200–500 ms end-to-end, and explicitly has no first-partial SLA.
**Adversarial verdict:** bench-only (params confirmed). **Credibility:** primary docs fetched and verified including the 10 ms endpointing default. "Sub-300 ms" is vendor TTFB marketing under ideal/raw conditions. Independent Coval/Gradium benchmark shows Nova-3 median TTFT ~992 ms under production conditions — but Gradium is a competing vendor (COI), dataset undocumented, outliers >2.3 s excluded, and reported WER ~25.3% is implausibly high. So the independent number undercuts the marketing but is not itself clean enough to adopt.
**Sources:**
- https://developers.deepgram.com/docs/measuring-streaming-latency
- https://developers.deepgram.com/docs/endpointing
- https://developers.deepgram.com/docs/utterance-end
- https://developers.deepgram.com/docs/smart-format
- https://deepgram.com/learn/nova-3-medical-streaming-update
- https://aws.amazon.com/marketplace/pp/prodview-wkxd2vmfoaujo

### B1-rhino — Picovoice Rhino Speech-to-Intent latency
**Final finding:** Picovoice publishes NO standalone ms/RTF/CPU latency for Rhino — only "No cloud. No latency." marketing plus accuracy (97.3% across 6–24 dB SNR; >99% clean). The official open-source benchmark reports only Command Acceptance Rate (accuracy). Picovoice publishes RTF/CPU for other engines (Cobra, Cheetah, Porcupine) but not Rhino. The only number resembling latency (~100 ms/file) is a batch-throughput artifact of the accuracy tutorial on pre-recorded clean/mixed audio — not real-time response latency.
**Adversarial verdict:** confirmed. **Credibility:** sources verified by direct fetch — benchmark README is accuracy-only, product page is promo, latency blog gives RTF for Cobra/Silero VAD but none for Rhino. No independent third-party ms figure exists. The ~100 ms/file figure must NOT be cited as a streaming latency. Bench-measure RTF on the target hardware; perceived latency is dominated by utterance length + end-pointing.
**Sources:**
- https://picovoice.ai/products/voice/speech-to-intent/
- https://github.com/Picovoice/speech-to-intent-benchmark/blob/master/README.md
- https://picovoice.ai/docs/faq/rhino/
- https://picovoice.ai/docs/benchmark/how-to-benchmark-a-rhino-context/
- https://picovoice.ai/blog/latency-in-speech-recognition/

### B2-model2vec — potion static embeddings
**Final finding:** QUALITY (high confidence): potion-base-32M retains ~91–95% of all-MiniLM-L6-v2 MTEB (results README 52.13 = 93.21%; HF card 52.83 = 94.66%; potion-base-8M ~91%). "~93%" is a defensible central estimate. SPEED (revised/downgraded): the published figure is **relative throughput** — "up to 500× faster on CPU than the original model" (the source transformer, bge-base for the 32M, not MiniLM). Neither primary page publishes a per-item ms latency; "sub-1 ms" is **inferred from a ~15k sentences/sec throughput number** (with multiprocessing disabled) — treat as a hypothesis to measure, not a confirmed spec. RADIOLOGY recall: no medical/paraphrase evidence exists; bench-only.
**Adversarial verdict:** revised. **Credibility:** real authoritative primary sources (MinishLab org, HF cards), but all vendor-marketing, no independent reproduction. Classic throughput-vs-latency conflation: the 15k sent/s basis for "sub-1 ms" did not appear on either fetched primary page. Clean-TTS-vs-real-audio N/A (text embedding model — audio effects enter upstream via the transcript).
**Sources:**
- https://github.com/MinishLab/model2vec/blob/main/results/README.md
- https://huggingface.co/minishlab/potion-base-32M
- https://github.com/MinishLab/model2vec

### C1-smartturn — Pipecat Smart Turn v3.1 semantic end-of-utterance
**Final finding:** TRUE as a vendor best-case spec, but "runs in ~12 ms on CPU" overstates typical reality. ~12 ms is best-case single-inference on a high-end cloud CPU (AWS c7a.2xlarge: v3 12.6 ms incl. ~3 ms preprocessing; v3.1 9 ms inference + ~7 ms preprocessing). Weaker/ARM CPUs: 15.2–94.8 ms (e.g. 59.8 ms c8g.medium, 94.8 ms t3.medium). Integrated on Pipecat Cloud: ~70 ms — the realistic deployed model latency; end-to-end perceived turn latency is further dominated by the VAD stop window (~200 ms default). Model: Whisper-Tiny encoder + linear head, ~8M params, ONNX, 8 MB int8 (32 MB fp32 GPU variant), 23 languages, 16 kHz mono, ≤8 s chunks. **Recommended phrasing:** "~12 ms best-case single-inference on a high-end cloud CPU; ~20–95 ms on weaker/ARM CPUs; ~70 ms integrated on Pipecat Cloud."
**Adversarial verdict:** revised. **Credibility:** all three sources fetched and authentic, but the 12 ms is first-party vendor marketing (literally the blog title), not independently benchmarked; tables are reproducible-looking and consistent across v3/v3.1. v3 (12.6 ms inclusive) and v3.1 (9 ms + 7 ms separate) are not measured identically. Latency figures are single-inference, not throughput/RTF — no confusion. Accuracy is on a held-out smart-turn set, not radiology speech.
**Sources:**
- https://www.daily.co/blog/announcing-smart-turn-v3-with-cpu-inference-in-just-12ms/
- https://www.daily.co/blog/improved-accuracy-in-smart-turn-v3-1/
- https://huggingface.co/pipecat-ai/smart-turn-v3

### B8-acibench — Dictation-vs-command detection baseline (90.4% / 86.8% F1)
**Final finding:** Paper and dataset are real and correctly identified; the two headline metrics are NOT independently verifiable. The paper is "LLM-Based Dictation Detection from Doctor-Patient Conversations," IEEE ASRU 2025, by Siyuan Chen, Mojtaba Kadkhodaie Elyaderani, Jing Su, Susanne Burger, Thomas Schaaf — **Schaaf is senior/last author; lead is Chen, so cite as "Chen et al.," not "Schaaf et al."** ACI-Bench is genuinely open (CC BY 4.0, Figshare; Yim et al., Nature Sci Data 2023, arXiv:2306.02022) with an explicit dictation category (a rare/imbalanced class). NOT confirmed: the exact 90.4% utterance-F1 / 86.8% word-F1, the attribution to Qwen2-1.5B specifically, and whether they were "baseline" vs best system — full text is gated behind IEEE Xplore/ResearchGate with no open preprint.
**Adversarial verdict:** unresolved. **Credibility:** real authoritative academic sources (not vendor marketing); gating confirmed firsthand (ResearchGate 403, Semantic Scholar nav-only). The two F1 numbers trace to no openly accessible primary source — single-sourced to a gated full text. **Ruling:** cite as "Chen et al. (Schaaf senior author), ASRU 2025, ACI-Bench, Qwen2-based dictation detector," and treat 90.4/86.8 as **UNVERIFIED** pending the IEEE Xplore PDF. No audio/latency caveats apply (transcript-classification F1), but ACI-Bench transcripts carry uncorrected ASR/diarization errors and dictation is rare, making a single F1 sensitive to split/threshold.
**Sources:**
- https://www.researchgate.net/publication/403465408_LLM-Based_Dictation_Detection_from_Doctor-Patient_Conversations
- https://dblp.org/db/conf/asru/asru2025.html
- https://github.com/wyim/aci-bench
- https://arxiv.org/abs/2306.02022

### E1-deid — PHI de-identification recall (Philter vs Presidio vs Comprehend Medical)
**Final finding:** Philter's ~99% recall is real but a single-tool, token-level, recall-optimized number from its own development paper (Norgeot et al., **npj Digital Medicine 3:57, 2020 — NOT JAMIA**): recall 99.46% / precision 78.28% / F2 94.36% (UCSF), 99.92% / 78.58% / 94.77% (i2b2 2014); in-paper comparators only NLM Scrubber and Physionet. An independent neutral head-to-head (Alrazihi et al., Surgical Neurology International 16(313), 2025; 200 neurosurgical notes, manual ground truth) gives Presidio recall ~0.74 (precision 0.51) and Philter recall ~0.79 (precision <0.4) — far below the 99%, confirming it does not generalize. AWS Comprehend Medical has no comparable figure on the same basis (Heider et al., AMIA 2020: ~0.90–0.93 NAME-category recall, beaten overall by CliniDeID ~0.999). The three named tools have **never** been benchmarked together on one corpus, and none of the evidence is radiology-report-specific.
**Adversarial verdict:** confirmed. **Credibility:** all three sources peer-reviewed/conference, no vendor marketing; Philter npj paper and Heider AMIA paper fetched directly (journal/figures confirmed; JAMIA attribution in the claim is wrong), SNI 2025 PDF returned 403 but figures surfaced via search. Methodologies are heterogeneous (token- vs entity-level, binary-PHI vs per-category, overlap thresholds) so cross-study recall is not directly comparable. TTS/audio caveats N/A (text de-id); the analog caveat is author self-report vs independent eval + dataset shift.
**Sources:**
- https://pmc.ncbi.nlm.nih.gov/articles/PMC7156708/
- https://surgicalneurologyint.com/wp-content/uploads/2025/08/13857/SNI-16-313.pdf
- https://pmc.ncbi.nlm.nih.gov/articles/PMC7233098/

### F1/F2-hardware — Sub-100 ms mouth-to-command: CPU vs Apple Silicon/WebGPU
**Final finding:** Sub-100 ms mouth-to-command is gated by **algorithmic + endpointing delay, not compute**, so it is essentially unachievable on any hardware in a chunked/endpointed pipeline. Decomposed: VAD compute is sub-1 ms (Silero ~0.19–0.33 ms/31 ms chunk); small streaming STT compute is ~78 ms/560 ms chunk (int4 Nemotron-0.6B, RTFx 7.2×, server CPU); the dominant irreducible delay is chunk/look-ahead (~560 ms in the on-device paper; min 80 ms tested at an 8.91% WER cost) plus endpoint silence threshold (typically 200–900 ms). The three quoted "CPU" ranges (bank 80–150, ChatGPT 200–400, Gemini 110–160) conflate compute with delay. Apple Silicon's real benefit is encoder compute (whisper.cpp ANE ">3× faster," community M1 Max 1030→174 ms small-model encoder) — it does not clear the endpoint floor.
**Adversarial verdict:** confirmed (two corrections, conclusion unchanged). **Correction 1:** arXiv:2604.14493 says the *opposite* of "CPU headroom prevents going lower" — it says ~50 ms algorithmic delay "may still be feasible on our server CPU (32 cores)" and that effective TTFT is "dominated by audio accumulation rather than inference compute" (strengthens the thesis). **Correction 2:** the 32-core EPYC result does not transfer to a 4–8 core laptop. **Credibility:** all five sources real; WhisperKit is vendor-adjacent (Argmax) and clean-audio; the streaming paper is independent but academic-benchmark audio; ANE can silently fall back to Metal (~2–3× slower) on some OS/chip combos. No RTF/latency confusion in the finding. Bench on the target workstation with real user audio, p50/p95, decomposed by stage.
**Sources:**
- https://arxiv.org/html/2507.10860v1
- https://arxiv.org/html/2604.14493v1
- https://github.com/snakers4/silero-vad
- https://github.com/ggml-org/whisper.cpp
- https://livekit.com/blog/turn-detection-voice-agents-vad-endpointing-model-based-detection

### G1-incumbents — The 4 incumbent gaps still open in 2026
**Final finding:** 3 of 4 confirmed OPEN; the accent gap is downgraded.
1. **Verbal-punctuation tic — OPEN.** PowerScribe One/Dragon transcribe spoken punctuation; the RSNA 2025 Dragon Copilot preview adds agentic draft/chat/summarization but does not change the dictation paradigm. Rad AI is post-dictation. (Evidence is practitioner/vendor-adjacent, not peer-reviewed; gap holds by absence of any vendor claim to the contrary.)
2. **Accent — DIRECTIONALLY SUPPORTED, CONTESTED, UNQUANTIFIED.** Downgrade "collapse" to "robustness unproven/likely-degraded." Independent studies split: Aberdeen/BJR 2008 (5.9% non-native vs 4.2% native) and BMC/Tygerberg 2015 (25.6% SR error overall vs 9.3% traditional; 27.6% English-second-language vs 19.5% home-language) support a penalty; JACR 2008 and a 2011 breast study found none. All pre-neural-cloud-ASR. **No per-accent WER exists for PowerScribe One / Dragon Copilot / Rad AI.**
3. **PHI-to-cloud — CONFIRMED OPEN (most solid).** Dragon Medical One and PowerScribe One process audio in Microsoft Azure (BAA required); on-device is a different architecture none of the three use.
4. **No partial/zero-click action — CONFIRMED OPEN.** Rad AI Omni Impressions is explicitly post-dictation (0.5–3 s after findings dictated); Dragon Copilot AI draft content requires user "review, test, and validate." None offer zero-click autonomous report generation.

**Adversarial verdict:** confirmed (soften gap 2). **Credibility:** PHI-to-cloud and zero-click rest on primary Microsoft documentation (high); verbal-punctuation on practitioner/vendor-adjacent blogs (directional); accent is the soft spot — strongest independent studies are 10–18 years old, pre-neural-cloud-ASR, and contradicted by other peer-reviewed work. The binary "is each gap open" is desk-settleable; a per-product per-accent WER on real user audio would require a bench.
**Sources:**
- https://www.microsoft.com/en-us/microsoft-cloud/blog/healthcare/2025/11/24/driving-a-unified-ai-experience-at-rsna-2025-microsoft-dragon-copilot-expands-to-radiologists-transforming-the-reporting-workflow/
- https://www.radai.com/news/rad-ai-unveils-next-generation-speech-recognition-that-redefines-radiology-reporting
- https://www.radai.com/case-studies/80-percent-fewer-words-dictated-using-rad-ai-omni-impressions-a-case-study-with-colorado-imaging-associates-p-c
- https://www.auntminnie.com/imaging-informatics/enterprise-imaging/is/article/15588182/study-speech-recognition-boosts-error-rates-in-radiology-reports
- https://pmc.ncbi.nlm.nih.gov/articles/PMC4464850/
- https://voiceprivate.com/healthcare/blog/dragon-medical-one-cost-pricing-alternatives
- https://www.benwhite.com/radiology/making-the-most-of-powerscribe/

## Citation rulings

### CITE-2501.00123 — DISCARD
The ID is real but resolves to **"Loops with involution and the Cayley-Dickson doubling process"** by Adam Chapman, Ilan Levin, Uzi Vishne, Marco Zaninelli (submitted 30 Dec 2024; math.RA / math.CO) — pure-math loop theory with zero relation to radiology, voice agents, ASR, TTS, or any speech/clinical topic. Classic LLM citation hallucination (genuine ID, fabricated bibliographic content). **DISCARD;** if it was supporting a specific claim, replace with the actual primary source. Verified via direct WebFetch of the abstract page + corroborating WebSearch.
- https://arxiv.org/abs/2501.00123

### CITE-2506.23325 — KEEP with relevance check
Real paper: **"XY-Tokenizer: Mitigating the Semantic-Acoustic Conflict in Low-Bitrate Speech Codecs"** by Gong, Jin, Deng, Zhang, Zhang, Cheng, Fei, Li, Qiu (v1 29 Jun 2025, v2 9 Jul 2025; cs.SD / cs.AI / eess.AS). A low-bitrate speech codec/tokenizer using multi-stage multi-task learning. Not a hallucination — **keep ONLY if the dossier footnotes it as a speech-tokenizer / codec / speech-LM component.** It is NOT a radiology/clinical ASR or dictation-accuracy source; if cited for a clinical accuracy/latency figure, repoint or discard. Reported metrics (speaker similarity ~0.83 vs BigCodec ~0.84) are author-reported reconstruction-fidelity benchmarks on standard speech corpora — not WER, not real-clinical audio. Verified via direct WebFetch of the abstract page.
- https://arxiv.org/abs/2506.23325

## Impact on Phase-0 bench

**De-risked (numbers settled by desk research — proceed to integration, not measurement):**
- **A3-moonshine, A3-sherpa, A9-voxtral, A9-assemblyai, C1-smartturn** — STT/turn-detection model specs are confirmed from primary sources. The bench still needs to *validate* them on real user audio, but selection/sizing decisions are no longer disputed. Apply the trust-the-floor framing: design to the worse end (real-audio WER, weaker-CPU latency, post-VAD turn latency), not the vendor headline.
- **B2-model2vec (speed/quality), E1-deid (literature), G1-incumbents (gap analysis)** — settled enough to write into the dossier with the noted corrections (sub-1 ms is inferred not measured; Philter 99% is dev-paper not comparative; accent gap = "unproven/likely-degraded," not "collapse").
- **Citations** — CITE-2501.00123 removed; CITE-2506.23325 retained pending a one-line relevance check by the editor.

**Still critical-path (must be measured on target hardware with real audio):**
- **F1/F2-hardware** — the central architectural risk. Sub-100 ms mouth-to-command is **not** a CPU-vs-Apple-Silicon question; it is gated by chunk look-ahead + endpoint threshold. The bench must measure end-to-end mic-onset → recognized-command (decomposed into VAD / STT compute / endpoint delay / intent decode, p50/p95) and decide whether to adopt an aggressive endpoint threshold or a wake-word/command-grammar (non-endpointed) design to get under 100 ms.
- **A2/A3-parakeet** and **A4-deepgram** — no usable streaming first-token latency exists for the in-scope configs; both need a real-audio CPU run before any latency SLA.
- **B1-rhino** — capture RTF on real audio (no vendor latency number exists at all).
- **B2-model2vec radiology recall** and **B8-acibench F1 verification** — the former needs a radiology paraphrase recall run; the latter needs the gated IEEE Xplore PDF (or author contact) before the 90.4/86.8 figures can be cited as established.