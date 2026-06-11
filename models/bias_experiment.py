"""
Scratch experiment: compare bias-correction strategies for the K model.

Baseline model (train 2021-2024) underpredicts test-set (2025-2026) actual K
by ~0.24 on average, even though no individual feature shows a 2025 "cliff"
and the league-wide K rate isn't trending up. We test:

  A) Baseline, no correction
  B) Baseline + additive bias correction fit on a calibration slice
  C) Year-weighted retrain (recent training seasons weighted more heavily)
  D) Year-weighted retrain + additive bias correction

Calibration slice = test rows before 2025-07-01 (2025 H1).
Validation slice  = test rows from 2025-07-01 onward (2025 H2 + all 2026) --
genuinely "future" relative to the calibration slice.
"""
import json

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.stats import poisson, pearsonr
from sklearn.metrics import mean_absolute_error, mean_squared_error

DATA = 'data/processed/training_dataset.parquet'

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


def calib_table(name, preds, actual):
    print(f"\n--- {name} ---")
    mae = mean_absolute_error(actual, preds)
    rmse = np.sqrt(mean_squared_error(actual, preds))
    corr, _ = pearsonr(preds, actual)
    print(f"MAE={mae:.4f}  RMSE={rmse:.4f}  Corr={corr:.4f}  "
          f"mean_pred={preds.mean():.3f}  mean_actual={actual.mean():.3f}")
    for line in LINES:
        floor = int(line)
        p_over = (1 - poisson.cdf(floor, preds)).mean()
        actual_rate = (actual > floor).mean()
        print(f"  Line {line}: Poisson P(over)={p_over:.3f}  actual={actual_rate:.3f}  "
              f"gap={p_over - actual_rate:+.3f}")


def main():
    df = pd.read_parquet(DATA)
    df['game_date'] = pd.to_datetime(df['game_date'])
    df = prep(df)

    train_df = df[df['game_date'].dt.year <= 2024]
    cal_df = df[(df['game_date'] >= '2025-01-01') & (df['game_date'] < '2025-07-01')]
    val_df = df[df['game_date'] >= '2025-07-01']
    print(f"Train: {len(train_df)}  Calibration (2025 H1): {len(cal_df)}  "
          f"Validation (2025 H2 + 2026): {len(val_df)}")

    X_train, y_train = train_df[FEATURES], train_df['target_k']
    X_cal, y_cal = cal_df[FEATURES], cal_df['target_k']
    X_val, y_val = val_df[FEATURES], val_df['target_k']

    base_params = dict(
        objective='poisson', n_estimators=400, learning_rate=0.03,
        max_depth=5, num_leaves=31, subsample=0.8, colsample_bytree=0.8,
        random_state=42, verbose=-1,
    )

    # A) Baseline
    model_a = lgb.LGBMRegressor(**base_params)
    model_a.fit(X_train, y_train)
    pred_a_cal = np.clip(model_a.predict(X_cal), 1e-6, None)
    pred_a_val = np.clip(model_a.predict(X_val), 1e-6, None)
    calib_table("A) Baseline (no correction)", pred_a_val, y_val)

    # B) Baseline + additive bias correction fit on calibration slice
    bias = (y_cal.values - pred_a_cal).mean()
    print(f"\n[Additive bias fit on 2025 H1 calibration slice: {bias:+.4f}]")
    pred_b_val = np.clip(pred_a_val + bias, 1e-6, None)
    calib_table("B) Baseline + additive bias correction", pred_b_val, y_val)

    # C) Year-weighted retrain
    weights = (train_df['game_date'].dt.year - 2020).astype(float)
    model_c = lgb.LGBMRegressor(**base_params)
    model_c.fit(X_train, y_train, sample_weight=weights)
    pred_c_cal = np.clip(model_c.predict(X_cal), 1e-6, None)
    pred_c_val = np.clip(model_c.predict(X_val), 1e-6, None)
    calib_table("C) Year-weighted retrain (no correction)", pred_c_val, y_val)

    # D) Year-weighted retrain + additive bias correction
    bias_c = (y_cal.values - pred_c_cal).mean()
    print(f"\n[Additive bias fit on 2025 H1 calibration slice: {bias_c:+.4f}]")
    pred_d_val = np.clip(pred_c_val + bias_c, 1e-6, None)
    calib_table("D) Year-weighted retrain + additive bias correction", pred_d_val, y_val)


if __name__ == "__main__":
    main()
