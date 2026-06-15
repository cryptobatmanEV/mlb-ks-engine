import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getVerifiedIdentity } from '@/lib/iframeAuth';

export async function GET(req: Request) {
  try {
    const sql = getDb();

    // Ensure table exists before querying
    await sql`
      CREATE TABLE IF NOT EXISTS ks_tracked_bets (
        id              SERIAL PRIMARY KEY,
        game_date       DATE        NOT NULL,
        game_pk         BIGINT      NOT NULL,
        pitcher         BIGINT      NOT NULL,
        pitcher_name    TEXT,
        team            TEXT,
        opp_team        TEXT,
        pred_k          FLOAT,
        line            FLOAT       NOT NULL,
        side            TEXT        NOT NULL,
        odds            INTEGER,
        edge            FLOAT,
        stake_units     FLOAT       NOT NULL,
        actual_k        INTEGER     DEFAULT NULL,
        result          TEXT        DEFAULT NULL,
        settled         BOOLEAN     NOT NULL DEFAULT false,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        discord_user_id TEXT,
        discord_username TEXT,
        UNIQUE (game_date, pitcher, line, side)
      )
    `;
    await sql`ALTER TABLE ks_tracked_bets ADD COLUMN IF NOT EXISTS discord_user_id TEXT`;
    await sql`ALTER TABLE ks_tracked_bets ADD COLUMN IF NOT EXISTS discord_username TEXT`;

    const identity = getVerifiedIdentity(req);
    const discordUserId = identity?.discordId ?? null;

    // Not logged in: no personal tracked plays to show.
    if (!discordUserId) {
      const emptyStats = {
        total_bets: 0, settled_bets: 0, wins: 0, pushes: 0,
        settled_staked: 0, total_profit: 0,
      };
      return NextResponse.json({ bets: [], stats: emptyStats });
    }

    const bets = await sql`
      SELECT * FROM ks_tracked_bets
      WHERE discord_user_id = ${discordUserId}
      ORDER BY created_at DESC
    `;

    const stats = await sql`
      SELECT
        COUNT(*)::int                                                                     AS total_bets,
        COUNT(*) FILTER (WHERE settled)::int                                              AS settled_bets,
        COUNT(*) FILTER (WHERE result = 'win')::int                                       AS wins,
        COUNT(*) FILTER (WHERE result = 'push')::int                                      AS pushes,
        COALESCE(SUM(CASE WHEN settled AND result != 'push' THEN stake_units ELSE 0 END), 0)::float AS settled_staked,
        COALESCE(SUM(CASE
          WHEN result = 'win'  AND odds >  0 THEN stake_units * (odds::float / 100.0)
          WHEN result = 'win'  AND odds <= 0 THEN stake_units * (100.0 / ABS(odds::float))
          WHEN result = 'loss'                THEN -stake_units
          ELSE 0
        END), 0)::float AS total_profit
      FROM ks_tracked_bets
      WHERE discord_user_id = ${discordUserId}
    `;

    return NextResponse.json({ bets, stats: stats[0] });
  } catch (err) {
    console.error('tracked error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
