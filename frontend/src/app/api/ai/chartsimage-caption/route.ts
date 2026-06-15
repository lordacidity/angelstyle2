import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const API_BASE = 'https://generativelanguage.googleapis.com';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function geminiWithSearch(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY ?? '';
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.8, maxOutputTokens: 400, thinkingConfig: { thinkingBudget: 0 } },
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

export async function POST(req: NextRequest) {
  try {
    const Schema = z.object({
      name:       z.string().min(1),
      pct:        z.number(),
      isPositive: z.boolean(),
    });
    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    const { name, pct, isPositive } = parsed.data;

    const direction = isPositive ? 'Up' : 'Down';
    const pctStr    = `${pct.toFixed(1)}%`;

    const prompt =
      `Use Google Search right now to find the single most recent news story or event about "${name}" ` +
      `published in the last 24 hours. Search for their name and look at today's results only. ` +
      `It could be a game result, trade rumour, interview, performance, release, award, ` +
      `controversy — anything newsworthy from today, positive or negative. ` +
      `Then write a single punchy social media caption in the style of Kalshi prediction markets. ` +
      `The caption must state that ${name}'s Sentiment is ${direction} by ${pctStr} and mention the news event ` +
      `as context — the news does not need to explain or justify the direction, it is just what is happening right now. ` +
      `Format example: "${name}'s Sentiment is ${direction} by ${pctStr} as [specific event happening]." ` +
      `Rules: one or two sentences only, no emojis, no hashtags, no quotes around the output, factual and specific. ` +
      `Output only the caption text, nothing else.`;

    const raw  = await geminiWithSearch(prompt);
    const text = raw.trim().replace(/^["']|["']$/g, '');
    if (!text) return NextResponse.json({ error: 'empty response' }, { status: 502 });
    return NextResponse.json({ caption: text });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
