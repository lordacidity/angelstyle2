import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { deepseekChat, parseJson, type ChatMessage } from '@/lib/deepseek';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

async function fetchTalents() {
  const [{ data: profiles }, { data: markets }] = await Promise.all([
    sb.from('profiles').select('id,ticker,name,industry,info_subcategory,bio,photo_url,info_location,social_instagram,social_x,social_youtube,social_website,claim_status,delisted_at').is('delisted_at', null),
    sb.from('markets').select('profile_id,latest_price_cents,p0,holders_count,total_volume_lifetime_cents,latest_tick_at,frozen'),
  ]);
  const byProfile = new Map(((markets ?? []) as Array<{ profile_id: string; latest_price_cents: number | null; p0: number | null; holders_count: number | null; total_volume_lifetime_cents: number | null; latest_tick_at: string | null; frozen: boolean | null }>).map((m) => [m.profile_id, m]));
  return ((profiles ?? []) as Array<{ id: string; ticker: string; name: string; industry: string | null; info_subcategory: string | null; bio: string | null; photo_url: string | null; info_location: string | null; social_instagram: string | null; social_x: string | null; social_youtube: string | null; social_website: string | null; claim_status: string | null; delisted_at: string | null }>).map((p) => {
    const m = byProfile.get(p.id) ?? null;
    const cents = m?.latest_price_cents ?? null;
    const p0 = m?.p0 ?? null;
    return {
      id: p.id,
      ticker: p.ticker,
      name: p.name,
      bio: p.bio,
      photo_url: p.photo_url,
      industry: p.industry,
      subcategory: p.info_subcategory,
      location: p.info_location,
      socials: { instagram: p.social_instagram ?? undefined, x: p.social_x ?? undefined, youtube: p.social_youtube ?? undefined },
      price: {
        cents,
        usd: cents != null ? cents / 100 : null,
        p0Cents: p0,
        lifetimeChangePct: cents != null && p0 != null && p0 > 0 ? ((cents - p0) / p0) * 100 : null,
        holders: m?.holders_count ?? null,
        volumeLifetimeUsd: m?.total_volume_lifetime_cents != null ? m.total_volume_lifetime_cents / 100 : null,
        latestTickAt: m?.latest_tick_at ?? null,
        frozen: m?.frozen ?? false,
      },
      claimStatus: p.claim_status,
      delistedAt: p.delisted_at,
    };
  });
}

export async function POST(req: NextRequest) {
  try {
    const input = await req.json() as {
      title?: string;
      description?: string | null;
      tweetText?: string;
      tweetAuthorName?: string;
      tweetAuthorHandle?: string;
    };

    const talents = await fetchTalents();
    const roster = talents.map((t) => `${t.ticker} — ${t.name} — ${t.industry ?? '?'}`);

    const isTweet = !!input.tweetText;
    const sourceBlock = isTweet
      ? `Tweet by ${input.tweetAuthorName ?? '?'} (@${input.tweetAuthorHandle ?? '?'}):\n${input.tweetText}`
      : `Article:\nTitle: ${input.title ?? ''}\nDescription: ${input.description ?? ''}`;

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You analyze a piece of content and return strict JSON. Tasks: ' +
          '(1) name the single main person it\'s about; ' +
          '(2) summarize what happened in one sentence; ' +
          '(3) match to the provided Pauv roster by ticker if and only if confident it\'s the same person; ' +
          '(4) if matched, write 1-2 sentences on why this is likely to move that person\'s NPSI (positive or negative cultural signal). ' +
          'Never invent tickers.' +
          (isTweet ? ' IMPORTANT: for tweets, the main person is whoever the tweet is most centrally ABOUT, not necessarily the author.' : ''),
      },
      {
        role: 'user',
        content:
          `${sourceBlock}\n\n` +
          `Pauv roster:\n${roster.join('\n')}\n\n` +
          `Respond with: {"name": "<full real name>", "summary": "<one sentence>", "matchedTicker": "<ticker or null>", "pauvAngle": "<1-2 sentences or empty string>"}`,
      },
    ];

    const raw = await deepseekChat(messages, { json: true, temperature: 0.2 });
    const parsed = parseJson<{ name: string; summary: string; matchedTicker: string | null; pauvAngle: string }>(raw);

    const matched = parsed.matchedTicker ? talents.find((t) => t.ticker === parsed.matchedTicker) ?? null : null;

    return NextResponse.json({
      person: {
        name: parsed.name,
        summary: parsed.summary,
        isPauvTalent: !!matched,
        matchedTicker: matched?.ticker ?? null,
      },
      pauvAngle: matched ? parsed.pauvAngle : '',
      talent: matched,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
