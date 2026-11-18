/**
 * Reading the sealed snapshot, and deciding which protocols the radar may
 * rank. The snapshot is read-only input: this file never writes it, never
 * fetches anything, and never invents a protocol.
 */
import { readFileSync } from 'node:fs';
import type { Protocol, Snapshot } from './types.ts';

/** The categories the house's watchlist rule treats as a wrapped, staked or
 * bridged product rather than a protocol waiting on its own launch. */
export const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names a protocol may not start with (the watchlist rule). */
export const EXCHANGE_NAMES = [
  'Binance',
  'Coinbase',
  'Bybit',
  'Kraken',
  'Bitget',
  'OKX',
  'Bitfinex',
  'Gemini',
];

/** A version marker at the end of a name: a space followed by V2, v2, 2.0
 * or the like (the watchlist rule's own pattern). */
const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking, in any case. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export function loadSnapshot(path: string): Snapshot {
  const raw = readFileSync(path, 'utf8');
  const snap = JSON.parse(raw) as Snapshot;
  if (!Array.isArray(snap.protocols) || !Array.isArray(snap.watchlist)) {
    throw new Error(`loadSnapshot: ${path} is not a token-radar snapshot`);
  }
  return snap;
}

/**
 * Whether a protocol may be ranked at all: it records no token, and it is
 * not a wrapped, staked or bridged product under the watchlist's own
 * exclusion logic. This is the same rule the watchlist was built with,
 * applied to every board row, so a bridged or wrapped product can never
 * top the board however large its TVL is.
 */
export function isRankable(p: Protocol): boolean {
  if (p.gecko_id !== null || p.symbol !== null) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (VERSION_TAIL.test(p.name)) return false;
  const firstWord = p.name.split(/\s+/)[0];
  if (EXCHANGE_NAMES.includes(firstWord)) return false;
  return true;
}

/** Days from a protocol's first tracked day to the snapshot date. */
export function ageDays(p: Protocol, asOf: string, fallback: number): number {
  if (!p.listed_at) return fallback;
  const start = Date.parse(p.listed_at + 'T00:00:00Z');
  const end = Date.parse(asOf + 'T00:00:00Z');
  const days = Math.floor((end - start) / 86400000);
  return days < 30 ? 30 : days;
}

/** The snapshot's protocols, sorted by slug, as the file already holds them. */
export function bySlug(snap: Snapshot): Map<string, Protocol> {
  const out = new Map<string, Protocol>();
  for (const p of snap.protocols) out.set(p.slug, p);
  return out;
}
