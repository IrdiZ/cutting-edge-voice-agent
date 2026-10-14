# Merge analysis — Literature search "Partial hypothesis stability and commit policies" × our bank

Source: a literature-search report (not included in this repo)
— 75 papers, **100% estimated coverage**, May 2026. Citations are by **catalog # + title** from
*this* file's detail entries (its numbering differs from the primary-search catalog — e.g. here
#57 = FastEmit, #1 = Baumann).

Bottom line: this haul **resolves the mechanism question for ticket A6** and **empirically
validates our cost-tiered + clarification design**. It turns "we know partials flicker" into a
concrete, citable commit policy. The single most important paper for us is **#20 (Loth et al.,
PLoS ONE 2018)** — it shows the cost-asymmetry behavior we designed by intuition is what humans
actually do.

---

## 1. The commit-policy toolkit (what A6 needed)

| Mechanism | Papers (#) | What it gives us |
|-----------|-----------|------------------|
| **Operating-point baseline** | #1 Baumann 2009 | The canonical frontier: spurious edits **90%→10% at ~320 ms lag**. Our worst-case fixed-lag fallback |
| **Longest-stable-prefix + per-word stability** | #4 McGraw & Gruenstein 2012 | Estimate a per-word stability statistic, threshold it, vary lag to commit only the stable prefix. Core of an *adaptive* gate |
| **Local agreement / majority-vote commit** | #6 Whisper-Streaming, #7 EffWhiS, #9 Nguyen | Commit a word once it's stable across N passes. EffWhiS: **commit if in ≥2 of last 3 passes** + segment-consistency, robust at 0.5 s chunks. No retraining — works on top of any STT partials. #9: stable-prefix ID cut word latency **18.1 s → 1.1 s** |
| **Bounded revision window (can ELIMINATE flicker)** | #19 Revision-Controllable Decoding (MS), #37 hold-n blockwise | An "allowed revision window" in beam pruning screens out candidates likely to cause big revisions — **can completely eliminate** flickering. The knob for destructive commands |
| **Uncertainty-thresholded emission (no fixed delay)** | #8 ESTRA (evidential DL, 2026) | Emit when uncertainty drops below threshold; avoids fixed window-size delays, cuts p50 latency. Principled "confidence-based commitment" |
| **Partial reranking / rewriting (flicker-only fix)** | #2 Flickering Reduction, #50 Partial Rewriting | Halve flicker / +10% partial quality with **no latency cost and no retraining**, without touching the final result — clean up the *displayed* dictation without delaying command commits |
| **Learned dynamic lookahead** | #30 Teaching BERT to Wait, #40 adaptive policies | Model learns whether to emit now or wait for more context → lower flicker than fixed policies |
| **Early-exit for bounded commands** | #25 Temporal Early Exiting | Short-circuit a streaming command classifier when confident: **45% time savings**, and savings scale with how distinctive the command's prefix is |

## 2. The cost-asymmetry + clarification design — now empirically grounded

This is the part our plan asserted on intuition; the literature backs it:

- **#20 Loth et al., "Confidence in uncertainty: Error cost and commitment in early speech
  hypotheses" (PLoS ONE 2018).** Humans act on *suggestive* (uncertain) hypotheses when **error
  cost is low**, but **wait for more confident hypotheses when error cost is high**; under time
  pressure with little evidence they **ground with echo questions** ("did you mean…?"). This is
  *exactly* our design: cost-tiered commit thresholds per command type + a clarification prompt
  for low-confidence/high-cost. → academic backbone for **A6 + A1 + the clarification FSM**.
- **#21/#22 DeVault et al.** — detect the "point of maximal understanding" of an ongoing utterance
  with high precision, then commit. **#24 iDST** — token-by-token commit labeling. **#29
  Madureira** — a formal revision-policy evaluation methodology for incremental labeling.
- **#23 Constantin et al.** — if an action decomposes into subactions, **start the reversible
  subactions mid-utterance** (+47.9 F1). Backs our async/optimistic-preview execution for
  low-cost commands.

## 3. Recommended A6 commit policy (synthesis → fold into the design)

A **layered, cost-tiered commit gate** on the command lane, all no-retraining (works on cloud or
on-device STT partials):

1. **Default gate = local agreement (majority-vote), N=2–3** (EffWhiS #7 / Whisper-Streaming #6).
   A command fires only once its trigger span is stable across N consecutive partials.
2. **Make the lag adaptive**, not a flat 320 ms: drive N / the commit threshold by a per-word
   **stability score** (#4) or **uncertainty** (ESTRA #8), so distinctive commands commit sooner.
3. **Cost tiers** (Loth #20):
   - *Low cost* (navigation, "next", scroll): commit on suggestive evidence / N=1–2; allow
     optimistic preview + mid-utterance subactions (#23).
   - *High cost / destructive* ("sign", "delete", "finalize"): **revision window = 0** (#19) — wait
     for a guaranteed-stable prefix — **or** drop to a **clarification prompt** ("sign and next?")
     when confidence is low under time pressure (the human strategy in #20).
4. **Clean the displayed dictation** with partial reranking/rewriting (#2, #50) so flicker never
   reaches the report text, independent of when commands commit.
5. **Early-exit** the bounded command classifier when confident (#25) for extra latency on the
   common path.

## 4. Bench metrics this haul hands us (for Phase 0)

Our commit policy needs the right yardsticks — these are off-the-shelf:
- **Revokes-per-second** (#13 Whetten) — clean, intuitive instability metric.
- **Word/segment-level stability & instability** (#3 Shangguan, #4 McGraw).
- **Normalized flicker** + combined quality/latency/stability scoring (#31 SLTev, #32).
- **Revision-policy evaluation methodology** (#29 Madureira) for the labeling layer.
- **Edit-distance-with-shifts** (SubER #45) if we score transcript-subtraction accuracy.

## 5. Honest limits (per Literature search's own summary)

- **Explicit commit policies for high-cost actions are scarce.** The cost-asymmetry framing rests
  largely on *one* psychology paper (#20) + dialogue work, not deployed ASR systems. So we're
  extrapolating a human-behavior result into an engineering policy — reasonable, but unproven at
  scale for our setting.
- **Most adjacent work measures BLEU / Average-Lagging / flicker, not action-commit latency or
  mis-fire cost.** The simultaneous-translation literature (#15–#48) is metric-rich on *prefix
  stability* but its latency is BLEU-shaped — it informs **policy shape**, not our ms budget.
- **Net:** the literature gives us the mechanism (local agreement + revision window + uncertainty)
  and the human-validated policy shape (cost tiers + clarification). It does **not** give us the
  mis-fire-cost numbers for a bounded radiology registry — **that remains the Phase-0 bench's job
  and our genuine whitespace** (consistent with the primary-search merge).

## 6. Papers to read in full (ranked for the commit policy)

1. **#20 Loth et al.** — cost/commitment psychology; the design backbone.
2. **#7 EffWhiS** + **#6 Whisper-Streaming** — the majority-vote / local-agreement commit recipe.
3. **#19 Revision-Controllable Decoding** — bounded revision window for destructive commands.
4. **#4 McGraw & Gruenstein** + **#8 ESTRA** — adaptive (stability/uncertainty) commit gates.
5. **#2 Flickering Reduction** + **#50 Partial Rewriting** — dictation-display cleanup.
6. **#25 Temporal Early Exiting** + **#23 Constantin** — bounded-command early commit + subactions.
7. **#1 Baumann** + **#29 Madureira** + **#13 Whetten** — the metrics for our bench.
