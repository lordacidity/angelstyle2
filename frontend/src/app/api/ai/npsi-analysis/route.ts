import { NextRequest, NextResponse } from 'next/server';
import { deepseekChat, parseJson, type ChatMessage } from '@/lib/deepseek';

export async function POST(req: NextRequest) {
  try {
    const {
      personName,
      ticker,
      headline,
      priceUsd,
      lifetimeChangePct,
      holders,
    } = await req.json() as {
      personName?: string;
      ticker?: string;
      headline?: string;
      priceUsd?: number | null;
      lifetimeChangePct?: number | null;
      holders?: number | null;
    };

    if (!personName || !headline) {
      return NextResponse.json({ error: 'personName and headline required' }, { status: 400 });
    }

    const priceContext = [
      priceUsd != null ? `current NPSI price: $${priceUsd.toFixed(2)}` : null,
      lifetimeChangePct != null ? `lifetime change: ${lifetimeChangePct >= 0 ? '+' : ''}${lifetimeChangePct.toFixed(1)}%` : null,
      holders != null ? `holders: ${holders.toLocaleString()}` : null,
    ].filter(Boolean).join(', ');

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You are a financial analyst for Pauv, a talent-backed stock market. ' +
          'Given a news story about a talent and their current NPSI (cultural stock) data, ' +
          'write 1-2 sentences explaining why this news is likely to move their NPSI positively or negatively. ' +
          'Be specific about the cultural signal. Keep it under 160 chars total. ' +
          'Return JSON: {"npsiAnalysis": "..."}. No hashtags, no emoji.',
      },
      {
        role: 'user',
        content:
          `Talent: ${personName}${ticker ? ` ($${ticker})` : ''}\n` +
          (priceContext ? `Market data: ${priceContext}\n` : '') +
          `News: "${headline}"\n\n` +
          'Write the NPSI impact analysis.',
      },
    ];

    const raw = await deepseekChat(messages, { json: true, temperature: 0.5 });
    const parsed = parseJson<{ npsiAnalysis?: string }>(raw);

    return NextResponse.json({ npsiAnalysis: parsed.npsiAnalysis ?? '' });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
