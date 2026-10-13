// Experiment: STT bake-off (PHASE-0-BENCH.md §E.1) — the end-to-end spine demo.
//
// Runs each candidate STT engine over the command + negative sets, fires the L1
// matcher on partials under a cost-tiered commit policy (A1/A6: navigation fires
// eagerly on a partial; destructive waits for the final), records stage-boundary
// traces, and prints a scorecard.
//
// !!! PLACEHOLDER NUMBERS !!!
// The engine latency configs below are the DISPUTED literature values from
// OPEN-QUESTIONS.md (A2/A3/A4/A9), not measurements. They exist so the harness
// runs today. Once research/WEB-VERIFICATION.md lands, replace these with the
// settled numbers, and replace MockSttAdapter with real adapters where the doc
// says an engine is worth wiring. Rows stay marked *PH until measured locally.

import { MockSttAdapter } from '../src/adapters/mock.ts';
import type { SttAdapter, SttInput, Partial } from '../src/adapters/types.ts';
import { UtteranceTrace } from '../src/trace/index.ts';
import { matchL1, type CommandDef } from '../src/decoder/l1.ts';
import {
  detectionMetrics,
  formatScorecard,
  m2cPercentile,
  ttfpFromTraces,
  type ScorecardRow,
} from '../src/scorecard/index.ts';
import { loadDataset } from '../datasets/index.ts';
import { COMMANDS } from '../datasets/synthetic.ts';
import type { CommandSample } from '../datasets/types.ts';

// VAD onset-detection cost (Silero ~0.2–0.3 ms/chunk per WEB-VERIFICATION F1/F2 —
// negligible vs the endpoint floor; modeled as a small constant before firstPartial).
const VAD_MS = 1;

// Candidate engines. Numbers are framed per WEB-VERIFICATION.md:
//  - ttfpMs / perWordMs: STT compute/emission — for the RESOLVED engines these are
//    set near the literature floor (real-audio, weaker-CPU end), NOT the vendor headline.
//  - endpointMs: the silence wait before `isFinal` — the dominant, hardware-independent
//    term (F1/F2). Anything that waits for the final pays it; fire-on-partial does not.
// All remain PLACEHOLDER (`*PH`) until measured locally on real user audio.
const ENGINES: SttAdapter[] = [
  // A2/A3 bench-only: Parakeet-TDT-0.6B is OFFLINE (no streaming first-token latency).
  // The 80–160 ms figure is the *120M EOU* model on GPU/clean-TTS; shown here as an
  // optimistic placeholder pending a real CPU streaming run.
  new MockSttAdapter({ name: 'parakeet-eou-120m', ttfpMs: 160, perWordMs: 40, endpointMs: 280, footprintMB: 600, hardware: 'GPU/clean-TTS(bench-only)' }),
  // A3 resolved: Tiny response-latency 69 ms x86 / 237 ms Pi5 (NOT the <50 ms M3 headline).
  new MockSttAdapter({ name: 'moonshine-v2-tiny', ttfpMs: 69, perWordMs: 25, endpointMs: 300, footprintMB: 34, hardware: 'CPU x86' }),
  // A3 resolved: streaming Zipformer, ~320 ms chunk look-ahead dominates; ~180 MB int8.
  new MockSttAdapter({ name: 'sherpa-zipformer', ttfpMs: 80, perWordMs: 30, endpointMs: 320, footprintMB: 180, hardware: 'CPU-only' }),
  // A9 resolved: Voxtral realtime transcription_delay 160 ms (algorithmic, not wall-clock).
  new MockSttAdapter({ name: 'voxtral-4b-realtime(webgpu)', ttfpMs: 160, perWordMs: 35, endpointMs: 300, footprintMB: 4000, hardware: 'WebGPU' }),
  // A4 bench-only: no first-partial SLA; vendor "sub-300 ms", independent ~992 ms TTFT.
  new MockSttAdapter({ name: 'deepgram-nova3-med', ttfpMs: 300, perWordMs: 20, endpointMs: 300, hardware: 'cloud(bench-only)' }),
];

const PLACEHOLDER_NOTE =
  'PLACEHOLDER — set near literature floor per WEB-VERIFICATION.md; measure on real audio';

const COMMAND_DEFS: CommandDef[] = COMMANDS.map((c) => ({
  intent: c.intent,
  phrasings: c.phrasings,
  tier: c.tier,
}));

interface RunResult {
  claimedIntent: string | null;
  trace: UtteranceTrace;
}

/** Stream one sample through the engine + cost-tiered commit policy. */
async function runSample(engine: SttAdapter, sample: CommandSample): Promise<RunResult> {
  const trace = new UtteranceTrace(`${engine.meta.name}:${sample.id}`);
  trace.mark('capture', 0);
  trace.mark('vad', VAD_MS);
  const input: SttInput = {
    id: sample.id,
    durationMs: sample.transcript.split(/\s+/).length * 300,
    reference: sample.transcript,
  };

  let claimedIntent: string | null = null;
  let firstPartialSeen = false;

  await engine.transcribe(input, (p: Partial) => {
    if (!firstPartialSeen) {
      trace.mark('firstPartial', p.tEmitMs);
      firstPartialSeen = true;
    }
    if (claimedIntent !== null) return;
    const m = matchL1(p.text, COMMAND_DEFS);
    if (!m) return;
    // Cost-tiered commit (A1/A6): destructive ops must not fire on a partial.
    if (m.tier === 'destructive' && !p.isFinal) return;
    claimedIntent = m.intent;
    trace.mark('commandClaim', p.tEmitMs);
  });

  return { claimedIntent, trace };
}

// intent -> cost tier, for splitting latency by fire-on-partial vs endpointed.
const INTENT_TIER = new Map<string, CommandDef['tier']>(COMMANDS.map((c) => [c.intent, c.tier]));

async function scoreEngine(engine: SttAdapter): Promise<ScorecardRow> {
  const { dataset } = loadDataset();

  const navTraces: UtteranceTrace[] = []; // fire-on-partial (navigation + dictation-control)
  const destTraces: UtteranceTrace[] = []; // endpointed (destructive)
  let tp = 0;
  let fp = 0;
  let fn = 0;

  for (const sample of dataset.commands) {
    const { claimedIntent, trace } = await runSample(engine, sample);
    (INTENT_TIER.get(sample.intent) === 'destructive' ? destTraces : navTraces).push(trace);
    if (claimedIntent === null) fn++;
    else if (claimedIntent === sample.intent) tp++;
    else fp++;
  }

  // False-accept surface = adversarial near-commands (negatives) PLUS ordinary
  // pure-dictation prose. The mission's load-bearing safety claim is FAR=0 ON
  // DICTATION, so report prose must be in the denominator, not just the
  // command-like negatives. Dictation has no intent — any fire is a false accept.
  const farInputs: CommandSample[] = [
    ...dataset.negatives,
    ...dataset.dictation.map((d) => ({ id: d.id, transcript: d.transcript, intent: 'NONE' })),
  ];
  let falseAccepts = 0;
  for (const sample of farInputs) {
    const { claimedIntent } = await runSample(engine, sample);
    if (claimedIntent !== null) {
      falseAccepts++;
      fp++;
    }
  }

  return {
    engine: engine.meta.name,
    placeholder: engine.meta.placeholder,
    ttfpMs: ttfpFromTraces([...navTraces, ...destTraces]),
    m2cNavP50: m2cPercentile(navTraces, 50),
    m2cNavP95: m2cPercentile(navTraces, 95),
    m2cDestP50: m2cPercentile(destTraces, 50),
    ...detectionMetrics({
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      // FAR denominator = the FULL false-accept surface (negatives + dictation),
      // not just the command-like negatives — otherwise FAR is a fraction over 4
      // and can exceed 1.0 once dictation also fires. Keep it honest over farInputs.
      negativesTotal: farInputs.length,
      falseAccepts,
    }),
    footprintMB: engine.meta.footprintMB,
    // WER is intentionally absent for mock engines — replay is lossless, so a WER
    // here would be a meaningless 0. Real adapters populate it.
    notes: engine.meta.placeholder ? PLACEHOLDER_NOTE : undefined,
  };
}

async function main(): Promise<void> {
  const { source } = loadDataset();
  const rows: ScorecardRow[] = [];
  for (const engine of ENGINES) {
    rows.push(await scoreEngine(engine));
  }
  console.log(`\nSTT bake-off — dataset source: ${source}`);
  console.log('(commit policy: navigation/dictation-control fire on partials; destructive waits for final)\n');
  console.log(formatScorecard(rows));
  console.log(
    '\nTakeaway (WEB-VERIFICATION F1/F2): the nav vs dest gap IS the endpoint floor. ' +
      'On these PLACEHOLDER timings the harness MODELS fire-on-partial nav reaching ' +
      'sub-100 ms while the endpointed/destructive path cannot, on any hardware — a ' +
      'structural claim about the commit policy, not a measured result. The architectural ' +
      'lever is the commit policy, not the CPU; the magnitudes await real-audio measurement.\n',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
