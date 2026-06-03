import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { deepseekChat, parseJson } from '@/lib/deepseek';

export async function POST(req: NextRequest) {
  try {
    const Schema = z.object({ personName: z.string().min(1), personSummary: z.string().optional(), previousQueries: z.array(z.string()).default([]) });
    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'personName required' }, { status: 400 });
    const { personName, personSummary, previousQueries } = parsed.data;

    const raw = await deepseekChat(
      [
        {
          role: 'system',
          content:
            'You generate Google Images search queries for finding good editorial photos of a public figure. ' +
            'Return JSON: { query: string }. The query should be specific enough to surface high-quality press ' +
            'photos. Avoid the queries listed in previousQueries — pick a different angle each time ' +
            '(e.g. add a year, a venue, a role, a context).',
        },
        {
          role: 'user',
          content: JSON.stringify({ personName, personSummary, previousQueries }),
        },
      ],
      { json: true, temperature: 0.7 },
    );

    const parsed = parseJson<{ query?: string }>(raw);
    if (!parsed.query) throw new Error('DeepSeek returned no query');
    return NextResponse.json({ query: parsed.query });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
