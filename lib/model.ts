/**
 * The value model. It answers one question from the snapshot's own figures:
 * if a protocol's record stayed as it is, what would its token be worth?
 *
 * The comparables are the tokens that already trade: one protocol per
 * token id (the greatest-TVL one), with a positive market cap whose
 * multiple of TVL sits in [0.02, 20] — the extremes outside that band are
 * tokens whose market cap has nothing to do with the protocol's TVL any
 * more. On those comps we fit, by ordinary least squares,
 *
 *   ln(mcap) = a + b * ln(TVL) + c * ln(age_days),
 *
 * then a per-category offset, each category's mean residual shrunk by
 * n / (n + 8) pseudo-observations, so a category with two comps barely
 * moves the curve and one with twenty moves it most of the way. The
 * fitted multiple is clamped to [0.08, 1.20]: no protocol's token is
 * worth less than eight cents per dollar of TVL, nor more than $1.20.
 * The implied value multiplies the TVL by that multiple, by a growth
 * factor from the seven-day TVL change, and by a stated 0.80 pre-token
 * discount — a haircut we state, not a number the data fits, because the
 * snapshot holds no launched pre-token token to fit it against.
 */
import { dot, ols } from './fit.ts';
import { ageDays } from './snapshot.ts';
import type { FittedModel, Protocol, Snapshot } from './types.ts';

/** The age a protocol with no tracked start is given, in days. */
export const AGE_FALLBACK_DAYS = 365;
/** The youngest age the fit ever sees, in days. */
export const AGE_MIN_DAYS = 30;
/** The comparables' multiple band. */
export const COMP_MULTIPLE_LOW = 0.02;
export const COMP_MULTIPLE_HIGH = 20;
/** The fitted multiple's clamp. */
export const MULTIPLE_LOW = 0.08;
export const MULTIPLE_HIGH = 1.2;
/** The stated pre-token discount (a haircut, not a fit). */
export const PRE_TOKEN_DISCOUNT = 0.8;
/** The growth factor's clamps (per cent) and weight. */
export const GROWTH_LOW = -60;
export const GROWTH_HIGH = 120;
export const GROWTH_WEIGHT = 0.6;
/** The category offset's pseudo-observation count. */
export const CATEGORY_SHRINK = 8;

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** The comparables: one protocol per token id, greatest TVL first. */
export function selectComps(snap: Snapshot): Protocol[] {
  const best = new Map<string, Protocol>();
  for (const p of snap.protocols) {
    if (!p.mcap_usd || p.mcap_usd <= 0) continue;
    const key = p.gecko_id ?? p.symbol ?? p.slug;
    const cur = best.get(key);
    if (!cur || p.tvl_usd > cur.tvl_usd) best.set(key, p);
  }
  return [...best.values()].filter((p) => {
    const r = p.mcap_usd! / p.tvl_usd;
    return r >= COMP_MULTIPLE_LOW && r <= COMP_MULTIPLE_HIGH;
  });
}

function designRow(p: Protocol, asOf: string): number[] {
  return [Math.log(p.tvl_usd), Math.log(ageDays(p, asOf, AGE_FALLBACK_DAYS)), 1];
}

export interface FitResult {
  intercept: number;
  tvlSlope: number;
  ageSlope: number;
  offsets: Record<string, number>;
}

/** Fit the curve on a set of comparables. Pure: the same input always
 * gives the same output, which is what makes the entry deterministic. */
export function fitCurve(comps: Protocol[], asOf: string): FitResult {
  const X = comps.map((p) => designRow(p, asOf));
  const y = comps.map((p) => Math.log(p.mcap_usd!));
  const w = ols(X, y);
  const residuals = new Map<string, number[]>();
  for (let i = 0; i < comps.length; i++) {
    const cat = comps[i].category ?? 'Unknown';
    const list = residuals.get(cat) ?? [];
    list.push(y[i] - dot(w, X[i]));
    residuals.set(cat, list);
  }
  const offsets: Record<string, number> = {};
  for (const [cat, list] of residuals) {
    const m = list.reduce((a, b) => a + b, 0) / list.length;
    offsets[cat] = (m * list.length) / (list.length + CATEGORY_SHRINK);
  }
  return { intercept: w[2], tvlSlope: w[0], ageSlope: w[1], offsets };
}

/** The log market cap the curve predicts for a protocol. */
export function predictLogMcap(fit: FitResult, p: Protocol, asOf: string): number {
  const cat = p.category ?? 'Unknown';
  return (
    fit.intercept +
    fit.tvlSlope * Math.log(p.tvl_usd) +
    fit.ageSlope * Math.log(ageDays(p, asOf, AGE_FALLBACK_DAYS)) +
    (fit.offsets[cat] ?? 0)
  );
}

/** The fitted multiple of TVL, clamped to the stated band. */
export function fittedMultiple(fit: FitResult, p: Protocol, asOf: string): number {
  return clamp(Math.exp(predictLogMcap(fit, p, asOf)) / p.tvl_usd, MULTIPLE_LOW, MULTIPLE_HIGH);
}

/** The growth factor from the seven-day TVL change, in per cent. */
export function growthFactor(change7d: number | null): number {
  const g = change7d === null ? 0 : clamp(change7d, GROWTH_LOW, GROWTH_HIGH) / 100;
  return 1 + g * GROWTH_WEIGHT;
}

/** The implied launch value of a protocol's token, in whole dollars. */
export function impliedValue(fit: FitResult, p: Protocol, asOf: string, discount: number): number {
  const value =
    p.tvl_usd * fittedMultiple(fit, p, asOf) * growthFactor(p.change_7d) * discount;
  return Math.max(1, Math.round(value));
}

/** Fit the model on the snapshot's comparables, with a band the caller
 * supplies (the validation suite's leave-one-out residual spread). */
export function fitModel(snap: Snapshot, band: number): { fit: FitResult; model: FittedModel } {
  const comps = selectComps(snap);
  const fit = fitCurve(comps, snap.as_of);
  const model: FittedModel = {
    intercept: fit.intercept,
    tvlSlope: fit.tvlSlope,
    ageSlope: fit.ageSlope,
    categoryOffsets: fit.offsets,
    compCount: comps.length,
    multipleLow: MULTIPLE_LOW,
    multipleHigh: MULTIPLE_HIGH,
    discount: PRE_TOKEN_DISCOUNT,
    band,
    growthCapLow: GROWTH_LOW,
    growthCapHigh: GROWTH_HIGH,
    growthWeight: GROWTH_WEIGHT,
  };
  return { fit, model };
}
