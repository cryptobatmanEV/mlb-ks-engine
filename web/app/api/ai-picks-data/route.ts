import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export type AiPickRow = {
  id: number;
  game_date: string;
  captured_at: string;
  pitcher: number;
  pitcher_name: string | null;
  team: string | null;
  book_line: number | null;
  book_side: string | null;
  best_odds: number | null;
  best_book: string | null;
  edge_book: number | null;
  model_prob_book_line: number | null;
  composite_score: number | null;
  pred_k: number | null;
  adj_k: number | null;
  pp_line: number | null;
  pp_side: string | null;
  edge_pp: number | null;
  actual_k: number | null;
  result: string | null;
};

export async function GET() {
  try {
    const sql = getDb();

    // Use earliest captured_at per game_date so line movement on later runs
    // doesn't duplicate picks in the analytics view.
    const rows = await sql`
      WITH first_snapshot AS (
        SELECT game_date, MIN(captured_at) AS first_captured_at
        FROM ks_ai_picks_log
        GROUP BY game_date
      )
      SELECT l.*
      FROM ks_ai_picks_log l
      JOIN first_snapshot fs
        ON l.game_date  = fs.game_date
       AND l.captured_at = fs.first_captured_at
      ORDER BY l.game_date DESC, l.composite_score DESC NULLS LAST
    ` as AiPickRow[];

    return NextResponse.json({ rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Table not yet created is expected on first deploy — return empty set.
    if (message.includes('does not exist')) {
      return NextResponse.json({ rows: [] });
    }
    console.error('[ai-picks-data] DB error:', message);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }
}
