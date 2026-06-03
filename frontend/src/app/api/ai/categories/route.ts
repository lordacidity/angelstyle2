import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export async function GET() {
  try {
    const { data, error } = await sb
      .from('profiles')
      .select('info_subcategory')
      .is('delisted_at', null)
      .not('info_subcategory', 'is', null);

    if (error) throw new Error(error.message);

    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      const sub = row.info_subcategory as string | null;
      if (!sub) continue;
      counts.set(sub, (counts.get(sub) ?? 0) + 1);
    }

    const categories = Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json(categories);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
