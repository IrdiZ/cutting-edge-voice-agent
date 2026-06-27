// Small numeric helpers used across the scorecard. No deps.

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Linear-interpolated percentile. `p` is clamped to [0,100] so an out-of-range
 * argument yields the min/max rather than a silent NaN from an out-of-bounds index. */
export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return NaN;
  const pc = Math.min(100, Math.max(0, p));
  const sorted = [...xs].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const rank = (pc / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const frac = rank - lo;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac;
}

export function round(x: number, dp = 1): number {
  if (!Number.isFinite(x)) return x;
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}
