# Research notes

These notes sit behind the prototype in [`../../prototype/`](../../prototype/). They cover the
speech-to-text landscape, command decoding, voice activity detection, latency, privacy and the
hardware options. They were written in May and June 2026. Latency figures in them come from
vendor pages and papers. They are estimates. They are not measurements of this prototype.

Constraints assumed in these notes:

- Cloud speech-to-text under a signed data-processing agreement is allowed.
- Hardware starts at the cheapest viable tier. It scales up only where latency improves a lot.
- The microphone is always on, with no wake word. Commands and dictation share one stream.
- The frontend anchor is Next.js, React, TypeScript and Tailwind. This is not fixed.

## The one-line conclusion

> **Lowest perceived latency comes from acting on STREAMING PARTIAL transcripts with an
> on-device command decoder, not from a faster final transcript.** Finalization is gated by
> silence/endpointing (+150–300 ms of dead air) no matter how fast the model is. Fire the
> command the instant a partial confidently matches — typically ~150–400 ms *before the
> user stops talking*. On a CPU-only workstation that's **~80–150 ms mouth-to-command**;
> the big step-change is deleting the network leg (Tier 0 → Tier 1), not buying a GPU.

## Design documents

1. [../ARCHITECTURE.md](../ARCHITECTURE.md): target design, dual-path model, latency budget per stage.
2. [../COMMAND-REGISTRY.md](../COMMAND-REGISTRY.md): how commands, synonyms and confirmations are declared.
3. [../SCAFFOLD-AND-PHASES.md](../SCAFFOLD-AND-PHASES.md): proposed modules and build order.
4. [../RISKS.md](../RISKS.md): latency, privacy and mis-fire risks, with mitigations.
5. [../PHASE-0-BENCH.md](../PHASE-0-BENCH.md): the measurement plan for the open questions.

## Design and verification notes

| File | Content |
|------|---------|
| [B8-SEPARATOR-DESIGN.md](B8-SEPARATOR-DESIGN.md) | Design of the command-versus-dictation separator used in the prototype |
| [M3-STREAMING-PLAN.md](M3-STREAMING-PLAN.md) | Options for streaming speech-to-text in the browser, and why sherpa-onnx was chosen |
| [COMMAND-TREE-FEASIBILITY.md](COMMAND-TREE-FEASIBILITY.md) | Feasibility of a command tree with prerequisites |
| [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) | List of disputed numbers and unknowns, with status |
| [WEB-VERIFICATION.md](WEB-VERIFICATION.md) | Source checks for the disputed claims |
| [web-research-merge.md](web-research-merge.md) | Summary of two web research reports against the notes |
| [literature/](literature/) | Four literature-search summaries (partial-transcript stability, command spans, always-on robustness, streaming speech to intent) |

Diagrams: [../diagrams/architecture-map.html](../diagrams/architecture-map.html) and
[../diagrams/signal-flow.html](../diagrams/signal-flow.html). Open them in a browser.

## Research notes (sourced, with "deeper paths" sections)

| File | Stream | Headline finding |
|------|--------|------------------|
| [01-stt-landscape.md](01-stt-landscape.md) | Streaming STT, cloud + on-device | Act on partials; on-device **Parakeet-EOU 120M (80–160 ms)** for commands, **Deepgram Nova-3 Medical** for dictation |
| [02-intent-decoding.md](02-intent-decoding.md) | Hybrid command decoder | 3-layer hybrid still wins, but **static embeddings (Model2Vec) make the semantic path sub-1 ms** and **Picovoice Rhino** does speech→intent on-device |
| [03-vad-endpointing.md](03-vad-endpointing.md) | VAD, endpointing, turn detection | **Silero VAD (web)** + **Pipecat Smart Turn v3.1 (12 ms CPU)** semantic end-of-utterance; claim commands on every interim delta |
| [04-latency-frameworks.md](04-latency-frameworks.md) | Transport + frameworks | **WebRTC** for mic→cloud; **adopt LiveKit/Pipecat plumbing, build the command resolver**; target **150–400 ms mouth-to-action** |
| [05-privacy-priorart.md](05-privacy-priorart.md) | PHI/BAA + incumbents | **AWS Transcribe Medical / Deepgram self-host / Bedrock-Claude** are safest; incumbents (PowerScribe/Dragon) still force verbal-punctuation tics — the gap to exploit |
| [06-hardware-scaling.md](06-hardware-scaling.md) | Hardware golden medium | **Tier 1 (CPU-only) ≈ 80–150 ms** is the sweet spot; GPU only pays off for the separate dictation/LLM lane on a shared box |

## TL;DR recommended stack

- **Transport:** WebRTC (Opus, 20 ms frames, AudioWorklet capture), persistent connection.
- **VAD/turn:** Silero VAD (onnxruntime-web) + Pipecat Smart Turn v3.1 for semantic end-of-utterance.
- **STT — command path:** on-device streaming (Parakeet-EOU 120M / Moonshine / sherpa-onnx Zipformer), partials only.
- **STT — dictation path:** Deepgram Nova-3 Medical streaming under BAA (or AWS Transcribe Medical / Azure container for stricter PHI posture).
- **Decoder cascade (run in parallel on partials):** L1 regex/FST/Aho-Corasick + SymSpell/Double-Metaphone slot resolver (µs–ms) → L2 Model2Vec static-embedding cosine (<1 ms) → L3 LLM fallback with cached JSON grammar (only for fuzzy/compound), de-identified text only.
- **Action layer:** typed command registry → reducer/state machine → UI; optimistic "preview-then-confirm" for medium confidence; full undo log (medico-legal).
- **Hardware:** start CPU-only; Apple Silicon/WebGPU is a free bonus; one shared GPU box only for the LLM/dictation cold path.
