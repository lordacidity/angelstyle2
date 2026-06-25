import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// Auto-generates a full multi-page carousel about a CURRENTLY TRENDING public
// figure — NOT limited to Pauv markets. Gemini web-searches for a hot story,
// then writes a "main" page (big headline + small subheadline) plus 3-4
// "supporting_1" pages (equal-size text boxes) building the sentiment angle,
// and always ends on a pauv.com CTA page. Mirrors the example posts the user
// shared (Vozinha, Elon).

const API_BASE = 'https://generativelanguage.googleapis.com';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function geminiWithSearch(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY ?? '';
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    // Google Search grounding so copy is based on the real, current story.
    // NOTE: response_mime_type:'application/json' is not reliably supported
    // alongside the search tool, so we ask for JSON in the prompt and parse it.
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.8, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } },
  });

  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${API_BASE}/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (res.ok) {
      const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = (data.candidates?.[0]?.content?.parts ?? []).map(p => p.text).filter(Boolean).join(' ').trim();
      if (text) return text;
      throw new Error('Gemini returned empty response');
    }
    const txt = await res.text();
    const transient = res.status === 503 || res.status === 429 || res.status === 500;
    if (transient && attempt < 4) { await sleep(Math.min(8000, 800 * 2 ** (attempt - 1))); continue; }
    throw new Error(`Gemini ${res.status}: ${txt.slice(0, 300)}`);
  }
  throw new Error('Gemini: max retries exceeded');
}

// Pull the first balanced JSON object out of a model response that may be
// wrapped in ```json fences or have grounding prose around it.
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf('{');
  if (start === -1) throw new Error('No JSON object in response');
  let depth = 0;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return body.slice(start, i + 1); }
  }
  throw new Error('Unterminated JSON object in response');
}

const PageSchema = z.object({
  slideType: z.enum(['main', 'supporting_1']),
  headline: z.string().default(''),
  subheadline: z.string().default(''),
});
const ResultSchema = z.object({
  figure: z.string().default(''),
  articleUrl: z.string().optional(),
  pages: z.array(PageSchema).min(2),
});

function buildPrompt(nameHint: string, category: string): string {
  const who = nameHint
    ? `Write about this specific public figure: "${nameHint}". Use Google Search to find their MOST RECENT trending moment/story (last few days).`
    : `Use Google Search to find ONE public figure who is genuinely trending RIGHT NOW (breaking moment in the last few days)${category ? ` — prefer the world of ${category}` : ''}. Pick someone with a sharp, surprising, "wait, what?" story (e.g. an athlete who went viral, an artist with a sudden moment), not generic celebrity news.`;

  const cat = category || 'people';

  return [
    `You are a social-media copywriter for Pauv (pauv.com) — a platform where people TRADE on the sentiment/attention around public figures in real time, before traditional markets catch up.`,
    ``,
    who,
    ``,
    `Then write an Instagram CAROUSEL about that story, matching this exact structure:`,
    ``,
    `PAGE 1 — "main": a punchy hook.`,
    `  - headline: the surprising hook, ALL CAPS feel, <= 70 chars (e.g. "MEET THE GOALKEEPER WHO GOT 13M FOLLOWERS IN 3 DAYS").`,
    `  - subheadline: a short factual one-liner that supports the hook, <= 60 chars (e.g. "He was named Man of the Match"). This renders small.`,
    ``,
    `PAGES 2..N — "supporting_1" (give 3 of these): each is a beat that builds the story toward "this is sentiment / attention moving in real time".`,
    `  - headline: a standalone statement that reads as its own text box, <= 90 chars.`,
    `  - subheadline: OPTIONAL second statement of roughly EQUAL weight/length (it renders the same size as the headline). Use it when there is a natural contrast/follow-up (e.g. headline "AT KICKOFF HE HAD 46,000" / subheadline "3 DAYS LATER, THAT NUMBER IS NOW 13 MILLION"). Leave it as "" when the headline stands alone.`,
    `  - Across these pages: state the concrete facts, then the turn ("this wasn't just growth — it was sentiment moving in real time").`,
    ``,
    `FINAL PAGE — "supporting_1" CTA (always include, as the LAST page):`,
    `  - headline: a Pauv call-to-action tying the story to trading sentiment on pauv.com (e.g. "PAUV LETS YOU TRADE WHAT JUST HAPPENED HERE" or "[NAME] ON PAUV.COM"). Reference that Pauv lets you trade on ${cat}.`,
    `  - subheadline: "".`,
    ``,
    `Rules:`,
    `- Base every fact on what Google Search returns. Do not invent numbers.`,
    `- Punchy, declarative, present tense. No emojis, no hashtags, no quotation marks around lines.`,
    `- 5 pages total (1 main + 3 supporting beats + 1 CTA).`,
    ``,
    `Output ONLY strict minified JSON, no prose, no code fences:`,
    `{"figure":"<name>","articleUrl":"<source url or omit>","pages":[{"slideType":"main","headline":"...","subheadline":"..."},{"slideType":"supporting_1","headline":"...","subheadline":"..."}]}`,
  ].join('\n');
}

export async function POST(req: NextRequest) {
  try {
    const Schema = z.object({
      nameHint: z.string().trim().max(120).optional().default(''),
      category: z.enum(['artists', 'athletes', 'gamers']).optional(),
    });
    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    const { nameHint, category } = parsed.data;

    const raw = await geminiWithSearch(buildPrompt(nameHint, category ?? ''));

    let result: z.infer<typeof ResultSchema>;
    try {
      result = ResultSchema.parse(JSON.parse(extractJson(raw)));
    } catch (e) {
      return NextResponse.json({ error: `Could not parse AI output: ${String(e)}`, raw: raw.slice(0, 500) }, { status: 502 });
    }

    // Sanitize: ensure first page is main, drop stray quotes, cap lengths gently.
    const clean = (s: string) => s.replace(/^["']|["']$/g, '').trim();
    const pages = result.pages
      .map(p => ({ slideType: p.slideType, headline: clean(p.headline), subheadline: clean(p.subheadline) }))
      .filter(p => p.headline);
    if (pages.length < 2) return NextResponse.json({ error: 'AI returned too few pages', raw: raw.slice(0, 500) }, { status: 502 });
    if (pages[0].slideType !== 'main') pages[0].slideType = 'main';
    for (let i = 1; i < pages.length; i++) pages[i].slideType = 'supporting_1';

    return NextResponse.json({ figure: clean(result.figure), articleUrl: result.articleUrl, pages });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
