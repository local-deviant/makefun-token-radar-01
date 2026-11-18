/**
 * Shared shapes for the token radar. The snapshot is the sealed DefiLlama
 * protocol data; a row is one ranked pre-token protocol on the board.
 */

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

export type Verdict = 'FARM' | 'THIN' | 'SKIP';

export interface FarmStep {
  text: string;
  cost_usd: number;
  hours: number;
}

export interface FarmPlan {
  steps: FarmStep[];
  capital_usd: number;
  gas_usd: number;
  tbill_usd: number;
  hold_days: number;
  slice_usd: number;
  net_usd: number;
  verdict: Verdict;
}

export interface BoardRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number;
  age_known: boolean;
  rank: number;
  implied_value_usd: number;
  multiple: number;
  growth: number;
  readiness: number;
  watchlist: boolean;
  farm: FarmPlan;
  farm_steps: string[];
}

export interface FittedModel {
  intercept: number;
  tvlSlope: number;
  ageSlope: number;
  categoryOffsets: Record<string, number>;
  compCount: number;
  multipleLow: number;
  multipleHigh: number;
  discount: number;
  band: number;
  growthCapLow: number;
  growthCapHigh: number;
  growthWeight: number;
}

export interface Validation {
  looGeo: number;
  looMedian: number;
  looSpearman: number;
  looFullGeo: number;
  timeSplitGeo: number;
  timeSplitCut: string;
  timeSplitTrain: number;
  timeSplitTest: number;
  walkForward: { cut: string; geo: number; n: number }[];
  walkForwardPooled: number;
  walkForwardN: number;
  bootstrapTop10: number;
  bootstrapRank1: number;
  medianMultipleGeo: number;
  tvlOnlyGeo: number;
  band: number;
  bandCoverage: number;
  band90: number;
}

export interface BoardData {
  rows: BoardRow[];
  model: FittedModel;
  validation: Validation;
  counts: {
    protocols: number;
    live: number;
    preToken: number;
    rankable: number;
    watchlist: number;
    farm: number;
    thin: number;
    skip: number;
  };
  categories: { name: string; comps: number; offset: number; multiple: number }[];
  asOf: string;
  floorUsd: number;
}
