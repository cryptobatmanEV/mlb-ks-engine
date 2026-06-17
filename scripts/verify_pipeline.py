"""
Final CI verification step — called by the daily_pipeline workflow after
predictions are generated and committed.

Checks:
  1. Today's fair_odds CSV exists and has rows (pipeline didn't silently skip)
  2. Neon DB has matching rows for today (write_to_db step didn't fail)

Exits 1 (fails the workflow with a red X) if anything is wrong.
Exits 0 on a genuine off-day (CSV exists but 0 rows — no MLB games).
"""

import os
import sys
from datetime import date

today = date.today().isoformat()
outfile = f'data/outputs/ks_fair_odds_{today}.csv'

# ── CSV presence ──────────────────────────────────────────────────────────────
if not os.path.exists(outfile):
    print(f'PIPELINE FAILURE: {outfile} was not generated.')
    print('The daily_pipeline step failed or was skipped. Check the step log above.')
    sys.exit(1)

import pandas as pd
df = pd.read_csv(outfile)

if len(df) == 0:
    print(f'No rows in {outfile} — likely an off-day with no MLB games.')
    print('Skipping DB verification.')
    sys.exit(0)

# ── DB row count ──────────────────────────────────────────────────────────────
db_url = os.environ.get('DATABASE_URL', '')
if not db_url:
    print('ERROR: DATABASE_URL secret is not set.')
    sys.exit(1)

import psycopg2
try:
    conn = psycopg2.connect(db_url)
    cur  = conn.cursor()
    cur.execute('SELECT COUNT(*) FROM ks_predictions WHERE game_date = %s', (today,))
    count = cur.fetchone()[0]
    conn.close()
except Exception as e:
    print(f'ERROR: Could not query Neon DB: {e}')
    sys.exit(1)

print(f'Verified: {len(df)} rows in CSV, {count} rows in Neon for {today}')

if count == 0:
    print(f'PIPELINE FAILURE: {len(df)} predictions generated but NONE written to Neon.')
    print('Check the write_to_db step output above. DATABASE_URL secret may be stale.')
    sys.exit(1)

print('Pipeline OK — predictions are live.')
