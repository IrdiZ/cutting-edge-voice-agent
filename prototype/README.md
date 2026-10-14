# Voice Cockpit — prototype (M1 + M2 + M3a/M3b + B8)

A browser cockpit that proves the **fire-on-partial reactive loop**: live mic →
streaming partial transcripts → L1 command match (cost-tiered commit) → mock
cockpit reacts, with a stage-boundary **latency HUD**. The STT engine sits behind
a pluggable `SttAdapter` so the cloud and on-device engines swap without touching
the pipeline, cockpit, or HUD.

## Run

```sh
npm install
npm run setup        # one time: fetches the git-ignored model files (about 175 MB download)
npm run dev          # → http://localhost:5173
npm run check        # typecheck + separator evaluation + unit tests
```

`npm run setup` copies the Silero VAD model out of `node_modules` and downloads the
sherpa-onnx WebAssembly bundle (release v1.13.2, `.wasm` and `.data`) into `public/`. It needs
`sh` and `curl`. On Windows, run it from Git Bash or WSL.

Open in **Chrome** (WebGPU). Pick the STT engine in the top-right selector:

- **Web Speech (cloud)** — zero-install, validates the loop. ⚠ cloud-backed
  (Chrome→Google); good for the *loop*, not the latency target.
- **On-device · WebGPU** — Whisper-tiny via transformers.js; **audio never leaves
  the machine**. First mic start downloads + compiles the model (~10 s, one-time).

No mic? Use the **Simulate** buttons — they drive the same pipeline with synthetic
on-device timing.

## Status notes (2026-06-26): contextual biasing and separator fixes

State after a live mic-testing session on an Apple M5 Pro. The gate (`npm run check`) is green:
**37 unit tests, FAR 0% (case_open + dictating), 0 destructive false-fires, recall 82.4%**.
Those invariants must stay green on any future edit.

### Point A: sherpa contextual biasing (hotwords) is now wired

The prebuilt WASM `.data` ships only encoder/decoder/joiner/`tokens.txt` (no `bpe.vocab`), so
text-hotwords were off. Now enabled WITHOUT repacking `.data`:

- `src/adapters/sherpa.ts` `tryLoadBpeVocab()` fetches `public/sherpa/bpe.vocab` and a generated
  `hotwords.txt` (the 8 worklist names) and injects them into the Emscripten virtual FS via
  `Module.FS_createDataFile` before `createOnlineRecognizer`. Config: `modelingUnit=bpe`,
  `bpeVocab=./bpe.vocab`, `decodingMethod=modified_beam_search`, `hotwordsFile=./hotwords.txt`,
  `hotwordsScore=4`, `maxActivePaths=8`. Everything falls back to the default greedy recognizer
  if `bpe.vocab` is missing or the config throws (so the app never breaks).
- The packed model is **`sherpa-onnx-streaming-zipformer-en-2023-06-26`** (verified by grepping
  distinctive BPE pieces out of `.data`; vocab_size=500). To regenerate `bpe.vocab`:
  ```sh
  curl -L -O https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26/resolve/main/bpe.model
  curl -L -O https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/scripts/export_bpe_vocab.py
  uv run --python 3.12 --with sentencepiece python export_bpe_vocab.py --bpe-model bpe.model
  cp bpe.vocab public/sherpa/bpe.vocab   # ~12 KB, format: "piece<TAB>score"
  ```
- **Observed result:** 7/8 names transcribe cleanly; true homophones do NOT (Bauer is literally
  spoken "bower", Chen comes out "cha") and a 500-token streaming model can't fix that. Correct
  navigation is delivered by the resolver below, not the transcript.

> SCOPE NOTE: name-based case-jumping is a TEST SCAFFOLD for accuracy, not a product requirement.
> Do NOT over-optimize name recognition / transcript accuracy. The real next levers are the recall
> sprint and Smart Turn (point C below).

### Closed-set name + number resolver (`src/slots.ts`)

- **Homophones** recovered phonetically: `nameSkeleton()` drops vowels AND `w` as a semivowel, so
  "bower" == "bauer" (both reduce to "br"). The distance cap stays tight at **0.40** on purpose:
  loosening it to admit "bower" also admitted non-homophones at the same distance ("hotel"->Patel,
  "bossy"->Rossi), so phonetics (not a looser cap) is the right lever.
- **Short names** ("Chen") recovered by ABSOLUTE edit distance (<=2) when both strings are short
  AND share a first letter: "cha"/"chan" -> Chen, but "the" (also 2 edits from "chen") is rejected.
- **Fuzzy ordinals** in `numFromWord()`: phonetic-skeleton match so "forth"->fourth, "thrid"->third
  resolve for `goto_nth` ("open the fourth case"). Skeleton-only (no edit-1) to avoid "then"->ten.
- False-positive guard verified: "report"/"window"/"power"/"tower"/"smith"/plain prose -> no match.

### Pipeline / dictation fixes (`src/pipeline.ts`, `src/cockpit.ts`)

- **begin-findings leak:** "begin findings, we have a mass" in one breath used to dump the command
  words into the report. The pipeline now records where dictation starts (`dictStartRaw`, after the
  trigger word) and strips the command prefix off the arming breath.
- **State-change re-anchor:** a command that EXITS dictation (stop_dictation / generate_impression)
  no longer locks the utterance. The rest of the same breath is re-evaluated in the new scope, so
  "stop dictation, generate" fires BOTH. Safe because the scope gate makes the just-fired command
  unreachable and the consumed-words cursor stops the tail re-firing.
- **"STO" artifact:** the spoken "stop" can leak in as a prematurely-finalized fragment before
  stop_dictation fires. `cockpit.stripTrailingStop()` removes a trailing stop-homophone token from
  the report on stop, while keeping real dictation.

### Diagnostics

`src/adapters/sherpa.ts` logs `[sherpa] ...` lines: `bpe.vocab mounted`, `hotwords.txt mounted`,
`✅ hotwords ENABLED` / `⚪ default greedy`, and `◆ final: "..."` per utterance. sherpa's own
`debug` is off (set `modelConfig.debug=1` in `hotwordConfig()` to dump its config again).

### Next milestones (bigger impact than anything left on names)

- **Recall sprint:** 0.824 -> 0.95 at FAR=0 (goal: 0 false triggers on dictation).
- **Point C, Smart Turn end-of-utterance detection** (the fix for trailing-command latency): a
  browser path may exist via `onnx-community/smart-turn-v3-ONNX` (int8, about 8 MB) on onnxruntime-web.
  Open question: the model input is either raw PCM `[1,128000]` or log-mel `input_features [1,1000,80]`.
  Check the Hugging Face repo before wiring it in.

Manual test script: see `MANUAL-TEST-PLAN.md`.

## Architecture (where each piece lives)

```
mic.ts ─frames→ adapters/ondevice.ts ─partials→ pipeline.ts ─events→ cockpit.ts + hud.ts
                adapters/webspeech.ts ↗          (decoder.ts = L1 match, trace.ts = timing)
```

- `adapters/types.ts` — the stable `SttAdapter` seam (M2's whole point).
- `pipeline.ts` — cost-tiered commit: navigation/dictation-control fire on a
  partial; **destructive (`sign_and_next`) never fires from the stream** — it
  requires an explicit confirm (button or spoken "confirm"). The medico-legal guard.
- `decoder.ts` — L1 subsequence matcher with **tier priority** so "sign and next"
  resolves to the destructive `sign_and_next`, not the navigation `next_case`.

## Observed on-device numbers (Apple M5 Pro, Chrome, WebGPU, 2026-06)

> One-off **observed** figures from a single manual run on one machine — not a committed
> reproducible benchmark (no fixed artifact/seed). Treat as ballpark, not a claim.

Whisper-tiny.en via transformers.js, fp32, WebGPU — observed end-to-end:

| Metric | Value | Note |
|---|---|---|
| model load + WebGPU compile | ~9.3 s | one-time, on first mic start |
| inference — cold | ~1.39 s | first pass (11 s JFK clip) |
| inference — warm | ~0.44 s | **RTF ≈ 0.04** (~25× real-time) |

**Takeaway (confirms `docs/research/WEB-VERIFICATION.md` F1/F2):** STT *compute* is not
the bottleneck on Apple Silicon. For the short command utterances we fire on, the
per-pass cost is a small fraction of the warm number — the dominant term is the
**endpoint wait**, not the model.

## M3a — Silero VAD (done)

The crude RMS energy gate is replaced by **Silero VAD v5** (`@ricky0123/vad-web`)
for clean speech onset/offset + pre-roll (`src/audio/vad.ts`). The on-device
adapter now: VAD `onSpeechStart` → begin utterance; accumulate frames → partial
every ~384 ms; VAD `onSpeechEnd` → final pass on the padded segment. `Partial`
gained optional `tokens`/`timestamps` (filled by the M3b streaming engine).

Verified end-to-end on the M5 Pro (Chrome) by feeding a real speech clip through a
synthetic stream: Silero detected speech → segmented → Whisper transcribed on
WebGPU → text reached the HUD, no console errors.

**Asset wiring (important):** Silero model + VAD worklet are vendored under
`public/vad/`; ort-wasm is served from `node_modules` (NOT `public/`, because
onnxruntime `import()`s its `.mjs` loader and Vite forbids importing from
`public/`). Paths set in `src/audio/vad.ts`.

## M3b — true streaming (sherpa-onnx Zipformer WASM) ✓

`src/adapters/sherpa.ts` — adapter **"On-device · Streaming (sherpa)"**. The online
Zipformer transducer compiled to WASM: `acceptWaveform()` + a `decode()` loop that
**never re-feeds the buffer**, emitting stable word-by-word partials + a real
`isEndpoint`. **Fixes the Whisper "you" hallucination** on short commands.

- **No emscripten build needed** — uses the k2-fsa **pre-built** bundle vendored
  under `public/sherpa/` (`sherpa-onnx-asr.js`, `sherpa-onnx-wasm-main-asr.{js,wasm,data}`).
  Fetch the large files with `npm run setup`. It downloads the
  `sherpa-onnx-wasm-simd-v1.13.2-en-asr-zipformer.tar.bz2` asset from
  https://github.com/k2-fsa/sherpa-onnx/releases (the `.data` file is about 182 MiB and is git-ignored).
- **Needs cross-origin isolation** — the WASM uses pthreads/SharedArrayBuffer, so
  `vite.config.ts` sets `COOP: same-origin` + `COEP: credentialless` (credentialless
  so the Whisper HF-CDN fetch still works). If sherpa fails to init, hard-reload so
  the headers re-evaluate (`self.crossOriginIsolated` must be `true`).
- Verified end-to-end on the M5 Pro by feeding a real speech clip via a synthetic
  stream: streamed the full JFK quote, no hallucination, no errors (the sherpa
  console dump is `debug=True` info, not errors).

**Latency note:** the HUD numbers for the sherpa path are *segment-relative* (t0 =
first recognized word), so they show decode/claim latency, not true mouth-to-command
— that needs the `bench/` hardware-timing rig.

## B8 — command-vs-dictation separator (SGFM-Sep) ✓

`src/separator/` replaces the old naive mode-gate. Design + tournament + labeled
corpus came from the design work in [`../docs/research/B8-SEPARATOR-DESIGN.md`](../docs/research/B8-SEPARATOR-DESIGN.md).

- **ScopeFsm reachability hard gate** (`scopeFsm.ts`): each command is reachable
  only in certain app scopes. `sign_and_next` is reachable in `case_open`/`signing`
  but **never while dictating** — so a stray "sign"/"signed"/"next" in findings prose
  is unfireable *by construction* (auditable by reading the table, no threshold).
- **Coverage-calibrated confidence** (`decoder.ts`): `cRaw = quality × brevity ×
  position` + a filler normalizer — buries a command word embedded in long prose.
- **Narration-decoupled confirm** (`pipeline.ts`): the old `CONFIRM_RE` that scanned
  free narration for "yes" is deleted; a pending destructive resolves only via the
  button or an isolated "confirm"/"confirm sign".

**Measured on the 128-utterance labeled corpus** (`eval/separator-corpus.json`,
`node eval/run-eval.ts`):

| metric | baseline (naive) | SGFM-Sep |
|---|---|---|
| false-accept rate on dictation (over the 53 dictation items) | 34.0% (18/53) | **0.0% (0/53)** |
| destructive false-fire on dictation | 11 | **0** |
| command recall (over 34 supported-intent commands, each at a reachable scope) | — | **82.4% (28/34)** |

Verified live in-browser: dictating *"the patient signed consent … sign off … next
study"* routes entirely to Findings with no fire; `sign & next` from `case_open` still
raises the confirm gate. (Recall misses are dominated by deliberately-corrupted STT
mishears + a couple of out-of-vocab phrasings, not separator errors.)

`run-eval.ts` is a real **gate** (`npm run check` = typecheck + eval + 28 `node:test`
units): it `exit(1)`s on any FAR>0, destructive false-fire, or recall < 0.80, so a
regression fails CI, not just prints.

### Streaming-partial eval (`npm run streaming`) — measures what the mission fires at

`run-eval.ts` scores **whole utterances**; the cockpit fires on **partials**, so the honest
question is "does any *prefix* fire?". `eval/streaming-eval.ts` replays every utterance as
cumulative word-partials under a LocalAgreement-N commit gate:

| | FAR @dictating | FAR @case_open | recall | 
|---|---|---|---|
| N=1 (today: fire-on-first-confident) | **1.9%** (1 adversarial near-miss) | 17.0% | 82.4% |
| N=2 | 1.9% | 17.0% | 76.5% |
| N=3 | 1.9% | 13.2% | 47.1% |

**Decisive finding:** the designed "Stage 2" local-agreement N≥2 commit gate is the **wrong
lever** — raising N barely moves FAR (the prose-prefix mis-fires are *stable* across partials,
e.g. `"the patient signed…"` holds `sign_and_next`) while it **craters recall** (real commands
fire on their last word). So it stays unimplemented; Stage 1's coverage/brevity floor is the
real lever. **Structural safety holds at the streaming level too** (pinned by
`tests/streaming.test.ts`): while *dictating*, **no prefix of report prose ever fires a
navigation or destructive command** — the only residual is the bare-leading-`"stop"` →
`stop_dictation` near-miss (dictation-control tier, recoverable). The 17% @case_open is the
*don't-dictate-9-words-at-case_open* exposure, not the intended workflow.

## STT bake-off bench — tune on YOUR real audio (`/bench.html`)

The keystone for per-component improvement: record the script once (your voice,
known ground truth), then replay every STT engine against the **same** recordings —
apples-to-apples, repeatable. So tuning is driven by real audio, not synthetic/clean
text.

Open **http://localhost:5173/bench.html** (Chrome):
1. **● Record session (guided)** — for each prompt it listens (Silero VAD) and
   captures exactly your spoken segment (no fixed window, silence auto-trimmed — the
   old fixed-window recorder padded commands with silence and small models
   hallucinated on it → WER > 100%). Each row shows a **level** (⚠ if too quiet) and
   a **▶** to play back what was captured — verify your voice is actually there
   before running. Recordings persist in IndexedDB.
2. **▶ Run bake-off** — replays each recording through `sherpa-en-20M`,
   `whisper-tiny`, `whisper-base` and renders a scorecard:
   - **WER↓** word error rate vs your script
   - **cmd-intent acc↑** % of commands that fired the right intent (STT → separator)
   - **false-fire↓** % of dictation that wrongly fired a command
   - **speed** transcribe time ÷ audio duration
3. **Load synthetic (JFK)** verifies the replay/metrics pipeline without a mic.

Measurement logic is verified (perfect-STT upper bound = 12/12 commands, 0/6
dictation false-fire), so any miss in a real run is genuine STT error. Files:
`src/bench/` (`script.ts` prompts, `engines.ts` roster, `wer.ts`, `recorder.ts`,
`store.ts`, `main.ts`). Add an engine = one entry in `engines.ts:ENGINES`.

**This is the loop:** find the engine with the best cmd-intent acc on your voice →
make it the live STT → then tune VAD / decoder / separator on the same recordings.

## Live engine: sherpa + closed-set name resolution (bake-off outcome)

The bake-off on real voice (onset-fixed) settled the recognizer choice. The table below
is a **one-off observed** run on one voice/machine (no committed reproducible artifact —
rerun `/bench.html` on your own audio); it informs the engine pick, it is not a benchmark
claim:

| engine | WER | cmd-intent acc | streaming |
|---|---|---|---|
| **sherpa-en-20M** | 16.5% | **83.3%** | ✅ (CPU) |
| whisper-small q4 | 14.8% | 83.3% | no (GPU) |
| whisper-base | 21.4% | 75.0% | no |
| whisper-tiny | 25.8% | 66.7% | no |

- **sherpa is the default live engine** (`main.ts`): ties best command accuracy, is the
  only streaming/fire-on-partial option, runs on CPU (off the GPU). whisper-small's WER
  edge (1.7 pts) wasn't worth running a 2nd GPU model.
- **The one real miss was proper nouns** ("open the Anderson case" → "under song"). Fix:
  **closed-set nearest-name resolution** (`slots.ts:resolveNameNearest`) — since the
  worklist is a known ~8-name set, the name slot resolves to the *nearest* entry rather
  than a strict fuzzy match. Verified in node on the actual garbled transcripts:
  "undersum"/"under song"/"undersume" → Anderson, while "open the report/window" → no
  name (no false open), and dictation false-fire stays 0/53.
- **WASM text-hotwords were blocked by the bundle** — the packed `.data` ships only
  encoder/decoder/joiner/tokens (no BPE vocab, verified), so sherpa can't tokenize text
  hotwords. `sherpa.ts:hotwordConfig()` is kept, gated behind `BUNDLE_HAS_BPE_VOCAB`
  (false) for when a bpe-vocab bundle is vendored. The closed-set resolver fixes the
  name problem without it.

## Known limits → next milestones

- Sherpa runs on **CPU/WASM** (1–2 cores), parallel to the WebGPU lane — keep it off
  the main thread (Web Worker) in a later pass; today it shares the main thread.
- **Silero VAD onset-gating** for the sherpa path (currently raw mic + sherpa's own
  `isEndpoint`); fold in `SileroVad` for cleaner onset + pre-roll.
- **Smart-Turn v3.1** semantic endpointing (thinking-pause vs done) — M5.
- The vendored `en` Zipformer is ~182 MB (fp32-ish); the en-20M int8 (~44 MB) would
  cut load time — swap by building that bundle, or quantized model, later.
