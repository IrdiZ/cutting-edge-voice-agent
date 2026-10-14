# 04 — Latency Engineering & Real-Time Voice-Agent Frameworks

**Stream:** End-to-end latency engineering patterns + real-time voice-agent frameworks/infrastructure.
**Use case:** Dictation-heavy reporting cockpit. Always-on continuous listening. **COMMAND** dispatch (not free-form conversation). Next.js/React/TS frontend. Cloud allowed under BAA. **Latency is priority #1.**
**Date:** May 2026. Numbers below are 2024–2026 unless noted; treat vendor self-benchmarks as directional.

---

## TL;DR verdict

- **Transport:** WebRTC for the mic→cloud hop. Not WebSocket, not gRPC-web. WebRTC (UDP + Opus + adaptive jitter buffer + PLC + FEC) is the only transport that fails gracefully on packet loss; WebSocket/TCP suffers head-of-line blocking that stalls audio for 100ms–seconds on a single lost packet.
- **Architecture:** Streaming **cascade** — AudioWorklet capture → WebRTC → turn-aware streaming STT (Deepgram Flux/Nova-3) → intent classifier/LLM → action. **Do NOT use a speech-to-speech (S2S) model** like the OpenAI Realtime API or Ultravox: those are optimized for spoken *replies*, which a command cockpit does not need. You want a transcript/intent, not synthesized speech.
- **Build vs adopt:** **Adopt a framework's transport + STT plumbing, build the command/intent layer.** Specifically: take LiveKit Agents (or Pipecat) **only for WebRTC transport, VAD, and STT orchestration**, and replace the LLM→TTS reply tail with your own low-latency intent→action dispatch. Do not adopt an end-to-end conversational platform (Vapi/Retell) — they are tuned for telephony conversations and carry a TTS reply stage you must rip out anyway.
- **The single biggest lever for a command app:** because you don't speak a reply, your "mouth-to-action" budget excludes TTS (typically 100–300ms first-byte) and most of LLM generation. Realistic target: **150–400ms from end-of-word to action highlight**, far below the 800ms–1.7s conversational medians.

---

## 1. Real-time voice-agent frameworks (numbers + trade-offs)

| Framework | Architecture / transport | Reported end-to-end latency | Notes for a COMMAND use case |
|---|---|---|---|
| **LiveKit Agents** | Open-source WebRTC SFU + Python agents framework. Streaming sequential pipeline (VAD→STT→LLM→TTS). 1.0 in Apr 2025; ~1.5.x by Apr 2026 with adaptive interruption + native MCP tools. **Preemptive generation on by default** (speculative LLM before end-of-turn). | Production medians ~1.3–1.7s voice-to-voice; tuned stacks (Groq LLM + Deepgram STT + Cartesia TTS) ~1.3–1.4s. p99 3–5s. Those numbers include TTS — strip it for commands. | Strongest WebRTC-first option. Powers OpenAI ChatGPT Voice, Meta, Character.ai. Use it for transport + STT + turn detection; bypass the TTS tail. Built-in test tooling is text-only (does not exercise audio path) — you must add WebRTC latency instrumentation. |
| **Pipecat (Daily)** | Open-source Python pipeline framework, transport-flexible. Daily Cloud WebRTC, **SmallWebRTCTransport** (P2P, aiortc, free, 1:1 only), WebSocket, SIP. Co-founder explicitly says **WebRTC > WebSocket for production edge audio**. | Modal + Pipecat + open models: **median ~1s** voice-to-voice self-hosted; optimized cloud ~600ms. Cold-start greeting 4–5s is a known wart. | More control, more turn-taking work to do yourself. `preemptive_generation` flag proposed (issue #3321), not yet shipped → ~200–400ms/turn left on table. v0.0.62+ SmallWebRTCTransport had robotic-audio regression — verify current. |
| **OpenAI Realtime / `gpt-realtime`** | **Speech-to-speech** single model over WebRTC (client connects directly to OpenAI media edge; your backend is control-plane only, mints session, no audio proxy). Uses ICE Trickle to start media before full handshake (saves hundreds of ms). | First partial text ~150–250ms; first audible speech ~220–400ms. Production e-commerce case ~480–520ms round trip, text streaming at ~180ms. STUN RTT ~60–70ms (theoretical floor). | Fast, but **wrong shape for commands**: you pay for and wait on audio generation you don't want. The ~180ms first-partial-text is the interesting number — but you can get equivalent partials from a streaming STT without the S2S model. Could be useful only if you later add spoken confirmations. |
| **Ultravox** | Open-weight **speech-native SLM** (no ASR stage; audio → tokens directly). Pipecat integration exists. | ~900ms end-to-end; ~40% lower latency than 3-component cascade; matches their quality. | Eliminates ASR handoff but "fewer levers." Open question (arXiv 2602.17598): speech LLMs may converge on implicit text representations anyway. Again S2S — not command-shaped. Interesting if you want a single model that maps audio→structured intent directly; would need custom training. |
| **Vapi** | Provider-agnostic orchestration (Deepgram STT + OpenAI LLM + ElevenLabs TTS + Twilio), 14+ swappable providers. $0.05/min + provider costs. 62M calls/mo, 99.99% SLA. | Default 800–1200ms; <500ms only with expert tuning. | Telephony-conversation product. Convenient but you'd fight its conversational/TTS assumptions. Not a fit for a browser command cockpit. |
| **Retell** | Vertically integrated, own turn-taking model, TTS via ElevenLabs/OpenAI/Cartesia/PlayHT with fallback. | Independent benchmarks ~620–800ms. | Consistent latency, low eng effort, but again telephony-conversation shaped + TTS tail. Not a fit. |

**Reading the table for radiology commands:** every conversational number above (~600ms–1.7s) is dominated by LLM-generates-a-sentence + TTS-speaks-it. A command cockpit's action fires at the *intent* boundary, so the relevant sub-budget is **STT partial/final + intent classification**, which is a fraction of those totals.

---

## 2. Recommended transport + pipeline architecture

```
[Browser, Next.js/React]
 getUserMedia({audio:{channelCount:1, echoCancellation,
                      noiseSuppression, autoGainControl, sampleRate:48000}})
   │  (HTTPS / secure context; resume AudioContext inside a user gesture — iOS Safari)
   ▼
 MediaStreamAudioSourceNode → AudioWorkletNode   (NOT ScriptProcessorNode — deprecated,
   │   128-sample blocks (~2.7ms @48k), ring-buffer to ~20ms frames    main-thread, glitches)
   ▼   transfer via SharedArrayBuffer / postMessage transferable
 [Opus encode]  prefer native WebCodecs AudioEncoder (codec:'opus');
   │            fall back to WASM (opus-encdec rawOpus) only where WebCodecs absent
   ▼
 ===== WebRTC (UDP, Opus 20ms frames, in-band FEC + NACK, NetEQ jitter buffer) =====
   │   ICE Trickle to start media before full handshake
   ▼
 [Regional/edge media termination, co-located with STT]
   ▼
 Turn-aware streaming STT  (Deepgram Flux = WebSocket-only, turn-aware ASR built for
   │   voice agents; or Nova-3 sub-300ms streaming) — emits interim (is_final:false),
   │   final (is_final:true), and end-of-turn events
   ▼  interim partials stream continuously
 Intent layer  (run in parallel — see §3):
   ├─ (a) deterministic grammar/keyword matcher on partials  (≈0ms model time)
   ├─ (b) small semantic classifier / embedding match on partials
   └─ (c) LLM/tool-call only for ambiguous/complex commands
   ▼  take FIRST confident result
 ACTION dispatched to the cockpit (highlight field, insert macro, navigate, etc.)
```

**Transport rationale (concrete):**
- **WebRTC wins** because a lost 20ms Opus frame is reconstructed by PLC/comfort-noise and is nearly imperceptible, whereas a WebSocket/TCP loss triggers head-of-line blocking: at 100ms RTT a single loss adds ≥100ms; under congestion TCP backoff stretches to seconds (sawtooth latency). WebRTC NetEQ does **not** block waiting for retransmission; it conceals and keeps flowing. Native Opus in-band FEC + RED + NACK available.
- **Opus frame size:** 20ms is the standard real-time frame. Browser AudioWorklet delivers ~128 samples (~2.7ms @48kHz) per `process()` call; accumulate into 20ms before encoding/sending. Opus always encodes at 48kHz internally.
- **Mic chunking to STT:** 100ms frames give optimal latency on stable links; degrade to ~200ms only when the network is bad (Deepgram reports ~40% latency increase at 250ms). `linear16` PCM has zero client encode overhead; Opus saves bandwidth at a small encode cost — over WebRTC you get Opus essentially for free.
- **WebSocket has one legitimate role:** server↔server (your media edge ↔ STT vendor, e.g. Deepgram Flux is WebSocket-only). Never use WebSocket for the browser→cloud edge hop.
- **gRPC-web:** not appropriate for streaming mic media — it rides HTTP/2 over TCP (same HOL-blocking problem) and lacks WebRTC's media resilience. Skip.

**Browser audio specifics:**
- AudioWorklet runs off the main thread → no contention with React render; ScriptProcessorNode is deprecated, main-thread, high buffer sizes, audible glitches under load.
- For always-on listening: keep the AudioContext + worklet + WebRTC connection persistent for the whole session; never tear down between commands (connection setup = DNS+TCP+TLS+upgrade for WS, or full ICE for a cold WebRTC peer — hundreds of ms you pay once, not per command).
- iOS Safari: AudioContext starts suspended; `resume()` inside a click handler.

---

## 3. Perceived-latency techniques (table with expected savings)

| Technique | What it does | Expected saving | Trade-off / caveat |
|---|---|---|---|
| **Do work before end-of-speech (preemptive/speculative LLM)** | Start LLM/intent on partial transcripts before VAD confirms end-of-turn. PredGen (arXiv 2506.15556) reports **~2× latency reduction** using otherwise-idle GPU. LiveKit ships it on by default. | **200–400ms/turn**; up to ~2× on LLM stage | Wasted compute on discarded speculations. Backfires on code-switching / long utterances where partials are wrong (ByondLabs). For terse, predictable commands this is a *strong* win. |
| **Parallel cascade (fire grammar + semantic + LLM simultaneously, take first confident)** | Run a deterministic command-grammar matcher, a small classifier, and an LLM concurrently on the same partial; accept the first high-confidence hit. | Collapses intent stage to **max(stages)** instead of sum; common commands resolve at grammar speed (≈0 model ms) | More compute; need a confidence/voting policy. Ideal for a fixed radiology command vocabulary. |
| **Streaming partial results** | Show/act on interim STT (`is_final:false`) instead of waiting for finals. | Finals are intentionally delayed by endpointing (≥700ms accuracy floor per Speechmatics); partials arrive ~1s earlier | Partials can change. Use for UI feedback + speculative intent; commit action on confidence threshold, not on every partial. |
| **Turn-aware STT (offload EOT to the ASR)** | Deepgram Flux / similar emit end-of-turn directly, removing a separate VAD-silence wait. | Removes a discrete endpointing step (silence-based VAD typically 200–800ms tuned) | Model-specific; Flux is WebSocket-only and streaming-only. |
| **Persistent connections (no per-command setup)** | Keep WebRTC peer + STT WebSocket warm for the whole session via connection pooling. | One-time connection cost (hundreds of ms) amortized to ~0 per command | Must handle reconnection/keepalive. |
| **Pre-warm / warm pools for serverless** | Provisioned concurrency / warm pools / ring-time WebSocket pre-warm. Cold serverless LLM first token can exceed 40s vs ~30ms/token warm (1000× gap). MPC scheduling: up to 85% lower tail latency. | Eliminates multi-second→tens-of-second cold-start tail | Idle cost. For always-on radiology, prefer **always-on** compute over scale-to-zero. |
| **Co-locate compute with STT vendor / regional endpoints** | Terminate WebRTC media, STT, and intent in the same region/data center. Cloudflare colocated stack: TTFB <200ms, full v2v 350–500ms. | Removes cross-region tax: STT round-trip ~180ms + region-locked LLM ~220ms can otherwise blow a 500ms budget | Self-host STT (AWS SageMaker / Deepgram self-hosted) for the tightest path. |
| **ICE Trickle / early media** | Begin media flow before full SDP/ICE completes. | Hundreds of ms off initial handshake | Setup-time only; matters for first command after connect. |
| **Speculative tool calling + filler** | Run tool execution in parallel with a spoken/visual acknowledgment; "hide latency behind speech." | Hides backend latency; user perceives instant response | More relevant if you add audio confirmations; for a visual cockpit, optimistic UI highlight serves the same role. |
| **Optimistic UI / optimistic execution** | Apply the action in the UI immediately on high-confidence partial, roll back if the final disagrees. | Perceived latency → near-zero for confident commands | Need cheap rollback; risky for irreversible actions (don't optimistically sign a report). |

---

## 4. Edge / deployment

- **Cloudflare Realtime (WebRTC SFU) + Workers AI** is the most integrated "everything in one data center" play: STT (Deepgram Nova-3 / Aura-2 / **Flux** turn-aware, all on Workers AI bindings), LLM, TTS, and media terminate at the same edge node the browser connects to. Reported TTFB <200ms, v2v 350–500ms. Caveat: a single Worker is capped at 30s CPU / 128MB — long-lived/always-on sessions **must** use Durable Objects + WebSocket hibernation.
- **Vercel Edge / AI SDK:** Workers AI is usable via `workers-ai-provider` for the Vercel AI SDK incl. `createWorkersAiTranscription`. Fine for the Next.js control plane; not where you want to terminate media.
- **General rule:** the latency is in the *hops between services in different places*, not raw model time. Minimize cross-region handoffs; self-host or co-locate STT; keep the LLM/intent in the same region as STT.
- **BAA/compliance note (radiology):** Cloudflare, Azure (Nuance/Dragon), Deepgram, and the major clouds offer BAAs. Verify each component's BAA before adopting — this constrains which regional endpoints you may use and may force self-hosting some pieces.

---

## 5. Domain benchmark context (radiology / dictation)

- **Nuance PowerScribe One** (Microsoft) is the incumbent: Dragon engine, end-to-end model, "ambient mode" structured reporting, extensive voice-command grammar ("what can I say", PowerMic, AutoText). Microsoft consolidated it under **Dragon Copilot** (2024–2025), bundling Dragon Medical One + DAX ambient AI + GPT-4.
- **Rad AI** (Dec 1, 2025) launched next-gen speech recognition explicitly marketing **"sub-second, latency-free transcription"** + real-time analytics + clinical-context understanding — confirming latency is now the competitive battleground in this exact vertical. (No independent ms breakdown published yet.)
- **Implication:** the bar a cutting-edge cockpit must beat is "sub-second, feels instant." With a command (not conversation) pipeline and the §3 techniques, **150–400ms mouth-to-action** is achievable and would be category-leading.

---

## 6. Published mouth-to-action / voice-to-voice benchmarks (consolidated)

| Stack / source | Number | What it measures |
|---|---|---|
| Human conversation | ~200ms median inter-turn gap | Reference for "feels human" |
| UX thresholds (industry) | <300ms human · 300–600ms acceptable · >600ms sluggish · >1.5s abandon | Perceived |
| LiveKit production (2025–26) | median 1.4–1.7s, p99 3–5s; tuned ~1.3–1.4s | v2v incl. TTS |
| Pipecat + Modal + open models | ~1s median; ~600ms optimized cloud | v2v incl. TTS |
| OpenAI Realtime (WebRTC) | first partial text ~150–250ms; first speech ~220–400ms; e-comm case ~480–520ms | partials / v2v |
| Ultravox (S2S) | ~900ms; −40% vs cascade | v2v |
| Vapi | 800–1200ms default; <500ms tuned | v2v incl. TTS |
| Retell | ~620–800ms | v2v incl. TTS |
| Cloudflare colocated | TTFB <200ms; v2v 350–500ms | v2v incl. TTS |
| Deepgram Nova-3 streaming | sub-300ms per-message; Flux turn-aware EOT | STT transcript latency (≠ EOT) |
| WebRTC STUN RTT floor (OpenAI edge, Jan 2025) | ~60–70ms | network lower bound |
| Pure WebRTC human-to-human | 60–120ms mouth-to-ear | transport only |

**Key measurement caveat:** there is **no standardized industry voice-agent benchmark** (webrtcHacks). Numbers come from different hardware/networks/dates — directional, not comparable. Also: **transcript latency ≠ end-of-turn latency** (Deepgram) — finals are deliberately delayed by endpointing; measure them separately. Instrument your own stack with WebRTC data-channel ping RTT (P50/P95/P99, jitter, loss) — LiveKit's built-in tests are text-only and skip the audio path.

---

## 7. Build vs adopt — recommendation for a command cockpit

**Adopt the transport + STT plumbing; build the command/intent + action layer.**

- **Take from a framework (LiveKit Agents preferred, Pipecat as alternative):** WebRTC SFU/transport, NetEQ jitter buffering, VAD, STT session management, reconnection, observability hooks. This is hard, undifferentiated infrastructure — do not rebuild it.
- **Build yourself:** the parallel-cascade intent resolver (grammar matcher + semantic classifier + LLM fallback, first-confident wins), the radiology command vocabulary/grammar, optimistic-UI dispatch with rollback, and the speculative-on-partials logic tuned for terse commands.
- **Replace/remove:** the LLM-writes-a-sentence + TTS-speaks-it tail that every conversational framework assumes. You don't need synthesized speech for a command cockpit; visual/optimistic UI feedback is faster and clearer.
- **Reject as whole-product adoptions:** Vapi, Retell, OpenAI Realtime, Ultravox — all conversational/telephony-shaped or S2S; you'd fight their reply-generation assumptions and pay latency + cost for output you discard. (Keep OpenAI Realtime as an *option* only if spoken confirmations become a requirement.)
- **STT choice:** Deepgram Flux (turn-aware, voice-agent-purpose-built, WebSocket-only) or Nova-3 (sub-300ms). Co-locate or self-host near your media edge; consider Cloudflare Realtime + Workers AI to terminate media + STT in one data center.

**Why not fully custom transport?** WebRTC media resilience (NetEQ, PLC, FEC, congestion control, ICE/NAT) represents years of engineering; LiveKit/Pipecat give it for free. **Why not fully adopt?** No off-the-shelf conversational platform is built for the command/dictation shape where action fires at the intent boundary with no spoken reply — that intent layer is your differentiator.

---

## 8. Deeper research paths / open questions

1. **Speculative-intent accuracy on partials for terse medical commands** — does the code-switching failure mode (ByondLabs) appear with radiology macros/short commands, or is the predictable vocabulary actually ideal? Prototype + measure. (LiveKit preemptive docs; PredGen arXiv 2506.15556; LTS-VoiceAgent arXiv 2601.19952.)
2. **Turn-aware ASR vs separate VAD endpointing** — measure real EOT latency of Deepgram Flux vs Nova-3 + tuned `endpointing`/`utterance_end_ms` for command boundaries. (Deepgram endpointing docs.)
3. **WebCodecs AudioEncoder Opus over WebRTC vs raw PCM linear16** — exact encode overhead and whether native WebCodecs beats letting WebRTC handle Opus. (web.dev mic patterns; opus-encdec.)
4. **Cloudflare Realtime + Workers AI Durable Objects** for always-on sessions — validate the 30s CPU / hibernation path under continuous listening; get Cloudflare's own (not third-party) latency numbers per region. (Cloudflare realtime-voice blog.)
5. **Single audio→intent model (Ultravox-style) trained on radiology commands** — could a speech-native SLM map audio directly to structured commands and beat the cascade's intent stage? Research-grade. (Ultravox blog; arXiv 2602.17598 cascade-equivalence.)
6. **Standardized self-instrumentation harness** — adopt the Pipecat-vs-LiveKit WebRTC ping/InfluxDB methodology (HN 46042844) to get P50/P95/P99/jitter/loss for *our* stack, since no industry benchmark exists.
7. **BAA matrix** — confirm BAA + permitted regions for Cloudflare Workers AI, Deepgram, Azure/Nuance before committing to any edge topology.

---

## Sources

- LiveKit — Sequential Pipeline Architecture for Voice Agents: https://livekit.com/blog/sequential-pipeline-architecture-voice-agents
- LiveKit — Why WebRTC beats WebSockets for realtime voice AI: https://livekit.com/blog/why-webrtc-beats-websockets-for-voice-ai-agents
- LiveKit — Agent speech and audio docs: https://docs.livekit.io/agents/multimodality/audio/
- Forasoft — Build and Deploy LiveKit AI Voice Agents (2026): https://www.forasoft.com/blog/article/livekit-ai-agents-guide
- Hamming AI — Testing LiveKit Voice Agents (2026): https://hamming.ai/resources/testing-livekit-voice-agents-complete-guide
- Hamming AI — Best Voice Agent Stack selection framework: https://hamming.ai/resources/best-voice-agent-stack
- WebRTC.ventures — Observability/Monitoring for LiveKit AI Agents: https://webrtc.ventures/2025/07/observability-and-monitoring-for-livekit-ai-agents-using-prometheus-and-grafana/
- WebRTC.ventures — Bedrock vs Vertex vs LiveKit vs Pipecat (2026): https://webrtc.ventures/2026/03/choosing-a-voice-ai-agent-production-framework/
- DEV / CloudX — Cracking the <1-second Voice Loop (30+ stack benchmarks): https://dev.to/cloudx/cracking-the-1-second-voice-loop-what-we-learned-after-30-stack-benchmarks-427
- Medium / A. González — Building Real-Time Voice AI: Latency Tests Lessons: https://medium.com/@albertogontras/building-real-time-voice-ai-latency-tests-lessons-57650a701b24
- Neuphonic — 2025 LiveKit Review: https://www.neuphonic.com/blog/livekit-review-open-source-webrtc-ai-voice-tool
- Pipecat (GitHub): https://github.com/pipecat-ai/pipecat
- Pipecat — Daily WebRTC guide: https://docs.pipecat.ai/pipecat-cloud/guides/daily-webrtc
- Pipecat — Preemptive speech generation issue #3321: https://github.com/pipecat-ai/pipecat/issues/3321
- Daily — You don't need a WebRTC server for your voice agents: https://www.daily.co/blog/you-dont-need-a-webrtc-server-for-your-voice-agents/
- Daily — Benchmarking LLMs for Voice Agent use cases: https://www.daily.co/blog/benchmarking-llms-for-voice-agent-use-cases/
- Modal — One-Second Voice-to-Voice Latency with Modal, Pipecat, open models: https://modal.com/blog/low-latency-voice-bot
- HN — Building a WebRTC benchmark for voice AI agents (Pipecat vs LiveKit): https://news.ycombinator.com/item?id=46042844
- Luong Hong Thuan — Pipecat Voice Agent in Production guide: https://luonghongthuan.com/en/blog/pipecat-voice-agent-production-scalable-guide/
- AWS — Deploy voice agents with Pipecat and Bedrock AgentCore: https://aws.amazon.com/blogs/machine-learning/deploy-voice-agents-with-pipecat-and-amazon-bedrock-agentcore-runtime-part-1/
- OpenAI — Delivering low-latency voice AI at scale: https://openai.com/index/delivering-low-latency-voice-ai-at-scale/
- OpenAI — Introducing gpt-realtime: https://openai.com/index/introducing-gpt-realtime/
- OpenAI — Realtime and audio guide: https://developers.openai.com/api/docs/guides/realtime
- webrtcHacks — Measuring response latency of OpenAI's WebRTC Realtime API: https://webrtchacks.com/measuring-the-response-latency-of-openais-webrtc-based-real-time-api/
- Skywork — OpenAI Realtime API vs WebRTC 2025: https://skywork.ai/blog/openai-realtime-api-vs-webrtc-2025-which-to-choose/
- DEV / D. Mishra — Building Low-Latency Voice Agents with OpenAI Realtime: https://dev.to/deepak_mishra_35863517037/talking-to-machines-building-low-latency-voice-agents-with-openai-realtime-api-3c7p
- Ultravox — Understanding Latency in Voice AI Systems: https://www.ultravox.ai/voice-ai/understanding-latency-in-voice-ai-systems
- Ultravox — Why speech-to-speech is the future (AIEWF eval): https://www.ultravox.ai/blog/why-speech-to-speech-is-the-future-for-ai-voice-agents-unpacking-the-aiewf-eval
- Ultravox — Pipecat integration: https://www.ultravox.ai/blog2026/introducing-the-ultravox-integration-for-pipecat
- Speko — Speech-to-Speech vs Cascaded Pipelines: https://speko.ai/blog/s2s-vs-cascaded
- Hamming AI — Are Speech-to-Speech Models Ready to Replace Cascade: https://hamming.ai/blog/are-speech-to-speech-models-ready-to-replace-cascade-models
- arXiv 2602.17598 — Cascade Equivalence Hypothesis: https://arxiv.org/pdf/2602.17598
- Retell AI — Voice agent latency face-off (2025): https://www.retellai.com/resources/ai-voice-agent-latency-face-off-2025
- Retell AI — Vapi AI Review 2026: https://www.retellai.com/blog/vapi-ai-review
- Pickaxe — Top 12 AI Voice Agents 2026: https://pickaxe.co/post/top-ai-voice-agents
- Deepgram — Measuring STT latency: https://developers.deepgram.com/docs/measuring-streaming-latency
- Deepgram — Endpointing & interim results: https://developers.deepgram.com/docs/understand-endpointing-interim-results
- Deepgram — End-of-speech detection: https://developers.deepgram.com/docs/understanding-end-of-speech-detection
- Deepgram — Streaming speech recognition API: https://deepgram.com/learn/streaming-speech-recognition-api
- ByondLabs — Voice Agent Latency: Sub-Second Tuning Playbook: https://byondlabs.tech/blog/voice-agent-latency-the-sub-second-tuning-playbook
- GetStream — Speculative Tool Calling for voice: https://getstream.io/blog/speculative-tool-calling-voice/
- GetStream — WebRTC vs WebSocket A/V sync for AI: https://getstream.io/blog/webrtc-websocket-av-sync/
- GetStream — WebRTC and Buffers: https://getstream.io/resources/projects/webrtc/advanced/buffers/
- GetStream — Media Resilience in WebRTC: https://getstream.io/resources/projects/webrtc/advanced/media-resilience/
- webrtcHacks — How WebRTC's NetEQ Jitter Buffer Provides Smooth Audio: https://webrtchacks.com/how-webrtcs-neteq-jitter-buffer-provides-smooth-audio/
- arXiv 2506.15556 — PredGen (input-time speculative decoding): https://arxiv.org/pdf/2506.15556
- arXiv 2601.19952 — LTS-VoiceAgent (Listen-Think-Speak): https://arxiv.org/html/2601.19952v1
- Speechmatics — STT metrics that matter for voice agents: https://www.speechmatics.com/company/articles-and-news/speed-you-can-trust-the-stt-metrics-that-matter-for-voice-agents
- web.dev — How to process audio from the user's microphone: https://web.dev/patterns/media/microphone-process/
- MDN — Background audio processing using AudioWorklet: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_AudioWorklet
- Superpowered — Riding the latest waves on the web (AudioWorklet): https://superpowered.com/riding-the-latest-waves-on-the-web
- Doist — Building Ramble #2: Capturing Audio in Real-Time: https://www.doist.dev/building-ramble-2-capturing-audio-in-real-time/
- opus-recorder (GitHub): https://github.com/chris-rudmin/opus-recorder
- opus-encdec (GitHub, rawOpus): https://github.com/mmig/opus-encdec
- Cloudflare — Cloudflare is the best place to build realtime voice agents: https://blog.cloudflare.com/cloudflare-realtime-voice-ai/
- Cloudflare — Add voice to your agent: https://blog.cloudflare.com/voice-agents/
- Cloudflare — Workers AI models: https://developers.cloudflare.com/workers-ai/models/
- Cloudflare — Deepgram partner models on Workers AI: https://developers.cloudflare.com/changelog/post/2025-08-27-partner-models/
- CallSphere — Cloudflare Workers AI for Sub-100ms Voice Agents (2026): https://callsphere.ai/blog/vw6c-cloudflare-workers-ai-sub-100ms-voice-2026
- arXiv 2310.08437 — Cold Start Latency in Serverless Computing (survey): https://arxiv.org/pdf/2310.08437
- arXiv 2508.07640 — Taming Cold Starts: Proactive Serverless Scheduling (MPC): https://arxiv.org/pdf/2508.07640
- regolo.ai — Scale-to-Zero Cold Start Latency / Serverless GPU: https://regolo.ai/scale-to-zero-cold-start-latency-why-serverless-gpu-breaks-real-time-ai-and-how-to-fix-it/
- Medium / V. Bandara — Cold Starts Compound (serverless AI agent chains): https://vitiya99.medium.com/cold-starts-compound-why-serverless-ai-agent-chains-create-latency-chaos-5a91522e3325
- CallSphere — Voice AI Latency: Why Sub-Second Matters: https://callsphere.ai/blog/voice-ai-latency-sub-second-why-matters
- Rad AI — Next-Generation Speech Recognition (Dec 2025): https://www.radai.com/news/rad-ai-unveils-next-generation-speech-recognition-that-redefines-radiology-reporting
- ITN — Rad AI Launches Next-Gen Speech Recognition: https://www.itnonline.com/content/rad-ai%C2%A0launches-next-generation-speech-recognition-technology
- Radiology AI News — Latest in Radiology Reporting with AI Voice Dictation: https://radiologyainews.substack.com/p/your-guide-to-the-latest-in-radiology
- What is Nuance — PowerScribe One: https://whatisnuance.com/nuance-powerscribe-one-advancing-radiology-reporting-with-ai-powered-workflows/
- Introl — Voice AI Infrastructure: Real-Time Speech Agents: https://introl.com/blog/voice-ai-infrastructure-real-time-speech-agents-asr-tts-guide-2025
