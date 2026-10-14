# 05 — PHI/HIPAA/BAA Landscape & Radiology Voice Prior Art

_Research date: May 2026. Prioritizes 2024–2026 data. For a cutting-edge voice-to-command
system for dictation-heavy reporting. Cloud STT/LLM permitted under a signed HIPAA BAA._

---

## PART A — PHI / HIPAA / BAA Vendor Landscape

### A.1 BAA-availability table (STT + LLM vendors)

| Vendor | Service | Signs BAA? | How / tier | Zero Data Retention (ZDR) | Audio/transcript storage default | Training opt-out | Notes |
|---|---|---|---|---|---|---|---|
| **Deepgram** | STT (real-time + batch) | **Yes** | Request via support / sales; verify-via-GitHub friction reported | **Yes** — zero-retention is a default capability; fine-grained retention flags (minutes → immediate delete) | Configurable; default can be zero-retention | Yes — no training unless you opt into Model Improvement Partnership | Self-hosted/on-prem option keeps audio+transcripts in your env (mTLS only to license server). Sub-300ms latency. SOC2, GDPR, CCPA, PCI. **Strong fit for on-prem/private.** |
| **OpenAI** | API (Whisper STT, GPT LLM) | **Yes** | Email baa@openai.com; **Enterprise plan NOT required** for API BAA; case-by-case, ~1–2 biz days | **Yes, but request-only** for eligible endpoints; ZDR is what the BAA actually covers | Default: inputs/outputs retained up to 30 days for abuse monitoring, then deleted | Yes — API & enterprise products not used for training by default | Only ZDR-eligible endpoints are BAA-covered. **Web Search is NOT HIPAA-eligible.** Mid-2025 court-order retention uncertainty — verify current status. ChatGPT for Healthcare is a separate product. |
| **Anthropic (Claude)** | API + Enterprise | **Yes** | Sales; "HIPAA-ready" org. **ZDR no longer required** for HIPAA-ready API (policy change). BAAs after Dec 2, 2025 cover API + Enterprise in one agreement | Available for qualified accounts (eligible APIs + products using your org API key incl. Claude Code) | Per BAA / ZDR config | Yes | **Console/Workbench NOT covered even with BAA.** Web search excluded. Cowork excluded. **Claude on AWS Bedrock = HIPAA-eligible under AWS BAA** (cleanest path — keeps data in AWS, never to Anthropic). |
| **AWS Transcribe Medical** | STT (medical, incl. **radiology** specialty) | **Yes** | AWS BAA via AWS Artifact (self-service console) | **Stateless** — neither stores inbound audio nor output text | None (stateless) | N/A (stateless) | Explicitly lists **radiology** as a supported specialty. Automatic PHI identification at no extra charge. Must use HIPAA-eligible services only + encrypt PHI in transit/at rest. |
| **AWS HealthScribe** | STT + GenAI clinical notes | **Yes (HIPAA-eligible)** | AWS BAA via Artifact | Within AWS controls | Per config | N/A | Combines ASR + GenAI summarization; oriented to clinician-patient convos, not pure radiology dictation. |
| **Google Cloud Speech-to-Text** | STT | **Yes** | BAA via Google account team; covers entire GCP infra + listed covered services | Compliant config = **do NOT opt into data logging** | Don't enable logging when under BAA | Yes (don't opt into logging) | Covered service. PHI must flow only through covered services. |
| **Azure AI Speech** | STT/TTS | **Yes** | **No separate signing** — BAA in Microsoft Product Terms by default for covered entities/BAs | Per config | Per config | Yes | Route PHI voice through **Azure AI Speech**, NOT the Azure OpenAI Realtime API audio modality (native audio in/out not yet HIPAA-covered; only Realtime text core is covered). |
| **AssemblyAI** | STT (+ medical solution) | **Yes** | Standard BAA at assemblyai.com/legal/business-associate-agreement; **included, no extra cost** | Configurable Transcript TTL | Configurable retention | Yes | Built-in PII redaction; optional EU data residency. TLS1.2+ / AES-256. Markets a dedicated medical STT solution. |

**Cross-cutting caveat (all vendors):** A BAA covers only what happens _inside the vendor's
infrastructure_. It does not cover how PHI enters your pipeline, your app-layer logging, your
RAG/vector store, or user behavior. Those are **your** responsibility — and the gap most
healthcare deployments overlook.

**Regulatory context (2025–2026):** HHS published an NPRM (Jan 6, 2025) proposing the biggest
HIPAA Security Rule changes since 2003 (comment period closed Mar 7, 2025; final rule possibly
summer 2026). Notable proposal: business associates must verify deployed technical safeguards
at least every 12 months, by an SME, documented in writing. There is **no formal HIPAA
certification** — a vendor "claiming" compliance ≠ a vendor with implemented safeguards.

### A.2 De-identification / PHI-redaction approaches (before any LLM fallback call)

| Tool | Type | Strengths | Weaknesses | Fit |
|---|---|---|---|---|
| **AWS Comprehend Medical (DetectPHI)** | Managed cloud (HIPAA-eligible) | Returns NAME, AGE, ADDRESS, PROFESSION, PHONE, ID, EMAIL, DATE, LOCATION_OTHER, URL + confidence scores; ~$10/M chars; AWS publishes an LLM-guardrail RAG pattern | **Text leaves your environment** (still need BAA) | Good if already in AWS BAA. |
| **Microsoft Presidio** | Open-source (MIT), self-host | 50+ recognizers; 2025 added MedicalNERRecognizer, GPU accel (GLiNER/Transformers/Stanza), ONNX, Azure Health surrogate anonymization | Precision weakness: 2025 neurosurg study recall 0.74 but **precision 0.51** → over-redacts, strips context | Best for on-device/self-host when you can tune. |
| **Philter (UCSF)** | Open-source (BSD-2), self-host | Hybrid rule+ML; **99.46% recall** on UCSF notes (F2=94.36); consistent name redaction + date/age shifting preserves usability | Rule tuning needed | Strong on-prem clinical de-id, recall-first. |
| **John Snow Labs Medical De-id** | Commercial | High clinical accuracy | Cost/licensing | Enterprise alternative. |

**Critical caveat:** De-identification is NOT foolproof against LLMs. An adversarial study (DIRI,
arXiv 2410.17035) showed ClinicalBERT-masked notes were still **re-identified ~9% of the time**.
A 2025 paper (arXiv 2511.18272) showed vision-token masking alone cannot prevent PHI leakage in
medical-document OCR. **Layer** de-id (prefer high recall) + confidence thresholds + human review
for high-accuracy cases. Pseudonymization/surrogates preserve transcript readability better than
blanket redaction.

### A.3 Recommended PHI-minimizing architecture pattern

**Principle: keep PHI off the cloud LLM path entirely; cloud only ever sees de-identified text.**

```
[Reading-room mic]
   |
   v
(1) ON-DEVICE / VPC STT  ──► Deepgram self-hosted OR AWS Transcribe Medical (stateless, radiology)
   |   - audio never persisted; zero-retention configured in writing in the BAA
   v
(2) ON-DEVICE COMMAND DECODER (intent/grammar)
   |   - "sign and next", "go to impression", laterality, macro insertion, PACS nav
   |   - the "zero-click cockpit" core: most commands resolve locally, NO cloud call, NO PHI egress
   v
(3) NEEDS GENERATIVE LLM? (e.g. auto-impression, free-text drafting)
   |        |
   |        v
   |   (3a) PHI REDACTION GATE (Philter/Presidio/Comprehend Medical, recall-first + pseudonyms)
   |        v
   |   (3b) BAA-covered LLM, ZDR endpoint ONLY (Claude on Bedrock / OpenAI ZDR / Azure Speech+OpenAI text)
   |        - de-identified text in; draft out; re-hydrate pseudonyms locally
   v
(4) Local re-hydration + user review + sign-off (audit log, no PHI to non-covered features)
```

Key rules baked in:
- **On-device command decode** handles the bulk of interactions → minimal PHI egress, lowest latency.
- Cloud LLM calls are the **exception**, always ZDR + BAA + de-identified, never web-search/preview features.
- Prefer **Claude on AWS Bedrock** or **AWS Transcribe Medical** to keep everything within one AWS BAA boundary.
- **Always-on mic compliance risk (reading room):** an always-listening mic captures multiple
  patients, colleague conversations, and bystander remarks — all potentially PHI. Mitigate with:
  push-to-talk or explicit wake-word gating (not truly always-recording), no audio persistence,
  short auto-delete, minimum-necessary scoping, encryption in transit+at rest, breach playbooks,
  and addressing clinician surveillance/trust concerns (if not trusted, not used).

---

## PART B — Radiology Voice Reporting Prior Art

### B.1 Incumbent systems

**Nuance / Microsoft — PowerScribe One** (used by **>80% of US users**; on Azure, HITRUST CSF):
- **PowerScribe Smart Impression** — GenAI auto-drafts impression + recommendation **in the
  user's own personal style/voice**; saves up to ~1 min/read across 30–40 cases/day.
  Showcased RSNA 2023; users incl. Mass General Brigham, Quantum Radiology. Carries explicit
  "AI can make mistakes" disclaimers.
- **Virtual assistant / voice commands** — "Hey PowerScribe, turn on SpotView", "...send a message
  to Dr. Smith"; pull data from PACS/EHR by voice; auto-present prior reports by relevance.
- **Ambient Mode** — dictate free-form/narrative; background AI builds a fully structured report.
- **Quality checks** — inline sex/laterality mismatch + critical-finding alerts. Heads-Up Display
  (translucent window over images).
- **RSNA 2025: Dragon Copilot for radiology (preview)** — multimodal/agentic: draft impressions
  from images, prior-report summarization into bullets, clinical-question chat, billing-gap alerts
  (Zotec), missing-documentation detection, mammography analytics partner (Lunit). **Preview only,
  not GA.**

**Nuance — Dragon Medical One (DMO)** (traditional precision dictation):
- Hands-free: "Wake Up"/"Go to Sleep"; always-listening mic. **Anchor Text Mode** purpose-built
  for dual-screen PACS (dictate into one screen while manipulating image on the other).
- Step-by-step custom commands; PowerMic / PowerMic Mobile hardware buttons (next field, transfer
  text) — reconfigurable. "What You Can Say" command library.

**Solventum (formerly 3M M*Modal) — Fluency for Imaging** (**#1 Best in KLAS Front-End Imaging
Speech Recognition: 2020, 2022, 2023, 2024, 2025**):
- SR + **NLU** for contextual understanding (fewer manual edits).
- **CAPD** (computer-assisted physician documentation) — real-time interactive nudges for
  documentation gaps before sign, supports compliance/reimbursement.
- **Actionable Findings Management** — "red alert" critical findings auto-trigger phone comms +
  auto-document read-back verification (meets Joint Commission NPSG + ACR guidelines).
- Customizable templates + personalized macros; DICOM SR measurement auto-population; M*Modal
  Scout analytics; peer-review assist.

**Rad AI — Impressions / Reporting** (GenAI-native challenger):
- **Rad AI Impressions** — auto first-draft impressions from dictated findings, in each
  user's own language/style; **"zero-click"**, works with structured or free dictation;
  **0.5–3 s** generation; claims **60+ min saved per shift**. ("speak less, say more.")
- **Dec 1, 2025: next-gen speech recognition** (patent pending) integrated into Rad AI Reporting.
- **April 2026: peer-reviewed in npj Digital Medicine** — domain-specific models preferred over
  general models for AI-generated impressions. Deloitte Fast 500 #36; CNBC Disruptor 50.

### B.2 Standards & structured-reporting workflow

- **RadReport.org (RSNA)** — free repository of peer-reviewed structured reporting templates;
  metadata-tagged; "best practice" examples; mapped to RadLex + SNOMED CT.
- **RadElement.org — Common Data Elements (CDEs)** — RSNA+ACR joint effort; computer-readable
  observations built on RadLex; embedded in templates (LI-RADS, PI-RADS); **API for vendor
  integration**; enables QA benchmarks, accurate billing, ML classifiers, comparative research.
- **RadLex (RSNA)** — radiology controlled vocabulary/lexicon; structure + terminology together
  make reports machine-readable.
- **ACR-Assist** — ACR decision-support framework.
- **Voice macros / SmartMacros** — personal / group-shared / practice-wide libraries; "smart"
  macros are context-aware (consider modality + demographics) and populate Findings/Impression/
  Recommendation from a single input. Engines integrate with existing SR (e.g. "chest CT normal"
  → inserts standard template).
- **"Sign-and-next" / workflow commands** — hands-free finalize/route/sign-off and advance the
  worklist; central to efficiency.

### B.3 Clinical/academic literature — error rates, TAT, workflow

- **Systematic review (Eur Radiol / PubMed 26157081):** reports with ≥1 error: **4.8%–89% for SR**
  vs **2.1%–22% for transcription** — SR generally has **higher** error rates. Errors: wrong-word
  substitution, nonsensical phrases, omissions. **TAT improved 35%–99%** with SR, BUT dictation
  time lengthened and a majority of users report **more** time creating/finalizing reports
  (net productivity can drop).
- **Retrospective audit (PMC3138931):** 6% of corrected-report (CR) vs **38% of non-CR** reports
  contained errors — underscores the cost of skipping verification.
- **Radiology: AI (ryai.230205, ~Mar 2025):** GenAI LLMs detect SR errors; dataset of 3,233 CT/MRI
  reports.
- **2025 (PubMed 40815310):** GPT-4o & Claude Sonnet 3.5 audio-input reporting vs conventional SR —
  LLMs enable reporting from minimal audio input, reducing TAT.
- **2024 US academic health system:** GenAI auto-drafting improved documentation efficiency
  **15.5%** (= 12 full user shifts saved), diagnostic accuracy unchanged.

### B.4 What users complain about (the bar / the gaps)

- **Accuracy & accents** — ~95–97% on radiology terms after training, but accuracy "drops
  significantly" with any accent (one India-trained user: 3 months to acceptable accuracy).
- **Manual punctuation** — saying "period comma new paragraph" aloud becomes a verbal tic.
- **Training burden** — 20–30 min initial voice training + weeks of per-user corrections.
- **Stalled core dev** — perception that post-2022-Microsoft-acquisition, Nuance/Dragon core
  dictation development "effectively stopped" (focus shifted to Azure cloud).
- **Cost** — PowerScribe ~$5k–$10k/user/yr (a 10-rad group = $50k–$100k/yr).
- **Adoption gaps** — DMO study: 100% adoption goal unmet (30 of 250+ providers kept typing);
  real-time accuracy a persistent concern.
- **Verification overhead** — SR shifts editing burden onto the user; high non-CR error rates.

---

## Gaps / opportunities for a "zero-click cockpit" to exploit

1. **Kill the verbal punctuation + manual-command tic.** Incumbents still force "period comma new
   paragraph" and explicit dictation verbs. A true on-device intent decoder that infers structure
   and handles navigation/sign-off with minimal/zero spoken scaffolding is a clear differentiator.
2. **Accent & latency robustness with local-first decode.** Accent-driven accuracy collapse and
   editing burden are the top complaints. On-device command decode (no round-trip) + modern STT
   tuned for radiology terms targets both latency feel and accent fairness.
3. **PHI-minimizing architecture as a feature, not an afterthought.** Incumbents route PHI to cloud
   (Azure/AWS) under BAA; few emphasize on-device decode + de-identified-only LLM fallback. A
   design where the cloud LLM never sees PHI (de-id gate + ZDR + Bedrock) is both a compliance and
   a trust/marketing edge — and directly addresses always-on-mic reading-room risk.
4. **Hands-free, zero-click worklist flow.** Rad AI proved "zero-click impressions" + speed
   (0.5–3 s) sells. Extend to the **whole cockpit**: sign-and-next, PACS navigation, prior
   summarization, laterality/critical-finding guardrails — all voice-driven, all local where
   possible, advancing the worklist without touching mouse/keyboard.

(Secondary openings: real-time inline error/laterality guardrails before sign-off; standards-native
output via RadLex/CDE/RadReport templates for machine-readability + billing; transparent
low/zero-cost model vs $5–10k/rad incumbent pricing.)

---

## Deeper research paths / open questions

- **OpenAI court-order retention vs BAA (mid-2025):** is API ZDR still honored under any litigation
  hold? Verify directly before relying on OpenAI ZDR for PHI fallback.
- **Bedrock-Claude vs direct-Anthropic BAA** — confirm exact eligible models/regions and whether
  Bedrock keeps everything in your AWS BAA boundary for the radiology use case.
- **De-id recall vs re-identification** — quantify residual re-id risk (DIRI ~9%) on _radiology_
  transcripts specifically; test surrogate/pseudonym strategies that preserve report usability.
- **Latency budgets** — Deepgram cites sub-300ms; Rad AI cites 0.5–3s for impressions. Define the
  cockpit's per-command latency SLO for "feel."
- **NPRM final rule (summer 2026?)** — the 12-month technical-safeguard verification requirement
  may add BA obligations; track before GA.
- **Vision-token / multimodal PHI leakage** (arXiv 2511.18272) — if we ever add image-to-text,
  masking alone won't protect PHI.
- **Structured-output integration depth** — how hard is RadElement API + RadReport template binding
  for auto-populated, machine-readable, billable reports?

---

## Sources

**PHI / HIPAA / BAA**
- Deepgram data privacy & compliance: https://developers.deepgram.com/trust-security/data-privacy-compliance
- Deepgram standard compliance STT: https://deepgram.com/learn/standard-compliance-speech-to-text
- Is Deepgram HIPAA compliant (Accountable): https://www.accountablehq.com/post/is-deepgram-hipaa-compliant-baas-phi-and-security-explained
- OpenAI BAA help: https://help.openai.com/en/articles/8660679-how-can-i-get-a-business-associate-agreement-baa-with-openai
- OpenAI enterprise privacy: https://openai.com/enterprise-privacy/
- OpenAI BAA coverage gaps (Protecto): https://www.protecto.ai/blog/openai-hipaa-baa-what-it-actually-covers-and-what-leaves-phi-exposed/
- Anthropic BAA (Privacy Center): https://privacy.claude.com/en/articles/8114513-business-associate-agreements-baa-for-commercial-customers
- Anthropic ZDR scope: https://privacy.claude.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to
- Is Claude HIPAA (Aptible): https://www.aptible.com/hipaa/claude-baa
- Is Claude HIPAA 2026 (Strac): https://www.strac.io/blog/is-claude-hipaa-compliant
- AWS HIPAA compliance: https://aws.amazon.com/compliance/hipaa-compliance/
- Amazon Transcribe Medical: https://aws.amazon.com/transcribe/medical/
- AWS HealthScribe HIPAA: https://www.hipaajournal.com/aws-healthscribe-hipaa-eligible-ai-transcription-tool/
- Google Cloud HIPAA: https://cloud.google.com/security/compliance/hipaa
- Google Cloud HIPAA BAA terms: https://cloud.google.com/terms/hipaa-baa
- Is Google Cloud STT HIPAA (Accountable): https://www.accountablehq.com/post/is-google-cloud-speech-to-text-hipaa-compliant-in-2025-baa-explained
- Azure HIPAA offering: https://learn.microsoft.com/en-us/azure/compliance/offerings/offering-hipaa-us
- Azure OpenAI Realtime HIPAA Q&A: https://learn.microsoft.com/en-us/answers/questions/5616040/clarification-request-hipaa-eligibility-of-azure-o
- AssemblyAI BAA: https://www.assemblyai.com/legal/business-associate-agreement
- AssemblyAI can you sign a BAA: https://www.assemblyai.com/docs/faq/can-you-sign-a-baa
- AssemblyAI medical solution: https://www.assemblyai.com/solutions/medical/
- HIPAA BAA 2026 update (HIPAA Journal): https://www.hipaajournal.com/hipaa-business-associate-agreement/

**De-identification**
- De-identify PHI before LLM (Aptible): https://www.aptible.com/hipaa-ai-security/phi-deidentification
- AWS Comprehend Medical + LLM RAG: https://docs.aws.amazon.com/prescriptive-guidance/latest/generative-ai-nlp-healthcare/comprehend-medical-rag.html
- Open-source PHI de-id review (IntuitionLabs): https://intuitionlabs.ai/articles/open-source-phi-de-identification-tools
- Philter (UCSF): https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7156708/
- Presidio vs John Snow Labs: https://www.johnsnowlabs.com/comparing-john-snow-labs-medical-text-de-identification-with-microsoft-presidio/
- DIRI adversarial re-identification: https://arxiv.org/pdf/2410.17035
- Vision-token masking PHI leakage: https://arxiv.org/pdf/2511.18272
- Presidio vs Philter neurosurgery study: https://surgicalneurologyint.com/wp-content/uploads/2025/08/13857/SNI-16-313.pdf

**Always-on mic / ambient compliance**
- HIPAA risks of ambient listening (Accountable): https://www.accountablehq.com/post/hipaa-risks-of-ambient-listening-in-clinical-documentation-key-compliance-issues-and-how-to-mitigate-them
- AMA Journal of Ethics on ambient listening: https://journalofethics.ama-assn.org/article/how-should-we-think-about-ambient-listening-and-transcription-technologies-influences-ehr/2025-11

**Radiology voice prior art**
- PowerScribe One (Microsoft): https://www.microsoft.com/en-us/health-solutions/radiology-workflow/powerscribe-one
- PowerScribe Smart Impression (ITN): https://www.itnonline.com/content/nuance-accelerates-adoption-generative-ai-radiology-powerscribe-advanced-auto-impression
- Dragon Copilot for radiology RSNA 2025 (Microsoft blog): https://www.microsoft.com/en-us/microsoft-cloud/blog/healthcare/2025/11/24/driving-a-unified-ai-experience-at-rsna-2025-microsoft-dragon-copilot-expands-to-radiologists-transforming-the-reporting-workflow/
- Dragon Copilot radiology (RSNA Daily Bulletin): https://dailybulletin.rsna.org/en/2025/sun/sun05
- Dragon Medical One voice commands (MS Support): https://support.microsoft.com/en-us/dragon-medical-one/use-voice-commands-in-dragon-medical-one
- Dragon + cloud PACS integration (Purview): https://www.purview.net/blog/dragon-medical-voice-recognition-now-integrates-with-cloud-pacs-radiology-reporting
- Solventum Fluency for Imaging: https://www.solventum.com/en-us/home/health-information-technology/solutions/fluency-for-imaging/
- 3M M*Modal Best in KLAS (Nasdaq): https://www.nasdaq.com/press-release/3m-mmodal-ai-powered-radiology-speech-reporting-solution-is-again-honored-by-the-1
- Rad AI next-gen speech recognition: https://www.radai.com/news/rad-ai-unveils-next-generation-speech-recognition-that-redefines-radiology-reporting
- Rad AI homepage / Impressions: https://www.radai.com/
- Multi-agent impression generation (arXiv): https://arxiv.org/pdf/2412.06828

**Standards & structured reporting**
- RadReport templates (RSNA): https://www.rsna.org/practice-tools/data-tools-and-standards/radreport-reporting-templates
- RadElement CDEs (RSNA): https://www.rsna.org/practice-tools/data-tools-and-standards/radelement-common-data-elements
- ASNR-ACR-RSNA CDE project (AJNR): https://www.ajnr.org/content/40/1/14
- Structured/templated reporting overview (Applied Radiology): https://appliedradiology.com/articles/structured-and-templated-reporting-an-overview
- Voice-enabled radiology (Medicai): https://blog.medicai.io/en/voice-enabled-radiology/
- SmartMacros (Scriptor): https://scriptorsoftware.com/2024/02/28/radiology-reporting-with-smartmacros/

**Literature — error rates / TAT**
- SR in radiology systematic review (PubMed): https://pubmed.ncbi.nlm.nih.gov/26157081/
- VR software effect on TAT (AJR): https://ajronline.org/doi/10.2214/AJR.09.3169
- Non-clinical VR errors audit (PMC): https://pmc.ncbi.nlm.nih.gov/articles/PMC3138931/
- GenAI LLMs detect SR errors (Radiology: AI): https://pubs.rsna.org/doi/full/10.1148/ryai.230205
- From dictation to diagnosis, multimodal LLM SR (PubMed): https://pubmed.ncbi.nlm.nih.gov/40815310/
- Dragon Medical One rural adoption (PMC): https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10035815/

**User complaints**
- Best radiology dictation software 2026 (Dictation Daddy): https://www.dictationdaddy.com/blog/radiology-dictation-software
- Nuance Dragon vs PowerScribe: https://rafalreyzer.com/nuance-dragon-vs-powerscribe/
