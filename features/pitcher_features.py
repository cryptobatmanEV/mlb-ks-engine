"""
Build pitcher rolling features (L3 / L5 / L10 STARTS, leakage-safe).

1. Aggregate pitch-level Statcast data to one row per (pitcher, start):
   swing/whiff/chase/called-strike/first-pitch-strike counts, pitch mix,
   fastball velocity.
2. Merge with MLB Stats API game logs (K, IP, BB, H, ER, HR, HBP, BF, pitches).
3. For each pitcher, sort starts by date and compute rolling L3/L5/L10
   features using shift(1) BEFORE rolling -- so a start's features only use
   information available before that start (no leakage of the target).
4. Add context: rest days since last start, pitch count in previous start,
   home/away, day/night, park (the game's home_team).

Output: data/processed/pitcher_features.parquet
"""

import pandas as pd
import os

from features.pitch_flags import add_pitch_flags, add_event_flags

STATCAST = 'data/raw/statcast_pitching.parquet'
GAMELOGS = 'data/raw/pitcher_game_logs.parquet'
OUT = 'data/processed/pitcher_features.parquet'

WINDOWS = [3, 5, 10]


def aggregate_statcast_per_start(df):
    """One row per (pitcher, game_pk): swing/chase/pitch-mix counts for that start."""
    print("Adding pitch-level flags...")
    df = add_pitch_flags(df)

    print("Aggregating to pitcher-start level...")
    g = df.groupby(['pitcher', 'game_pk', 'game_date']).agg(
        n_pitches=('description', 'size'),
        n_swings=('is_swing', 'sum'),
        n_whiffs=('is_whiff', 'sum'),
        n_called_strikes=('is_called_strike', 'sum'),
        n_ooz=('is_ooz', 'sum'),
        n_oz_swings=('is_oz_swing', 'sum'),
        n_first_pitches=('is_first_pitch', 'sum'),
        n_first_pitch_strikes=('is_first_pitch_strike', 'sum'),
        n_fastball=('is_fastball', 'sum'),
        n_slider=('is_slider', 'sum'),
        n_curveball=('is_curveball', 'sum'),
        n_changeup=('is_changeup', 'sum'),
        n_other_pitch=('is_other_pitch', 'sum'),
        fastball_velo_sum=('fastball_velo', 'sum'),
        n_fastball_velo=('fastball_velo', 'count'),
        home_team=('home_team', 'first'),
        away_team=('away_team', 'first'),
    ).reset_index()
    return g


def compute_rolling(df):
    """Per pitcher: sort by date, shift(1), then rolling L3/L5/L10 sum-of-ratios."""
    print("Computing rolling L3/L5/L10 features per pitcher (leakage-safe)...")
    out = []
    for pid, sub in df.groupby('pitcher'):
        sub = sub.sort_values(['game_date', 'game_pk']).reset_index(drop=True)

        # Context features that only need the immediately preceding start
        sub['rest_days'] = (sub['game_date'] - sub['game_date'].shift(1)).dt.days
        sub['prev_pitches'] = sub['pitches'].shift(1)

        shifted = sub.shift(1)
        for w in WINDOWS:
            r = shifted.rolling(w, min_periods=1)
            ip_sum = r['ip'].sum()

            sub[f'p_k_per9_{w}'] = r['k'].sum() * 9 / ip_sum
            sub[f'p_bb_per9_{w}'] = r['bb'].sum() * 9 / ip_sum
            sub[f'p_hr_per9_{w}'] = r['hr'].sum() * 9 / ip_sum
            sub[f'p_whip_{w}'] = (r['bb'].sum() + r['h'].sum()) / ip_sum
            sub[f'p_fip_{w}'] = (
                13 * r['hr'].sum() + 3 * (r['bb'].sum() + r['hbp'].sum()) - 2 * r['k'].sum()
            ) / ip_sum + 3.10
            sub[f'p_k_pct_{w}'] = r['k'].sum() / r['bf'].sum()

            sub[f'p_swstr_pct_{w}'] = r['n_whiffs'].sum() / r['n_swings'].sum()
            sub[f'p_called_strike_pct_{w}'] = r['n_called_strikes'].sum() / r['n_pitches'].sum()
            sub[f'p_chase_pct_{w}'] = r['n_oz_swings'].sum() / r['n_ooz'].sum()
            sub[f'p_fp_strike_pct_{w}'] = r['n_first_pitch_strikes'].sum() / r['n_first_pitches'].sum()

            sub[f'p_fastball_velo_{w}'] = r['fastball_velo_sum'].sum() / r['n_fastball_velo'].sum()
            n_pitches_sum = r['n_pitches'].sum()
            sub[f'p_fastball_pct_{w}'] = r['n_fastball'].sum() / n_pitches_sum
            sub[f'p_slider_pct_{w}'] = r['n_slider'].sum() / n_pitches_sum
            sub[f'p_curveball_pct_{w}'] = r['n_curveball'].sum() / n_pitches_sum
            sub[f'p_changeup_pct_{w}'] = r['n_changeup'].sum() / n_pitches_sum
            sub[f'p_other_pct_{w}'] = r['n_other_pitch'].sum() / n_pitches_sum

            sub[f'p_avg_pitches_{w}'] = shifted['pitches'].rolling(w, min_periods=1).mean()
            sub[f'p_avg_ip_{w}'] = shifted['ip'].rolling(w, min_periods=1).mean()

        # Number of prior tracked starts (used to know if rolling stats have any history)
        sub['n_prior_starts'] = shifted['game_pk'].expanding().count().values

        out.append(sub)

    return pd.concat(out, ignore_index=True)


def build():
    print("Loading Statcast store...")
    statcast = pd.read_parquet(STATCAST)
    statcast['game_date'] = pd.to_datetime(statcast['game_date'])

    per_start = aggregate_statcast_per_start(statcast)

    print("\nLoading pitcher game logs...")
    logs = pd.read_parquet(GAMELOGS)
    logs['game_date'] = pd.to_datetime(logs['game_date'])
    before = len(logs)
    logs = logs.dropna(subset=['bf', 'hbp']).copy()
    print(f"  Dropped {before - len(logs)} rows with missing bf/hbp")

    print("\nMerging Statcast aggregates with game logs...")
    df = logs.merge(
        per_start.drop(columns=['game_date']),
        on=['pitcher', 'game_pk'], how='left'
    )
    matched = df['n_pitches'].notna().mean()
    print(f"  Statcast match rate: {matched:.2%} ({df['n_pitches'].notna().sum()}/{len(df)})")

    df = compute_rolling(df)

    # Park = the venue's home team for this game (regardless of which side the pitcher is on)
    df['park'] = df['home_team']
    df['opp_team'] = df.apply(
        lambda row: row['away_team'] if row['is_home'] else row['home_team'], axis=1
    )

    os.makedirs('data/processed', exist_ok=True)
    df.to_parquet(OUT, index=False)

    # ── Data quality report ──────────────────────────────────────────────
    print(f"\nSaved {len(df)} pitcher-start rows to {OUT}")
    print(f"\nRows per season:")
    print(df['season'].value_counts().sort_index())

    print(f"\nNull rates for key rolling features (%):")
    check_cols = [f'p_k_per9_{w}' for w in WINDOWS] + [f'p_fip_{w}' for w in WINDOWS] + \
                  [f'p_chase_pct_{w}' for w in WINDOWS] + ['rest_days', 'prev_pitches']
    print((df[check_cols].isna().mean() * 100).round(2))

    has_l10 = df['p_k_per9_10'].notna().sum()
    print(f"\nRows with full L10 history: {has_l10} ({has_l10/len(df):.1%})")

    print("\nSample rows (pitcher, date, target k, L5 features):")
    sample_cols = ['pitcher', 'game_date', 'k', 'p_k_per9_5', 'p_k_pct_5',
                    'p_swstr_pct_5', 'p_chase_pct_5', 'p_fastball_velo_5', 'rest_days']
    print(df[df['p_k_per9_5'].notna()][sample_cols].head(8).to_string(index=False))

    print("\nCorrelation of L10 rolling features with actual K (sanity check):")
    corr_cols = [f'p_k_per9_10', f'p_k_pct_10', f'p_swstr_pct_10', f'p_chase_pct_10', f'p_avg_ip_10']
    sub = df[df['p_k_per9_10'].notna()]
    for c in corr_cols:
        print(f"  {c:25s} vs k: {sub[c].corr(sub['k']):.3f}")

    return df


if __name__ == "__main__":
    build()
