export type TrackedBet = {
  id:           number;
  game_date:    string;
  game_pk:      number;
  pitcher:      number;
  pitcher_name: string;
  team:         string;
  opp_team:     string;
  pred_k:       number | null;
  line:         number;
  side:         string;
  odds:         number | null;
  edge:         number | null;
  stake_units:  number;
  actual_k:     number | null;
  result:       string | null; // 'win' | 'loss' | 'push' | null
  settled:      boolean;
  created_at:   string;
  discord_user_id:   string | null;
  discord_username:  string | null;
};

// Postgres DATE columns come back from Neon as JS Date objects, not strings.
// String(date) (e.g. "Mon Jun 09 2026 ...") is not YYYY-MM-DD, so always go
// through toISOString() before slicing out month/day.
export function toISODate(d: unknown): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

export function fmtDate(d: unknown) {
  return toISODate(d).slice(5).replace('-', '/');
}

export function fmtOdds(o: number | null) {
  if (o == null) return '—';
  return o > 0 ? `+${o}` : `${o}`;
}

export function fmtEdge(edge: number | null): { text: string; color: string } {
  if (edge == null) return { text: '—', color: 'var(--ev-dim)' };
  const text = `${edge > 0 ? '+' : ''}${(edge * 100).toFixed(1)}%`;
  const color = edge > 0 ? 'var(--ev-green)' : edge > -0.03 ? 'var(--ev-muted)' : 'var(--ev-red)';
  return { text, color };
}

export function betPL(bet: Pick<TrackedBet, 'result' | 'odds' | 'stake_units'>): string {
  if (bet.result == null) return '—';
  if (bet.result === 'push') return '0.00u';
  if (bet.result === 'loss') return `-${bet.stake_units.toFixed(1)}u`;
  if (bet.odds == null) return '—';
  const odds = bet.odds;
  const profit = odds > 0
    ? bet.stake_units * (odds / 100)
    : bet.stake_units * (100 / Math.abs(odds));
  return `+${profit.toFixed(2)}u`;
}
