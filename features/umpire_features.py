"""
Build umpire strikeout-tendency features (FEATURE 2), leakage-safe.

For each game, total strikeouts (every batter/pitcher in the game) are
computed from Statcast and joined to data/raw/officials.parquet for the
home-plate umpire. For each umpire, ump_k_factor compares that umpire's
career-to-date average game-K (games BEFORE this one) to the league's
average game-K over that same prior history -- e.g. 1.05 = 5% more
strikeouts than league average under this umpire. NaN when there's no prior
history for that umpire (their first tracked game) or no HP umpire is
recorded for the game.

Output:
  data/processed/umpire_features.parquet -- one row per game_pk: ump_k_factor
  data/processed/umpire_lookup.parquet   -- one row per umpire: career
                                             ump_k_factor using ALL data,
                                             for live daily lookups
"""

import os

import numpy as np
import pandas as pd

from features.pitch_flags import add_event_flags

STATCAST = 'data/raw/statcast_pitching.parquet'
OFFICIALS = 'data/raw/officials.parquet'
OUT = 'data/processed/umpire_features.parquet'
LOOKUP_OUT = 'data/processed/umpire_lookup.parquet'


def game_totals(df):
    print("Adding event flags...")
    df = add_event_flags(df)
    print("Aggregating total strikeouts per game...")
    g = df.groupby(['game_pk', 'game_date']).agg(game_k=('is_k', 'sum')).reset_index()
    return g


def build():
    print("Loading Statcast store...")
    statcast = pd.read_parquet(STATCAST)
    statcast['game_date'] = pd.to_datetime(statcast['game_date'])

    g = game_totals(statcast)

    print("\nLoading officials...")
    officials = pd.read_parquet(OFFICIALS)
    df = g.merge(officials[['game_pk', 'hp_umpire_id', 'hp_umpire_name']], on='game_pk', how='left')
    print(f"  HP umpire match rate: {df['hp_umpire_id'].notna().mean():.2%}")

    df = df.sort_values(['game_date', 'game_pk']).reset_index(drop=True)

    print("\nComputing leakage-safe league-average game-K (prior games only)...")
    league_cum_k = df['game_k'].cumsum() - df['game_k']
    league_cum_n = pd.Series(np.arange(len(df)), index=df.index)
    league_avg_prior = league_cum_k / league_cum_n.replace(0, np.nan)

    print("Computing leakage-safe per-umpire career game-K (prior games only)...")
    has_ump = df['hp_umpire_id'].notna()
    sub = df[has_ump]
    grp = sub.groupby('hp_umpire_id')
    ump_cum_k = grp['game_k'].cumsum() - sub['game_k']
    ump_cum_n = grp.cumcount()
    ump_avg_prior = ump_cum_k / ump_cum_n.replace(0, np.nan)

    df['ump_k_factor'] = np.nan
    df.loc[has_ump, 'ump_k_factor'] = (ump_avg_prior / league_avg_prior[has_ump]).values

    out = df[['game_pk', 'game_date', 'hp_umpire_id', 'hp_umpire_name', 'ump_k_factor']]
    os.makedirs('data/processed', exist_ok=True)
    out.to_parquet(OUT, index=False)

    # ── Data quality report ──────────────────────────────────────────────
    print(f"\nSaved {len(out):,} rows to {OUT}")
    print(f"ump_k_factor null rate: {out['ump_k_factor'].isna().mean():.2%}")
    print(out['ump_k_factor'].describe())

    # ── Lookup table for live daily use: career averages over ALL data ────
    print("\nBuilding umpire lookup table (career averages, all data)...")
    league_avg_all = df['game_k'].mean()
    lookup = df[has_ump].groupby(['hp_umpire_id', 'hp_umpire_name']).agg(
        n_games=('game_k', 'count'),
        avg_game_k=('game_k', 'mean'),
    ).reset_index()
    lookup['ump_k_factor'] = lookup['avg_game_k'] / league_avg_all
    lookup['hp_umpire_id'] = lookup['hp_umpire_id'].astype(int)
    lookup = lookup.rename(columns={'hp_umpire_id': 'umpire_id', 'hp_umpire_name': 'umpire_name'})
    lookup.to_parquet(LOOKUP_OUT, index=False)
    print(f"Saved {len(lookup):,} umpires to {LOOKUP_OUT}")

    print("\nMost-active umpires:")
    print(lookup.sort_values('n_games', ascending=False).head(10).to_string(index=False))

    print("\nHighest ump_k_factor (min 50 games):")
    print(lookup[lookup['n_games'] >= 50].sort_values('ump_k_factor', ascending=False)
          .head(5).to_string(index=False))
    print("\nLowest ump_k_factor (min 50 games):")
    print(lookup[lookup['n_games'] >= 50].sort_values('ump_k_factor')
          .head(5).to_string(index=False))

    return out


if __name__ == "__main__":
    build()
