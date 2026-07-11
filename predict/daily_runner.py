"""
Daily prediction runner for MLB starting-pitcher strikeout props.

For every probable starting pitcher today:
  1. Pull their L3/L5/L10 rolling form from the most recent tracked start
     (data/processed/pitcher_features.parquet).
  2. Pull the opposing team's L15 rolling offensive features
     (data/processed/opponent_features.parquet).
  3. Pull the park K factor and today's weather for the venue.
  4. Recompute rest_days / prev_pitches / n_prior_starts relative to today.
  5. Score with models/saved/ks_model.pkl (LightGBM Poisson + bias correction)
     to get a projected K count (lambda), then derive P(over X.5) for
     LINES = [4.5, 5.5, 6.5, 7.5, 8.5] via the Poisson distribution.

NOTE on rolling features: the p_* rolling stats (L3/L5/L10) are the same
"stats entering a start" snapshot used to predict that pitcher's most recent
tracked start -- i.e. they are one start stale relative to today (they don't
yet include that most recent start). rest_days, prev_pitches, and
n_prior_starts ARE recomputed relative to today's date so those stay current.

Usage:
    python -m predict.daily_runner              # today (local date)
    python -m predict.daily_runner 2026-06-11    # specific date

Output: data/predictions/ks_predictions_YYYY-MM-DD.csv
"""

import os
import sys
import time
from datetime import date, datetime

import joblib
import numpy as np
import pandas as pd
import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ingestion.fetch_weather import fetch_forecast
from models.train import FEATURES, ROLLING_STATS, WINDOWS
from predict.fair_odds import model_prob_over

MODEL_PATH = 'models/saved/ks_model.pkl'
PITCHER_PATH = 'data/processed/pitcher_features.parquet'
OPPONENT_PATH = 'data/processed/opponent_features.parquet'
UMPIRE_LOOKUP_PATH = 'data/processed/umpire_lookup.parquet'
PARK_PATH = 'data/processed/park_factors_k.csv'
WEATHER_PATH = 'data/processed/weather.parquet'
OUT_DIR = 'data/predictions'

LINES = [4.5, 5.5, 6.5, 7.5, 8.5]

# Games in these states are excluded from predictions and their existing DB rows
# are deleted by write_to_db so they don't appear on the card as broken data.
SKIP_STATUSES = frozenset({'postponed', 'cancelled', 'canceled', 'suspended'})

# MLB Stats API team abbreviations -> our internal (Statcast-derived) abbreviations
TEAM_ALIAS = {'ARI': 'AZ', 'OAK': 'ATH'}


def _mlb(path, params=None, timeout=30):
    url = f'https://statsapi.mlb.com/api/v1/{path}'
    r = requests.get(url, params=params or {}, timeout=timeout)
    r.raise_for_status()
    return r.json()


def _norm_abbr(abbr):
    return TEAM_ALIAS.get(abbr, abbr)


def format_game_time_et(iso_str):
    if not iso_str:
        return ''
    try:
        dt_utc = datetime.strptime(iso_str, '%Y-%m-%dT%H:%M:%SZ')
        dt_et = dt_utc - pd.Timedelta(hours=4)  # approx ET (EDT); fine for display
        return dt_et.strftime('%I:%M %p ET').lstrip('0')
    except (ValueError, TypeError):
        return iso_str


def fetch_schedule(date_str):
    """Return (DataFrame of probable starting pitchers, dict of per-game extras,
    list of postponed/cancelled/suspended game_pks).

    The extras dict maps game_pk -> {'home_lineup': [batter_id, ...9],
    'away_lineup': [batter_id, ...9], 'hp_umpire_id': int or None}, pulled
    from the same schedule call via hydrate=lineups,officials. Lineups are
    often not posted yet for the early pipeline run, in which case the lists
    are empty.

    Postponed/cancelled/suspended games are excluded from the DataFrame and
    their game_pks are returned separately so write_to_db can DELETE any
    existing rows for those games (preventing them from showing on the card).
    """
    print(f"Fetching schedule for {date_str}...")
    data = _mlb('schedule', {
        'sportId': 1,
        'date': date_str,
        'hydrate': 'probablePitcher,team,lineups,officials',
        'gameType': 'R',
    })

    rows = []
    game_extra = {}
    postponed_pks = []
    for d in data.get('dates', []):
        for g in d.get('games', []):
            game_pk = g['gamePk']
            game_time = g.get('gameDate')
            day_night = g.get('dayNight', 'day')
            venue = g.get('venue', {}).get('name', '')
            status = g.get('status', {}).get('detailedState', '')

            if status.lower() in SKIP_STATUSES:
                postponed_pks.append(game_pk)
                print(f"  Skipping {status} game {game_pk}")
                continue

            home = g['teams']['home']
            away = g['teams']['away']
            home_abbr = _norm_abbr(home['team'].get('abbreviation', ''))
            away_abbr = _norm_abbr(away['team'].get('abbreviation', ''))
            home_name = home['team'].get('name', '')
            away_name = away['team'].get('name', '')

            lineups = g.get('lineups', {})
            hp = next((o for o in g.get('officials', [])
                       if o.get('officialType') == 'Home Plate'), None)
            game_extra[game_pk] = {
                'home_lineup': [p['id'] for p in lineups.get('homePlayers', [])[:9]],
                'away_lineup': [p['id'] for p in lineups.get('awayPlayers', [])[:9]],
                'hp_umpire_id': hp['official']['id'] if hp else None,
            }

            for side, team, opp_abbr, opp_name, is_home in (
                (home, home_abbr, away_abbr, away_name, True),
                (away, away_abbr, home_abbr, home_name, False),
            ):
                pp = side.get('probablePitcher')
                if not pp:
                    continue
                rows.append({
                    'game_date': date_str,
                    'game_pk': game_pk,
                    'game_time': game_time,
                    'status': status,
                    'venue': venue,
                    'day_night': day_night,
                    'home_team': home_abbr,
                    'away_team': away_abbr,
                    'pitcher': pp['id'],
                    'pitcher_name': pp.get('fullName', ''),
                    'team': team,
                    'opp_team': opp_abbr,
                    'opp_name': opp_name,
                    'is_home': is_home,
                })

    print(f"  {len(rows)} probable starting pitchers found")
    if postponed_pks:
        print(f"  {len(postponed_pks)} postponed/cancelled game(s) excluded")
    return pd.DataFrame(rows), game_extra, postponed_pks


def fetch_batter_season_k_pct(batter_id, season):
    """SO / PA for a batter's current season, from MLB Stats API season hitting stats."""
    try:
        data = _mlb(f'people/{batter_id}/stats',
                     {'stats': 'season', 'group': 'hitting', 'season': season})
    except requests.RequestException:
        return np.nan

    stats = data.get('stats', [])
    if not stats:
        return np.nan
    splits = stats[0].get('splits', [])
    if not splits:
        return np.nan

    stat = splits[0].get('stat', {})
    pa = stat.get('plateAppearances', 0) or 0
    so = stat.get('strikeOuts', 0) or 0
    if pa == 0:
        return np.nan
    return so / pa


def get_lineup_k_pct(batter_ids, season, cache):
    """Average season K% (SO/PA) across a lineup's confirmed starters.
    NaN if no lineup is posted yet or no batter has any PA this season."""
    if not batter_ids:
        return np.nan

    pcts = []
    for bid in batter_ids:
        if bid not in cache:
            cache[bid] = fetch_batter_season_k_pct(bid, season)
            time.sleep(0.1)
        v = cache[bid]
        if not np.isnan(v):
            pcts.append(v)

    return float(np.mean(pcts)) if pcts else np.nan


def load_umpire_lookup():
    """Per-umpire career ump_k_factor (their avg game-K vs league avg)."""
    if os.path.exists(UMPIRE_LOOKUP_PATH):
        df = pd.read_parquet(UMPIRE_LOOKUP_PATH)
        return df.set_index('umpire_id')['ump_k_factor']
    return pd.Series(dtype=float)


def load_latest_pitcher_state():
    """One row per pitcher: their most recent tracked start that has non-null
    rolling stats (p_k_per9_10 is the sentinel column).

    A pitcher's first-ever start produces a row with all null rolling stats
    because there's no prior history to roll over. Using .last() blindly would
    return that null row for any pitcher whose most recent entry is their debut,
    causing all-dashes on the card. Filtering to non-null rows first means
    pitchers with no valid stats at all are simply absent from the index and
    get skipped cleanly in build_feature_rows().
    """
    df = pd.read_parquet(PITCHER_PATH)
    df['game_date'] = pd.to_datetime(df['game_date'])
    df = df[df['p_k_per9_10'].notna()]
    latest = df.sort_values(['game_date', 'game_pk']).groupby('pitcher').last()
    return latest


def load_latest_opponent_state():
    """One row per team: their most recent L15 rolling offensive features."""
    df = pd.read_parquet(OPPONENT_PATH)
    df['game_date'] = pd.to_datetime(df['game_date'])
    latest = df.sort_values(['game_date', 'game_pk']).groupby('team').last()
    return latest


def load_park_factors():
    df = pd.read_csv(PARK_PATH)
    return df.set_index('park')['park_k_factor']


def get_weather_for_date(date_str, home_teams):
    """Look up historical weather first; fetch a forecast for any home teams
    not found (e.g. today/future games)."""
    target = pd.Timestamp(date_str).normalize()
    home_teams = sorted(set(home_teams))

    # Initialize with the home_team column so set(found['home_team']) is safe
    # even when WEATHER_PATH doesn't exist (e.g. CI env where it's gitignored).
    found = pd.DataFrame(columns=['home_team'])
    if os.path.exists(WEATHER_PATH):
        hist = pd.read_parquet(WEATHER_PATH)
        hist['game_date'] = pd.to_datetime(hist['game_date'])
        found = hist[(hist['game_date'] == target) & (hist['home_team'].isin(home_teams))]

    missing = sorted(set(home_teams) - set(found['home_team']))
    if missing:
        print(f"Fetching weather forecast for {date_str}: {missing}")
        forecast = fetch_forecast(date_str, missing)
        found = pd.concat([found, forecast], ignore_index=True)

    return found.set_index('home_team')


def build_feature_rows(sched, pitcher_state, opp_state, park_factors, weather,
                        game_extra, umpire_lookup):
    rows = []
    skipped = []
    batter_k_cache = {}

    for _, g in sched.iterrows():
        pid = g['pitcher']
        if pid not in pitcher_state.index:
            skipped.append(f"{g['pitcher_name']} ({g['team']}) -- no rolling stats available")
            continue

        last = pitcher_state.loc[pid]
        game_date = pd.Timestamp(g['game_date'])

        row = {col: g[col] for col in
               ['game_date', 'game_pk', 'game_time', 'venue', 'status',
                'pitcher', 'pitcher_name', 'team', 'opp_team', 'home_team',
                'away_team', 'is_home', 'day_night']}

        # Rolling pitcher form (most recent tracked start's snapshot)
        for stat in ROLLING_STATS:
            for w in WINDOWS:
                col = f'{stat}_{w}'
                row[col] = last.get(col, np.nan)

        # Context features, recomputed relative to today
        row['rest_days'] = (game_date - last['game_date']).days
        row['prev_pitches'] = last['pitches']
        row['n_prior_starts'] = last['n_prior_starts'] + 1
        row['is_home'] = int(g['is_home'])
        row['is_night'] = 1 if g['day_night'] == 'night' else 0

        # Opponent rolling features
        opp = g['opp_team']
        if opp in opp_state.index:
            o = opp_state.loc[opp]
            row['opp_k_pct_15'] = o['opp_k_pct_15']
            row['opp_ops_15'] = o['opp_ops_15']
            row['opp_chase_pct_15'] = o['opp_chase_pct_15']
            row['n_prior_team_games'] = o['n_prior_team_games']
        else:
            row['opp_k_pct_15'] = np.nan
            row['opp_ops_15'] = np.nan
            row['opp_chase_pct_15'] = np.nan
            row['n_prior_team_games'] = np.nan

        # Lineup-specific K rate: opposing team's confirmed starting 9
        extra = game_extra.get(g['game_pk'], {})
        opp_lineup = extra.get('away_lineup' if g['is_home'] else 'home_lineup', [])
        row['lineup_k_pct'] = get_lineup_k_pct(opp_lineup, game_date.year, batter_k_cache)

        # Umpire K tendency: today's home-plate umpire vs career average
        hp_umpire_id = extra.get('hp_umpire_id')
        row['ump_k_factor'] = umpire_lookup.get(int(hp_umpire_id), np.nan) if hp_umpire_id else np.nan

        # Park K factor (venue = today's home team)
        home = g['home_team']
        row['park_k_factor'] = park_factors.get(home, np.nan)

        # Weather
        if home in weather.index:
            wx = weather.loc[home]
            row['temp_f'] = wx['temp_f']
            row['wind_speed'] = wx['wind_speed']
            row['wind_favor'] = wx['wind_favor']
            row['is_dome'] = float(wx['is_dome'])
        else:
            row['temp_f'] = np.nan
            row['wind_speed'] = np.nan
            row['wind_favor'] = np.nan
            row['is_dome'] = np.nan

        rows.append(row)

    if skipped:
        print(f"\nSkipped {len(skipped)} probable pitcher(s) with no tracked history:")
        for s in skipped:
            print(f"  - {s}")

    return pd.DataFrame(rows)


def score(df, bundle):
    model = bundle['model']
    bias_correction = bundle['bias_correction']
    features = bundle['features']

    X = df[features]
    pred = np.clip(model.predict(X) + bias_correction, 1e-6, None)
    df = df.copy()
    df['pred_k'] = pred

    for line in LINES:
        df[f'p_over_{line}'] = df['pred_k'].apply(lambda pk: model_prob_over(pk, line))

    return df


def run(date_str=None):
    if date_str is None:
        date_str = date.today().isoformat()

    print("=" * 70)
    print(f"K PROJECTION RUN -- {date_str}")
    print("=" * 70)

    bundle = joblib.load(MODEL_PATH)
    print(f"\nLoaded model from {MODEL_PATH} "
          f"(bias_correction={bundle['bias_correction']:+.4f}, "
          f"{len(bundle['features'])} features)")

    sched, game_extra, postponed_pks = fetch_schedule(date_str)

    if postponed_pks:
        import json
        _pp_dir = 'data/outputs'
        os.makedirs(_pp_dir, exist_ok=True)
        _pp_path = os.path.join(_pp_dir, f'ks_postponed_{date_str}.json')
        with open(_pp_path, 'w') as _f:
            json.dump(list({int(p) for p in postponed_pks}), _f)
        print(f"  Wrote {len(postponed_pks)} postponed game_pk(s) to {_pp_path}")

    if sched.empty:
        print("\nNo probable pitchers found for this date. Nothing to do.")
        return pd.DataFrame()

    pitcher_state = load_latest_pitcher_state()
    opp_state = load_latest_opponent_state()
    park_factors = load_park_factors()
    weather = get_weather_for_date(date_str, sched['home_team'].unique())
    umpire_lookup = load_umpire_lookup()

    feat_df = build_feature_rows(sched, pitcher_state, opp_state, park_factors, weather,
                                  game_extra, umpire_lookup)
    if feat_df.empty:
        print("\nNo pitchers with tracked history for this date. Nothing to score.")
        return pd.DataFrame()

    out = score(feat_df, bundle)

    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, f'ks_predictions_{date_str}.csv')

    cols = (
        ['game_date', 'game_pk', 'game_time', 'venue', 'status', 'away_team', 'home_team',
         'pitcher', 'pitcher_name', 'team', 'opp_team', 'is_home', 'day_night',
         'rest_days', 'prev_pitches', 'n_prior_starts',
         'opp_k_pct_15', 'opp_ops_15', 'opp_chase_pct_15', 'n_prior_team_games',
         'lineup_k_pct', 'ump_k_factor',
         'park_k_factor', 'temp_f', 'wind_speed', 'wind_favor', 'is_dome',
         'pred_k']
        + [f'p_over_{line}' for line in LINES]
        + [f'{stat}_10' for stat in ROLLING_STATS]
    )
    out[cols].to_csv(out_path, index=False)
    print(f"\nSaved {len(out)} predictions to {out_path}")

    # ── Summary ───────────────────────────────────────────────────────────
    print("\n" + "=" * 70)
    print("PROJECTIONS")
    print("=" * 70)
    disp = out[cols].copy()
    disp['game_time'] = disp['game_time'].apply(format_game_time_et)
    for _, r in disp.sort_values('pred_k', ascending=False).iterrows():
        loc = 'vs' if r['is_home'] else '@'
        line_str = '  '.join(f"{line}: {r[f'p_over_{line}']:.0%}" for line in LINES)
        print(f"  {r['pitcher_name']:<24s} {r['team']:>3s} {loc} {r['opp_team']:<3s}  "
              f"({r['game_time']:>10s})  proj K = {r['pred_k']:.2f}   {line_str}")

    return out


if __name__ == '__main__':
    date_arg = sys.argv[1] if len(sys.argv) > 1 else None
    run(date_arg)
