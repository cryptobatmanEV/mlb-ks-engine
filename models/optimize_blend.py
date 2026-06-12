"""
Find the optimal MODEL_WEIGHT for blending the model's projection (pred_k)
with a market-implied projection to form adj_k (see predict/fair_odds.py).

CAVEAT -- no real historical sportsbook odds exist for 2025 H2 + 2026 (the
holdout period): training_dataset.parquet has no odds/line columns, and only
2 days of real fair_odds output exist (2026-06-11/12). Backfilling real
historical player-prop odds would require a paid OddsAPI historical tier.

So this script builds a PROXY "market" model instead of using real odds: a
second LightGBM Poisson model trained on a deliberately narrower, more
"public/lagging" feature set (season-trailing rate stats, opponent tendency,
park factor, rest/home/night -- the kind of macro information embedded in a
market line) that EXCLUDES the L3/L5 recent-form windows and the detailed
Statcast plate-discipline/pitch-mix/velocity features that give the main
model its edge, plus same-day context (lineup_k_pct, ump_k_factor, weather).
Its predictions (market_k) stand in for "the market's implied K total".

This tests the BLENDING MECHANISM honestly (does averaging two independently-
trained, differently-informed estimators reduce error and produce
better-calibrated edges?), but market_k is NOT a real sportsbook line --
treat the resulting "optimal" weight as a starting point, to be revisited once
enough real adj_k / book-line history accumulates via the daily pipeline.

For each MODEL_WEIGHT in [0.30, 0.35, ..., 0.70] (plus a 1.00 "no blend"
reference), on the 2025 H2 + 2026 holdout:
  1. adj_k = w * pred_k + (1 - w) * market_k
  2. MAE / RMSE of adj_k vs actual_k
  3. Calibration at lines 4.5/5.5/6.5/7.5: Poisson P(over) from adj_k
     (via fair_odds.model_prob_over, which applies EDGE_SCALE) vs actual
     over rate
  4. Edge accuracy: for plausible book lines (|pred_k - line| <= 1.5),
     edge = blended_prob_for_side - book_implied_prob_for_side (book_implied
     comes from market_k's raw Poisson prob, round-tripped through
     fair_odds.market_implied_k / implied_lambda_from_line exactly like a
     real book price would be). Bucket by edge size and compare predicted
     vs actual hit rate.

Usage:
    python -m models.optimize_blend
"""

import os
import sys

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.stats import poisson
from sklearn.metrics import mean_absolute_error, mean_squared_error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from predict.fair_odds import model_prob_over, market_implied_k, EDGE_SCALE  # noqa: E402

DATA = 'data/processed/training_dataset.parquet'
MODEL_PATH = 'models/saved/ks_model.pkl'

# "Public/lagging" feature set for the proxy market model -- season-trailing
# rate stats, opponent tendency, park, and basic context. Deliberately
# excludes L3/L5 recent-form windows, Statcast plate-discipline/pitch-mix/
# velocity features, and same-day context (lineup_k_pct, ump_k_factor,
# weather) -- the signals that give the main model its edge.
MARKET_FEATURES = [
    'p_k_per9_10', 'p_bb_per9_10', 'p_hr_per9_10', 'p_whip_10', 'p_fip_10', 'p_k_pct_10',
    'rest_days', 'n_prior_starts', 'is_home', 'is_night',
    'opp_k_pct_15', 'opp_ops_15',
    'park_k_factor',
]

WEIGHTS = [round(0.30 + 0.05 * i, 2) for i in range(9)]  # 0.30 .. 0.70
LINES = [4.5, 5.5, 6.5, 7.5]

EDGE_BINS = [0.0, 0.03, 0.06, 0.10, 1.0]
EDGE_LABELS = ['0-3%', '3-6%', '6-10%', '10%+']


def prep(df):
    df = df.copy()
    df['is_home'] = df['is_home'].astype(int)
    df['is_night'] = (df['day_night'] == 'night').astype(int)
    df['is_dome'] = df['is_dome'].astype(float)
    return df


def load_splits():
    df = pd.read_parquet(DATA)
    df['game_date'] = pd.to_datetime(df['game_date'])
    df = prep(df)

    train_df = df[df['game_date'].dt.year <= 2024]
    test_df = df[df['game_date'].dt.year >= 2025]
    cal_df = test_df[test_df['game_date'] < '2025-07-01']
    holdout_df = test_df[test_df['game_date'] >= '2025-07-01']
    return train_df, cal_df, holdout_df


def main_model_preds(holdout_df):
    bundle = joblib.load(MODEL_PATH)
    features = bundle['features']
    model = bundle['model']
    bias_correction = bundle['bias_correction']
    pred_raw = np.clip(model.predict(holdout_df[features]), 1e-6, None)
    return np.clip(pred_raw + bias_correction, 1e-6, None)


def train_market_proxy(train_df, cal_df, holdout_df):
    """Train the proxy 'market' model on MARKET_FEATURES, bias-correct on
    the 2025 H1 calibration slice, and return predictions for the holdout."""
    X_train, y_train = train_df[MARKET_FEATURES], train_df['target_k']
    sample_weight = (train_df['game_date'].dt.year - 2020).astype(float)

    model = lgb.LGBMRegressor(
        objective='poisson',
        n_estimators=400,
        learning_rate=0.03,
        max_depth=5,
        num_leaves=31,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        verbose=-1,
    )
    model.fit(X_train, y_train, sample_weight=sample_weight)

    pred_cal = np.clip(model.predict(cal_df[MARKET_FEATURES]), 1e-6, None)
    bias_correction = float((cal_df['target_k'].values - pred_cal).mean())

    pred_holdout_raw = np.clip(model.predict(holdout_df[MARKET_FEATURES]), 1e-6, None)
    pred_holdout = np.clip(pred_holdout_raw + bias_correction, 1e-6, None)
    return pred_holdout, bias_correction


def print_standalone_metrics(label, preds, actual):
    mae = mean_absolute_error(actual, preds)
    rmse = np.sqrt(mean_squared_error(actual, preds))
    print(f"  {label:<28s} MAE={mae:.4f}  RMSE={rmse:.4f}  mean={preds.mean():.3f}")


def calibration_gap(adj_k, actual_k):
    """Mean |Poisson P(over) - actual over rate| across LINES, using
    model_prob_over (i.e. with EDGE_SCALE applied), matching what the web app
    actually shows as model_prob_book_line / model_prob_pp_line."""
    gaps = []
    for line in LINES:
        floor = int(line)
        p_over = np.array([model_prob_over(k, line) for k in adj_k]).mean()
        actual_rate = (actual_k > floor).mean()
        gaps.append(abs(p_over - actual_rate))
    return float(np.mean(gaps))


def edge_table(pred_k, market_k, adj_k, actual_k):
    """Plausible-line edge records: for each holdout row and each line within
    1.5 Ks of pred_k, compute edge = blended_prob_for_side -
    book_implied_prob_for_side (book_implied derived from market_k, round-
    tripped through fair_odds' de-vig/inversion helpers) and whether the
    favored side hit."""
    records = []
    for line in LINES:
        floor = int(line)
        mask = np.abs(pred_k - line) <= 1.5
        if not mask.any():
            continue

        for ak, mk, act in zip(adj_k[mask], market_k[mask], actual_k[mask]):
            if act == floor:
                continue  # push

            # "Book" price: market_k's raw Poisson prob at this line (no
            # EDGE_SCALE -- this is the proxy book's own true-probability
            # estimate, as if already de-vigged).
            book_p_over = float(1 - poisson.cdf(floor, mk))
            # Round-trip through fair_odds' de-vig/inversion to confirm the
            # same logic recovers the book's implied K (== mk by construction).
            recovered_mk = market_implied_k(line, book_p_over, 1 - book_p_over)
            if recovered_mk is None:
                continue

            blended_p_over = model_prob_over(ak, line)

            side_over = blended_p_over >= 0.5
            p_model_side = blended_p_over if side_over else 1 - blended_p_over
            p_book_side = book_p_over if side_over else 1 - book_p_over
            edge = p_model_side - p_book_side
            hit = (act > floor) if side_over else (act < floor)

            records.append((edge, p_model_side, float(hit)))

    return pd.DataFrame(records, columns=['edge', 'p_model', 'hit'])


def edge_calibration_gap(edges):
    """Mean |predicted - actual| across positive-edge buckets."""
    pos = edges[edges['edge'] >= 0].copy()
    if pos.empty:
        return float('nan'), 0
    pos['bucket'] = pd.cut(pos['edge'], bins=EDGE_BINS, labels=EDGE_LABELS)
    cal = pos.groupby('bucket', observed=True).agg(
        predicted=('p_model', 'mean'), actual=('hit', 'mean'), n=('hit', 'count')
    )
    cal = cal[cal['n'] >= 10]
    if cal.empty:
        return float('nan'), int(pos['bucket'].notna().sum())
    gap = (cal['predicted'] - cal['actual']).abs().mean()
    return float(gap), int(pos.shape[0])


def main():
    print("Loading holdout split (2025 H2 + 2026)...")
    train_df, cal_df, holdout_df = load_splits()
    print(f"  Train: {len(train_df):,}  Cal (2025 H1): {len(cal_df):,}  Holdout: {len(holdout_df):,}")

    print("\nLoading main model and computing pred_k on holdout...")
    pred_k = main_model_preds(holdout_df)

    print("\nTraining proxy 'market' model on lagging/public features...")
    print(f"  Features ({len(MARKET_FEATURES)}): {MARKET_FEATURES}")
    market_k, market_bias = train_market_proxy(train_df, cal_df, holdout_df)
    print(f"  Bias correction: {market_bias:+.4f}")

    actual_k = holdout_df['target_k'].values

    print("\n" + "=" * 60)
    print("STANDALONE ESTIMATORS (holdout, vs actual_k)")
    print("=" * 60)
    print_standalone_metrics("Main model (pred_k)", pred_k, actual_k)
    print_standalone_metrics("Proxy market (market_k)", market_k, actual_k)

    print(f"\nEDGE_SCALE (from fair_odds.py) = {EDGE_SCALE}")
    print(f"Plausible-line filter: |pred_k - line| <= 1.5, lines = {LINES}")

    print("\n" + "=" * 60)
    print("MODEL_WEIGHT GRID SEARCH")
    print("=" * 60)
    header = (f"{'weight':>7s} {'MAE':>8s} {'RMSE':>8s} {'cal_gap':>9s} "
              f"{'edge_gap':>9s} {'n_edges':>8s}")
    print(header)
    print("-" * len(header))

    results = []
    for w in WEIGHTS + [1.00]:
        adj_k = w * pred_k + (1 - w) * market_k
        mae = mean_absolute_error(actual_k, adj_k)
        rmse = np.sqrt(mean_squared_error(actual_k, adj_k))
        cal_gap = calibration_gap(adj_k, actual_k)
        edges = edge_table(pred_k, market_k, adj_k, actual_k)
        e_gap, n_edges = edge_calibration_gap(edges)

        tag = '  (no blend, pred_k only)' if w == 1.00 else ''
        print(f"{w:7.2f} {mae:8.4f} {rmse:8.4f} {cal_gap:9.4f} {e_gap:9.4f} {n_edges:8d}{tag}")
        results.append({'weight': w, 'mae': mae, 'rmse': rmse, 'cal_gap': cal_gap, 'edge_gap': e_gap})

    # ── Pick the best weight among the 0.30-0.70 grid (exclude the 1.00
    # reference row) by a composite rank across all four metrics ──────────
    grid = [r for r in results if r['weight'] <= 0.70]
    df = pd.DataFrame(grid)
    df['rank'] = (
        df['mae'].rank() + df['rmse'].rank() + df['cal_gap'].rank() + df['edge_gap'].rank()
    )
    best = df.loc[df['rank'].idxmin()]

    print("\n" + "=" * 60)
    print("RESULT")
    print("=" * 60)
    print(f"  Best MODEL_WEIGHT (composite rank of MAE/RMSE/cal_gap/edge_gap): "
          f"{best['weight']:.2f}")
    print(f"    MAE={best['mae']:.4f}  RMSE={best['rmse']:.4f}  "
          f"cal_gap={best['cal_gap']:.4f}  edge_gap={best['edge_gap']:.4f}")

    no_blend = next(r for r in results if r['weight'] == 1.00)
    print(f"\n  Reference (no blend, w=1.00): MAE={no_blend['mae']:.4f}  "
          f"RMSE={no_blend['rmse']:.4f}  cal_gap={no_blend['cal_gap']:.4f}  "
          f"edge_gap={no_blend['edge_gap']:.4f}")

    return float(best['weight'])


if __name__ == '__main__':
    main()
