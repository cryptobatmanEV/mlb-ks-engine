'use client';

import { useState } from 'react';
import { type TrackedBet, fmtDate, fmtOdds, fmtEdge, betPL } from './shared';

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
  ...LABEL,
  padding:    '8px 14px',
  fontWeight:  500,
  background: 'rgba(255,255,255,0.02)',
};

function resultColor(result: string | null) {
  if (result == null) return 'var(--ev-dim)';
  if (result === 'win')  return 'var(--ev-green)';
  if (result === 'push') return 'var(--ev-gold)';
  return 'var(--ev-red)';
}

function DeleteButton({ id, deleting, onDelete }: { id: number; deleting: boolean; onDelete: (id: number) => void }) {
  return (
    <button
      onClick={() => onDelete(id)}
      disabled={deleting}
      title="Delete bet"
      style={{
        background: 'transparent', border: 'none',
        color: 'var(--ev-red)', opacity: deleting ? 0.4 : 0.6,
        cursor: deleting ? 'default' : 'pointer',
        fontFamily: 'var(--font-mono)', fontSize: '13px',
        lineHeight: 1, padding: '2px 4px',
      }}
    >
      {deleting ? '...' : '✕'}
    </button>
  );
}

export default function BetsTable({ bets: initialBets }: { bets: TrackedBet[] }) {
  const [bets, setBets] = useState(initialBets);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function handleDelete(id: number) {
    if (!window.confirm('Remove this play from your tracker?')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/track?id=${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const text = await res.text();
        console.error('[BetsTable] delete failed:', res.status, text);
        alert('Something went wrong — please try again.');
        setDeletingId(null);
        return;
      }
      setBets(prev => prev.filter(b => b.id !== id));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[BetsTable] delete error:', msg);
      alert('Something went wrong — please try again.');
      setDeletingId(null);
    }
  }

  if (bets.length === 0) return null;

  return (
    <div>
      {/* ── Desktop table ── */}
      <div className="bets-table-desktop scroll-table-wrap">
        <div style={{ ...CARD, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--ev-border)' }}>
                {(['DATE', 'PITCHER', 'TEAM', 'LINE', 'ODDS', 'STAKE', 'EDGE', 'P/L', 'RESULT'] as const).map(
                  (h, i) => (
                    <th key={h} style={{ ...TH, textAlign: i >= 3 ? 'right' : 'left' }}>{h}</th>
                  )
                )}
                <th style={{ ...TH, textAlign: 'right', width: '32px' }}></th>
              </tr>
            </thead>
            <tbody>
              {bets.map(bet => {
                const { text: edgeText, color: edgeCol } = fmtEdge(bet.edge);
                const pl       = betPL(bet);
                const result   = bet.result == null ? 'PENDING' : bet.result.toUpperCase();
                const resColor = resultColor(bet.result);
                const plColor  = pl === '—' ? 'var(--ev-dim)' : pl.startsWith('+') ? 'var(--ev-green)' : pl.startsWith('-') ? 'var(--ev-red)' : 'var(--ev-muted)';
                const deleting = deletingId === bet.id;
                return (
                  <tr key={bet.id} className="bet-row" style={{ borderBottom: '1px solid var(--ev-border)' }}>
                    <td style={{ padding: '9px 14px', color: 'var(--ev-dim)' }}>{fmtDate(bet.game_date)}</td>
                    <td style={{ padding: '9px 14px', color: 'var(--ev-text)' }}>{bet.pitcher_name}</td>
                    <td style={{ padding: '9px 14px', color: 'var(--ev-muted)' }}>{bet.team}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--ev-text)' }}>
                      {bet.side === 'under' ? 'U' : 'O'} {bet.line}
                    </td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--ev-blue)' }}>{fmtOdds(bet.odds)}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--ev-muted)' }}>{bet.stake_units}u</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', color: edgeCol }}>{edgeText}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', color: plColor }}>{pl}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', color: resColor, fontWeight: bet.result != null ? 600 : 400 }}>{result}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right' }}>
                      <DeleteButton id={bet.id} deleting={deleting} onDelete={handleDelete} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="scroll-hint">&larr; SCROLL FOR MORE &rarr;</div>
      </div>

      {/* ── Mobile cards ── */}
      <div className="bets-table-mobile">
        {bets.map(bet => {
          const { text: edgeText, color: edgeCol } = fmtEdge(bet.edge);
          const pl       = betPL(bet);
          const result   = bet.result == null ? 'PENDING' : bet.result.toUpperCase();
          const resColor = resultColor(bet.result);
          const plColor  = pl === '—' ? 'var(--ev-dim)' : pl.startsWith('+') ? 'var(--ev-green)' : pl.startsWith('-') ? 'var(--ev-red)' : 'var(--ev-muted)';
          const deleting = deletingId === bet.id;
          return (
            <div key={bet.id} style={{ ...CARD, padding: '12px 14px' }}>
              {/* Row 1: Pitcher + Result */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 700, color: 'var(--ev-text)' }}>
                  {bet.pitcher_name}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, color: resColor }}>
                    {result}
                  </span>
                  <DeleteButton id={bet.id} deleting={deleting} onDelete={handleDelete} />
                </div>
              </div>

              {/* Row 2: Date · Team · Line */}
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--ev-dim)', marginBottom: '8px' }}>
                {fmtDate(bet.game_date)}
                <span style={{ margin: '0 6px', color: 'rgba(255,255,255,0.15)' }}>·</span>
                {bet.team}
                <span style={{ margin: '0 6px', color: 'rgba(255,255,255,0.15)' }}>·</span>
                <span style={{ color: 'var(--ev-text)' }}>
                  {bet.side === 'under' ? 'U' : 'O'} {bet.line}
                </span>
                <span style={{ margin: '0 6px', color: 'rgba(255,255,255,0.15)' }}>·</span>
                <span style={{ color: 'var(--ev-blue)' }}>{fmtOdds(bet.odds)}</span>
              </div>

              {/* Row 3: Stake · Edge · P/L */}
              <div style={{ display: 'flex', gap: '16px' }}>
                <div>
                  <div style={{ ...LABEL, fontSize: '9px', marginBottom: '2px' }}>STAKE</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--ev-muted)' }}>
                    {bet.stake_units}u
                  </div>
                </div>
                <div>
                  <div style={{ ...LABEL, fontSize: '9px', marginBottom: '2px' }}>EDGE</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: edgeCol }}>
                    {edgeText}
                  </div>
                </div>
                <div>
                  <div style={{ ...LABEL, fontSize: '9px', marginBottom: '2px' }}>P/L</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 700, color: plColor }}>
                    {pl}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
