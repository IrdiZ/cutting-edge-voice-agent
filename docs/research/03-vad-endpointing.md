# 03 — VAD, Endpointing, Semantic Turn Detection & Mid-Utterance Command Claiming

**Scope:** Lowest-latency always-on listening for dictation-heavy reporting. Continuous dictation
with mid-utterance command extraction (claim a command from streaming partials before the
user finishes, then strip it from the final dictation text). Latency is the #1 priority.
**Date of research:** May 2026. Figures favor 2024–2026 sources.

> Reading note for this repo's CLAUDE.md style: latency numbers below are tagged with their
> measurement context (CPU type / native vs. WASM / vendor vs. independent). Vendor self-benchmarks
> are flagged. Don't treat a native-CPU number as a browser-WASM number.

---

## 1. The latency budget (why each layer exists)

In an always-on dictation system the perceived "command responsiveness" is the sum of:

```
mic frame buffering  +  VAD decision  +  STT partial emission  +  command-claim decision
        (10–32ms)         (<1–3ms)          (100–300ms typ.)        (0–80ms model infer)
```

The *dominant, controllable* term is **end-of-speech / turn latency** — i.e. how long you
wait after the user stops before you "commit." Silence-timer endpointing adds its entire
timeout (e.g. 800ms) to every utterance. The whole point of semantic turn detection and
mid-utterance command claiming is to **act before the trailing silence even begins**, removing
that 500–800ms tax. For commands specifically, you can often skip waiting for end-of-turn
entirely (see §6).

Three distinct jobs, do not conflate them:
- **VAD** — is there speech energy in this frame right now? (ms-scale, acoustic)
- **Endpointing / EOU** — has the *utterance* ended? (silence-timer or semantic)
- **Command claiming** — does the streaming partial *contain a command* I can extract now?

---

## 2. Client-side VAD options (acoustic, frame-level)

| Engine | Frame size | Per-frame infer | Footprint | Accuracy (TPR @ FPR) | Browser? | Tunable |
|---|---|---|---|---|---|---|
| **Silero VAD v5** (ONNX) | **512 samp @16kHz = 32ms** (hard requirement in v5; 256@8kHz) | <1ms native CPU; ONNX ~10% faster than v5 TorchScript, 2–3x faster than PyTorch on short chunks | ~2MB ONNX (v5 is 2x v4's 1MB) | 87.7% @5%FPR; 80.4% @1%FPR (Picovoice indep.); RTF 0.00429 on Ryzen 9 5900X | **Yes** — onnxruntime-web WASM (e.g. 1.22.0). WASM latency > native but still real-time; 32ms frame dominates | prob 0–1; thresholds |
| **@ricky0123/vad-web** | wraps Silero (v5 = 512 samp) | as Silero | Silero model + ~small JS | inherits Silero | **Yes, purpose-built** | `positiveSpeechThreshold`, `negativeSpeechThreshold`, `redemptionFrames`/`redemptionMs`, `minSpeechFrames`/`minSpeechMs`, `preSpeechPad*` |
| **TEN-VAD** (open source, Apache) | frame-level, hop configurable | **RTF 0.015 on AMD Ryzen** (vendor) | **306KB lib** | "best precision" vs Silero & WebRTC on PR curve (vendor testset: librispeech/gigaspeech/DNS) | **Yes — WASM build shipped** + C (Linux/Win/macOS/Android/iOS) + Python | probability threshold |
| **WebRTC VAD** (GMM) | **10 / 20 / 30ms** | trivial (energy + ZCR + spectral, GMM) | tiny | **50% @5%FPR** (misses 1 in 2 frames!) | Yes (legacy, ubiquitous) | aggressiveness mode 0–3 (0=quality, 3=very aggressive); 16-bit PCM only |
| **Cobra** (Picovoice, commercial) | frame-level | **RTF 0.000399 on Ryzen 9 5900X**; ~5% CPU on Pi Zero | tiny on-device | **98.9% @5%FPR (1 miss/100); 95% @1%FPR** — best of the four | Yes (Web SDK) | probability 0–1, fine threshold control |

### Key takeaways
- **TEN-VAD's headline advantage is end-of-speech latency**, not just precision: it detects
  speech→non-speech transitions much faster than Silero, which lags "several hundred ms" and
  *misses short inter-word silences*. For a dictation system where you segment on pauses, that
  Silero tail directly inflates latency. (Source = TEN/Agora vendor benchmarks; corroborate on your audio.)
- **WebRTC VAD is the latency floor but the accuracy floor too** — 50% TPR @5%FPR is unusable
  as a sole gate in a noisy reading room. Use only as a cheap pre-gate, never alone.
- **Cobra has the best precision/recall** but is commercial (Picovoice license) and on-device.
- **Silero v5 / @ricky0123/vad-web is the pragmatic browser default**: free, MIT, runs in
  onnxruntime-web, huge community, and the `@ricky0123` wrapper exposes exactly the state-machine
  knobs you need.

### @ricky0123/vad-web tuning (the knobs that matter)
State machine: enter "speaking" when prob > `positiveSpeechThreshold`; end segment after
`redemptionFrames`/`redemptionMs` of prob < `negativeSpeechThreshold`; discard segments shorter
than `minSpeechFrames`/`minSpeechMs` (fires `onVADMisfire`). Frames between the two thresholds
are ignored (hysteresis).
- Defaults (ms API ≥ v0.0.27): `positiveSpeechThreshold` 0.3, `negativeSpeechThreshold` 0.25.
- Silero convention: negative = positive − 0.15.
- **API change**: ≤ v0.0.26 used frames (`redemptionFrames`, `minSpeechFrames`); **≥ v0.0.27
  switched to ms** (`redemptionMs`, `minSpeechMs`, `preSpeechPadMs`) and `frameSamples` is no
  longer settable (fixed to 512 for v5). Check your installed version. Don't override `frameSamples` on v5.
- Lower `redemptionMs` → faster end-of-segment but more chopping; this knob is your direct
  segment-latency lever on the client.

---

## 3. Endpointing / end-of-utterance (silence-timer, server STT)

**Deepgram** — two independent, complementary mechanisms; use both:

- **`endpointing=<ms>`** (VAD-based): fires `speech_final=true` after N ms of silence post-speech.
  - Default `endpointing=true` ≈ **10ms** silence (extremely low latency, but noise-fragile).
  - Limitation: background noise can prevent `speech_final` ever firing.
  - Latency lever: lower = faster + more false triggers; higher = reliable + slower.
- **`utterance_end_ms=<N>`** (word-timing gap): emits `UtteranceEnd` after an N-ms gap between
  *transcribed words*. Noise-resistant fallback. Requires `interim_results=true`.
  - **Resolution ~1s** — recommended ≥1000ms; so it inherently adds ≥1s when relied on.
  - Self-hosted: minimum = your step size (e.g. 200ms step → min 200).
- **Recommended combine logic:** trigger on `speech_final` if it arrives (fast path); else fall
  back to `UtteranceEnd` (noise path). `speech_final` fires first (10s–100s of ms); `UtteranceEnd`
  follows (>1s). `UtteranceEnd` carries `last_word_end` (-1 ⇒ already finalized, ignore).
- **Latency caveat:** with `smart_format=true`, Deepgram may *deliberately wait* for more audio
  on numeric/formatted content (e.g. phone numbers) — relevant for measurement/accession numbers
  in radiology. Consider disabling smart_format on the command path.

Common chatbot config (balance): `endpointing: 800, utterance_end_ms: 2000, interim_results: true`.
**For lowest latency on the command path you want the opposite** — small endpointing and don't
rely on UtteranceEnd to trigger commands (see §6: claim commands off partials, not on EOU).

**Fixed vs adaptive:** fixed silence timeouts are simple but apply the whole timeout to every
turn. Adaptive/context-tuned silence (short for short answers, long when the user is thinking)
reduces false cut-offs. Real-world barge-in tuning: `MinSilenceDuration ≈ 200ms` reacts fast
without too many false triggers. But the real latency win is replacing the silence timer with a
semantic model (§4).

---

## 4. Semantic turn detection / "smart turn" (the cutting edge)

These predict *"is the person DONE?"* from prosody and/or text, so you can commit **before** the
trailing silence — the single biggest latency lever after VAD.

| Model | Input | Params / size | Inference latency | Languages | License | Notes |
|---|---|---|---|---|---|---|
| **Pipecat Smart Turn v3 / v3.1** | **native audio** (16kHz mono PCM, ≤8s) | ~8M; **8MB int8 CPU**, 32MB fp32 GPU | **12ms on modern CPU** (incl. ~3ms preprocess); **60–65ms** on low-cost AWS / Pipecat Cloud 1x; 100x faster than v2 on c8g.medium | 23 (v3.1) | **BSD-2 (fully open: weights+data+training)** | Base = **Whisper Tiny + linear head** (v1/v2 were wav2vec2 / wav2vec2-BERT). Outputs single prob; ≥0.5 = done. Use *with* a light VAD like Silero. `LocalSmartTurnAnalyzerV3` in Pipecat ≥0.0.85 |
| **Pipecat Smart Turn v2** | native audio | ~95M; ~360MB safetensors, ~60MB runtime | **~400ms** (community) | 14 | BSD-2 | wav2vec2 + linear. Superseded by v3 |
| **LiveKit turn-detector** | **text** (transcript) | v0.3 = 135M SmolLM2; **current = Qwen2.5-0.5B distilled from 7B teacher** | **~50ms CPU** | multilingual (intl) | open weights | Predicts P(`<|im_end|>`); per-language thresholds in `languages.json`; sliding window = last 4 turns. v0.4.1-intl: **−39% false-positive interruptions, no latency increase** vs v0.3.0. **Text-only ⇒ can't use with audio-native models; needs STT first** |
| **Krisp Turn Prediction v3** (VIVA 2.0) | **native audio** | **6.1M params, 65MB, CPU-optimized** | low (CPU real-time; audio-first = no per-language STT) | multilingual | commercial SDK | Audio-first ⇒ uses prosody/pitch/pausing lost in transcripts; ships Interruption Prediction v1 + backchannel handling. Reports 3.5x turn-taking accuracy. Embedded in Daily/Vapi/LiveKit/Telnyx |

### Audio-native vs text-based — the core tradeoff
- **Audio-native (Smart Turn v3, Krisp):** captures prosody, intonation, filler words ("um",
  "hmm" — which STT often drops), trailing-pitch cues. Language-agnostic, no STT dependency on
  the turn path. **Best for "did they pause to think vs. finish?"** Smart Turn v3 at **12ms CPU**
  is the standout — small, free, runnable client- or edge-side.
- **Text-based (LiveKit):** understands *semantic/format completeness* — e.g. won't cut off
  mid-phone-number or mid-list because the text isn't grammatically complete. Needs STT first,
  so it inherits STT latency. v0.4.1 explicitly fixed premature cutoff on digit sequences
  (relevant to radiology measurements/accession numbers).
- **Best accuracy = combine both signals.** Recent papers (Easy Turn, hierarchical EOU) fuse
  acoustic + linguistic modalities; that's the research frontier (§7).

---

## 5. Wake-word / hotword (optional, for scoping commands)

| Engine | Latency / cost | Accuracy | License |
|---|---|---|---|
| **Picovoice Porcupine** | bounded by frame; 6.5x more efficient than Snowboy; runtime measured on RPi 5 | **97%+ detection, <1 false alarm / 10h** in noise | commercial |
| **openWakeWord** | open-source, good accuracy | needs ML knowledge to train custom words | Apache (open) |

For radiology, a wake word ("Hey PowerScribe"-style — that exact pattern is used in Nuance/MS
PowerScribe One) is a **clean way to scope commands** and eliminate dictation/command ambiguity
at the cost of one extra spoken token (~200–400ms of speech). Porcupine's <1 false-alarm/10h is
the relevant spec for an always-on mic. **Recommendation: support an optional wake word for
*destructive/ambiguous* commands, but don't require it for common inline commands** — that's the
latency/UX win of mid-utterance claiming (§6).

---

## 6. RECOMMENDED ARCHITECTURE — separating continuous dictation from commands with mid-utterance claiming

Goal: user dictates continuously; commands ("new paragraph", "go to findings", "delete
that", "insert template chest CT", "sign report") are detected from streaming partials, **claimed
before the utterance ends**, executed, and **stripped from the final dictation text**.

### 6.1 Pipeline (cascaded, fully streaming, stages overlap)

```
mic ─► [WebRTC/Silero pre-gate] ─► [Silero v5 / @ricky0123/vad-web] ─► streaming STT (interim+final)
                                                                              │
                              ┌───────────────────────────────────────────────┤ partial deltas
                              ▼                                                ▼
                   [Command Claimer]  ◄── runs on EVERY interim          [Dictation buffer]
                   (grammar + tiny LLM/classifier)                       (accumulates final words)
                              │ claim?                                          │
                              ▼                                                 ▼
                   execute command + mark span                        on EOU (Smart Turn v3 /
                   "claimed" → REMOVE from dictation buffer            speech_final) → finalize text
```

Two parallel consumers of the same partial-transcript stream: a **dictation accumulator** and a
**command claimer**. They share a span-level "claimed" map so claimed words never reach the report.

### 6.2 The claiming mechanism (mid-utterance)

1. **Pre-gate (acoustic):** WebRTC VAD mode 2–3 or Silero gates the mic cheaply; Silero v5
   (32ms frames) is the real speech segmenter. Pre-roll `preSpeechPadMs` so command onsets aren't clipped.
2. **Streaming STT** emits interim partials (Deepgram `interim_results=true`, ~100–300ms cadence).
   Disable `smart_format` on the command path to avoid the numeric-wait stall.
3. **Command Claimer runs on each interim delta** (not on EOU — this is what beats the silence tax):
   - **Tier 1 — grammar / trie match (sub-ms):** a finite command grammar (PowerScribe-style
     fixed phrases: "new line", "next field", "scratch that", "select template X"). This is the
     proven approach (embedded command grammar within a contiguous utterance — see patents in
     Sources). Deterministic, near-zero latency, near-zero false-trigger when phrases are distinctive.
   - **Tier 2 — tiny streaming intent classifier / small LLM (0–80ms):** for fuzzier/parameterized
     commands ("compare to the prior from March", "measure that lesion"). Use a **wait policy**
     (wait-k / confidence threshold) to decide when a partial is *complete enough* to claim,
     since output must be produced before the utterance ends. Claim only above a confidence floor.
4. **Claim + strip:** when a command is claimed, record its **character/word span** in the
   transcript, execute the action, and **subtract that span from the dictation buffer** so it
   never lands in the report. Use STT word-level timestamps to align the span precisely. Keep an
   undo log keyed by span (radiology = medico-legal; never silently lose text).
5. **Disambiguation guards** (avoid claiming dictated medical prose as a command):
   - Optional lightweight **wake/scope token** for destructive ops ("sign report", "delete
     section") — borrow PowerScribe's "Hey PowerScribe" pattern; Porcupine <1 FA/10h.
   - Or a **push-to-command modifier** (PowerMic button / touch) — the proven mode-switch signal
     (Google STT, Nuance PowerMic, patents all use an explicit mode signal). Touch/keypress while
     speaking ⇒ treat as command, else dictation.
   - **Confirmation for irreversible actions**; inline non-destructive commands fire immediately.
6. **End-of-utterance / finalize:** run **Smart Turn v3 (12ms CPU)** on the current turn audio
   to decide *done vs. thinking*, replacing or backstopping the silence timer. Backstop with
   Deepgram `speech_final` (low `endpointing`, e.g. 100–300ms) and `UtteranceEnd` as the
   noise-proof fallback. The user's "...the lesion measures, uh..." pause won't prematurely
   finalize because Smart Turn's prosody model holds the turn open.
7. **Barge-in / always-on:** keep VAD + claimer running even while TTS/feedback plays; on speech
   onset stop playback, clear buffers, switch to listening (sub-100–300ms target). Mandatory
   **acoustic echo cancellation** so the system's own audio/feedback doesn't false-trigger VAD or
   pollute STT.

### 6.3 Concrete recommended stack & latency

- **Acoustic VAD:** `@ricky0123/vad-web` (Silero v5, 32ms frames) in onnxruntime-web. Tune
  `positiveSpeechThreshold ~0.5`, low `redemptionMs` (~200–300ms) for snappy segmentation.
  Optionally swap in **TEN-VAD WASM** (306KB, faster end-of-speech) if Silero's tail hurts.
- **STT:** Deepgram streaming, `interim_results=true`, `endpointing≈150ms`, `utterance_end_ms=1000`
  (noise fallback only), `smart_format=false` on command path.
- **Command claim:** Tier-1 grammar/trie (sub-ms) + Tier-2 small streaming classifier (≤80ms),
  claim-and-strip on partials.
- **Turn/EOU:** **Smart Turn v3.1** (12ms CPU, 8MB, BSD-2) as primary semantic gate;
  `speech_final` + `UtteranceEnd` as backstops.
- **Optional scope:** Porcupine or openWakeWord for destructive commands only.

**Resulting command responsiveness:** command claimed from a partial typically within one STT
interim cycle (~100–300ms after the command words are spoken) + ≤80ms claim decision — i.e.
**~150–400ms, and crucially BEFORE the user stops talking**, vs. ~800–1000ms+ if you wait for a
silence-timer endpoint. End-of-dictation finalize gated semantically in ~12ms of model time
instead of a fixed 500–800ms silence wait.

---

## 7. Deeper research paths / open questions

- **Fuse acoustic + linguistic turn signals.** Smart Turn (audio) + LiveKit (text) catch
  different failure modes. Papers to read:
  - *Easy Turn: Integrating Acoustic and Linguistic Modalities for Robust [turn detection]* —
    arXiv 2509.23938.
  - *A Hierarchical End-of-Turn Model with Primary Speaker Segmentation for Real-Time
    Conversational AI* — arXiv 2603.13379 (also addresses primary-speaker isolation, relevant to
    a noisy reading room with multiple voices).
  - *Window Size Versus Accuracy Experiments in Voice Activity Detectors* — arXiv 2601.17270
    (directly informs the frame-size/latency tradeoff).
- **Wait-policy design for claiming.** wait-k vs. learned continuous-integrate-and-fire (CIF) for
  deciding when a partial is "complete enough" to claim a command without premature trigger —
  quantify false-claim rate vs. claim latency on real radiology dictation.
- **Numeric/measurement handling.** Smart_format and turn models both behave specially around
  digits (Deepgram waits; LiveKit v0.4.1 fixed premature cutoff on digit sequences). Radiology is
  measurement-heavy — needs dedicated eval on accession numbers, sizes, dates.
- **TEN-VAD independent benchmarking.** Most TEN-VAD latency/precision claims are vendor
  (TEN/Agora). Reproduce their open-source PR-curve script on your own annotated radiology audio
  before committing; verify the "faster end-of-speech than Silero" claim on your data.
- **Browser-WASM latency gap.** All Silero/TEN per-frame numbers above are native CPU. Benchmark
  onnxruntime-web WASM (and WebGPU if available) on the users' actual workstations — WASM
  varies a lot by browser/hardware and the 32ms frame is the floor.
- **Echo cancellation + always-on.** AEC quality directly bounds false-barge-in / false-claim
  rate. Evaluate WebRTC AEC vs. Krisp's noise/echo suppression for the reading-room environment.
- **On-device privacy.** PHI in audio ⇒ prefer client/edge inference (Silero/TEN/Smart Turn v3 all
  run on CPU/WASM client-side; Cobra/Porcupine/Krisp are on-device). Weigh against cloud STT
  (Deepgram) accuracy — a self-hosted Deepgram or on-prem STT may be required for compliance.
- **Krisp VIVA SDK eval.** Audio-first multilingual turn + interruption + backchannel in one 65MB
  CPU model is attractive if the commercial license fits; benchmark its latency head-to-head with
  Smart Turn v3.

---

## Sources

VAD:
- Silero VAD GitHub & v5 discussion: https://github.com/snakers4/silero-vad , https://github.com/snakers4/silero-vad/discussions/471
- @ricky0123/vad docs (algorithm) & repo: https://docs.vad.ricky0123.com/user-guide/algorithm/ , https://github.com/ricky0123/vad , https://github.com/ricky0123/vad/blob/master/docs/user-guide/silero-v5.md
- TEN-VAD: https://github.com/TEN-framework/ten-vad , https://huggingface.co/TEN-framework/ten-vad , https://www.agora.io/en/blog/making-voice-ai-agents-more-human-with-ten-vad-and-turn-detection/
- Picovoice VAD comparison (Cobra/Silero/WebRTC, TPR@FPR, RTF): https://picovoice.ai/blog/best-voice-activity-detection-vad/ , https://picovoice.ai/blog/complete-guide-voice-activity-detection-vad/
- WebRTC VAD (modes 0–3, 10/20/30ms frames, GMM): https://github.com/wiseman/py-webrtcvad , https://www.videosdk.live/developer-hub/webrtc/webrtc-voice-activity-detection

Endpointing:
- Deepgram Endpointing: https://developers.deepgram.com/docs/endpointing
- Deepgram Utterance End: https://developers.deepgram.com/docs/utterance-end
- Deepgram end-of-speech while streaming: https://developers.deepgram.com/docs/understanding-end-of-speech-detection-while-streaming

Semantic turn detection:
- Pipecat Smart Turn v3 (12ms CPU): https://www.daily.co/blog/announcing-smart-turn-v3-with-cpu-inference-in-just-12ms/ ; v3.1: https://www.daily.co/blog/improved-accuracy-in-smart-turn-v3-1/ ; v2: https://www.daily.co/blog/smart-turn-v2-faster-inference-and-13-new-languages-for-voice-ai/ ; weights/code: https://huggingface.co/pipecat-ai/smart-turn-v3 , https://github.com/pipecat-ai/smart-turn
- LiveKit turn detector: https://huggingface.co/livekit/turn-detector , https://livekit.com/blog/turn-detection-voice-agents-vad-endpointing-model-based-detection , https://livekit.com/blog/improved-end-of-turn-model-cuts-voice-ai-interruptions-39 , https://docs.livekit.io/agents/logic/turns/turn-detector/
- Krisp turn-taking: https://krisp.ai/blog/turn-taking-for-voice-ai/ , https://krisp.ai/blog/krisp-turn-taking-v2-voice-ai-viva-sdk/ , https://krisp.ai/blog/viva-2-0-ai-infrastructure-for-voice-ai-agents/

Wake word:
- Porcupine benchmark: https://picovoice.ai/docs/benchmark/wake-word-porcupine/ ; https://picovoice.ai/blog/complete-guide-to-wake-word/ ; benchmark repo: https://github.com/Picovoice/wake-word-benchmark

Dictation/command separation, barge-in, streaming claim:
- Embedded command grammar / mode-switch patents: https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6871179 , https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/7260529 , https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12106758
- Google medical STT inline bracketed commands: https://docs.cloud.google.com/speech-to-text/docs/v1/medical-models
- Corti command-and-control STT endpoint: https://www.corti.ai/speech-to-text
- Nuance/MS PowerScribe One voice commands ("Hey PowerScribe"): https://www.itnonline.com/content/nuance-transforms-radiology-reporting-major-ai-and-ambient-enhancements
- Barge-in / always-on architecture: https://sparkco.ai/blog/optimizing-voice-agent-barge-in-detection-for-2025 , https://orga-ai.com/blog/blog-barge-in-voice-agents-guide
- Streaming partial-transcript intent / wait policies: https://arxiv.org/html/2508.04721v1 , https://arxiv.org/html/2605.14766 , https://deepgram.com/learn/low-latency-voice-ai

Papers (deeper paths):
- Easy Turn (acoustic+linguistic): https://arxiv.org/pdf/2509.23938
- Hierarchical EOU + primary speaker segmentation: https://arxiv.org/pdf/2603.13379
- VAD window size vs accuracy: https://arxiv.org/pdf/2601.17270
- Scalable offline ASR for command-style dictation: https://arxiv.org/pdf/2507.01021
