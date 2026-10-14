# Merge analysis — Literature search "Command spans without wake word" × our bank

Source: a literature-search report (not included in this repo) — **40 papers,
96% coverage** (notably thinner than the 66/75-paper prior runs — *as predicted*). Citations by
catalog # + title from this file.

Bottom line: **the result confirms the gap rather than closing it** — Literature search's own summary:
*"direct evidence for hotword-free command-span segmentation inside ongoing speech is still
sparse."* But it hands us (a) the **closest prior art, and it's medical + current**, (b) a proven
**feature-fusion recipe** for the separator, (c) a 2026 **architectural reframe** (sequential
routing over interaction history), and (d) the **false-accept-first operating points** we asked
for. Net: the command-vs-dictation separator is a **build-and-bench** problem, but we now have a
clear recipe and a baseline to beat.

---

## 1. Closest prior art — medical, interleaved, current (read these first)

- **#4 LLM-Based Dictation Detection from Doctor-Patient Conversations (Schaaf group, ASRU 2025).**
  The single most transferable paper to our separator. Fine-tuned **Qwen2-1.5B → 90.4%
  utterance-level / 86.8% word-level macro F1** detecting dictation *interleaved within*
  conversation; **beats Claude 3.5 Sonnet** few-shot; introduces a **word-alignment method to
  mitigate ASR errors + LLM hallucinations**; releases outputs on **ACI-Bench** (first open
  resource). Two direct reuses: a small on-device fine-tuned LLM as the *slow-lane* separator, and
  the word-alignment trick for our **transcript-subtraction accuracy**.
- **#2 "Are You Dictating to Me?" (Schaaf, ASRU 2021).** Predecessor. Finding that backs our whole
  ranking: **LM-derived lexical features are most useful**, acoustic-only ≈ a rule-based lexical
  baseline, and **acoustic+lexical combined is best**. Empirically validates "lexical primary,
  prosodic secondary" *in the medical domain*.
- **#1 TERTiUS / Toward Interactive Dictation** (already in our bank) — the reality check: open-
  ended command parsing is 30% acc @1.3 s / 55% @7 s. Reconfirms: **lean on the bounded registry**,
  not open-vocab parsing.

## 2. The separator recipe (proven, transferable from device-directed detection)

The dominant literature is device-directed / false-trigger detection (our "secondary band"), but
its **feature recipe transfers directly**:

| Finding | Papers (#) | Number |
|---------|-----------|--------|
| Fuse **acoustic + ASR 1-best + decoder features** | #6 Mallidi 2018 | EER **5.2%** (44% rel. gain); decoder-only 9.3%, acoustic 10.9%, 1-best 20.1% — **lexical/decoder > acoustic**, fusion best |
| Add **semantic lexical** features to acoustic | #23 Gillespie 2020 | **−14% EER** over acoustic-only |
| Fuse into an **LLM** (acoustic+lexical+decoder) | #15 / #19 Wagner 2024/23 | **−39–61% EER**; data/resource-efficient (LoRA+prefix-tune, single frozen on-device LLM, ≤80k examples) |
| Exploit **ASR uncertainty** + prior-turn context | #11 Rudovic 2024 (LLM) | **−20–40% false alarms** at fixed 10% reject |
| Per-context output branch | #27 Huang 2019 | **+12.5% EER** from a separate branch per dialog type |

→ **Recommended separator:** a streaming classifier fusing **partial-ASR lexical/semantic features
(primary)** + **lightweight acoustic/prosodic (for earliest rejection before lexical stabilizes)**
+ **app-mode / interaction-history context (strong prior)**. Reserve a small on-device fine-tuned
LLM (Qwen2-1.5B style, #4) for the hard open-ended cases as a slow lane.

## 3. Architectural reframe from the 2026 SOTA (genuinely new)

- **#30 Selective Attention System / SAS (2026).** Frames device-addressed detection as
  **Sequential Device-Addressed Routing (SDAR)** — a *sequential routing problem over interaction
  history*, **not** utterance-local classification. Audio-only **F1 0.86**, +video 0.95; crucially,
  **removing causal interaction history collapsed F1 from 0.95 → 0.57** — history was the single
  largest signal. Runs on-device ARM Cortex-A, **<150 ms, <20 MB**.
  → **Design takeaway:** model command-vs-dictation as **routing conditioned on recent
  interaction/app-mode context**, not per-utterance. This directly reinforces our **scope-gated
  registry** (app mode as context) and says context history deserves first-class weight in the
  separator. Fold into ARCHITECTURE + COMMAND-REGISTRY scope.

## 4. False-accept-first operating points (the metric we asked Literature search to weight)

Because mis-firing on dictation is costlier than missing a command, these reject-side numbers are
the relevant yardsticks for the bench:
- **#38 Reich 2011 (Smart Control Room, always-on, 259-word/10k-command vocab):** 88.3% command
  detection at **1.5% FPR** — the oldest *direct* "command vs not in always-on speech," prosodic +
  decoding + linguistic features. The low FPR is the point.
- **#12 Audio-to-Intent (Dighe 2022):** mitigate **93.3% unintended audio at 99% TPR**, directly
  from acoustic+subword-text *without full ASR* — good pre-gate to reject non-system room speech.
- **#9 Knowledge-Transfer FTM (2020):** reject a false trigger after **1.69 s at 99% TPR**,
  acoustic-only, on-device.
- **#3 Streaming Intended Query Detection:** **8.7% EER @ 1.4 s** median, early decision from
  partials, +600 ms vs separate detector.

## 5. Early-action / mid-utterance execution (transferable to our commit + async lanes)

- **#26 Online Semantic Parsing (Zhou & Eisner, ACL 2022).** Predict & **execute function calls
  while the user is still speaking**, with a thresholding heuristic for early subprogram selection
  → **30–65% latency reduction**. Direct support for our async/optimistic execution and bounded
  early-commit. (Same lineage as TERTiUS — Eisner/Thomson.)
- **#22/#24 Incremental Online SLU (Shivakumar):** lexical EOS detector segments a continuous
  word stream into sentences for intent; analyses early intent **before EOS**.
- **#16 Semantic VAD:** punctuation-prediction VAD, **−53.3% latency** — boundary detection from
  semantics, not just silence.

## 6. Overlap with other lanes (route there)
- Turn/EOU: #32 Turn-Taking, #35 Predictive EOU, **#36 FastTurn (2026** — streaming CTC + acoustic,
  full-duplex, robust to overlap/noise), #34 barge-in classification → feed the **R2-3 (full-duplex)
  merge** and ticket **C1**.
- Stability: #21 Flickering Reduction, #25/#33 word-stability → already covered by the A6 merge.

## 7. Honest limits
- **No paper measures command-span segmentation embedded in *dictation* (vs conversation) at our
  ms budget for a bounded registry.** Device-directed work assumes **short standalone commands**,
  not commands buried in long dictation — judge it by transferability, not drop-in.
- So the separator stays our **build-and-bench problem** — but de-risked: a clear feature recipe
  (§2), a routing reframe (§3), a medical baseline + open dataset to beat (#4/ACI-Bench), and
  reject-side operating points (§4).

## 8. Papers to read in full (ranked for the separator)
1. **#4 LLM-Based Dictation Detection (2025)** — closest prior art; baseline + ACI-Bench dataset.
2. **#2 Are You Dictating to Me? (2021)** — lexical>acoustic, fusion best, in medical dictation.
3. **#30 SAS / SDAR (2026)** — the interaction-history routing reframe.
4. **#6 Mallidi 2018** + **#15 Wagner 2024** — the acoustic+1-best+decoder→(LLM) fusion recipe.
5. **#26 Online Semantic Parsing (2022)** — execute-while-speaking early-action policy.
6. **#12 Dighe 2022** + **#38 Reich 2011** — false-accept-first pre-gate operating points.
