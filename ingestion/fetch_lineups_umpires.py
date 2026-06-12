"""
Fetch starting lineups and home-plate umpires for each game date from the
MLB Stats API (schedule with hydrate=lineups,officials).

A single per-date schedule call covers every game that day for both lineups
(9 confirmed starters per team, in batting order) and officials (including
the home-plate umpire).

Output:
  data/raw/lineups.parquet   -- one row per (game_pk, team, batter, batting_order)
  data/raw/officials.parquet -- one row per game_pk: home_team, away_team,
                                 hp_umpire_id, hp_umpire_name

Usage:
    python -m ingestion.fetch_lineups_umpires            # backfill all dates
                                                          # found in the Statcast store
    python -m ingestion.fetch_lineups_umpires --update   # only dates not yet fetched
"""

import os
import sys
import time

import pandas as pd
import requests

STATCAST = 'data/raw/statcast_pitching.parquet'
LINEUPS_PATH = 'data/raw/lineups.parquet'
OFFICIALS_PATH = 'data/raw/officials.parquet'

LINEUP_DEDUPE_COLS = ['game_pk', 'team', 'batter']
OFFICIALS_DEDUPE_COLS = ['game_pk']

# MLB Stats API team abbreviations -> our internal (Statcast-derived) abbreviations
TEAM_ALIAS = {'ARI': 'AZ', 'OAK': 'ATH'}


def _norm_abbr(abbr):
    return TEAM_ALIAS.get(abbr, abbr)


def fetch_date(date_str):
    """Return (lineup_rows, official_rows) for every game on this date."""
    r = requests.get(
        'https://statsapi.mlb.com/api/v1/schedule',
        params={'sportId': 1, 'date': date_str, 'hydrate': 'lineups,officials,team', 'gameType': 'R'},
        timeout=30,
    )
    r.raise_for_status()
    data = r.json()

    lineup_rows = []
    official_rows = []
    for d in data.get('dates', []):
        for g in d.get('games', []):
            game_pk = g['gamePk']
            home_abbr = _norm_abbr(g['teams']['home']['team'].get('abbreviation', ''))
            away_abbr = _norm_abbr(g['teams']['away']['team'].get('abbreviation', ''))

            lineups = g.get('lineups', {})
            for side, team in (('homePlayers', home_abbr), ('awayPlayers', away_abbr)):
                for order, player in enumerate(lineups.get(side, [])[:9], 1):
                    lineup_rows.append({
                        'game_pk': game_pk,
                        'game_date': date_str,
                        'team': team,
                        'batter': player['id'],
                        'batting_order': order,
                    })

            hp = next((o for o in g.get('officials', [])
                       if o.get('officialType') == 'Home Plate'), None)
            official_rows.append({
                'game_pk': game_pk,
                'game_date': date_str,
                'home_team': home_abbr,
                'away_team': away_abbr,
                'hp_umpire_id': hp['official']['id'] if hp else None,
                'hp_umpire_name': hp['official'].get('fullName') if hp else None,
            })

    return lineup_rows, official_rows


def append_and_dedupe(path, new_df, dedupe_cols):
    os.makedirs('data/raw', exist_ok=True)
    if os.path.exists(path):
        existing = pd.read_parquet(path)
        combined = pd.concat([existing, new_df], ignore_index=True)
    else:
        combined = new_df

    before = len(combined)
    combined = combined.drop_duplicates(subset=dedupe_cols, keep='last')
    after = len(combined)
    combined.to_parquet(path, index=False)
    print(f"  {os.path.basename(path)} now has {after} rows ({before - after} dupes removed)")
    return combined


def get_target_dates(update_only=False):
    statcast = pd.read_parquet(STATCAST, columns=['game_date'])
    all_dates = sorted(pd.to_datetime(statcast['game_date']).dt.strftime('%Y-%m-%d').unique())

    if update_only and os.path.exists(OFFICIALS_PATH):
        existing = pd.read_parquet(OFFICIALS_PATH, columns=['game_date'])
        done = set(pd.to_datetime(existing['game_date']).dt.strftime('%Y-%m-%d').unique())
        all_dates = [d for d in all_dates if d not in done]

    return all_dates


def backfill(update_only=False, checkpoint_every=25):
    dates = get_target_dates(update_only=update_only)
    print(f"{len(dates)} date(s) to fetch...")

    lineup_buf, official_buf = [], []
    for i, d in enumerate(dates, 1):
        try:
            lr, orow = fetch_date(d)
            lineup_buf.extend(lr)
            official_buf.extend(orow)
        except Exception as e:
            print(f"  {d} FAILED: {e}")

        if i % checkpoint_every == 0 or i == len(dates):
            if lineup_buf:
                append_and_dedupe(LINEUPS_PATH, pd.DataFrame(lineup_buf), LINEUP_DEDUPE_COLS)
                lineup_buf = []
            if official_buf:
                append_and_dedupe(OFFICIALS_PATH, pd.DataFrame(official_buf), OFFICIALS_DEDUPE_COLS)
                official_buf = []
            print(f"  ...{i}/{len(dates)} dates done")

        time.sleep(0.15)

    print("\nDONE.")
    if os.path.exists(LINEUPS_PATH):
        lu = pd.read_parquet(LINEUPS_PATH)
        print(f"lineups.parquet: {len(lu):,} rows, {lu['game_pk'].nunique():,} games")
    if os.path.exists(OFFICIALS_PATH):
        of = pd.read_parquet(OFFICIALS_PATH)
        print(f"officials.parquet: {len(of):,} rows, "
              f"hp_umpire_id null rate = {of['hp_umpire_id'].isna().mean():.2%}")


if __name__ == "__main__":
    backfill(update_only='--update' in sys.argv)
