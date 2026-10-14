# Merge analysis — Web deep-research (Gemini + ChatGPT) × our bank

Sources: two web research reports (not included in this repo), May 2026. This is the **vendor / PHI / hardware lane** — the questions Undermind
structurally can't answer (tickets A2–A4, B1, E, F, G).

**Headline:** both web models — *independently of each other and of our bank* — converged on the
**exact architecture we designed** (dual-path, fire-on-partial, Model2Vec router, Deepgram Nova-3
Medical dictation, Moonshine v2 on-device, 3-layer cascade, WebRTC, on-device PHI). That's strong
triangulation that the core design is sound. The *useful* output is therefore not the agreement —
it's the **three real disputes** the agreement brackets, which now route straight to the Phase-0
bench. ⚠️ Caveat: neither model is independent of the same public sources, so convergence ≠ ground
truth, and Gemini's numbers are visibly rosier than ChatGPT's (see §4).

---

## 1. Convergence → promote to high confidence

All three (Gemini, ChatGPT, our bank) agree on:
- **Dual-path, fire-on-partial** as the #1 leverage decision; strip the command span from the
  dictation buffer mid-utterance.
- **WebRTC/UDP over WebSocket** (HOL-blocking); AudioWorklet → WebCodecs Opus → WebRTC.
- **Model2Vec/potion** sub-ms static-embedding router in a Web Worker; **isotonic calibration**.
- **3-layer cascade:** phonetic FST/SymSpell+Double-Metaphone → Model2Vec → constrained-grammar
  LLM fallback (Groq/Cerebras, Outlines/GBNF). **BK-tree** for proper-noun/name lookup.
- **Deepgram Nova-3 Medical** for the cloud dictation lane under BAA (ZDR).
- **Moonshine v2** (arXiv:2602.12241) as the on-device command STT.
- **On-device PHI**: VAD + intent local; only de-identified text (Presidio/Philter, or Comprehend
  Medical) to any cloud LLM. Vendor BAA table matches our PHI merge (Deepgram ZDR, Azure
  disconnected containers, AWS Transcribe Medical stateless, OpenAI via Azure).
- **Incumbent gaps** (ticket G1) confirmed: PowerScribe/Dragon force push-to-talk / pause-before-
  command, commands bleed into the narrative when you forget, 300–600 ms execution lag; Rad AI is
  post-dictation NLP, **not** zero-click. Our product thesis stands.

## 2. The three real disputes → route to bench

These are where the value is — the things the agreement hides:

### Dispute A — vendor Time-to-First-Partial (ticket A4)
| Source | Deepgram Nova-3 Med TTFP |
|--------|--------------------------|
| Gemini | **80–90 ms** P50 |
| ChatGPT | **≲300 ms** |
| our STT merge | ~150 ms interims |
Three different numbers spanning 80–300 ms. Vendor-quoted, clean-audio, network-excluded. **Bench
on real reading-room audio + hospital network is the only arbiter.** Same spread on OpenAI
Realtime WER (Gemini 7.8% "poor jargon" vs ChatGPT 2.46% general — different conditions, not
comparable).

### Dispute B — does CPU-only actually clear sub-100 ms? (tickets F1/F2)
| Source | CPU-only mouth→command | Golden medium |
|--------|------------------------|---------------|
| **our bank** | 80–150 ms | **Tier 1 CPU**, Apple Silicon a free bonus |
| **ChatGPT** | 200–400 ms | "goldilocks = modern CPU + modest GPU/NPU" (~100 ms) |
| **Gemini** | 110–160 ms ("viable base") | **Tier 3 Apple Silicon (55–95 ms)** — says CPU can't clear 100 ms |
Material divergence: **our bank is the most optimistic about CPU-only.** Both web models push the
sub-100 ms threshold up to Apple Silicon / a small NPU/GPU. This directly challenges our
golden-medium claim → **F1 must settle whether CPU-only truly hits <100 ms or Apple Silicon/WebGPU
is required.**

### Dispute C — on-device command-STT real latency (ticket A2/A3)
ChatGPT's concrete on-device numbers are **far less rosy** than the "80–160 ms" Parakeet-EOU figure
in our STT merge:
- **NVIDIA Parakeet/Nemotron TDT 0.6B: ~560 ms alg. delay on CPU** (7.3% streaming WER), 50–100 ms
  only on GPU. Canary 1B: 4.8 s on CPU — unusable.
- Gemini's Moonshine "<50 ms chunk" and sherpa "70–90 ms" are the optimistic end.
→ Big spread (50 ms → 560 ms) for "on-device command STT." **A2/A3 head-to-head bench is now
clearly the critical-path unknown**, and CPU Parakeet may be 5× slower than our merge assumed.

## 3. New data / options to add

- 🆕 **Voxtral-Mini-4B (browser WebGPU)** — a fully client-side STT we didn't have: **~480 ms /
  4.90% WER**, tunable to **160 ms / 6.46% WER**, no data leaves the device (ChatGPT [57]). Add to
  the A3 on-device candidate list as the *browser-native, no-install* option.
- 🆕 **Comprehend Medical DetectPHI** as a cloud de-id option alongside Presidio/Philter (E1).
- 🆕 **WebGPU in-browser LLM inference** maturing (both reports) — supports an in-browser L3 without
  native install; pairs with the Tier-2/WebGPU hardware question.
- 🆕 **AssemblyAI Universal-3** corroborated at **~150 ms P50, ~6.3% WER** — consistent across both
  web models and our bank (one of the few numbers everyone agrees on).

## 4. Credibility / quality notes (read the two reports differently)

- **Gemini:** polished, confident, **rounder and rosier numbers** (66–97 ms P95 total; Deepgram
  80–90 ms). Reads more decisive but several figures look best-case/marketing-adjacent. **At least
  one citation appears fabricated** — "Native Audio Transformers (2025), DOI 10.48550/arXiv.2501.00123"
  — the ID/title smell synthetic; **do not cite without verifying.**
- **ChatGPT:** more **conservative and hedged** (lots of unknown `~~` cells), but explicitly marks
  vendor-claim vs independent, and gives **specific, credible tradeoffs** (Voxtral 480 ms↔160 ms).
  Its citation markers (【29†…】) point to sources we can't see — treat as leads, not proof.
- **Net:** trust ChatGPT's conservatism on latency, take Gemini's numbers as the optimistic bound,
  and treat the *gap between them* as the bench's job. Both agreeing with our architecture is
  reassuring but not independent confirmation.

## 5. Ticket impacts (applied to OPEN-QUESTIONS §I)
- **A2/A3** — add Voxtral-Mini-4B; flag CPU-Parakeet ~560 ms vs ~120 ms dispute; bench is now top priority.
- **A4** — TTFP dispute (80/150/300 ms) → bench.
- **B1** — both web models confirm **no independent Rhino latency exists** (only "no latency"/97%
  marketing). Web lane couldn't crack it → **bench-only resolution.** Stays 🔴.
- **E1–E4** — vendor BAA pattern confirmed (Deepgram ZDR / Azure containers / AWS stateless / OpenAI
  via Azure); + Comprehend Medical. Downgrade confidence-risk; still verify exact covered endpoints.
- **F1/F2** — sharpen: **does CPU-only hit <100 ms, or is Apple Silicon/WebGPU required?** (our bank
  vs both web models disagree).
- **G1** — incumbent gaps confirmed; product thesis validated.
- 🆕 **A9** — evaluate Voxtral-Mini-4B (browser WebGPU) as the no-install on-device STT option.
- ⚠️ **Verify-or-discard:** Gemini's arXiv:2501.00123 and ChatGPT's arXiv:2506.23325 (EOT tokens)
  citations before they enter the bank.
