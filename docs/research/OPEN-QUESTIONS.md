# Open Questions — running ticket list

The unresolved questions that gate the design, pulled from all six research streams + synthesis.
Each is a ticket: a question, why it matters, and how to settle it. Settle most via the Phase-0
bench on **real reading-room mic audio** — vendor/paper numbers (many on clean TTS audio) are
hypotheses, not facts. Update status as the internal + external research banks merge.

Status key: 🔴 blocking · 🟡 important · 🟢 nice-to-have · ✅ resolved

---

## A. Latency / STT hot path

- 🔴 **A1 — Fire-on-partial vs wait-k, per command type.** Navigation can fire eagerly on a
  partial; destructive ops ("sign", "delete", "finalize") must not. Define the policy per command
  class and measure the false-fire rate at each k. *Settle: bench + mis-fire audit.* **Evidence
  (Undermind merge):** the partial-commit-stability literature — Flickering Reduction (#38),
  Baumann (#47: ~90% of early edits spurious, a 320 ms lag cuts that to ~10%), word-stability
  (#35, #57) — says the policy should be driven by a word-stability / partial-rerank score, not a
  flat k. See [literature/MERGE-streaming-speech-to-intent.md](literature/MERGE-streaming-speech-to-intent.md).
  **Answered by R2-1 merge:** per-command policy = **local-agreement N with cost-tiered N** (N=1–2
  navigation; revision-window=0 or clarification for destructive), not a flat wait-k — human
  cost-asymmetry behavior (Loth #20) validates the shape. Remaining 🔴 work is bench-tuning N.
- 🟡 **A6 — Partial-hypothesis stability ("flickering") commit policy.** Was 🔴; **mechanism now
  decided** by the dedicated Undermind run (see
  [literature/MERGE-partial-commit-stability.md](literature/MERGE-partial-commit-stability.md)).
  **Policy:** layered cost-tiered commit gate, all no-retraining — default **local-agreement /
  majority-vote (commit when trigger span is stable across N=2–3 partials**, EffWhiS/Whisper-
  Streaming); lag made adaptive via per-word **stability score** (McGraw) or **uncertainty**
  (ESTRA); **cost tiers** (Loth, PLoS ONE 2018): low-cost commits eagerly + optimistic preview,
  high-cost/destructive uses **revision-window=0** (Revision-Controllable Decoding) or a
  clarification prompt; clean displayed dictation with partial reranking/rewriting. Remaining work
  is *tuning, not design*: pick N and thresholds on the bench. *Settle: implement gate in Phase 2;
  tune with revokes/sec, word-stability, normalized flicker, commit-latency vs mis-fire.*
- 🔴 **A2 — Real on-device command-STT latency on reading-room mic audio.** The 80–160 ms
  Parakeet-EOU figure was clean-TTS. **Web merge widened the dispute hard:** ChatGPT puts Parakeet/
  Nemotron TDT 0.6B at **~560 ms on CPU** (50–100 ms only on GPU), Canary 1B at 4.8 s; Gemini puts
  Moonshine at "<50 ms chunk." So the real on-device command-STT latency is anywhere in **50–560 ms**
  on CPU — the critical-path unknown. *Settle: bench on real audio.* See [web-research-merge.md](web-research-merge.md).
- 🔴 **A3 — On-device command STT pick: Parakeet-EOU vs Moonshine v2 vs sherpa-onnx Zipformer vs
  Voxtral-Mini-4B.** Now top-priority (was 🟡). Which wins on Tier-1/2 for latency × WER × footprint?
  *Settle: head-to-head bench.*
- 🟡 **A4 — Deepgram Nova-3 Med TTFP + endpointing tuning.** **Web merge = 3 conflicting numbers**
  (Gemini 80–90 ms P50, our merge ~150 ms, ChatGPT ≲300 ms). Plus confirm `endpointing≈150 ms` +
  `utterance_end_ms≈1000` and that disabling `smart_format` removes the number-stall. *Settle:
  bench on real audio + hospital network.*
- 🟢 **A5 — WebRTC vs WebSocket measured stall under packet loss** in our deployment. Confirm the
  head-of-line-blocking penalty is real on hospital networks. *Settle: network-degradation test.*
- 🟡 **A9 — Evaluate Voxtral-Mini-4B (browser WebGPU) as the no-install on-device STT.** NEW (web
  merge): ~480 ms / 4.90% WER, tunable to 160 ms / 6.46%, fully client-side. The browser-native
  option that needs no native install. *Settle: bench vs Moonshine v2 in-browser.*

## B. Intent decoder

- 🔴 **B1 — Independent Picovoice Rhino latency benchmark.** No published standalone ms figure
  exists — **both web deep-research models confirmed this too** (only "no latency" / 97%-intent
  marketing). The web lane couldn't crack it → **bench-only resolution.** Benchmark on our hardware
  + verify radiology vocab coverage. *Settle: bench + vocab coverage test.*
- 🔴 **B2 — Static-embedding (Model2Vec/potion-32M) recall on radiology paraphrases.** Verify the
  sub-1 ms / ~93%-of-MiniLM claim holds for *our* paraphrase set, not generic MTEB. *Settle:
  labeled radiology-paraphrase recall test vs transformers.js MiniLM.*
- 🟡 **B3 — Confidence calibration method: isotonic vs conformal.** Pick one; determine how much
  logged-utterance data is needed before thresholds are trustworthy. *Settle: calibration study.*
- 🟡 **B4 — Single-source-of-truth across engines.** Can one `CommandDef` generate Rhino context
  grammar + regex/FST + embedding anchors + LLM tool schema without drift? *Settle: build spike.*
- 🟡 **B5 — Proper-noun resolver against dynamic worklist.** Confirm Double Metaphone +
  Jaro-Winkler + SymSpell over *today's worklist only* beats STT errors ("Smith"/"Smyth").
  *Settle: name-confusion test set.*
- 🟢 **B6 — LLM fallback TTFT tail.** Groq ~80 ms p50 but a >5% high-TTFT tail. Does
  preview-then-confirm fully hide it? Compare Groq vs Cerebras vs Fireworks. *Settle: TTFT bench.*
- 🟢 **B7 — Grammar-biased ASR.** Would biasing the STT decoder toward the command grammar raise
  command recall without hurting dictation? *Settle: keyterm-prompting experiment.*
- 🔴 **B8 — Command-vs-dictation separator design.** NEW (R2-2 merge). No off-the-shelf solution —
  build-and-bench, but de-risked by a clear recipe (see
  [literature/MERGE-command-spans.md](literature/MERGE-command-spans.md)). **Design:** streaming
  classifier fusing **partial-ASR lexical/semantic (primary)** + **lightweight acoustic/prosodic
  (earliest rejection)** + **app-mode / interaction-history context** (SAS/SDAR 2026: history was
  the dominant signal, F1 0.95→0.57 without it), with a small on-device fine-tuned LLM
  (Qwen2-1.5B, #4) as the slow lane for hard cases. Baseline to beat: medical dictation detection
  90.4% utt / 86.8% word F1 (#4, ACI-Bench). **Optimize false-accept first** (mis-fire on dictation
  > missing a command); reject-side targets from literature: 1.5% FPR (#38), 93.3% reject@99%TPR
  (#12). *Settle: prototype the fusion separator in Phase 2–3; bench vs ACI-Bench baseline +
  reading-room audio; reuse #4 word-alignment trick for transcript-subtraction accuracy.*

## C. VAD / endpointing / turn

- 🔴 **C1 — Semantic end-of-utterance: Smart Turn v3.1 vs LiveKit text-based vs fixed timeout.**
  Does Smart Turn (12 ms CPU) actually stop premature finalization on user thinking-pauses
  ("the findings are… uh…")? *Settle: bench on real pause-heavy dictation.*
- 🟡 **C2 — TEN-VAD vs Silero end-of-speech latency, independently verified.** TEN-VAD vendor
  claims lower EOS latency; confirm before swapping. *Settle: bench both in onnxruntime-web.*
- 🟡 **C3 — Transcript subtraction accuracy.** Does word-span subtraction cleanly remove the
  spoken command from the dictation buffer without clipping adjacent dictation? Undo-log UX.
  *Settle: span-boundary test + medico-legal review.*
- 🟢 **C4 — Wake-token / push-to-command gating need.** Is a modifier needed only for destructive
  ops, or more broadly, to keep mis-fires acceptable? *Settle: mis-fire rate with/without gating.*
- 🟢 **C5 — Fusing acoustic + linguistic turn signals** (refs: Easy Turn arXiv:2509.23938,
  hierarchical EOU arXiv:2603.13379). Worth the complexity? *Settle: literature + spike.*
- 🔴 **C6 — Speaker-enrolled target-isolation front-end.** NEW (R2-3 merge). The reading-room
  always-on defense = enroll the user's voice at login, then a streaming on-device
  **target-speaker front-end** (VoiceFilter-Lite #1 + Personal VAD 2.0 #2) suppresses colleagues /
  cross-talk / phone calls by *identity* — solving self-trigger AND shrinking the B8 separator (only
  target speech reaches it). Open sub-questions: (a) enrollment flow — enrollment-less vs short/
  wake-word reference (#102/#65/#23); (b) **inactive-target false alarms** — does it stay quiet
  during thinking-pauses, not leak cross-talk? (#19 Delcroix — the gotcha); (c) single-channel
  (VoiceFilter-Lite) vs mic-array directional (#9) — directional needs ≥2 mics → Tier-2 hw upgrade.
  Closest proof: medical+crosstalk target isolation (#134, 2026). *Settle: bench on reading-room
  audio with colleagues talking.* See [literature/MERGE-always-on-robustness.md](literature/MERGE-always-on-robustness.md).

## D. Transport / framework

- 🟡 **D1 — Adopt LiveKit Agents vs Pipecat vs custom** for the WebRTC+STT plumbing of a *command*
  (not conversational) cockpit. Which strips cleanest down to no-TTS? *Settle: prototype both.*
- 🟢 **D2 — Browser WASM/WebGPU vs native latency gap** for on-device STT/VAD/embeddings. How much
  do we lose staying in-browser (no native install)? *Settle: in-browser vs native bench.*
- 🟢 **D3 — Co-location / regional endpoint** for the dictation lane to shave network RTT.
  *Settle: multi-region latency probe.*

## E. PHI / compliance

- 🔴 **E1 — De-identification recall before LLM fallback.** Philter (~99% recall) vs Presidio vs
  Comprehend Medical — measure recall on radiology transcripts; a miss = PHI leak. *Settle:
  PHI-recall eval on de-id'd sample transcripts.*
- 🟡 **E2 — Confirm BAA-covered endpoints, not just vendors.** e.g. Azure Speech is covered but
  the Azure OpenAI Realtime audio modality may not be; OpenAI/Anthropic only on ZDR endpoints.
  Document the exact covered config per chosen vendor. *Settle: legal/contract review.*
- 🟡 **E3 — Always-on-mic capture posture in the reading room.** Wake-token/push-to-command vs
  true always-recording — pick the defensible default. *Settle: compliance + clinician review.*
- 🟢 **E4 — OpenAI 2025 court-ordered retention uncertainty.** Does it disqualify OpenAI for the
  dictation/LLM lane? *Settle: track status; prefer Bedrock-Claude / AWS boundary meanwhile.*

## F. Hardware ladder

- 🔴 **F1 — Does CPU-only actually clear sub-100 ms, or is Apple Silicon/WebGPU required?**
  Upgraded 🟡→🔴: **the web merge disputes our golden-medium claim.** Our bank says Tier-1 CPU =
  80–150 ms (golden); ChatGPT says CPU-only is 200–400 ms; Gemini says CPU is a "viable base" at
  110–160 ms and you need **Apple Silicon (55–95 ms)** to clear 100 ms. If they're right, the
  golden medium shifts up a tier. *Settle: bench mouth-to-command on a real CPU-only workstation.*
- 🟡 **F2 — Tier-2 (Apple Silicon/ANE/WebGPU)** real gain: is it ~55–110 ms in practice (both web
  models lean on it for sub-100 ms)? *Settle: bench on M-series + WebGPU.*
- 🟢 **F3 — Shared-GPU cold lane sizing** for dictation/LLM — one box for how many users
  before latency degrades? *Settle: load test.*

## G. Product / prior art

- 🟡 **G1 — Validate the 4 incumbent gaps** (verbal-punctuation tic, accent accuracy collapse,
  PHI-to-cloud, partial zero-click) against current PowerScribe One / Dragon / Rad AI releases —
  are they still open in 2026? *Settle: hands-on demos + recent user reports.*
- 🟢 **G2 — Command set v1.** Which ~20 commands deliver the most hands-free value first
  (worklist nav, findings dictation, impression gen, sign-and-next, laterality/critical-finding
  guardrails)? *Settle: user workflow interviews.*

---

## H. Literature merges

### H.1 — Undermind "Streaming speech to intent latency" (2026-05-27, 66 papers, 97% coverage)
Full analysis: [literature/MERGE-streaming-speech-to-intent.md](literature/MERGE-streaming-speech-to-intent.md).
- ✅ **Confirmed by literature** (high confidence now): fire-on-partials + joint ASR+endpointing
  (FastEmit #9: p90 210→30 ms; Unified EP #15: −120 ms median); predictive EOU commits *before*
  speech ends (#18: 300 ms early; #19: 97%/85% @100 ms, disfluency-robust); semantic turn
  detection > silence (#50: −250 ms); speculative/prefetch on partials (#40: ~200 ms); dual-lane
  on-device/cloud heavy-tail split (#26 TinyS2I, #44 SpeechCache 45–90% on-device, −80% latency);
  Moonshine v2 (#49, 2026) as on-device STT.
- 🆕 **New ticket A6** added (partial-hypothesis flickering commit policy).
- 🆕 **Adopt train-free FST/trie command decoders** (#34 Slungt, #36 Finstreder) for the L1
  grammar — stand up the command grammar with zero training data. → fold into Phase 2.
- 🆕 **Dictation-vs-command separator** seeds: Streaming Intended Query Detection (#48) + medical
  embedded-dictation (#66). **Do NOT** rely on open-vocab LLM parsing — TERTiUS (#5) shows it's
  30% acc @1.3 s / 55% @7 s. Reinforces the bounded-intent-registry choice.
- ⚠️ **Whitespace:** nobody publishes our exact metric (pre-EOU command-commit latency + mis-fire
  cost for a bounded radiology registry). Phase-0 bench measures it; potential publication.
- **Still open / not answered by literature:** A2, A3, A4 (vendor/hardware bench), B1 (Rhino ms),
  all of E/G (PHI, commercial prior art) — route these to the general web deep-research model.

### H.2 — Undermind "Partial hypothesis stability and commit policies" (2026-05-27, 75 papers, 100% coverage)
Full analysis: [literature/MERGE-partial-commit-stability.md](literature/MERGE-partial-commit-stability.md).
- ✅ **A6 mechanism resolved** (downgraded 🔴→🟡): layered cost-tiered commit gate — local-agreement /
  majority-vote (EffWhiS #7, Whisper-Streaming #6) as default; adaptive lag via stability score
  (McGraw #4) or uncertainty (ESTRA #8); revision-window=0 (#19) or clarification for destructive
  commands; partial reranking/rewriting (#2, #50) for the displayed dictation.
- ✅ **A1 answered** (policy shape): local-agreement N with cost-tiered N, not flat wait-k.
- ✅ **Cost-tiered thresholds + clarification FSM empirically grounded** — Loth et al. PLoS ONE 2018
  (#20): humans commit on suggestive evidence when error cost is low, wait when high, and use echo
  questions under time-pressure. Backs the COMMAND-REGISTRY clarification design + RISKS mis-fire
  mitigation. → propagate into COMMAND-REGISTRY.md (confidence/clarify) and RISKS.md (mis-fires).
- 🆕 **Mid-utterance subactions** (Constantin #23): start reversible subactions before EOU — backs
  async/optimistic preview for low-cost commands.
- 🆕 **Bench metrics adopted:** revokes-per-second (#13), word/segment stability (#3/#4), normalized
  flicker (SLTev #31), revision-policy methodology (#29) — wire into the Phase-0 harness.
- ⚠️ **Limit:** cost-asymmetry rests largely on one psychology paper (#20) + dialogue work, not
  deployed ASR; adjacent SimulMT/caption work measures BLEU/AL/flicker, not action-commit latency.
  Mis-fire cost for a bounded radiology registry stays unpublished → Phase-0 bench (our whitespace).

### H.3 — Undermind "Command spans without wake word" (2026-05-27, 40 papers, 96% coverage)
Full analysis: [literature/MERGE-command-spans.md](literature/MERGE-command-spans.md).
**Confirmed the gap** (thin haul, as predicted): no off-the-shelf hotword-free command-vs-dictation
segmenter. But de-risked the build:
- 🆕 **New ticket B8** (separator design) with a concrete fusion recipe + reject-side targets.
- 🆕 **Closest prior art is medical + current:** LLM-Based Dictation Detection (Schaaf, ASRU 2025,
  Qwen2-1.5B → 90.4% utt F1, ACI-Bench open dataset) + "Are You Dictating to Me?" (2021, lexical >
  acoustic, fusion best). Gives us a baseline + dataset to benchmark the separator against.
- 🆕 **Architectural reframe (SAS/SDAR 2026):** model command-vs-dictation as **sequential routing
  over interaction/app-mode history**, not per-utterance classification (history was the dominant
  signal). Reinforces the scope-gated registry → propagate to ARCHITECTURE + COMMAND-REGISTRY scope.
- 🆕 **Execute-while-speaking** (Online Semantic Parsing, ACL 2022: 30–65% latency cut) backs the
  async/optimistic early-action lane.
- 🔁 Routed to other lanes: FastTurn 2026 + barge-in → C1 / the pending R2-3 full-duplex merge.
- ⚠️ **Limit:** device-directed work assumes short standalone commands, not commands embedded in
  long dictation — transferable recipe, not a drop-in. Separator stays build-and-bench.

### H.4 — Undermind "Always on voice robustness and barge in" (2026-05-27, 141 papers, 86% coverage)
Full analysis: [literature/MERGE-always-on-robustness.md](literature/MERGE-always-on-robustness.md).
**Converts RISKS' "mandatory AEC" hand-wave into a deployable approach** — and the answer is
*speaker-enrolled personalization*, not echo cancellation:
- 🆕 **New ticket C6** — speaker-enrolled target-isolation front-end (VoiceFilter-Lite #1 + Personal
  VAD 2.0 #2): streaming, on-device, 8-bit; suppress colleagues/cross-talk by *identity*.
- 🆕 **Two problems, one front-end:** personal VAD upstream solves self-trigger AND shrinks the B8
  separator (only the user's speech reaches it). → propagate to ARCHITECTURE + B8.
- ⚠️ **Deployment gotcha:** inactive-target false alarms (#19 Delcroix) — must bench that the
  front-end stays quiet during thinking-pauses; add to Phase-0 scorecard.
- ✅ **AEC demoted to backstop:** only matters if we emit audio; Textual Echo Cancellation (#5) is
  the efficient path *if* needed, but visual-only confirmations make it nearly moot.
- 🔁 **Mic-array directional** (#9, near-perfect cross-talk suppression) = a Tier-2 hardware upgrade
  (needs ≥2 mics); single-channel personalization is the baseline.
- ⚠️ **Limit:** all smart-speaker/glasses/phone results; none on a reading-room workstation mic.

## I. Web deep-research merge (vendor / PHI / hardware lane)

### I.1 — Gemini + ChatGPT deep research (2026-05-27)
Full analysis: [web-research-merge.md](web-research-merge.md).
**Both web models independently converged on our exact architecture** (dual-path, fire-on-partial,
Model2Vec, Deepgram Nova-3 Med, Moonshine v2, 3-layer cascade, WebRTC, on-device PHI) — strong
triangulation. Value = the **disputes** the agreement brackets:
- ⚔️ **A4 — Deepgram TTFP unresolved:** 80–90 ms (Gemini) / ~150 ms (our merge) / ≲300 ms (ChatGPT).
- ⚔️ **A2/A3 — on-device command STT spread is huge:** Parakeet CPU ~560 ms (ChatGPT) vs Moonshine
  <50 ms (Gemini). CPU Parakeet may be ~5× slower than our STT merge assumed → bench is critical path.
- ⚔️ **F1 — golden-medium disputed:** our bank says CPU-only clears sub-100 ms; both web models say
  you need Apple Silicon/WebGPU. F1 upgraded 🔴.
- ✅ **E (PHI) confirmed:** Deepgram ZDR / Azure containers / AWS Transcribe Medical stateless /
  OpenAI-via-Azure; + Comprehend Medical DetectPHI option.
- ✅ **G1 (incumbent gaps) confirmed:** push-to-talk/mode-switching, words bleeding into narrative,
  Rad AI = post-dictation not zero-click. Product thesis validated.
- ✅ **B1 (Rhino) confirmed unresolvable by desk research** — only marketing exists; bench-only.
- 🆕 **New ticket A9:** Voxtral-Mini-4B (browser WebGPU, 480 ms/4.9% ↔ 160 ms/6.46%) as no-install
  on-device STT. AssemblyAI U3 (~150 ms / 6.3%) corroborated by all three.
- ⚠️ **Credibility:** Gemini = polished but rosy numbers + a likely-fabricated citation
  (arXiv:2501.00123); ChatGPT = conservative/hedged but specific. Trust ChatGPT's latency floor,
  Gemini's as optimistic bound, the gap = bench's job. **Verify-or-discard** arXiv:2501.00123 and
  arXiv:2506.23325 before they enter the bank.

### I.2 — WEB-VERIFICATION desk-research rulings (2026-06-06)
Full analysis: [./WEB-VERIFICATION.md](./WEB-VERIFICATION.md). A 15-claim multi-agent verification +
adversarial credibility pass against primary sources. **Headline: most "disputes" were metric
conflations** — chunk latency vs response latency vs RTF-throughput vs algorithmic/endpoint delay.
- ✅ **A3-moonshine** — v2 Tiny/Small/Medium 33.6/123/245M; real-audio avg WER 12.0/7.84/6.65%;
  Gemini's "<50 ms chunk" is *mislabeled* (it's response latency, Apple-M3-only; 69 ms x86, 237 ms Pi5).
- ✅ **A3-sherpa** — streaming Zipformer CPU RTF 0.062–0.077 @2 threads, ~44–180 MB int8; RTF is
  throughput, not turn latency. Drop the unsupported "Cortex-A7 target" attribution.
- ✅ **A9-voxtral** — Voxtral-Mini-4B-Realtime-2602 (Apache 2.0); FLEURS-en 480 ms→4.90%, 160 ms→6.46%;
  real in-browser WebGPU build exists; "ms" = algorithmic transcription_delay, not wall-clock.
- ✅ **A9-assemblyai** — both numbers are Universal-3 Pro Streaming (150 ms = P50 *post-VAD*, 6.3% mean
  WER); base Universal-Streaming ~300 ms emission / 8.6%. "Corroborated by 3 models" is unsupported.
- ✅ **C1-smartturn** — ~12 ms is best-case single-inference on a high-end cloud CPU; 20–95 ms on
  weaker/ARM; ~70 ms integrated on Pipecat Cloud. Whisper-Tiny encoder + linear head, 8 MB int8.
- ✅ **B2-model2vec** — quality ~93% of MiniLM confirmed; "sub-1 ms" is *inferred from throughput*, not
  a published latency. Radiology recall still unknown → bench.
- ✅ **E1-deid** — Philter 99% recall is a single-tool recall-optimized **npj Digital Medicine 2020**
  number (NOT JAMIA); independent head-to-head: Philter ~0.79 / Presidio ~0.74. No 3-way, none radiology.
- ✅ **G1-incumbents** — 3/4 gaps confirmed OPEN; **accent gap downgraded** "collapse" → "unproven /
  likely-degraded" (strongest studies are 10–18 yrs old, pre-neural, and contradicted).
- 🔴→bench **A2/A3-parakeet** — Parakeet-**TDT-0.6B is offline**, no streaming first-token latency;
  80–160 ms is the *120M EOU* model (GPU/clean-TTS), 560 ms is a chunk-size *mode* not CPU compute.
- 🔴→bench **A4-deepgram** — params confirmed (`endpointing` default 10 ms; `utterance_end_ms` needs
  `interim_results`; `smart_format` 3 s stall / `no_delay`); latency has no SLA → bench.
- 🔴→bench **B1-rhino** — confirmed zero published latency; bench RTF on target hardware.
- 🔴→bench **F1/F2** — **reframed:** sub-100 ms is gated by chunk look-ahead + endpoint threshold
  (200–900 ms), NOT CPU-vs-Apple-Silicon compute. Decide endpointed-aggressive vs wake-word/grammar
  (non-endpointed) design. The central architectural risk; measure end-to-end decomposed by stage.
- 🗑️ **CITE-2501.00123 DISCARDED** — real ID, pure-math loop-theory content (hallucinated context).
- ⚠️ **CITE-2506.23325** — real (XY-Tokenizer speech codec); keep only if footnoting a codec/tokenizer
  claim, not a clinical metric.
- ⚠️ **B8-acibench** — paper is real (**Chen et al., not Schaaf et al.**; ASRU 2025) + ACI-Bench open,
  but the 90.4%/86.8% F1 are gated/unverified → cite as UNVERIFIED pending the IEEE Xplore PDF.
