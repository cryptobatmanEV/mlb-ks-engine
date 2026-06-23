"""
Upsert today's K fair-odds output into Neon PostgreSQL.

The ks_predictions table is created automatically on first run. Re-running
for the same date is safe -- rows are updated, not duplicated.

NOTE: this connects to the same Neon database as mlb-prop-engine
(shared DATABASE_URL), but only ever touches the ks_predictions table.

Usage:
    python -m scripts.write_to_db              # today
    python -m scripts.write_to_db 2026-06-11   # specific date

Called automatically as Step 4 by scripts/daily_pipeline.py.
"""

import json
import math
import os
import sys
from datetime import date as date_cls

import pandas as pd
import psycopg2
from dotenv import load_dotenv

load_dotenv()

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

DATABASE_URL = os.getenv('DATABASE_URL')
OUTPUTS_DIR = 'data/outputs'

CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS ks_predictions (
    id                   SERIAL PRIMARY KEY,
    game_date            DATE        NOT NULL,
    game_pk              BIGINT      NOT NULL,
    pitcher              BIGINT      NOT NULL,
    pitcher_name         TEXT,
    team                 TEXT,
    opp_team             TEXT,
    home_team            TEXT,
    away_team            TEXT,
    is_home              BOOLEAN,
    day_night            TEXT,
    venue                TEXT,
    game_time            TEXT,
    pred_k               FLOAT,
    adj_k                FLOAT,
    p_over_4_5           FLOAT,
    p_over_5_5           FLOAT,
    p_over_6_5           FLOAT,
    p_over_7_5           FLOAT,
    p_over_8_5           FLOAT,
    has_line             BOOLEAN,
    book_line            FLOAT,
    book_side            TEXT,
    best_book            TEXT,
    best_odds            INTEGER,
    book_implied         FLOAT,
    model_prob_book_line FLOAT,
    edge_book            FLOAT,
    pp_line              FLOAT,
    pp_side              TEXT,
    model_prob_pp_line   FLOAT,
    edge_pp              FLOAT,
    rest_days            INTEGER,
    prev_pitches         INTEGER,
    n_prior_starts       INTEGER,
    opp_k_pct_15         FLOAT,
    opp_ops_15           FLOAT,
    opp_chase_pct_15     FLOAT,
    n_prior_team_games   INTEGER,
    park_k_factor        FLOAT,
    temp_f               FLOAT,
    wind_speed           FLOAT,
    wind_favor           FLOAT,
    is_dome              BOOLEAN,
    p_k_per9_10          FLOAT,
    p_bb_per9_10         FLOAT,
    p_hr_per9_10         FLOAT,
    p_whip_10            FLOAT,
    p_fip_10             FLOAT,
    p_k_pct_10           FLOAT,
    p_swstr_pct_10       FLOAT,
    p_called_strike_pct_10 FLOAT,
    p_chase_pct_10       FLOAT,
    p_fp_strike_pct_10   FLOAT,
    p_fastball_velo_10   FLOAT,
    p_fastball_pct_10    FLOAT,
    p_slider_pct_10      FLOAT,
    p_curveball_pct_10   FLOAT,
    p_changeup_pct_10    FLOAT,
    p_other_pct_10       FLOAT,
    p_avg_pitches_10     FLOAT,
    p_avg_ip_10          FLOAT,
    actual_k             INTEGER     DEFAULT NULL,
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (game_date, pitcher, game_pk)
);
"""

# Columns added after the table was first created on some environments --
# CREATE TABLE IF NOT EXISTS won't add these to a pre-existing table, so
# add them defensively on every run.
ALTER_STATEMENTS = [
    f"ALTER TABLE ks_predictions ADD COLUMN IF NOT EXISTS {col_def}"
    for col_def in [
        "rest_days INTEGER",
        "prev_pitches INTEGER",
        "n_prior_starts INTEGER",
        "opp_k_pct_15 FLOAT",
        "opp_ops_15 FLOAT",
        "opp_chase_pct_15 FLOAT",
        "n_prior_team_games INTEGER",
        "park_k_factor FLOAT",
        "temp_f FLOAT",
        "wind_speed FLOAT",
        "wind_favor FLOAT",
        "is_dome BOOLEAN",
        "p_k_per9_10 FLOAT",
        "p_bb_per9_10 FLOAT",
        "p_hr_per9_10 FLOAT",
        "p_whip_10 FLOAT",
        "p_fip_10 FLOAT",
        "p_k_pct_10 FLOAT",
        "p_swstr_pct_10 FLOAT",
        "p_called_strike_pct_10 FLOAT",
        "p_chase_pct_10 FLOAT",
        "p_fp_strike_pct_10 FLOAT",
        "p_fastball_velo_10 FLOAT",
        "p_fastball_pct_10 FLOAT",
        "p_slider_pct_10 FLOAT",
        "p_curveball_pct_10 FLOAT",
        "p_changeup_pct_10 FLOAT",
        "p_other_pct_10 FLOAT",
        "p_avg_pitches_10 FLOAT",
        "p_avg_ip_10 FLOAT",
        "actual_k INTEGER DEFAULT NULL",
        "book_side TEXT",
        "pp_side TEXT",
        "adj_k FLOAT",
        "book_markets TEXT",
    ]
]

UPSERT = """
INSERT INTO ks_predictions (
    game_date, game_pk, pitcher, pitcher_name, team, opp_team, home_team, away_team,
    is_home, day_night, venue, game_time,
    pred_k, adj_k, p_over_4_5, p_over_5_5, p_over_6_5, p_over_7_5, p_over_8_5,
    has_line, book_line, book_side, best_book, best_odds, book_implied,
    model_prob_book_line, edge_book,
    pp_line, pp_side, model_prob_pp_line, edge_pp,
    book_markets,
    rest_days, prev_pitches, n_prior_starts,
    opp_k_pct_15, opp_ops_15, opp_chase_pct_15, n_prior_team_games,
    park_k_factor, temp_f, wind_speed, wind_favor, is_dome,
    p_k_per9_10, p_bb_per9_10, p_hr_per9_10, p_whip_10, p_fip_10,
    p_k_pct_10, p_swstr_pct_10, p_called_strike_pct_10, p_chase_pct_10,
    p_fp_strike_pct_10, p_fastball_velo_10, p_fastball_pct_10,
    p_slider_pct_10, p_curveball_pct_10, p_changeup_pct_10, p_other_pct_10,
    p_avg_pitches_10, p_avg_ip_10
) VALUES (
    %(game_date)s, %(game_pk)s, %(pitcher)s, %(pitcher_name)s, %(team)s, %(opp_team)s,
    %(home_team)s, %(away_team)s,
    %(is_home)s, %(day_night)s, %(venue)s, %(game_time)s,
    %(pred_k)s, %(adj_k)s, %(p_over_4_5)s, %(p_over_5_5)s, %(p_over_6_5)s, %(p_over_7_5)s, %(p_over_8_5)s,
    %(has_line)s, %(book_line)s, %(book_side)s, %(best_book)s, %(best_odds)s, %(book_implied)s,
    %(model_prob_book_line)s, %(edge_book)s,
    %(pp_line)s, %(pp_side)s, %(model_prob_pp_line)s, %(edge_pp)s,
    %(book_markets)s,
    %(rest_days)s, %(prev_pitches)s, %(n_prior_starts)s,
    %(opp_k_pct_15)s, %(opp_ops_15)s, %(opp_chase_pct_15)s, %(n_prior_team_games)s,
    %(park_k_factor)s, %(temp_f)s, %(wind_speed)s, %(wind_favor)s, %(is_dome)s,
    %(p_k_per9_10)s, %(p_bb_per9_10)s, %(p_hr_per9_10)s, %(p_whip_10)s, %(p_fip_10)s,
    %(p_k_pct_10)s, %(p_swstr_pct_10)s, %(p_called_strike_pct_10)s, %(p_chase_pct_10)s,
    %(p_fp_strike_pct_10)s, %(p_fastball_velo_10)s, %(p_fastball_pct_10)s,
    %(p_slider_pct_10)s, %(p_curveball_pct_10)s, %(p_changeup_pct_10)s, %(p_other_pct_10)s,
    %(p_avg_pitches_10)s, %(p_avg_ip_10)s
)
ON CONFLICT (game_date, pitcher, game_pk) DO UPDATE SET
    pitcher_name         = EXCLUDED.pitcher_name,
    team                 = EXCLUDED.team,
    opp_team             = EXCLUDED.opp_team,
    home_team            = EXCLUDED.home_team,
    away_team            = EXCLUDED.away_team,
    is_home              = EXCLUDED.is_home,
    day_night            = EXCLUDED.day_night,
    venue                = EXCLUDED.venue,
    game_time            = EXCLUDED.game_time,
    pred_k               = EXCLUDED.pred_k,
    p_over_4_5           = EXCLUDED.p_over_4_5,
    p_over_5_5           = EXCLUDED.p_over_5_5,
    p_over_6_5           = EXCLUDED.p_over_6_5,
    p_over_7_5           = EXCLUDED.p_over_7_5,
    p_over_8_5           = EXCLUDED.p_over_8_5,
    has_line             = CASE WHEN EXCLUDED.has_line IS TRUE THEN EXCLUDED.has_line             ELSE ks_predictions.has_line             END,
    book_line            = CASE WHEN EXCLUDED.has_line IS TRUE THEN EXCLUDED.book_line            ELSE ks_predictions.book_line            END,
    book_side            = CASE WHEN EXCLUDED.has_line IS TRUE THEN EXCLUDED.book_side            ELSE ks_predictions.book_side            END,
    best_book            = CASE WHEN EXCLUDED.has_line IS TRUE THEN EXCLUDED.best_book            ELSE ks_predictions.best_book            END,
    best_odds            = CASE WHEN EXCLUDED.has_line IS TRUE THEN EXCLUDED.best_odds            ELSE ks_predictions.best_odds            END,
    book_implied         = CASE WHEN EXCLUDED.has_line IS TRUE THEN EXCLUDED.book_implied         ELSE ks_predictions.book_implied         END,
    model_prob_book_line = CASE WHEN EXCLUDED.has_line IS TRUE THEN EXCLUDED.model_prob_book_line ELSE ks_predictions.model_prob_book_line END,
    edge_book            = CASE WHEN EXCLUDED.has_line IS TRUE THEN EXCLUDED.edge_book            ELSE ks_predictions.edge_book            END,
    adj_k                = CASE WHEN EXCLUDED.has_line IS TRUE THEN EXCLUDED.adj_k                ELSE ks_predictions.adj_k                END,
    pp_line              = CASE WHEN EXCLUDED.pp_line IS NOT NULL THEN EXCLUDED.pp_line              ELSE ks_predictions.pp_line              END,
    pp_side              = CASE WHEN EXCLUDED.pp_line IS NOT NULL THEN EXCLUDED.pp_side              ELSE ks_predictions.pp_side              END,
    model_prob_pp_line   = CASE WHEN EXCLUDED.pp_line IS NOT NULL THEN EXCLUDED.model_prob_pp_line   ELSE ks_predictions.model_prob_pp_line   END,
    edge_pp              = CASE WHEN EXCLUDED.pp_line IS NOT NULL THEN EXCLUDED.edge_pp              ELSE ks_predictions.edge_pp              END,
    book_markets         = CASE WHEN EXCLUDED.has_line IS TRUE THEN EXCLUDED.book_markets         ELSE ks_predictions.book_markets         END,
    rest_days            = EXCLUDED.rest_days,
    prev_pitches         = EXCLUDED.prev_pitches,
    n_prior_starts       = EXCLUDED.n_prior_starts,
    opp_k_pct_15         = EXCLUDED.opp_k_pct_15,
    opp_ops_15           = EXCLUDED.opp_ops_15,
    opp_chase_pct_15     = EXCLUDED.opp_chase_pct_15,
    n_prior_team_games   = EXCLUDED.n_prior_team_games,
    park_k_factor        = EXCLUDED.park_k_factor,
    temp_f               = EXCLUDED.temp_f,
    wind_speed           = EXCLUDED.wind_speed,
    wind_favor           = EXCLUDED.wind_favor,
    is_dome              = EXCLUDED.is_dome,
    p_k_per9_10          = EXCLUDED.p_k_per9_10,
    p_bb_per9_10         = EXCLUDED.p_bb_per9_10,
    p_hr_per9_10         = EXCLUDED.p_hr_per9_10,
    p_whip_10            = EXCLUDED.p_whip_10,
    p_fip_10             = EXCLUDED.p_fip_10,
    p_k_pct_10           = EXCLUDED.p_k_pct_10,
    p_swstr_pct_10       = EXCLUDED.p_swstr_pct_10,
    p_called_strike_pct_10 = EXCLUDED.p_called_strike_pct_10,
    p_chase_pct_10       = EXCLUDED.p_chase_pct_10,
    p_fp_strike_pct_10   = EXCLUDED.p_fp_strike_pct_10,
    p_fastball_velo_10   = EXCLUDED.p_fastball_velo_10,
    p_fastball_pct_10    = EXCLUDED.p_fastball_pct_10,
    p_slider_pct_10      = EXCLUDED.p_slider_pct_10,
    p_curveball_pct_10   = EXCLUDED.p_curveball_pct_10,
    p_changeup_pct_10    = EXCLUDED.p_changeup_pct_10,
    p_other_pct_10       = EXCLUDED.p_other_pct_10,
    p_avg_pitches_10     = EXCLUDED.p_avg_pitches_10,
    p_avg_ip_10          = EXCLUDED.p_avg_ip_10,
    created_at           = NOW();
"""

# Same INSERT as UPSERT, but on conflict the 13 odds columns are never
# overwritten — existing DB values are kept unconditionally.  Used for rows
# where fair_odds.py set is_frozen=1 (market closed; values carried from the
# prior run's CSV to prevent stale frozen data from regressing a fresher DB write).
UPSERT_FROZEN = """
INSERT INTO ks_predictions (
    game_date, game_pk, pitcher, pitcher_name, team, opp_team, home_team, away_team,
    is_home, day_night, venue, game_time,
    pred_k, adj_k, p_over_4_5, p_over_5_5, p_over_6_5, p_over_7_5, p_over_8_5,
    has_line, book_line, book_side, best_book, best_odds, book_implied,
    model_prob_book_line, edge_book,
    pp_line, pp_side, model_prob_pp_line, edge_pp,
    book_markets,
    rest_days, prev_pitches, n_prior_starts,
    opp_k_pct_15, opp_ops_15, opp_chase_pct_15, n_prior_team_games,
    park_k_factor, temp_f, wind_speed, wind_favor, is_dome,
    p_k_per9_10, p_bb_per9_10, p_hr_per9_10, p_whip_10, p_fip_10,
    p_k_pct_10, p_swstr_pct_10, p_called_strike_pct_10, p_chase_pct_10,
    p_fp_strike_pct_10, p_fastball_velo_10, p_fastball_pct_10,
    p_slider_pct_10, p_curveball_pct_10, p_changeup_pct_10, p_other_pct_10,
    p_avg_pitches_10, p_avg_ip_10
) VALUES (
    %(game_date)s, %(game_pk)s, %(pitcher)s, %(pitcher_name)s, %(team)s, %(opp_team)s,
    %(home_team)s, %(away_team)s,
    %(is_home)s, %(day_night)s, %(venue)s, %(game_time)s,
    %(pred_k)s, %(adj_k)s, %(p_over_4_5)s, %(p_over_5_5)s, %(p_over_6_5)s, %(p_over_7_5)s, %(p_over_8_5)s,
    %(has_line)s, %(book_line)s, %(book_side)s, %(best_book)s, %(best_odds)s, %(book_implied)s,
    %(model_prob_book_line)s, %(edge_book)s,
    %(pp_line)s, %(pp_side)s, %(model_prob_pp_line)s, %(edge_pp)s,
    %(book_markets)s,
    %(rest_days)s, %(prev_pitches)s, %(n_prior_starts)s,
    %(opp_k_pct_15)s, %(opp_ops_15)s, %(opp_chase_pct_15)s, %(n_prior_team_games)s,
    %(park_k_factor)s, %(temp_f)s, %(wind_speed)s, %(wind_favor)s, %(is_dome)s,
    %(p_k_per9_10)s, %(p_bb_per9_10)s, %(p_hr_per9_10)s, %(p_whip_10)s, %(p_fip_10)s,
    %(p_k_pct_10)s, %(p_swstr_pct_10)s, %(p_called_strike_pct_10)s, %(p_chase_pct_10)s,
    %(p_fp_strike_pct_10)s, %(p_fastball_velo_10)s, %(p_fastball_pct_10)s,
    %(p_slider_pct_10)s, %(p_curveball_pct_10)s, %(p_changeup_pct_10)s, %(p_other_pct_10)s,
    %(p_avg_pitches_10)s, %(p_avg_ip_10)s
)
ON CONFLICT (game_date, pitcher, game_pk) DO UPDATE SET
    pitcher_name         = EXCLUDED.pitcher_name,
    team                 = EXCLUDED.team,
    opp_team             = EXCLUDED.opp_team,
    home_team            = EXCLUDED.home_team,
    away_team            = EXCLUDED.away_team,
    is_home              = EXCLUDED.is_home,
    day_night            = EXCLUDED.day_night,
    venue                = EXCLUDED.venue,
    game_time            = EXCLUDED.game_time,
    pred_k               = EXCLUDED.pred_k,
    p_over_4_5           = EXCLUDED.p_over_4_5,
    p_over_5_5           = EXCLUDED.p_over_5_5,
    p_over_6_5           = EXCLUDED.p_over_6_5,
    p_over_7_5           = EXCLUDED.p_over_7_5,
    p_over_8_5           = EXCLUDED.p_over_8_5,
    has_line             = ks_predictions.has_line,
    book_line            = ks_predictions.book_line,
    book_side            = ks_predictions.book_side,
    best_book            = ks_predictions.best_book,
    best_odds            = ks_predictions.best_odds,
    book_implied         = ks_predictions.book_implied,
    model_prob_book_line = ks_predictions.model_prob_book_line,
    edge_book            = ks_predictions.edge_book,
    adj_k                = ks_predictions.adj_k,
    pp_line              = ks_predictions.pp_line,
    pp_side              = ks_predictions.pp_side,
    model_prob_pp_line   = ks_predictions.model_prob_pp_line,
    edge_pp              = ks_predictions.edge_pp,
    book_markets         = ks_predictions.book_markets,
    rest_days            = EXCLUDED.rest_days,
    prev_pitches         = EXCLUDED.prev_pitches,
    n_prior_starts       = EXCLUDED.n_prior_starts,
    opp_k_pct_15         = EXCLUDED.opp_k_pct_15,
    opp_ops_15           = EXCLUDED.opp_ops_15,
    opp_chase_pct_15     = EXCLUDED.opp_chase_pct_15,
    n_prior_team_games   = EXCLUDED.n_prior_team_games,
    park_k_factor        = EXCLUDED.park_k_factor,
    temp_f               = EXCLUDED.temp_f,
    wind_speed           = EXCLUDED.wind_speed,
    wind_favor           = EXCLUDED.wind_favor,
    is_dome              = EXCLUDED.is_dome,
    p_k_per9_10          = EXCLUDED.p_k_per9_10,
    p_bb_per9_10         = EXCLUDED.p_bb_per9_10,
    p_hr_per9_10         = EXCLUDED.p_hr_per9_10,
    p_whip_10            = EXCLUDED.p_whip_10,
    p_fip_10             = EXCLUDED.p_fip_10,
    p_k_pct_10           = EXCLUDED.p_k_pct_10,
    p_swstr_pct_10       = EXCLUDED.p_swstr_pct_10,
    p_called_strike_pct_10 = EXCLUDED.p_called_strike_pct_10,
    p_chase_pct_10       = EXCLUDED.p_chase_pct_10,
    p_fp_strike_pct_10   = EXCLUDED.p_fp_strike_pct_10,
    p_fastball_velo_10   = EXCLUDED.p_fastball_velo_10,
    p_fastball_pct_10    = EXCLUDED.p_fastball_pct_10,
    p_slider_pct_10      = EXCLUDED.p_slider_pct_10,
    p_curveball_pct_10   = EXCLUDED.p_curveball_pct_10,
    p_changeup_pct_10    = EXCLUDED.p_changeup_pct_10,
    p_other_pct_10       = EXCLUDED.p_other_pct_10,
    p_avg_pitches_10     = EXCLUDED.p_avg_pitches_10,
    p_avg_ip_10          = EXCLUDED.p_avg_ip_10,
    created_at           = NOW();
"""


def _clean(val):
    """Return None for NaN/NA; pass everything else through unchanged."""
    if val is None:
        return None
    try:
        if math.isnan(float(val)):
            return None
    except (TypeError, ValueError):
        pass
    return val


def _bool(val):
    """Convert 0/1/True/False/NaN to Python bool or None."""
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return None
    return bool(int(val))


def _int(val):
    """Convert numeric-or-NaN to int or None."""
    v = _clean(val)
    return None if v is None else int(v)


def _str(val):
    """Convert a pandas cell to str or None (handles NaN and 'nan' strings)."""
    if val is None:
        return None
    s = str(val)
    return None if s in ('nan', 'None', '') else s


def run(date_str=None):
    if date_str is None:
        date_str = date_cls.today().isoformat()

    if not DATABASE_URL:
        print("  DATABASE_URL not set in .env -- skipping DB write.")
        return

    path = os.path.join(OUTPUTS_DIR, f'ks_fair_odds_{date_str}.csv')
    if not os.path.exists(path):
        print(f"  No ks_fair_odds file for {date_str} -- skipping DB write.")
        return

    df = pd.read_csv(path)
    print(f"  Upserting {len(df)} rows for {date_str} into ks_predictions...")

    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(CREATE_TABLE)
                for stmt in ALTER_STATEMENTS:
                    cur.execute(stmt)

                # Remove any rows for postponed/cancelled/suspended games so they
                # don't appear on the card. The list is written by daily_runner.
                _postponed_path = os.path.join(OUTPUTS_DIR, f'ks_postponed_{date_str}.json')
                if os.path.exists(_postponed_path):
                    with open(_postponed_path) as _f:
                        _postponed_pks = json.load(_f)
                    if _postponed_pks:
                        cur.execute(
                            "DELETE FROM ks_predictions "
                            "WHERE game_date = %s AND game_pk = ANY(%s::bigint[])",
                            (date_str, _postponed_pks),
                        )
                        print(f"  Deleted rows for {len(_postponed_pks)} postponed game(s).")

                n_frozen = 0
                for _, row in df.iterrows():
                    is_frozen = bool(int(row.get('is_frozen', 0) or 0))
                    if is_frozen:
                        n_frozen += 1
                    stmt = UPSERT_FROZEN if is_frozen else UPSERT
                    cur.execute(stmt, {
                        'game_date': date_str,
                        'game_pk': int(row['game_pk']),
                        'pitcher': int(row['pitcher']),
                        'pitcher_name': _str(row.get('pitcher_name')),
                        'team': _str(row.get('team')),
                        'opp_team': _str(row.get('opp_team')),
                        'home_team': _str(row.get('home_team')),
                        'away_team': _str(row.get('away_team')),
                        'is_home': _bool(row.get('is_home')),
                        'day_night': _str(row.get('day_night')),
                        'venue': _str(row.get('venue')),
                        'game_time': _str(row.get('game_time')),
                        'pred_k': _clean(row.get('pred_k')),
                        'adj_k': _clean(row.get('adj_k')),
                        'p_over_4_5': _clean(row.get('p_over_4.5')),
                        'p_over_5_5': _clean(row.get('p_over_5.5')),
                        'p_over_6_5': _clean(row.get('p_over_6.5')),
                        'p_over_7_5': _clean(row.get('p_over_7.5')),
                        'p_over_8_5': _clean(row.get('p_over_8.5')),
                        'has_line': _bool(row.get('has_line')),
                        'book_line': _clean(row.get('book_line')),
                        'book_side': _str(row.get('book_side')),
                        'best_book': _str(row.get('best_book')),
                        'best_odds': _int(row.get('best_odds')),
                        'book_implied': _clean(row.get('book_implied')),
                        'model_prob_book_line': _clean(row.get('model_prob_book_line')),
                        'edge_book': _clean(row.get('edge_book')),
                        'pp_line': _clean(row.get('pp_line')),
                        'pp_side': _str(row.get('pp_side')),
                        'model_prob_pp_line': _clean(row.get('model_prob_pp_line')),
                        'edge_pp': _clean(row.get('edge_pp')),
                        'book_markets': _str(row.get('book_markets')),
                        'rest_days': _int(row.get('rest_days')),
                        'prev_pitches': _int(row.get('prev_pitches')),
                        'n_prior_starts': _int(row.get('n_prior_starts')),
                        'opp_k_pct_15': _clean(row.get('opp_k_pct_15')),
                        'opp_ops_15': _clean(row.get('opp_ops_15')),
                        'opp_chase_pct_15': _clean(row.get('opp_chase_pct_15')),
                        'n_prior_team_games': _int(row.get('n_prior_team_games')),
                        'park_k_factor': _clean(row.get('park_k_factor')),
                        'temp_f': _clean(row.get('temp_f')),
                        'wind_speed': _clean(row.get('wind_speed')),
                        'wind_favor': _clean(row.get('wind_favor')),
                        'is_dome': _bool(row.get('is_dome')),
                        'p_k_per9_10': _clean(row.get('p_k_per9_10')),
                        'p_bb_per9_10': _clean(row.get('p_bb_per9_10')),
                        'p_hr_per9_10': _clean(row.get('p_hr_per9_10')),
                        'p_whip_10': _clean(row.get('p_whip_10')),
                        'p_fip_10': _clean(row.get('p_fip_10')),
                        'p_k_pct_10': _clean(row.get('p_k_pct_10')),
                        'p_swstr_pct_10': _clean(row.get('p_swstr_pct_10')),
                        'p_called_strike_pct_10': _clean(row.get('p_called_strike_pct_10')),
                        'p_chase_pct_10': _clean(row.get('p_chase_pct_10')),
                        'p_fp_strike_pct_10': _clean(row.get('p_fp_strike_pct_10')),
                        'p_fastball_velo_10': _clean(row.get('p_fastball_velo_10')),
                        'p_fastball_pct_10': _clean(row.get('p_fastball_pct_10')),
                        'p_slider_pct_10': _clean(row.get('p_slider_pct_10')),
                        'p_curveball_pct_10': _clean(row.get('p_curveball_pct_10')),
                        'p_changeup_pct_10': _clean(row.get('p_changeup_pct_10')),
                        'p_other_pct_10': _clean(row.get('p_other_pct_10')),
                        'p_avg_pitches_10': _clean(row.get('p_avg_pitches_10')),
                        'p_avg_ip_10': _clean(row.get('p_avg_ip_10')),
                    })
        frozen_note = f" ({n_frozen} frozen — odds kept from DB)" if n_frozen else ""
        print(f"  Done -- {len(df)} rows upserted{frozen_note}.")
    finally:
        conn.close()


if __name__ == '__main__':
    date_arg = sys.argv[1] if len(sys.argv) > 1 else None
    run(date_arg)
