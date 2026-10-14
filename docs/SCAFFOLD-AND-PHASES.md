# Proposed Scaffold + Phased Build Order

**Not yet created — this is the plan.** Clean separation per the brief:
`STT layer → intent decoder → action registry → UI/state`. Each is an independent module with a
typed contract, so any layer can be swapped (e.g. cloud↔on-device STT) without touching the rest.

## Folder layout (proposed)

```
voice-cockpit/
├─ app/                         # Next.js App Router (UI/state lane)
│  ├─ (cockpit)/                # the reporting cockpit route
│  └─ api/
│     ├─ stt-token/             # mints EPHEMERAL STT tokens (key never hits browser)
│     └─ llm-fallback/          # de-identified-text LLM route (BAA/ZDR endpoint)
│
├─ packages/
│  ├─ audio/                    # capture + transport
│  │  ├─ worklet/               # AudioWorklet PCM/Opus framing
│  │  ├─ webrtc/                # WebRTC transport to cloud STT
│  │  └─ vad/                   # Silero VAD (onnxruntime-web) + Smart-Turn EOU
│  │
│  ├─ stt/                      # STT LAYER (pluggable adapters)
│  │  ├─ types.ts               # SttAdapter contract (partials, finals, timestamps)
│  │  ├─ command-stt/           # on-device: Parakeet-EOU / Moonshine / sherpa-onnx
│  │  └─ dictation-stt/         # cloud: Deepgram Nova-3 Medical (BAA) adapter
│  │
│  ├─ decoder/                  # INTENT DECODER (parallel cascade)
│  │  ├─ normalizer/            # filler/pleasantry stripping, lemmatize
│  │  ├─ l1-grammar/            # regex + FST + Aho-Corasick matcher
│  │  ├─ l1-slots/              # SymSpell + Double-Metaphone + Jaro-Winkler resolver
│  │  ├─ l2-semantic/           # Model2Vec/potion static-embedding cosine bank
│  │  ├─ l3-llm/                # LLM fallback w/ cached JSON grammar (de-id only)
│  │  ├─ calibration/           # isotonic/conformal confidence thresholds
│  │  └─ orchestrator.ts        # parallel fire, first-confident, escalation policy
│  │
│  ├─ registry/                 # COMMAND REGISTRY (single source of truth)
│  │  ├─ types.ts               # CommandDef, SlotDef, Scope (see COMMAND-REGISTRY.md)
│  │  ├─ commands/              # one file per domain: case.ts, findings.ts, signing.ts…
│  │  └─ build/                 # compile patterns→matcher, anchors→vectors, →LLM schema
│  │
│  ├─ actions/                  # ACTION LAYER
│  │  ├─ dispatcher.ts          # registry result → executor, optimistic preview/confirm
│  │  ├─ session-fsm/           # multi-session state machine + clarification states
│  │  └─ transcript/            # dictation accumulator + command-span subtraction + undo log
│  │
│  ├─ phi/                      # de-identification (Philter/Presidio/Comprehend Medical)
│  └─ shared/                   # types, logging (PHI-safe), telemetry, latency tracing
│
├─ bench/                       # latency harness (Coval-style) — measure on REAL mic audio
└─ research/                    # this dossier
```

## Phased build order (from empty repo)

**Phase 0 — Latency harness first (don't skip).**
Build `bench/` before features: a rig that replays/records real reading-room mic audio and
measures **mouth-to-command** at each stage. Every later decision is validated here. Vendor ms
numbers are gameable; only your bench counts.

**Phase 1 — Audio + VAD + one STT partial stream.**
AudioWorklet capture → Silero VAD → a single STT adapter emitting partials with word timestamps.
Prove you can read interim hypotheses in real time. Pick on-device command STT first (Tier 1).

**Phase 2 — L1 decoder + minimal registry + dispatch.**
~10 real commands ("open case", "findings are", "generate", "sign and next", "next", "undo").
regex/FST matcher + slot resolver, fire on partials, dispatch to a stubbed action layer with
optimistic UI. This alone should already feel sub-100 ms — measure it.

**Phase 3 — Transcript subtraction + dictation lane.**
Add the cloud Deepgram Nova-3 Medical dictation adapter under BAA, the dictation accumulator, and
command-span subtraction with undo log. Now dictation and commands coexist on one stream.

**Phase 4 — L2 semantic path (parallel).**
Model2Vec static-embedding bank from registry `anchors`, run in parallel with L1. Adds paraphrase
robustness at ~free latency. Add confidence calibration scaffolding.

**Phase 5 — Smart-Turn semantic endpointing + clarification.**
Replace fixed silence timeout with Smart Turn v3.1. Add the clarification FSM ("X or Y?") and
async commands (background impression generation).

**Phase 6 — L3 LLM fallback + PHI de-identification.**
Only for fuzzy/compound utterances below local thresholds. Wire the `phi/` redaction in front of
the LLM call; ZDR/BAA endpoint (Bedrock-Claude). Verify the LLM never receives PHI.

**Phase 7 — Hardware exploration.**
Benchmark Tier 1 vs Tier 2 (Apple Silicon/WebGPU) vs the shared-GPU cold lane. Adopt Tier 2 where
free; decide on a shared GPU box only if the dictation/LLM lane needs it.

**Phase 8 — Hardening.**
Acoustic echo cancellation (mandatory for always-on/barge-in), wake-token/push-to-command gating
for destructive ops, multi-session state, telemetry, and a full mis-fire audit trail.

## Build-vs-adopt

- **Adopt** the WebRTC media + STT plumbing of a mature framework (**LiveKit Agents** preferred,
  **Pipecat** alternative) — don't rebuild jitter buffers / PLC / reconnection.
- **Build** yourself: the parallel decoder cascade, the radiology command registry, transcript
  subtraction, optimistic dispatch, and the session FSM. These are the product.
- **Reject** whole-product adoption of Vapi / Retell / OpenAI Realtime / Ultravox — all are
  conversational/telephony/speech-to-speech shaped, none built for command dispatch. Strip the
  TTS-reply tail entirely.
