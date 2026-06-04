// /api/board/:table/:id — edit a cell (PATCH) or delete a row (DELETE).
import { NextRequest, NextResponse } from 'next/server';
import { deleteRow, isBoardTable, pickBoardFields, updateRow } from '@/lib/board-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ table: string; id: string }> },
) {
  const { table, id } = await params;
  if (!isBoardTable(table)) {
    return NextResponse.json({ error: 'unknown table' }, { status: 404 });
  }
  try {
    const patch = pickBoardFields(await req.json().catch(() => ({})));
    const row = await updateRow(table, id, patch);
    if (!row) return NextResponse.json({ error: 'row not found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    console.error('[board PATCH]', err);
    return NextResponse.json({ error: 'failed to save' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ table: string; id: string }> },
) {
  const { table, id } = await params;
  if (!isBoardTable(table)) {
    return NextResponse.json({ error: 'unknown table' }, { status: 404 });
  }
  try {
    const ok = await deleteRow(table, id);
    if (!ok) return NextResponse.json({ error: 'row not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[board DELETE]', err);
    return NextResponse.json({ error: 'failed to delete' }, { status: 500 });
  }
}
