# Merge analysis — Literature search "Always on voice robustness and barge in" × our bank

Source: a literature-search report (not included in this repo)
— **141 papers, 86% coverage**, May 2026. Citations by catalog # + title from this file.

Bottom line: this lane **converts RISKS.md's hand-wavy "mandatory AEC" line into a concrete,
deployable approach** — and the answer is *speaker-enrolled personalization*, not echo
cancellation. The cockpit enrolls the logged-in user's voice once; a streaming on-device
**target-speaker front-end** then suppresses everyone else's speech and room cross-talk at the
signal level. This elegantly solves the shared-reading-room problem **and** shrinks the B8
separator's job. AEC turns out to be secondary (only matters if we emit audio — and we lean
visual-only).

---

## 1. The headline: speaker-enrolled target isolation (the primary defense)

The strongest, most deployable line — streaming, on-device, real-time, 8-bit-quantizable:

- **VoiceFilter-Lite (#1, Google).** Single-channel, on-device, streaming target-*voice separation*
  that keeps only the enrolled user's speech; explicitly designed to **not hurt ASR in non-overlap
  conditions**, with adaptive runtime suppression strength; runs as an 8-bit int model in realtime.
  The reference architecture for our front-end.
- **Personal VAD 2.0 (#2, Google).** Personalized VAD that fires only on the *target* speaker's
  voice activity; streaming, small, production-oriented, works **enrollment and enrollment-less**.
- **Streaming target-speaker ASR + activity detection (#17, #18, #73).** Fuse target-speaker
  conditioning directly into the recognizer.
- **SpeakerBeam-SS (#4, 2024):** real-time TSE, Conv-TasNet + state-space, **−78% RTF**.
  **TargetVoice (#76, 2025):** single-channel low-latency TSE. **TF-MLPNet (#83, 2025):** tiny
  real-time separation.

**Why this matters for us:** enroll the user at login → the front-end ignores colleagues,
phone calls, and room cross-talk by *identity*. This simultaneously (a) hardens the always-on
self-trigger risk, and (b) **reduces the B8 separator's burden** — only the user's own
speech reaches it, so the separator only has to split command-vs-dictation, not "is this the right
person." Two problems, one front-end.

## 2. Low-friction enrollment variants (pick one for the login flow)

- **Enrollment-less personal VAD (#102)** — no separate enrollment step.
- **Ultra-short / wake-word reference speech (#65, #23)** — a few seconds keys the target.
- **HyWA hypernetwork-adapting (#84, 2025), FDE-Mamba (#48, 2026), self-supervised noise-robust
  TS-VAD (#85, 2025)** — recent accuracy/robustness refinements.
- **Comparative real-world effectiveness study (#61)** — read before picking, real-world gap.

## 3. The deployment gotcha — inactive-target false alarms (must validate)

- **"Listen only to me! How well can target speech extraction handle false alarms?" (#19,
  Delcroix)** + over-suppression analyses (#6). Target extraction can hallucinate output or
  over-suppress **when the target is silent** — and users pause constantly. This is the
  exact failure mode to bench: does the front-end stay quiet during thinking-pauses and not leak
  cross-talk? → add to the Phase-0 scorecard.

## 4. AEC / self-output suppression — secondary (only if we emit audio)

Per our ranking, this is the backstop, and the literature confirms a clear recipe **if** needed:
- **Hybrid linear AEC + neural residual echo suppression** is the practical standard, optimized
  for downstream ASR/KWS not fidelity (#3, #7, #11, #13; 38–59% WER gains). Joint front-ends
  (DeepVQE #15, NeuralEcho #16, Conformer frontend #6) combine AEC+enhancement+separation+target.
- **Textual Echo Cancellation (#5, Google)** — cancels TTS playback using the playback *text*, not
  audio; smaller and can be sent before synthesis. The efficient path **if** we do spoken output.
- **Implicit AEC for KWS + device-directed (#10):** −56% false-reject during playback at **100×
  less compute** than E2E neural AEC.
- **Directional SR with full-duplex (#8, 2025):** AEC + AEC-aware training removes TTS loopback,
  **>70% WER** improvement.
- ⚠️ **But:** if confirmations/clarifications are **visual** (our design lean), self-output AEC is
  **nearly moot** — the whole §4 collapses. Decide the TTS question and this section may not apply.

## 5. Multichannel / directional — an upgrade *if* the workstation has a mic array

Powerful but needs ≥2 mics (a single workstation mic can't do directional):
- **Directional ASR for cross-talk suppression (#9):** near-perfect wearer/bystander disambiguation
  + suppression of non-target-direction speech. Array-agnostic variants (#28 AGADIR, #41
  TfCleanformer). Beamformer-guided / spatially-selective TSE (#44, #45, #30 low-latency).
- **SonicSieve (#129, smartphone), smart-glasses DASR (#8/#9)** show it works on consumer form
  factors. → Treat as a **Tier-2 hardware upgrade** (add a cheap mic array to the workstation) if
  single-channel personalization isn't enough in the bench.

## 6. Barge-in & full-duplex — thin, as predicted (lowest band)

- Barge-in is mostly framed as **playback-overlap robustness** (Reference-free AEC for Alexa
  Barge-In #33; Contextual Acoustic Barge-In #126 — also seen in R2-2), **not** interruption policy.
  Good enough: for us "barge-in" = let the user override an in-progress action, which is a
  UI/state concern, not a signal one.
- Full-duplex kept for architecture only: **UAF unified audio front-end LLM (#74, 2026)**,
  **FireRedChat (#124, 2025)**. Not core to a command cockpit.

## 7. Closest-domain validation
- **Target Speaker Isolation for Mobile Health Assessment From Speech With Crosstalk (#134, 2026,
  IEEE Access)** — medical + crosstalk, the nearest-domain proof that speaker isolation works for
  clinical speech in interference. Read it.

## 8. Net effect on the bank
- **RISKS.md** — replace the "mandatory AEC" hand-wave: primary defense is **speaker-enrolled
  personal VAD + target-speaker extraction** (VoiceFilter-Lite #1 + Personal VAD 2.0 #2); AEC only
  if audio output; **must bench inactive-target false alarms** (#19). → propagate.
- **ARCHITECTURE.md** — add a **target-speaker front-end** stage before VAD/STT (enroll at login).
- **B8 separator** — note personal VAD upstream means the separator only sees target speech.
- 🆕 **New ticket C6** — speaker-enrolled target-isolation front-end (enrollment flow + inactive-
  target false-alarm validation + single-channel vs mic-array decision).
- ⚠️ **Limit:** these are smart-speaker/glasses/phone results; none on a radiology reading room
  with a workstation mic — transferable, bench-required. Single-channel personalization is the
  baseline; directional needs a mic array.

## 9. Papers to read in full (ranked)
1. **#1 VoiceFilter-Lite** + **#2 Personal VAD 2.0** — the on-device front-end recipe.
2. **#19 "Listen only to me!"** — inactive-target false alarms (the gotcha).
3. **#134 Target Speaker Isolation for Mobile Health (2026)** — closest medical+crosstalk proof.
4. **#102/#65/#23 enrollment-less / short-reference personal VAD** — the login enrollment flow.
5. **#5 Textual Echo Cancellation** + **#10 Implicit AEC** — only if we emit audio.
6. **#9 Directional ASR cross-talk suppression** — the mic-array upgrade path.
