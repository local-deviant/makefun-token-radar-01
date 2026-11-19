// Validation for token-radar-01 v2: leave-one-out, time split, walk-forward,
// Spearman rank correlation and a bootstrap of the top 10. The model itself
// lives in lib/model.ts; this file only measures it. Usable two ways:
//   - as a library: validateAll(snapshot) returns the numbers (main.ts embeds
//     them in the dashboard data, so the page states measured numbers);
//   - as a script: node lib/validate.ts [snapshot.json] prints the JSON.

import {
  loadSnapshot,
  selectComps,
  fitCurve,
  impliedValue,
  looLogErrors,
  errorFactors,
  logSd,
  ageDays,
  isPreTokenCandidate,
  type Snapshot,
  type Protocol,
  type Curve,
} from './model.ts';

export interface Validation {
  as_of: string;
  n_comps: number;
  n_dated_comps: number;
  beta: number[];
  loo: { median: number; geo: number; spearman: number };
  time_split: { cut: string; train: number; test: number; median: number; geo: number };
  walk_forward: { folds: number[]; pooled_median: number; pooled_geo: number };
  baselines: { median_multiple_loo_median: number; tvl_only_loo_median: number };
  band: { factor: number; coverage_1sd: number };
  bootstrap: { draws: number; seed: number; top10_kept_mean: number; rank1_kept_pct: number };
  age_missing_comps: number;
}

function spearman(xs: number[], ys: number[]): number {
  const rank = (arr: number[]): number[] => {
    const idx = arr.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(arr.length);
    idx.forEach(([_, i], pos) => {
      r[i] = pos + 1;
    });
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / rx.length;
  const my = ry.reduce((a, b) => a + b, 0) / ry.length;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 === 1 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

// A seeded PRNG (mulberry32) so the bootstrap is deterministic.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function validateAll(snap: Snapshot): Validation {
  const asOf = new Date(`${snap.as_of}T00:00:00Z`);
  const comps = selectComps(snap.protocols);
  const curve: Curve = fitCurve(comps, asOf);

  // ---- leave-one-out
  const looErrs = looLogErrors(comps, asOf);
  const loo = errorFactors(looErrs);
  const band = Math.exp(logSd(looErrs));
  const looPredValues: number[] = [];
  for (const p of comps) {
    const train = comps.filter((q) => q !== p);
    const c = fitCurve(train, asOf);
    looPredValues.push(impliedValue(p, c, asOf));
  }
  const spear = spearman(looPredValues, comps.map((p) => p.mcap_usd as number));

  // ---- time split (cut 2024-02-06, dated comps only)
  const dated = comps.filter((p) => p.listed_at).sort((a, b) => (a.listed_at as string).localeCompare(b.listed_at as string));
  const cut = '2024-02-06';
  const tsTrain = dated.filter((p) => (p.listed_at as string) < cut);
  const tsTest = dated.filter((p) => (p.listed_at as string) >= cut);
  const tsErrs = tsTest.map((p) => {
    const c = fitCurve(tsTrain, asOf);
    return Math.log(impliedValue(p, c, asOf)) - Math.log(p.mcap_usd as number);
  });
  const ts = errorFactors(tsErrs);

  // ---- walk-forward: initial train earliest 20 dated, folds test next 21/20/21
  const foldSizes = [21, 20, 21];
  const foldMeds: number[] = [];
  const wfErrs: number[] = [];
  {
    let start = 20;
    for (const n of foldSizes) {
      const test = dated.slice(start, start + n);
      const train = dated.slice(0, start);
      const c = fitCurve(train, asOf);
      const errs = test.map((p) => Math.log(impliedValue(p, c, asOf)) - Math.log(p.mcap_usd as number));
      foldMeds.push(errorFactors(errs).median);
      wfErrs.push(...errs);
      start += n;
    }
  }
  const wf = errorFactors(wfErrs);

  // ---- baselines (LOO): median-multiple and TVL-only
  function baselineLoo(kind: 'median-multiple' | 'tvl-only'): { median: number; geo: number } {
    const errs: number[] = [];
    for (let h = 0; h < comps.length; h++) {
      const train = comps.filter((_, i) => i !== h);
      let pred: number;
      if (kind === 'tvl-only') {
        pred = comps[h].tvl_usd;
      } else {
        const mults = train.map((p) => (p.mcap_usd as number) / p.tvl_usd).sort((a, b) => a - b);
        pred = comps[h].tvl_usd * medianOf(mults);
      }
      errs.push(Math.log(pred) - Math.log(comps[h].mcap_usd as number));
    }
    return errorFactors(errs);
  }
  const baseMedian = baselineLoo('median-multiple');
  const baseTvl = baselineLoo('tvl-only');

  // ---- bootstrap: 200 draws, seed 20261114; top-10 overlap with the full-fit board
  const rng = mulberry32(20261114);
  const candidates = snap.protocols.filter((p) => isPreTokenCandidate(p));
  const fullBoard = (() => {
    const scored = candidates.map((p) => ({ slug: p.slug, v: impliedValue(p, curve, asOf) }));
    scored.sort((a, b) => b.v - a.v);
    return scored.slice(0, 10).map((s) => s.slug);
  })();
  let top10Kept = 0;
  let rank1Kept = 0;
  const DRAWS = 200;
  for (let d = 0; d < DRAWS; d++) {
    const sample: Protocol[] = [];
    for (let i = 0; i < comps.length; i++) sample.push(comps[Math.floor(rng() * comps.length)]);
    const c = fitCurve(sample, asOf);
    const scored = candidates.map((p) => ({ slug: p.slug, v: impliedValue(p, c, asOf) }));
    scored.sort((a, b) => b.v - a.v);
    const top = scored.slice(0, 10).map((s) => s.slug);
    top10Kept += top.filter((s) => fullBoard.includes(s)).length;
    if (top[0] === fullBoard[0]) rank1Kept++;
  }

  // ---- band coverage: share of LOO errors within +-1 sd
  const within = looErrs.filter((e) => Math.abs(e) <= logSd(looErrs)).length / looErrs.length;

  return {
    as_of: snap.as_of,
    n_comps: comps.length,
    n_dated_comps: dated.length,
    beta: curve.beta.map((b) => Number(b.toFixed(4))),
    loo: { median: Number(loo.median.toFixed(2)), geo: Number(loo.geo.toFixed(2)), spearman: Number(spear.toFixed(3)) },
    time_split: { cut, train: tsTrain.length, test: tsTest.length, median: Number(ts.median.toFixed(2)), geo: Number(ts.geo.toFixed(2)) },
    walk_forward: { folds: foldMeds.map((f) => Number(f.toFixed(2))), pooled_median: Number(wf.median.toFixed(2)), pooled_geo: Number(wf.geo.toFixed(2)) },
    baselines: {
      median_multiple_loo_median: Number(baseMedian.median.toFixed(2)),
      tvl_only_loo_median: Number(baseTvl.median.toFixed(2)),
    },
    band: { factor: Number(band.toFixed(2)), coverage_1sd: Number(within.toFixed(3)) },
    bootstrap: { draws: DRAWS, seed: 20261114, top10_kept_mean: Number((top10Kept / DRAWS).toFixed(2)), rank1_kept_pct: Number(((rank1Kept / DRAWS) * 100).toFixed(1)) },
    age_missing_comps: comps.filter((p) => ageDays(p, asOf) === null).length,
  };
}

// Run as a script: node lib/validate.ts [snapshot.json]
const isMain = process.argv[1]?.endsWith('validate.ts') ?? false;
if (isMain) {
  const snapPath = process.argv[2] ?? '/home/hatch/workspace/makefun/kits/token-radar-01-kit/token-radar-01-kit/input/snapshot.json';
  const snap = loadSnapshot(snapPath);
  console.log(JSON.stringify(validateAll(snap), null, 2));
}
