"""
Full daily pipeline for the K projection engine -- run everything in one command.

Usage:
    python -m scripts.daily_pipeline              # today
    python -m scripts.daily_pipeline 2026-06-11   # specific date

Steps (run in order):
    1. Update data and rebuild rolling features
       a. update_statcast_pitching -- pull new Statcast pitches through yesterday
       b. fetch_pitcher_game_logs   -- refresh this season's per-start game logs
       c. pitcher_features          -- rebuild L3/L5/L10 rolling pitcher features
       d. opponent_features         -- rebuild L15 rolling opponent features
    2. daily_runner -- score today's probable starters, output projections CSV
    3. fair_odds    -- pull sportsbook + PrizePicks K lines, compute edge
    4. write_to_db  -- upsert today's output into Neon (ks_predictions table)

Output files:
    data/predictions/ks_predictions_{date}.csv
    data/outputs/ks_fair_odds_{date}.csv
"""

import os
import sys
import time
import traceback
from datetime import date as date_cls

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)


def _run_step(label, fn, *args):
    print(f"\n{'=' * 60}")
    print(f"  {label}")
    print(f"{'=' * 60}")
    t0 = time.time()
    try:
        result = fn(*args)
        print(f"  Completed in {time.time() - t0:.1f}s")
        return result, True
    except Exception as e:
        print(f"  FAILED after {time.time() - t0:.1f}s: {e}")
        traceback.print_exc()
        return None, False


def run(date_str=None):
    if date_str is None:
        date_str = date_cls.today().isoformat()

    print(f"\n{'#' * 60}")
    print(f"#  K Engine Daily Pipeline  --  {date_str}")
    print(f"{'#' * 60}")

    # Step 1: update raw data + rebuild rolling features (non-fatal --
    # predictions can still run on yesterday's features if any of these fail)
    from ingestion.update_statcast_pitching import update as update_statcast
    _run_step("Step 1a/4  Update Statcast pitching", update_statcast)

    from ingestion.fetch_pitcher_game_logs import backfill as update_game_logs
    season = date_cls.fromisoformat(date_str).year
    _run_step(f"Step 1b/4  Update {season} pitcher game logs", update_game_logs, season, season)

    from features.pitcher_features import build as build_pitcher_features
    _run_step("Step 1c/4  Rebuild pitcher_features", build_pitcher_features)

    from features.opponent_features import build as build_opponent_features
    _run_step("Step 1d/4  Rebuild opponent_features", build_opponent_features)

    # Step 2: daily runner (fatal if it fails -- nothing to do in steps 3-4)
    from predict.daily_runner import run as runner_run
    preds, ok = _run_step(f"Step 2/4  Daily runner ({date_str})", runner_run, date_str)
    if not ok or preds is None or len(preds) == 0:
        print("\nDaily runner produced no output. Stopping.")
        return

    # Step 3: fair odds (non-fatal -- predictions are already saved)
    from predict.fair_odds import run as odds_run
    _run_step(f"Step 3/4  Fair odds ({date_str})", odds_run, date_str)

    # Step 4: write to Neon DB (non-fatal -- CSV is the source of truth)
    from scripts.write_to_db import run as db_run
    _run_step(f"Step 4/4  Write to DB ({date_str})", db_run, date_str)

    print(f"\n{'#' * 60}")
    print(f"#  Done  --  {date_str}")
    print(f"#  Predictions : data/predictions/ks_predictions_{date_str}.csv")
    print(f"#  Fair odds   : data/outputs/ks_fair_odds_{date_str}.csv")
    print(f"{'#' * 60}")


if __name__ == '__main__':
    date_arg = sys.argv[1] if len(sys.argv) > 1 else None
    run(date_arg)
