'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  gameDate:    string;
  gamePk:      number;
  pitcher:     number;
  pitcherName: string;
  team:        string;
  oppTeam:     string;
  predK:       number;
  line:        number;
  side:        string;
  odds:        number;
  edge:        number | null;
};

type Phase = 'idle' | 'open' | 'submitting' | 'done' | 'error';

const BTN: React.CSSProperties = {
  fontFamily:    'var(--font-mono)',
  fontSize:      '10px',
  letterSpacing: '2px',
  textTransform: 'uppercase',
  borderRadius:  '2px',
  padding:       '4px 9px',
  cursor:        'pointer',
  whiteSpace:    'nowrap',
};

export default function KsTrackButton({
  gameDate, gamePk, pitcher, pitcherName, team, oppTeam, predK, line, side, odds, edge,
}: Props) {
  const router = useRouter();
  const [phase,      setPhase]      = useState<Phase>('idle');
  const [stake,      setStake]      = useState('1');
  const [savedStake, setSavedStake] = useState('1');
  const [errorMsg,   setErrorMsg]   = useState('');

  async function submit() {
    const units = parseFloat(stake);
    if (!units || units <= 0) return;
    setSavedStake(stake);
    setPhase('submitting');

    const url  = '/api/track';
    const body = JSON.stringify({
      game_date:    gameDate,
      game_pk:      gamePk,
      pitcher,
      pitcher_name: pitcherName,
      team,
      opp_team:     oppTeam,
      pred_k:       predK,
      line,
      side,
      odds,
      edge,
      stake_units:  units,
    });

    try {
      const res  = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const text = await res.text();

      if (!res.ok) {
        setErrorMsg(`${res.status}: ${text}`);
        setPhase('error');
        setTimeout(() => { setPhase('idle'); setErrorMsg(''); }, 8000);
        return;
      }
      setPhase('done');
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setPhase('error');
      setTimeout(() => { setPhase('idle'); setErrorMsg(''); }, 8000);
    }
  }

  // IDLE: single green TRACK button
  if (phase === 'idle') {
    return (
      <button
        onClick={() => setPhase('open')}
        style={{
          ...BTN,
          color:      'var(--ev-green)',
          background: 'transparent',
          border:     '1px solid rgba(0, 220, 110, 0.25)',
        }}
      >
        TRACK
      </button>
    );
  }

  // OPEN: compact stake input + OK button
  if (phase === 'open') {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
        <input
          type="number"
          min="0.1"
          step="0.5"
          value={stake}
          onChange={e => setStake(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter')  submit();
            if (e.key === 'Escape') setPhase('idle');
          }}
          autoFocus
          style={{
            width:        '52px',
            background:   'rgba(255,255,255,0.06)',
            border:       '1px solid rgba(255,255,255,0.15)',
            borderRadius: '2px',
            color:        'var(--ev-text)',
            fontFamily:   'var(--font-mono)',
            fontSize:     '12px',
            fontWeight:   500,
            padding:      '3px 6px',
            textAlign:    'right',
            outline:      'none',
          }}
        />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--ev-dim)' }}>u</span>
        <button
          onClick={submit}
          style={{
            ...BTN,
            padding:    '4px 8px',
            color:      'var(--ev-green)',
            background: 'rgba(0, 220, 110, 0.08)',
            border:     '1px solid rgba(0, 220, 110, 0.4)',
          }}
        >
          OK
        </button>
      </div>
    );
  }

  // SUBMITTING
  if (phase === 'submitting') {
    return (
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--ev-dim)', letterSpacing: '2px' }}>
        ...
      </span>
    );
  }

  // DONE
  if (phase === 'done') {
    return (
      <span
        style={{
          fontFamily:    'var(--font-mono)',
          fontSize:      '10px',
          letterSpacing: '1px',
          color:         'var(--ev-green)',
          fontWeight:    600,
          textTransform: 'uppercase',
        }}
      >
        {savedStake}u TRACKED
      </span>
    );
  }

  // ERROR
  return (
    <span
      title={errorMsg}
      style={{
        fontFamily:    'var(--font-mono)',
        fontSize:      '10px',
        color:         'var(--ev-red)',
        letterSpacing: '1px',
        maxWidth:      '260px',
        overflow:      'hidden',
        textOverflow:  'ellipsis',
        whiteSpace:    'nowrap',
        display:       'inline-block',
        verticalAlign: 'bottom',
      }}
    >
      ERROR: {errorMsg || 'unknown'}
    </span>
  );
}
