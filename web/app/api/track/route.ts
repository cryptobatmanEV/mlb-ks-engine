import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      game_date, game_pk, pitcher, pitcher_name, team, opp_team,
      pred_k, line, side, odds, edge, stake_units,
    } = body;

    if (!game_date || game_pk == null || pitcher == null || line == null
        || !side || stake_units == null || stake_units <= 0) {
      return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 });
    }

    const sql = getDb();

    // Safety net: create table if the pipeline hasn't run yet on this environment.
    await sql`
      CREATE TABLE IF NOT EXISTS ks_tracked_bets (
        id           SERIAL PRIMARY KEY,
        game_date    DATE        NOT NULL,
        game_pk      BIGINT      NOT NULL,
        pitcher      BIGINT      NOT NULL,
        pitcher_name TEXT,
        team         TEXT,
        opp_team     TEXT,
        pred_k       FLOAT,
        line         FLOAT       NOT NULL,
        side         TEXT        NOT NULL,
        odds         INTEGER,
        edge         FLOAT,
        stake_units  FLOAT       NOT NULL,
        actual_k     INTEGER     DEFAULT NULL,
        result       TEXT        DEFAULT NULL,
        settled      BOOLEAN     NOT NULL DEFAULT false,
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (game_date, pitcher, line, side)
      )
    `;

    const result = await sql`
      INSERT INTO ks_tracked_bets
        (game_date, game_pk, pitcher, pitcher_name, team, opp_team, pred_k, line, side, odds, edge, stake_units, settled)
      VALUES
        (${game_date}, ${game_pk}, ${pitcher}, ${pitcher_name ?? null}, ${team ?? null}, ${opp_team ?? null},
         ${pred_k ?? null}, ${line}, ${side}, ${odds ?? null}, ${edge ?? null}, ${stake_units}, false)
      ON CONFLICT (game_date, pitcher, line, side) DO UPDATE SET
        pitcher_name = EXCLUDED.pitcher_name,
        team         = EXCLUDED.team,
        opp_team     = EXCLUDED.opp_team,
        pred_k       = EXCLUDED.pred_k,
        odds         = EXCLUDED.odds,
        edge         = EXCLUDED.edge,
        stake_units  = EXCLUDED.stake_units,
        actual_k     = NULL,
        result       = NULL,
        settled      = false,
        created_at   = NOW()
      RETURNING id
    `;

    return NextResponse.json({ success: true, id: result[0].id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/track] POST error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    const sql = getDb();
    const result = await sql`
      DELETE FROM ks_tracked_bets WHERE id = ${Number(id)} RETURNING id
    `;

    if (result.length === 0) {
      return NextResponse.json({ error: 'Bet not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/track] DELETE error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
