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
    generationConfig: { temperature: 0.7, maxOutputTokens: 1200, thinkingConfig: { thinkingBudget: 0 } },
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
      name1: z.string().min(1),
      name2: z.string().min(1),
    });
    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    const { name1, name2 } = parsed.data;

    const prompt =
      `"${name1}" vs "${name2}" Generate me an instagram caption, no emojis, in exactly 2 paragraphs, ` +
      `on this topic. Before writing, you must use Google Search to look up current, accurate, up-to-date ` +
      `information about the topic, and base the caption on what you find — do not rely on prior knowledge alone. ` +
      `Hard requirement: the entire caption must be at most 2000 characters (including spaces) — do not exceed ` +
      `this under any circumstances. Aim for roughly 1800 characters. Output only the caption text, nothing else.`;

    const raw = await geminiWithSearch(prompt);
    const text = raw.trim().replace(/^["']|["']$/g, '').replace(/\s*—\s*/g, ', ').replace(/, ,/g, ',');
    if (!text) return NextResponse.json({ error: 'empty response' }, { status: 502 });
    return NextResponse.json({ caption: text });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
