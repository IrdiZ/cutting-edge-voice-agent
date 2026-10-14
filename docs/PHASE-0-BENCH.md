# Phase-0 Bench — spec

**Not the product.** A throwaway-friendly measurement harness + datasets + scorecard. Its only job:
turn the disputed/unknown numbers from the research bank into measured facts, on real audio and
real hardware, and flip the 🔴 tickets. Decisions over code.

## A. What it must settle (each maps to an OPEN-QUESTIONS ticket)
- On-device command-STT *real* latency — currently a 50–560 ms spread (A2/A3)
- Deepgram Nova-3 Med TTFP — 80 / 150 / 300 ms across sources (A4)
- Does CPU-only clear sub-100 ms, or is Apple Silicon/WebGPU required? (F1/F2)
- Picovoice Rhino real latency + radiology vocab coverage — no published figure exists (B1)
- Commit policy: local-agreement N + thresholds; mis-fire rate vs commit latency, per cost tier (A1/A6)
- Static-embedding (Model2Vec) recall on *radiology* paraphrases vs MiniLM (B2)
- Command-vs-dictation separator false-accept rate vs ACI-Bench baseline (B8)
- Voxtral-Mini-4B browser-WebGPU viability (A9)

## B. Ground-truth timing rig (so numbers are trustworthy, not vendor claims)
- **Hardware audio loopback + 240 fps camera** to capture *true* mouth→UI-DOM-render latency
  (both web reports recommend this; software timestamps alone miss render/GC).
- **Stage-boundary timestamps**: capture → VAD → first-partial → command-claim → commit → dispatch
  → render. Log every hop to reconstruct the per-stage budget.
- **Packet capture (Wireshark/tcpdump)**: measure network RTT/jitter, and verify **zero PHI leakage**
  on the wire (E-lane requirement).
- **Network shaping (tc/netem)**: inject packet loss/jitter to simulate hospital Wi-Fi/Citrix for
  the WebRTC-vs-WebSocket test (A5).

## C. Datasets / inputs (vendor numbers are clean-TTS — we need real)
- **Real reading-room audio**: accented, noisy, with thinking-pauses ("findings are… uh…") and
  room cross-talk. The single most important asset — most disputed numbers come from clean TTS.
- **Radiology command corpus**: ~20–50 commands × many phrasings / synonyms / trailing
  pleasantries, with proper-noun slots drawn from a **mock worklist** (names/anatomy/drugs).
- **Embedded-command-in-dictation set**: commands buried mid-dictation (for the separator + the
  transcript-subtraction test).
- **Clinical-WER set**: hard terms (oligodendroglioma, steatohepatitis…) for the dictation lane.
- **ACI-Bench** (open) as the dictation-detection baseline to beat (from H.3 merge).
- **Adversarial/negative set**: dictation that *looks* command-like, cross-talk, system audio cues
  — drives the false-accept and self-trigger measurements.

## D. Scorecard (metrics — literature-grounded)
- **Mouth-to-command latency** p50/p95 — the headline number.
- **Time-to-first-partial** per STT engine.
- **Commit latency vs revision/mis-fire rate** — the A6 curve, per cost tier.
- **Stability**: revokes-per-second, word/segment stability, normalized flicker (H.2 metrics).
- **Command accuracy**: precision/recall, **false-accept rate (weighted heaviest)**, EER.
- **Proper-noun resolve accuracy** (phonetic/SymSpell against the worklist).
- **Dictation WER** on the clinical-term set.
- **Transcript-subtraction accuracy** (command span cleanly removed, undo intact).
- **Resource**: CPU %, peak memory, model footprint — feeds the hardware-tier call.

## E. Experiments (head-to-heads)
1. **STT bake-off** — Parakeet-EOU vs Moonshine v2 vs sherpa-onnx Zipformer vs Voxtral-4B (WebGPU)
   vs Deepgram Nova-3 Med (cloud), on latency × WER × footprint. (A2/A3/A4/A9)
2. **Decoder cascade** — L1 FST/grammar (Finstreder/Slungt-style, train-free) + L2 Model2Vec +
   L3 constrained-grammar LLM: per-layer latency, accuracy, escalation rate. Vs **Picovoice Rhino**
   as an alternative whole-path. (B1/B2/B3/B4)
3. **Commit-policy sweep** — local-agreement N=1/2/3 + adaptive stability/uncertainty gates: plot
   mis-fire vs latency, set per-cost-tier thresholds (navigation vs destructive). (A1/A6)
4. **Separator** — fusion classifier (partial-ASR lexical + light acoustic + app-mode context) vs
   the ACI-Bench baseline; optimize false-accept first. (B8)
5. **Transport** — WebRTC vs WebSocket under netem packet loss. (A5)
6. **Target-speaker front-end** (C6) — VoiceFilter-Lite + Personal VAD 2.0 enrolled on a test
   speaker vs **colleagues talking / phone audio / room cross-talk**: measure cross-talk rejection
   AND **inactive-target false alarms** (does it stay quiet during thinking-pauses?). Single-channel
   vs mic-array directional if a 2-mic rig is available.

## F. Hardware matrix (run the above on each — settles F1/F2)
- Thin client (cloud-only) · CPU-only workstation · Apple Silicon / WebGPU · single consumer GPU.

## G. Guardrails — what Phase 0 is NOT
- No product UI, no full command registry, **no real PHI** (synthetic worklist only).
- Throwaway measurement scaffolding — optimize for fast iteration, not reusable app code.
- **Output = a decisions doc**: measured picks for STT / decoder / hardware tier / commit-N, with
  real numbers replacing the disputed ones, flipping 🔴 tickets to ✅. That doc unblocks Phase 1.
