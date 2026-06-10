# mlb-ks-engine

Pitcher strikeout (K) projection engine, part of the +EV Cave family of tools.
Same architecture and brand as `mlb-prop-engine` (HR tool), separate project
and separate Vercel/data tables.

## Status

Phase 1 (data pipeline) in progress.

## Project layout

```
data/
  raw/          statcast_pitching.parquet, pitcher_game_logs.parquet (gitignored, large)
  processed/    feature tables built from raw data (gitignored, regenerated)
  predictions/  daily prediction outputs
ingestion/
  fetch_statcast_pitching.py   one-time backfill of pitch-level Statcast data (2021-2026)
  update_statcast_pitching.py  incremental updater
  fetch_pitcher_game_logs.py   MLB Stats API per-start game logs (target variable: K count)
features/       rolling-window feature engineering (pitcher, opponent, context)
models/         LightGBM regression model + training script
predict/        daily runner + odds/edge comparison
scripts/        daily pipeline orchestration, DB writes, results logging
web/            Next.js web app (CARD / TRACKER / GUIDE)
```

## Data pipeline (Phase 1)

```
python ingestion/fetch_statcast_pitching.py   # backfill 2021-2026 pitch-level data
python ingestion/fetch_pitcher_game_logs.py   # backfill 2021-2026 per-start game logs (K counts)
python ingestion/update_statcast_pitching.py  # incremental update
```

`data/raw/` is gitignored because pitch-level Statcast data across 6 seasons
is far larger than the HR tool's batted-ball-only store (~14MB). Storage
strategy for CI/automation will be revisited in Phase 7.
