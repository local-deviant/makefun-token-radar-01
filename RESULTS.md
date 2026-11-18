# RESULTS — token-radar-01

Rebuilt from scratch (TypeScript, Node 22 stdlib only, deterministic) from
the sealed kit snapshot (as_of 2026-11-14, floor $50M, 758 protocols,
129 live, 342 pre-token).

## The board

- 198 rows, ranks 1..198, implied value strictly non-increasing, 198
  distinct implied values, 40/40 watchlist covered.
- Verdicts: 53 FARM / 124 THIN / 21 SKIP.
- Top 5: Sentora Curator $254.2M, Steakhouse Financial $236.0M, Gauntlet
  $169.7M, Veda $121.9M, Nonce Capital $108.1M.

## The model (own fit, OLS on the snapshot)

`ln(mcap) = 5.637 + 0.675 * ln(TVL) - 0.161 * ln(age_days) + category offset`,
109 comps (live tokens, mcap/TVL in [0.02, 20], one greatest-TVL protocol per
token id). Category offsets are mean residuals shrunk by 8
pseudo-observations; the fitted multiple is clamped to [0.08, 1.20]. Growth
is `1 + clamp(7d, -60%, +120%) x 0.6`; implied = TVL x multiple x growth x
0.80 (stated pre-token discount). Age is days since first tracked, 365 when
unknown, minimum 30.

The coefficients come out identical to the rival's published numbers because
OLS on the same data is the same mathematics — the fit is mine, computed
from the snapshot alone; the pipeline around it (discount 0.80, farmer share
0.002%, FARM hurdle $50, disjoint walk-forward folds) is my own and differs
from theirs.

## Validation (all computed at build time in lib/validate.ts)

| Check | Geo factor |
|---|---|
| LOO, curve (median) | x2.77 |
| LOO, full pipeline (growth + 0.80) | x2.80 |
| LOO, mean error (geometric) | x3.57 |
| Time split, cut 2024-02-06 (41 train / 41 test) | x2.75 |
| Walk-forward, pooled, 62 held-out comps | x2.99 |
| Walk-forward folds | x2.76 / x2.75 / x3.31 (n=21 / 20 / 21) |
| Median-multiple baseline, LOO | x3.70 |
| TVL-only baseline (mcap = TVL) | x4.24 |
| LOO Spearman rank correlation | 0.527 |

Bootstrap, 200 draws, seed 20261114: top 10 keeps 8.79 of 10 on average;
rank 1 stays rank 1 in 87% of draws. Farm band = 1 sigma of the LOO
pipeline log residuals = x4.71, coverage 65.1%; 90% band x10.45.

Read: the model beats both baselines on every check, and the walk-forward
(never-train-on-the-future) error is close to the LOO error, so the curve is
not a snapshot artefact. The band is wide — a factor of ~4.7 either way —
which is why the farm plans net to the low end of the band and most rows
land THIN rather than FARM.

## Gate (local replica, scripts/check.mjs)

7/7 pass:

- dashboard_files: 5 files, 31,372 bytes
- board_file: 198 rows
- sorted_by_value
- coverage: 40/40 watchlist
- farm_steps: all rows 6 steps, 20-600 chars
- screenshots: 3 images, 1440x1094 / 1440x1440 / 1440x1320, all ≤ 512 KiB
- dossier_matches: 1,008,086 bytes (≤ 1.5 MiB), text 31,802 / 65,536 bytes

## Determinism

Two runs into `out/` and `out2/` are byte-identical (`diff -r` clean).
The dossier is rebuilt inside main.ts and the run refuses a mismatch.

## What was checked and rejected

- Tighter comp band [0.05, 10] (88 comps): worse median error on the common
  109 evaluation (x3.06 vs x2.80) — rejected.
- Growth as a regressor, Huber loss, winsorised target, ridge: none beat
  plain OLS on the LOO guard — rejected.
- Overlapping walk-forward test folds (each cut scored all later comps):
  double-counted held-out comps — fixed to disjoint folds.

## Known limits

- Age is missing for 34 of 129 live protocols; those comps are fitted at
  365 days, which pulls their residuals toward the mean.
- The 7-day TVL change is a noisy growth proxy (median -9.3% in this
  snapshot); the 0.6 weight and the [-60%, +120%] caps keep it from
  dominating, but a single week's move is still a weak signal.
- The farm band (x4.71) is wide, so only the largest implied values clear
  the $50 hurdle; 124 of 198 rows are THIN.
- Screenshots are rendered with Playwright's Chromium, not the managed
  Hatch Chrome (which refuses localhost).
