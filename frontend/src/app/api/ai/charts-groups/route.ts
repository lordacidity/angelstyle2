import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { deepseekChat, parseJson } from '@/lib/deepseek';

function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

type ProfileRow = {
  id: string;
  ticker: string;
  name: string;
  photo_url: string | null;
  industry: string | null;
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const industry = searchParams.get('industry')?.trim() || null;

    const sb = getClient();
    let query = sb
      .from('profiles')
      .select('id,ticker,name,photo_url,industry')
      .is('delisted_at', null)
      .order('name');
    if (industry) query = query.eq('industry', industry);
    const { data: profiles, error } = await query;

    if (error) throw new Error(error.message);
    if (!profiles?.length) return NextResponse.json({ groups: [] });

    const rows = profiles as ProfileRow[];
    const list = rows.map(p => `${p.id}|${p.name}|${p.industry ?? 'unknown'}`).join('\n');

    const prompt = `You are given a list of public figures from a talent trading platform.
Each line: id|name|industry

Group them into head-to-head comparison pairs. Good pairs are rivals, peers in the same field, or people fans love to compare (e.g. Messi vs Ronaldo, Drake vs Kendrick, Taylor Swift vs Beyoncé).

Rules:
- Each person appears at most ONCE across all pairs
- Only pair people who are genuinely comparable — same sport, genre, or well-known rivalry
- Create as many meaningful pairs as you can from the list
- "reason" must be 4–7 words, e.g. "Football GOATs", "Pop music queens", "Hip-hop rivals"
- Use the exact id strings provided — do not invent ids

Profiles:
${list}

Return ONLY valid JSON, no explanation:
{ "groups": [ { "a_id": "...", "b_id": "...", "reason": "..." } ] }`;

    const raw = await deepseekChat(
      [{ role: 'user', content: prompt }],
      { json: true, temperature: 0.4, maxTokens: 4000 },
    );

    const parsed = parseJson<{ groups: Array<{ a_id: string; b_id: string; reason: string }> }>(raw);
    const byId = new Map(rows.map(p => [p.id, p]));

    const groups = (parsed?.groups ?? [])
      .filter(g => byId.has(g.a_id) && byId.has(g.b_id) && g.a_id !== g.b_id)
      .map(g => {
        const a = byId.get(g.a_id)!;
        const b = byId.get(g.b_id)!;
        return {
          a: { id: a.id, name: a.name, ticker: a.ticker, photo_url: a.photo_url, industry: a.industry },
          b: { id: b.id, name: b.name, ticker: b.ticker, photo_url: b.photo_url, industry: b.industry },
          reason: g.reason,
        };
      });

    return NextResponse.json({ groups });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
