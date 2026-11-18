/**
 * Building the board: every rankable pre-token protocol, ranked by the
 * implied value the model gives it, with a farm plan each and a readiness
 * score that says how close a launch looks (display only — the rank
 * always follows the implied value).
 */
import { ageDays, isRankable } from './snapshot.ts';
import { clamp, fittedMultiple, growthFactor, impliedValue } from './model.ts';
import { buildFarmPlan, farmStepTexts } from './farm.ts';
import type { BoardData, BoardRow, FittedModel, Snapshot } from './types.ts';

/** The readiness score, 0 to 100, display only: 40% age (a long record
 * with no token reads as a launch getting closer), 30% growth (a TVL
 * that is rising reads as momentum), 30% size (a larger protocol reads
 * as more able to launch). Each leg is scaled to 0-100 on its own. */
export function readinessScore(tvlUsd: number, change7d: number | null, age: number): number {
  const ageLeg = clamp(Math.log(Math.max(age, 30) / 30) / Math.log(1825 / 30), 0, 1);
  const growthLeg = clamp(((change7d ?? 0) + 40) / 65, 0, 1);
  const sizeLeg = clamp((Math.log(Math.max(tvlUsd, 1)) - Math.log(5_000_000)) / (Math.log(10_000_000_000) - Math.log(5_000_000)), 0, 1);
  return Math.round(100 * (0.4 * ageLeg + 0.3 * growthLeg + 0.3 * sizeLeg));
}

export function buildBoard(
  snap: Snapshot,
  model: FittedModel,
  band: number,
  validation: import('./types.js').Validation,
): BoardData {
  const asOf = snap.as_of;
  const watchlist = new Set(snap.watchlist);
  const live = snap.protocols.filter((p) => p.mcap_usd !== null).length;
  const preToken = snap.protocols.filter((p) => p.gecko_id === null && p.symbol === null).length;

  const rankable = snap.protocols.filter(isRankable);
  const rows: BoardRow[] = rankable.map((p) => {
    const age = ageDays(p, asOf, 365);
    const multiple = fittedMultiple(
      { intercept: model.intercept, tvlSlope: model.tvlSlope, ageSlope: model.ageSlope, offsets: model.categoryOffsets },
      p,
      asOf,
    );
    const implied = impliedValue(
      { intercept: model.intercept, tvlSlope: model.tvlSlope, ageSlope: model.ageSlope, offsets: model.categoryOffsets },
      p,
      asOf,
      model.discount,
    );
    const farm = buildFarmPlan(p, implied, band, age);
    return {
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Unknown',
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: age,
      age_known: p.listed_at !== null,
      rank: 0,
      implied_value_usd: implied,
      multiple,
      growth: growthFactor(p.change_7d),
      readiness: readinessScore(p.tvl_usd, p.change_7d, age),
      watchlist: watchlist.has(p.slug),
      farm,
      farm_steps: farmStepTexts(farm),
    };
  });

  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
  // Ranks are exactly 1..N, and the implied values do not rise with rank:
  // the sort above is total (slug breaks a dollar tie), so the order holds.
  for (let i = 0; i < rows.length; i++) rows[i].rank = i + 1;

  const categories: { name: string; comps: number; offset: number; multiple: number }[] = [];
  const byCat = new Map<string, { comps: number; sum: number }>();
  for (const p of snap.protocols) {
    if (!p.mcap_usd || p.mcap_usd <= 0) continue;
    const r = p.mcap_usd / p.tvl_usd;
    if (r < 0.02 || r > 20) continue;
    const key = p.category ?? 'Unknown';
    const cur = byCat.get(key) ?? { comps: 0, sum: 0 };
    cur.comps += 1;
    cur.sum += Math.log(r);
    byCat.set(key, cur);
  }
  for (const [name, v] of [...byCat.entries()].sort((a, b) => b[1].comps - a[1].comps)) {
    categories.push({
      name,
      comps: v.comps,
      offset: model.categoryOffsets[name] ?? 0,
      multiple: Math.exp(v.sum / v.comps),
    });
  }

  return {
    rows,
    model,
    validation,
    counts: {
      protocols: snap.protocols.length,
      live,
      preToken,
      rankable: rows.length,
      watchlist: snap.watchlist.length,
      farm: rows.filter((r) => r.farm.verdict === 'FARM').length,
      thin: rows.filter((r) => r.farm.verdict === 'THIN').length,
      skip: rows.filter((r) => r.farm.verdict === 'SKIP').length,
    },
    categories,
    asOf: snap.as_of,
    floorUsd: snap.floor_usd,
  };
}
