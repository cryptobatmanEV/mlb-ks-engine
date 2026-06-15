import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { probOver } from '@/lib/poisson';
import { getVerifiedIdentity } from '@/lib/iframeAuth';
import { type TrackedBet, toISODate } from '../../tracker/shared';
import type { PLPoint, CalibPoint } from '../../tracker/PerformanceCharts';

type TrackerStats = {
  total_bets:     number;
  settled_bets:   number;
  wins:           number;
  pushes:         number;
  settled_staked: number;
  total_profit:   number;
};

export async function GET(req: Request) {
  const identity = getVerifiedIdentity(req);
  if (!identity) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  const discordUserId = identity.discordId;

  try {
    const sql = getDb();

    await sql`ALTER TABLE ks_tracked_bets ADD COLUMN IF NOT EXISTS discord_user_id TEXT`;
    await sql`ALTER TABLE ks_tracked_bets ADD COLUMN IF NOT EXISTS discord_username TEXT`;

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
    const tracker = stats[0] as TrackerStats;

    const bets = (await sql`
      SELECT * FROM ks_tracked_bets WHERE discord_user_id = ${discordUserId} ORDER BY created_at DESC
    `) as TrackedBet[];

    // Cumulative P/L over time — settled bets, chronological order
    const settled = (await sql`
      SELECT game_date, result, odds, stake_units
      FROM ks_tracked_bets
      WHERE settled AND discord_user_id = ${discordUserId}
      ORDER BY game_date ASC, created_at ASC
    `) as { game_date: string; result: string | null; odds: number | null; stake_units: number }[];

    let cum = 0;
    const byDate = new Map<string, number>();
    for (const b of settled) {
      let pl = 0;
      if (b.result === 'win' && b.odds != null) {
        pl = b.odds > 0 ? b.stake_units * (b.odds / 100) : b.stake_units * (100 / Math.abs(b.odds));
      } else if (b.result === 'loss') {
        pl = -b.stake_units;
      } // push -> 0
      cum += pl;
      const date = toISODate(b.game_date).slice(5).replace('-', '/');
      byDate.set(date, Math.round(cum * 100) / 100); // last write per date = end-of-day cumulative
    }
    const plData: PLPoint[] = Array.from(byDate.entries()).map(([date, cumPL]) => ({ date, cumPL }));

    // Calibration — predicted P(over) buckets vs actual over rate (push excluded)
    const calibRaw = (await sql`
      SELECT pred_k::float AS pred_k, line::float AS line, side, result
      FROM ks_tracked_bets
      WHERE settled AND result IN ('win', 'loss') AND pred_k IS NOT NULL AND discord_user_id = ${discordUserId}
    `) as { pred_k: number; line: number; side: string; result: string }[];

    const BUCKETS = [
      { label: '<40%',   min: 0.00, max: 0.40, mid: 0.35 },
      { label: '40-50%', min: 0.40, max: 0.50, mid: 0.45 },
      { label: '50-60%', min: 0.50, max: 0.60, mid: 0.55 },
      { label: '60-70%', min: 0.60, max: 0.70, mid: 0.65 },
      { label: '70%+',   min: 0.70, max: 1.00, mid: 0.75 },
    ];

    const withProb = calibRaw.map(b => {
      const pOver = probOver(b.line, b.pred_k);
      const predictedProb = b.side === 'under' ? 1 - pOver : pOver;
      const hit = b.result === 'win';
      return { predictedProb, hit };
    });

    const calibData: CalibPoint[] = BUCKETS.flatMap(b => {
      const inBucket = withProb.filter(x => x.predictedProb >= b.min && x.predictedProb < b.max);
      if (inBucket.length === 0) return [];
      const hits = inBucket.filter(x => x.hit).length;
      return [{
        label:         b.label,
        predicted_pct: Math.round(b.mid * 1000) / 10,
        actual_pct:    Math.round((hits / inBucket.length) * 1000) / 10,
        count:         inBucket.length,
      }];
    });

    return NextResponse.json({ tracker, bets, plData, calibData });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[tracker-data] DB error:', message);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }
}
