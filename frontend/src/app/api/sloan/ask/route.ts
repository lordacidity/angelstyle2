import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

// "Ask Claude" box on angelstyle.com/Sloan. Public (no site password), so it
// is kept deliberately small: one short answer per question, a tight budget
// per visitor, and a system prompt that keeps it on Dr. E, finance, Harding
// and Claude itself. Answers 503 cleanly when no key is configured, and the
// page says so instead of breaking.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODEL = process.env.SLOAN_ASK_MODEL || 'claude-fable-5-1';
const MAX_QUESTION = 400;
const WINDOW_MS = 10 * 60 * 1000;
const PER_WINDOW = 12;

// Per-instance, in-memory. Enough to stop a loop; not meant to be airtight.
const hits = new Map<string, number[]>();
function limited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= PER_WINDOW) return true;
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

const SYSTEM = `You are Claude Fable 5.1, answering visitors on a one-page tribute website at angelstyle.com/Sloan.
The page is for "Dr. E": Ellis Sloan, CFA, assistant professor of business (finance) at Harding University in Searcy, Arkansas.
A former student, Aiden Davenport, had you build the page to show Dr. E what you can do.

What is publicly known about Dr. E (do not invent more):
- Began his finance career in 1983. Chartered Financial Analyst (CFA) charterholder. Holds an M.B.A.
- Joined Harding's Paul R. Carter College of Business Administration in 2005, shortly after his wife Lori Sloan (assistant professor of communication). Their children Ben and Camille were both Harding students in 2021.
- Helped develop Harding's finance degree and runs the CFA Institute Research Challenge team. In 2012 he and Ken Moran coached Harding's first-ever team (Austin Augsburger, Ben Beggs, Steven Terry) to a first-place regional finish in Memphis valuing Polaris Industries, sending them to the Americas round in New York.
- Founded APEX Wealth Management, an independent registered investment adviser in Searcy, in 2017. Before that he was at Kernodle & Katon Tax and Asset Management Group.
- Teaches FIN 343 among other courses. Students rate him about 4.2 out of 5.
- Known line: "Experience is as important, if not more important, than having a Ph.D."

Rules: Be warm, sharp and brief (under 120 words). Stay on Dr. E, finance and investing concepts, Harding, Searcy, or how you (Claude) work and built this page.
If asked something you do not know about him, say you only know what is public. Do not give personalised investment advice; explain concepts instead, the way a good professor would.
Never claim he holds a doctorate; "Dr. E" is an affectionate nickname.`;

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: 'offline' }, { status: 503 });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anon';
  if (limited(ip)) return NextResponse.json({ error: 'slow down' }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const question = typeof body?.question === 'string' ? body.question.trim().slice(0, MAX_QUESTION) : '';
  if (!question) return NextResponse.json({ error: 'ask something' }, { status: 400 });

  try {
    const client = new Anthropic({ apiKey: key, timeout: 30_000, maxRetries: 1 });
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM,
      messages: [{ role: 'user', content: question }],
    });
    const text = res.content
      .map((c) => (c.type === 'text' ? c.text : ''))
      .join('')
      .trim();
    return NextResponse.json({ answer: text || 'I came up empty. Try asking another way.', model: res.model });
  } catch (err) {
    console.error('[sloan/ask]', err);
    return NextResponse.json({ error: 'failed' }, { status: 502 });
  }
}
