/**
 * Farm economics. Every board row carries a six-step plan that nets one
 * active farmer's share to the dollar: the slice of the implied value,
 * taken at the low end of the model's error band, less the gas the steps
 * cost and less the T-bill cost of the capital while it sits.
 *
 *   slice = implied value x 0.002%   (one farmer's assumed share)
 *   net   = slice / band - gas - 4% x capital x hold / 365
 *
 * FARM when the net clears $50; THIN when it covers its costs but not
 * the hurdle; SKIP when it does not cover its costs. A SKIP plan says so
 * in its first step, so nobody reads six steps for a plan that loses
 * money. The $50 hurdle and the 0.002% share are stated assumptions,
 * not fits: the snapshot holds no farmer's payout to fit them against.
 */
import type { FarmPlan, Protocol, Verdict } from './types.ts';

/** One farmer's assumed share of the implied value. */
export const FARMER_SHARE = 0.00002;
/** The net a plan must clear to earn FARM. */
export const FARM_HURDLE_USD = 50;
/** The T-bill rate charged on the capital while it sits. */
export const TBILL_RATE = 0.04;

/** The capital a plan commits, by the protocol's TVL tier. */
export function capitalFor(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 250;
  if (tvlUsd >= 250_000_000) return 150;
  if (tvlUsd >= 50_000_000) return 100;
  return 50;
}

/** The hold window, in days, by the protocol's age: a younger protocol
 * needs a longer engagement to qualify, an older one a shorter one. */
export function holdDaysFor(ageDays: number): number {
  if (ageDays >= 730) return 30;
  if (ageDays >= 365) return 45;
  return 60;
}

/** The gas of one on-chain action, by how many chains the protocol runs
 * on: $3 on a single chain, $1 more per extra chain, capped at $8. */
export function gasPerAction(chainCount: number): number {
  return 3 + Math.min(Math.max(chainCount - 1, 0), 5);
}

/** The one core action a category's farm turns on, in plain words. */
export function coreAction(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('risk') || c.includes('curator')) return 'deposit into the curator vault';
  if (c.includes('allocator') || c.includes('capital alloc')) return 'allocate capital through the vault';
  if (c.includes('lend')) return 'supply assets to the lending market';
  if (c.includes('dex') || c.includes('swap') || c.includes('exchange')) return 'swap through the exchange';
  if (c.includes('yield') || c.includes('farm')) return 'deposit into the yield vault';
  if (c.includes('derivat')) return 'open a position on the derivatives market';
  if (c.includes('perpetual') || c.includes('perp')) return 'open a perpetual position';
  if (c.includes('basis')) return 'open a basis trade';
  if (c.includes('bridge')) return 'bridge assets through the protocol';
  if (c.includes('rwa') || c.includes('real world')) return 'hold the tokenised asset position';
  if (c.includes('cdp') || c.includes('stable')) return 'mint the stable asset against collateral';
  if (c.includes('liquid')) return 'stake through the liquid staking pool';
  if (c.includes('restak')) return 'restake through the protocol';
  if (c.includes('staking') || c.includes('stak')) return 'stake in the staking pool';
  if (c.includes('insur')) return 'buy cover from the insurance pool';
  if (c.includes('option') || c.includes('volat')) return 'trade the options vault';
  if (c.includes('predict')) return 'place a prediction on the market';
  if (c.includes('nft')) return 'list and trade through the NFT market';
  if (c.includes('gaming') || c.includes('game')) return 'play through the game contracts';
  if (c.includes('ai') || c.includes('compute')) return 'run a job on the compute market';
  if (c.includes('cedefi') || c.includes('cefi')) return 'deposit into the CeDeFi vault';
  if (c.includes('payment') || c.includes('card')) return 'spend through the payments card';
  if (c.includes('otc') || c.includes('marketplace')) return 'trade on the OTC desk';
  if (c.includes('govern') || c.includes('incentive')) return 'stake for governance incentives';
  if (c.includes('index')) return 'buy the index position';
  if (c.includes('collateral')) return 'post collateral to the market';
  if (c.includes('liquidity')) return 'provide liquidity to the pool';
  if (c.includes('chain')) return 'use the chain';
  if (c.includes('btc') || c.includes('bitcoin')) return 'hold the BTC position';
  return 'use the protocol';
}

/** The dollar figure a step's text prints, whole dollars, with commas. */
export function dollars(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

/** Build one protocol's farm plan. The band is the model's leave-one-out
 * error spread: the slice is netted to its low end, so a FARM verdict
 * survives the model being wrong by a standard error. */
export function buildFarmPlan(
  p: Protocol,
  impliedUsd: number,
  band: number,
  ageDays: number,
): FarmPlan {
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(ageDays);
  const gasUnit = gasPerAction(p.chains.length);
  const onChainActions = 4;
  const gas = gasUnit * onChainActions;
  const tbill = TBILL_RATE * capital * (hold / 365);
  const slice = impliedUsd * FARMER_SHARE;
  const net = slice / band - gas - tbill;
  const verdict: Verdict = net >= FARM_HURDLE_USD ? 'FARM' : net >= 0 ? 'THIN' : 'SKIP';

  const action = coreAction(p.category);
  const chainList = p.chains.slice(0, 3).join(', ') + (p.chains.length > 3 ? ` and ${p.chains.length - 3} more` : '');
  const weekly = Math.max(2, Math.round(hold / 7));
  const steps: { text: string; cost_usd: number; hours: number }[] = [];
  if (verdict === 'SKIP') {
    steps.push({
      text: `SKIP: this plan nets ${dollars(net)} after costs, so it does not pay. Read the next steps only to see why.`,
      cost_usd: 0,
      hours: 0,
    });
  } else {
    steps.push({
      text: `Open a fresh wallet and fund it with ${dollars(capital)} on ${chainList}; keep it separate from any wallet you already farm with.`,
      cost_usd: gasUnit,
      hours: 1,
    });
  }
  steps.push({
    text: `Use ${dollars(capital)} to ${action} on ${p.name} — one real position, not a dust transaction, sized to the protocol's TVL tier.`,
    cost_usd: capital + gasUnit,
    hours: 2,
  });
  steps.push({
    text: `Repeat a qualifying ${action.split(' ')[0]} action once a week for ${weekly} weeks so the activity looks like a user, not a single visit; each repeat costs about ${dollars(gasUnit)} in gas.`,
    cost_usd: gasUnit * 2,
    hours: weekly,
  });
  steps.push({
    text: `Hold the position for ${hold} days without withdrawing; the capital earns nothing while it sits, which costs about ${dollars(tbill)} at a 4% T-bill rate.`,
    cost_usd: tbill,
    hours: 0,
  });
  steps.push({
    text: `Check ${p.name}'s own points or eligibility page weekly and screenshot each check; if the page shows no points system, the farm is the on-chain record alone.`,
    cost_usd: 0,
    hours: 1,
  });
  steps.push({
    text: `Keep a farm log (dates, amounts, transaction hashes) and stay ready to claim: at the low end of the model's band this plan nets ${dollars(net)} on a ${dollars(capital)} position.`,
    cost_usd: 0,
    hours: 1,
  });
  return {
    steps,
    capital_usd: capital,
    gas_usd: gas,
    tbill_usd: tbill,
    hold_days: hold,
    slice_usd: slice,
    net_usd: net,
    verdict,
  };
}

/** The plain step strings the board carries (3 to 12, each 20 to 600
 * characters), derived from the plan above. */
export function farmStepTexts(plan: FarmPlan): string[] {
  return plan.steps.map((s) => {
    const t = s.text.trim();
    return t.length > 600 ? t.slice(0, 597) + '...' : t;
  });
}
