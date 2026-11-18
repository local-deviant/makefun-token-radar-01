/**
 * Out-of-sample validation, computed at build time from the snapshot
 * alone. Nothing here reads the future: every check fits on one part of
 * the comparables and scores on another part it never saw.
 *
 * The headline number is the geometric error factor: exp(median |log
 * error|), so x2.63 means the typical prediction lands within a factor
 * of 2.63 of the truth either way. The checks:
 *
 *   leave-one-out   fit on 108 comps, score the one left out, all 109
 *   time split      fit on protocols tracked before 2024-02-06, score
 *                   the ones tracked after it (42 train / 40 test on the
 *                   dated comps; undated comps sit out this check)
 *   walk-forward    expanding windows at three cuts, pooled over the
 *                   held-out comps
 *   bootstrap       200 resamples of the comps, seed fixed: how often
 *                   the full-fit top 10 keeps its members, and rank 1
 *                   stays rank 1
 *   baselines       the median-multiple rule and the TVL-only rule, on
 *                   the same leave-one-out protocol, so the fit's gain
 *                   over doing nothing clever is visible
 *
 * The farm band is the leave-one-out residual spread: exp(one standard
 * deviation of the log errors), with the share of held-out errors inside
 * it reported as its coverage.
 */
import { fitCurve, fittedMultiple, growthFactor, PRE_TOKEN_DISCOUNT } from './model.ts';
import { ageDays } from './snapshot.ts';
import { mean, median, mulberry32, quantile, spearman, stddev } from './fit.ts';
import type { Protocol, Snapshot, Validation } from './types.ts';

/** The comparables, as the model selects them. */
export function compsOf(snap: Snapshot): Protocol[] {
  const best = new Map<string, Protocol>();
  for (const p of snap.protocols) {
    if (!p.mcap_usd || p.mcap_usd <= 0) continue;
    const key = p.gecko_id ?? p.symbol ?? p.slug;
    const cur = best.get(key);
    if (!cur || p.tvl_usd > cur.tvl_usd) best.set(key, p);
  }
  return [...best.values()].filter((p) => {
    const r = p.mcap_usd! / p.tvl_usd;
    return r >= 0.02 && r <= 20;
  });
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** The full pipeline's prediction for one protocol, given a fit: the
 * clamped multiple, the growth factor and the pre-token discount. */
function pipelineLogValue(
  fit: ReturnType<typeof fitCurve>,
  p: Protocol,
  asOf: string,
): number {
  const mult = fittedMultiple(fit, p, asOf);
  return Math.log(p.tvl_usd * mult * growthFactor(p.change_7d) * PRE_TOKEN_DISCOUNT);
}

function geoMedian(errs: number[]): number {
  return Math.exp(median(errs.map((e) => Math.abs(e))));
}

function geoMean(errs: number[]): number {
  return Math.exp(mean(errs.map((e) => Math.abs(e))));
}

/** Leave-one-out over the comparables, curve alone and full pipeline. */
function leaveOneOut(comps: Protocol[], asOf: string): { curve: number[]; full: number[] } {
  const curve: number[] = [];
  const full: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const fit = fitCurve(train, asOf);
    const held = comps[i];
    const truth = Math.log(held.mcap_usd!);
    const predCurve =
      fit.intercept +
      fit.tvlSlope * Math.log(held.tvl_usd) +
      fit.ageSlope * Math.log(ageDays(held, asOf, 365)) +
      (fit.offsets[held.category ?? 'Unknown'] ?? 0);
    curve.push(truth - predCurve);
    full.push(truth - pipelineLogValue(fit, held, asOf));
  }
  return { curve, full };
}

/** Time split at a listed_at cut: fit before it, score on or after it. */
function timeSplit(comps: Protocol[], asOf: string, cut: string): { errs: number[]; train: number; test: number } {
  const train = comps.filter((p) => p.listed_at !== null && p.listed_at < cut);
  const test = comps.filter((p) => p.listed_at !== null && p.listed_at >= cut);
  const fit = fitCurve(train, asOf);
  const errs = test.map((p) => Math.log(p.mcap_usd!) - pipelineLogValue(fit, p, asOf));
  return { errs, train: train.length, test: test.length };
}

/** Walk-forward: expanding windows at three cuts, with disjoint test
 * folds — each fold scores only the comparables first tracked between
 * its cut and the next cut, so no held-out comparable is counted twice. */
function walkForward(
  comps: Protocol[],
  asOf: string,
  cuts: string[],
): { perCut: { cut: string; geo: number; n: number }[]; pooledGeo: number; pooledN: number } {
  const perCut: { cut: string; geo: number; n: number }[] = [];
  const pooled: number[] = [];
  for (let c = 0; c < cuts.length; c++) {
    const cut = cuts[c];
    const next = c + 1 < cuts.length ? cuts[c + 1] : null;
    const train = comps.filter((p) => p.listed_at !== null && p.listed_at < cut);
    const test = comps.filter(
      (p) => p.listed_at !== null && p.listed_at >= cut && (next === null || p.listed_at < next),
    );
    if (train.length < 10 || test.length === 0) continue;
    const fit = fitCurve(train, asOf);
    const errs = test.map((p) => Math.log(p.mcap_usd!) - pipelineLogValue(fit, p, asOf));
    perCut.push({ cut, geo: geoMedian(errs), n: test.length });
    pooled.push(...errs);
  }
  return { perCut, pooledGeo: geoMedian(pooled), pooledN: pooled.length };
}

/** Bootstrap stability of the full fit's top 10, 200 resamples. */
function bootstrap(
  comps: Protocol[],
  snap: Snapshot,
  asOf: string,
  draws: number,
  seed: number,
): { top10: number; rank1: number } {
  const full = fitCurve(comps, asOf);
  const rankable = snap.protocols.filter(
    (p) => p.gecko_id === null && p.symbol === null,
  );
  const score = (p: Protocol): number =>
    p.tvl_usd * fittedMultiple(full, p, asOf) * growthFactor(p.change_7d) * PRE_TOKEN_DISCOUNT;
  const top = [...rankable].sort((a, b) => score(b) - score(a)).slice(0, 10);
  const topSlugs = new Set(top.map((p) => p.slug));
  const rank1 = top[0].slug;
  const rng = mulberry32(seed);
  let kept = 0;
  let first = 0;
  for (let d = 0; d < draws; d++) {
    const sample: Protocol[] = [];
    for (let i = 0; i < comps.length; i++) {
      sample.push(comps[Math.floor(rng() * comps.length)]);
    }
    const fit = fitCurve(sample, asOf);
    const s = (p: Protocol): number =>
      p.tvl_usd * fittedMultiple(fit, p, asOf) * growthFactor(p.change_7d) * PRE_TOKEN_DISCOUNT;
    const resampledTop = [...rankable].sort((a, b) => s(b) - s(a)).slice(0, 10);
    kept += resampledTop.filter((p) => topSlugs.has(p.slug)).length;
    if (resampledTop[0].slug === rank1) first++;
  }
  return { top10: kept / draws, rank1: first / draws };
}

export function validateModel(snap: Snapshot): Validation {
  const asOf = snap.as_of;
  const comps = compsOf(snap);
  const loo = leaveOneOut(comps, asOf);
  const split = timeSplit(comps, asOf, '2024-02-06');
  const wf = walkForward(comps, asOf, ['2022-11-28', '2024-02-06', '2025-04-02']);
  const boot = bootstrap(comps, snap, asOf, 200, 20261114);

  const sortedAbs = [...loo.full].map((e) => Math.abs(e)).sort((a, b) => a - b);
  const band = Math.exp(stddev(loo.full));
  const coverage = loo.full.filter((e) => Math.abs(e) <= Math.log(band)).length / loo.full.length;
  const band90 = Math.exp(quantile(sortedAbs, 0.9));

  const medianMultiple = (() => {
    const errs: number[] = [];
    for (let i = 0; i < comps.length; i++) {
      const train = comps.filter((_, j) => j !== i);
      const med = median(train.map((p) => Math.log(p.mcap_usd! / p.tvl_usd)));
      errs.push(Math.log(comps[i].mcap_usd!) - (Math.log(comps[i].tvl_usd) + med));
    }
    return geoMedian(errs);
  })();
  const tvlOnly = geoMedian(comps.map((p) => Math.log(p.mcap_usd! / p.tvl_usd)));

  const looPred = comps.map((p, i) => {
    const train = comps.filter((_, j) => j !== i);
    const fit = fitCurve(train, asOf);
    return pipelineLogValue(fit, p, asOf);
  });
  const looSpearman = spearman(
    looPred,
    comps.map((p) => Math.log(p.mcap_usd!)),
  );

  return {
    looGeo: geoMean(loo.curve),
    looMedian: geoMedian(loo.curve),
    looSpearman,
    looFullGeo: geoMedian(loo.full),
    timeSplitGeo: geoMedian(split.errs),
    timeSplitCut: '2024-02-06',
    timeSplitTrain: split.train,
    timeSplitTest: split.test,
    walkForward: wf.perCut,
    walkForwardPooled: wf.pooledGeo,
    walkForwardN: wf.pooledN,
    bootstrapTop10: boot.top10,
    bootstrapRank1: boot.rank1,
    medianMultipleGeo: medianMultiple,
    tvlOnlyGeo: tvlOnly,
    band,
    bandCoverage: coverage,
    band90,
  };
}
