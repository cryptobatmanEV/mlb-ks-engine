'use client';

import { useState, useMemo, Fragment } from 'react';
import KsTrackButton from './KsTrackButton';
import { probOver } from '@/lib/poisson';

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
};

type SortKey =
  | 'pitcher_name' | 'team' | 'opp_team' | 'pred_k' | 'adj_k'
  | 'book_line' | 'edge_book' | 'pp_line' | 'edge_pp'
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

const PITCH_MIX_STATS: { key: keyof Row; label: string; fmt: (v: number | null) => string }[] = [
  { key: 'p_fastball_velo_10', label: 'FB VELO',     fmt: v => v == null ? '—' : `${v.toFixed(1)} MPH` },
  { key: 'p_fastball_pct_10',  label: 'FASTBALL%',   fmt: fmtPct1 },
  { key: 'p_slider_pct_10',    label: 'SLIDER%',     fmt: fmtPct1 },
  { key: 'p_curveball_pct_10', label: 'CURVEBALL%',  fmt: fmtPct1 },
  { key: 'p_changeup_pct_10',  label: 'CHANGEUP%',   fmt: fmtPct1 },
  { key: 'p_other_pct_10',     label: 'OTHER%',      fmt: fmtPct1 },
  { key: 'p_avg_pitches_10',   label: 'AVG PITCHES', fmt: v => fmtNum(v, 1) },
  { key: 'p_avg_ip_10',        label: 'AVG IP',      fmt: v => fmtNum(v, 1) },
];

const OPPONENT_STATS: { key: StatKey | 'n_prior_team_games'; label: string; fmt: (v: number | null) => string; color?: boolean }[] = [
  { key: 'opp_k_pct_15',     label: 'OPP K%',     fmt: fmtPct1, color: true },
  { key: 'opp_ops_15',       label: 'OPP OPS',    fmt: v => fmtNum(v, 3), color: true },
  { key: 'opp_chase_pct_15', label: 'OPP CHASE%', fmt: fmtPct1, color: true },
  { key: 'n_prior_team_games', label: 'GAMES',    fmt: fmtInt },
];

const CONTEXT_STATS: { key: keyof Row; label: string; fmt: (v: number | null) => string }[] = [
  { key: 'rest_days',      label: 'REST DAYS',    fmt: fmtInt },
  { key: 'prev_pitches',   label: 'PREV PITCHES', fmt: fmtInt },
  { key: 'n_prior_starts', label: 'PRIOR STARTS', fmt: fmtInt },
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

function DetailCard({ row }: { row: Row }) {
  const SECTION_LABEL: React.CSSProperties = {
    fontFamily:    'var(--font-mono)',
    fontSize:      '9px',
    letterSpacing: '2.5px',
    textTransform: 'uppercase',
    color:         'var(--ev-dim)',
    marginBottom:  '10px',
  };
  const STAT_LABEL: React.CSSProperties = {
    fontFamily:    'var(--font-mono)',
    fontSize:      '9px',
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
    color:         'var(--ev-dim)',
    marginBottom:  '4px',
  };
  const STAT_VAL: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize:   '13px',
    fontWeight: 500,
  };
  const DIVIDER = (
    <div style={{
      width: '1px', background: 'var(--ev-border)',
      alignSelf: 'stretch', margin: '0 4px',
    }} />
  );

  return (
    <div style={{
      padding:    '14px 16px 16px 16px',
      background: 'rgba(255,255,255,0.015)',
      borderTop:  '1px solid var(--ev-border)',
    }}>
      <div style={{ display: 'flex', gap: '40px', flexWrap: 'wrap' }}>

        {/* Pitcher form L10 */}
        <div>
          <div style={SECTION_LABEL}>PITCHER FORM L10</div>
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            {PITCHER_FORM_STATS.map(({ key, label, fmt }) => {
              const val = row[key] as number | null;
              return (
                <div key={key} style={{ minWidth: '60px' }}>
                  <div style={STAT_LABEL}>{label}</div>
                  <div style={{ ...STAT_VAL, color: statColor(key, val) }}>
                    {fmt(val)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {DIVIDER}

        {/* Pitch mix L10 */}
        <div>
          <div style={SECTION_LABEL}>PITCH MIX L10</div>
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            {PITCH_MIX_STATS.map(({ key, label, fmt }) => {
              const val = row[key] as number | null;
              return (
                <div key={key} style={{ minWidth: '60px' }}>
                  <div style={STAT_LABEL}>{label}</div>
                  <div style={{ ...STAT_VAL, color: 'var(--ev-text)' }}>
                    {fmt(val)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {DIVIDER}

        {/* Opponent L15 */}
        <div>
          <div style={SECTION_LABEL}>OPPONENT L15</div>
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            {OPPONENT_STATS.map(({ key, label, fmt, color }) => {
              const val = row[key as keyof Row] as number | null;
              return (
                <div key={key} style={{ minWidth: '60px' }}>
                  <div style={STAT_LABEL}>{label}</div>
                  <div style={{ ...STAT_VAL, color: color ? statColor(key as StatKey, val) : 'var(--ev-text)' }}>
                    {fmt(val)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {DIVIDER}

        {/* Context */}
        <div>
          <div style={SECTION_LABEL}>CONTEXT</div>
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            {CONTEXT_STATS.map(({ key, label, fmt }) => {
              const val = row[key] as number | null;
              return (
                <div key={key} style={{ minWidth: '60px' }}>
                  <div style={STAT_LABEL}>{label}</div>
                  <div style={{ ...STAT_VAL, color: 'var(--ev-text)' }}>
                    {fmt(val)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {DIVIDER}

        {/* Park & weather */}
        <div>
          <div style={SECTION_LABEL}>PARK &amp; WEATHER</div>
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            <div style={{ minWidth: '60px' }}>
              <div style={STAT_LABEL}>PARK K FACTOR</div>
              <div style={{ ...STAT_VAL, color: statColor('park_k_factor', row.park_k_factor) }}>
                {fmtInt(row.park_k_factor)}
              </div>
            </div>
            <div style={{ minWidth: '60px' }}>
              <div style={STAT_LABEL}>TEMP</div>
              <div style={{ ...STAT_VAL, color: 'var(--ev-text)' }}>
                {row.temp_f == null || isNaN(row.temp_f) ? '—' : `${Math.round(row.temp_f)}°F`}
              </div>
            </div>
            <div style={{ minWidth: '60px' }}>
              <div style={STAT_LABEL}>WIND</div>
              <div style={{ ...STAT_VAL, color: 'var(--ev-text)' }}>
                {row.is_dome ? 'DOME' : row.wind_speed == null ? '—' : `${Math.round(row.wind_speed)} MPH`}
              </div>
            </div>
            <div style={{ minWidth: '60px' }}>
              <div style={STAT_LABEL}>WIND FAVOR</div>
              <div style={{ ...STAT_VAL, color: 'var(--ev-text)' }}>
                {row.is_dome ? '—' : fmtNum(row.wind_favor, 1)}
              </div>
            </div>
          </div>
        </div>

        {DIVIDER}

        {/* Game info */}
        <div>
          <div style={SECTION_LABEL}>GAME INFO</div>
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            <div style={{ minWidth: '60px' }}>
              <div style={STAT_LABEL}>VENUE</div>
              <div style={{ ...STAT_VAL, color: 'var(--ev-text)' }}>
                {row.venue ?? '—'}
              </div>
            </div>
            <div style={{ minWidth: '60px' }}>
              <div style={STAT_LABEL}>DAY/NIGHT</div>
              <div style={{ ...STAT_VAL, color: 'var(--ev-text)', textTransform: 'uppercase' }}>
                {row.day_night ?? '—'}
              </div>
            </div>
            <div style={{ minWidth: '60px' }}>
              <div style={STAT_LABEL}>GAME TIME</div>
              <div style={{ ...STAT_VAL, color: 'var(--ev-text)' }}>
                {fmtGameTime(row.game_time)}
              </div>
            </div>
          </div>
        </div>

      </div>
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

function edgeDisplay(edge: number | null, show: boolean) {
  if (!show || edge == null) return { text: '—', color: 'var(--ev-dim)', weight: 400 };
  const sign = edge > 0 ? '+' : '';
  const text = `${sign}${(edge * 100).toFixed(1)}%`;
  if (edge > 0.05)  return { text, color: 'var(--ev-green)', weight: 600 };
  if (edge > 0)     return { text, color: 'var(--ev-green)', weight: 400 };
  if (edge > -0.03) return { text, color: 'var(--ev-muted)',  weight: 400 };
                    return { text, color: 'var(--ev-red)',    weight: 400 };
}

function parseLineInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = parseFloat(trimmed);
  if (isNaN(n) || n <= 0) return null;
  return n;
}

function getSortVal(row: Row, key: SortKey): string | number | null {
  return row[key as keyof Row] as string | number | null;
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
  padding:    '10px 12px',
  fontWeight:  500,
  background: 'rgba(255,255,255,0.02)',
  userSelect: 'none',
  whiteSpace: 'nowrap',
};

const STICKY_BG = '#0a0d0f';

// ── Column definitions ─────────────────────────────────────────────────────

type ColDef = { key: SortKey | null; label: string; align: 'left' | 'right'; sticky?: boolean };

const COLS: ColDef[] = [
  { key: 'pitcher_name',    label: 'PITCHER',   align: 'left',  sticky: true },
  { key: 'team',            label: 'TEAM',      align: 'left'  },
  { key: 'opp_team',        label: 'OPP',       align: 'left'  },
  { key: 'pred_k',          label: 'PROJ Ks',   align: 'right' },
  { key: 'adj_k',           label: 'ADJ Ks',    align: 'right' },
  { key: 'book_line',       label: 'BOOK O/U',  align: 'right' },
  { key: 'edge_book',       label: 'BOOK EDGE', align: 'right' },
  { key: 'pp_line',         label: 'PP LINE',   align: 'right' },
  { key: 'edge_pp',         label: 'PP EDGE',   align: 'right' },
  { key: null,              label: 'MY LINE',   align: 'right' },
  { key: null,              label: 'MY EDGE',   align: 'right' },
  { key: 'p_k_per9_10',     label: 'K/9 L10',   align: 'right' },
  { key: 'p_swstr_pct_10',  label: 'SWSTR%',    align: 'right' },
  { key: 'opp_k_pct_15',    label: 'OPP K%',    align: 'right' },
  { key: 'park_k_factor',   label: 'PARK',      align: 'right' },
  { key: 'game_time',       label: 'GAME TIME', align: 'right' },
  { key: null,              label: '',          align: 'right' },
];

// ── AI Picks ───────────────────────────────────────────────────────────────

const AI_PICK_LIMIT = 5;
const AI_EDGE_MIN = 0.03;

type AiPick = {
  row: Row;
  compositeScore: number;
  edgeScore: number;
  edgeSource: 'book' | 'pp';
  reason: string;
  trackLine: number;
  trackSide: string;
  trackOdds: number;
  trackEdge: number | null;
};

// Builds a one-line "why this pick" summary from whichever scoring components
// contributed most. Falls back to the raw edge if nothing else stands out.
function buildPickReason(
  row: Row,
  edgeScore: number,
  edgeSource: 'book' | 'pp',
  swstrBonus: number,
  oppKBonus: number,
  k9Bonus: number,
  agreementPenalty: number,
): string {
  const factors: { label: string; weight: number }[] = [];

  if (swstrBonus > 0.04 && row.p_swstr_pct_10 != null) {
    factors.push({ label: `elite SWSTR% (${fmtPct1(row.p_swstr_pct_10)})`, weight: swstrBonus });
  }
  if (oppKBonus > 0.02 && row.opp_k_pct_15 != null) {
    factors.push({ label: `favorable OPP K% (${fmtPct1(row.opp_k_pct_15)})`, weight: oppKBonus });
  }
  if (k9Bonus > 0.02 && row.p_k_per9_10 != null) {
    factors.push({ label: `high K/9 (${fmtNum(row.p_k_per9_10, 1)})`, weight: k9Bonus });
  }
  if (agreementPenalty > -0.075) {
    factors.push({ label: 'model/market consensus', weight: 0.075 + agreementPenalty });
  }
  if (edgeScore > 0.07) {
    const src = edgeSource === 'book' ? 'sportsbook' : 'PrizePicks';
    factors.push({ label: `strong ${src} edge (+${(edgeScore * 100).toFixed(1)}%)`, weight: edgeScore });
  }

  if (factors.length === 0) {
    const src = edgeSource === 'book' ? 'sportsbook' : 'PrizePicks';
    return `Positive ${src} edge (+${(edgeScore * 100).toFixed(1)}%)`;
  }

  factors.sort((a, b) => b.weight - a.weight);
  const top = factors.slice(0, 3).map(f => f.label);
  return top[0].charAt(0).toUpperCase() + top[0].slice(1) + (top.length > 1 ? ', ' + top.slice(1).join(', ') : '');
}

function AiPickCard({ pick, rank }: { pick: AiPick; rank: number }) {
  const { row } = pick;
  const bookEdgeDisp = edgeDisplay(row.edge_book, row.has_line);
  const ppEdgeDisp   = edgeDisplay(row.edge_pp, row.pp_line != null);
  const playSide     = pick.trackSide === 'under' ? 'U' : 'O';

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
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '20px', fontWeight: 700, color: 'var(--ev-gold)', marginTop: '4px' }}>
            {playSide} {pick.trackLine}
            <span style={{ fontSize: '11px', color: 'var(--ev-blue)', marginLeft: '10px', fontWeight: 400 }}>
              {fmtOdds(pick.trackOdds)}
              {pick.edgeSource === 'book' && row.best_book && (
                <span style={{ color: 'rgba(255,255,255,0.18)', marginLeft: '4px' }}>{row.best_book}</span>
              )}
            </span>
          </div>
        </div>

        <div>
          <div style={LABEL}>PROJ Ks → ADJ Ks</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--ev-text)', marginTop: '4px' }}>
            {row.pred_k.toFixed(2)} → {(row.adj_k ?? row.pred_k).toFixed(2)}
          </div>
        </div>

        <div>
          <div style={LABEL}>BOOK EDGE</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', marginTop: '4px', color: bookEdgeDisp.color, fontWeight: bookEdgeDisp.weight }}>
            {bookEdgeDisp.text}
          </div>
        </div>

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
      (r.edge_book != null && r.edge_book > 0) || (r.edge_pp != null && r.edge_pp > 0)
    ).length,
    [searchFiltered]
  );

  const filtered = useMemo(() => {
    if (!evOnly) return searchFiltered;
    return searchFiltered.filter(r =>
      (r.edge_book != null && r.edge_book > 0) || (r.edge_pp != null && r.edge_pp > 0)
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
  // ranked by a composite confidence score (edge + stuff + agreement + matchup).
  const aiPicks = useMemo((): AiPick[] => {
    const candidates: AiPick[] = [];

    for (const row of rows) {
      if (row.p_swstr_pct_10 == null) continue;

      const bookEdge = row.has_line ? row.edge_book : null;
      const ppEdge   = row.pp_line != null ? row.edge_pp : null;
      const qualifies =
        (bookEdge != null && bookEdge > AI_EDGE_MIN) ||
        (ppEdge != null && ppEdge > AI_EDGE_MIN);
      if (!qualifies) continue;

      let edgeSource: 'book' | 'pp';
      let edgeScore: number;
      let trackLine: number;
      let trackSide: string;
      let trackOdds: number;
      let trackEdge: number | null;

      if (bookEdge != null && row.book_line != null) {
        edgeSource = 'book';
        edgeScore  = bookEdge;
        trackLine  = row.book_line;
        trackSide  = row.book_side ?? 'over';
        trackOdds  = row.best_odds ?? -110;
        trackEdge  = bookEdge;
      } else if (ppEdge != null && row.pp_line != null) {
        edgeSource = 'pp';
        edgeScore  = ppEdge;
        trackLine  = row.pp_line;
        trackSide  = row.pp_side ?? 'over';
        trackOdds  = -110;
        trackEdge  = ppEdge;
      } else {
        continue;
      }

      const adjK = row.adj_k ?? row.pred_k;
      const swstrBonus       = (row.p_swstr_pct_10 - 0.20) * 2;
      const agreementPenalty = -Math.abs(row.pred_k - adjK) * 0.5;
      const oppKBonus        = row.opp_k_pct_15 != null ? (row.opp_k_pct_15 - 0.22) * 1.5 : 0;
      const k9Bonus          = row.p_k_per9_10  != null ? (row.p_k_per9_10  - 8.0)  * 0.02 : 0;

      const compositeScore = edgeScore + swstrBonus + agreementPenalty + oppKBonus + k9Bonus;
      const reason = buildPickReason(row, edgeScore, edgeSource, swstrBonus, oppKBonus, k9Bonus, agreementPenalty);

      candidates.push({ row, compositeScore, edgeScore, edgeSource, reason, trackLine, trackSide, trackOdds, trackEdge });
    }

    candidates.sort((a, b) => b.compositeScore - a.compositeScore);
    return candidates.slice(0, AI_PICK_LIMIT);
  }, [rows]);

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

      {/* AI Picks panel */}
      {viewMode === 'ai' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {aiPicks.length === 0 ? (
            <div style={{
              background: 'var(--ev-card)', border: '1px solid var(--ev-border)', borderRadius: '2px',
              padding: '32px', textAlign: 'center',
              fontFamily: 'var(--font-mono)', fontSize: '11px', letterSpacing: '1.5px',
              textTransform: 'uppercase', color: 'var(--ev-dim)',
            }}>
              No qualifying plays right now — check back once more lines are posted.
            </div>
          ) : (
            aiPicks.map((pick, i) => (
              <AiPickCard key={`${pick.row.game_pk}-${pick.row.pitcher}`} pick={pick} rank={i + 1} />
            ))
          )}
        </div>
      ) : (
      /* Table */
      <div style={{
        background: 'var(--ev-card)', border: '1px solid var(--ev-border)',
        borderRadius: '2px', overflowX: 'auto',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--ev-border)' }}>
              {COLS.map((col, ci) => {
                const isActive = col.key !== null && sortKey === col.key;
                const isMyCol = col.label === 'MY LINE' || col.label === 'MY EDGE';
                return (
                  <th
                    key={ci}
                    onClick={() => handleSort(col.key)}
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
                    <td colSpan={COLS.length} style={{
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

              const bookEdgeDisp = edgeDisplay(row.edge_book, row.has_line);
              const ppEdgeDisp   = edgeDisplay(row.edge_pp, row.pp_line != null);

              const rawInput   = customLines[id] ?? '';
              const customNum  = parseLineInput(rawInput);
              const myProbOver = customNum != null ? probOver(customNum, row.adj_k ?? row.pred_k) : null;
              const mySide     = myProbOver != null ? (myProbOver >= 0.5 ? 'over' : 'under') : null;
              const myProb     = myProbOver != null
                ? (mySide === 'over' ? myProbOver : 1 - myProbOver)
                : null;
              const myEdge     = myProb != null ? myProb - 0.5 : null;
              const myEdgeDisp = edgeDisplay(myEdge, customNum != null);

              // TRACK button: book line > PP line > custom MY LINE, default -110
              let trackLine: number;
              let trackOdds: number;
              let trackEdge: number | null;
              let trackSide: string;
              if (row.has_line && row.book_line != null) {
                trackLine = row.book_line;
                trackOdds = row.best_odds ?? -110;
                trackEdge = row.edge_book;
                trackSide = row.book_side ?? 'over';
              } else if (row.pp_line != null) {
                trackLine = row.pp_line;
                trackOdds = -110;
                trackEdge = row.edge_pp;
                trackSide = row.pp_side ?? 'over';
              } else if (customNum != null) {
                trackLine = customNum;
                trackOdds = -110;
                trackEdge = myEdge;
                trackSide = mySide ?? 'over';
              } else {
                trackLine = Math.floor(row.pred_k) + 0.5;
                trackOdds = -110;
                trackEdge = null;
                trackSide = 'over';
              }

              return (
                <Fragment key={id}>
                  <tr
                    className="pred-row"
                    onClick={() => toggleExpand(id)}
                    style={{
                      borderBottom: isExpanded ? 'none' : '1px solid var(--ev-border)',
                      cursor: 'pointer',
                      background: isExpanded ? 'rgba(255,255,255,0.03)' : undefined,
                    }}
                  >

                    {/* PITCHER — sticky */}
                    <td style={{
                      padding:     '9px 12px',
                      color:       'var(--ev-text)',
                      fontWeight:  500,
                      position:    'sticky',
                      left:        0,
                      zIndex:      1,
                      background:  isExpanded ? 'rgba(20,24,28,1)' : STICKY_BG,
                      borderRight: '1px solid var(--ev-border)',
                      whiteSpace:  'nowrap',
                    }}>
                      <span style={{
                        display:     'inline-block',
                        marginRight: '6px',
                        fontSize:    '9px',
                        color:       isExpanded ? 'var(--ev-green)' : 'var(--ev-dim)',
                        transition:  'transform 0.15s',
                        transform:   isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                      }}>▶</span>
                      {row.pitcher_name}
                    </td>

                    {/* TEAM */}
                    <td style={{ padding: '9px 12px', color: 'var(--ev-muted)' }}>
                      {row.team}
                    </td>

                    {/* OPP */}
                    <td style={{ padding: '9px 12px', color: 'var(--ev-dim)', fontSize: '11px' }}>
                      {row.is_home ? 'vs ' : '@ '}{row.opp_team}
                    </td>

                    {/* PROJ Ks */}
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: 'var(--ev-text)', fontWeight: 500 }}>
                      {row.pred_k.toFixed(2)}
                    </td>

                    {/* ADJ Ks */}
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: 'var(--ev-text)', fontWeight: 500 }}>
                      {row.adj_k != null ? row.adj_k.toFixed(2) : row.pred_k.toFixed(2)}
                    </td>

                    {/* BOOK O/U */}
                    <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                      {row.has_line ? (
                        <>
                          <span style={{ color: 'var(--ev-text)' }}>
                            {row.book_side === 'under' ? 'U' : 'O'} {row.book_line}
                          </span>
                          <div style={{ fontSize: '10px', color: 'var(--ev-blue)', marginTop: '2px' }}>
                            {fmtOdds(row.best_odds)}
                            {row.best_book && (
                              <span style={{ color: 'rgba(255,255,255,0.18)', marginLeft: '4px' }}>
                                {row.best_book}
                              </span>
                            )}
                          </div>
                        </>
                      ) : (
                        <span style={{ color: 'var(--ev-dim)', fontSize: '10px' }}>—</span>
                      )}
                    </td>

                    {/* BOOK EDGE */}
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: bookEdgeDisp.color, fontWeight: bookEdgeDisp.weight }}>
                      {bookEdgeDisp.text}
                    </td>

                    {/* PP LINE */}
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: 'var(--ev-text)' }}>
                      {row.pp_line != null
                        ? `${row.pp_side === 'under' ? 'U' : 'O'} ${row.pp_line}`
                        : '—'}
                    </td>

                    {/* PP EDGE */}
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: ppEdgeDisp.color, fontWeight: ppEdgeDisp.weight }}>
                      {ppEdgeDisp.text}
                    </td>

                    {/* MY LINE */}
                    <td
                      style={{ padding: '6px 10px', textAlign: 'right' }}
                      onClick={e => e.stopPropagation()}
                    >
                      <input
                        type="text"
                        placeholder="K LINE"
                        value={rawInput}
                        onChange={e => setCustomLines(prev => ({ ...prev, [id]: e.target.value }))}
                        style={{
                          width:        '64px',
                          background:   'rgba(255,255,255,0.04)',
                          border:       `1px solid ${customNum != null ? 'rgba(255,200,0,0.4)' : 'rgba(255,255,255,0.08)'}`,
                          borderRadius: '2px',
                          color:        customNum != null ? 'var(--ev-gold)' : 'rgba(255,255,255,0.25)',
                          fontFamily:   'var(--font-mono)',
                          fontSize:     '11px',
                          padding:      '3px 7px',
                          textAlign:    'right',
                          outline:      'none',
                        }}
                      />
                    </td>

                    {/* MY EDGE */}
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: myEdgeDisp.color, fontWeight: myEdgeDisp.weight }}>
                      {customNum != null && mySide && myEdgeDisp.text !== '—'
                        ? `${mySide === 'under' ? 'U' : 'O'} ${myEdgeDisp.text}`
                        : myEdgeDisp.text}
                    </td>

                    {/* K/9 L10 */}
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: 'var(--ev-dim)', fontSize: '11px' }}>
                      {fmtNum(row.p_k_per9_10, 2)}
                    </td>

                    {/* SWSTR% */}
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: 'var(--ev-dim)', fontSize: '11px' }}>
                      {fmtPct1(row.p_swstr_pct_10)}
                    </td>

                    {/* OPP K% */}
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: 'var(--ev-dim)', fontSize: '11px' }}>
                      {fmtPct1(row.opp_k_pct_15)}
                    </td>

                    {/* PARK */}
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: 'var(--ev-dim)', fontSize: '11px' }}>
                      {fmtInt(row.park_k_factor)}
                    </td>

                    {/* GAME TIME */}
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: 'var(--ev-dim)', fontSize: '11px' }}>
                      {fmtGameTime(row.game_time)}
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
                      />
                    </td>

                  </tr>

                  {/* Expanded detail row */}
                  {isExpanded && (
                    <tr style={{ borderBottom: '1px solid var(--ev-border)' }}>
                      <td colSpan={COLS.length} style={{ padding: 0 }}>
                        <DetailCard row={row} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
