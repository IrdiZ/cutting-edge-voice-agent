// Scorecard — the Phase-0 metrics from docs/PHASE-0-BENCH.md §D, plus a plain-text
// table formatter. Each experiment produces one ScorecardRow per engine/config.
//
// Headline = mouth-to-command p50/p95. False-accept rate is weighted heaviest
// (a mis-fire on dictation is worse than a missed command).

import { mean, percentile, round } from '../stats.ts';
import type { UtteranceTrace } from '../trace/index.ts';

export interface ScorecardRow {
  engine: string;
  /** True if any number here is from literature/placeholder, not measured locally. */
  placeholder?: boolean;
  ttfpMs?: number;
  /** Fire-on-partial path (navigation): no endpoint wait — where sub-100 ms lives. */
  m2cNavP50?: number;
  m2cNavP95?: number;
  /** Endpointed path (destructive): waits for `isFinal` — pays the endpoint floor (F1/F2). */
  m2cDestP50?: number;
  commandPrecision?: number;
  commandRecall?: number;
  /** Weighted heaviest — fraction of dictation/negatives that wrongly fired a command. */
  falseAcceptRate?: number;
  wer?: number;
  footprintMB?: number;
  notes?: string;
}

/** TTFP averaged over traces. */
export function ttfpFromTraces(traces: readonly UtteranceTrace[]): number | undefined {
  const ttfp = traces.map((t) => t.ttfp()).filter((x): x is number => x !== undefined);
  return ttfp.length ? round(mean(ttfp)) : undefined;
}

/** mouth-to-command percentile over a subset of traces (e.g. one cost tier). */
export function m2cPercentile(traces: readonly UtteranceTrace[], p: number): number | undefined {
  const m2c = traces.map((t) => t.mouthToCommand()).filter((x): x is number => x !== undefined);
  return m2c.length ? round(percentile(m2c, p)) : undefined;
}

/** Precision / recall / false-accept from command-detection counts. */
export function detectionMetrics(counts: {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  negativesTotal: number;
  falseAccepts: number; // negatives that wrongly fired
}): Pick<ScorecardRow, 'commandPrecision' | 'commandRecall' | 'falseAcceptRate'> {
  const { truePositives: tp, falsePositives: fp, falseNegatives: fn, negativesTotal, falseAccepts } = counts;
  const precision = tp + fp === 0 ? undefined : round(tp / (tp + fp), 3);
  const recall = tp + fn === 0 ? undefined : round(tp / (tp + fn), 3);
  const far = negativesTotal === 0 ? undefined : round(falseAccepts / negativesTotal, 3);
  return { commandPrecision: precision, commandRecall: recall, falseAcceptRate: far };
}

const COLUMNS: ReadonlyArray<{ key: keyof ScorecardRow; label: string }> = [
  { key: 'engine', label: 'engine' },
  { key: 'ttfpMs', label: 'TTFP(ms)' },
  { key: 'm2cNavP50', label: 'nav p50' },
  { key: 'm2cNavP95', label: 'nav p95' },
  { key: 'm2cDestP50', label: 'dest p50' },
  { key: 'commandPrecision', label: 'prec' },
  { key: 'commandRecall', label: 'recall' },
  { key: 'falseAcceptRate', label: 'FAR†' },
  { key: 'wer', label: 'WER' },
  { key: 'footprintMB', label: 'MB' },
];

function cell(row: ScorecardRow, key: keyof ScorecardRow): string {
  const v = row[key];
  if (v === undefined) return '–';
  if (key === 'engine') return `${v}${row.placeholder ? ' *PH' : ''}`;
  return String(v);
}

/** Render rows as a monospaced table. FAR† = false-accept rate (weighted heaviest). */
export function formatScorecard(rows: readonly ScorecardRow[]): string {
  const widths = COLUMNS.map((c) =>
    Math.max(c.label.length, ...rows.map((r) => cell(r, c.key).length)),
  );
  const pad = (s: string, w: number) => s.padEnd(w);
  const header = COLUMNS.map((c, i) => pad(c.label, widths[i]!)).join('  ');
  const sep = widths.map((w) => '-'.repeat(w)).join('  ');
  const body = rows
    .map((r) => COLUMNS.map((c, i) => pad(cell(r, c.key), widths[i]!)).join('  '))
    .join('\n');
  const notes = rows.filter((r) => r.notes).map((r) => `  - ${r.engine}: ${r.notes}`);
  const legend =
    '\n*PH = placeholder (literature number, not measured here). FAR† weighted heaviest.' +
    '\nnav = fire-on-partial (no endpoint wait); dest = endpointed/destructive (pays the endpoint floor, F1/F2).' +
    '\nprec/recall/FAR† come from the STUB substring matcher (src/decoder/l1.ts), not the engine — ' +
    'they are IDENTICAL across engines by construction and measure the stub, not detection quality.';
  return [header, sep, body, notes.length ? '\nNotes:\n' + notes.join('\n') : '', legend].join('\n');
}
