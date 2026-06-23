'use client';

import { useEffect, useState } from 'react';
import Nav from '../components/Nav';
import type { AiPickRow } from '../api/ai-picks-data/route';

// ── Formatters ─────────────────────────────────────────────────────────────

function fmtOdds(o: number | null): string {
  if (o == null) return '—';
  return o > 0 ? `+${o}` : String(o);
}

function fmtPct(v: number | null): string {
  if (v == null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function fmtNum(v: number | null, decimals = 2): string {
  if (v == null) return '—';
  return v.toFixed(decimals);
}

function fmtPL(pl: number): string {
  return `${pl >= 0 ? '+' : ''}${pl.toFixed(2)}u`;
}

function calcPL(result: string | null, odds: number | null): number {
  if (result === 'push') return 0;
  const o = odds ?? -110;
  if (result === 'win') return o > 0 ? o / 100 : 100 / Math.abs(o);
  if (result === 'loss') return -1;
  return 0;
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

const TH: React.CSSProperties = {
  fontFamily:    'var(--font-mono)',
  fontSize:      '10px',
  letterSpacing: '1.5px',
  textTransform: 'uppercase',
  fontWeight:    500,
  padding:       '8px 12px',
  color:         'var(--ev-dim)',
  background:    'rgba(255,255,255,0.02)',
  whiteSpace:    'nowrap',
};

const TD: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize:   '11px',
  padding:    '8px 12px',
  whiteSpace: 'nowrap',
};

// ── Result badge ───────────────────────────────────────────────────────────

function ResultBadge({ result }: { result: string | null }) {
  if (!result) return <span style={{ color: 'var(--ev-dim)' }}>—</span>;
  const colors: Record<string, string> = {
    win:  'var(--ev-green)',
    loss: 'var(--ev-red)',
    push: 'var(--ev-gold)',
  };
  return (
    <span style={{ color: colors[result] ?? 'var(--ev-text)', fontWeight: 600 }}>
      {result.toUpperCase()}
    </span>
  );
}

// ── Summary stat card ──────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ ...CARD, padding: '16px 20px', minWidth: '100px' }}>
      <div style={{ ...LABEL, marginBottom: '6px' }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize:   '20px',
        fontWeight: 700,
        color:      color ?? 'var(--ev-text)',
      }}>
        {value}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function PicksPage() {
  const [rows, setRows] = useState<AiPickRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/ai-picks-data')
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setRows(data.rows ?? []);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  // Summary stats — only settled picks
  const settled = rows.filter(r => r.result != null);
  const wins    = settled.filter(r => r.result === 'win').length;
  const losses  = settled.filter(r => r.result === 'loss').length;
  const pushes  = settled.filter(r => r.result === 'push').length;
  const decided = wins + losses;
  const winRate = decided > 0 ? `${(wins / decided * 100).toFixed(1)}%` : '—';
  const totalPL = settled.reduce((acc, r) => acc + calcPL(r.result, r.best_odds), 0);
  const plColor = totalPL > 0 ? 'var(--ev-green)' : totalPL < 0 ? 'var(--ev-red)' : 'var(--ev-muted)';

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
            AI PICKS
          </h1>
          <div style={{ ...LABEL, color: 'var(--ev-muted)', marginTop: '6px', letterSpacing: '1px' }}>
            LOGGED AT PIPELINE RUN TIME &middot; FIRST SNAPSHOT PER DAY
          </div>
        </header>

        <Nav active="picks" />

        {loading && (
          <div style={{ ...CARD, padding: '48px', textAlign: 'center' }}>
            <div style={{ ...LABEL, color: 'var(--ev-dim)' }}>LOADING...</div>
          </div>
        )}

        {error && (
          <div style={{ ...CARD, padding: '40px', textAlign: 'center' }}>
            <div style={{ ...LABEL, color: 'var(--ev-muted)' }}>
              Something went wrong: {error}
            </div>
          </div>
        )}

        {!loading && !error && rows.length === 0 && (
          <div style={{ ...CARD, padding: '48px', textAlign: 'center' }}>
            <div style={{ ...LABEL, color: 'var(--ev-muted)', marginBottom: '6px' }}>NO PICKS LOGGED YET</div>
            <div style={{ fontSize: '11px', color: 'var(--ev-dim)', fontFamily: 'var(--font-mono)' }}>
              AI picks are captured at each pipeline run. Check back after the next run.
            </div>
          </div>
        )}

        {!loading && !error && rows.length > 0 && (
          <>
            {/* Summary stats */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '24px' }}>
              <Stat label="Total Picks" value={String(rows.length)} />
              <Stat label="Record" value={`${wins}-${losses}-${pushes}`} />
              <Stat label="Win Rate" value={winRate} color={decided > 0 ? (wins / decided >= 0.5 ? 'var(--ev-green)' : 'var(--ev-red)') : undefined} />
              <Stat label="P/L" value={fmtPL(totalPL)} color={plColor} />
            </div>

            {/* Picks table */}
            <div style={{ ...CARD, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--ev-border)' }}>
                    {[
                      ['DATE',        'left' ],
                      ['PITCHER',     'left' ],
                      ['TEAM',        'left' ],
                      ['LINE',        'right'],
                      ['SIDE',        'right'],
                      ['ODDS',        'right'],
                      ['MODEL PROB',  'right'],
                      ['SCORE',       'right'],
                      ['PROJ Ks',     'right'],
                      ['ADJ Ks',      'right'],
                      ['ACTUAL Ks',   'right'],
                      ['RESULT',      'right'],
                    ].map(([h, align]) => (
                      <th key={h} style={{ ...TH, textAlign: align as 'left' | 'right' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const line = row.book_line ?? row.pp_line;
                    const side = row.book_side ?? row.pp_side;
                    return (
                      <tr key={row.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ ...TD, color: 'var(--ev-dim)' }}>
                          {String(row.game_date).slice(0, 10)}
                        </td>
                        <td style={{ ...TD, color: 'var(--ev-text)', fontWeight: 600 }}>
                          {row.pitcher_name ?? '—'}
                        </td>
                        <td style={{ ...TD, color: 'var(--ev-muted)' }}>
                          {row.team ?? '—'}
                        </td>
                        <td style={{ ...TD, textAlign: 'right', color: 'var(--ev-text)' }}>
                          {line != null ? line : '—'}
                        </td>
                        <td style={{ ...TD, textAlign: 'right', color: 'var(--ev-muted)', textTransform: 'uppercase' }}>
                          {side ?? '—'}
                        </td>
                        <td style={{ ...TD, textAlign: 'right', color: 'var(--ev-text)' }}>
                          {fmtOdds(row.best_odds)}
                        </td>
                        <td style={{ ...TD, textAlign: 'right', color: 'var(--ev-green)' }}>
                          {fmtPct(row.model_prob_book_line)}
                        </td>
                        <td style={{ ...TD, textAlign: 'right', color: 'var(--ev-muted)' }}>
                          {fmtNum(row.composite_score, 3)}
                        </td>
                        <td style={{ ...TD, textAlign: 'right', color: 'var(--ev-muted)' }}>
                          {fmtNum(row.pred_k)}
                        </td>
                        <td style={{ ...TD, textAlign: 'right', color: 'var(--ev-muted)' }}>
                          {fmtNum(row.adj_k)}
                        </td>
                        <td style={{ ...TD, textAlign: 'right', color: 'var(--ev-text)' }}>
                          {row.actual_k != null ? row.actual_k : '—'}
                        </td>
                        <td style={{ ...TD, textAlign: 'right' }}>
                          <ResultBadge result={row.result} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {settled.length < rows.length && (
              <div style={{ ...LABEL, textAlign: 'center', marginTop: '16px', fontSize: '9px', color: 'rgba(255,255,255,0.15)' }}>
                {rows.length - settled.length} PICK(S) PENDING RESULTS
              </div>
            )}
          </>
        )}

        {/* Footer */}
        <div style={{ ...LABEL, textAlign: 'center', marginTop: '40px', fontSize: '9px', color: 'rgba(255,255,255,0.15)' }}>
          MODEL PROB &gt; 55% &nbsp;&middot;&nbsp; SWSTR% &gt; 20% &nbsp;&middot;&nbsp;
          P/L ASSUMES 1U FLAT STAKE PER PICK AT LISTED ODDS
        </div>

      </div>
    </main>
  );
}
