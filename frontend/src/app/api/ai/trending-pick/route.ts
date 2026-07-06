import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { geminiWithSearch, extractGeminiJson } from '@/lib/gemini';

// "Trending" discovery for the Carousel section — RESTRICTED to Pauv-listed
// figures. Loads the live talent roster from Supabase, then asks Gemini (with
// Google Search grounding) to pick the ONE roster member who is genuinely
// trending right now and summarize the story. Copy generation is NOT done
// here — the client feeds the summary to /api/ai/carousel-copy, the same text
// generator the "From a name" flow uses.

// Built lazily inside the handler — module-scope construction breaks the build
// when Supabase env vars are absent (see /api/ai/talents).
function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

const ResultSchema = z.object({
  figure: z.string().min(1),
  ticker: z.string().min(1),
  storySummary: z.string().min(1),
  articleUrl: z.string().optional(),
});

// Gemini prompts degrade with huge rosters — cap the list it has to scan.
const ROSTER_CAP = 500;

export async function POST(req: NextRequest) {
  try {
    const Schema = z.object({
      nameHint: z.string().trim().max(120).optional().default(''),
      category: z.enum(['artists', 'athletes', 'gamers']).optional(),
    });
    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    const { nameHint, category } = parsed.data;

    const sb = getClient();
    const { data: profiles, error: pErr } = await sb
      .from('profiles')
      .select('ticker,name,industry')
      .is('delisted_at', null)
      .order('name');
    if (pErr) throw new Error(pErr.message);

    type Row = { ticker: string; name: string; industry: string | null };
    const roster = ((profiles ?? []) as Row[]).filter(r => r.ticker && r.name).slice(0, ROSTER_CAP);
    if (roster.length === 0) return NextResponse.json({ error: 'no Pauv talents available' }, { status: 502 });

    const rosterLines = roster.map(r => `${r.name} [${r.ticker}]${r.industry ? ` — ${r.industry}` : ''}`).join('\n');
    const who = nameHint
      ? `The user asked specifically about "${nameHint}". Find the roster member matching that name and use Google Search to find their MOST RECENT trending moment/story (last few days).`
      : `Use Google Search to find which ONE roster member is genuinely trending RIGHT NOW (a breaking moment in the last few days)${category ? ` — prefer ${category}` : ''}. Pick someone with a sharp, surprising, "wait, what?" story, not generic celebrity news.`;

    const prompt = [
      `You can ONLY pick from this roster of Pauv-listed public figures (format: Name [ticker] — industry):`,
      rosterLines,
      ``,
      who,
      ``,
      `Then return:`,
      `- figure: their name exactly as written in the roster.`,
      `- ticker: their ticker exactly as written in the roster (the text in [brackets]).`,
      `- storySummary: 3-6 sentences of concrete facts about the trending story (dates, numbers, what happened), based only on what Google Search returns. No opinions.`,
      `- articleUrl: the best source URL, or omit.`,
      ``,
      `Output ONLY strict minified JSON, no prose, no code fences:`,
      `{"figure":"...","ticker":"...","storySummary":"...","articleUrl":"..."}`,
    ].join('\n');

    const raw = await geminiWithSearch(prompt, { temperature: 0.6, maxOutputTokens: 1024 });

    let result: z.infer<typeof ResultSchema>;
    try {
      result = ResultSchema.parse(JSON.parse(extractGeminiJson(raw)));
    } catch (e) {
      return NextResponse.json({ error: `Could not parse AI output: ${String(e)}`, raw: raw.slice(0, 500) }, { status: 502 });
    }

    // The pick MUST resolve to a roster member — match by ticker first, then name.
    const norm = (s: string) => s.trim().toLowerCase();
    const match =
      roster.find(r => norm(r.ticker) === norm(result.ticker)) ??
      roster.find(r => norm(r.name) === norm(result.figure));
    if (!match) {
      return NextResponse.json({ error: `AI picked "${result.figure}" [${result.ticker}], which is not on the Pauv roster`, raw: raw.slice(0, 500) }, { status: 502 });
    }

    return NextResponse.json({
      figure: match.name,
      ticker: match.ticker,
      storySummary: result.storySummary.trim(),
      articleUrl: result.articleUrl,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
