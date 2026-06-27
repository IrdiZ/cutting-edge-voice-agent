# Voice Cockpit - Acceptance Criteria & Manual Test Plan

How to know the thing works, by hand, in the browser. Pairs with the automated
gate (`npm run check`): the gate proves the invariants on a fixed text corpus; this
plan proves them on YOUR live voice through the real sherpa STT path.

## 0. Setup

```sh
npm run dev          # http://localhost:5173  (open in Chrome)
npm run check        # the automated gate: typecheck + eval + 32 unit tests
```

In the page: engine selector top-right -> **On-device . Streaming (sherpa)**. Start
the mic. If sherpa fails to init, hard-reload (the COOP/COEP headers must re-evaluate;
`self.crossOriginIsolated` must be `true` in the console).

Worklist for reference (positions are 1-based): 1 Anderson, 2 Bauer, 3 Chen,
4 Delacroix, 5 Okafor, 6 Patel, 7 Rossi, 8 Schmidt.

---

## 1. Acceptance criteria (the contract - these may never regress)

| ID | Criterion | Why it is load-bearing |
|----|-----------|------------------------|
| AC-1 | **FAR = 0 on dictation.** While dictating findings/impression, NO prose ever fires a navigation or destructive command. | Medico-legal: a stray "sign" or "next" in narration must not act. Structural (ScopeFsm), not luck. |
| AC-2 | **Destructive isolation.** `sign & next` never commits from the speech stream. It only ever goes *pending*; committing needs a SEPARATE isolated "confirm" / "sign confirm" utterance or the button. | A signature is a never-event; one-breath "sign and confirm" must not sign. |
| AC-3 | **Navigation fires on a partial** (no need to finish the sentence) when spoken as a short, clean command. | The whole point: fire-on-partial reactivity. |
| AC-4 | **Scope gating.** `sign`/`next`/`open` are unreachable while dictating; `findings`/`stop` behave per scope. | Same structural defense as AC-1. |
| AC-5 | **Command recall >= 0.80** on the eval corpus (today 82.4%). | Usability floor; the gate exits 1 below it. |
| AC-6 | **Chaining.** One breath can fire multiple commands ("second case then third case"). | Throughput. |
| AC-7 | **Slot resolution.** Names resolve to the nearest worklist entry even when mistranscribed ("under song" -> Anderson); ordinals resolve including homophones ("forth" -> 4, "thrid" -> 3). | Real STT mangles names and numbers. |

---

## 2. Manual test scripts

Format: **say** -> **expect**. Speak each as its own short utterance unless the
step says "in one breath". Watch the cockpit + the latency HUD.

### Group A - navigation & slots (scope: worklist / case_open)

| # | Say | Expect |
|---|-----|--------|
| A1 | "open Anderson" | Case 1 (Anderson) opens, status `open`. |
| A2 | "open the Delacroix case" | Case 4 opens. |
| A3 | "next" | Advances to the next case. |
| A4 | "previous" | Goes back one. |
| A5 | "first" / "last" | Jumps to case 1 / case 8. |
| A6 | "go to case five" | Case 5 (Okafor) opens. |
| A7 | "go to the third" | Case 3 (Chen) opens. |
| A8 | **"open the fourth case"** | **Case 4 (Delacroix) opens** (was the reported bug). |
| A9 | **"open the forth case"** (homophone) | **Case 4 opens** (fuzzy ordinal). |
| A10 | "compare prior" | Prior panel toggles. |

### Group B - dictation lane & FAR=0 (scope: dictating)  [AC-1, AC-4]

| # | Say | Expect |
|---|-----|--------|
| B1 | "findings" | Enters dictation, findings field shows the cursor. |
| B2 | "there is a large mass in the left lung" | Text lands in Findings, NO navigation. |
| B3 | "the patient signed consent for the next study" | All text in Findings. **No sign, no navigate** (the killer case). |
| B4 | "compare with the prior exam shows no change" | All text in Findings; prior panel does NOT toggle. |
| B5 | "stop" | Dictation ends, status back to `open`. |

> If ANY word in B2-B4 triggers a command, that is an AC-1 failure - capture the
> utterance and the HUD and treat it as a release blocker.

### Group C - destructive confirm isolation  [AC-2]

| # | Say | Expect |
|---|-----|--------|
| C1 | open a case, then "sign" | A **pending** confirm appears. Nothing is signed yet. |
| C2 | (while pending) "confirm" | NOW it signs and advances to the next case. |
| C3 | open a case, then "sign and confirm" in ONE breath | Goes pending, **does NOT sign** (one-breath isolation). |
| C4 | open a case, "sign", then say something unrelated like "actually wait" | Pending **cancels** (fail-closed). Nothing signed. |
| C5 | open a case, "sign", then click the confirm button | Signs (button path). |

### Group D - chaining  [AC-6]

| # | Say | Expect |
|---|-----|--------|
| D1 | "second case then third case" (one breath) | Opens case 2, then case 3. |
| D2 | "first then last" (one breath) | Case 1 then case 8 (and NOT a spurious goto_nth - regression-pinned). |

### Group E - the trailing-command behavior (known + intended)  [see notes]

| # | Say | Expect |
|---|-----|--------|
| E1 | "next" (short, clean) | Fires immediately on the partial (AC-3). |
| E2 | "umm so let me think next" (long, command at the very end, no pause) | Likely does NOT fire mid-stream; fires after you pause / the segment ends. **This is intended** (the coverage/brevity floor that buys FAR=0). Pausing before the command is the workaround today. |

---

## 3. What "pass" means

- Groups A-D all behave as the Expect column says on your voice. Misses in A6-A9
  or recall-type misses are tuning issues; misses in **B (FAR) or C (destructive)
  are blockers**.
- `npm run check` stays green (GATE PASS, FAR 0%, recall >= 80%).
- E2 behaving as described is a PASS, not a bug (see the README streaming-eval note).

## 4. If you want me to drive these for you

I can execute Groups A-D against the live page via the Chrome DevTools MCP +
the **Simulate** buttons (which push text through the exact same pipeline), and
report a pass/fail table - no mic needed. Ask and I will.
