// Token radar model: fit, board, verdicts and farm plans.
// Written fresh for token-radar-01 v2 from the snapshot alone. Node 22 stdlib only.

import { readFileSync } from 'node:fs';

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface Curve {
  /** OLS coefficients [intercept, ln TVL, ln age]. */
  beta: [number, number, number];
  /** Category offsets: mean residual shrunk by n/(n+8), keyed by category ('(none)' when null). */
  offsets: Map<string, number>;
  /** Log-space standard deviation of the LOO residuals: the farm band is exp(sd). */
  looSd: number;
  /** Number of comparables the curve was fitted on. */
  nComps: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  multiple: number;
  growth: number;
  on_watchlist: boolean;
}

// ---------------------------------------------------------------- constants

/** Age in days given to a protocol whose listed_at is missing: one year. */
export const AGE_UNKNOWN_DAYS = 365;
/** Ages are floored at thirty days: a protocol listed yesterday is not a day old. */
export const AGE_MIN_DAYS = 30;
/** Fitted mcap/TVL multiples are clamped to this band. */
export const MULTIPLE_CLAMP: [number, number] = [0.08, 1.2];
/** Weight of the seven-day TVL change in the growth factor. */
export const GROWTH_WEIGHT = 0.3;
/** Seven-day change is clamped to this percent range before it enters growth. */
export const GROWTH_CLAMP: [number, number] = [-60, 120];
/** Category offsets shrink by n/(n+SHRINK_K). */
export const OFFSET_SHRINK_K = 8;
/** The board holds the watchlist plus this many further pre-token protocols. */
export const BOARD_EXTRA = 160;
/** A farm clears when even the low end of its 1-sigma band clears this. */
export const FARM_HURDLE_USD = 50_000_000;

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- snapshot

export function loadSnapshot(path: string): Snapshot {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

/** Days from listed_at to the snapshot date, floored at AGE_MIN_DAYS; null when unlisted. */
export function ageDays(p: Protocol, asOf: Date): number | null {
  if (!p.listed_at) return null;
  const listed = new Date(`${p.listed_at}T00:00:00Z`).getTime();
  const days = Math.round((asOf.getTime() - listed) / DAY_MS);
  return Math.max(AGE_MIN_DAYS, days);
}

function ageForFit(p: Protocol, asOf: Date): number {
  return ageDays(p, asOf) ?? AGE_UNKNOWN_DAYS;
}

// ---------------------------------------------------------------- linear algebra

/** Solve a small dense system by Gauss-Jordan with partial pivoting; null when singular. */
export function solveLinear(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    if (Math.abs(m[piv][c]) < 1e-12) return null;
    [m[c], m[piv]] = [m[piv], m[c]];
    const d = m[c][c];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / d;
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

// ---------------------------------------------------------------- comparables

/**
 * The comparables: protocols that record a token, whose mcap/TVL sits in
 * [0.02, 20], one per token (the greatest TVL when a token spans protocols).
 */
export function selectComps(protocols: Protocol[]): Protocol[] {
  const byToken = new Map<string, Protocol>();
  for (const p of protocols) {
    if (p.mcap_usd == null || p.gecko_id == null) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (ratio < 0.02 || ratio > 20) continue;
    const cur = byToken.get(p.gecko_id);
    if (!cur || p.tvl_usd > cur.tvl_usd) byToken.set(p.gecko_id, p);
  }
  return [...byToken.values()].sort((a, b) => (a.slug < b.slug ? -1 : 1));
}

// ---------------------------------------------------------------- the fit

interface Fit {
  beta: [number, number, number];
  offsets: Map<string, number>;
  residuals: number[];
}

function fitOnce(rows: Protocol[], asOf: Date): Fit | null {
  const k = 3;
  const xtx: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
  const xty: number[] = Array(k).fill(0);
  const xs: number[][] = [];
  const ys: number[] = [];
  for (const p of rows) {
    const x = [1, Math.log(p.tvl_usd), Math.log(Math.max(AGE_MIN_DAYS, ageForFit(p, asOf)))];
    const y = Math.log(p.mcap_usd as number);
    xs.push(x);
    ys.push(y);
    for (let a = 0; a < k; a++) {
      xty[a] += x[a] * y;
      for (let b = 0; b < k; b++) xtx[a][b] += x[a] * x[b];
    }
  }
  const beta = solveLinear(xtx, xty);
  if (beta === null) return null;
  const residuals = rows.map((_, i) => ys[i] - xs[i].reduce((s, v, j) => s + v * beta[j], 0));
  const byCat = new Map<string, { sum: number; n: number }>();
  rows.forEach((p, i) => {
    const c = p.category ?? '(none)';
    const e = byCat.get(c) ?? { sum: 0, n: 0 };
    e.sum += residuals[i];
    e.n++;
    byCat.set(c, e);
  });
  const offsets = new Map<string, number>();
  for (const [c, e] of byCat) offsets.set(c, (e.sum / e.n) * (e.n / (e.n + OFFSET_SHRINK_K)));
  return { beta: beta as [number, number, number], offsets, residuals };
}

/** Fitted log mcap of a protocol under a fit (curve + its category offset). */
function fittedLogMcap(p: Protocol, fit: Fit, asOf: Date): number {
  const lp =
    fit.beta[0] +
    fit.beta[1] * Math.log(p.tvl_usd) +
    fit.beta[2] * Math.log(Math.max(AGE_MIN_DAYS, ageForFit(p, asOf)));
  return lp + (fit.offsets.get(p.category ?? '(none)') ?? 0);
}

/** The fitted mcap/TVL multiple, clamped to MULTIPLE_CLAMP. */
export function fittedMultiple(p: Protocol, fit: Fit, asOf: Date): number {
  const mult = Math.exp(fittedLogMcap(p, fit, asOf)) / p.tvl_usd;
  return Math.min(MULTIPLE_CLAMP[1], Math.max(MULTIPLE_CLAMP[0], mult));
}

/** Growth factor from the seven-day TVL change: 1 when unreported. */
export function growthFactor(p: Protocol): number {
  if (p.change_7d == null) return 1;
  const c = Math.min(GROWTH_CLAMP[1], Math.max(GROWTH_CLAMP[0], p.change_7d));
  return 1 + (c / 100) * GROWTH_WEIGHT;
}

/** Implied value: TVL x fitted multiple x growth. No pre-token discount. */
export function impliedValue(p: Protocol, fit: Fit, asOf: Date): number {
  return p.tvl_usd * fittedMultiple(p, fit, asOf) * growthFactor(p);
}

// ---------------------------------------------------------------- leave-one-out

/** Log errors of the full pipeline, one per comparable, each fitted without it. */
export function looLogErrors(comps: Protocol[], asOf: Date): number[] {
  const errs: number[] = [];
  for (let h = 0; h < comps.length; h++) {
    const train = comps.filter((_, i) => i !== h);
    const fit = fitOnce(train, asOf);
    if (fit === null) continue;
    const pred = impliedValue(comps[h], fit, asOf);
    errs.push(Math.log(pred) - Math.log(comps[h].mcap_usd as number));
  }
  return errs;
}

/** Median and geometric-mean error factors from log errors. */
export function errorFactors(errs: number[]): { median: number; geo: number } {
  const f = errs.map((e) => Math.exp(Math.abs(e))).sort((a, b) => a - b);
  const median = f.length % 2 === 1 ? f[(f.length - 1) / 2] : (f[f.length / 2 - 1] + f[f.length / 2]) / 2;
  const geo = Math.exp(errs.reduce((s, e) => s + Math.abs(e), 0) / errs.length);
  return { median, geo };
}

/** Standard deviation of log errors: the farm band is exp(sd). */
export function logSd(errs: number[]): number {
  const mean = errs.reduce((s, e) => s + e, 0) / errs.length;
  const variance = errs.reduce((s, e) => s + (e - mean) * (e - mean), 0) / (errs.length - 1);
  return Math.sqrt(variance);
}

/** Fit the curve on all comparables, with the LOO band attached. */
export function fitCurve(comps: Protocol[], asOf: Date): Curve {
  const fit = fitOnce(comps, asOf);
  if (fit === null) throw new Error('fit: singular design matrix');
  const errs = looLogErrors(comps, asOf);
  return { beta: fit.beta, offsets: fit.offsets, looSd: logSd(errs), nComps: comps.length };
}

// ---------------------------------------------------------------- farm plans

const NATIVE: Record<string, string> = {
  Ethereum: 'ETH',
  Solana: 'SOL',
  Binance: 'BNB',
  Avalanche: 'AVAX',
  Polygon: 'MATIC',
  Sui: 'SUI',
  Tron: 'TRX',
  Bitcoin: 'BTC',
  Arbitrum: 'ETH',
  Base: 'ETH',
  Optimism: 'ETH',
  Linea: 'ETH',
  Sonic: 'S',
  Fantom: 'FTM',
  Mantle: 'MNT',
};

/** Typical gas cost of one transaction on a chain, in dollars. */
function gasUsd(chain: string): number {
  if (chain === 'Ethereum') return 12;
  if (chain === 'Solana') return 0.05;
  if (chain === 'Bitcoin') return 2;
  if (chain === 'Tron') return 1;
  if (['Arbitrum', 'Base', 'Optimism', 'Linea', 'Polygon', 'Sonic', 'Mantle'].includes(chain)) return 0.5;
  return 1;
}

/** Position size tier by TVL: bigger protocols take a bigger position. */
function positionUsd(tvl: number): number {
  if (tvl >= 1_000_000_000) return 10_000;
  if (tvl >= 500_000_000) return 5_000;
  if (tvl >= 200_000_000) return 2_000;
  if (tvl >= 100_000_000) return 1_000;
  return 500;
}

function money(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  if (n >= 1) return `$${Math.round(n)}`;
  return `$${n.toFixed(2)}`;
}

/** The core action and its weekly repeat, by category. */
function categoryPlay(category: string | null, name: string, pos: string, chain: string): [string, string] {
  switch (category) {
    case 'Lending':
      return [
        `Supply ${pos} of USDC on ${name} and borrow 40% of it back in a stablecoin, so the supply leg earns yield while the borrow leg counts as real usage.`,
        `Top the supply up by 10% each week and keep the health factor above 1.5, so the position stays open and active for the full 8 weeks.`,
      ];
    case 'Dexs':
      return [
        `Add ${pos} of liquidity to the main ${name} pool on ${chain} and swap $100 through the pool, so you are both a maker and a taker.`,
        `Swap $100 through ${name} every week and add the fees you earn back into the pool, keeping the position live.`,
      ];
    case 'Yield':
    case 'Yield Aggregator':
      return [
        `Deposit ${pos} into the ${name} vault on ${chain} and let it auto-compound; the vault receipt is the proof of your deposit.`,
        `Compound the vault yield back in every week and add $100 of fresh capital, so the balance grows steadily.`,
      ];
    case 'RWA':
      return [
        `Buy ${pos} of tokenized exposure through ${name} on ${chain} and hold it in the same wallet for the whole plan.`,
        `Add $100 of exposure every week, so the holding grows and the wallet shows a steady accumulation pattern.`,
      ];
    case 'Liquid Staking':
    case 'Staking Pool':
      return [
        `Stake ${pos} of ${NATIVE[chain] ?? 'the chain token'} on ${name} and keep the receipt token, then use that receipt as collateral somewhere once.`,
        `Stake another $100 every week and never unstake early, so the stake ages without interruption.`,
      ];
    case 'Liquid Restaking':
    case 'Restaking':
      return [
        `Restake ${pos} of ${NATIVE[chain] ?? 'the chain token'} through ${name} and hold the restaking receipt for the full plan.`,
        `Restake $100 more each week, so the restaked balance climbs and the wallet shows continued commitment.`,
      ];
    case 'Bridge':
    case 'Canonical Bridge':
    case 'Cross Chain Bridge':
      return [
        `Bridge ${pos} to ${chain} through ${name} and back once, paying the bridge fee, so the wallet records a real crossing.`,
        `Bridge $100 every week on a different route, so the history shows repeated, varied use rather than one transfer.`,
      ];
    case 'Basis Trading':
      return [
        `Open a ${pos} delta-neutral position on ${name}, long spot and short perps in equal size, and hold it for the plan.`,
        `Rebalance the hedge weekly so it stays neutral, and log the funding you collect as the position's yield.`,
      ];
    case 'CDP':
    case 'CDP Manager':
      return [
        `Lock ${pos} of collateral in ${name}'s vault on ${chain} and mint stablecoins against at most half of it.`,
        `Adjust the collateral ratio weekly to stay above the liquidation line, and repay a little of the debt each time.`,
      ];
    case 'Derivatives':
      return [
        `Open a ${pos} hedged position on ${name} on ${chain}, with a stop set so a bad week costs at most 5% of the position.`,
        `Roll the position weekly and keep the hedge on, so the account stays active without taking directional risk.`,
      ];
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
      return [
        `Deposit ${pos} into a ${name} curated vault on ${chain} and leave it allocated for the whole plan.`,
        `Add $100 to the vault every week and review the curator's allocation note, so the deposit keeps growing.`,
      ];
    case 'Chain':
      return [
        `Bridge ${pos} onto ${name} and use it daily: swap once, hold the native token for gas, and keep a balance on the chain.`,
        `Transact on ${name} at least three times a week, so the wallet shows sustained activity on the chain itself.`,
      ];
    case 'Indexes':
      return [
        `Buy ${pos} of the ${name} index on ${chain} and hold it; the index receipt is the position.`,
        `Add $100 to the index every week, so the holding compounds and the wallet ages with it.`,
      ];
    case 'Farm':
      return [
        `Stake LP tokens worth ${pos} on ${name}'s farm on ${chain} and start earning the farm rewards.`,
        `Harvest the rewards weekly and restake them, so the farmed balance grows instead of sitting idle.`,
      ];
    case 'Launchpad':
      return [
        `Stake ${pos} on ${name} to qualify for its launches, and join the next sale the stake unlocks.`,
        `Keep the stake locked and join every sale that opens during the 8 weeks, so the account shows launch activity.`,
      ];
    case 'Payments':
      return [
        `Route ${pos} of real payments through ${name} on ${chain}, splitting it across at least three separate transfers.`,
        `Send one payment a week through ${name}, so the account shows regular payment volume.`,
      ];
    case 'Insurance':
      return [
        `Buy ${pos} of cover on ${name} for a position you already hold, and keep the policy active for the plan.`,
        `Review the cover weekly and top it up when the underlying position grows, so the policy never lapses.`,
      ];
    case 'Prediction Market':
      return [
        `Place ${pos} of prediction trades on ${name} across at least three markets, sized so no single market risks more than a third.`,
        `Trade one market a week and settle promptly, so the account shows steady prediction volume.`,
      ];
    default:
      return [
        `Use ${name}'s main ${category ?? 'protocol'} product on ${chain} with ${pos}, and keep the position open for the whole plan.`,
        `Repeat the core use weekly for 8 weeks, adding $100 each time, so the wallet shows sustained, growing usage.`,
      ];
  }
}

/** The low end of a value's 1-sigma band: the number the farm plan sizes on. */
export function bandLow(implied: number, band: number): number {
  return Math.round(implied / band);
}
export function farmSteps(p: Protocol, implied: number, band: number): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const native = NATIVE[chain] ?? 'the chain token';
  const pos = positionUsd(p.tvl_usd);
  const gas = gasUsd(chain);
  const posStr = money(pos);
  const gasStr = money(gas);
  const bridgeFee = money(Math.max(5, gas * 2));
  const [core, repeat] = categoryPlay(p.category, p.name, posStr, chain);
  const low = bandLow(implied, band);
  const steps = [
    `Open a fresh wallet on ${chain} and fund it with ${posStr} in USDC plus ${gasStr} of ${native} for gas; the whole 8-week plan costs about ${money(gas * 12)} in fees.`,
    `Move ${posStr} of USDC to ${chain} (bridge fee about ${bridgeFee}, 10-20 minutes) and keep a ${gasStr} gas reserve untouched.`,
    core,
    repeat,
    `Check ${p.name}'s announcements and points page every week; snapshots are unannounced, so leave the position open and do not withdraw early.`,
    `When the token launches, unwind in 3 tranches over 2 weeks and claim within the 90-day window; the low end of the value band is about $${low.toLocaleString('en-US')}, so size the exit on that, not the headline.`,
  ];
  return steps.map((s) => (s.length > 600 ? s.slice(0, 597) + '...' : s));
}

// ---------------------------------------------------------------- the board

/**
 * Whether a protocol is a genuine pre-token candidate: the house's own
 * watchlist rule, minus the TVL floor. A protocol counts as recording no
 * token only when both gecko_id and symbol are null; it is out when it is a
 * wrapped, staked or bridged product, when its category is one of the
 * excluded ones, when its name ends in a version marker, or when its name
 * begins with an exchange's name. DefiLlama's record is not proof — a
 * protocol can pass this rule and still have a token its record omits —
 * so the board says a protocol "records no token", never that it has none.
 */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_MARKER = / [vV]?\d+(?:\.\d+)?$/;
const WRAPPED_WORD = /\b(?:wrapped|staked|staking)\b/i;

export function isPreTokenCandidate(p: Protocol): boolean {
  if (p.gecko_id != null || p.symbol != null || p.mcap_usd != null) return false;
  if (p.category != null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (VERSION_MARKER.test(p.name)) return false;
  const firstWord = p.name.split(' ')[0];
  if (EXCHANGE_NAMES.some((e) => e.toLowerCase() === firstWord.toLowerCase())) return false;
  return true;
}

/**
 * Verdict from the implied value and the farm band, against the house's
 * $50M floor: FARM when the point estimate clears the floor, THIN when
 * only the optimistic end of the band (implied x band) clears it, SKIP
 * when even the optimistic end falls short.
 */
export function verdictFor(implied: number, band: number): 'FARM' | 'THIN' | 'SKIP' {
  if (implied >= FARM_HURDLE_USD) return 'FARM';
  if (implied * band >= FARM_HURDLE_USD) return 'THIN';
  return 'SKIP';
}

export interface Board {
  rows: BoardRow[];
  curve: Curve;
  band: number;
  asOf: string;
}

/**
 * The board: every watchlist protocol, plus the highest-implied pre-token
 * protocols below the floor, to BOARD_EXTRA + watchlist rows. Ranked by
 * implied value, strictly decreasing, each with a verdict and six farm steps.
 */
export function buildBoard(snap: Snapshot): Board {
  const asOf = new Date(`${snap.as_of}T00:00:00Z`);
  const comps = selectComps(snap.protocols);
  const curve = fitCurve(comps, asOf);
  const band = Math.exp(curve.looSd);
  const bySlug = new Map(snap.protocols.map((p) => [p.slug, p]));
  const watchSet = new Set(snap.watchlist);
  const preToken = snap.protocols.filter((p) => isPreTokenCandidate(p));
  const scored = preToken.map((p) => ({ p, implied: impliedValue(p, curve, asOf) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1));
  const picked: { p: Protocol; implied: number }[] = [];
  const seen = new Set<string>();
  for (const s of scored) {
    if (watchSet.has(s.p.slug)) {
      picked.push(s);
      seen.add(s.p.slug);
    }
  }
  for (const s of scored) {
    if (picked.length >= snap.watchlist.length + BOARD_EXTRA) break;
    if (seen.has(s.p.slug)) continue;
    picked.push(s);
    seen.add(s.p.slug);
  }
  picked.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1));
  const rows: BoardRow[] = [];
  let prev = Number.POSITIVE_INFINITY;
  picked.forEach((s, i) => {
    let value = Math.max(1, Math.round(s.implied));
    if (value >= prev) value = prev - 1;
    prev = value;
    const p = s.p;
    rows.push({
      slug: p.slug,
      name: p.name,
      rank: i + 1,
      implied_value_usd: value,
      verdict: verdictFor(value, band),
      farm_steps: farmSteps(p, value, band),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: ageDays(p, asOf),
      multiple: fittedMultiple(p, curve, asOf),
      growth: growthFactor(p),
      on_watchlist: watchSet.has(p.slug),
    });
  });
  return { rows, curve, band, asOf: snap.as_of };
}

// ---------------------------------------------------------------- formatting

/** $254.2M, $1.03B, $48.5M. */
export function formatUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}
