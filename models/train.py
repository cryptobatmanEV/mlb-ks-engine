"""
Train a LightGBM Poisson regression model to predict a starting pitcher's
strikeout count for a game.

Why Poisson objective: strikeout counts are non-negative integer counts with
a roughly Poisson-shaped distribution (see build_dataset.py target_k stats).
A Poisson-objective regressor outputs a predicted mean (lambda) directly,
which we can then plug into the Poisson distribution to get
P(actual K > line) for any over/under betting line.

Time-aware split: train on 2021-2024, test on 2025-2026 (no shuffling --
this mimics how the model would actually be used, predicting future games
from past data).

Bias correction: a baseline model trained on 2021-2024 underpredicts
2025-2026 actual K by ~0.24 on average (verified: train-set predictions are
calibrated to within 0.0001, and no individual feature shows a 2025 "cliff",
so this isn't a single broken feature -- it's the model's fit not
extrapolating perfectly to more recent seasons). Two fixes were compared in
models/bias_experiment.py:
  - Year-weighted training (recent training seasons weighted more heavily)
    barely moves the bias on its own.
  - An additive bias correction (mean residual on a 2025 H1 calibration
    slice, applied to predictions) nearly eliminates the gap.
Combining both gave the best result (smallest calibration gaps + best
correlation/RMSE on a genuine 2025 H2 + 2026 holdout), so that's what's used
here.

Output:
  models/saved/ks_model.pkl -- dict with keys: model, bias_correction, features
"""

import os

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.stats import poisson, pearsonr
from sklearn.metrics import mean_absolute_error, mean_squared_error

DATA = 'data/processed/training_dataset.parquet'
MODEL_PATH = 'models/saved/ks_model.pkl'

ROLLING_STATS = [
    'p_k_per9', 'p_bb_per9', 'p_hr_per9', 'p_whip', 'p_fip', 'p_k_pct',
    'p_swstr_pct', 'p_called_strike_pct', 'p_chase_pct', 'p_fp_strike_pct',
    'p_fastball_velo', 'p_fastball_pct', 'p_slider_pct', 'p_curveball_pct',
    'p_changeup_pct', 'p_other_pct', 'p_avg_pitches', 'p_avg_ip',
]
WINDOWS = [3, 5, 10]

FEATURES = (
    [f'{stat}_{w}' for w in WINDOWS for stat in ROLLING_STATS]
    + ['rest_days', 'prev_pitches', 'n_prior_starts', 'is_home', 'is_night']
    + ['opp_k_pct_15', 'opp_ops_15', 'opp_chase_pct_15', 'n_prior_team_games']
    + ['park_k_factor']
    + ['temp_f', 'wind_speed', 'wind_favor', 'is_dome']
)

LINES = [4.5, 5.5, 6.5, 7.5, 8.5]


def prep(df):
    df = df.copy()
    df['is_home'] = df['is_home'].astype(int)
    df['is_night'] = (df['day_night'] == 'night').astype(int)
    df['is_dome'] = df['is_dome'].astype(float)
    return df


def print_metrics(label, preds, actual):
    mae = mean_absolute_error(actual, preds)
    rmse = np.sqrt(mean_squared_error(actual, preds))
    corr, _ = pearsonr(preds, actual)
    print(f"\n{label}")
    print(f"  MAE={mae:.4f}  RMSE={rmse:.4f}  Corr={corr:.4f}  "
          f"mean_pred={preds.mean():.3f}  mean_actual={actual.mean():.3f}")
    return mae, rmse, corr


def print_calibration_table(label, preds, actual):
    print(f"\n{label}")
    for line in LINES:
        floor = int(line)
        p_over = (1 - poisson.cdf(floor, preds)).mean()
        actual_rate = (actual > floor).mean()
        print(f"  Line {line}: Poisson P(over)={p_over:.3f}  actual={actual_rate:.3f}  "
              f"gap={p_over - actual_rate:+.3f}")


def train():
    print("Loading training dataset...")
    df = pd.read_parquet(DATA)
    df['game_date'] = pd.to_datetime(df['game_date'])
    df = prep(df)

    train_df = df[df['game_date'].dt.year <= 2024]
    test_df = df[df['game_date'].dt.year >= 2025]
    cal_df = test_df[test_df['game_date'] < '2025-07-01']
    holdout_df = test_df[test_df['game_date'] >= '2025-07-01']

    print(f"Train rows:    {len(train_df):,} (2021-2024)")
    print(f"Test rows:     {len(test_df):,} (2025-2026)")
    print(f"  - calibration slice (2025 H1): {len(cal_df):,}")
    print(f"  - holdout slice (2025 H2 + 2026): {len(holdout_df):,}")
    print(f"\nFeature count: {len(FEATURES)}")

    X_train, y_train = train_df[FEATURES], train_df['target_k']
    X_test, y_test = test_df[FEATURES], test_df['target_k']
    X_cal, y_cal = cal_df[FEATURES], cal_df['target_k']
    X_holdout, y_holdout = holdout_df[FEATURES], holdout_df['target_k']

    # Year-weighted training: weight each training season by recency (2021->1 ... 2024->4)
    sample_weight = (train_df['game_date'].dt.year - 2020).astype(float)

    print("\nTraining LightGBM (Poisson objective, year-weighted)...")
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

    # ── Bias correction ──────────────────────────────────────────────────
    pred_cal = np.clip(model.predict(X_cal), 1e-6, None)
    bias_correction = float((y_cal.values - pred_cal).mean())
    print(f"\nAdditive bias correction (fit on 2025 H1 calibration slice): "
          f"{bias_correction:+.4f}")

    # ── Evaluation ────────────────────────────────────────────────────────
    pred_test_raw = np.clip(model.predict(X_test), 1e-6, None)
    pred_test = np.clip(pred_test_raw + bias_correction, 1e-6, None)

    print_metrics("Full test set (2025-2026), raw predictions:", pred_test_raw, y_test)
    print_metrics("Full test set (2025-2026), bias-corrected predictions:", pred_test, y_test)

    pred_holdout_raw = np.clip(model.predict(X_holdout), 1e-6, None)
    pred_holdout = np.clip(pred_holdout_raw + bias_correction, 1e-6, None)
    print_metrics("Genuine holdout (2025 H2 + 2026), raw predictions:", pred_holdout_raw, y_holdout)
    print_metrics("Genuine holdout (2025 H2 + 2026), bias-corrected predictions:", pred_holdout, y_holdout)

    # ── Feature importance ───────────────────────────────────────────────
    print("\nTop 15 feature importances (gain):")
    imp = pd.Series(model.booster_.feature_importance(importance_type='gain'), index=FEATURES)
    imp = imp.sort_values(ascending=False)
    print(imp.head(15).to_string())

    # ── Poisson over/under calibration tables ────────────────────────────
    print("\n" + "=" * 60)
    print("CALIBRATION: Poisson P(over X.5) vs actual over rate")
    print("=" * 60)
    print_calibration_table("Full test set (2025-2026), RAW predictions:", pred_test_raw, y_test.values)
    print_calibration_table("Full test set (2025-2026), BIAS-CORRECTED predictions:", pred_test, y_test.values)
    print_calibration_table("Genuine holdout (2025 H2 + 2026), BIAS-CORRECTED predictions:",
                             pred_holdout, y_holdout.values)

    # ── Calibration check: bucket by rounded corrected prediction ───────
    print("\n" + "=" * 60)
    print("Bucketed calibration (full test set, bias-corrected predictions)")
    print("=" * 60)
    test_df = test_df.copy()
    test_df['pred_k'] = pred_test
    test_df['pred_bucket'] = test_df['pred_k'].round().astype(int)

    for bucket in sorted(test_df['pred_bucket'].unique()):
        sub = test_df[test_df['pred_bucket'] == bucket]
        if len(sub) < 30:
            continue
        mean_lambda = sub['pred_k'].mean()
        line = bucket - 0.5
        if line <= 0:
            continue
        floor = int(line)
        poisson_prob = 1 - poisson.cdf(floor, mean_lambda)
        actual_rate = (sub['target_k'] > floor).mean()
        print(f"  pred_k ~ {bucket} (n={len(sub):4d}, mean lambda={mean_lambda:.2f}): "
              f"line {line:.1f} -- Poisson P(over) = {poisson_prob:.3f}, "
              f"actual over rate = {actual_rate:.3f}")

    # ── Save model ────────────────────────────────────────────────────────
    os.makedirs('models/saved', exist_ok=True)
    joblib.dump({
        'model': model,
        'bias_correction': bias_correction,
        'features': FEATURES,
    }, MODEL_PATH)
    print(f"\nSaved model + bias correction + feature list to {MODEL_PATH}")

    return model


if __name__ == "__main__":
    train()
