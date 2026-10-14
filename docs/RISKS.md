# Key Risks + Mitigations

Three risk classes dominate: **latency**, **PHI/privacy**, and **mis-fires**. Each is addressed
by a specific design choice already in [ARCHITECTURE.md](ARCHITECTURE.md), not bolted on later.

## 1. Latency

| Risk | Why it bites | Mitigation in the design |
|------|--------------|--------------------------|
| Waiting for final transcript | Endpointing adds +150–300 ms of dead air regardless of model speed | Fire on **streaming partials**; claim mid-utterance |
| Network RTT on the hot path | Cloud round-trip alone blows the <100 ms budget | **On-device** command STT + decoder (Tier 1) |
| Sequential decoder cascade | local→semantic→LLM in series stacks latency | Run L1/L2/slots **in parallel**, first-confident wins |
| Cold models / connections | First request pays warm-up; serverless cold starts | Pre-warm models, persistent WebRTC/WS, keep-alive |
| WebSocket audio stalls | TCP head-of-line blocking on packet loss (≥100 ms, seconds under congestion) | **WebRTC/UDP + Opus + NetEQ/PLC/FEC** for mic→cloud |
| Vendor ms numbers are fiction | Benchmarks run on clean TTS audio (Parakeet-EOU 80–160 ms was TTS) | **Phase-0 bench on real reading-room mic audio** gates every choice |
| LLM tail latency | p99 TTFT spikes >5% of the time even on Groq | LLM only for rare fuzzy/compound; optimistic preview hides it |

## 2. PHI / privacy

| Risk | Why it bites | Mitigation |
|------|--------------|------------|
| Audio leaving the machine | Always-on mic in a reading room captures lots of PHI | Command lane is **on-device**; only dictation goes to cloud |
| Cloud STT storing audio/text | Retention = PHI at rest off-prem | **Zero-retention** Deepgram, **stateless** AWS Transcribe Medical, or Azure disconnected container |
| LLM seeing PHI | Fallback sends transcript to a model | **De-identify first** (Philter ~99% recall / Presidio / Comprehend Medical); LLM gets de-id text only |
| BAA gaps | A BAA covers the vendor infra, *not* your app | No PHI in app logs / telemetry / RAG; PHI-safe logger in `shared/` |
| Wrong endpoint covered | e.g. Azure OpenAI Realtime audio modality isn't BAA-covered even when Azure Speech is | Route PHI only through explicitly-covered endpoints; prefer **Bedrock-Claude** to stay in one AWS boundary |
| Key exposure in browser | STT API key shipped to client | **Ephemeral tokens** minted server-side (`api/stt-token`); key never hits the browser |
| Always-recording optics | Clinicians/patients uneasy with a hot mic | Wake-token / push-to-command gating + visible recording state |
| Court-ordered retention | OpenAI's 2025 retention uncertainty | Prefer vendors with clean ZDR posture; document the chosen path |

## 3. Mis-fires (false / wrong command execution)

| Risk | Why it bites | Mitigation |
|------|--------------|------------|
| Dictation mistaken for a command | "the appendix is normal" shouldn't trigger an "open appendix" command | **Scope-gated** registry (only in-mode commands load); calibrated thresholds |
| Command text polluting the report | Spoken command lands in dictation buffer | **Word-span subtraction** from transcript, with **undo log** |
| Premature endpointing on a pause | User thinks mid-sentence ("findings are… uh…") | **Smart Turn v3.1** semantic EOU reads prosody/fillers, not just silence |
| Destructive ops fired eagerly | "sign" / "delete" / "finalize" on a low-confidence partial | `confirm: 'always'` → **revision-window=0** (guaranteed-stable prefix) or **clarify prompt**; push-to-command modifier |
| Firing on an unstable partial | Partial matches a command, then gets revised → mis-fire | **Cost-tiered commit gate**: local-agreement N=2–3 (adaptive by stability/uncertainty) before `execute`; see [COMMAND-REGISTRY.md](COMMAND-REGISTRY.md#commit-gate-when-a-partial-actually-fires--confirm-policy) |
| Proper-noun errors | "Smith" vs "Smyth" opens the wrong patient | Phonetic resolve (Double Metaphone + Jaro-Winkler) against **today's worklist only** |
| Over-eager optimistic actions | Preview committed when user didn't mean it | **Preview-then-confirm**: greyed pending state, quick "no"/correction reverts; full undo log |
| Threshold drift | Hand-tuned thresholds rot as vocab grows | **Calibrated** (isotonic/conformal) on logged utterances, periodically refit |
| Room cross-talk / wrong speaker | Always-on mic picks up colleagues, phone calls, side conversations in a shared reading room | **Speaker-enrolled target-isolation front-end** (VoiceFilter-Lite + Personal VAD 2.0): enroll the user at login, suppress all other voices by *identity* before VAD/STT. Validate inactive-target false alarms. See [COMMAND-REGISTRY.md](COMMAND-REGISTRY.md) C6 / [PHASE-0-BENCH.md](PHASE-0-BENCH.md) |
| Barge-in / self-trigger | System audio or echo re-triggers commands | If we emit audio: hybrid linear AEC + neural residual suppression (or Textual Echo Cancellation). **Largely moot if confirmations are visual-only** (our lean). Mic gating during any spoken prompt |

## Cross-cutting

- **Auditability (medico-legal):** every claimed command, its source span, confidence, and any
  transcript subtraction is logged with undo — a tamper-evident trail for signed reports.
- **Graceful degradation:** if on-device STT fails, fall back to cloud command STT (slower but
  functional); if VAD/turn model fails, fall back to a silence timeout. Never a dead mic.
- **The honest caveat:** the headline latency numbers across this dossier come from vendor/paper
  benchmarks, many on clean audio. **Treat them as hypotheses to confirm in Phase 0**, not facts.
