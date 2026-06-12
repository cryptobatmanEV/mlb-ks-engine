"""
Pull sportsbook strikeout-prop lines (the-odds-api.com, market=pitcher_strikeouts)
and PrizePicks pitcher-strikeout projections, match them to today's model
projections (data/predictions/ks_predictions_{date}.csv), and compute edge.

For every line, the model computes BOTH P(over) and P(under) (P(under) =
1 - P(over), exact for X.5 lines) and picks whichever side has the larger
edge vs. the market's implied probability:

  edge_book = model_prob_for_book_side - book_implied_prob_for_that_side
  edge_pp   = model_prob_for_pp_side   - 0.543  (PrizePicks standard pick'em
                                                   is -119, implied = 119/219)

`book_side` / `pp_side` ('over' / 'under') record which side was chosen.

Usage:
    python -m predict.fair_odds              # today
    python -m predict.fair_odds 2026-06-11    # specific date

Output: data/outputs/ks_fair_odds_YYYY-MM-DD.csv
"""

import os
import re
import sys
import time
import unicodedata
from datetime import date, datetime, timedelta

import pandas as pd
import requests
from dotenv import load_dotenv
from scipy.stats import poisson

load_dotenv()

ODDS_KEY = os.getenv('ODDS_API_KEY') or os.getenv('ODDSPAPI_KEY')
ODDS_BASE = 'https://api.the-odds-api.com'
PRED_DIR = 'data/predictions'
OUT_DIR = 'data/outputs'

PRIZEPICKS_URL = 'https://api.prizepicks.com/projections'
PRIZEPICKS_PARAMS = {'league_id': 2, 'per_page': 250}  # league_id 2 = MLB
PRIZEPICKS_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                   '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://app.prizepicks.com',
    'Referer': 'https://app.prizepicks.com/',
}
PRIZEPICKS_STAT_TYPE = 'Pitcher Strikeouts'  # exact match -- excludes "(Combo)" and "Hitter Strikeouts"

# Keywords (lowercase) in OddsAPI team names that identify each MLB abbreviation.
# Same list as mlb-prop-engine/predict/fair_odds.py (already AZ/ATH-compatible).
_TEAM_KEYS = [
    ('AZ',  ['diamondbacks']),
    ('ATL', ['atlanta']),
    ('BAL', ['baltimore']),
    ('BOS', ['boston']),
    ('CHC', ['cubs']),
    ('CWS', ['white sox']),
    ('CIN', ['cincinnati']),
    ('CLE', ['cleveland']),
    ('COL', ['colorado']),
    ('DET', ['detroit']),
    ('HOU', ['houston']),
    ('KC',  ['kansas city']),
    ('LAA', ['angels']),
    ('LAD', ['dodgers']),
    ('MIA', ['miami']),
    ('MIL', ['milwaukee']),
    ('MIN', ['minnesota']),
    ('NYM', ['mets']),
    ('NYY', ['yankees']),
    ('ATH', ['athletics']),
    ('PHI', ['philadelphia']),
    ('PIT', ['pittsburgh']),
    ('SD',  ['san diego', 'padres']),
    ('SEA', ['seattle']),
    ('SF',  ['san francisco', 'giants']),
    ('STL', ['cardinals']),
    ('TB',  ['tampa bay']),
    ('TEX', ['texas', 'rangers']),
    ('TOR', ['toronto']),
    ('WSH', ['washington']),
]
_ABBR_KEYS = {abbr: keys for abbr, keys in _TEAM_KEYS}


# ── Utilities ─────────────────────────────────────────────────────────────────

def american_to_implied(odds):
    odds = float(odds)
    return 100.0 / (odds + 100.0) if odds > 0 else abs(odds) / (abs(odds) + 100.0)


def implied_to_american(p):
    if pd.isna(p) or p <= 0 or p >= 1:
        return None
    if p >= 0.5:
        return int(round(-p / (1.0 - p) * 100))
    return int(round((1.0 - p) / p * 100))


def norm_name(name):
    name = unicodedata.normalize('NFKD', str(name))
    name = ''.join(c for c in name if not unicodedata.combining(c))
    return re.sub(r'[^a-z ]', '', name.lower().strip())


# Shrinkage applied to Poisson-derived probabilities to correct for mild
# overconfidence in large edges. Derived from models/edge_calibration.py:
# a negative-binomial distribution (overdispersion alpha ~0.024, estimated
# from holdout residuals) did not calibrate meaningfully better than Poisson,
# so instead probabilities are pulled toward 0.5 by this factor. On the
# 2025 H2 + 2026 holdout this took the 10%+ predicted-edge bucket from
# predicted=0.692/actual=0.675 (gap +0.017) to predicted=0.679/actual=0.675
# (gap +0.003), with similar improvements in the other edge buckets.
EDGE_SCALE = 0.90


def model_prob_over(pred_k, line):
    """P(actual K > line), Poisson(pred_k) shrunk toward 0.5 by EDGE_SCALE
    to correct for mild overconfidence at large predicted edges."""
    p_over = float(1 - poisson.cdf(int(line), pred_k))
    return 0.5 + (p_over - 0.5) * EDGE_SCALE


def _odds_get(path, params=None, timeout=20):
    r = requests.get(f'{ODDS_BASE}{path}',
                     params={**(params or {}), 'apiKey': ODDS_KEY},
                     timeout=timeout)
    r.raise_for_status()
    return r, r.json()


# ── [1] Load predictions ───────────────────────────────────────────────────────

def load_predictions(date_str):
    path = os.path.join(PRED_DIR, f'ks_predictions_{date_str}.csv')
    if os.path.exists(path):
        df = pd.read_csv(path)
        print(f"  Loaded {len(df)} predictions from {path}")
        return df
    print(f"  No predictions file for {date_str} -- running daily_runner first...")
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    import predict.daily_runner as runner
    runner.run(date_str)
    if not os.path.exists(path):
        raise SystemExit("daily_runner produced no output -- check errors above.")
    df = pd.read_csv(path)
    print(f"  Generated and loaded {len(df)} predictions.")
    return df


# ── [2] OddsAPI: events list (1 credit) ────────────────────────────────────────

def fetch_events_list(date_str):
    """Fetch all MLB events from OddsAPI and filter to a 36-hour window for date_str."""
    if not ODDS_KEY:
        print("  ODDS_API_KEY not set -- skipping sportsbook lines.")
        return [], '?'

    try:
        r, events = _odds_get('/v4/sports/baseball_mlb/events', {'dateFormat': 'iso'})
        remaining = r.headers.get('x-requests-remaining', '?')
    except requests.HTTPError as e:
        code = e.response.status_code
        body = {}
        try:
            body = e.response.json()
        except Exception:
            pass
        if code == 401:
            print("  OddsAPI auth failed (401). Check ODDS_API_KEY in .env.")
        else:
            print(f"  OddsAPI events failed ({code}): {body.get('message', '')}")
        return [], '?'
    except Exception as e:
        print(f"  OddsAPI events error: {e}")
        return [], '?'

    window_start = f"{date_str}T00:00:00Z"
    next_day = (datetime.fromisoformat(date_str) + timedelta(days=1)).strftime('%Y-%m-%d')
    window_end = f"{next_day}T09:00:00Z"
    today_events = [
        e for e in events
        if window_start <= e.get('commence_time', '') < window_end
    ]
    print(f"  {len(today_events)} events in OddsAPI window "
          f"[{date_str} 00:00Z - {next_day} 09:00Z] | {remaining} credits remaining")
    return today_events, remaining


def _team_matches_abbr(abbr, odds_name):
    keys = _ABBR_KEYS.get(abbr, [abbr.lower()])
    name_lower = odds_name.lower()
    return any(k in name_lower for k in keys)


def match_games_to_events(pred_df, events):
    """Map each game_pk in pred_df to an OddsAPI event ID by home/away team name."""
    games = pred_df[['game_pk', 'home_team', 'away_team']].drop_duplicates()
    mapping = {}
    for _, g in games.iterrows():
        for ev in events:
            if (_team_matches_abbr(g['home_team'], ev.get('home_team', '')) and
                    _team_matches_abbr(g['away_team'], ev.get('away_team', ''))):
                mapping[int(g['game_pk'])] = ev['id']
                break
    return mapping


# ── [3] OddsAPI: pitcher_strikeouts props per event (1 credit each) ────────────

def fetch_pitcher_strikeout_props(event_ids):
    """Fetch market=pitcher_strikeouts for each event ID. 1 credit per event."""
    if not event_ids:
        return pd.DataFrame(), 0, 0, '?'

    rows, credits_used, failed, last_remaining = [], 0, 0, '?'

    for event_id in event_ids:
        try:
            r, data = _odds_get(
                f'/v4/sports/baseball_mlb/events/{event_id}/odds',
                {'regions': 'us,us_ex', 'markets': 'pitcher_strikeouts',
                 'oddsFormat': 'american'},
            )
            last_remaining = r.headers.get('x-requests-remaining', last_remaining)
            credits_used += 1
            for bm in data.get('bookmakers', []):
                for mkt in bm.get('markets', []):
                    if mkt['key'] != 'pitcher_strikeouts':
                        continue
                    for outcome in mkt.get('outcomes', []):
                        point = outcome.get('point')
                        if point is None:
                            continue
                        rows.append({
                            'player_name_raw': outcome.get('description', ''),
                            'side': outcome.get('name'),  # 'Over' / 'Under'
                            'point': float(point),
                            'odds_american': int(outcome['price']),
                            'bookmaker': bm['key'],
                            'event_id': event_id,
                        })
            time.sleep(0.4)
        except requests.HTTPError as e:
            code = e.response.status_code
            if code == 422:
                print(f"  pitcher_strikeouts unavailable (422) for event {event_id} "
                      f"-- may need a higher OddsAPI tier.")
            else:
                print(f"  HTTP {code} fetching props for event {event_id}")
            failed += 1
        except Exception as e:
            print(f"  Error fetching props for event {event_id}: {e}")
            failed += 1

    if not rows:
        return pd.DataFrame(), credits_used, failed, last_remaining

    df = pd.DataFrame(rows)
    df['name_norm'] = df['player_name_raw'].apply(norm_name)
    df['implied'] = df['odds_american'].apply(american_to_implied)
    return df, credits_used, failed, last_remaining


def join_sportsbook_odds(pred_df, odds_df):
    """
    For each pitcher, pick the consensus betting line (most common point
    among 'Over' outcomes), find the best (highest) price for both Over and
    Under at that line, compute the model's P(over)/P(under), and choose
    whichever side has the larger edge vs. that side's book-implied
    probability. `book_side` records which side ('over'/'under') was chosen,
    and `best_odds`/`best_book`/`book_implied`/`model_prob_book_line`/
    `edge_book` describe that chosen side.
    """
    df = pred_df.copy()
    df['name_norm'] = df['pitcher_name'].apply(norm_name)

    if odds_df.empty:
        df['has_line'] = 0
        df['book_line'] = None
        df['book_side'] = None
        df['best_book'] = None
        df['best_odds'] = None
        df['book_implied'] = None
        df['model_prob_book_line'] = None
        df['edge_book'] = None
        return df.drop(columns=['name_norm'])

    overs = odds_df[odds_df['side'] == 'Over']

    # Consensus line per player = most frequently quoted Over point
    consensus = (overs.groupby(['name_norm', 'point']).size()
                  .reset_index(name='n')
                  .sort_values(['name_norm', 'n'], ascending=[True, False])
                  .groupby('name_norm').first()
                  .reset_index()[['name_norm', 'point']]
                  .rename(columns={'point': 'book_line'}))

    def best_side(side_name):
        """Best (highest) price for one side at each pitcher's consensus line."""
        prefix = side_name.lower()
        side_df = odds_df[odds_df['side'] == side_name]
        return (side_df.merge(consensus, left_on=['name_norm', 'point'],
                               right_on=['name_norm', 'book_line'])
                .sort_values('odds_american', ascending=False)
                .groupby('name_norm', as_index=False).first()
                [['name_norm', 'bookmaker', 'odds_american', 'implied']]
                .rename(columns={'bookmaker': f'{prefix}_book',
                                  'odds_american': f'{prefix}_odds',
                                  'implied': f'{prefix}_implied'}))

    df = df.merge(consensus, on='name_norm', how='left')
    df = df.merge(best_side('Over'), on='name_norm', how='left')
    df = df.merge(best_side('Under'), on='name_norm', how='left').drop(columns=['name_norm'])

    def _pick_side(r):
        if pd.isna(r['book_line']):
            return pd.Series([None, None, None, None, None, None])

        p_over = model_prob_over(r['pred_k'], r['book_line'])
        p_under = 1.0 - p_over

        edge_over = (p_over - r['over_implied']) if pd.notna(r['over_implied']) else None
        edge_under = (p_under - r['under_implied']) if pd.notna(r['under_implied']) else None

        if edge_over is None and edge_under is None:
            return pd.Series([None, None, None, None, None, None])

        if edge_under is None or (edge_over is not None and edge_over >= edge_under):
            return pd.Series(['over', p_over, r['over_implied'], round(edge_over, 4),
                               r['over_book'], r['over_odds']])
        return pd.Series(['under', p_under, r['under_implied'], round(edge_under, 4),
                           r['under_book'], r['under_odds']])

    picked = df.apply(_pick_side, axis=1)
    picked.columns = ['book_side', 'model_prob_book_line', 'book_implied',
                       'edge_book', 'best_book', 'best_odds']
    df = pd.concat([df, picked], axis=1)
    df['has_line'] = df['book_side'].notna().astype(int)

    return df.drop(columns=['over_book', 'over_odds', 'over_implied',
                             'under_book', 'under_odds', 'under_implied'],
                    errors='ignore')


# ── [4] PrizePicks projections ──────────────────────────────────────────────────

def fetch_prizepicks_strikeouts():
    """Fetch MLB pitcher-strikeout 'standard' projections from PrizePicks."""
    try:
        r = requests.get(PRIZEPICKS_URL, params=PRIZEPICKS_PARAMS,
                          headers=PRIZEPICKS_HEADERS, timeout=20)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"  PrizePicks fetch failed: {e}")
        return pd.DataFrame()

    players = {
        item['id']: item.get('attributes', {}).get('name', '')
        for item in data.get('included', [])
        if item.get('type') == 'new_player'
    }

    rows = []
    for proj in data.get('data', []):
        attrs = proj.get('attributes', {})
        if attrs.get('stat_type') != PRIZEPICKS_STAT_TYPE:
            continue  # excludes "Pitcher Strikeouts (Combo)" and "Hitter Strikeouts"
        if attrs.get('odds_type', 'standard') != 'standard':
            continue  # skip demon/goblin alt lines

        player_id = proj.get('relationships', {}).get('new_player', {}).get('data', {}).get('id')
        player_name = players.get(player_id, '')
        line = attrs.get('line_score')
        if not player_name or line is None:
            continue

        rows.append({
            'player_name_raw': player_name,
            'pp_line': float(line),
        })

    df = pd.DataFrame(rows)
    if not df.empty:
        df['name_norm'] = df['player_name_raw'].apply(norm_name)
        df = df.drop_duplicates(subset='name_norm')
    return df


PP_IMPLIED = 119.0 / 219.0  # PrizePicks standard pick'em pricing is -119 -> ~54.3%


def join_prizepicks(pred_df, pp_df):
    """
    Match PrizePicks lines onto predictions. Picks whichever side (over/under)
    the model favors and computes edge vs. PrizePicks' standard -119 pricing
    (implied probability 119/219 ~= 54.3%) for that side.
    """
    df = pred_df.copy()
    df['name_norm'] = df['pitcher_name'].apply(norm_name)

    if pp_df.empty:
        df['pp_line'] = None
        df['pp_side'] = None
        df['model_prob_pp_line'] = None
        df['edge_pp'] = None
        return df.drop(columns=['name_norm'])

    df = df.merge(pp_df[['name_norm', 'pp_line']], on='name_norm', how='left').drop(columns=['name_norm'])
    df['pp_side'] = None
    df['model_prob_pp_line'] = None

    has_pp = df['pp_line'].notna()
    if has_pp.any():
        p_over = df.loc[has_pp].apply(lambda r: model_prob_over(r['pred_k'], r['pp_line']), axis=1)
        df.loc[has_pp, 'pp_side'] = (p_over >= 0.5).map({True: 'over', False: 'under'})
        df.loc[has_pp, 'model_prob_pp_line'] = p_over.where(p_over >= 0.5, 1.0 - p_over)

    df['model_prob_pp_line'] = pd.to_numeric(df['model_prob_pp_line'], errors='coerce')
    df['edge_pp'] = (df['model_prob_pp_line'] - PP_IMPLIED).where(has_pp).round(4)
    return df


# ── [5] Edge sanity check ───────────────────────────────────────────────────────

def print_edge_sanity_check(df):
    print(f"\n{'=' * 60}")
    print("EDGE SANITY CHECK")
    print(f"{'=' * 60}")

    n_book = int(df['has_line'].sum())
    n_pp = int(df['pp_line'].notna().sum())
    print(f"Pitchers projected:        {len(df)}")
    print(f"With sportsbook line:      {n_book}")
    print(f"With PrizePicks line:      {n_pp}")

    if n_book:
        e = df.loc[df['has_line'] == 1, 'edge_book'].dropna()
        print(f"\nSportsbook edge (model_prob_for_side - book_implied_for_side):")
        print(f"  Min={e.min():+.1%}  Median={e.median():+.1%}  Mean={e.mean():+.1%}  Max={e.max():+.1%}")
        n_pos = (e > 0.05).sum()
        print(f"  Edge > +5%: {n_pos}/{len(e)}")

        cols = ['pitcher_name', 'team', 'pred_k', 'book_side', 'book_line', 'model_prob_book_line',
                'book_implied', 'edge_book', 'best_odds', 'best_book']
        top = df[df['has_line'] == 1].nlargest(5, 'edge_book')[cols].copy()
        top['model_prob_book_line'] = top['model_prob_book_line'].map('{:.1%}'.format)
        top['book_implied'] = top['book_implied'].map('{:.1%}'.format)
        top['edge_book'] = top['edge_book'].map(lambda x: f'{x:+.1%}')
        print("\nTop 5 by sportsbook edge:")
        print(top.to_string(index=False))

    if n_pp:
        e = df.loc[df['pp_line'].notna(), 'edge_pp'].dropna()
        print(f"\nPrizePicks edge (model_prob_for_side - 54.3% [-119]):")
        print(f"  Min={e.min():+.1%}  Median={e.median():+.1%}  Mean={e.mean():+.1%}  Max={e.max():+.1%}")

        cols = ['pitcher_name', 'team', 'pred_k', 'pp_side', 'pp_line', 'model_prob_pp_line', 'edge_pp']
        top = df[df['pp_line'].notna()].nlargest(5, 'edge_pp', keep='all')[cols].copy()
        top['model_prob_pp_line'] = top['model_prob_pp_line'].map('{:.1%}'.format)
        top['edge_pp'] = top['edge_pp'].map(lambda x: f'{x:+.1%}')
        print("\nTop PrizePicks edges:")
        print(top.head(5).to_string(index=False))

    if not n_book and not n_pp:
        print("\nNo market lines available from either source -- cannot compute edge.")
        print("Check ODDS_API_KEY in .env and PrizePicks availability.")


# ── [6] Save ──────────────────────────────────────────────────────────────────

def save_output(df, date_str):
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, f'ks_fair_odds_{date_str}.csv')

    out_cols = [
        'game_date', 'game_pk', 'game_time', 'venue', 'away_team', 'home_team',
        'pitcher', 'pitcher_name', 'team', 'opp_team', 'is_home', 'day_night',
        'pred_k', 'p_over_4.5', 'p_over_5.5', 'p_over_6.5', 'p_over_7.5', 'p_over_8.5',
        'has_line', 'book_line', 'book_side', 'best_book', 'best_odds', 'book_implied',
        'model_prob_book_line', 'edge_book',
        'pp_line', 'pp_side', 'model_prob_pp_line', 'edge_pp',
        # Detail-card / context columns (passed through from daily_runner output)
        'rest_days', 'prev_pitches', 'n_prior_starts',
        'opp_k_pct_15', 'opp_ops_15', 'opp_chase_pct_15', 'n_prior_team_games',
        'park_k_factor', 'temp_f', 'wind_speed', 'wind_favor', 'is_dome',
        'p_k_per9_10', 'p_bb_per9_10', 'p_hr_per9_10', 'p_whip_10', 'p_fip_10',
        'p_k_pct_10', 'p_swstr_pct_10', 'p_called_strike_pct_10', 'p_chase_pct_10',
        'p_fp_strike_pct_10', 'p_fastball_velo_10', 'p_fastball_pct_10',
        'p_slider_pct_10', 'p_curveball_pct_10', 'p_changeup_pct_10', 'p_other_pct_10',
        'p_avg_pitches_10', 'p_avg_ip_10',
    ]
    save_cols = [c for c in out_cols if c in df.columns]

    out = df.sort_values('edge_book', ascending=False, na_position='last')
    out[save_cols].to_csv(path, index=False)
    print(f"\nSaved {len(out)} rows -> {path}")
    return path


# ── Main ──────────────────────────────────────────────────────────────────────

def run(date_str=None):
    if date_str is None:
        date_str = date.today().isoformat()

    print(f"\n{'=' * 60}")
    print(f"K PROP FAIR ODDS -- {date_str}")
    print(f"{'=' * 60}")

    print("\n[1] Loading predictions...")
    pred_df = load_predictions(date_str)
    if pred_df.empty:
        print("  No predictions -- exiting.")
        return pd.DataFrame()

    print("\n[2] Fetching OddsAPI events list...")
    events, credits_remaining = fetch_events_list(date_str)

    print("\n[3] Matching games to OddsAPI events...")
    game_to_event = match_games_to_events(pred_df, events)
    print(f"  Matched {len(game_to_event)} / {pred_df['game_pk'].nunique()} games to OddsAPI events")

    odds_df = pd.DataFrame()
    if game_to_event:
        print(f"\n[4] Fetching pitcher_strikeouts props for {len(game_to_event)} event(s)...")
        odds_df, credits_used, failed, credits_remaining = \
            fetch_pitcher_strikeout_props(list(set(game_to_event.values())))
        if not odds_df.empty:
            n_players = odds_df['name_norm'].nunique()
            n_books = odds_df['bookmaker'].nunique()
            print(f"  {n_players} pitchers with lines | {n_books} bookmaker(s) | "
                  f"{credits_used} credit(s) used | {credits_remaining} remaining")
        else:
            print(f"  No pitcher_strikeouts lines returned ({failed} failed event call(s)).")
    else:
        print("\n[4] No matched events -- skipping sportsbook props.")

    print("\n[5] Fetching PrizePicks projections...")
    pp_df = fetch_prizepicks_strikeouts()
    if not pp_df.empty:
        print(f"  {len(pp_df)} pitcher-strikeout projections found")
    else:
        print("  No PrizePicks pitcher-strikeout projections found.")

    print("\n[6] Joining odds and computing edge...")
    result = join_sportsbook_odds(pred_df, odds_df)
    result = join_prizepicks(result, pp_df)

    print_edge_sanity_check(result)
    save_output(result, date_str)

    return result


if __name__ == '__main__':
    date_arg = sys.argv[1] if len(sys.argv) > 1 else None
    run(date_arg)
