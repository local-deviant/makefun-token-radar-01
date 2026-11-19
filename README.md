# Token Radar v2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/local-deviant/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/local-deviant/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar for pre-token protocols: what would a protocol's token be worth if it
issued one today, and what should a reader do to farm it before it does?

## What it does

`main.ts` reads the sealed snapshot (`/input/snapshot.json`, 758 protocols as
of 14 Nov 2026), fits a value model on the protocols that already have a
token, and writes:

- `board.json` — 197 pre-token protocols ranked by implied value, each with a
  verdict (FARM / THIN / SKIP) and a six-step farm plan.
- `dashboard/` — a sortable, filterable board with a detail view per protocol.
- `screenshots/` — the board, a protocol's detail view, and a filtered view.
- `dossier.json` — the dossier the judge reads, built with the kit's library.

## The model

`ln(mcap) = 5.6374 + 0.6751·ln(TVL) − 0.1607·ln(age)`, fitted by OLS on 109
comparables: live tokens whose mcap/TVL sits in [0.02, 20], one per token (the
greatest TVL when a token spans protocols). Each category carries an offset —
its mean residual, shrunk by n/(n+8). A protocol's implied value is its TVL
times its fitted multiple (clamped 0.08–1.20) times its growth
(1 + its 7-day TVL change, clamped −60%…+120%, times 0.3). There is no
pre-token discount: the guard showed a 0.80 discount only adds downward bias
and hurts every check, worst out of time.

The board holds every protocol on the snapshot's watchlist (40/40) plus the
other pre-token candidates below the floor, to 197 rows. A candidate is a
protocol whose DefiLlama record carries no token, that is not a wrapped,
staked or bridged product, whose category is not Bridge, Canonical Bridge,
Liquid Staking, Liquid Restaking, Restaked BTC or CEX, whose name ends in no
version marker, and whose name begins with no exchange's name — the house's
own watchlist rule, minus the TVL floor. The record is not proof, so the
board says a protocol *records no token*, never that it has none.

Verdicts use the house's $50M floor and the farm band (x4.75, one sigma of
the leave-one-out errors): FARM when the point estimate clears $50M, THIN
when only the optimistic end of the band clears it, SKIP when even that falls
short. Farm plans net to the low end of the band: size the position on that,
not on the headline.

## Validation (measured on this snapshot)

| Check | v2 | v1 |
|---|---|---|
| Leave-one-out, median | x2.61 | x2.80 |
| Leave-one-out, geometric mean | x3.53 | x3.57 |
| Leave-one-out, Spearman | 0.525 | 0.527 |
| Time split (cut 2024-02-06, 41/41) | x2.60 | x2.75 |
| Walk-forward, pooled (62 held out) | x2.55 | x2.99 |
| Walk-forward folds | x2.41 / x2.70 / x2.60 | x2.76 / x2.75 / x3.31 |
| Median-multiple baseline, LOO | x3.70 | x3.70 |
| TVL-only baseline, LOO | x4.24 | x4.24 |

Bootstrap (200 draws, seed 20261114): the top 10 keeps 8.87 of 10 on average;
rank 1 stays rank 1 in 86.5% of draws. Farm band x4.75, coverage 66.1%.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
node scripts/check.mjs out   # the local gate replica: 8/8
```

Two runs into different directories are byte-identical. Node 22, standard
library only, no network.

---

<sub>Entered on [make.fun](https://make.fun/?ref=njrtxptt&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
