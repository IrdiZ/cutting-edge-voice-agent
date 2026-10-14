# Merge analysis — Literature search "Streaming speech to intent latency" × our internal bank

Source: a literature-search report (not included in this repo) — 66 papers,
97% estimated coverage, May 2026. Citations below are by **catalog number + title** from that
file's detail entries (Literature search's summary uses a *different* internal numbering — ignore its
brackets).

Bottom line: the literature **confirms our central architectural bet** (act on partial
hypotheses; use joint ASR+endpointing / predictive end-of-utterance to commit before the speaker
stops) and **validates the bounded-intent-registry choice** over open-vocabulary LLM command
parsing. It also surfaces **one risk we under-weighted: partial-hypothesis instability
("flickering")** — the cost-of-false-early-commit problem we now must design against explicitly.

---

## 1. What the literature CONFIRMS (promote to high-confidence)

| Our claim | Confirming papers (catalog #) | Hard numbers |
|-----------|-------------------------------|--------------|
| Fire on partials, not finals; finalization is gated by endpointing | #9 FastEmit, #11 Min-latency transducer, #20 Fast+Accurate streaming, #27 Dissecting UPL | FastEmit: p90 emission latency **210→30 ms** on LibriSpeech, **150–300 ms** cut on voice search, WER *improved* 4.4→3.1%. Min-latency training: **220→27 ms** at only 0.7% WER cost |
| Joint ASR + endpointing beats a separate endpointer | #15 Unified ASR+EP, #32 Joint Endpointing & Decoding, #24 On-device RNN-T+LAS | #15: median endpoint latency **−120 ms (−30.8%)**, p90 **−170 ms**, no WER regression. #32: **>2×** latency reduction |
| Predictive EOU lets you act *before* the user stops | #18 Predictive ASR + EOU, #19 Turn-Taking Prediction, #46 Personalized Predictive ASR | #18: estimate EOU **up to 300 ms before** actual end. #19: **97% recall / 85% precision @ 100 ms** latency, explicitly robust to disfluencies (pausing to think) |
| Semantic turn detection > fixed silence (our Smart Turn pick) | #19 Turn-Taking, #50 E2E Segmenter, #60 Semantic VAD, #45 SpeculativeETD | #50: semantic segmenter **−250 ms** end-of-segment latency vs VAD; uses the *"set an alarm for… 5 o'clock"* hesitation case — exactly the user thinking-pause problem |
| Speculative / prefetch execution on partials hides latency | #40 E2E Prefetching, #46 Predictive ASR, #13 RNN-T SLU, #42 Pilot Inference | #40: **~200 ms** saved; e2e prefetch **120 ms faster** than silence-based. #42 PASU: **2× end-to-end** latency cut on 6–8-core Arm |
| Dual-lane: common commands on-device, rare ones to cloud | #26 TinyS2I, #44 SpeechCache learning cache, #17 On-device deliberation | #44: resolves **45–90% on device**, **−80%** avg latency vs cloud. #26: heavy-tail on-device, defer the rest — our exact two-lane logic |
| Lightweight on-device STT (our Moonshine pick) | #49 **Moonshine v2** (Feb 2026!) | Sliding-window streaming encoder, **bounded low TTFT** (vs Whisper's grow-with-length), accuracy of models **6× its size** — confirms and upgrades our STT agent's Moonshine recommendation |

## 2. NEW techniques worth adopting (weren't in our bank)

- **Train-free FST/trie command decoders — #36 Finstreder, #34 Slungt (2025).** Embed intents +
  entities into finite-state transducers / tries *on top of a general STT model*, **no extra
  training, built in seconds, language-independent**, and Slungt is the speed leader. This is a
  concrete, citable recipe for our **L1 grammar layer** — we can stand up the command grammar with
  zero training data. → Action: prototype Finstreder/Slungt-style FST decoding in Phase 2.
- **Streaming Intended Query Detection — #48.** Detects device-directed speech (command vs not)
  and can declare *early on partial results*; **+22% EER, −600 ms** vs a standalone detector. This
  is a principled mechanism for our **dictation-vs-command separation**, beyond a wake token.
- **Speculative end-turn detection — #45 SpeculativeETD (2025).** Lightweight **local GRU** for
  fast non-speech detection + **server Wav2vec** for the hard pause-vs-turn-end call. A ready-made
  pattern for splitting turn detection across our on-device/cloud lanes.
- **Two-pass / EP-arbitrator endpointing — #41, #25.** A fast first-pass endpoint verified by a
  2nd-pass model; #25 (2025, neural-audio-codec features + label-delay) cuts cutoff errors
  **37–43% at 160 ms** median latency. Good for the dictation lane where false cutoffs are costly.

## 3. The GAP — and the reality check (this changes our risk posture)

- **Embedded command-vs-dictation segmentation is genuinely hard and under-studied.** #5 **Toward
  Interactive Dictation (TERTiUS)** frames our *exact* task — "incrementally segment and classify
  spans of speech as either dictation or command, and interpret the commands" — and the numbers
  are sobering: **30% end-state accuracy at 1.3 s latency, 55% at 7 s** with LLM-based open-ended
  command parsing. **Takeaway: open-vocabulary natural-language command parsing inside dictation
  is too slow and too inaccurate today.** This is strong evidence *for* our bounded-intent
  registry + FST approach and *against* leaning on an LLM for the common command path.
- **Medical prior art exists — #66 "Are You Dictating to Me? Detecting Embedded Dictations in
  Doctor-Patient Conversations" (2021).** Closest academic analogue to our dictation/command split
  in a clinical setting; read it before designing the separator.
- **Partial hypotheses are UNSTABLE — and we hadn't priced this in.** #35 (stability analysis),
  #38 (flickering reduction — *"words previously displayed change or disappear"*), #47 (Baumann:
  **90% of early edits are spurious; a 320 ms lag is needed to cut that to 10%**), #57
  (word-stability estimation). **If we fire a command on the first partial that matches, we will
  mis-fire on partials that later get revised.** The literature's answer is an explicit
  stability/commit policy — word-stability scoring, partial reranking (#38 halves flickering with
  negligible latency/quality cost), or a small confidence-lag — which is exactly the
  cost-of-false-early-commit trade-off. → This becomes a **first-class design problem**, not a
  detail (see new ticket A6).

## 4. Honest limits of this haul

- Most papers report **WER / intent-accuracy on FSC/ATIS/SLURP**, not millisecond
  *intent-commit* timing or false-action cost — Literature search flags this too. The sharp ms numbers
  live in the **ASR-emission / endpointing** literature, not in bounded-intent streaming SLU.
- So the literature tells us *the building blocks are fast and the early-commit idea is sound*,
  but **nobody has published our exact metric** (pre-EOU command-commit latency + mis-fire cost
  for a bounded radiology registry). That's a genuine whitespace — and the thing our Phase-0 bench
  should measure and could even publish.

## 5. Net effect on OPEN-QUESTIONS

- **A1 (fire-on-partial vs wait-k)** → now evidence-backed: use word-stability / partial-rerank
  (#38, #47, #57) to set the commit threshold; ~320 ms is the literature's stability knee, but our
  on-device fast STT + FST may beat it. Still 🔴 — bench decides the exact policy.
- **NEW A6 (partial-hypothesis stability / flickering commit policy)** → added, 🔴 blocking.
- **B-layer (L1 grammar)** → adopt Finstreder/Slungt FST recipe (#34, #36); de-risks "build the
  command grammar without training data."
- **C1 (semantic turn detection)** → strongly confirmed (#18, #19, #50); Smart Turn pick stands,
  with academic backing for the disfluency/thinking-pause case.
- **#9 "what are we missing"** → biggest find is the **stability/flickering** problem and the
  **train-free FST decoders**; biggest *non*-find is that our exact latency metric is unpublished.
- **Dictation-vs-command separator** → seed it with #48 (intended-query detection) + #66 (medical
  embedded-dictation); do NOT rely on open-vocab LLM parsing (#5 TERTiUS shows it's 1.3–7 s).

## 6. Top papers to actually read in full (ranked for our build)

1. #5 Toward Interactive Dictation (TERTiUS) — defines our task + its hard limits.
2. #49 Moonshine v2 (2026) — our on-device STT, latest streaming-encoder variant.
3. #34 Slungt / #36 Finstreder — train-free FST command decoders (our L1).
4. #19 Turn-Taking Prediction + #18 Predictive EOU — commit-before-end + thinking-pause handling.
5. #38 Flickering Reduction + #47 Baumann + #35 stability — the partial-commit-stability policy.
6. #48 Streaming Intended Query Detection + #66 embedded dictation — the dictation/command split.
7. #44 SpeechCache + #26 TinyS2I — the on-device/cloud heavy-tail split.
