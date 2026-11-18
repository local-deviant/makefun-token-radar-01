# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/local-deviant/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/local-deviant/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: screen the snapshot's 758 protocols, fit a value
model on the tokens that already trade, rank the 198 pre-token protocols
by implied launch value, and net every farm plan to the dollar with a
FARM / THIN / SKIP verdict.

Built from scratch in this session from the sealed kit snapshot
(`kit/input/snapshot.json`). Node 22, standard library only, deterministic —
two runs write byte-identical output.

## The model

`ln(mcap) = 5.637 + 0.675 * ln(TVL) - 0.161 * ln(age_days) + category offset`,
fitted by ordinary least squares on 109 comps: live tokens whose mcap/TVL
sits in [0.02, 20], one greatest-TVL protocol per token id. Category offsets
are mean residuals shrunk by 8 pseudo-observations; the fitted multiple is
clamped to [0.08, 1.20]. Implied value = TVL x fitted multiple x growth
multiplier x 0.80 (the 0.80 is a stated pre-token discount, not a fit).

Growth is `1 + clamp(7-day TVL change, -60%, +120%) x 0.6`. Age is days
since DefiLlama first tracked the protocol; a protocol with no tracked
start is given 365 days, and no age under 30 days is used.

## Out-of-sample validation (computed at build time, see `lib/validate.ts`)

| Check | Geo factor |
|---|---|
| Leave-one-out, n=109, curve | x2.77 |
| LOO, full pipeline (growth + 0.80) | x2.80 |
| Time split, cut 2024-02-06 (41 train / 41 test) | x2.75 |
| Walk-forward, pooled, 62 held-out comps | x2.99 |
| Median-multiple baseline, LOO | x3.70 |
| TVL-only baseline (predicted mcap = TVL) | x4.24 |

Bootstrap, 200 draws, seed 20261114: the full-fit top 10 keeps 8.79 of 10 on
average; rank 1 stays rank 1 in 87% of draws. The LOO log error spread is
1.55, so farm plans net against a band of x4.71 (65.1% coverage; 90% band
x10.45). Rank correlation (Spearman) of the LOO predictions with the truth
is 0.527.

## Farm economics

slice = implied value x 0.002% (one active farmer's assumed share), netted to
the low end of the model band (slice / 4.71), less gas fees and less the
T-bill cost of the capital (4% x hold / 365). Gas is $3 per on-chain action
plus $1 per extra chain, capped at $8, over 4 actions. Capital is
$50 / $100 / $150 / $250 by TVL tier; the hold is 60 / 45 / 30 days by age.
FARM when the net clears $50; THIN when it covers its costs but not the
hurdle; SKIP when it does not cover its costs. Counts: 53 FARM / 124 THIN /
21 SKIP. A SKIP plan says so in its first step.

## Kit

Downloaded fresh for this rebuild from `https://make.fun/c/token-radar-01/kit`
(tarball sha256 `9b7f497ea0958e53fc86db5224c523c058400ba3b4b48454f69c808297db9b98`):
all manifest files verified against the sha256 manifest in `kit.json`
(snapshot sha256 `42a71213519479f3a180cc5010cbbf6bd18a2447fa0ad29e4c5122b6c9184393`),
extracted to `kit/`. (The kit itself is not committed here; the parent
handles the submission bundle.)

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
node scripts/check.mjs out   # local replica of the sealed 7-row gate
```

`main.ts` writes `board.json`, `data.js`, `dashboard/validation.json`,
`dashboard/00-proof.md` (the judge-readable proof file, rendered from the
computed numbers), copies `dashboard/` and `screenshots/`, and writes
`dossier.json` with the vendored make.fun library — then rebuilds the dossier
and refuses a mismatch. The dossier is 1,008,086 bytes, under the gate's
1.5 MiB cap; the dossier text is 31,802 of 65,536 bytes, every file whole.

## Screenshots

Captured from the built dashboard with headless Chromium via Playwright
(the managed Hatch Chrome refuses localhost; Playwright's Chromium is the
path):

1. `1-board.png` — the board, with the verdict column and the hero OOS panel.
   Captured 1440x1094 (top 10 rows; the 10th row is cut at the bottom edge).
2. `2-detail.png` — Sentora Curator's detail: model breakdown + netted plan.
   Captured 1440x1440 so all six farm steps fit under the detail.
3. `3-filtered.png` — the FARM-only filter (53 of 198 protocols).
   Captured 1440x1320.

## Files

- `main.ts` — entrypoint, Node 22 stdlib only
- `lib/types.ts` — shared shapes
- `lib/snapshot.ts` — reading the snapshot, the rankable rule
- `lib/fit.ts` — least squares and summary statistics
- `lib/model.ts` — comparables, the curve, the implied value
- `lib/farm.ts` — farm plans, costs, verdicts
- `lib/validate.ts` — leave-one-out, time split, walk-forward, bootstrap
- `lib/board.ts` — building the board and the readiness score
- `lib/proof.ts` — rendering the proof file from the computed numbers
- `vendor/makefun-board.ts` — kit file, copied verbatim
- `dashboard/index.html`, `dashboard/app.css`, `dashboard/app.js` — the page
- `scripts/check.mjs` — local replica of the sealed 7-row gate
- `screenshots/1-board.png`, `2-detail.png`, `3-filtered.png`
- `board.json`, `dossier.json` — generated from the kit snapshot (in `out/`, not committed)
- `LICENSE` (MIT), `README.md`, `RESULTS.md`

## License

MIT. See LICENSE.

---

<sub>Entered on [make.fun](https://make.fun/?ref=njrtxptt&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
