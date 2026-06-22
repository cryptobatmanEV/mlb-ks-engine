"""
Pull sportsbook strikeout-prop lines and PrizePicks pitcher-strikeout
projections, match them to today's model projections
(data/predictions/ks_predictions_{date}.csv), and compute edge.

Odds provider is controlled by the ODDS_PROVIDER env var:
  odds_api   (default) -- the-odds-api.com, per-event fetching
  parlay_api           -- parlay-api.com, single call for all books

ROLLBACK: if ParlayAPI has issues, set ODDS_PROVIDER=odds_api (or remove the
variable entirely) in .env and restart the pipeline. No code changes needed.
To abandon the migration entirely, merge nothing and delete the
parlayapi-migration branch: `git branch -D parlayapi-migration`.

Market-informed projections: when a book line is available, the book's
over/under prices are de-vigged and inverted (see market_implied_k) to back
out the market's own implied expected-K count. That market projection is
blended with the model's raw projection (pred_k) using MODEL_WEIGHT to
produce `adj_k` ("ADJ Ks"). adj_k is then used -- instead of the raw model
projection -- for every Poisson P(over)/P(under) calculation below. With no
book line, adj_k falls back to the raw model projection (100% model weight).

For every line, the model computes BOTH P(over) and P(under) (P(under) =
1 - P(over), exact for X.5 lines) using adj_k, and picks whichever side has
the larger edge vs. the market's implied probability:

  edge_book = blended_prob_for_book_side - book_implied_prob_for_that_side
  edge_pp   = blended_prob_for_pp_side   - 0.543  (PrizePicks standard pick'em
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
from scipy.optimize import brentq
from scipy.stats import poisson

load_dotenv()

ODDS_KEY = os.getenv('ODDS_API_KEY') or os.getenv('ODDSPAPI_KEY')
ODDS_BASE = 'https://api.the-odds-api.com'

PARLAY_API_KEY = os.getenv('PARLAY_API_KEY')
PARLAY_BASE = 'https://parlay-api.com/v1'

# Controls which sportsbook odds provider is used. 'odds_api' is the default
# and preserves the existing behaviour. Set to 'parlay_api' to use ParlayAPI.
ODDS_PROVIDER = os.getenv('ODDS_PROVIDER', 'odds_api').lower().strip()

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


# How far ADJ Ks must sit from a line before the recommended side is forced
# to follow the projection direction (over if adj_k is this much above the
# line, under if this much below), overriding the raw edge comparison. Below
# this margin the direction is genuinely ambiguous, so the side with the
# larger edge vs. the market's implied probability is used instead. This
# avoids counterintuitive plays where the model projects well above a line
# but a vig quirk gives the under a marginally larger edge.
SIDE_MARGIN = 0.3


# Weight given to the model's own projection when blending it with the
# book's market-implied projection to form `adj_k` (ADJ Ks). The remaining
# weight (1 - MODEL_WEIGHT) goes to the market. The model gets more weight
# because it has pitcher-specific Statcast data the market may not fully
# price in, but the market gets significant weight because it aggregates
# information (injuries, weather, lineup news, etc.) the model doesn't see.
#
# Can be tuned via models/optimize_blend.py on the 2025 H2 + 2026 holdout
# (real historical book odds aren't available, so that script blends against
# a proxy "market" model trained on a narrower, lagging feature set -- see
# its docstring for the caveat). Revisit/re-run that script once real adj_k /
# book-line history accumulates via the daily pipeline.
MODEL_WEIGHT = 0.60


def implied_lambda_from_line(line, p_over):
    """Invert the Poisson CDF: find lambda such that
    1 - poisson.cdf(floor(line), lambda) == p_over. Used to back out the
    market's implied expected-K count from a book's over/under line."""
    floor = int(line)
    p_over = min(max(p_over, 0.001), 0.999)
    f = lambda lam: (1 - poisson.cdf(floor, lam)) - p_over
    try:
        return brentq(f, 1e-6, 30.0)
    except ValueError:
        return None


def market_implied_k(line, over_implied, under_implied):
    """De-vig the book's over/under implied probabilities at `line` (if both
    are available, normalize so they sum to 1; otherwise use whichever side
    is available) and back out the implied expected-K count (lambda)."""
    if pd.isna(line):
        return None
    if pd.notna(over_implied) and pd.notna(under_implied):
        total = over_implied + under_implied
        p_over = over_implied / total if total > 0 else None
    elif pd.notna(over_implied):
        p_over = over_implied
    elif pd.notna(under_implied):
        p_over = 1.0 - under_implied
    else:
        p_over = None

    if p_over is None:
        return None
    return implied_lambda_from_line(line, p_over)


def _odds_get(path, params=None, timeout=20):
    r = requests.get(f'{ODDS_BASE}{path}',
                     params={**(params or {}), 'apiKey': ODDS_KEY},
                     timeout=timeout)
    r.raise_for_status()
    return r, r.json()


def _parlay_get(path, params=None, timeout=20):
    r = requests.get(f'{PARLAY_BASE}{path}',
                     params=params or {},
                     headers={'X-API-Key': PARLAY_API_KEY},
                     timeout=timeout)
    r.raise_for_status()
    return r.json()


def _map_parlay_api_rows(raw_rows, date_str):
    """Pivot ParlayAPI flat prop rows into the internal per-side row format.

    ParlayAPI returns one row per player+book+line with both over_price and
    under_price on the same record. This function splits each into two rows
    (Over / Under), filters to a 36-hour window matching date_str, and
    excludes DFS/prediction-market platforms (PrizePicks, Underdog, Sleeper,
    Pick6, Kalshi, Polymarket) identified by is_dfs_flat_payout=True — their
    flat +100/-100 pricing and alt lines (e.g. 0.5, 13.5) corrupt the
    consensus line calculation meant for sportsbooks.

    Output has the same shape as fetch_pitcher_strikeout_props():
        player_name_raw, side, point, odds_american, bookmaker, event_id
    """
    # 36-hour window: game_date 00:00Z through next_day 09:00Z.
    # Timestamps in ParlayAPI may be UTC ('Z') or include a UTC offset
    # (e.g. '-04:00'). datetime.fromisoformat handles both in Python 3.11+;
    # for earlier versions we normalize 'Z' → '+00:00' before parsing.
    def _parse_ct(ts):
        if not ts:
            return None
        try:
            return datetime.fromisoformat(ts.replace('Z', '+00:00'))
        except ValueError:
            return None

    from datetime import timezone
    window_start = datetime.fromisoformat(f"{date_str}T00:00:00+00:00")
    next_day = (datetime.fromisoformat(date_str) + timedelta(days=1)).strftime('%Y-%m-%d')
    window_end = datetime.fromisoformat(f"{next_day}T09:00:00+00:00")

    rows = []
    for row in raw_rows:
        # Skip DFS platforms — flat pricing and alt lines distort consensus
        if row.get('is_dfs_flat_payout', False):
            continue

        ct = _parse_ct(row.get('commence_time', ''))
        if ct is None or not (window_start <= ct < window_end):
            continue

        player = row.get('player', '')
        line = row.get('line')
        bookmaker = row.get('bookmaker', '')
        event_id = row.get('canonical_event_id', '')

        if not player or line is None:
            continue
        try:
            line_val = float(line)
        except (TypeError, ValueError):
            continue
        if line_val < 3.5 or line_val > 12.5:
            continue  # drop alt lines (2.5, 17.5) and game-total / hitter props

        over_price = row.get('over_price')
        under_price = row.get('under_price')

        if over_price is not None:
            rows.append({
                'player_name_raw': player,
                'side': 'Over',
                'point': float(line),
                'odds_american': int(over_price),
                'bookmaker': bookmaker,
                'event_id': event_id,
            })
        if under_price is not None:
            rows.append({
                'player_name_raw': player,
                'side': 'Under',
                'point': float(line),
                'odds_american': int(under_price),
                'bookmaker': bookmaker,
                'event_id': event_id,
            })
    return rows


def fetch_parlay_api_strikeouts(date_str):
    """Fetch MLB pitcher strikeout props from ParlayAPI (3 credits, all books).

    Single call to /v1/sports/baseball_mlb/props?market_key=player_strikeouts
    returns props for every bookmaker at once, replacing the per-event loop
    used by the OddsAPI flow. Rows are filtered to a 36-hour window for
    date_str and pivoted to the same shape as fetch_pitcher_strikeout_props().

    Name matching: ParlayAPI returns player as a plain "First Last" string,
    same format our model uses, so norm_name() handles accents/suffixes the
    same way as with OddsAPI outcome descriptions.
    """
    if not PARLAY_API_KEY:
        print("  PARLAY_API_KEY not set -- skipping sportsbook lines.")
        return pd.DataFrame()

    try:
        data = _parlay_get('/sports/baseball_mlb/props',
                           {'market_key': 'player_strikeouts'})
    except requests.HTTPError as e:
        code = e.response.status_code
        body = {}
        try:
            body = e.response.json()
        except Exception:
            pass
        if code == 401:
            print("  ParlayAPI auth failed (401). Check PARLAY_API_KEY in .env.")
        elif code == 402:
            print("  ParlayAPI credit limit reached (402).")
        else:
            print(f"  ParlayAPI props failed ({code}): {body.get('message', body)}")
        return pd.DataFrame()
    except Exception as e:
        print(f"  ParlayAPI error: {e}")
        return pd.DataFrame()

    # Response may be a bare list or wrapped: {"data": [...]} / {"results": [...]}
    if isinstance(data, list):
        raw_rows = data
    elif isinstance(data, dict):
        raw_rows = data.get('data') or data.get('results') or []
    else:
        print(f"  ParlayAPI returned unexpected type: {type(data)}")
        return pd.DataFrame()

    total_before = len(raw_rows)
    rows = _map_parlay_api_rows(raw_rows, date_str)
    if not rows:
        print(f"  ParlayAPI returned {total_before} total rows; 0 matched "
              f"date window for {date_str}.")
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    df['name_norm'] = df['player_name_raw'].apply(norm_name)
    df['implied'] = df['odds_american'].apply(american_to_implied)
    return df


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
        df['adj_k'] = df['pred_k']
        return df.drop(columns=['name_norm'])

    overs = odds_df[odds_df['side'] == 'Over']

    # Consensus line: most frequently quoted Over point.
    # Tie-break: when multiple lines tie on count (e.g. a single book posting
    # several alt lines each at n=1), pick the line whose mean over_implied is
    # closest to 0.5 — the primary market line is priced near even-money, while
    # low alt lines (~2.5) are ~80% over and high alt lines (~17.5) are ~5% over.
    _freq = overs.groupby(['name_norm', 'point']).size().reset_index(name='n')
    _impl = (overs.groupby(['name_norm', 'point'])['implied']
             .mean().reset_index(name='over_implied_mean'))
    _freq = _freq.merge(_impl, on=['name_norm', 'point'])
    _freq['balance'] = (_freq['over_implied_mean'] - 0.5).abs()
    consensus = (_freq.sort_values(['name_norm', 'n', 'balance'], ascending=[True, False, True])
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

    # ── Blend the model's projection with the market-implied projection ────
    # ADJ Ks = MODEL_WEIGHT * PROJ Ks + (1 - MODEL_WEIGHT) * market-implied Ks.
    # Falls back to the raw model projection when no book line is available.
    def _adj_k(r):
        if pd.isna(r['book_line']):
            return r['pred_k']
        m_k = market_implied_k(r['book_line'], r.get('over_implied'), r.get('under_implied'))
        if m_k is None:
            return r['pred_k']
        return MODEL_WEIGHT * r['pred_k'] + (1 - MODEL_WEIGHT) * m_k

    df['adj_k'] = df.apply(_adj_k, axis=1)

    def _pick_side(r):
        if pd.isna(r['book_line']):
            return pd.Series([None, None, None, None, None, None])

        p_over = model_prob_over(r['adj_k'], r['book_line'])
        p_under = 1.0 - p_over

        edge_over = (p_over - r['over_implied']) if pd.notna(r['over_implied']) else None
        edge_under = (p_under - r['under_implied']) if pd.notna(r['under_implied']) else None

        if edge_over is None and edge_under is None:
            return pd.Series([None, None, None, None, None, None])

        # When ADJ Ks sits clearly above or below the line, force the
        # recommendation to follow the projection direction rather than
        # whichever side happens to have the larger edge. Within
        # SIDE_MARGIN of the line, direction is ambiguous, so fall back to
        # the edge comparison.
        diff = r['adj_k'] - r['book_line']
        if diff > SIDE_MARGIN and edge_over is not None:
            pick_over = True
        elif diff < -SIDE_MARGIN and edge_under is not None:
            pick_over = False
        else:
            pick_over = edge_under is None or (edge_over is not None and edge_over >= edge_under)

        if pick_over:
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
        p_over = df.loc[has_pp].apply(lambda r: model_prob_over(r['adj_k'], r['pp_line']), axis=1)
        diff = df.loc[has_pp, 'adj_k'] - df.loc[has_pp, 'pp_line']

        # Same projection-direction override as book lines (see SIDE_MARGIN):
        # only fall back to the raw p_over >= 0.5 comparison when adj_k is
        # within SIDE_MARGIN of the PP line.
        side_over = (p_over >= 0.5)
        side_over = side_over.where(diff.abs() <= SIDE_MARGIN, diff > 0)

        df.loc[has_pp, 'pp_side'] = side_over.map({True: 'over', False: 'under'})
        df.loc[has_pp, 'model_prob_pp_line'] = p_over.where(side_over, 1.0 - p_over)

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
        adj_diff = (df.loc[df['has_line'] == 1, 'adj_k'] - df.loc[df['has_line'] == 1, 'pred_k']).dropna()
        print(f"\nModel/market blend (MODEL_WEIGHT={MODEL_WEIGHT}, ADJ Ks vs PROJ Ks):")
        print(f"  Mean diff={adj_diff.mean():+.3f}  Mean |diff|={adj_diff.abs().mean():.3f}")

        e = df.loc[df['has_line'] == 1, 'edge_book'].dropna()
        print(f"\nSportsbook edge (blended_prob_for_side - book_implied_for_side):")
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
        'pred_k', 'adj_k', 'p_over_4.5', 'p_over_5.5', 'p_over_6.5', 'p_over_7.5', 'p_over_8.5',
        'has_line', 'book_line', 'book_side', 'best_book', 'best_odds', 'book_implied',
        'model_prob_book_line', 'edge_book',
        'pp_line', 'pp_side', 'model_prob_pp_line', 'edge_pp',
        'is_frozen',
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
    print(f"K PROP FAIR ODDS -- {date_str}  [provider={ODDS_PROVIDER}]")
    print(f"{'=' * 60}")

    print("\n[1] Loading predictions...")
    pred_df = load_predictions(date_str)
    if pred_df.empty:
        print("  No predictions -- exiting.")
        return pd.DataFrame()

    odds_df = pd.DataFrame()

    if ODDS_PROVIDER == 'parlay_api':
        # ── ParlayAPI path: single call returns all books for the whole sport ──
        print("\n[2-4] Fetching ParlayAPI player_strikeouts props (single call)...")
        odds_df = fetch_parlay_api_strikeouts(date_str)
        if not odds_df.empty:
            n_players = odds_df['name_norm'].nunique()
            n_books = odds_df['bookmaker'].nunique()
            print(f"  {n_players} pitchers with lines | {n_books} bookmaker(s)")
        else:
            print("  No pitcher_strikeouts lines returned from ParlayAPI.")

    else:
        # ── OddsAPI path: per-event fetching (original implementation) ─────────
        print("\n[2] Fetching OddsAPI events list...")
        events, credits_remaining = fetch_events_list(date_str)

        print("\n[3] Matching games to OddsAPI events...")
        game_to_event = match_games_to_events(pred_df, events)
        print(f"  Matched {len(game_to_event)} / {pred_df['game_pk'].nunique()} games "
              f"to OddsAPI events")

        if game_to_event:
            print(f"\n[4] Fetching pitcher_strikeouts props for "
                  f"{len(game_to_event)} event(s)...")
            odds_df, credits_used, failed, credits_remaining = \
                fetch_pitcher_strikeout_props(list(set(game_to_event.values())))
            if not odds_df.empty:
                n_players = odds_df['name_norm'].nunique()
                n_books = odds_df['bookmaker'].nunique()
                print(f"  {n_players} pitchers with lines | {n_books} bookmaker(s) | "
                      f"{credits_used} credit(s) used | {credits_remaining} remaining")
            else:
                print(f"  No pitcher_strikeouts lines returned "
                      f"({failed} failed event call(s)).")
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

    # Identify games where SOME pitchers have sportsbook lines but others don't.
    # Those unpriced pitchers are NOT frozen by the freeze step below (which only
    # protects has_line=1 → 0 drops after a game starts). On every subsequent
    # pipeline run the ParlayAPI bulk call re-attempts ALL pitchers, so
    # partial-priced games are automatically retried without any extra mechanism.
    _gb = result.groupby('game_pk')
    _game_counts = _gb['has_line'].agg(['sum', 'count']).rename(
        columns={'sum': 'n_priced', 'count': 'n_total'})
    _game_counts['status'] = _gb['status'].first() if 'status' in result.columns else ''
    _partial = _game_counts[
        (_game_counts['n_priced'] > 0) & (_game_counts['n_priced'] < _game_counts['n_total'])
    ]
    if not _partial.empty:
        print("\n  Partial-pricing games (missing pitchers auto-retried on next run):")
        for _gk, _g in _partial.iterrows():
            _missing = result.loc[
                (result['game_pk'] == _gk) & (result['has_line'] == 0), 'pitcher_name'
            ].tolist()
            print(f"    game_pk={int(_gk)}  status={_g['status']}  "
                  f"missing: {', '.join(_missing)}")

    print_edge_sanity_check(result)

    # Preserve book/PP odds for pitchers whose market has closed (game
    # started; sportsbooks and PP suspend props). Without this, afternoon
    # pipeline runs overwrite the morning's has_line=1 with has_line=0 in the
    # CSV, causing log_results to miss bet outcomes the next morning.
    # is_frozen=1 tells write_to_db to skip overwriting existing DB odds —
    # preventing stale frozen values from regressing a fresher DB write.
    result['is_frozen'] = 0

    _prev_path = os.path.join(OUT_DIR, f'ks_fair_odds_{date_str}.csv')
    if os.path.exists(_prev_path):
        try:
            _prev = pd.read_csv(_prev_path)
            _BOOK_COLS = ['has_line', 'book_line', 'book_side', 'best_book',
                          'best_odds', 'book_implied', 'model_prob_book_line',
                          'edge_book', 'adj_k']
            _PP_COLS   = ['pp_line', 'pp_side', 'model_prob_pp_line', 'edge_pp']
            _n_frozen  = 0

            _pb = _prev.loc[_prev['has_line'] == 1,
                            ['pitcher'] + [c for c in _BOOK_COLS if c in _prev.columns]]
            if not _pb.empty:
                result = result.merge(_pb, on='pitcher', how='left', suffixes=('', '_z'))
                if 'has_line_z' in result.columns:
                    _bm = (result['has_line'] == 0) & (result['has_line_z'] == 1)
                    _n_frozen += int(_bm.sum())
                    for _c in _BOOK_COLS:
                        if f'{_c}_z' in result.columns:
                            result.loc[_bm, _c] = result.loc[_bm, f'{_c}_z']
                    result.loc[_bm, 'is_frozen'] = 1
                result = result[[c for c in result.columns if not c.endswith('_z')]]

            _pp = _prev.loc[_prev['pp_line'].notna(),
                            ['pitcher'] + [c for c in _PP_COLS if c in _prev.columns]]
            if not _pp.empty:
                result = result.merge(_pp, on='pitcher', how='left', suffixes=('', '_z'))
                if 'pp_line_z' in result.columns:
                    _pm = result['pp_line'].isna() & result['pp_line_z'].notna()
                    _n_frozen += int(_pm.sum())
                    for _c in _PP_COLS:
                        if f'{_c}_z' in result.columns:
                            result.loc[_pm, _c] = result.loc[_pm, f'{_c}_z']
                    result.loc[_pm, 'is_frozen'] = 1
                result = result[[c for c in result.columns if not c.endswith('_z')]]

            if _n_frozen:
                print(f"\n  Preserved prior-run odds for {_n_frozen} pitcher(s) (market closed).")
        except Exception as e:
            print(f"  Warning: could not preserve prior odds: {e}")

    save_output(result, date_str)

    return result


if __name__ == '__main__':
    date_arg = sys.argv[1] if len(sys.argv) > 1 else None
    run(date_arg)
