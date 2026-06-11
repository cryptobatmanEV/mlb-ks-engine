"""
Compute strikeout park factors from our own Statcast data.

Method: for each park (home_team), compute K% per plate appearance across all
games played there (2021-2026), then express it relative to the league-wide
K% per PA. 100 = neutral, 105 = batters strike out 5% more often than average
at this park, 95 = 5% less often.

Output: data/processed/park_factors_k.csv
Columns: park, n_pa, k_pct, park_k_factor
"""

import pandas as pd
import os

from features.pitch_flags import add_event_flags

STATCAST = 'data/raw/statcast_pitching.parquet'
OUT = 'data/processed/park_factors_k.csv'


def compute():
    print("Loading Statcast store...")
    df = pd.read_parquet(STATCAST, columns=['home_team', 'events'])
    df = add_event_flags(df)
    df = df[df['is_pa']]
    print(f"  {len(df):,} plate appearances across {df['home_team'].nunique()} parks")

    league_k_pct = df['is_k'].mean()
    print(f"  League-wide K%% per PA: {league_k_pct:.3%}")

    g = df.groupby('home_team').agg(
        n_pa=('is_k', 'size'),
        k_pct=('is_k', 'mean'),
    ).reset_index()
    g = g.rename(columns={'home_team': 'park'})
    g['park_k_factor'] = (100 * g['k_pct'] / league_k_pct).round(1)
    g['k_pct'] = (g['k_pct'] * 100).round(2)
    g = g.sort_values('park_k_factor', ascending=False)

    os.makedirs('data/processed', exist_ok=True)
    g.to_csv(OUT, index=False)

    print(f"\nSaved {len(g)} park rows to {OUT}")
    print("\nTop 5 K parks:")
    print(g.head(5).to_string(index=False))
    print("\nBottom 5 K parks:")
    print(g.tail(5).to_string(index=False))
    return g


if __name__ == "__main__":
    compute()
