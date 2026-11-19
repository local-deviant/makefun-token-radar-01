# token-radar-01 v2 — RESULTS

Fresh, developed rebuild of the token launch radar. Written from scratch in
this session from the design brief and the kit RULES only — no file was copied
from v1, from the old repo, or from any Cervus repo. The vendor dossier
library (`vendor/makefun-board.ts`) is the kit's own file, copied as the kit
instructs; everything else is mine. Node 22, TypeScript, stdlib only.

## Scores

| Check | v2 | v1 |
|---|---|---|
| Leave-one-out, median | **x2.61** | x2.80 |
| Leave-one-out, geometric mean | **x3.53** | x3.57 |
| Leave-one-out, Spearman | 0.525 | 0.527 |
| Time split, cut 2024-02-06 (41 train / 41 test) | **x2.60** | x2.75 |
| Walk-forward, pooled, 62 held-out comps | **x2.55** | x2.99 |
| Walk-forward folds | **x2.41 / x2.70 / x2.60** | x2.76 / x2.75 / x3.31 |
| Median-multiple baseline, LOO | x3.70 | x3.70 |
| TVL-only baseline (mcap = TVL), LOO | x4.24 | x4.24 |

**All three guards beat v1.** The walk-forward gain is the largest (x2.99 →
x2.55): the change that buys it is dropping the 0.80 pre-token discount, which
was pure downward bias and hurt most out of time.

Bootstrap, 200 draws, seed 20261114: top 10 keeps 8.87 of 10 on average;
rank 1 stays rank 1 in 86.5% of draws. Farm band = 1 sigma of the LOO log
residuals = x4.75, coverage 66.1%.

## The board

- 197 rows, ranks 1..197, implied value strictly decreasing, 197 distinct
  implied values, 40/40 watchlist covered.
- Verdicts: 13 FARM / 83 THIN / 101 SKIP.
- Top 5: Sentora Curator $315.6M, Steakhouse Financial $296.9M, Gauntlet
  $208.7M, Veda $156.4M, Nonce Capital $139.4M — the same five names v1
  found, higher because there is no 0.80 discount.
- The board pool is the house's own watchlist rule minus the TVL floor (197
  candidates). That filter matters: without it the top rows are Binance CEX,
  Aave V3 and WBTC — protocols whose tokens already trade — and the board
  stops being a pre-token radar.

## Gate (local replica, scripts/check.mjs)

8/8 pass:

- dashboard_files: 4 files, 48,468 bytes
- board_file: 197 rows
- sorted_by_value
- coverage: 40/40 watchlist
- farm_steps: all rows 6 steps, 20-600 chars
- screenshots: 3 images, 1440x900 / 1440x800 / 1440x900, all ≤ 512 KiB
- dossier_matches: 852,408 bytes (≤ 1.5 MiB), byte-identical to buildDossier
- dashboard_steps_match_board: the page's farm steps equal board.json's for
  all 197 rows

## Determinism

Two runs into `out/` and `out2/` are byte-identical (`diff -r` clean). The
dossier is rebuilt by buildDossier inside main.ts on every run.

## What was checked and rejected

- **Category-median age imputation** (age = the category's median age when
  listed_at is missing): LOO median x2.92 vs x2.61 for flat 365 days — the
  flat imputation wins, because the fitted age coefficient (-0.16) is doing
  real work for the missing-age group. Rejected.
- **Age capped at 730 days**: LOO x2.81 — worse. Rejected.
- **No age term at all**: LOO x2.86, geo x3.50 — worse on the median. The age
  term stays.
- **A missing-age indicator**: the design matrix goes singular on the
  dated-only training folds (no missing-age comps in them), so it cannot be
  fitted honestly. Rejected.
- **The 0.80 pre-token discount**: LOO x2.69–2.80, time split x2.94,
  walk-forward x2.99 — worse than no discount on every guard (x2.61 / x2.60 /
  x2.55). A constant downward shift is bias, not conservatism. Rejected;
  v2 carries no discount.
- **Growth shrunk toward the category median** (k=1, 2): LOO x2.77–2.78 vs
  x2.61 for the raw change at weight 0.3 — no gain. Rejected.
- **Growth weight 0 / 0.15 / 0.45 / 0.6**: all within noise of 0.3 on every
  guard (LOO x2.59–2.69). Kept 0.3: the middle of the flat region, and the
  model keeps growth visible, which the judging criteria ask for.
- **Multiple clamp [0.10, 1.00] / [0.05, 2.0] / none**: LOO x2.86–2.95, worse
  than [0.08, 1.20] (x2.61). Kept [0.08, 1.20].
- **Category-offset shrinkage 4 / 16** (vs 8): no gain on any guard. Kept 8.
- **A chains-count feature** (ln of chain count): LOO x2.61, walk-forward
  x2.53 — a hair better out of time, worse on LOO geo; not enough to justify
  a fourth regressor. Rejected.
- **Verdict by the low end of the band** (FARM only when implied/band ≥ $50M):
  2 FARM rows out of 197 — the band is too wide (x4.75) for that rule to say
  anything. Replaced with: FARM when the point estimate clears $50M, THIN
  when only the optimistic end (implied x band) clears it, SKIP otherwise.

## Known limits

- Age is missing for 27 of the 109 comparables and 75 of the 197 board rows;
  those are fitted at 365 days, which pulls their residuals toward the mean.
  The no-date comparables are the hardest group to predict (LOO median x4.62
  vs x2.31 for dated ones).
- The 7-day TVL change is a noisy growth proxy (median -8.2% across the
  snapshot); the 0.3 weight and the [-60%, +120%] caps keep it from
  dominating, but a single week's move is still a weak signal.
- The farm band (x4.75) is wide, so only 13 rows clear the $50M floor at
  point estimate; 101 of 197 rows are SKIP.
- Sentora Curator, the #1 row, is not on the watchlist: it passes every
  check the snapshot's fields allow, but the house's rule also uses a parent
  protocol the snapshot does not carry, and Sentora Curator is evidently a
  vault product of one. The board says it records no token, never that it
  has none.
- Screenshots are rendered with Playwright's Chromium binary directly
  (headless --screenshot), not the managed Hatch Chrome (which refuses to
  start under Playwright). The detail shot uses a detail-mode hash so the
  panel sits at the top: headless --screenshot does not repaint after a
  scrollIntoView, so a scrolled detail comes out blank.
