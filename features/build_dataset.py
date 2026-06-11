"""
Build the final training dataset by joining together:
  - pitcher rolling features (data/processed/pitcher_features.parquet)
  - opponent rolling features (data/processed/opponent_features.parquet)
  - park K factors (data/processed/park_factors_k.csv)
  - weather / context (data/processed/weather.parquet)

Rows are filtered to pitcher-starts that have at least one prior tracked
start (so the leakage-safe rolling features are not all-NaN).

Output: data/processed/training_dataset.parquet
Target column: k (actual strikeouts in the start)
"""

import pandas as pd
import os

PITCHER = 'data/processed/pitcher_features.parquet'
OPPONENT = 'data/processed/opponent_features.parquet'
PARK = 'data/processed/park_factors_k.csv'
WEATHER = 'data/processed/weather.parquet'
OUT = 'data/processed/training_dataset.parquet'


def build():
    print("Loading pitcher features...")
    df = pd.read_parquet(PITCHER)
    print(f"  {len(df):,} pitcher-start rows")

    print("\nFiltering to starts with at least 1 prior tracked start "
          "(rolling features available)...")
    before = len(df)
    df = df[df['p_k_per9_3'].notna()].copy()
    print(f"  Dropped {before - len(df)} rows (no rolling history) -> {len(df):,} rows remain")

    print("\nMerging opponent rolling features (on opp_team + game_pk)...")
    opp = pd.read_parquet(OPPONENT).rename(columns={'team': 'opp_team'})
    opp = opp.drop(columns=['game_date'])
    before_cols = set(df.columns)
    df = df.merge(opp, on=['opp_team', 'game_pk'], how='left')
    new_cols_opp = [c for c in df.columns if c not in before_cols]
    print(f"  Added columns: {new_cols_opp}")
    print(f"  Match rate: {df['opp_k_pct_15'].notna().mean():.2%}")

    print("\nMerging park K factors (on park)...")
    park = pd.read_csv(PARK)[['park', 'park_k_factor']]
    before_cols = set(df.columns)
    df = df.merge(park, on='park', how='left')
    new_cols_park = [c for c in df.columns if c not in before_cols]
    print(f"  Added columns: {new_cols_park}")
    print(f"  Match rate: {df['park_k_factor'].notna().mean():.2%}")

    print("\nMerging weather (on game_date + home_team)...")
    weather = pd.read_parquet(WEATHER)
    before_cols = set(df.columns)
    df = df.merge(weather, on=['game_date', 'home_team'], how='left')
    new_cols_weather = [c for c in df.columns if c not in before_cols]
    print(f"  Added columns: {new_cols_weather}")
    print(f"  Match rate: {df['temp_f'].notna().mean():.2%}")

    df['target_k'] = df['k']

    os.makedirs('data/processed', exist_ok=True)
    df.to_parquet(OUT, index=False)

    # ── Data quality report ──────────────────────────────────────────────
    print(f"\nSaved {len(df):,} rows to {OUT}")
    print(f"Total columns: {len(df.columns)}")

    print("\nRows per season:")
    print(df['season'].value_counts().sort_index())

    new_feature_cols = new_cols_opp + new_cols_park + new_cols_weather
    print(f"\nNull rates for newly joined feature columns (%):")
    print((df[new_feature_cols].isna().mean() * 100).round(2))

    print("\nTarget (target_k) distribution:")
    print(df['target_k'].describe())
    print("\nTarget value counts (0-15):")
    print(df['target_k'].value_counts().sort_index().head(16))

    # Final feature list = numeric columns useful for modeling (rolling, context, opponent, park, weather)
    feature_prefixes = ('p_k', 'p_bb', 'p_hr', 'p_whip', 'p_fip', 'p_swstr', 'p_called',
                         'p_chase', 'p_fp', 'p_fastball', 'p_slider', 'p_curveball',
                         'p_changeup', 'p_other', 'p_avg', 'opp_', 'park_k_factor',
                         'temp_f', 'wind_speed', 'wind_favor', 'is_dome',
                         'rest_days', 'prev_pitches', 'is_home', 'day_night',
                         'n_prior_starts', 'n_prior_team_games')
    feature_cols = [c for c in df.columns if c.startswith(feature_prefixes)]
    print(f"\nModel feature columns ({len(feature_cols)}):")
    for c in feature_cols:
        print(f"  {c}")

    print("\nSample rows (id columns + target + a few key features):")
    sample_cols = ['pitcher', 'game_date', 'opp_team', 'park', 'is_home', 'day_night',
                    'target_k', 'p_k_per9_5', 'p_k_pct_5', 'opp_k_pct_15', 'park_k_factor',
                    'temp_f', 'is_dome', 'rest_days']
    print(df[sample_cols].head(8).to_string(index=False))

    print("\nCorrelation of key features with target_k (sanity check):")
    corr_cols = ['p_k_per9_10', 'p_k_pct_10', 'p_swstr_pct_10', 'opp_k_pct_15',
                  'park_k_factor', 'temp_f', 'rest_days']
    for c in corr_cols:
        valid = df[[c, 'target_k']].dropna()
        print(f"  {c:20s} vs target_k: {valid[c].corr(valid['target_k']):.3f}  (n={len(valid)})")

    return df


if __name__ == "__main__":
    build()
