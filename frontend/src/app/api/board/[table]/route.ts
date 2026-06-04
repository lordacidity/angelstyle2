// /api/board/:table — list (GET) and add a blank row (POST).
// :table is one of markets | athletes | artists (validated against allowlist).
import { NextRequest, NextResponse } from 'next/server';
import { createRow, isBoardTable, listRows, pickBoardFields } from '@/lib/board-db';

// pg can't run on the Edge runtime; pin to Node.
export const runtime = 'nodejs';
// Never cache — the board is shared and changes constantly.
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ table: string }> },
) {
  const { table } = await params;
  if (!isBoardTable(table)) {
    return NextResponse.json({ error: 'unknown table' }, { status: 404 });
  }
  try {
    return NextResponse.json(await listRows(table));
  } catch (err) {
    console.error('[board GET]', err);
    return NextResponse.json({ error: 'failed to load board' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ table: string }> },
) {
  const { table } = await params;
  if (!isBoardTable(table)) {
    return NextResponse.json({ error: 'unknown table' }, { status: 404 });
  }
  try {
    // Optional body lets the client create an already-populated row in one shot
    // (the quick-add entry row). No body → a blank row.
    const initial = pickBoardFields(await req.json().catch(() => ({})));
    return NextResponse.json(await createRow(table, initial));
  } catch (err) {
    console.error('[board POST]', err);
    return NextResponse.json({ error: 'failed to add row' }, { status: 500 });
  }
}
