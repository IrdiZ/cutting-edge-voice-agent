# 02 — Intent Decoder / Command-Routing Layer

**Stream:** Intent decoding for an always-on, continuous-listening voice-to-command system for
**dictation-heavy reporting** (cloud allowed under BAA). **Latency is priority #1** — common commands
must resolve well under 100 ms, ideally *before* the user stops talking.
**Date of research:** May 2026 (prioritizing 2024–2026 sources).

> **Bottom line up front:** The 3-layer hybrid (local grammar → local semantic embedding → LLM
> fallback) is **still the right blueprint in 2026**, but two things now beat the naive version:
> (1) **static embeddings (Model2Vec / potion)** collapse the "warm path" from ~300–500 ms to
> **sub-millisecond on CPU**, eliminating most of the reason to ever reach the LLM; and
> (2) **Picovoice Rhino** can do **speech-directly-to-intent on-device** for the closed command
> grammar, skipping the STT→NLU split entirely for the most common commands. The escalation
> cascade should be **speculative / parallel** with **calibrated** (not hand-tuned) thresholds.

---

## 1. The decision: is the 3-layer hybrid still SOTA?

Yes, with refinements. The pattern proven by **Aurelio `semantic-router`** — *"a superfast
decision-making layer… rather than waiting for slow LLM generations, it uses semantic vector space
to make those decisions"* — is the mainstream 2024–2026 approach, and it reports the canonical
latency win: **~5000 ms (LLM routing) → ~100 ms (vector routing)**, with community demos as low as
~10 ms using local models. The 2025–2026 research frontier did not replace this; it **sharpened the
escalation logic** (calibration-first cascade routing, e.g. UCCI, UDRIL — see §7) and **shrank the
semantic layer** (static embeddings — see §4).

What changed that matters for us:

1. **Static embeddings (Model2Vec/potion)** make layer 2 essentially free (sub-ms), so layer 2 can
   run *in parallel* with layer 1 rather than only on layer-1 miss.
2. **On-device speech-to-intent (Rhino)** can short-circuit the whole STT+NLU chain for the closed
   command set — potentially the lowest-latency path of all for fixed commands.
3. **Calibration-first thresholds** (isotonic / conformal) replace hand-tuned confidence cutoffs.

---

## 2. Layer 1 — Fast local matching (target: sub-10 ms, realistically sub-1 ms)

For radiology, most commands are a closed, finite set: *"next image"*, *"prior study"*, *"go to
findings"*, *"insert normal chest template"*, *"window level lung"*, *"sign report"*, *"add to
impression"*, navigation, and measurement commands. These belong in a hand-built grammar / regex
bank, which is by far the fastest and most predictable layer.

| Technique | Typical latency | Notes |
|---|---|---|
| Regex / keyword bank | **< 1–10 µs** per utterance for a few hundred patterns | Trivially fast; brittle to phrasing variation. Confidence = exact/anchored match = 1.0. |
| **Aho-Corasick** (multi-pattern, single pass) | **linear in text length**; BurntSushi `aho-corasick` crate; **daachorse** (double-array) is **3.0–5.2× faster** than it and uses 56–60% less memory on a 675K-pattern dict | Best when matching *many* trigger phrases/keywords at once. For small pattern sets, the crate auto-switches to a vectorized matcher that can be **~10× faster** than classic AC. |
| Trie / keyword spotting | sub-µs lookups | Good for command-prefix dispatch. |
| **Finite-state grammars / FSTs** (JSGF, SpeechRecognitionGrammarSpec, Kaldi grammar FSTs) | µs–low-ms to parse against compiled FST | Constrains *what can be said*; if the ASR itself is grammar-constrained, recognition + intent collapse into one. Less flexible than free dictation. |
| GBNF / JSGF hand grammar | µs | Encodes slots (anatomy, laterality, measurement) directly. |

**Confidence scoring for layer 1.** Use a deterministic score: exact anchored regex/FST match = 1.0;
partial/loose match (extra filler words, optional tokens) = 0.7–0.95 depending on coverage; no
match = 0. Combine with ASR token confidence if available. Only matches **≥ ~0.9** auto-execute;
below that, defer to layer 2's verdict (which is already computed in parallel — see §6).

**FST/grammar caveat (from llama.cpp GBNF docs, applies broadly):** avoid `x? x? x? …` repetition
expansion (catastrophically slow); use bounded repetition `x{0,N}`. Same discipline applies to any
hand-built grammar.

---

## 3. The dark-horse option: Picovoice Rhino (speech → intent, on-device)

Rhino is **not** an embedding model — it is an **end-to-end speech-to-intent engine: a single model
that maps spoken audio directly to a structured intent with typed slot values, with no intermediate
transcript and no STT→NLU pipeline.** For a *closed command grammar* (exactly our common-command
case) this is potentially the single lowest-latency path because it removes the STT step's latency
*and* the separate NLU step.

Key facts (Picovoice docs / GitHub, 2024–2025):

- **On-device, offline, zero network latency.** Runs on Cortex-M4/STM32/Arduino, Raspberry Pi
  (Zero/3/4/5), Android, iOS, **browsers (WebAssembly)**, and desktop.
- **Runtime + context files < 2.5 MB total**; **single-digit CPU utilization**; "consistent
  low-latency execution," processing audio **faster than real-time on a single core** (real-time
  factor < 1) even on microcontrollers via their `picoInference` engine.
- **Accuracy:** Picovoice's published benchmark is an *accuracy* (command-acceptance-rate) benchmark
  showing Rhino beating Google Dialogflow, IBM Watson, Amazon Lex, Microsoft LUIS by a wide margin
  in noisy conditions (~6× more accurate is their headline claim).

> **Caveat I could not resolve:** Picovoice publishes an *accuracy* benchmark for Rhino and a
> *latency* benchmark for their TTS, but **no standalone millisecond latency table for Rhino
> itself.** They frame latency as RTF < 1 + zero network. **Action item:** run their open-source
> file-demo / `speech-to-intent-benchmark` on our target hardware to get a hard ms number before
> committing. Also confirm: does Rhino's intent set / slot model cover radiology vocabulary richly
> enough, and does the on-device WASM build meet our browser deployment story?

**Why it may be a game-changer for us:** for the fixed command bank, Rhino could *be* layer 1 (and
even layer 0/ASR), giving intent on-device with no transcript round-trip. Free-form dictation
(report body) still goes through the full cloud ASR + the embedding/LLM cascade below. So a likely
architecture is **Rhino for commands, cloud ASR for dictation, embeddings+LLM for fuzzy commands.**

---

## 4. Layer 2 — Semantic intent matching, run LOCALLY (the big 2024–26 change)

Layer 2 catches paraphrases the grammar misses (*"flip to the next picture"* → `next_image`). The
old number was ~300–500 ms with a transformer encoder. **Static embeddings make this sub-millisecond.**

### 4a. Static embeddings — Model2Vec / potion (the recommended warm path)

Model2Vec distills any sentence transformer into a **static** model: one fixed vector per token,
sentence embedding = average of token vectors. **No attention, no matrix mult — just embedding-matrix
lookups + averaging.** Result (MinishLab, potion models released Oct 2024, trained via Tokenlearn):

- **Up to ~500× faster on CPU** than the original transformer; **up to 50× smaller**.
- Throughput on CPU is **tens of thousands of sentences/sec single-thread** ⇒ effectively
  **sub-millisecond per utterance**, no GPU/WebGPU needed.
- Smallest model **~8 MB** on disk (potion-base-8M is ~30 MB region for 32M variant); only major
  dependency is NumPy. **Official Rust impl** (`model2vec-rs`) supports **WASM** for browser/edge.

**Accuracy (MTEB average, from MinishLab results):**

| Model | MTEB avg | % of MiniLM | Relative speed/size |
|---|---|---|---|
| all-MiniLM-L6-v2 (transformer baseline) | **55.93** | 100% | ~100 MB, ~50 sent/s single-thread CPU |
| **potion-base-32M** (static) | **52.13** | **93.2%** | ~500× faster on CPU, tiny |
| **potion-base-8M** (static) | **51.08** | ~91% | ~8–30 MB, sub-ms |
| GloVe 300d | 45.82 | 82% | (older static) |
| BPEmb 50k 300d | 41.74 | 75% | (older static) |

**Takeaway:** potion-base-32M retains **~93%** of MiniLM quality at **~500× the speed** and runs in
pure NumPy / WASM. For a *closed* radiology command set (tens to low-hundreds of intents, not open
semantic search), this accuracy gap is negligible and the latency win is enormous.

### 4b. Transformer encoders (if higher recall needed) — transformers.js / ONNX Runtime Web

If we want maximum paraphrase recall, run a small transformer encoder client-side:

| Model / backend | Latency (batch=1) | Notes |
|---|---|---|
| all-MiniLM-L6-v2, **transformers.js WASM/CPU** (M2 Air) | **~8–12 ms** | Solid single-pass; INT8 quantized (22M params). |
| all-MiniLM-L6-v2, **ONNX Runtime Web WebGPU** | comparable or *no clear win* at batch=1 | GPU dispatch + shader-compile overhead dominates for such a small model; WebGPU only wins clearly at **large batch** (e.g. 104). For single live utterances, **WASM/CPU is the right backend.** |
| bge-small / gte-small / e5-small | similar order (tens of ms CPU) | Higher quality than MiniLM on retrieval; heavier than static. |

**Vector search at layer 2:** intent banks are tiny (tens–hundreds of reference utterances per
intent). Use **brute-force cosine / dot product** (microseconds) — no HNSW/ANN index needed below a
few thousand vectors. `semantic-router` itself defaults to simple kNN over the route utterances.

**Recommendation for our scale:** **potion-base-32M static embeddings + brute-force cosine** →
**well under 1 ms total** for layer 2 on CPU. This is the single most important finding for this stream.

---

## 5. Layer 3 — LLM fallback (fuzzy / compound / novel phrasing)

Only reached for genuinely ambiguous or compound commands (*"go to the prior chest CT and copy its
impression into this report"*). Use **structured/constrained output** so the LLM returns a JSON
intent + slots (never free text).

### 5a. Provider TTFT (the latency that matters for "first usable token")

| Provider / model | Median TTFT | Notes |
|---|---|---|
| **Groq** Llama 3.1 8B | **~50–120 ms (median ~80)** | LPU, on-chip SRAM; *most consistent / near-zero-variance TTFT* — explicitly recommended for voice/real-time. |
| **Groq** Llama 3.3 70B | ~120–250 ms (median ~180) | |
| **Cerebras** (Llama 3.1 70B) | **~574 ms to generate 100 tokens** | Wafer-scale SRAM; sometimes *lower TTFT than Groq* in independent tests; wins on throughput. |
| OpenAI **gpt-4o-mini** | ~200–500 ms (median ~320) | Vendor-blog estimate. Hosts GPT models (Groq/Cerebras do **not** run GPT-4o-mini — open weights only). |
| OpenAI **gpt-4o** | ~300–700 ms (median ~450) | |

> **Tail-latency warning:** independent testing (FriendliAI) found **>5% of Groq/Fireworks requests
> suffer very high TTFT** despite good medians. For an always-on clinical UI, design for p95/p99,
> not just median. Verify against **Artificial Analysis** (refreshed every 8 h) for live numbers.

**For us:** if layer 3 is ever on the hot path, prefer **Groq (consistent TTFT ~80 ms)** for the
fast first token. But the whole point of layers 1–2 is to make layer 3 rare; on rare paths a
~300–600 ms cloud LLM is acceptable, especially under a BAA.

### 5b. Constrained decoding / structured outputs (so the LLM emits a valid intent JSON)

All major frameworks (OpenAI Structured Outputs, **Outlines**, **XGrammar**, **llama.cpp GBNF**,
Guidance) share the same mechanism: after each token, mask invalid next tokens against a compiled
grammar (OpenAI/llama.cpp use CFGs, more expressive than FSM/regex).

- **Per-token overhead:** **< ~50 µs** (modern engines) up to **0.1–0.5 ms** simple / **2–5 ms**
  complex schemas — negligible vs the 10–50 ms/token model forward pass.
- **End-to-end:** **+5–15%** simple schema, **+30–60%** complex/deeply-nested. *Often net-negative*
  (faster overall) because the model emits no filler, stops at valid JSON, and needs no retries.
- **One-time grammar-compile cost** (OpenAI: penalty on first use of a new schema, then cached;
  XGrammar/llguidance cache compiled grammars). **Pre-warm the radiology intent schema at startup.**
- Mask computation can run in **parallel with the forward pass** → near-zero added wall-clock.

**Recommendation:** define one fixed intent-JSON schema (`{intent, slots:{anatomy, laterality,
measurement, target_section…}, confidence}`), compile once at startup, and keep it stable so the
provider/grammar stays cached.

---

## 6. Fuzzy / phonetic matching for PROPER NOUNS (names, anatomy, drugs)

Radiology has hard-to-spell anatomy ("oesophagogastric"), drug names, and **patient names** where
ASR will produce near-misses. This is a *slot-resolution* problem layered on top of intent matching.

| Algorithm | Cost / speed | Best for |
|---|---|---|
| **SymSpell** (Symmetric Delete, uses Damerau-Levenshtein) | **~100× faster than BK-trees**; author claims "1M× faster" fuzzy lookup vs naive | Spell-correct ASR misspellings against a fixed dictionary (anatomy, drugs) — the workhorse. |
| Levenshtein / **Damerau-Levenshtein** | O(n·m), slow on long strings | Short tokens; Damerau adds transposition (good for typos). |
| **Jaro-Winkler** (RapidFuzz bitparallel impl) | very fast; weights prefix matches | **Person/patient names** with transliteration variants. |
| **Double Metaphone / Soundex** | one-time encode then **O(1) equality compare** | Phonetic match — "sounds like" for names/drugs the ASR garbled phonetically. |
| **BK-trees** | slower than SymSpell | Fallback metric-tree fuzzy search. |

**Recommended slot resolver:** **SymSpell over a per-context dictionary** (current patient list,
anatomy lexicon, formulary) for typo correction, **+ Double Metaphone as a phonetic backstop**, and
**Jaro-Winkler** specifically for patient-name disambiguation. All run in **microseconds–low ms** —
add to layer 1/2, not the LLM. Combining edit-distance + phonetic is standard practice.

---

## 7. The escalation cascade — calibrated, speculative, parallel

The naive cascade runs layer 1, then 2 on miss, then 3 on miss (serial → latencies add). Because
layer 2 (static embeddings) is now sub-ms and slot fuzzy-match is µs, **run layers 1, 2, and slot
resolution in parallel on every utterance** and arbitrate. Only layer 3 (cloud LLM) is gated.

**Recommended design:**

1. **Speech in → (a) Rhino on-device speech-to-intent** for the closed command grammar *and*
   **(b) cloud streaming ASR** for free-form dictation, in parallel.
2. On each *partial/final* ASR hypothesis, **in parallel**: layer-1 grammar/regex/Aho-Corasick,
   layer-2 static-embedding cosine vs intent bank, and SymSpell/Metaphone slot resolution.
3. **Arbitrate by calibrated confidence:**
   - layer-1 anchored match ≥ ~0.9 **or** Rhino high-confidence intent ⇒ **execute now** (sub-ms,
     before user finishes speaking — fire on partial hypotheses for stable prefixes).
   - else if layer-2 cosine ≥ calibrated threshold ⇒ execute (still sub-few-ms).
   - else ⇒ **escalate to layer-3 LLM** (only the genuinely fuzzy ~minority).
4. **Speculative execution:** when layer-1/2 confidence is *medium*, optimistically prepare/preview
   the top intent while the LLM confirms; cancel if the LLM disagrees. Hides LLM TTFT.
5. **Calibrate thresholds, don't guess them.** 2025–2026 research is emphatic: *"any system that
   sets confidence thresholds by intuition will be miscalibrated."*
   - **UDRIL** (ACL 2025 Industry): cheap in-scope classifier + uncertainty score; only escalate
     uncertain/ambiguous/OOS utterances to a fine-tuned LLM. Deployed at scale (tens of thousands of
     interactions/day).
   - **UCCI** (May 2026): calibration-first router — maps token-margin uncertainty to per-query
     error probability via **isotonic regression**, picks escalation threshold by **constrained cost
     minimization**. Cut inference cost **31%** at micro-F1 0.91 while dropping ECE from **0.12 →
     0.03**; beat entropy-thresholding, conformal, and FrugalGPT-style learned thresholds.
   - Standard calibration toolbox: temperature / Platt / isotonic scaling, conformal prediction.
6. **Out-of-scope handling:** treat low-confidence-everywhere as OOS → no-op + subtle "didn't catch
   that," never a wrong destructive action (critical in clinical reporting).

### Latency budget per layer (recommended cascade)

| Layer | Path | Expected latency | Hit rate (target) |
|---|---|---|---|
| 0/1 | Rhino on-device speech→intent (commands) | RTF < 1, **near-zero network**, single-digit CPU | majority of commands |
| 1 | Regex/FST/Aho-Corasick on ASR text + deterministic confidence | **< 1–10 µs** (low ms worst case) | high |
| 1b | SymSpell + Double Metaphone + Jaro-Winkler slot resolution | **µs–low ms** | per-slot |
| 2 | **Static embedding (potion-32M) + brute-force cosine** | **< 1 ms** on CPU (no WebGPU needed) | paraphrases |
| 2-alt | transformers.js MiniLM (WASM/CPU) if higher recall wanted | **~8–12 ms** | — |
| 3 | LLM fallback w/ cached JSON grammar, Groq | **TTFT ~80 ms** (p50); watch p95 tail | rare |

**Net:** common commands resolve in **sub-1 ms to a few ms locally** (well under the 100 ms goal,
firing on partial hypotheses *before the user stops talking*); only rare fuzzy/compound commands
pay the ~80–600 ms LLM cost.

---

## 8. Other intent/NLU engines (context)

- **`semantic-router` (Aurelio)** — the reference implementation of layer 2; SemanticRouter (dense)
  + HybridRouter (dense+sparse); pluggable encoders (HF local, OpenAI, Cohere); kNN over route
  utterances; ~5000 ms→~100 ms claim. Good baseline to fork or benchmark against.
- **Snips NLU** — on-device intent+slot NLU (now largely archived but design still referenced).
- **Rasa** — heavier conversational NLU; more than we need for command routing.
- **Picovoice Rhino** — see §3; the on-device speech→intent dark horse.
- **Radiology incumbents:** Nuance **PowerScribe One** uses end-to-end ASR + NLU with "ambient mode"
  and structured-output mapping to ACR Common Data Elements; **Rad AI** (Dec 2025) launched
  next-gen context-aware speech recognition. These set the UX bar but publish **no command-latency
  numbers** — our edge is the explicit sub-ms local intent cascade.

---

## 9. Deeper research paths / open questions

1. **Run the actual Rhino latency benchmark** on our target hardware (browser WASM + server) — no
   published ms figure exists; this is the biggest unknown. Confirm radiology vocab/slot coverage.
   - Picovoice Rhino: https://github.com/Picovoice/rhino · benchmark: https://github.com/Picovoice/speech-to-intent-benchmark
2. **Static-embedding intent recall on radiology paraphrases.** Measure potion-base-32M vs MiniLM vs
   bge-small on a hand-labeled radiology command paraphrase set — is the ~7% MTEB gap visible on
   *our* closed intent set? (Likely not.) Test `model2vec-rs` WASM in-browser latency.
3. **Fire-on-partial-hypothesis policy.** How early can we execute on streaming ASR partials without
   misfires? Needs a stability heuristic + calibrated per-prefix confidence.
4. **Calibration method choice:** isotonic (UCCI) vs conformal vs temperature scaling for *our*
   confidence scores; target ECE < 0.05. Papers: UCCI https://arxiv.org/abs/2605.18796 ·
   UDRIL https://arxiv.org/abs/2507.01541 · "Is Escalation Worth It?" https://arxiv.org/html/2605.06350
5. **Speculative/parallel execution UX** for medium-confidence: preview-then-confirm vs wait; what's
   acceptable for *destructive* clinical actions (sign, delete)?
6. **Grammar vs ASR coupling:** should the cloud ASR itself be biased/constrained toward our command
   grammar (boosting/phrase hints) to lift layer-1 hit rate? (FST/grammar-constrained ASR.)
7. **Constrained-decoding engine** if self-hosting layer 3: XGrammar vs Outlines vs llama.cpp GBNF;
   pre-compile + cache the intent schema. Bench paper: https://arxiv.org/html/2501.10868v1
8. **daachorse vs aho-corasick** for a large trigger-phrase dictionary if the command bank grows
   large (3–5.2× speedup): https://github.com/daac-tools/daachorse

---

## Sources

- Picovoice Rhino Speech-to-Intent benchmark (accuracy): https://picovoice.ai/docs/benchmark/nlu-picovoice-rhino/
- Picovoice — End-to-End Intent Inference from Speech: https://picovoice.ai/blog/end-to-end-intent-inference-from-speech/
- Picovoice Rhino product page: https://picovoice.ai/products/voice/speech-to-intent/
- Picovoice Rhino GitHub: https://github.com/Picovoice/rhino
- Picovoice speech-to-intent benchmark repo: https://github.com/Picovoice/speech-to-intent-benchmark
- Picovoice picoInference (on-device engine): https://picovoice.ai/technologies/on-device-inference/
- Picovoice 2025 Year in Review: https://picovoice.ai/blog/year-in-review/
- Model2Vec GitHub: https://github.com/MinishLab/model2vec
- Model2Vec results README: https://github.com/MinishLab/model2vec/blob/main/results/README.md
- Model2Vec Rust impl (WASM): https://github.com/MinishLab/model2vec-rs
- Model2Vec docs (Minish): https://minish.ai/packages/model2vec/introduction/
- semantic-router (Aurelio) GitHub: https://github.com/aurelio-labs/semantic-router
- semantic-router architecture docs: https://docs.aurelio.ai/semantic-router/user-guide/concepts/architecture
- semantic-router product page: https://www.aurelio.ai/semantic-router
- "When to Reason: Semantic Router for vLLM" (2025): https://arxiv.org/html/2510.08731v1
- transformers.js WebGPU vs WASM benchmark (SitePoint): https://www.sitepoint.com/webgpu-vs-webasm-transformers-js/
- ONNX Runtime WebGPU performance (Wei Lu): https://medium.com/@GenerationAI/performance-of-onnxruntime-webgpu-44a25d9897a9
- Xenova/all-MiniLM-L6-v2 (transformers.js): https://huggingface.co/Xenova/all-MiniLM-L6-v2
- Groq optimizing latency docs: https://console.groq.com/docs/production-readiness/optimizing-latency
- Groq vs Cerebras (DeployBase): https://deploybase.ai/articles/groq-vs-cerebras-pricing-speed-and-benchmark-comparison
- FriendliAI provider TTFT comparison (Llama 3.1 70B): https://friendli.ai/blog/comparative-analysis-ai-api-provider
- AI model latency benchmarks 2026 (TTFT/throughput): https://www.digitalapplied.com/blog/ai-model-latency-benchmarks-2026-ttft-throughput
- Groq vs OpenAI latency comparison: https://neuraplus-ai.github.io/blog/groq-vs-openai-latency-comparison.html
- OpenAI Structured Outputs: https://openai.com/index/introducing-structured-outputs-in-the-api/
- Guide to constrained decoding (Aidan Cooper): https://www.aidancooper.co.uk/constrained-decoding/
- llama.cpp GBNF grammars README: https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md
- Structured outputs benchmark paper (Jan 2025): https://arxiv.org/html/2501.10868v1
- "Lost in Space: Optimizing Tokens for Grammar-Constrained Decoding" (2025): https://arxiv.org/html/2502.14969v1
- SymSpell vs BK-tree (Wolf Garbe): https://medium.com/data-science/symspell-vs-bk-tree-100x-faster-fuzzy-string-search-spell-checking-c4f10d80a078
- Fuzzy matching algorithms explained: https://match-data.studio/blog/fuzzy-matching-algorithms-explained/
- RapidFuzz JaroWinkler (bitparallel): https://github.com/rapidfuzz/JaroWinkler
- Jaro-Winkler vs Levenshtein (Flagright): https://www.flagright.com/post/jaro-winkler-vs-levenshtein-choosing-the-right-algorithm-for-aml-screening
- daachorse (double-array Aho-Corasick): https://github.com/daac-tools/daachorse
- "Engineering faster double-array Aho-Corasick automata" (SPE 2023): https://arxiv.org/abs/2207.13870
- BurntSushi aho-corasick benchmark discussion: https://github.com/BurntSushi/aho-corasick/discussions/115
- UDRIL — OOS detection via uncertainty-driven LLM routing (ACL 2025): https://arxiv.org/abs/2507.01541
- UCCI — calibrated uncertainty for cost-optimal cascade routing (2026): https://arxiv.org/abs/2605.18796
- "Is Escalation Worth It? Decision-Theoretic LLM Cascades" (2026): https://arxiv.org/html/2605.06350
- Dynamic model routing & cascading survey (2026): https://arxiv.org/html/2603.04445v2
- Confidence calibration in LLMs (overview): https://www.emergentmind.com/topics/confidence-calibration-in-llms
- AI-powered voice recognition in radiology: https://www.diagnosticimaging.com/view/a-closer-look-at-ai-powered-voice-recognition-in-radiology
- Dictation-heavy reporting with AI voice dictation (PowerScribe One): https://radiologyainews.substack.com/p/your-guide-to-the-latest-in-radiology
- Rad AI next-gen speech recognition (Dec 2025): https://www.radai.com/news/rad-ai-unveils-next-generation-speech-recognition-that-redefines-radiology-reporting
