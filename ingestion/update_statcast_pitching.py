"""
Incremental updater for data/raw/statcast_pitching.parquet.

Pulls only the pitches thrown since the last date already in the store and
appends/dedupes them. Run this daily/weekly to keep the store current.

Usage:
    python ingestion/update_statcast_pitching.py
"""

from pybaseball import statcast
import pybaseball
import pandas as pd
import os
from datetime import date, timedelta

pybaseball.cache.enable()

STORE_PATH = 'data/raw/statcast_pitching.parquet'

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

# A pitch is uniquely identified by the game + pitcher + at-bat + pitch number
DEDUPE_COLS = ['game_pk', 'pitcher', 'at_bat_number', 'pitch_number']


def get_last_date():
    """Find the most recent game date already in the store."""
    if not os.path.exists(STORE_PATH):
        print("No store found. Run fetch_statcast_pitching.py backfill first.")
        return None
    df = pd.read_parquet(STORE_PATH, columns=['game_date'])
    last = pd.to_datetime(df['game_date']).max().date()
    print(f"Latest game in store: {last}")
    return last


def update():
    """Pull only games since the last update and append them."""
    last = get_last_date()
    if last is None:
        return

    start = (last - timedelta(days=1)).isoformat()  # re-pull last day too, in case it was incomplete
    end = date.today().isoformat()

    if start > end:
        print("Store is already current. Nothing to pull.")
        return

    print(f"Pulling new pitches: {start} to {end}...")
    df = statcast(start, end)

    if df is None or len(df) == 0:
        print("No new games found.")
        return

    cols = [c for c in KEEP_COLS if c in df.columns]
    df = df[cols]
    df = df[df['pitcher'].notna()]
    print(f"  New pitches: {len(df)}")

    existing = pd.read_parquet(STORE_PATH)
    combined = pd.concat([existing, df], ignore_index=True)
    before = len(combined)
    combined = combined.drop_duplicates(subset=DEDUPE_COLS, keep='last')
    after = len(combined)
    combined.to_parquet(STORE_PATH, index=False)
    print(f"  Store updated: {after} rows ({before - after} dupes removed)")


if __name__ == "__main__":
    update()
