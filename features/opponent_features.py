"""
Build opponent (batting team) rolling features, L15 TEAM GAMES, leakage-safe.

For each team-game, aggregate that team's plate appearances as the BATTING
side (regardless of who they're facing), then compute rolling L15-game
features using shift(1) before rolling:
  - opp_k_pct_15:    team strikeout rate per PA
  - opp_ops_15:      team OBP + SLG (overall offensive quality proxy)
  - opp_chase_pct_15: team chase rate (swings at out-of-zone pitches)

Output: data/processed/opponent_features.parquet
One row per (team, game_pk): that team's rolling stats AS OF (not including)
this game -- ready to be joined onto a pitcher's start as "opponent features".
"""

import pandas as pd
import os

from features.pitch_flags import add_pitch_flags, add_event_flags

STATCAST = 'data/raw/statcast_pitching.parquet'
OUT = 'data/processed/opponent_features.parquet'

WINDOW = 15


def aggregate_team_games(df):
    print("Adding pitch-level and event flags...")
    df = add_pitch_flags(df)
    df = add_event_flags(df)

    print("Determining batting team per pitch...")
    df['batting_team'] = df['away_team'].where(df['inning_topbot'] == 'Top', df['home_team'])

    print("Aggregating to team-game level...")
    g = df.groupby(['batting_team', 'game_pk', 'game_date']).agg(
        n_pa=('is_pa', 'sum'),
        n_k=('is_k', 'sum'),
        n_bb=('is_bb', 'sum'),
        n_hbp=('is_hbp', 'sum'),
        n_hits=('is_hit', 'sum'),
        n_sf=('is_sf', 'sum'),
        n_ab=('is_ab', 'sum'),
        total_bases=('total_bases', 'sum'),
        n_ooz=('is_ooz', 'sum'),
        n_oz_swings=('is_oz_swing', 'sum'),
    ).reset_index()
    return g


def compute_rolling(df):
    print(f"Computing rolling L{WINDOW} team-game features (leakage-safe)...")
    out = []
    for team, sub in df.groupby('batting_team'):
        sub = sub.sort_values(['game_date', 'game_pk']).reset_index(drop=True)
        shifted = sub.shift(1)
        r = shifted.rolling(WINDOW, min_periods=1)

        sub[f'opp_k_pct_{WINDOW}'] = r['n_k'].sum() / r['n_pa'].sum()

        obp_num = r['n_hits'].sum() + r['n_bb'].sum() + r['n_hbp'].sum()
        obp_den = r['n_ab'].sum() + r['n_bb'].sum() + r['n_hbp'].sum() + r['n_sf'].sum()
        slg = r['total_bases'].sum() / r['n_ab'].sum()
        sub[f'opp_ops_{WINDOW}'] = obp_num / obp_den + slg

        sub[f'opp_chase_pct_{WINDOW}'] = r['n_oz_swings'].sum() / r['n_ooz'].sum()
        sub['n_prior_team_games'] = shifted['game_pk'].expanding().count().values

        out.append(sub)
    return pd.concat(out, ignore_index=True)


def build():
    print("Loading Statcast store...")
    statcast = pd.read_parquet(STATCAST)
    statcast['game_date'] = pd.to_datetime(statcast['game_date'])

    g = aggregate_team_games(statcast)
    df = compute_rolling(g)

    keep = ['batting_team', 'game_pk', 'game_date',
            f'opp_k_pct_{WINDOW}', f'opp_ops_{WINDOW}', f'opp_chase_pct_{WINDOW}',
            'n_prior_team_games']
    df = df[keep].rename(columns={'batting_team': 'team'})

    os.makedirs('data/processed', exist_ok=True)
    df.to_parquet(OUT, index=False)

    # ── Data quality report ──────────────────────────────────────────────
    print(f"\nSaved {len(df)} team-game rows to {OUT}")
    print(f"\nUnique teams: {df['team'].nunique()}")
    print(f"Date range: {df['game_date'].min().date()} to {df['game_date'].max().date()}")

    print("\nNull rates (%):")
    print((df.isna().mean() * 100).round(2))

    has_l15 = df[f'opp_k_pct_{WINDOW}'].notna().sum()
    print(f"\nRows with at least 1 prior game: {has_l15} ({has_l15/len(df):.1%})")

    print(f"\nopp_k_pct_{WINDOW} distribution:")
    print(df[f'opp_k_pct_{WINDOW}'].describe())
    print(f"\nopp_ops_{WINDOW} distribution:")
    print(df[f'opp_ops_{WINDOW}'].describe())
    print(f"\nopp_chase_pct_{WINDOW} distribution:")
    print(df[f'opp_chase_pct_{WINDOW}'].describe())

    print("\nSample rows:")
    print(df[df[f'opp_k_pct_{WINDOW}'].notna()].head(8).to_string(index=False))

    return df


if __name__ == "__main__":
    build()
