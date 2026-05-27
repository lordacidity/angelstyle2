// Generate a long-form social media caption for a video, in the
// conversational two-paragraph style the user posts in. Pulls signal from the
// fetched video's title/author plus the user's typed caption and context.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { deepseekChat } from '@/lib/deepseek';

export async function POST(req: NextRequest) {
  try {
    const Schema = z.object({
      url:        z.string().optional(),
      caption:    z.string().optional(),  // user's typed on-card caption
      context:    z.string().optional(),  // user's free-form context
      videoTitle: z.string().optional(),  // pulled from VideoData.title
      author:     z.string().optional(),  // pulled from VideoData.author.nickname
    });
    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    const { url, caption, context, videoTitle, author } = parsed.data;

    if (!caption?.trim() && !context?.trim() && !videoTitle?.trim()) {
      return NextResponse.json({ error: 'need at least caption, context, or fetched video title' }, { status: 400 });
    }

    const raw = await deepseekChat(
      [
        {
          role: 'system',
          content:
            'You write long-form social media captions for Pauv\'s entertainment / sports / music posts on Instagram + TikTok.\n\n' +
            'About Pauv (this is the brand, used in the closing CTA):\n' +
            'Pauv is a marketplace for trading on public sentiment — human potential as an asset class. Every athlete, artist, creator, and cultural figure has a "ticker" that moves with how people actually feel about them right now: the wins, the controversies, the viral moments, the comebacks. Buying = a real position on whether their cultural stock rises. It\'s not fantasy, not a poll, not stan voting — it\'s a real market priced by real conviction. The bridge: every post we publish is itself a live read on sentiment, which is exactly what users trade on at Pauv.\n\n' +
            'Style rules — match these EXACTLY:\n' +
            '- THREE paragraphs total. First two are the caption (~250-350 words combined). Third is a CTA (~50-80 words).\n' +
            '- Conversational, in-the-know voice. Like a fan who actually pays attention, not a brand account.\n' +
            '- Open with a vivid scene-setter or a moment-in-time hook (e.g. "Kanye really disappeared, let the noise build up…", "That pose battle with Kai Cenat, Kevin Hart, and Druski was pure chaos…").\n' +
            '- Pack in real proper nouns, dates, album/song titles, places, references — whatever specifics belong here. These work as SEO keywords.\n' +
            '- Build out context naturally — what happened, why it matters, why it hit, what made it land. No bullet points, no headers.\n' +
            '- Second paragraph should pull back and add the bigger-picture take. Why it went viral, what it represents, what the cultural moment is.\n' +
            '- THIRD paragraph = the CTA. Bridge naturally from the moment in the post → why sentiment is what actually moves cultural value → Pauv lets you trade on exactly that. Reference the specific person/category from the post (e.g. "this is the kind of moment that moves [Name]\'s ticker", "athletes like this", "artists in their comeback arc"). End with a concrete next step: "link in bio to trade on [Name]" or "check the link in bio to take a position on athletes / artists / creators on the rise." Vary the phrasing — don\'t reuse the same exact closing line every time.\n' +
            '- The CTA should feel earned, like the natural conclusion of the caption — not an ad bolted on. Lean on the framing of sentiment-as-asset and conviction-as-position. People buying a ticker = they\'re right about the moment before everyone else catches on.\n' +
            '- No hashtags. No emojis. No "follow for more."\n' +
            '- Don\'t invent facts. If something is uncertain, write around it rather than fabricate dates/numbers.\n' +
            '- Plain text. No markdown. Separate paragraphs with a single blank line.\n\n' +
            'Return ONLY the caption text (all three paragraphs) — no preamble, no quotes around it, no labels like "Paragraph 1".',
        },
        {
          role: 'user',
          content: [
            videoTitle ? `Video title from source: ${videoTitle}` : '',
            author     ? `Source creator: ${author}` : '',
            url        ? `Source URL: ${url}` : '',
            caption    ? `On-card caption (the line embedded in the video itself): ${caption}` : '',
            context    ? `Additional context from the editor: ${context}` : '',
            '',
            'Write the caption now.',
          ].filter(Boolean).join('\n'),
        },
      ],
      { temperature: 0.8 },
    );

    const text = (raw ?? '').trim().replace(/^["']|["']$/g, '');
    if (!text) return NextResponse.json({ error: 'empty response' }, { status: 502 });
    return NextResponse.json({ caption: text });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
