// GET /api/pricer/log — the pricing log as a CSV download (pauv_priced.csv): every completed pricing, oldest
// first, straight from the store. Same columns and quoting as the standalone's file. Behind the site gate.

import { ensureStore } from '@/lib/pricer/pipeline';
import { listPriced, PRICED_COLUMNS } from '@/lib/pricer/store';
import { csvLine } from '@/lib/pricer/csv.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureStore();
    const rows = await listPriced();
    if (!rows.length) return new Response('Nothing priced yet', { status: 404, headers: { 'content-type': 'text/plain' } });
    const body = csvLine([...PRICED_COLUMNS]) + rows.map(r => csvLine(PRICED_COLUMNS.map(c => r[c]))).join('');
    return new Response(body, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="pauv_priced.csv"',
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : 'unexpected error', { status: 500, headers: { 'content-type': 'text/plain' } });
  }
}
