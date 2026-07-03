"""
Pull actual strikeout outcomes for a completed game date, append to the
results log, write actual_k back to ks_predictions, and settle any pending
ks_tracked_bets for that date.

Run this the morning after predictions were made (once games are final):
    python -m scripts.log_results              # logs yesterday's results
    python -m scripts.log_results 2026-06-11    # logs a specific date

The results log grows over time at data/logs/ks_results_log.csv.
Use it to validate the model: compare model_prob_book_line (the model's
probability for whichever side -- over or under -- was recommended, see
book_side) vs the actual hit rate (hit_book_side), and check whether
positive-edge plays are profitable.

Quick calibration query once you have 100+ rows:
    import pandas as pd
    df = pd.read_csv('data/logs/ks_results_log.csv')
    df = df[df['hit_book_side'].isin([0, 1])]
    df['bucket'] = pd.cut(df['model_prob_book_line'], bins=[0,.4,.5,.6,.7,1.0])
    print(df.groupby('bucket')[['model_prob_book_line','hit_book_side']].agg(['mean','count']))
"""

import os
import sys
import time
from datetime import date as date_cls, timedelta

import pandas as pd
import requests
from dotenv import load_dotenv

load_dotenv()

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

MLB_BASE = 'https://statsapi.mlb.com/api/v1'
OUTPUTS_DIR = 'data/outputs'
LOG_PATH = 'data/logs/ks_results_log.csv'

# Columns saved to the log. Prediction columns come from the fair_odds CSV;
# actual_k and over_book_line are appended from boxscore results.
LOG_COLUMNS = [
    'log_date',
    'game_date',
    'pitcher_name', 'team', 'opp_team', 'home_team', 'away_team',
    'pred_k',
    'has_line', 'book_line', 'book_side', 'best_book', 'best_odds', 'book_implied',
    'model_prob_book_line', 'edge_book',
    'pp_line', 'pp_side', 'model_prob_pp_line', 'edge_pp',
    'game_pk', 'pitcher',
    'actual_k',          # -1 = result not found
    'hit_book_side',     # 1 = recommended side (book_side) hit, 0 = missed, -1 = push, -2 = no line / missing
]


def _mlb(path, params=None, timeout=15):
    r = requests.get(f'{MLB_BASE}/{path}', params=params or {}, timeout=timeout)
    r.raise_for_status()
    return r.json()


def fetch_actual_ks(game_pks):
    """
    For each game_pk, fetch the boxscore and return
    {mlbam_player_id: strikeouts_thrown} for every pitcher who appeared.

    A game is considered complete only if it has at least 50 total at-bats
    across both rosters (a full 9-inning game typically has 60-75 AB).
    Games with fewer than 50 AB are skipped with a warning -- they are
    either not started or suspended mid-game.
    """
    k_counts = {}
    incomplete = []

    for pk in game_pks:
        try:
            data = _mlb(f'game/{pk}/boxscore')

            # Gate: count total AB to confirm game is actually finished
            total_ab = 0
            for side in ('home', 'away'):
                for pdata in data.get('teams', {}).get(side, {}).get('players', {}).values():
                    total_ab += pdata.get('stats', {}).get('batting', {}).get('atBats', 0) or 0

            if total_ab < 50:
                incomplete.append(pk)
                continue

            # Game is complete -- harvest strikeout counts for every pitcher
            for side in ('home', 'away'):
                for pdata in data.get('teams', {}).get(side, {}).get('players', {}).values():
                    pitching = pdata.get('stats', {}).get('pitching', {})
                    if not pitching:
                        continue
                    pid = pdata.get('person', {}).get('id')
                    so = pitching.get('strikeOuts', 0) or 0
                    if pid:
                        k_counts[int(pid)] = int(so)

            time.sleep(0.2)

        except Exception as e:
            print(f"  WARNING: boxscore fetch failed for game {pk}: {e}")

    if incomplete:
        print(f"  Skipped {len(incomplete)} game(s) not yet complete "
              f"(< 50 AB in boxscore): {incomplete}")
        print("  Re-run after those games are final.")

    return k_counts


def load_fair_odds(date_str):
    path = os.path.join(OUTPUTS_DIR, f'ks_fair_odds_{date_str}.csv')
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"No fair_odds file found for {date_str}.\n"
            f"Generate it first with:\n"
            f"    python -m scripts.daily_pipeline {date_str}"
        )
    return pd.read_csv(path)


def already_logged(date_str):
    """Return True if this game_date already has rows in the log."""
    if not os.path.exists(LOG_PATH):
        return False
    existing = pd.read_csv(LOG_PATH, usecols=['game_date'])
    return str(date_str) in existing['game_date'].astype(str).values


def append_to_log(records_df):
    os.makedirs('data/logs', exist_ok=True)
    if os.path.exists(LOG_PATH):
        existing = pd.read_csv(LOG_PATH)
        out = pd.concat([existing, records_df], ignore_index=True)
    else:
        out = records_df
    out.to_csv(LOG_PATH, index=False)
    return len(out)


def print_results_table(pred_df):
    """Print today's actual-vs-projected table sorted by pred_k."""
    show = pred_df.sort_values('pred_k', ascending=False).copy()
    show['pred_k'] = show['pred_k'].map('{:.2f}'.format)
    show['edge_book'] = show['edge_book'].apply(
        lambda x: f'{float(x):+.1%}' if pd.notna(x) and str(x) != 'nan' else 'N/A'
    )
    show['result'] = show['hit_book_side'].map({1: 'HIT', 0: 'MISS', -1: 'PUSH', -2: '-'})
    cols = ['pitcher_name', 'team', 'pred_k', 'actual_k', 'book_side', 'book_line', 'edge_book', 'result']
    print(show[[c for c in cols if c in show.columns]].to_string(index=False))


def print_calibration_summary():
    """Print running calibration stats from the full results log."""
    if not os.path.exists(LOG_PATH):
        return
    log = pd.read_csv(LOG_PATH)
    log = log[log['actual_k'] >= 0]  # rows where result is known

    n_total = len(log)
    n_days = log['game_date'].nunique() if 'game_date' in log.columns else 0

    print(f"\n{'='*60}")
    print(f"  Running calibration ({n_days} game dates, {n_total} predictions total)")
    print(f"{'='*60}")

    if n_total < 30:
        print(f"  Not enough data yet for reliable calibration (need ~100+ rows).")
        print(f"  Keep logging daily -- this will fill in automatically.")
        return

    booked = log[log['hit_book_side'].isin([0, 1])].copy()
    if len(booked) >= 20:
        booked['bucket'] = pd.cut(
            booked['model_prob_book_line'],
            bins=[0, .4, .5, .6, .7, 1.0],
            labels=['< 40%', '40-50%', '50-60%', '60-70%', '> 70%'],
        )
        cal = (
            booked.groupby('bucket', observed=True)
                  .agg(predicted=('model_prob_book_line', 'mean'),
                       actual=('hit_book_side', 'mean'),
                       n=('hit_book_side', 'count'))
                  .reset_index()
        )
        cal['predicted'] = cal['predicted'].map('{:.1%}'.format)
        cal['actual']    = cal['actual'].map('{:.1%}'.format)
        print(f"\n  Bucket   Predicted   Actual    N")
        for _, row in cal.iterrows():
            print(f"  {row['bucket']:<8}  {row['predicted']:>9}  {row['actual']:>7}  {row['n']:>4}")
    else:
        print(f"  Need more book-lined results to evaluate (have {len(booked)} so far).")

    # Positive-edge plays specifically
    log['edge_num'] = pd.to_numeric(log['edge_book'], errors='coerce')
    pos_edge = log[(log['has_line'] == 1) & (log['edge_num'] > 0) & (log['hit_book_side'].isin([0, 1]))]
    if len(pos_edge) >= 5:
        actual_rate = pos_edge['hit_book_side'].mean()
        pred_rate   = pos_edge['model_prob_book_line'].mean()
        print(f"\n  Positive-edge plays: {len(pos_edge)} flagged")
        print(f"    Predicted avg P(side): {pred_rate:.1%}")
        print(f"    Actual hit rate:       {actual_rate:.1%}")
        if actual_rate >= pred_rate * 0.8:
            print(f"    Model is tracking well on positive-edge picks.")
        else:
            print(f"    Actual rate is below predicted -- worth investigating.")
    elif log['has_line'].sum() > 0:
        print(f"\n  Need more positive-edge plays to evaluate (have {len(pos_edge)} so far).")


def write_results_to_db(date_str, pred_df):
    """
    Write actual_k back to ks_predictions in Neon so the web app can show
    actual results on past-date cards. Only rows with a known result
    (actual_k >= 0) are updated.
    """
    import psycopg2
    db_url = os.getenv('DATABASE_URL')
    if not db_url:
        return

    known = pred_df[pred_df['actual_k'] >= 0][['pitcher', 'actual_k']].copy()
    if known.empty:
        return

    try:
        conn = psycopg2.connect(db_url)
        try:
            with conn:
                with conn.cursor() as cur:
                    for _, row in known.iterrows():
                        cur.execute(
                            """
                            UPDATE ks_predictions
                               SET actual_k = %s
                             WHERE game_date = %s
                               AND pitcher   = %s
                            """,
                            (int(row['actual_k']), date_str, int(row['pitcher'])),
                        )
            print(f"  Wrote results to ks_predictions for {len(known)} pitcher(s).")
        finally:
            conn.close()
    except Exception as e:
        print(f"  WARNING: ks_predictions result write failed: {e}")


def grade_ai_picks_log(date_str, pred_df):
    """
    Update ks_ai_picks_log SET actual_k, result for rows where game_date matches
    and actual_k is not yet set. Grading uses each row's own book_line/book_side.
    """
    import psycopg2
    db_url = os.getenv('DATABASE_URL')
    if not db_url:
        return

    known = pred_df[pred_df['actual_k'] >= 0][['pitcher', 'actual_k']].copy()
    if known.empty:
        return

    actual_by_pitcher = dict(zip(known['pitcher'].astype(int), known['actual_k'].astype(int)))

    try:
        conn = psycopg2.connect(db_url)
        try:
            updated = 0
            with conn:
                with conn.cursor() as cur:
                    # Ensure the table exists before querying it
                    cur.execute("""
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
                            result               TEXT
                        )
                    """)

                    cur.execute(
                        """
                        SELECT id, pitcher, book_line, book_side
                          FROM ks_ai_picks_log
                         WHERE game_date = %s
                           AND actual_k IS NULL
                        """,
                        (date_str,),
                    )
                    rows = cur.fetchall()

                    for row_id, pitcher_id, line, side in rows:
                        actual_k = actual_by_pitcher.get(int(pitcher_id))
                        if actual_k is None:
                            continue

                        if line is None or side is None:
                            result = None
                        elif actual_k == float(line):
                            result = 'push'
                        elif (side or 'over').lower() == 'under':
                            result = 'win' if actual_k < float(line) else 'loss'
                        else:
                            result = 'win' if actual_k > float(line) else 'loss'

                        cur.execute(
                            """
                            UPDATE ks_ai_picks_log
                               SET actual_k = %s, result = %s
                             WHERE id = %s
                            """,
                            (actual_k, result, row_id),
                        )
                        updated += cur.rowcount

            if updated:
                print(f"  Graded {updated} AI pick(s) in ks_ai_picks_log.")
            else:
                print("  No ungraded AI picks for this date.")
        finally:
            conn.close()
    except Exception as e:
        print(f"  WARNING: ks_ai_picks_log grading failed: {e}")


def backfill_tracked_bets(date_str, pred_df):
    """
    After results are logged, settle ks_tracked_bets rows for this date
    that are still pending (settled = false), using each row's own
    line/side rather than the book line.
    """
    import psycopg2
    db_url = os.getenv('DATABASE_URL')
    if not db_url:
        print("  DATABASE_URL not set -- skipping ks_tracked_bets backfill.")
        return

    # Build lookup: pitcher_id -> actual_k (skip -1 = unknown)
    known = pred_df[pred_df['actual_k'] >= 0][['pitcher', 'actual_k']].copy()
    if known.empty:
        return
    actual_by_pitcher = dict(zip(known['pitcher'].astype(int), known['actual_k'].astype(int)))

    try:
        conn = psycopg2.connect(db_url)
        try:
            updated = 0
            with conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT id, pitcher, line, side
                          FROM ks_tracked_bets
                         WHERE game_date = %s
                           AND settled = false
                        """,
                        (date_str,),
                    )
                    pending = cur.fetchall()

                    for bet_id, pitcher_id, line, side in pending:
                        actual_k = actual_by_pitcher.get(int(pitcher_id))
                        if actual_k is None:
                            continue

                        side_lower = (side or 'over').lower()
                        if actual_k == line:
                            result = 'push'
                        elif side_lower == 'under':
                            result = 'win' if actual_k < line else 'loss'
                        else:
                            result = 'win' if actual_k > line else 'loss'

                        cur.execute(
                            """
                            UPDATE ks_tracked_bets
                               SET actual_k = %s,
                                   result   = %s,
                                   settled  = true
                             WHERE id = %s
                            """,
                            (actual_k, result, bet_id),
                        )
                        updated += cur.rowcount
            if updated:
                print(f"  Backfilled {updated} tracked bet(s) with results.")
            else:
                print("  No pending tracked bets for this date.")
        finally:
            conn.close()
    except Exception as e:
        print(f"  WARNING: ks_tracked_bets backfill failed: {e}")


def run(date_str=None, force_db=False, rerun=False):
    if date_str is None:
        date_str = (date_cls.today() - timedelta(days=1)).isoformat()

    print(f"\n{'='*60}")
    print(f"  Log Results  --  {date_str}")
    print(f"{'='*60}")

    # Guard against logging the same date twice
    if already_logged(date_str):
        if rerun:
            # --rerun: wipe existing rows for this date and re-process from the
            # current fair_odds CSV. Use this when a starter was confirmed late
            # and missed the initial logging window (e.g., a night game whose
            # lineup wasn't posted until after all pipeline runs had already
            # committed and the 6 AM log run had already fired).
            print(f"\n  {date_str} is already in the log — removing existing rows for re-processing (--rerun).")
            existing = pd.read_csv(LOG_PATH)
            kept = existing[existing['game_date'].astype(str) != str(date_str)]
            removed = len(existing) - len(kept)
            kept.to_csv(LOG_PATH, index=False)
            print(f"  Removed {removed} existing row(s). Re-processing from current CSV...")
        elif not force_db:
            print(f"\n  {date_str} is already in the log. Nothing to do.")
            print_calibration_summary()
            return
        else:
            # --force-db: re-run the Neon writes from the existing log row(s)
            # without re-appending to ks_results_log.csv. Useful to backfill
            # ks_predictions/ks_tracked_bets after a DB connection issue.
            print(f"\n  {date_str} is already in the log -- re-running DB writes only.")
            log = pd.read_csv(LOG_PATH)
            pred_df = log[log['game_date'].astype(str) == str(date_str)].copy()
            write_results_to_db(date_str, pred_df)
            backfill_tracked_bets(date_str, pred_df)
            grade_ai_picks_log(date_str, pred_df)
            print_calibration_summary()
            return

    # Load predictions for that date
    print(f"\nLoading predictions for {date_str}...")
    try:
        pred_df = load_fair_odds(date_str)
    except FileNotFoundError as e:
        print(f"  {e}")
        return
    print(f"  {len(pred_df)} confirmed starters loaded")

    # Fetch actual boxscore results
    game_pks = pred_df['game_pk'].dropna().astype(int).unique().tolist()
    print(f"\nFetching boxscores for {len(game_pks)} game(s)...")
    k_counts = fetch_actual_ks(game_pks)

    if not k_counts:
        print("\n  No complete boxscores found.")
        print("  Games may not be finished yet. Re-run after the last game is final.")
        return

    print(f"  Pitching results retrieved for {len(k_counts)} pitcher(s)")

    # Join actual results onto predictions
    pred_df = pred_df.copy()
    pred_df['actual_k'] = pred_df['pitcher'].map(k_counts)
    # -1 means the pitcher's result wasn't in the boxscore (didn't pitch, etc.)
    pred_df['actual_k'] = pred_df['actual_k'].fillna(-1).astype(int)

    def _hit_book_side(row):
        if row['actual_k'] < 0 or row['has_line'] != 1 or pd.isna(row['book_line']) or pd.isna(row.get('book_side')):
            return -2
        if row['actual_k'] == row['book_line']:
            return -1
        if str(row['book_side']).lower() == 'under':
            return 1 if row['actual_k'] < row['book_line'] else 0
        return 1 if row['actual_k'] > row['book_line'] else 0

    pred_df['hit_book_side'] = pred_df.apply(_hit_book_side, axis=1)
    pred_df['log_date'] = date_cls.today().isoformat()

    # Summary counts
    n_found   = (pred_df['actual_k'] >= 0).sum()
    n_missing = (pred_df['actual_k'] == -1).sum()

    print(f"\n  Results matched : {n_found}/{len(pred_df)} pitchers")
    print(f"  Result missing  : {n_missing}")
    if n_missing > 0:
        missing_names = pred_df[pred_df['actual_k'] == -1]['pitcher_name'].tolist()
        print(f"  Missing pitchers: {missing_names}")

    # Results table
    print(f"\n  Today's actual vs projected (sorted by pred_k):")
    print_results_table(pred_df)

    # Save to log
    save_cols = [c for c in LOG_COLUMNS if c in pred_df.columns]
    total_rows = append_to_log(pred_df[save_cols])
    print(f"\n  Appended {len(pred_df)} rows to {LOG_PATH}  ({total_rows} total rows in log)")

    # Write results to Neon (ks_predictions + ks_tracked_bets + ks_ai_picks_log)
    write_results_to_db(date_str, pred_df)
    backfill_tracked_bets(date_str, pred_df)
    grade_ai_picks_log(date_str, pred_df)

    # Running calibration summary
    print_calibration_summary()


if __name__ == '__main__':
    args = sys.argv[1:]
    force_db = '--force-db' in args
    rerun    = '--rerun'    in args
    args = [a for a in args if a not in ('--force-db', '--rerun')]
    date_arg = args[0] if args else None
    run(date_arg, force_db=force_db, rerun=rerun)
