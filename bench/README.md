# Phase-0 bench

Throwaway-friendly measurement harness for the voice cockpit. Its only
job (per [`../docs/PHASE-0-BENCH.md`](../docs/PHASE-0-BENCH.md)) is to turn the disputed
numbers in [`../docs/research/OPEN-QUESTIONS.md`](../docs/research/OPEN-QUESTIONS.md) into
**measured facts** on real audio + real hardware, and flip 🔴 tickets to ✅.

**This is not product code.** Optimize for fast iteration. No real patient data. The
synthetic dataset ships a mock worklist; real recorded audio is dropped into
`datasets/audio/` (git-ignored).

## Run it

```sh
npm install
npm run build      # tsc --noEmit typecheck
npm run example    # STT bake-off on the synthetic dataset -> scorecard
```

The example prints a scorecard. Engine latency numbers are **PLACEHOLDERS** (the
disputed literature values) and rows are marked `*PH` until measured locally —
see "Status" below.

## Layout

```
bench/
├─ src/
│  ├─ trace/        stage-boundary timestamp bus (capture→…→render); headline = mouth-to-command
│  ├─ adapters/     SttAdapter contract + MockSttAdapter (deterministic replay)
│  ├─ decoder/      L1 command matcher STUB (real cascade is Phase 2)
│  ├─ scorecard/    docs/PHASE-0-BENCH.md §D metrics + table formatter
│  └─ stats.ts      percentile / mean helpers
├─ datasets/        synthetic generator + real-audio manifest loader
└─ experiments/     one runner per §E head-to-head (stt-bakeoff today)
```

## How to…

**Add an STT engine** — implement `SttAdapter` (`src/adapters/types.ts`) in a new
file under `src/adapters/`, then add it to the `ENGINES` array in the relevant
experiment. Set `meta.placeholder = false` only once its numbers are measured here.

**Add a dataset** — drop audio in `datasets/audio/`, write
`datasets/audio/manifest.json` matching `datasets/types.ts` (with `audioPath` per
sample). `loadDataset()` picks it up automatically over the synthetic fallback.

**Add an experiment** — new file in `experiments/`, load a dataset, drive engines
through the trace bus, emit `ScorecardRow`s, print with `formatScorecard`.

**Read the scorecard** — `m2c p50/p95` = mouth-to-command latency (headline);
`TTFP` = time-to-first-partial; `FAR*` = false-accept rate (**weighted heaviest** —
a mis-fire on dictation is worse than a missed command); `*PH` = placeholder number.

## Ground-truth timing rig (manual, §B)

True mouth→UI-render latency needs a **hardware audio loopback + 240 fps camera**
(software timestamps miss render/GC). That rig is a manual procedure, not
automated here. The trace bus is the software-timestamp fallback; treat its
numbers as a lower bound until cross-checked against the camera rig.

## Status / planned experiments (§E)

- [x] `stt-bakeoff` — engine latency × detection (PLACEHOLDER numbers)
- [ ] decoder cascade (L1 FST + L2 Model2Vec + L3 LLM) — per-layer latency/accuracy
- [ ] commit-policy sweep (local-agreement N) — mis-fire vs latency curve
- [ ] command-vs-dictation separator vs ACI-Bench baseline (B8)
- [ ] transport: WebRTC vs WebSocket under netem packet loss (A5)
- [ ] target-speaker front-end (C6) on reading-room cross-talk

**Before trusting any number here:** replace the PLACEHOLDER engine configs in
`experiments/stt-bakeoff.ts` with the values settled in
`../docs/research/WEB-VERIFICATION.md`, and wire real adapters for the engines that doc
clears. Everything marked bench-only there is what this harness must measure on
real audio + hardware.
