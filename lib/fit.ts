/**
 * Small linear algebra for the fit: ordinary least squares by Gaussian
 * elimination with partial pivoting, plus the summary statistics the
 * validation suite reports. Standard library only, no dependencies.
 */

/** Solve A x = b for a small dense square A. Returns zeros for a singular
 * direction rather than throwing, so a degenerate design degrades instead
 * of crashing the run. */
export function solveLinear(A: number[][], b: number[]): number[] {
  const n = A.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (pivot !== col) {
      const tmp = m[col];
      m[col] = m[pivot];
      m[pivot] = tmp;
    }
    const pv = m[col][col];
    if (Math.abs(pv) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === col || m[r][col] === 0) continue;
      const f = m[r][col] / pv;
      for (let k = col; k <= n; k++) m[r][k] -= f * m[col][k];
    }
  }
  return m.map((row, i) => (Math.abs(row[i]) > 1e-12 ? row[n] / row[i] : 0));
}

/** Ordinary least squares: weights w solving min ||X w - y||^2. */
export function ols(X: number[][], y: number[]): number[] {
  const d = X[0].length;
  const A: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));
  const b: number[] = new Array(d).fill(0);
  for (let k = 0; k < X.length; k++) {
    for (let i = 0; i < d; i++) {
      b[i] += X[k][i] * y[k];
      for (let j = 0; j < d; j++) A[i][j] += X[k][i] * X[k][j];
    }
  }
  return solveLinear(A, b);
}

export function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

export function stddev(xs: number[]): number {
  const mu = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - mu) * (x - mu), 0) / xs.length);
}

/** Quantile of a sorted ascending array, linear interpolation. */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Spearman rank correlation between two equal-length arrays. */
export function spearman(a: number[], b: number[]): number {
  const rank = (v: number[]): number[] => {
    const order = v.map((_, i) => i).sort((i, j) => v[i] - v[j]);
    const r = new Array<number>(v.length);
    for (let pos = 0; pos < order.length; pos++) r[order[pos]] = pos;
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) * (ra[i] - ma);
    db += (rb[i] - mb) * (rb[i] - mb);
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

/** A seeded PRNG (mulberry32) so the bootstrap is deterministic. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
