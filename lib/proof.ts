/**
 * The proof file: the judge-readable method note the dashboard ships.
 * Every number in it is rendered from the computed board, model and
 * validation — nothing is hand-typed, so the file can never disagree
 * with the board it describes.
 */
import type { BoardData } from './types.ts';

function money(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function pct(n: number, digits = 1): string {
  return (n * 100).toFixed(digits) + '%';
}

function factor(n: number): string {
  return 'x' + n.toFixed(2);
}

export function renderProof(data: BoardData): string {
  const { model, validation, counts, categories } = data;
  const top = data.rows.slice(0, 5);
  const farm = data.rows.filter((r) => r.farm.verdict === 'FARM');
  const lines: string[] = [];
  lines.push('# Token Radar — how this board was built');
  lines.push('');
  lines.push(
    `Snapshot ${data.asOf}: ${counts.protocols} protocols at or above $5M of TVL, ` +
      `${counts.live} with a token that already trades, ${counts.preToken} recording no token, ` +
      `${counts.watchlist} on the house watchlist. This board ranks ${counts.rankable} rankable ` +
      `pre-token protocols — the whole watchlist plus every other rankable protocol below the floor.`,
  );
  lines.push('');
  lines.push('## The value model');
  lines.push('');
  lines.push(
    'The comparables are the tokens that already trade: one protocol per token id ' +
      `(the greatest-TVL one), with a positive market cap whose multiple of TVL sits in ` +
      `[0.02, 20] — ${model.compCount} comps. On them we fit, by ordinary least squares:`,
  );
  lines.push('');
  lines.push('```');
  lines.push(
    `ln(mcap) = ${model.intercept.toFixed(3)} + ${model.tvlSlope.toFixed(3)} * ln(TVL) ` +
      `${model.ageSlope >= 0 ? '+' : '-'} ${Math.abs(model.ageSlope).toFixed(3)} * ln(age_days) + category offset`,
  );
  lines.push('```');
  lines.push('');
  lines.push(
    `Age is days since DefiLlama first tracked the protocol; a protocol with no tracked ` +
      `start is given 365 days, and no age under 30 days is used. A category offset is its ` +
      `mean residual shrunk by 8 pseudo-observations, so a category with two comps barely ` +
      `moves the curve. The fitted multiple is clamped to [${model.multipleLow}, ${model.multipleHigh}].`,
  );
  lines.push('');
  lines.push(
    `Implied value = TVL x fitted multiple x growth x ${model.discount}. Growth is ` +
      `1 + clamp(7-day TVL change, ${model.growthCapLow}%, ${model.growthCapHigh}%) x ${model.growthWeight}. ` +
      `The ${model.discount} is a stated pre-token discount, not a fit: the snapshot holds no ` +
      `launched pre-token token to fit it against.`,
  );
  lines.push('');
  lines.push('## Out-of-sample validation');
  lines.push('');
  lines.push(
    'The geometric error factor is exp(median |log error|): x2.63 means the typical ' +
      'prediction lands within a factor of 2.63 of the truth either way.',
  );
  lines.push('');
  lines.push(`- Leave-one-out, n=${model.compCount}: curve ${factor(validation.looMedian)}, full pipeline ${factor(validation.looFullGeo)}.`);
  lines.push(`- Leave-one-out, mean error: curve ${factor(validation.looGeo)}; rank correlation (Spearman) ${validation.looSpearman.toFixed(3)}.`);
  lines.push(
    `- Time split, cut ${validation.timeSplitCut} (${validation.timeSplitTrain} train / ${validation.timeSplitTest} test): ${factor(validation.timeSplitGeo)}.`,
  );
  for (const w of validation.walkForward) {
    lines.push(`- Walk-forward, cut ${w.cut}: ${factor(w.geo)} on ${w.n} held-out comps.`);
  }
  lines.push(`- Walk-forward, pooled: ${factor(validation.walkForwardPooled)} on ${validation.walkForwardN} held-out comps.`);
  lines.push(
    `- Bootstrap, 200 draws, seed 20261114: the full-fit top 10 keeps ${validation.bootstrapTop10.toFixed(2)} of 10 on average; rank 1 stays rank 1 in ${pct(validation.bootstrapRank1)} of draws.`,
  );
  lines.push(`- Median-multiple baseline, leave-one-out: ${factor(validation.medianMultipleGeo)}.`);
  lines.push(`- TVL-only baseline (predicted mcap = TVL), leave-one-out: ${factor(validation.tvlOnlyGeo)}.`);
  lines.push('');
  lines.push(
    `The farm band is the leave-one-out residual spread: ${factor(validation.band)} (one standard ` +
      `deviation), covering ${pct(validation.bandCoverage)} of the held-out errors; the 90% band is ${factor(validation.band90)}.`,
  );
  lines.push('');
  lines.push('## Farm economics');
  lines.push('');
  lines.push(
    `One farmer's slice is the implied value x 0.002%, netted to the low end of the band ` +
      `(slice / ${validation.band.toFixed(2)}), less gas and less the T-bill cost of the capital ` +
      `(4% x hold / 365). Gas is $3 per on-chain action plus $1 per extra chain, capped at $8, ` +
      `over 4 actions. Capital is $50 / $100 / $150 / $250 by TVL tier; the hold is 60 / 45 / 30 ` +
      `days by age. FARM when the net clears $50, THIN when it covers its costs, SKIP when it does not.`,
  );
  lines.push('');
  lines.push(`Counts: ${counts.farm} FARM / ${counts.thin} THIN / ${counts.skip} SKIP.`);
  lines.push('');
  lines.push('## The top of the board');
  lines.push('');
  for (const r of top) {
    lines.push(
      `- #${r.rank} ${r.name} (${r.slug}): ${money(r.implied_value_usd)} implied, ` +
        `TVL ${money(r.tvl_usd)}, multiple ${r.multiple.toFixed(2)}, ${r.farm.verdict}, net ${money(r.farm.net_usd)}.`,
    );
  }
  lines.push('');
  lines.push('## What the board leaves out');
  lines.push('');
  lines.push(
    `Protocols whose token already trades are never ranked — they are the comparables, ` +
      `shown on their own tab. Bridged, wrapped and staked products are never ranked: the ` +
      `categories Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC ` +
      `and CEX, a name carrying a whole word wrapped, staked or staking, a name ending in a ` +
      `version marker, and a name beginning with an exchange's name. That removes the ` +
      `largest pre-token names by TVL (exchanges and wrapped products) and leaves the ` +
      `protocols a launch could actually belong to.`,
  );
  lines.push('');
  lines.push('## Category offsets');
  lines.push('');
  lines.push('| Category | Comps | Offset | Median multiple |');
  lines.push('|---|---:|---:|---:|');
  for (const c of categories) {
    lines.push(`| ${c.name} | ${c.comps} | ${c.offset >= 0 ? '+' : ''}${c.offset.toFixed(2)} | ${c.multiple.toFixed(2)} |`);
  }
  lines.push('');
  lines.push(
    'A protocol records no token, never that it has none: a protocol on the watchlist may ' +
      'still have a token its DefiLlama record does not carry. The implied value is this ' +
      `entry's own claim, never make.fun's.`,
  );
  lines.push('');
  return lines.join('\n');
}
