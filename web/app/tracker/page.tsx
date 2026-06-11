import { getDb } from '@/lib/db';
import Nav from '../components/Nav';
import { probOver } from '@/lib/poisson';
import PerformanceCharts, { type PLPoint, type CalibPoint } from './PerformanceCharts';
import BetsTable from './BetsTable';
import { type TrackedBet, toISODate } from './shared';

export const dynamic = 'force-dynamic';

// ── Types ──────────────────────────────────────────────────────────────────

type TrackerStats = {
  total_bets:     number;
  settled_bets:   number;
  wins:           number;
  pushes:         number;
  settled_staked: number;
  total_profit:   number;
};

// ── Formatters ─────────────────────────────────────────────────────────────

function fmtPL(profit: number, settled: number) {
  if (settled === 0) return '—';
  return `${profit >= 0 ? '+' : ''}${profit.toFixed(1)}u`;
}

function fmtROI(profit: number, staked: number) {
  if (staked === 0) return '—';
  const pct = (profit / staked) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

// ── Style tokens ───────────────────────────────────────────────────────────

const LABEL: React.CSSProperties = {
  fontFamily:    'var(--font-mono)',
  fontSize:      '10px',
  letterSpacing: '2px',
  textTransform: 'uppercase',
  color:         'var(--ev-dim)',
};

const CARD: React.CSSProperties = {
  background:   'var(--ev-card)',
  border:       '1px solid var(--ev-border)',
  borderRadius: '2px',
};

// ── Page ───────────────────────────────────────────────────────────────────

export default async function TrackerPage() {
  let tracker: TrackerStats | null = null;
  let bets: TrackedBet[] = [];
  let plData: PLPoint[] = [];
  let calibData: CalibPoint[] = [];
  let dbError: string | null = null;

  try {
    const sql = getDb();

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
    `;
    tracker = stats[0] as TrackerStats;

    bets = (await sql`
      SELECT * FROM ks_tracked_bets ORDER BY created_at DESC
    `) as TrackedBet[];

    // Cumulative P/L over time — settled bets, chronological order
    const settled = (await sql`
      SELECT game_date, result, odds, stake_units
      FROM ks_tracked_bets
      WHERE settled
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
    plData = Array.from(byDate.entries()).map(([date, cumPL]) => ({ date, cumPL }));

    // Calibration — predicted P(over) buckets vs actual over rate (push excluded)
    const calibRaw = (await sql`
      SELECT pred_k::float AS pred_k, line::float AS line, side, result
      FROM ks_tracked_bets
      WHERE settled AND result IN ('win', 'loss') AND pred_k IS NOT NULL
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
      const hit = b.side === 'under' ? b.result === 'win' : b.result === 'win';
      return { predictedProb, hit };
    });

    calibData = BUCKETS.flatMap(b => {
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
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  const totalBets   = tracker ? Number(tracker.total_bets)     : 0;
  const settledBets = tracker ? Number(tracker.settled_bets)   : 0;
  const wins        = tracker ? Number(tracker.wins)           : 0;
  const pushes      = tracker ? Number(tracker.pushes)         : 0;
  const staked      = tracker ? Number(tracker.settled_staked) : 0;
  const profit      = tracker ? Number(tracker.total_profit)   : 0;
  const decided     = settledBets - pushes;
  const winRate     = decided > 0 ? (wins / decided * 100).toFixed(1) + '%' : '—';

  return (
    <main style={{ minHeight: '100vh', background: 'var(--ev-bg)', padding: '32px 20px 60px' }}>
      <div style={{ maxWidth: '1380px', margin: '0 auto' }}>

        {/* Header */}
        <header style={{ marginBottom: '28px' }}>
          <div style={{ ...LABEL, color: 'var(--ev-green)', letterSpacing: '3px', marginBottom: '8px' }}>
            THE +EV CAVE
          </div>
          <h1 style={{
            fontFamily: 'var(--font-syne)', fontWeight: 800, fontSize: '26px',
            margin: 0, letterSpacing: '-0.5px', color: 'var(--ev-text)',
          }}>
            TRACKER
          </h1>
          <div style={{ ...LABEL, color: 'var(--ev-muted)', marginTop: '6px', letterSpacing: '1px' }}>
            PERFORMANCE HISTORY
          </div>
        </header>

        {/* Nav */}
        <Nav active="tracker" />

        {/* Content */}
        {dbError ? (
          <div style={{ ...CARD, padding: '40px', textAlign: 'center' }}>
            <div style={{ ...LABEL, color: 'var(--ev-muted)', marginBottom: '8px' }}>DATABASE ERROR</div>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.15)', wordBreak: 'break-all' }}>
              {dbError}
            </div>
          </div>
        ) : totalBets === 0 ? (
          <div style={{ ...CARD, padding: '48px', textAlign: 'center' }}>
            <div style={{ ...LABEL, color: 'var(--ev-muted)', marginBottom: '6px' }}>NO BETS TRACKED YET</div>
            <div style={{ fontSize: '11px', color: 'var(--ev-dim)' }}>
              Hit TRACK on any play from the CARD page to start.
            </div>
          </div>
        ) : (
          <>
            {/* Stats grid */}
            <div style={{
              display:             'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap:                 '1px',
              background:          'var(--ev-border)',
              border:              '1px solid var(--ev-border)',
              borderRadius:        '2px',
              overflow:            'hidden',
              marginBottom:        '16px',
            }}>
              {([
                {
                  label: 'BETS',
                  value: String(totalBets),
                  sub:   totalBets - settledBets > 0
                    ? `${totalBets - settledBets} PENDING`
                    : 'ALL SETTLED',
                  color: 'var(--ev-text)',
                },
                {
                  label: 'WIN RATE',
                  value: winRate,
                  sub:   decided > 0 ? `${wins}W / ${decided - wins}L` : `${settledBets} SETTLED`,
                  color: 'var(--ev-text)',
                },
                {
                  label: 'P/L',
                  value: fmtPL(profit, settledBets),
                  sub:   `${settledBets} SETTLED`,
                  color: settledBets === 0
                    ? 'var(--ev-dim)'
                    : profit >= 0 ? 'var(--ev-green)' : 'var(--ev-red)',
                },
                {
                  label: 'ROI',
                  value: fmtROI(profit, staked),
                  sub:   `${staked.toFixed(1)}u STAKED`,
                  color: staked === 0
                    ? 'var(--ev-dim)'
                    : profit >= 0 ? 'var(--ev-green)' : 'var(--ev-red)',
                },
              ] as { label: string; value: string; sub: string; color: string }[]).map(
                ({ label, value, sub, color }) => (
                  <div key={label} style={{ background: 'var(--ev-bg)', padding: '16px 18px' }}>
                    <div style={LABEL}>{label}</div>
                    <div style={{
                      fontFamily: 'var(--font-syne)', fontWeight: 800,
                      fontSize: '22px', color, margin: '8px 0 4px', letterSpacing: '-0.5px',
                    }}>
                      {value}
                    </div>
                    <div style={{ ...LABEL, fontSize: '9px' }}>{sub}</div>
                  </div>
                )
              )}
            </div>

            {/* Performance charts */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ ...LABEL, letterSpacing: '3px', marginBottom: '12px' }}>
                PERFORMANCE
              </div>
              <PerformanceCharts plData={plData} calibData={calibData} />
            </div>

            {/* Bets table */}
            <BetsTable bets={bets} />
          </>
        )}

        {/* Footer */}
        <div style={{ ...LABEL, textAlign: 'center', marginTop: '40px', fontSize: '9px', color: 'rgba(255,255,255,0.15)' }}>
          P/L SETTLES AFTER LOG RUN &nbsp;&middot;&nbsp;
          EDGE = MODEL P(OVER) - IMPLIED PROB &nbsp;&middot;&nbsp;
          RESULTS UPDATED DAILY
        </div>

      </div>
    </main>
  );
}
