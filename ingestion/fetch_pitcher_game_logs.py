"""
Fetch per-start pitcher game logs from the MLB Stats API for 2021-2026.

This is the TARGET VARIABLE source for the strikeout model: actual strikeouts
(K), innings pitched, hits, walks, earned runs, pitches thrown, and a Bill
James-style game score for each start.

Saves data/raw/pitcher_game_logs.parquet, append-and-dedupe keyed by
(pitcher, game_pk).

Usage:
    python ingestion/fetch_pitcher_game_logs.py
"""

import os
import time
import requests
import pandas as pd
from datetime import date

STORE_PATH = 'data/raw/pitcher_game_logs.parquet'
DEDUPE_COLS = ['pitcher', 'game_pk']


def _parse_ip(ip_str):
    """Convert MLB's '6.2' notation (full innings + thirds) to decimal innings."""
    try:
        parts = str(ip_str).split('.')
        full = int(parts[0])
        thirds = int(parts[1]) if len(parts) > 1 else 0
        return full + thirds / 3.0
    except (ValueError, IndexError, AttributeError):
        return 0.0


def get_starting_pitchers(year):
    """Return list of pitcher MLBAM IDs who started at least one game in a season."""
    r = requests.get(
        'https://statsapi.mlb.com/api/v1/stats',
        params={
            'stats': 'season',
            'group': 'pitching',
            'season': year,
            'playerPool': 'All',
            'sportId': 1,
            'limit': 2000,
        },
        timeout=30,
    )
    r.raise_for_status()

    pitcher_ids = []
    for entry in r.json().get('stats', [{}])[0].get('splits', []):
        stat = entry.get('stat', {})
        if int(stat.get('gamesStarted', 0) or 0) > 0:
            pitcher_ids.append(entry['player']['id'])
    return pitcher_ids


def fetch_pitcher_season(pitcher_id, year):
    """Fetch one pitcher's per-game log for one season, return list of row dicts."""
    r = requests.get(
        f'https://statsapi.mlb.com/api/v1/people/{pitcher_id}/stats',
        params={'stats': 'gameLog', 'group': 'pitching', 'season': year, 'gameType': 'R'},
        timeout=30,
    )
    r.raise_for_status()

    rows = []
    for split in r.json().get('stats', [{}])[0].get('splits', []):
        stat = split.get('stat', {})
        if int(stat.get('gamesStarted', 0) or 0) != 1:
            continue  # only keep starts (rolling windows are "per start", not "per appearance")

        ip = _parse_ip(stat.get('inningsPitched', '0'))
        outs = int(stat.get('outs', 0) or 0)
        h = int(stat.get('hits', 0) or 0)
        bb = int(stat.get('baseOnBalls', 0) or 0)
        k = int(stat.get('strikeOuts', 0) or 0)
        er = int(stat.get('earnedRuns', 0) or 0)
        r_ = int(stat.get('runs', 0) or 0)
        hr = int(stat.get('homeRuns', 0) or 0)
        pitches = int(stat.get('numberOfPitches', 0) or 0)
        strikes = int(stat.get('strikes', 0) or 0)

        # Bill James game score (simplified): start at 50, +1/out, +1/K, -2/H, -2/BB, -4/ER, -2/(unearned R)
        game_score = 50 + outs + k - 2 * h - 2 * bb - 4 * er - 2 * (r_ - er)

        rows.append({
            'pitcher': pitcher_id,
            'season': year,
            'game_pk': split['game']['gamePk'],
            'game_date': split['date'],
            'team_id': split['team']['id'],
            'team_name': split['team']['name'],
            'opponent_id': split['opponent']['id'],
            'opponent_name': split['opponent']['name'],
            'is_home': bool(split.get('isHome', False)),
            'ip': ip,
            'outs': outs,
            'k': k,
            'h': h,
            'bb': bb,
            'er': er,
            'r': r_,
            'hr': hr,
            'pitches': pitches,
            'strikes': strikes,
            'game_score': game_score,
        })
    return rows


def append_and_dedupe(new_df):
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
    current_year = date.today().year
    for year in range(start_year, min(end_year, current_year) + 1):
        print(f"\n=== Season {year} ===")
        pitcher_ids = get_starting_pitchers(year)
        print(f"  {len(pitcher_ids)} pitchers with at least 1 start")

        all_rows = []
        for i, pid in enumerate(pitcher_ids, 1):
            try:
                rows = fetch_pitcher_season(pid, year)
                all_rows.extend(rows)
            except Exception as e:
                print(f"  pitcher {pid} FAILED: {e}")
            if i % 50 == 0:
                print(f"  ...{i}/{len(pitcher_ids)} pitchers done")
            time.sleep(0.2)

        if all_rows:
            df = pd.DataFrame(all_rows)
            print(f"  {len(df)} starts pulled for {year}")
            append_and_dedupe(df)
        else:
            print("  No rows pulled for this season.")

    final = pd.read_parquet(STORE_PATH)
    print(f"\nBACKFILL DONE. Total: {len(final)} starts, seasons {sorted(final['season'].unique())}")


if __name__ == "__main__":
    backfill(2021, 2026)
