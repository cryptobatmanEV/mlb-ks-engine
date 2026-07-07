"""
After write_to_db completes, apply the AI PICKS selection formula to today's
fair_odds CSV and INSERT qualifying plays into ks_ai_picks_log in Neon.

Called as Step 5 of daily_pipeline.py.

AI PICKS qualifications (mirrors KsTable.tsx constants):
  model_prob_book_line > 0.55  AND  p_swstr_pct_10 > 0.20
  All qualifying plays are logged (no cap).

Usage:
    python -m scripts.log_ai_picks              # today
    python -m scripts.log_ai_picks 2026-06-11   # specific date
"""

import math
import os
import sys
from datetime import date as date_cls

import pandas as pd
from dotenv import load_dotenv

load_dotenv()

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

OUTPUTS_DIR = 'data/outputs'

AI_MIN_MODEL_PROB = 0.55
AI_MIN_SWSTR      = 0.20
AI_K9_BASELINE    = 7.0
AI_SWSTR_BASELINE = 0.20
AI_OPP_K_BASELINE = 0.20

_CREATE = """
CREATE TABLE IF NOT EXISTS ks_ai_picks_log (
    id                   SERIAL PRIMARY KEY,
    game_date            DATE        NOT NULL,
    captured_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    pitcher              INT         NOT NULL,
    pitcher_name         TEXT,
    team                 TEXT,
    book_line            NUMERIC,
    book_side            TEXT,
    best_odds            INT,
    best_book            TEXT,
    edge_book            NUMERIC,
    model_prob_book_line NUMERIC,
    composite_score      NUMERIC,
    pred_k               NUMERIC,
    adj_k                NUMERIC,
    pp_line              NUMERIC,
    pp_side              TEXT,
    edge_pp              NUMERIC,
    actual_k             INT,
    result               TEXT,
    UNIQUE (game_date, pitcher)
);
"""

# ON CONFLICT DO NOTHING: each (game_date, pitcher) is inserted once only.
# The pipeline runs 5x/day and would otherwise insert ~5 duplicate rows per pick.
_INSERT = """
INSERT INTO ks_ai_picks_log
    (game_date, captured_at, pitcher, pitcher_name, team,
     book_line, book_side, best_odds, best_book, edge_book,
     model_prob_book_line, composite_score,
     pred_k, adj_k, pp_line, pp_side, edge_pp)
VALUES
    (%s, NOW(), %s, %s, %s,
     %s, %s, %s, %s, %s,
     %s, %s,
     %s, %s, %s, %s, %s)
ON CONFLICT (game_date, pitcher) DO NOTHING
"""


def _flt(v):
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _str(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    s = str(v).strip()
    return s if s else None


def compute_picks(df):
    """Apply AI PICKS formula; return list of pick dicts sorted by composite_score desc."""
    picks = []

    for _, row in df.iterrows():
        model_prob = _flt(row.get('model_prob_book_line'))
        swstr      = _flt(row.get('p_swstr_pct_10'))

        if model_prob is None or swstr is None:
            continue
        if model_prob <= AI_MIN_MODEL_PROB or swstr <= AI_MIN_SWSTR:
            continue

        pred_k    = _flt(row.get('pred_k')) or 0.0
        adj_k     = _flt(row.get('adj_k'))
        adj_k_val = adj_k if adj_k is not None else pred_k

        edge_book = _flt(row.get('edge_book')) or 0.0
        edge_pp   = _flt(row.get('edge_pp'))   or 0.0
        k9        = _flt(row.get('p_k_per9_10'))
        opp_k     = _flt(row.get('opp_k_pct_15'))

        composite = (
            model_prob * 4
            + (swstr - AI_SWSTR_BASELINE) * 3
            + max(edge_book, edge_pp, 0.0) * 2
            + ((k9 - AI_K9_BASELINE) * 0.03 if k9 is not None else 0.0)
            + (1 - abs(pred_k - adj_k_val)) * 0.5
            + ((opp_k - AI_OPP_K_BASELINE) * 1.5 if opp_k is not None else 0.0)
        )

        has_line = str(row.get('has_line', '0')).strip() in ('1', '1.0', 'True', 'true')

        picks.append({
            'pitcher':              _int(row.get('pitcher')),
            'pitcher_name':         _str(row.get('pitcher_name')),
            'team':                 _str(row.get('team')),
            'book_line':            _flt(row.get('book_line')) if has_line else None,
            'book_side':            _str(row.get('book_side')) if has_line else None,
            'best_odds':            _int(row.get('best_odds')) if has_line else None,
            'best_book':            _str(row.get('best_book')) if has_line else None,
            'edge_book':            _flt(row.get('edge_book')) if has_line else None,
            'model_prob_book_line': model_prob,
            'composite_score':      round(composite, 6),
            'pred_k':               _flt(row.get('pred_k')),
            'adj_k':                _flt(row.get('adj_k')),
            'pp_line':              _flt(row.get('pp_line')),
            'pp_side':              _str(row.get('pp_side')),
            'edge_pp':              _flt(row.get('edge_pp')),
        })

    picks.sort(key=lambda p: p['composite_score'], reverse=True)
    return picks


def run(date_str=None):
    if date_str is None:
        date_str = date_cls.today().isoformat()

    path = os.path.join(OUTPUTS_DIR, f'ks_fair_odds_{date_str}.csv')
    if not os.path.exists(path):
        print(f"  No fair_odds CSV for {date_str} — skipping AI picks log.")
        return

    df = pd.read_csv(path)
    picks = compute_picks(df)

    if not picks:
        print(f"  No AI picks qualify for {date_str}.")
        return

    print(f"  {len(picks)} AI pick(s) qualify for {date_str}:")
    for p in picks:
        side = p['book_side'] or 'model'
        line = p['book_line'] or p['pp_line'] or '—'
        print(f"    {p['pitcher_name']} ({p['team']})  score={p['composite_score']:.4f}"
              f"  {side} {line}  prob={p['model_prob_book_line']:.3f}")

    db_url = os.getenv('DATABASE_URL')
    if not db_url:
        print("  DATABASE_URL not set — skipping ks_ai_picks_log write.")
        return

    try:
        import psycopg2
        conn = psycopg2.connect(db_url)
        try:
            with conn:
                with conn.cursor() as cur:
                    cur.execute(_CREATE)
                    inserted = 0
                    for pick in picks:
                        cur.execute(_INSERT, (
                            date_str,
                            pick['pitcher'], pick['pitcher_name'], pick['team'],
                            pick['book_line'], pick['book_side'], pick['best_odds'],
                            pick['best_book'], pick['edge_book'],
                            pick['model_prob_book_line'], pick['composite_score'],
                            pick['pred_k'], pick['adj_k'],
                            pick['pp_line'], pick['pp_side'], pick['edge_pp'],
                        ))
                        inserted += cur.rowcount
            print(f"  Inserted {inserted} row(s) into ks_ai_picks_log.")
        finally:
            conn.close()
    except Exception as e:
        print(f"  WARNING: ks_ai_picks_log write failed: {e}")


if __name__ == '__main__':
    date_arg = sys.argv[1] if len(sys.argv) > 1 else None
    run(date_arg)
