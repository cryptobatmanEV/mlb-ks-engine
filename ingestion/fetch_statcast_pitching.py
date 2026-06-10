"""
Pull pitch-level Statcast data for ALL pitches (every pitcher, every game),
2021-2026, and store it in data/raw/statcast_pitching.parquet.

Unlike the HR tool (which keeps only batted balls), this keeps EVERY pitch,
because strikeout features need swings, takes, called strikes, balls, etc.
- not just balls put in play.

Usage:
    python ingestion/fetch_statcast_pitching.py
"""

from pybaseball import statcast
import pybaseball
import pandas as pd
import os
from datetime import date

pybaseball.cache.enable()

KEEP_COLS = [
    'game_date', 'game_year', 'game_pk',
    'pitcher', 'batter', 'player_name',
    'pitch_type', 'release_speed', 'release_spin_rate',
    'pfx_x', 'pfx_z', 'plate_x', 'plate_z', 'zone',
    'description', 'type', 'events',
    'balls', 'strikes', 'outs_when_up',
    'at_bat_number', 'pitch_number',
    'stand', 'p_throws',
    'home_team', 'away_team', 'inning', 'inning_topbot',
]

STORE_PATH = 'data/raw/statcast_pitching.parquet'

# A pitch is uniquely identified by the game + pitcher + at-bat + pitch number
DEDUPE_COLS = ['game_pk', 'pitcher', 'at_bat_number', 'pitch_number']


def season_range(year):
    """Return (start, end) date strings for a season. Current season ends today."""
    start = f'{year}-03-15'
    if year < date.today().year:
        end = f'{year}-11-05'  # cover postseason too
    else:
        end = date.today().isoformat()
    return start, end


def pull_range(start, end):
    """Pull all pitches for a date range, trimmed to needed columns."""
    print(f"Pulling {start} to {end}...")
    df = statcast(start, end)
    if df is None or len(df) == 0:
        print("  No data returned.")
        return pd.DataFrame()
    cols = [c for c in KEEP_COLS if c in df.columns]
    df = df[cols]
    df = df[df['pitcher'].notna()]
    print(f"  Got {len(df)} pitches")
    return df


def append_and_dedupe(new_df):
    """Append new data to the permanent store, removing duplicates."""
    os.makedirs('data/raw', exist_ok=True)
    if os.path.exists(STORE_PATH):
        existing = pd.read_parquet(STORE_PATH)
        combined = pd.concat([existing, new_df], ignore_index=True)
    else:
        combined = new_df

    before = len(combined)
    combined = combined.drop_duplicates(subset=DEDUPE_COLS, keep='last')
    after = len(combined)
    combined.to_parquet(STORE_PATH, index=False)
    print(f"  Store now has {after} rows ({before - after} dupes removed)")
    return combined


def backfill(start_year=2021, end_year=2026):
    """One-time historical load, season by season (in monthly chunks to keep memory reasonable)."""
    for year in range(start_year, end_year + 1):
        start, end = season_range(year)
        if start > end:
            continue
        # Pull in ~1-month chunks so a single failure doesn't lose a whole season
        chunk_start = pd.Timestamp(start)
        season_end = pd.Timestamp(end)
        while chunk_start <= season_end:
            chunk_end = min(chunk_start + pd.Timedelta(days=29), season_end)
            df = pull_range(chunk_start.date().isoformat(), chunk_end.date().isoformat())
            if not df.empty:
                append_and_dedupe(df)
            chunk_start = chunk_end + pd.Timedelta(days=1)

    final = pd.read_parquet(STORE_PATH)
    print(f"\nBACKFILL DONE. Total: {len(final)} rows, seasons {sorted(final['game_year'].unique())}")


if __name__ == "__main__":
    backfill(2021, 2026)
