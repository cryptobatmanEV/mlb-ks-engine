"""
Build lineup-specific strikeout-rate features (FEATURE 1), leakage-safe.

For each (batter, season), compute that batter's season-to-date K% (SO/PA)
using ONLY plate appearances from games BEFORE the current game (cumulative
within season -- no leakage of the target game's own PAs). Join
data/raw/lineups.parquet (the confirmed starting 9 per team for each game)
and average each team's 9 starters' season-to-date K% to get lineup_k_pct
for that (game_pk, team).

Output: data/processed/lineup_features.parquet
One row per (game_pk, team): lineup_k_pct, n_lineup_matched -- ready to be
joined onto a pitcher's start (on game_pk + opp_team == team) as the
strikeout tendency of the lineup that pitcher actually faces.
"""

import os

import pandas as pd

from features.pitch_flags import add_event_flags

STATCAST = 'data/raw/statcast_pitching.parquet'
LINEUPS = 'data/raw/lineups.parquet'
OUT = 'data/processed/lineup_features.parquet'


def aggregate_batter_games(df):
    print("Adding event flags...")
    df = add_event_flags(df)

    print("Aggregating to batter-game level...")
    g = df.groupby(['batter', 'game_pk', 'game_date']).agg(
        n_pa=('is_pa', 'sum'),
        n_k=('is_k', 'sum'),
    ).reset_index()
    g['season'] = g['game_date'].dt.year
    return g


def compute_season_to_date_k_pct(df):
    """Per batter+season: cumulative K% from games BEFORE this game (leakage-safe)."""
    print("Computing season-to-date batter K% (leakage-safe)...")
    df = df.sort_values(['batter', 'season', 'game_date', 'game_pk']).reset_index(drop=True)
    grp = df.groupby(['batter', 'season'])
    cum_pa = grp['n_pa'].cumsum() - df['n_pa']
    cum_k = grp['n_k'].cumsum() - df['n_k']
    df['batter_k_pct'] = cum_k / cum_pa
    return df


def build():
    print("Loading Statcast store...")
    statcast = pd.read_parquet(STATCAST)
    statcast['game_date'] = pd.to_datetime(statcast['game_date'])

    g = aggregate_batter_games(statcast)
    df = compute_season_to_date_k_pct(g)

    print("\nLoading lineups...")
    lineups = pd.read_parquet(LINEUPS)
    print(f"  {len(lineups):,} lineup slots, {lineups['game_pk'].nunique():,} games")

    print("\nJoining batter season-to-date K% onto lineups...")
    merged = lineups.merge(
        df[['batter', 'game_pk', 'batter_k_pct']],
        on=['batter', 'game_pk'], how='left'
    )
    print(f"  Match rate: {merged['batter_k_pct'].notna().mean():.2%}")

    print("\nAveraging over each team's 9 starters per game...")
    out = merged.groupby(['game_pk', 'team']).agg(
        lineup_k_pct=('batter_k_pct', 'mean'),
        n_lineup_matched=('batter_k_pct', 'count'),
    ).reset_index()

    os.makedirs('data/processed', exist_ok=True)
    out.to_parquet(OUT, index=False)

    # ── Data quality report ──────────────────────────────────────────────
    print(f"\nSaved {len(out):,} (game_pk, team) rows to {OUT}")
    print(f"\nlineup_k_pct null rate: {out['lineup_k_pct'].isna().mean():.2%}")
    print(out['lineup_k_pct'].describe())

    print("\nn_lineup_matched distribution:")
    print(out['n_lineup_matched'].value_counts().sort_index())

    print("\nSample rows:")
    print(out[out['lineup_k_pct'].notna()].head(8).to_string(index=False))

    return out


if __name__ == "__main__":
    build()
