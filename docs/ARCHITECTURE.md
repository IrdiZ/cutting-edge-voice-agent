# Recommended Architecture + Latency Budget

This is the synthesis of all six research streams into one end-to-end design. It optimizes for
**perceived** latency (when the page reacts) rather than transcript-finalization latency.

> **Design vs prototype (status).** This is the *recommended target* design, not a description
> of the shipped code. The current `prototype/` implements Silero VAD, on-device streaming STT
> (sherpa Zipformer / Whisper), the L1 decoder, and the SGFM-Sep separator (scope gate +
> coverage floor), and **fires on the first confident partial**. The cross-partial **Stage 2
> commit-stability** (local-agreement N), Smart-Turn endpointing, the L2 (Model2Vec) / L3 (LLM)
> layers, and WebRTC transport below are **designed, not yet implemented**.

## The core insight

A command is not a transcript. The system should **fire on streaming partial hypotheses**,
the moment a partial confidently matches a command — not wait for `is_final`. Finalization is
gated by VAD/endpointing silence (+150–300 ms of dead air) regardless of model speed. Claiming
on partials means the page often reacts **before the user stops talking**.

Two consequences shape the whole architecture:

1. **Two lanes on one audio stream.** A *command lane* (latency #1, on-device, PHI-safe) and a
   *dictation lane* (accuracy #1, medical-tuned, BAA cloud or local). They consume the same mic
   and the same interim stream but have opposite priorities.
2. **Parallel, not cascading, decoders.** Don't run local→semantic→LLM sequentially. Fire the
   fast layers simultaneously and take the first confident answer; only escalate to the LLM when
   all local layers are below threshold.

## Block diagram

```
                          ┌─────────────────────────────────────────────────────┐
  mic (getUserMedia)      │  BROWSER (Next.js / React / TS)                       │
      │                   │                                                       │
      ▼                   │   AudioWorklet → PCM/Opus frames (20 ms)              │
  ┌─────────┐             │        │                                              │
  │ Capture │─────────────┼────────┼───────────► Silero VAD (onnxruntime-web)     │
  └─────────┘             │        │                    │  speech segments        │
                          │        │                    ▼                         │
                          │        │            Smart-Turn v3.1 (EOU gate, 12 ms) │
                          │        │                                              │
   ┌──────────────────────┼────────┴───────────┐                                 │
   │                      │                     │                                 │
   ▼ COMMAND LANE         │                     ▼ DICTATION LANE                  │
 on-device streaming STT  │            WebRTC → cloud streaming STT               │
 (Parakeet-EOU / Moonshine│            (Deepgram Nova-3 Medical, BAA)             │
  / sherpa Zipformer)     │                     │ interim + final                 │
   │ partial deltas       │                     ▼                                 │
   ▼                      │            Dictation accumulator ──► report editor    │
 ┌───────────────────────────────────┐          ▲                                │
 │ INTENT DECODER (parallel)         │          │ subtract claimed command span  │
 │  L1 regex/FST/Aho-Corasick  µs–ms │          │ (with undo log)                │
 │  L1b SymSpell+Metaphone slots µs–ms          │                                │
 │  L2 Model2Vec cosine        <1 ms │──────────┘                                │
 │  L3 LLM fallback (de-id text only)│  only if L1/L2 < threshold                │
 └───────────────────────────────────┘                                          │
   │ {intent, slots, confidence}                                                 │
   ▼                                                                             │
 ┌───────────────────────────────────┐                                          │
 │ ACTION REGISTRY → reducer/FSM      │   optimistic preview-then-confirm        │
 │ → UI/state (PACS, editor, signing) │   clarification prompts ("X or Y?")      │
 └───────────────────────────────────┘                                          │
                          └─────────────────────────────────────────────────────┘
```

## Latency budget (common command, Tier-1 CPU-only workstation)

Target: **well under 100 ms** of *added* latency, and act before end-of-speech.

| Stage | Budget | Notes |
|-------|--------|-------|
| Mic capture → frame ready (AudioWorklet, 20 ms frame) | ~20 ms | inherent frame size; unavoidable |
| VAD decision (Silero, per 32 ms chunk) | <1 ms | runs continuously, not in the critical add |
| On-device STT partial emission | ~30–80 ms | Moonshine Tiny 34 ms (Mac)/69 ms (x86); Parakeet-EOU 80–160 ms |
| L1 grammar/FST match + slot resolve | ~0.01–5 ms | regex/Aho-Corasick + SymSpell/Metaphone |
| L2 static-embedding cosine (parallel) | <1 ms | Model2Vec/potion; only used if L1 misses |
| Dispatch to action registry + optimistic UI | ~1–5 ms | reducer + render |
| **Total added (common command)** | **~80–150 ms** | and fires *before* the user stops → perceived ≈ 0 |
| L3 LLM fallback (rare, fuzzy/compound only) | +80–400 ms | Groq ~80 ms p50 TTFT; de-identified text only |

Compare: a thin-client all-cloud design (Tier 0) floors at ~250–500 ms because of the network
leg. Conversational voice-agent stacks land at ~600 ms–1.7 s because they include LLM-writes +
TTS-speaks tails we don't need. **We fire at the intent boundary, so neither tail applies.**

## Why these picks

- **WebRTC over WebSocket for mic→cloud:** UDP + Opus + NetEQ jitter buffer + PLC/FEC degrades
  gracefully on packet loss; WebSocket/TCP head-of-line blocking stalls audio ≥100 ms (seconds
  under congestion). WebSocket is fine for server↔STT.
- **On-device command STT:** network RTT alone blows the <100 ms budget, and keeping command
  audio on-device means PHI never leaves the machine for the common path.
- **Static embeddings (Model2Vec/potion-32M):** ~93% of MiniLM quality at up to ~500× the speed,
  pure NumPy / WASM, sub-1 ms — collapses the old "300–500 ms warm path" to nearly free, so it
  can run in parallel rather than only on miss.
- **Smart Turn v3.1 semantic endpointing:** reads prosody + filler words so a user's
  thinking-pause ("the findings are… uh…") doesn't prematurely finalize. ~8M params, 12 ms CPU,
  fully open (BSD-2).
- **Picovoice Rhino (evaluate):** does speech-directly-to-intent on-device with no STT→NLU split
  (<2.5 MB, RTF < 1) — potentially the lowest-latency path for the fixed command grammar. No
  published ms figure, so it must be benchmarked on our hardware against the Parakeet+grammar
  path.

## Speaker-enrolled target-isolation front-end (shared-room defense)

An always-on mic in a shared reading room hears colleagues, phone calls, and cross-talk. The
defense is **personalization, not echo cancellation**: enroll the user's voice at login,
then run a streaming on-device **target-speaker front-end** — **VoiceFilter-Lite** (target voice
separation) + **Personal VAD 2.0** (target-speaker VAD), both 8-bit, real-time — *before* VAD/STT,
so only the enrolled speaker's audio enters the pipeline. This solves self-trigger by *identity*
and shrinks the command-vs-dictation separator below (only target speech reaches it). Gotcha to
bench: **inactive-target false alarms** — it must stay quiet during thinking-pauses and not leak
cross-talk. Single-channel is the baseline; a mic array enables directional suppression as a
Tier-2 upgrade. AEC for the system's own audio is a backstop only — **moot if confirmations are
visual** (see RISKS / OPEN-QUESTIONS C6).

## Command-vs-dictation separator (a build-and-bench component)

Deciding *which* spans of the always-on stream are commands vs report dictation has **no
off-the-shelf solution** (literature is sparse — see
[research/OPEN-QUESTIONS.md](research/OPEN-QUESTIONS.md) ticket B8 +
[undermind/MERGE-command-spans.md](research/literature/MERGE-command-spans.md)). The de-risked recipe:

- **Primary signal: partial-ASR lexical/semantics** — the words carry most of the command signal
  (confirmed in medical dictation by Schaaf 2021/2025).
- **Earliest rejection: lightweight acoustic/prosodic** — fires before lexical evidence stabilizes.
- **Strong prior: app-mode + short-horizon interaction history** — modeled as *sequential routing*,
  not per-utterance classification (SAS/SDAR 2026: removing history collapsed F1 0.95→0.57). Ties
  into the scope-gated registry.
- **Slow lane: a small on-device fine-tuned LLM** (Qwen2-1.5B class) for hard open-ended cases.
- **Tune false-accept first** — mis-firing on dictation is costlier than missing a command.
- Baseline to beat: medical dictation detection ~90% utterance F1 (ACI-Bench).

## Hardware ladder (golden medium)

| Tier | Hardware | Mouth-to-command | Marginal gain | Cost |
|------|----------|------------------|---------------|------|
| 0 | Thin client, all cloud | ~250–500 ms | baseline | ~$0.008/min STT |
| **1** | **Modern CPU, no GPU** | **~80–150 ms** | **deletes the network leg — the step-change** | ~$0 (existing PC) |
| 2 | Apple Silicon / ANE / browser WebGPU | ~60–110 ms | STT encoder 3–6× faster; free bonus | ~$0 if device exists |
| 3 | Single consumer GPU (RTX 4060–4090) | ~50–90 ms cmd | negligible for commands; decisive only for local LLM | $300–1,600 one-time |

**Golden medium = Tier 1.** Start CPU-only. Take Tier 2 for free where the device already has
Apple Silicon or WebGPU. Only add a GPU on **one shared box** for the latency-tolerant
LLM/dictation cold path — never per workstation.

## Where PHI flows

- Raw audio + command decode: **on-device** (Tier 1+), never leaves the machine.
- Dictation: cloud STT under BAA (Deepgram Nova-3 Medical zero-retention), or AWS Transcribe
  Medical (stateless), or Azure disconnected container for air-gapped posture.
- LLM fallback: **de-identified text only** (Philter/Presidio/Comprehend Medical recall-first
  redaction) → ZDR + BAA endpoint (prefer Bedrock-Claude to stay in one AWS boundary). The LLM
  never sees PHI.

See [RISKS.md](RISKS.md) for the full PHI / mis-fire / latency mitigation matrix.
