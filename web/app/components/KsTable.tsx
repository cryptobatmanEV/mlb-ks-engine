'use client';

import { useState, useEffect, useMemo, Fragment } from 'react';
import KsTrackButton from './KsTrackButton';
import { useIframeIdentity, identityHeaders } from '../lib/iframeIdentity';
import { BookLogo } from './BookLogos';

// ── Types ──────────────────────────────────────────────────────────────────

export type Row = {
  id: number;
  game_date: string;
  game_pk: number;
  pitcher: number;
  pitcher_name: string;
  team: string;
  opp_team: string;
  home_team: string;
  away_team: string;
  is_home: boolean;
  day_night: string | null;
  venue: string | null;
  game_time: string | null;
  pred_k: number;
  adj_k: number | null;
  actual_k: number | null;
  p_over_4_5: number | null;
  p_over_5_5: number | null;
  p_over_6_5: number | null;
  p_over_7_5: number | null;
  p_over_8_5: number | null;
  has_line: boolean;
  book_line: number | null;
  book_side: string | null;
  best_book: string | null;
  best_odds: number | null;
  book_implied: number | null;
  model_prob_book_line: number | null;
  edge_book: number | null;
  pp_line: number | null;
  pp_side: string | null;
  model_prob_pp_line: number | null;
  edge_pp: number | null;
  ud_line: number | null;
  ud_is_alt: boolean | null;
  ud_side: string | null;
  model_prob_ud_line: number | null;
  edge_ud: number | null;
  rest_days: number | null;
  prev_pitches: number | null;
  n_prior_starts: number | null;
  opp_k_pct_15: number | null;
  opp_ops_15: number | null;
  opp_chase_pct_15: number | null;
  n_prior_team_games: number | null;
  park_k_factor: number | null;
  temp_f: number | null;
  wind_speed: number | null;
  wind_favor: number | null;
  is_dome: boolean | null;
  p_k_per9_10: number | null;
  p_bb_per9_10: number | null;
  p_hr_per9_10: number | null;
  p_whip_10: number | null;
  p_fip_10: number | null;
  p_k_pct_10: number | null;
  p_swstr_pct_10: number | null;
  p_called_strike_pct_10: number | null;
  p_chase_pct_10: number | null;
  p_fp_strike_pct_10: number | null;
  p_fastball_velo_10: number | null;
  p_fastball_pct_10: number | null;
  p_slider_pct_10: number | null;
  p_curveball_pct_10: number | null;
  p_changeup_pct_10: number | null;
  p_other_pct_10: number | null;
  p_avg_pitches_10: number | null;
  p_avg_ip_10: number | null;
  book_markets: string | null;
};

type SortKey =
  | 'pitcher_name' | 'team' | 'opp_team' | 'pred_k' | 'adj_k' | 'actual_k'
  | 'book_line' | 'edge_book' | 'model_prob_book_line' | 'pp_line' | 'edge_pp'
  | 'p_k_per9_10' | 'p_swstr_pct_10' | 'opp_k_pct_15' | 'park_k_factor' | 'game_time';

type SortDir = 'asc' | 'desc';

// ── League averages + thresholds for detail card coloring ─────────────────

type StatKey =
  | 'p_k_per9_10' | 'p_bb_per9_10' | 'p_hr_per9_10' | 'p_whip_10' | 'p_fip_10'
  | 'p_k_pct_10' | 'p_swstr_pct_10' | 'p_called_strike_pct_10' | 'p_chase_pct_10' | 'p_fp_strike_pct_10'
  | 'opp_k_pct_15' | 'opp_ops_15' | 'opp_chase_pct_15' | 'park_k_factor';

const LEAGUE_AVG: Record<StatKey, number> = {
  p_k_per9_10:            8.6,
  p_bb_per9_10:           3.1,
  p_hr_per9_10:           1.2,
  p_whip_10:              1.25,
  p_fip_10:               4.00,
  p_k_pct_10:             0.225,
  p_swstr_pct_10:         0.110,
  p_called_strike_pct_10: 0.165,
  p_chase_pct_10:         0.280,
  p_fp_strike_pct_10:     0.610,
  opp_k_pct_15:           0.227,
  opp_ops_15:             0.720,
  opp_chase_pct_15:       0.286,
  park_k_factor:          100,
};

// Half-width of the "muted" neutral band around the average
const BAND: Record<StatKey, number> = {
  p_k_per9_10:            0.8,
  p_bb_per9_10:           0.4,
  p_hr_per9_10:           0.3,
  p_whip_10:              0.10,
  p_fip_10:               0.40,
  p_k_pct_10:             0.025,
  p_swstr_pct_10:         0.015,
  p_called_strike_pct_10: 0.015,
  p_chase_pct_10:         0.02,
  p_fp_strike_pct_10:     0.03,
  opp_k_pct_15:           0.015,
  opp_ops_15:             0.04,
  opp_chase_pct_15:       0.02,
  park_k_factor:          3,
};

// Stats where LOWER is better for the pitcher (walks, HR, WHIP, FIP, opp OPS)
const INVERT: Partial<Record<StatKey, true>> = {
  p_bb_per9_10: true, p_hr_per9_10: true, p_whip_10: true, p_fip_10: true, opp_ops_15: true,
};

function statColor(key: StatKey, val: number | null): string {
  if (val == null || isNaN(val)) return 'var(--ev-dim)';
  let diff = val - LEAGUE_AVG[key];
  if (Math.abs(diff) <= BAND[key]) return 'var(--ev-muted)';
  if (INVERT[key]) diff = -diff;
  return diff > 0 ? 'var(--ev-green)' : 'var(--ev-red)';
}

// ── Generic value formatters ────────────────────────────────────────────────

function fmtPct1(val: number | null): string {
  if (val == null || isNaN(val)) return '—';
  return (val * 100).toFixed(1) + '%';
}

function fmtNum(val: number | null, dp: number): string {
  if (val == null || isNaN(val)) return '—';
  return val.toFixed(dp);
}

function fmtInt(val: number | null): string {
  if (val == null || isNaN(val)) return '—';
  return String(Math.round(val));
}

// ── Detail card stat groups ─────────────────────────────────────────────────

const PITCHER_FORM_STATS: { key: StatKey; label: string; fmt: (v: number | null) => string }[] = [
  { key: 'p_k_per9_10',            label: 'K/9',            fmt: v => fmtNum(v, 2) },
  { key: 'p_bb_per9_10',           label: 'BB/9',           fmt: v => fmtNum(v, 2) },
  { key: 'p_hr_per9_10',           label: 'HR/9',           fmt: v => fmtNum(v, 2) },
  { key: 'p_whip_10',              label: 'WHIP',           fmt: v => fmtNum(v, 2) },
  { key: 'p_fip_10',               label: 'FIP',            fmt: v => fmtNum(v, 2) },
  { key: 'p_k_pct_10',             label: 'K%',             fmt: fmtPct1 },
  { key: 'p_swstr_pct_10',         label: 'SWSTR%',         fmt: fmtPct1 },
  { key: 'p_called_strike_pct_10', label: 'CALLED STRIKE%', fmt: fmtPct1 },
  { key: 'p_chase_pct_10',         label: 'CHASE%',         fmt: fmtPct1 },
  { key: 'p_fp_strike_pct_10',     label: 'FP STRIKE%',     fmt: fmtPct1 },
];

const OPPONENT_STATS: { key: StatKey | 'n_prior_team_games'; label: string; fmt: (v: number | null) => string; color?: boolean }[] = [
  { key: 'opp_k_pct_15',     label: 'OPP K%',     fmt: fmtPct1, color: true },
  { key: 'opp_ops_15',       label: 'OPP OPS',    fmt: v => fmtNum(v, 3), color: true },
  { key: 'opp_chase_pct_15', label: 'OPP CHASE%', fmt: fmtPct1, color: true },
  { key: 'n_prior_team_games', label: 'GAMES',    fmt: fmtInt },
];

// ── Detail card ────────────────────────────────────────────────────────────


function fmtGameTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York',
    }) + ' ET';
  } catch {
    return iso;
  }
}

type MyLineProps = {
  raw:      string;
  odds:     number | null;  // parsed American odds
  edge:     number | null;  // model_prob − implied_prob(odds)
  onChange: (val: string) => void;
};

function DetailCard({ row, showMarket, myLine }: { row: Row; showMarket?: boolean; myLine?: MyLineProps }) {
  const myEdgeDisp = myLine ? edgeDisplay(myLine.edge, myLine.odds != null) : null;

  const CARD: React.CSSProperties = {
    background:   '#111416',
    borderRadius: '8px',
    border:       '1px solid rgba(255,255,255,0.06)',
    padding:      '10px 12px',
  };
  const SEC_LABEL: React.CSSProperties = {
    fontFamily:    'var(--font-mono)',
    fontSize:      '9px',
    letterSpacing: '2px',
    textTransform: 'uppercase',
    color:         'rgba(255,255,255,0.4)',
    marginBottom:  '12px',
  };
  const STAT_LABEL: React.CSSProperties = {
    fontFamily:    'var(--font-mono)',
    fontSize:      '9px',
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
    color:         'rgba(255,255,255,0.4)',
    marginBottom:  '4px',
  };
  const STAT_VAL: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize:   '13px',
    fontWeight: 500,
  };

  // ── Section 1: Market Odds + DFS (combined) ───────────────────────────────
  const BOOKS_LIST: { key: string; label: string }[] = [
    { key: 'pinnacle',   label: 'Pinnacle'   },
    { key: 'fanduel',    label: 'FanDuel'    },
    { key: 'draftkings', label: 'DraftKings' },
    { key: 'betrivers',  label: 'BetRivers'  },
    { key: 'novig',      label: 'Novig'      },
    { key: 'betmgm',     label: 'BetMGM'     },
  ];
  type BookMarket = { line?: number; over: number | null; under: number | null } | null;
  let markets: Record<string, BookMarket> = {};
  let hasMarkets = false;
  if (row.has_line && row.book_markets != null) {
    try { markets = JSON.parse(row.book_markets) as Record<string, BookMarket>; hasMarkets = true; } catch { /* stay empty */ }
  }
  const favSide = row.book_side ?? 'over';

  const marketDfsSection = (
    <div style={CARD}>
      <div style={SEC_LABEL}>MARKET ODDS & DFS</div>
      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
        {/* Sportsbook table — left column */}
        {hasMarkets && (
          <div style={{ flex: '2 1 240px' }}>
            <table style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: '12px', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', color: 'rgba(255,255,255,0.35)', padding: '0 0 8px 0', fontSize: '9px', letterSpacing: '1.5px', fontWeight: 400 }}>BOOK</th>
                  <th style={{ textAlign: 'right', color: 'rgba(255,255,255,0.35)', padding: '0 0 8px 0', fontSize: '9px', letterSpacing: '1.5px', fontWeight: 400 }}>LINE</th>
                  <th style={{ textAlign: 'right', color: 'rgba(255,255,255,0.35)', padding: '0 0 8px 0', fontSize: '9px', letterSpacing: '1.5px', fontWeight: 400 }}>ODDS</th>
                </tr>
              </thead>
              <tbody>
                {BOOKS_LIST.map(({ key, label }) => {
                  const data = markets[key];
                  const bookLine = data?.line ?? null;
                  const isConsensus = bookLine != null && row.book_line != null && bookLine === row.book_line;
                  const isAltLine   = bookLine != null && !isConsensus;
                  // For consensus line pick the recommended side; for alt lines show whatever odds exist
                  const odds = data != null
                    ? (isAltLine ? (data.over ?? data.under) : (favSide === 'under' ? data.under : data.over))
                    : null;
                  const lineStr  = bookLine != null ? `${favSide === 'under' ? 'U' : 'O'} ${bookLine}` : null;
                  const lineColor = lineStr
                    ? (isConsensus ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.38)')
                    : 'rgba(255,255,255,0.2)';
                  return (
                    <tr key={key} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '7px 0', color: data != null ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.3)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <BookLogo bookKey={key} size={16} />
                          {label}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', padding: '7px 16px 7px 0', color: lineColor, whiteSpace: 'nowrap' }}>
                        {lineStr ?? '—'}
                        {isAltLine && <span style={{ marginLeft: '4px', fontSize: '8px', color: 'rgba(255,255,255,0.25)', letterSpacing: '1px' }}>ALT</span>}
                      </td>
                      <td style={{ textAlign: 'right', color: odds != null ? (odds > 0 ? 'var(--ev-green)' : 'rgba(255,255,255,0.9)') : 'rgba(255,255,255,0.25)' }}>
                        {odds != null ? fmtOdds(odds) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* DFS — right column (stacked PP + UD) */}
        <div style={{ flex: '1 1 160px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* PrizePicks */}
          <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '6px', padding: '10px 12px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px' }}>
              <BookLogo bookKey="prizepicks" size={14} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '1.5px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>PrizePicks</span>
            </div>
            {row.pp_line != null ? (
              <>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '18px', fontWeight: 700, color: 'rgba(255,255,255,0.95)', lineHeight: 1.1, marginBottom: '5px' }}>
                  {row.pp_side === 'under' ? 'U' : 'O'} {row.pp_line}
                </div>
                {(() => { const d = edgeDisplay(row.edge_pp, true); return <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: d.weight, color: d.color }}>{d.text}</div>; })()}
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'rgba(255,255,255,0.25)', marginTop: '3px' }}>Break-even 53.5%</div>
              </>
            ) : (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'rgba(255,255,255,0.2)' }}>No line</div>
            )}
          </div>
          {/* Underdog */}
          <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '6px', padding: '10px 12px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px' }}>
              <BookLogo bookKey="underdog" size={14} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '1.5px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>Underdog</span>
            </div>
            {row.ud_line != null ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '5px', marginBottom: '5px' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '18px', fontWeight: 700, color: 'rgba(255,255,255,0.95)', lineHeight: 1.1 }}>
                    {row.ud_side === 'under' ? 'U' : 'O'} {row.ud_line}
                  </span>
                  {row.ud_is_alt && <span style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', letterSpacing: '1px', color: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '2px', padding: '1px 3px' }}>ALT</span>}
                </div>
                {(() => { const d = edgeDisplay(row.edge_ud, true); return <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: d.weight, color: d.color }}>{d.text}</div>; })()}
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'rgba(255,255,255,0.25)', marginTop: '3px' }}>Break-even 53.5%</div>
              </>
            ) : (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'rgba(255,255,255,0.2)' }}>No line</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // ── Section 3: Advanced Stats + MY ODDS ────────────────────────────────────
  const statsSection = (
    <div style={CARD}>
      {myLine && (
        <div style={{ marginBottom: '16px', paddingBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <div style={{ ...STAT_LABEL, color: 'var(--ev-gold)' }}>MY ODDS</div>
              <input
                type="text"
                placeholder="-110"
                value={myLine.raw}
                onChange={e => myLine.onChange(e.target.value)}
                onClick={e => e.stopPropagation()}
                style={{
                  width:        '80px',
                  background:   'rgba(255,255,255,0.06)',
                  border:       `1px solid ${myLine.raw.trim() ? 'rgba(255,200,0,0.5)' : 'rgba(255,255,255,0.12)'}`,
                  borderRadius: '4px',
                  color:        myLine.raw.trim() ? 'var(--ev-gold)' : 'rgba(255,255,255,0.35)',
                  fontFamily:   'var(--font-mono)',
                  fontSize:     '13px',
                  fontWeight:   500,
                  padding:      '5px 9px',
                  textAlign:    'right',
                  outline:      'none',
                }}
              />
            </div>
            {myEdgeDisp && (
              <div>
                <div style={{ ...STAT_LABEL, color: 'var(--ev-gold)' }}>MY EDGE</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: myEdgeDisp.weight, color: myEdgeDisp.color }}>
                  {myEdgeDisp.text}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px' }}>
          <div style={SEC_LABEL}>PITCHER FORM L10</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {PITCHER_FORM_STATS.map(({ key, label, fmt }) => {
              const val = row[key] as number | null;
              return (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '1px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>{label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: statColor(key, val) }}>{fmt(val)}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ flex: '1 1 160px' }}>
          <div style={SEC_LABEL}>OPPONENT L15</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {OPPONENT_STATS.map(({ key, label, fmt, color }) => {
              const val = row[key as keyof Row] as number | null;
              return (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '1px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>{label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: color ? statColor(key as StatKey, val) : 'rgba(255,255,255,0.85)' }}>{fmt(val)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  // ── Game info bar ──────────────────────────────────────────────────────────
  const gameInfoBar = (
    <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'rgba(255,255,255,0.3)', letterSpacing: '1px' }}>
      {row.venue && <span>{row.venue}</span>}
      {row.day_night && <span style={{ textTransform: 'uppercase' }}>{row.day_night}</span>}
      <span>{fmtGameTime(row.game_time)}</span>
    </div>
  );

  return (
    <div style={{
      padding:       '16px',
      background:    'rgba(255,255,255,0.012)',
      borderTop:     '1px solid rgba(255,255,255,0.06)',
      display:       'flex',
      flexDirection: 'column',
      gap:           '10px',
    }}>
      {/* Mobile summary row (proj/adj/book) */}
      {showMarket && (
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <div style={STAT_LABEL}>PROJ Ks</div>
            <div style={{ ...STAT_VAL, color: 'rgba(255,255,255,0.9)' }}>{row.pred_k.toFixed(2)}</div>
          </div>
          <div>
            <div style={STAT_LABEL}>ADJ Ks</div>
            <div style={{ ...STAT_VAL, color: 'rgba(255,255,255,0.9)' }}>{(row.adj_k ?? row.pred_k).toFixed(2)}</div>
          </div>
          <div>
            <div style={STAT_LABEL}>BOOK EDGE</div>
            {(() => { const d = edgeDisplay(row.edge_book, row.has_line); return <div style={{ ...STAT_VAL, color: d.color, fontWeight: d.weight }}>{d.text}</div>; })()}
          </div>
        </div>
      )}
      {marketDfsSection}
      {statsSection}
      {gameInfoBar}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtOdds(o: number | null) {
  if (o == null) return '—';
  return o > 0 ? `+${o}` : `${o}`;
}

// Postgres DATE columns come back from Neon as JS Date objects, not strings.
function toISODate(d: unknown): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

// Key used to look up whether a (game_date, pitcher) pair is already in
// ks_tracked_bets -- see trackedKeys in the component body.
function trackedKey(gameDate: unknown, pitcher: number): string {
  return `${toISODate(gameDate)}_${pitcher}`;
}

function edgeDisplay(edge: number | null, show: boolean) {
  if (!show || edge == null) return { text: '—', color: 'var(--ev-dim)', weight: 400 };
  const sign = edge > 0 ? '+' : '';
  const text = `${sign}${(edge * 100).toFixed(1)}%`;
  if (edge > 0.05)  return { text, color: 'var(--ev-green)', weight: 600 };
  if (edge > 0)     return { text, color: 'var(--ev-green)', weight: 400 };
  if (edge > -0.03) return { text, color: 'var(--ev-muted)',  weight: 400 };
                    return { text, color: 'var(--ev-red)',    weight: 400 };
}

function modelProbDisplay(prob: number | null, show: boolean) {
  if (!show || prob == null) return { text: '—', color: 'var(--ev-dim)', weight: 400 };
  const text = `${(prob * 100).toFixed(1)}%`;
  if (prob > 0.58)  return { text, color: 'var(--ev-green)', weight: 600 };
  if (prob >= 0.50) return { text, color: 'var(--ev-muted)', weight: 400 };
                    return { text, color: 'var(--ev-red)',   weight: 400 };
}

// Parses American odds input (e.g. "-110", "+120", "105"). Must be ≥100 in
// absolute value to be a valid moneyline.
function parseOddsInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = parseInt(trimmed.replace(/^\+/, ''), 10);
  if (isNaN(n) || Math.abs(n) < 100) return null;
  return n;
}

// Convert American odds to implied probability (no vig).
function impliedProb(americanOdds: number): number {
  if (americanOdds > 0) return 100 / (americanOdds + 100);
  const abs = Math.abs(americanOdds);
  return abs / (abs + 100);
}

function getSortVal(row: Row, key: SortKey): string | number | null {
  return row[key as keyof Row] as string | number | null;
}

// TRACK button line/odds/edge/side: book line > PP line (-119, PrizePicks
// standard pick'em) > model projection (-110 default). Shared by the desktop
// table, mobile cards, and AI Picks.
function getTrackInfo(row: Row): { trackLine: number; trackOdds: number; trackEdge: number | null; trackSide: string } {
  if (row.has_line && row.book_line != null) {
    return { trackLine: row.book_line, trackOdds: row.best_odds ?? -110, trackEdge: row.edge_book, trackSide: row.book_side ?? 'over' };
  }
  if (row.pp_line != null) {
    return { trackLine: row.pp_line, trackOdds: -119, trackEdge: row.edge_pp, trackSide: row.pp_side ?? 'over' };
  }
  return { trackLine: Math.floor(row.pred_k) + 0.5, trackOdds: -110, trackEdge: null, trackSide: 'over' };
}

// ── Style tokens ───────────────────────────────────────────────────────────

const LABEL: React.CSSProperties = {
  fontFamily:    'var(--font-mono)',
  fontSize:      '10px',
  letterSpacing: '2px',
  textTransform: 'uppercase',
  color:         'var(--ev-dim)',
};

const TH_BASE: React.CSSProperties = {
  ...LABEL,
  padding:    'var(--ks-pad-y) var(--ks-pad-x)',
  fontWeight:  500,
  background: 'rgba(255,255,255,0.02)',
  userSelect: 'none',
  whiteSpace: 'nowrap',
};

const STICKY_BG = '#0a0d0f';

// ── Column definitions ─────────────────────────────────────────────────────

type ColDef = { key: SortKey | null; label: string; align: 'left' | 'right'; sticky?: boolean; hide?: 'lvl1' | 'lvl2' };

const COLS: ColDef[] = [
  { key: 'pitcher_name',         label: 'PITCHER',    align: 'left',  sticky: true },
  { key: 'team',                 label: 'TEAM',       align: 'left'  },
  { key: 'opp_team',             label: 'OPP',        align: 'left'  },
  { key: 'pred_k',               label: 'PROJ KS',    align: 'right' },
  { key: 'adj_k',                label: 'ADJ KS',     align: 'right' },
  { key: 'book_line',            label: 'BOOK O/U',   align: 'right' },
  { key: 'edge_book',            label: 'BOOK EDGE',  align: 'right' },
  { key: 'model_prob_book_line', label: 'MODEL PROB', align: 'right' },
  { key: 'p_swstr_pct_10',       label: 'SWSTR%',     align: 'right' },
  { key: 'pp_line',              label: 'PP',         align: 'right' },
  { key: null,                   label: 'UD',         align: 'right' },
  { key: null,                   label: 'MY ODDS',    align: 'right' },
  { key: null,                   label: 'MY EDGE',    align: 'right' },
  { key: null,                   label: '',           align: 'right' },
];

// K/9 L10, OPP K%, PARK, and GAME TIME are not shown as table columns --
// they're available in the expanded detail card -- to keep TRACK visible
// without horizontal scroll on desktop.

// Result column (ACTUAL Ks) is only spliced into COLS for past dates once
// actual_k has been logged -- see `cols` in the component. The W/L result
// itself is shown inline next to the pitcher's name instead of its own column.
const ACTUAL_K_COL: ColDef = { key: 'actual_k', label: 'ACTUAL Ks', align: 'right', hide: 'lvl1' };

// Compares an actual K total against a recommended line/side. Shared by the
// main table (book line/side) and AI Picks (whichever line/side was tracked).
function resultForLine(actualK: number | null, line: number, side: string): { text: string; color: string } | null {
  if (actualK == null) return null;
  if (actualK === line) return { text: 'P', color: 'var(--ev-gold)' };
  const hit = side === 'under' ? actualK < line : actualK > line;
  return hit
    ? { text: 'W', color: 'var(--ev-green)' }
    : { text: 'L', color: 'var(--ev-red)' };
}

function resultForRow(row: Row): { text: string; color: string } | null {
  if (!row.has_line || row.book_line == null || row.book_side == null) return null;
  return resultForLine(row.actual_k, row.book_line, row.book_side);
}

// ── AI Picks ───────────────────────────────────────────────────────────────

const AI_PICK_LIMIT = 5;
const AI_MIN_SWSTR = 0.20;
const AI_MIN_MODEL_PROB = 0.55;
const AI_K9_BASELINE = 7.0;
const AI_SWSTR_BASELINE = 0.20;
const AI_OPP_K_BASELINE = 0.20;

type AiPick = {
  row: Row;
  compositeScore: number;
  reason: string;
  trackSource: 'book' | 'pp' | 'model';
  trackLine: number;
  trackSide: string;
  trackOdds: number;
  trackEdge: number | null;
};

// Builds a one-line "why this pick" summary. Always leads with MODEL PROB
// (the most direct "will this play win" signal -- qualification guarantees
// it's present and > AI_MIN_MODEL_PROB for every pick), then 1-2 secondary
// factors.
//
// For UNDER plays, elite SWSTR%/K9 are signals for high K output and would
// read as a contradiction next to an under recommendation, so they're
// omitted in favor of the projection-vs-line comparison that actually
// motivates the under.
function buildPickReason(
  row: Row,
  trackSide: string,
  trackLine: number,
  swstrBonus: number,
  k9Bonus: number,
  agreementBonus: number,
  oppKBonus: number,
  edgeBonus: number,
): string {
  const lead = row.model_prob_book_line != null
    ? `${(row.model_prob_book_line * 100).toFixed(1)}% model confidence`
    : null;

  if (trackSide === 'under') {
    const adjK = row.adj_k ?? row.pred_k;
    const parts: string[] = [];
    if (lead) parts.push(lead);
    parts.push(`projected ${row.pred_k.toFixed(2)} Ks vs ${trackLine} line favors the under`);

    if (adjK <= trackLine - 0.5) {
      parts.push(`ADJ Ks (${adjK.toFixed(2)}) also well below the line`);
    }
    if (agreementBonus > 0.35) {
      parts.push('model/market consensus');
    }
    if (edgeBonus > 0.1) {
      const edgePct = (Math.max(row.edge_book ?? 0, row.edge_pp ?? 0, row.edge_ud ?? 0) * 100).toFixed(1);
      parts.push(`positive market edge (+${edgePct}%)`);
    }

    const joined = parts.join(', ');
    return joined.charAt(0).toUpperCase() + joined.slice(1);
  }

  const factors: { label: string; weight: number }[] = [];

  if (row.p_swstr_pct_10 != null) {
    factors.push({ label: `elite SWSTR% (${fmtPct1(row.p_swstr_pct_10)})`, weight: swstrBonus });
  }
  if (oppKBonus > 0 && row.opp_k_pct_15 != null) {
    factors.push({ label: `favorable OPP K% (${fmtPct1(row.opp_k_pct_15)})`, weight: oppKBonus });
  }
  if (k9Bonus > 0.03 && row.p_k_per9_10 != null) {
    factors.push({ label: `strong K/9 L10 (${fmtNum(row.p_k_per9_10, 1)})`, weight: k9Bonus });
  }
  if (agreementBonus > 0.35) {
    factors.push({ label: 'model/market consensus', weight: agreementBonus });
  }
  if (edgeBonus > 0.1) {
    const edgePct = (Math.max(row.edge_book ?? 0, row.edge_pp ?? 0, row.edge_ud ?? 0) * 100).toFixed(1);
    factors.push({ label: `positive market edge (+${edgePct}%)`, weight: edgeBonus });
  }

  factors.sort((a, b) => b.weight - a.weight);
  const secondary = factors.slice(0, lead ? 2 : 3).map(f => f.label);
  const parts = lead ? [lead, ...secondary] : secondary;

  if (parts.length === 0) return lead ?? 'Model favors this play';
  const joined = parts.join(', ');
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

function AiPickCard({ pick, rank, trackedKeys, authHeaders }: { pick: AiPick; rank: number; trackedKeys: Set<string>; authHeaders?: HeadersInit }) {
  const { row } = pick;
  const bookEdgeDisp  = edgeDisplay(row.edge_book, row.has_line);
  const ppEdgeDisp    = edgeDisplay(row.edge_pp, row.pp_line != null);
  const modelProbDisp = modelProbDisplay(row.model_prob_book_line, row.has_line);
  const playSide     = pick.trackSide === 'under' ? 'U' : 'O';
  const result       = row.actual_k != null ? resultForLine(row.actual_k, pick.trackLine, pick.trackSide) : null;
  const isTracked    = trackedKeys.has(trackedKey(row.game_date, row.pitcher));

  return (
    <div style={{
      background:    'var(--ev-card)',
      border:        '1px solid var(--ev-border)',
      borderRadius:  '2px',
      padding:       '16px 18px',
      display:       'flex',
      flexDirection: 'column',
      gap:           '12px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', letterSpacing: '2px', color: 'var(--ev-green)', fontWeight: 700 }}>
            #{rank}
          </span>
          <span style={{ fontFamily: 'var(--font-syne)', fontWeight: 800, fontSize: '16px', color: 'var(--ev-text)' }}>
            {row.pitcher_name}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--ev-muted)' }}>
            {row.team} {row.is_home ? 'vs' : '@'} {row.opp_team}
          </span>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--ev-dim)' }}>
          {fmtGameTime(row.game_time)}
        </span>
      </div>

      {/* Play + projections + edges */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '28px', alignItems: 'flex-end' }}>
        <div>
          <div style={LABEL}>THE PLAY</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '20px', fontWeight: 700, color: 'var(--ev-gold)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            {playSide} {pick.trackLine}
            <span style={{ fontSize: '11px', color: 'var(--ev-blue)', fontWeight: 400 }}>
              {fmtOdds(pick.trackOdds)}
              {pick.trackSource === 'book' && row.best_book && (
                <span style={{ color: 'rgba(255,255,255,0.18)', marginLeft: '4px' }}>{row.best_book}</span>
              )}
            </span>
            {result && (
              <span style={{
                fontSize: '11px', fontWeight: 700, color: result.color,
                border: `1px solid ${result.color}`, borderRadius: '2px',
                padding: '1px 6px', letterSpacing: '1px',
              }}>
                {result.text}
              </span>
            )}
          </div>
        </div>

        <div>
          <div style={LABEL}>PROJ Ks → ADJ Ks</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--ev-text)', marginTop: '4px' }}>
            {row.pred_k.toFixed(2)} → {(row.adj_k ?? row.pred_k).toFixed(2)}
          </div>
        </div>

        {row.actual_k != null && (
          <div>
            <div style={LABEL}>ACTUAL Ks</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--ev-text)', marginTop: '4px', fontWeight: 700 }}>
              {row.actual_k}
            </div>
          </div>
        )}

        <div>
          <div style={LABEL}>BOOK EDGE</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', marginTop: '4px', color: bookEdgeDisp.color, fontWeight: bookEdgeDisp.weight }}>
            {bookEdgeDisp.text}
          </div>
        </div>

        <div>
          <div style={LABEL}>MODEL PROB</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', marginTop: '4px', color: modelProbDisp.color, fontWeight: modelProbDisp.weight }}>
            {modelProbDisp.text}
          </div>
        </div>

        {row.pp_line != null && (
          <div>
            <div style={LABEL}>PP PLAY</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--ev-text)', marginTop: '4px' }}>
              {row.pp_side === 'under' ? 'U' : 'O'} {row.pp_line}
            </div>
          </div>
        )}

        <div>
          <div style={LABEL}>PP EDGE</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', marginTop: '4px', color: ppEdgeDisp.color, fontWeight: ppEdgeDisp.weight }}>
            {ppEdgeDisp.text}
          </div>
        </div>
      </div>

      {/* Reason */}
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--ev-muted)', lineHeight: 1.6, fontStyle: 'italic' }}>
        {pick.reason}
      </div>

      {/* TRACK */}
      <div>
        <KsTrackButton
          gameDate={toISODate(row.game_date)}
          gamePk={row.game_pk}
          pitcher={row.pitcher}
          pitcherName={row.pitcher_name}
          team={row.team}
          oppTeam={row.opp_team}
          predK={row.pred_k}
          line={pick.trackLine}
          side={pick.trackSide}
          odds={pick.trackOdds}
          edge={pick.trackEdge}
          isTracked={isTracked}
          authHeaders={authHeaders}
        />
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export default function KsTable({ rows }: { rows: Row[] }) {
  const [sortKey,        setSortKey]        = useState<SortKey>('pred_k');
  const [sortDir,        setSortDir]        = useState<SortDir>('desc');
  const [customLines,    setCustomLines]    = useState<Record<string, string>>({});
  const [evOnly,         setEvOnly]         = useState(false);
  const [expandedRow,    setExpandedRow]    = useState<string | null>(null);
  const [searchQuery,    setSearchQuery]    = useState('');
  const [viewMode,       setViewMode]       = useState<'edge' | 'game' | 'ai'>('edge');
  const [trackedKeys,    setTrackedKeys]    = useState<Set<string>>(new Set());

  const identity   = useIframeIdentity();
  const authHeaders = identityHeaders(identity);

  // Pull already-tracked (game_date, pitcher) pairs so TRACK buttons can show
  // "TRACKED" instead, and refresh whenever the underlying rows change (e.g.
  // after tracking a new play or navigating to a different date).
  useEffect(() => {
    if (identity === undefined) return;
    let cancelled = false;
    fetch('/api/tracked', { headers: identityHeaders(identity) })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (cancelled || !data?.bets) return;
        const keys = new Set<string>(
          data.bets.map((b: { game_date: unknown; pitcher: number }) => trackedKey(b.game_date, b.pitcher))
        );
        setTrackedKeys(keys);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [rows, identity]);

  function handleSort(key: SortKey | null) {
    if (!key) return;
    if (key === sortKey) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function rowId(row: Row): string {
    return `${row.game_pk}-${row.pitcher}`;
  }

  function toggleExpand(id: string) {
    setExpandedRow(prev => prev === id ? null : id);
  }

  // Game labels built from all rows so filters don't break them
  const gameLabels = useMemo(() => {
    const map = new Map<number, string>();
    for (const row of rows) {
      if (!map.has(row.game_pk)) {
        map.set(row.game_pk, `${row.away_team} @ ${row.home_team}  (${fmtGameTime(row.game_time)})`);
      }
    }
    return map;
  }, [rows]);

  const searchFiltered = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.trim().toLowerCase();
    return rows.filter(r =>
      r.pitcher_name.toLowerCase().includes(q) ||
      r.team.toLowerCase().includes(q) ||
      r.opp_team.toLowerCase().includes(q)
    );
  }, [rows, searchQuery]);

  const evCount = useMemo(
    () => searchFiltered.filter(r =>
      (r.edge_book != null && r.edge_book > 0) || (r.edge_pp != null && r.edge_pp > 0) || (r.edge_ud != null && r.edge_ud > 0)
    ).length,
    [searchFiltered]
  );

  const filtered = useMemo(() => {
    if (!evOnly) return searchFiltered;
    return searchFiltered.filter(r =>
      (r.edge_book != null && r.edge_book > 0) || (r.edge_pp != null && r.edge_pp > 0) || (r.edge_ud != null && r.edge_ud > 0)
    );
  }, [searchFiltered, evOnly]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = getSortVal(a, sortKey);
      const bv = getSortVal(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const grouped = useMemo(() => {
    const gameMap = new Map<number, Row[]>();
    for (const row of filtered) {
      if (!gameMap.has(row.game_pk)) gameMap.set(row.game_pk, []);
      gameMap.get(row.game_pk)!.push(row);
    }
    for (const gameRows of gameMap.values()) {
      gameRows.sort((a, b) => b.pred_k - a.pred_k);
    }
    return Array.from(gameMap.values()).sort((a, b) => b[0].pred_k - a[0].pred_k);
  }, [filtered]);

  // AI Picks: curated top plays for the day, independent of search/filters,
  // ranked primarily by MODEL PROB (model_prob_book_line -- the most direct
  // "will this play win" signal), backed up by pitch quality (SWSTR%),
  // market edge, recent K production, model/market agreement, and matchup.
  const aiPicks = useMemo((): AiPick[] => {
    const candidates: AiPick[] = [];

    for (const row of rows) {
      if (row.model_prob_book_line == null || row.p_swstr_pct_10 == null) continue;
      if (row.model_prob_book_line <= AI_MIN_MODEL_PROB || row.p_swstr_pct_10 <= AI_MIN_SWSTR) continue;

      const adjK = row.adj_k ?? row.pred_k;

      let trackSource: 'book' | 'pp' | 'model';
      let trackLine: number;
      let trackSide: string;
      let trackOdds: number;
      let trackEdge: number | null;

      if (row.has_line && row.book_line != null) {
        trackSource = 'book';
        trackLine   = row.book_line;
        trackSide   = row.book_side ?? 'over';
        trackOdds   = row.best_odds ?? -110;
        trackEdge   = row.edge_book;
      } else if (row.pp_line != null) {
        trackSource = 'pp';
        trackLine   = row.pp_line;
        trackSide   = row.pp_side ?? 'over';
        trackOdds   = -119;
        trackEdge   = row.edge_pp;
      } else {
        trackSource = 'model';
        trackLine   = Math.floor(row.pred_k) + 0.5;
        trackSide   = 'over';
        trackOdds   = -110;
        trackEdge   = null;
      }

      const modelProbBonus = row.model_prob_book_line * 4;
      const swstrBonus     = (row.p_swstr_pct_10 - AI_SWSTR_BASELINE) * 3;
      const edgeBonus      = Math.max(row.edge_book ?? 0, row.edge_pp ?? 0, row.edge_ud ?? 0, 0) * 2;
      const k9Bonus        = row.p_k_per9_10 != null ? (row.p_k_per9_10 - AI_K9_BASELINE) * 0.03 : 0;
      const agreementBonus = (1 - Math.abs(row.pred_k - adjK)) * 0.5;
      const oppKBonus      = row.opp_k_pct_15 != null ? (row.opp_k_pct_15 - AI_OPP_K_BASELINE) * 1.5 : 0;

      const compositeScore = modelProbBonus + swstrBonus + edgeBonus + k9Bonus + agreementBonus + oppKBonus;
      const reason = buildPickReason(row, trackSide, trackLine, swstrBonus, k9Bonus, agreementBonus, oppKBonus, edgeBonus);

      candidates.push({ row, compositeScore, reason, trackSource, trackLine, trackSide, trackOdds, trackEdge });
    }

    candidates.sort((a, b) => b.compositeScore - a.compositeScore);
    return candidates.slice(0, AI_PICK_LIMIT);
  }, [rows]);

  // ACTUAL Ks column only appears once actual_k has been logged for this
  // date -- i.e. never for today's still-in-progress card.
  const hasResults = useMemo(() => rows.some(r => r.actual_k != null), [rows]);

  const cols = useMemo(() => {
    if (!hasResults) return COLS;
    const out = [...COLS];
    out.splice(out.findIndex(c => c.key === 'adj_k') + 1, 0, ACTUAL_K_COL);
    return out;
  }, [hasResults]);

  type TableItem =
    | { type: 'row';    row: Row }
    | { type: 'header'; label: string; count: number; gamePk: number };

  const tableItems = useMemo((): TableItem[] => {
    if (viewMode === 'edge') return sorted.map(row => ({ type: 'row' as const, row }));
    return grouped.flatMap(gameRows => [
      {
        type:   'header' as const,
        label:  gameLabels.get(gameRows[0].game_pk) ?? `GAME ${gameRows[0].game_pk}`,
        count:  gameRows.length,
        gamePk: gameRows[0].game_pk,
      },
      ...gameRows.map(row => ({ type: 'row' as const, row })),
    ]);
  }, [viewMode, sorted, grouped, gameLabels]);

  return (
    <div>
      {/* Search */}
      <input
        type="text"
        placeholder="SEARCH PITCHER OR TEAM..."
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
        style={{
          display:       'block',
          width:         '100%',
          boxSizing:     'border-box',
          marginBottom:  '10px',
          background:    'rgba(255,255,255,0.04)',
          border:        '1px solid rgba(255,255,255,0.1)',
          borderRadius:  '2px',
          color:         'var(--ev-text)',
          fontFamily:    'var(--font-mono)',
          fontSize:      '11px',
          letterSpacing: '1.5px',
          padding:       '8px 12px',
          outline:       'none',
        }}
      />

      {/* Filter toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
        {viewMode !== 'ai' && (
          <button
            onClick={() => setEvOnly(v => !v)}
            style={{
              fontFamily:    'var(--font-mono)',
              fontSize:      '10px',
              letterSpacing: '2px',
              textTransform: 'uppercase',
              padding:       '5px 12px',
              borderRadius:  '2px',
              cursor:        'pointer',
              background:    evOnly ? 'rgba(0, 220, 110, 0.12)' : 'transparent',
              border:        evOnly ? '1px solid var(--ev-green)' : '1px solid rgba(255,255,255,0.12)',
              color:         evOnly ? 'var(--ev-green)' : 'var(--ev-dim)',
            }}
          >
            +EV ONLY
          </button>
        )}

        {/* View mode toggle */}
        <div style={{
          display:      'flex',
          border:       '1px solid rgba(255,255,255,0.12)',
          borderRadius: '2px',
          overflow:     'hidden',
        }}>
          {(['edge', 'game', 'ai'] as const).map((mode, i) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                fontFamily:    'var(--font-mono)',
                fontSize:      '10px',
                letterSpacing: '2px',
                textTransform: 'uppercase',
                padding:       '5px 11px',
                cursor:        'pointer',
                border:        'none',
                borderRight:   i < 2 ? '1px solid rgba(255,255,255,0.12)' : 'none',
                background:    viewMode === mode ? 'rgba(255,255,255,0.07)' : 'transparent',
                color:         viewMode === mode
                  ? (mode === 'ai' ? 'var(--ev-gold)' : 'var(--ev-text)')
                  : 'var(--ev-dim)',
              }}
            >
              {mode === 'edge' ? 'BY EDGE' : mode === 'game' ? 'BY GAME' : 'AI PICKS'}
            </button>
          ))}
        </div>

        <span style={{ ...LABEL, fontSize: '10px' }}>
          {viewMode === 'ai'
            ? `${aiPicks.length} CURATED PICK${aiPicks.length !== 1 ? 'S' : ''}`
            : evOnly
              ? `SHOWING ${evCount} +EV PITCHER${evCount !== 1 ? 'S' : ''}`
              : `${evCount} +EV / ${rows.length} TOTAL`}
        </span>
      </div>

      {/* Mobile sort (<768px) */}
      {viewMode !== 'ai' && (
        <div className="ks-mobile-sort" style={{ gap: '8px', marginBottom: '8px' }}>
          <select
            value={sortKey}
            onChange={e => { setSortKey(e.target.value as SortKey); setSortDir('desc'); }}
            style={{
              flex:          1,
              background:    'rgba(255,255,255,0.04)',
              border:        '1px solid rgba(255,255,255,0.1)',
              borderRadius:  '2px',
              color:         'var(--ev-text)',
              fontFamily:    'var(--font-mono)',
              fontSize:      '11px',
              letterSpacing: '1.5px',
              padding:       '7px 10px',
              outline:       'none',
            }}
          >
            <option value="pred_k">SORT: PROJ Ks</option>
            <option value="adj_k">SORT: ADJ Ks</option>
            <option value="edge_book">SORT: BOOK EDGE</option>
            <option value="model_prob_book_line">SORT: MODEL PROB</option>
            <option value="p_swstr_pct_10">SORT: SWSTR%</option>
          </select>
          <button
            onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
            style={{
              background:    'rgba(255,255,255,0.04)',
              border:        '1px solid rgba(255,255,255,0.1)',
              borderRadius:  '2px',
              color:         'var(--ev-dim)',
              fontFamily:    'var(--font-mono)',
              fontSize:      '12px',
              padding:       '7px 12px',
              cursor:        'pointer',
            }}
          >
            {sortDir === 'desc' ? '▼' : '▲'}
          </button>
        </div>
      )}

      {/* AI Picks panel */}
      {viewMode === 'ai' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ ...LABEL, fontSize: '10px' }}>RANKED BY PROJECTION CONFIDENCE</div>
          {aiPicks.length === 0 ? (
            <div style={{
              background: 'var(--ev-card)', border: '1px solid var(--ev-border)', borderRadius: '2px',
              padding: '32px', textAlign: 'center',
              fontFamily: 'var(--font-mono)', fontSize: '11px', letterSpacing: '1.5px',
              textTransform: 'uppercase', color: 'var(--ev-dim)',
            }}>
              No pitchers meet the SWSTR% / K-9 thresholds on today&apos;s slate.
            </div>
          ) : (
            aiPicks.map((pick, i) => (
              <AiPickCard key={`${pick.row.game_pk}-${pick.row.pitcher}`} pick={pick} rank={i + 1} trackedKeys={trackedKeys} authHeaders={authHeaders} />
            ))
          )}
        </div>
      ) : (
      /* Table */
      <div className="ks-table-wrap">
      <div className="ks-table-desktop" style={{
        background: 'var(--ev-card)', border: '1px solid var(--ev-border)',
        borderRadius: '2px', overflowX: 'auto',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 'var(--ks-font)' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--ev-border)' }}>
              {cols.map((col, ci) => {
                const isActive = col.key !== null && sortKey === col.key;
                const isMyCol = col.label === 'MY ODDS' || col.label === 'MY EDGE';
                return (
                  <th
                    key={ci}
                    onClick={() => handleSort(col.key)}
                    className={col.hide === 'lvl1' ? 'ks-col-lvl1' : col.hide === 'lvl2' ? 'ks-col-lvl2' : undefined}
                    style={{
                      ...TH_BASE,
                      textAlign: col.align,
                      cursor: col.key ? 'pointer' : 'default',
                      color: isMyCol
                        ? 'var(--ev-gold)'
                        : isActive
                          ? 'var(--ev-text)'
                          : 'var(--ev-dim)',
                      ...(col.sticky ? {
                        position:    'sticky',
                        left:        0,
                        zIndex:      2,
                        background:  STICKY_BG,
                        borderRight: '1px solid var(--ev-border)',
                      } : {}),
                    }}
                  >
                    {col.label}
                    {isActive && (
                      <span style={{ marginLeft: '4px', fontSize: '9px', color: 'var(--ev-green)' }}>
                        {sortDir === 'desc' ? '▼' : '▲'}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {tableItems.map(item => {
              if (item.type === 'header') {
                return (
                  <tr key={`hdr-${item.gamePk}`}>
                    <td colSpan={cols.length} style={{
                      padding:       '7px 16px',
                      background:    'rgba(255,255,255,0.03)',
                      borderTop:     '1px solid rgba(255,255,255,0.08)',
                      borderBottom:  '1px solid rgba(255,255,255,0.05)',
                      fontFamily:    'var(--font-mono)',
                      fontSize:      '10px',
                      letterSpacing: '2.5px',
                      textTransform: 'uppercase',
                      color:         'var(--ev-text)',
                    }}>
                      {item.label}
                      <span style={{ color: 'var(--ev-dim)', marginLeft: '14px', letterSpacing: '1px', fontSize: '9px' }}>
                        {item.count} PITCHER{item.count !== 1 ? 'S' : ''}
                      </span>
                    </td>
                  </tr>
                );
              }

              const row = item.row;
              const id = rowId(row);
              const isExpanded = expandedRow === id;

              const bookEdgeDisp  = edgeDisplay(row.edge_book, row.has_line);
              const modelProbDisp = modelProbDisplay(row.model_prob_book_line, row.has_line);
              const result       = hasResults ? resultForRow(row) : null;

              const rawInput    = customLines[id] ?? '';
              const customOdds  = parseOddsInput(rawInput);
              const modelProb   = row.model_prob_book_line ?? row.model_prob_pp_line ?? row.model_prob_ud_line;
              const myOddsEdge  = customOdds != null && modelProb != null
                ? modelProb - impliedProb(customOdds)
                : null;
              const myEdgeDisp  = edgeDisplay(myOddsEdge, customOdds != null && modelProb != null);

              // TRACK: use book/PP line; MY ODDS overrides the tracked odds + edge.
              let trackLine: number;
              let trackOdds: number;
              let trackEdge: number | null;
              let trackSide: string;
              if (row.has_line && row.book_line != null) {
                trackLine = row.book_line;
                trackOdds = customOdds ?? (row.best_odds ?? -110);
                trackEdge = myOddsEdge ?? row.edge_book;
                trackSide = row.book_side ?? 'over';
              } else if (row.pp_line != null) {
                trackLine = row.pp_line;
                trackOdds = customOdds ?? -119;
                trackEdge = myOddsEdge ?? row.edge_pp;
                trackSide = row.pp_side ?? 'over';
              } else {
                trackLine = Math.floor(row.pred_k) + 0.5;
                trackOdds = customOdds ?? -110;
                trackEdge = myOddsEdge;
                trackSide = 'over';
              }

              return (
                <Fragment key={id}>
                  <tr
                    className="pred-row"
                    onClick={() => toggleExpand(id)}
                    style={{
                      height:       '52px',
                      borderBottom: isExpanded ? 'none' : '1px solid rgba(255,255,255,0.06)',
                      cursor:       'pointer',
                      background:   isExpanded ? 'rgba(255,255,255,0.03)' : undefined,
                    }}
                  >

                    {/* PITCHER — sticky */}
                    <td style={{
                      padding:     'var(--ks-pad-y) var(--ks-pad-x)',
                      color:       'rgba(255,255,255,0.95)',
                      fontWeight:  600,
                      fontFamily:  'var(--font-syne)',
                      position:    'sticky',
                      left:        0,
                      zIndex:      1,
                      background:  isExpanded ? 'rgba(20,24,28,1)' : STICKY_BG,
                      borderRight: '1px solid rgba(255,255,255,0.06)',
                      whiteSpace:  'nowrap',
                    }}>
                      <span style={{
                        display:     'inline-block',
                        marginRight: '6px',
                        fontSize:    '9px',
                        color:       isExpanded ? 'var(--ev-green)' : 'rgba(255,255,255,0.2)',
                        transition:  'transform 0.15s',
                        transform:   isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                      }}>▶</span>
                      {row.pitcher_name}
                      {row.has_line && row.book_line != null && row.adj_k != null && Math.abs(row.adj_k - row.book_line) > 1.0 && (
                        <span
                          title="Adjusted projection differs from market line by more than 1K strikeout. Check lineup, weather, or recent news before betting."
                          style={{ marginLeft: '5px', color: 'var(--ev-red)', fontSize: '13px', fontWeight: 700, cursor: 'help', verticalAlign: 'middle' }}
                        >!</span>
                      )}
                      {result && (
                        <span style={{
                          marginLeft: '8px', fontSize: '10px', fontWeight: 700, color: result.color,
                          border: `1px solid ${result.color}`, borderRadius: '2px',
                          padding: '1px 5px', letterSpacing: '1px',
                        }}>
                          {result.text}
                        </span>
                      )}
                    </td>

                    {/* TEAM */}
                    <td style={{ padding: 'var(--ks-pad-y) var(--ks-pad-x)', color: 'rgba(255,255,255,0.6)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                      {row.team}
                    </td>

                    {/* OPP */}
                    <td style={{ padding: 'var(--ks-pad-y) var(--ks-pad-x)', color: 'rgba(255,255,255,0.38)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                      {row.is_home ? 'vs ' : '@ '}{row.opp_team}
                    </td>

                    {/* PROJ KS */}
                    <td style={{ padding: 'var(--ks-pad-y) var(--ks-pad-x)', textAlign: 'right', color: 'rgba(255,255,255,0.95)', fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: '14px' }}>
                      {row.pred_k.toFixed(2)}
                    </td>

                    {/* ADJ KS */}
                    <td style={{ padding: 'var(--ks-pad-y) var(--ks-pad-x)', textAlign: 'right', color: 'rgba(255,255,255,0.7)', fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
                      {row.adj_k != null ? row.adj_k.toFixed(2) : <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '10px' }}>—</span>}
                    </td>

                    {/* ACTUAL Ks */}
                    {hasResults && (
                      <td className="ks-col-lvl1" style={{ padding: 'var(--ks-pad-y) var(--ks-pad-x)', textAlign: 'right', color: 'rgba(255,255,255,0.9)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                        {row.actual_k != null ? row.actual_k : <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '10px' }}>—</span>}
                      </td>
                    )}

                    {/* BOOK O/U — line prominent, book logo + odds below */}
                    <td style={{ padding: 'var(--ks-pad-y) var(--ks-pad-x)', textAlign: 'right', verticalAlign: 'middle' }}>
                      {row.has_line ? (
                        <div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '15px', fontWeight: 600, color: 'rgba(255,255,255,0.95)', lineHeight: 1.2 }}>
                            {row.book_side === 'under' ? 'U' : 'O'} {row.book_line}
                          </div>
                          {row.best_book && (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '3px', marginTop: '3px' }}>
                              <BookLogo bookKey={row.best_book.toLowerCase()} size={12} />
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'rgba(255,255,255,0.35)' }}>{fmtOdds(row.best_odds)}</span>
                            </div>
                          )}
                        </div>
                      ) : <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '11px' }}>—</span>}
                    </td>

                    {/* BOOK EDGE */}
                    <td style={{ padding: 'var(--ks-pad-y) var(--ks-pad-x)', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '13px', color: bookEdgeDisp.color, fontWeight: bookEdgeDisp.weight }}>
                      {bookEdgeDisp.text}
                    </td>

                    {/* MODEL PROB */}
                    <td style={{ padding: 'var(--ks-pad-y) var(--ks-pad-x)', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '13px', color: modelProbDisp.color, fontWeight: modelProbDisp.weight }}>
                      {modelProbDisp.text}
                    </td>

                    {/* SWSTR% */}
                    <td style={{ padding: 'var(--ks-pad-y) var(--ks-pad-x)', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '13px', color: statColor('p_swstr_pct_10', row.p_swstr_pct_10) }}>
                      {fmtPct1(row.p_swstr_pct_10)}
                    </td>

                    {/* PP — logo + line */}
                    <td style={{ padding: 'var(--ks-pad-y) var(--ks-pad-x)', textAlign: 'right' }}>
                      {row.pp_line != null ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                          <BookLogo bookKey="prizepicks" size={14} />
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'rgba(255,255,255,0.85)' }}>
                            {row.pp_side === 'under' ? 'U' : 'O'} {row.pp_line}
                          </span>
                        </div>
                      ) : <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '11px' }}>—</span>}
                    </td>

                    {/* UD — logo + line */}
                    <td style={{ padding: 'var(--ks-pad-y) var(--ks-pad-x)', textAlign: 'right', verticalAlign: 'middle' }}>
                      {row.ud_line != null ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                          <BookLogo bookKey="underdog" size={14} />
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'rgba(255,255,255,0.85)' }}>
                            {row.ud_side === 'under' ? 'U' : 'O'} {row.ud_line}
                          </span>
                          {row.ud_is_alt && <span style={{ fontSize: '8px', letterSpacing: '1px', color: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '2px', padding: '1px 3px' }}>ALT</span>}
                        </div>
                      ) : <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '11px' }}>—</span>}
                    </td>

                    {/* MY ODDS */}
                    <td
                      style={{ padding: '6px 10px', textAlign: 'right' }}
                      onClick={e => e.stopPropagation()}
                    >
                      <input
                        type="text"
                        placeholder="-110"
                        value={rawInput}
                        onChange={e => setCustomLines(prev => ({ ...prev, [id]: e.target.value }))}
                        style={{
                          width:        '72px',
                          background:   'rgba(255,255,255,0.06)',
                          border:       `1px solid ${rawInput.trim() ? 'rgba(255,200,0,0.5)' : 'rgba(255,255,255,0.1)'}`,
                          borderRadius: '4px',
                          color:        rawInput.trim() ? 'var(--ev-gold)' : 'rgba(255,255,255,0.3)',
                          fontFamily:   'var(--font-mono)',
                          fontSize:     '11px',
                          padding:      '4px 7px',
                          textAlign:    'right',
                          outline:      'none',
                        }}
                      />
                    </td>

                    {/* MY EDGE */}
                    <td style={{ padding: 'var(--ks-pad-y) var(--ks-pad-x)', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '13px', color: myEdgeDisp.color, fontWeight: myEdgeDisp.weight }}>
                      {myEdgeDisp.text}
                    </td>

                    {/* TRACK */}
                    <td
                      style={{ padding: '6px 14px', textAlign: 'right' }}
                      onClick={e => e.stopPropagation()}
                    >
                      <KsTrackButton
                        gameDate={toISODate(row.game_date)}
                        gamePk={row.game_pk}
                        pitcher={row.pitcher}
                        pitcherName={row.pitcher_name}
                        team={row.team}
                        oppTeam={row.opp_team}
                        predK={row.pred_k}
                        line={trackLine}
                        side={trackSide}
                        odds={trackOdds}
                        edge={trackEdge}
                        isTracked={trackedKeys.has(trackedKey(row.game_date, row.pitcher))}
                        authHeaders={authHeaders}
                      />
                    </td>

                  </tr>

                  {/* Expanded detail row */}
                  {isExpanded && (
                    <tr style={{ borderBottom: '1px solid var(--ev-border)' }}>
                      <td colSpan={cols.length} style={{ padding: 0 }}>
                        <DetailCard
                          row={row}
                          myLine={{
                            raw:      rawInput,
                            odds:     customOdds,
                            edge:     myOddsEdge,
                            onChange: val => setCustomLines(prev => ({ ...prev, [id]: val })),
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile card list (<768px) */}
      <div className="ks-table-mobile">
        {tableItems.map(item => {
          if (item.type === 'header') {
            return (
              <div key={`m-hdr-${item.gamePk}`} className="ks-mobile-game-header">
                {item.label}
                <span style={{ color: 'var(--ev-dim)', marginLeft: '10px', letterSpacing: '1px', fontSize: '9px' }}>
                  {item.count} PITCHER{item.count !== 1 ? 'S' : ''}
                </span>
              </div>
            );
          }

          const row = item.row;
          const id = rowId(row);
          const isExpanded = expandedRow === id;
          const result = hasResults ? resultForRow(row) : null;
          const bookEdgeDisp = edgeDisplay(row.edge_book, row.has_line);
          const modelProbDisp = modelProbDisplay(row.model_prob_book_line, row.has_line);
          const { trackLine, trackOdds, trackEdge, trackSide } = getTrackInfo(row);
          const playLine = row.has_line ? row.book_line : row.pp_line;
          const playSide = row.has_line ? row.book_side : row.pp_side;

          const mRawInput   = customLines[id] ?? '';
          const mCustomOdds = parseOddsInput(mRawInput);
          const mModelProb  = row.model_prob_book_line ?? row.model_prob_pp_line ?? row.model_prob_ud_line;
          const mOddsEdge   = mCustomOdds != null && mModelProb != null
            ? mModelProb - impliedProb(mCustomOdds)
            : null;
          const mTrackOdds = mCustomOdds ?? trackOdds;
          const mTrackEdge = mOddsEdge ?? trackEdge;

          return (
            <div
              key={`m-${id}`}
              className="ks-mobile-card"
              onClick={() => toggleExpand(id)}
              style={{ borderRadius: '4px', padding: '16px', background: '#111416', border: '1px solid rgba(255,255,255,0.06)', marginBottom: '6px' }}
            >
              {/* Header: name + team/opp + time */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--font-syne)', fontWeight: 800, fontSize: '16px', color: 'rgba(255,255,255,0.95)' }}>
                      {row.pitcher_name}
                      {row.has_line && row.book_line != null && row.adj_k != null && Math.abs(row.adj_k - row.book_line) > 1.0 && (
                        <span
                          title="Adjusted projection differs from market line by more than 1K strikeout. Check lineup, weather, or recent news before betting."
                          style={{ marginLeft: '5px', color: 'var(--ev-red)', fontSize: '14px', fontWeight: 700, cursor: 'help' }}
                        >!</span>
                      )}
                    </span>
                    {result && (
                      <span style={{
                        fontSize: '10px', fontWeight: 700, color: result.color,
                        border: `1px solid ${result.color}`, borderRadius: '2px',
                        padding: '1px 5px', letterSpacing: '1px',
                      }}>
                        {result.text}
                      </span>
                    )}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>
                    {row.team} {row.is_home ? 'vs' : '@'} {row.opp_team}
                  </div>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap' }}>
                  {fmtGameTime(row.game_time)}
                </span>
              </div>

              {/* Play + metrics */}
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '16px', flexWrap: 'wrap', marginBottom: '10px' }}>
                {/* THE PLAY — line only */}
                <div>
                  <div style={{ ...LABEL, marginBottom: '3px' }}>THE PLAY</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '18px', fontWeight: 700, color: 'rgba(255,255,255,0.95)', lineHeight: 1 }}>
                    {playLine != null ? `${playSide === 'under' ? 'U' : 'O'} ${playLine}` : '—'}
                  </div>
                </div>
                {/* Book logo + odds — separate item */}
                {(row.has_line && row.best_book || trackOdds != null) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', paddingBottom: '2px' }}>
                    {row.has_line && row.best_book && <BookLogo bookKey={row.best_book.toLowerCase()} size={18} />}
                    {trackOdds != null && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', color: 'var(--ev-blue)', fontWeight: 500 }}>
                        {fmtOdds(trackOdds)}
                      </span>
                    )}
                  </div>
                )}
                <div>
                  <div style={{ ...LABEL, marginBottom: '3px' }}>EDGE</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '15px', color: bookEdgeDisp.color, fontWeight: bookEdgeDisp.weight }}>
                    {bookEdgeDisp.text}
                  </div>
                </div>
                <div>
                  <div style={{ ...LABEL, marginBottom: '3px' }}>MODEL PROB</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '15px', color: modelProbDisp.color, fontWeight: modelProbDisp.weight }}>
                    {modelProbDisp.text}
                  </div>
                </div>
                <div onClick={e => e.stopPropagation()} style={{ marginLeft: 'auto' }}>
                  <KsTrackButton
                    gameDate={toISODate(row.game_date)}
                    gamePk={row.game_pk}
                    pitcher={row.pitcher}
                    pitcherName={row.pitcher_name}
                    team={row.team}
                    oppTeam={row.opp_team}
                    predK={row.pred_k}
                    line={trackLine}
                    side={trackSide}
                    odds={mTrackOdds}
                    edge={mTrackEdge}
                    isTracked={trackedKeys.has(trackedKey(row.game_date, row.pitcher))}
                    authHeaders={authHeaders}
                  />
                </div>
              </div>

              {/* MY ODDS + MY EDGE */}
              <div
                onClick={e => e.stopPropagation()}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}
              >
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--ev-gold)' }}>MY ODDS</span>
                <input
                  type="text"
                  placeholder="-110"
                  value={mRawInput}
                  onChange={e => setCustomLines(prev => ({ ...prev, [id]: e.target.value }))}
                  style={{
                    width:        '72px',
                    background:   'rgba(255,255,255,0.06)',
                    border:       `1px solid ${mRawInput.trim() ? 'rgba(255,200,0,0.5)' : 'rgba(255,255,255,0.1)'}`,
                    borderRadius: '4px',
                    color:        mRawInput.trim() ? 'var(--ev-gold)' : 'rgba(255,255,255,0.3)',
                    fontFamily:   'var(--font-mono)',
                    fontSize:     '11px',
                    padding:      '4px 7px',
                    textAlign:    'right',
                    outline:      'none',
                  }}
                />
                {mOddsEdge != null && (() => {
                  const d = edgeDisplay(mOddsEdge, true);
                  return (
                    <>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--ev-gold)' }}>MY EDGE</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: d.color, fontWeight: d.weight }}>{d.text}</span>
                    </>
                  );
                })()}
              </div>

              {/* DFS chips */}
              {(row.pp_line != null || row.ud_line != null) && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {row.pp_line != null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.04)', borderRadius: '4px', padding: '3px 8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <BookLogo bookKey="prizepicks" size={12} />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}>
                        {row.pp_side === 'under' ? 'U' : 'O'} {row.pp_line}
                      </span>
                    </div>
                  )}
                  {row.ud_line != null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.04)', borderRadius: '4px', padding: '3px 8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <BookLogo bookKey="underdog" size={12} />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}>
                        {row.ud_side === 'under' ? 'U' : 'O'} {row.ud_line}
                      </span>
                      {row.ud_is_alt && <span style={{ fontSize: '8px', letterSpacing: '1px', color: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '2px', padding: '1px 3px' }}>ALT</span>}
                    </div>
                  )}
                </div>
              )}

              {isExpanded && (
                <div style={{ margin: '12px -12px -12px' }}>
                  <DetailCard
                    row={row}
                    showMarket
                    myLine={{
                      raw:      mRawInput,
                      odds:     mCustomOdds,
                      edge:     mOddsEdge,
                      onChange: val => setCustomLines(prev => ({ ...prev, [id]: val })),
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      </div>
      )}
    </div>
  );
}
