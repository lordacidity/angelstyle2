// POST /api/vids/post-captions — Vids 2's post captions, one for Instagram and
// one for TikTok, written from the person's news this week rather than from
// what a model remembers of them. (Simpler keeps its single caption at
// api/vids/post-caption.) The rules are an editor's, sent in as how Pauv posts
// should read: research first, the Pauv voice, then a long searchable
// Instagram caption and a short punchy TikTok one.
//
// Three steps, each kept as cheap as it can be:
// 1. Who and which way, read off the screen recordings (lib/vids-read-trade)
//    unless the caller already knows.
// 2. Research: one Google-grounded Gemini call for their last few weeks, what
//    is coming up, and anything live and sensitive about them — so the writer
//    knows what not to joke about. The search results are not billed as prompt
//    tokens, and the brief is kept for the day per person, so an up and a down
//    on the same person, or a second video, search once.
// 3. Writing: one Claude call writes both captions from that brief alone.
//    (It used to write a "hold the post" line too, shown under the captions
//    on the tuning page; that was taken out on 2026-09-22 — the captions are
//    the whole answer.) The rules sit in the system prompt; lowercase, dashes
//    and hashtag counts are fixed in code rather than by asking again — the
//    tiktok caption ends on exactly five, topped up here when the model writes
//    fewer — and the only redraw is for a banned word or a reply that lost its
//    layout.
//
// A finished pair is kept too, against the exact request and the day, so the
// same build asked again (a remount, a second export) costs nothing — unless
// the caller asks for a fresh one. Vids 2 does: it says who and which way
// outright, so two videos on the same person the same day are the same
// request, and each should still get a pair of its own. The research is the
// day's either way.

import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { geminiWithSearch } from '@/lib/gemini';
import { cleanText } from '@/lib/long-caption';
import { BANNED_WORDS } from '@/lib/vids-brief';
import { readTrade } from '@/lib/vids-read-trade';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The model the Start hook is written on, at low effort: the rules and the
 *  facts do the work, and the reply is two captions, not a problem to reason
 *  through. Opus cost about 2.5 times as much for the same job; Haiku was
 *  cheaper still but weaker at the jokes and the voice rules. */
const MODEL = 'claude-sonnet-5';

type Position = 'up' | 'down';

const Schema = z.object({
  /** What the screen recordings and the ending show, read for the person and
   *  the position when those aren't given. */
  brief: z.string().max(4000).default(''),
  person: z.string().max(120).default(''),
  position: z.enum(['up', 'down']).nullable().default(null),
  /** Write a new pair even when one is kept for this exact request today. */
  fresh: z.boolean().default(false),
});

interface Captions {
  ig: string;
  tiktok: string;
  person: string;
  position: Position;
}

/** The server's own date: what "this week" is measured from, and the day the
 *  kept briefs and captions are good for. */
const today = () => new Date().toLocaleDateString('en-CA');

// Kept on globalThis so a dev reload of this file doesn't throw them away.
// Cleared outright once they grow: a day's worth is a few dozen entries.
const store = globalThis as typeof globalThis & {
  __vidsResearch?: Map<string, Promise<string>>;
  __vidsPostCaptions?: Map<string, Captions>;
};
const briefs = (store.__vidsResearch ??= new Map());
const written = (store.__vidsPostCaptions ??= new Map());
const KEEP_MAX = 200;

// ── Research ─────────────────────────────────────────────────────────────────

const researchPrompt = (person: string, day: string) => `Today is ${day}. Search for the latest news on ${person} from the last three weeks, and for what they have coming up.

Reply in plain text under these four labels, at most 180 words in all, nothing before or after:
WHO: one line on who they are right now (team, label, show or current project).
NEWS: 3 to 6 bullets, newest first. Each is one dated fact with its real numbers (score, record, chart position, dollar figure). Put "(one source)" after a fact only one result supports. Where sources disagree, give the more authoritative one and add "(sources differ)".
NEXT: their next scheduled event with its date (game, release, tour date, award show, deadline), or "none found".
SENSITIVE: anything live that would make trading on them right now look like profiting off misfortune or betting on an outcome: a criminal case or trial, a lawsuit, a health issue, a death or loss, stepping back from public life. "none" if nothing.

Only what the search results say. If you find nothing recent, write that under NEWS instead of filling it from memory.`;

/** This week's brief on `person`, searched once a day. A failed search is
 *  forgotten, so the next ask tries again. */
function researchFor(person: string): Promise<string> {
  const day = today();
  const key = `${person.toLowerCase()}|${day}`;
  const kept = briefs.get(key);
  if (kept) return kept;
  const p = geminiWithSearch(researchPrompt(person, day), {
    temperature: 0.2,
    // The budget is inside maxOutputTokens: about 1,000 to search again and
    // cross-check, the rest for a 180-word brief.
    thinkingBudget: 1024,
    maxOutputTokens: 2048,
    timeoutMs: 60_000,
  }).then((t) => t.trim());
  p.catch(() => briefs.delete(key));
  if (briefs.size >= KEEP_MAX) briefs.clear();
  briefs.set(key, p);
  return p;
}

// ── Writing ──────────────────────────────────────────────────────────────────

// Never changes, and nothing dated or per-request goes in it, so it can be
// cached. It sits near Sonnet's 1,024-token caching floor and may fall under
// it; below the floor the marker simply does nothing and costs nothing.
const SYSTEM = `You write the two captions posted under a short vertical video. In the video someone looks a person up, then trades UP or DOWN on them on pauv. pauv is a platform where you trade a person's trajectory: up if they are rising, down if they have peaked. The captions are about that person and that trade.

You get today's date, the person, the direction, and a research brief of their recent news. The brief is your only source of facts.

FACTS
- Every number, date, score, record, result and quote comes from the brief. Nothing from memory, and nothing no one can check ("jersey sales", "never dipped", "dominates radio").
- A fact marked (one source) is written as reported ("reportedly", "reported as") or left out.
- If the news cuts against the direction, keep the direction and argue it from what is true. Down on a star between albums argues the quiet stretch, not "oversaturated". Never say anything the brief contradicts.

VOICE, both captions
- all lowercase. no em dashes, no en dashes.
- "trade" and "trading", never "bet", "betting", "gamble" or "wager". pauv is a platform, never an app. never "invest", "investment", "stock", "shares", "portfolio" or "asset".
- trade the trajectory, not the person. never call pauv a market for people or say it trades on how people feel about someone.
- no promises of profit and no telling anyone to trade ("the smart play", "don't miss this", "any position below x is a mistake"). no "link in bio".
- talk to the reader's read and conviction ("pauv is where that read finally has somewhere to live"), not to pauv's features.
- never mean: nothing on looks, family, health or private life. a down trade argues the peak, never the person.

INSTAGRAM: 1,900 to 2,200 characters of short paragraphs separated by blank lines, in this order.
1. hook, one line under 125 characters: a joke built on the real news ("down 20 to the no. 1 team... decided that was a good time to start"). on a down trade it can admit the take sounds crazy.
2. the facts: specific scores, records, dates, dollar figures, names, teams and events from the brief. each name and event doubles as a search keyword.
3. a second joke, to keep people reading.
4. what's next: the upcoming event from the brief, so the post matters this week.
5. the trader read, in the chart language crypto and memecoin traders use. up: the doubters were the dip, the new highs are the trend. down: the peak, what's already priced in, no next catalyst. about the chart, never the person.
6. fans vs traders: "fans ask x. traders ask y."
7. the close: "trade the trajectory, not the person." and a line crediting the reader for spotting it early.
8. a keyword line: 12 to 17 comma-separated phrases people search for ("<name> highlights", the event, the rival, the season). no hashtags in it.
9. the last line: 3 to 5 hashtags: the name, the team or project, the category, #pauv.

TIKTOK: 2 to 4 short sentences, then the 5 hashtags.
1. the most striking fact, as briefly as possible ("down 20 in the 4th to the no. 1 team in the country").
2. the trade in one phrase ("the dip was the world cup loss. this is the recovery").
3. "trade the trajectory on pauv."
4. the last line: exactly 5 hashtags, on one line, and nothing after them. 3 of them are the person and what is happening to them right now: their name, their team, label or project, the event or run in the brief. the other 2 are the trade: #pauv, and one of #trading, #crypto, #memecoins.

OUTPUT exactly this and nothing else:
===INSTAGRAM===
the instagram caption
===TIKTOK===
the tiktok caption`;

/** Built on first use, so a missing key is an answer from the route rather
 *  than a crash when the module loads. */
let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ timeout: 90_000, maxRetries: 2 }));

async function draft(ask: string): Promise<string> {
  const res = await anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low' },
    // No server-side fallback: Sonnet 5 has no allowed fallback models, so a
    // decline comes back as a refusal and Try again draws afresh.
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: ask }],
  });
  if (res.stop_reason === 'refusal') throw new Error('the model declined to write it');
  if (res.stop_reason === 'max_tokens') throw new Error('the model ran out of room before the captions');
  return res.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/** The two captions out of a reply, or null when the markers are missing.
 *  Anything before the first marker is dropped, so a model that still writes
 *  a line ahead of it loses nothing but that line. */
function split(raw: string): { ig: string; tiktok: string } | null {
  const [, rest] = raw.split(/===\s*instagram\s*===/i);
  if (rest === undefined) return null;
  const [ig, tiktok] = rest.split(/===\s*tiktok\s*===/i);
  if (!ig?.trim() || !tiktok?.trim()) return null;
  return { ig, tiktok };
}

/** At most `max` hashtags; any past that come off, from the end, where the
 *  model piles them. */
function capTags(s: string, max: number): string {
  let seen = 0;
  return s.replace(/(?<=^|\s)#[\p{L}\p{N}_]+/gu, (m) => (++seen > max ? '' : m));
}

/** The voice rules code can hold without asking again: lowercase, no dashes
 *  or stray markdown, a single blank line between paragraphs, the hashtag cap. */
const tidy = (s: string, maxTags: number): string =>
  capTags(cleanText(s).toLowerCase(), maxTags)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** The hashtags on the end of the TikTok caption that are always the same:
 *  the platform first, then what the trading side of tiktok searches. Drawn on
 *  in this order when the model wrote fewer than five, since the person ones
 *  can only come out of the brief while these never change. */
const TRADE_TAGS = ['#pauv', '#trading', '#crypto', '#memecoins', '#traders'];

const TAG = String.raw`(?<=^|\s)#[\p{L}\p{N}_]+`;

/** Exactly five hashtags on the TikTok caption. More than five have already
 *  come off in `tidy`; fewer are topped up from TRADE_TAGS, onto the caption's
 *  last line when the model put its hashtags there, otherwise a line of their
 *  own. */
function fiveTags(s: string): string {
  const have = s.match(new RegExp(TAG, 'gu')) ?? [];
  if (have.length >= 5) return s;
  const taken = new Set(have);
  const add = TRADE_TAGS.filter((t) => !taken.has(t)).slice(0, 5 - have.length);
  if (!add.length) return s;
  const lines = s.split('\n');
  const last = lines.length - 1;
  if (!new RegExp(TAG, 'u').test(lines[last])) return `${s}\n\n${add.join(' ')}`;
  lines[last] = `${lines[last]} ${add.join(' ')}`;
  return lines.join('\n');
}

/** Words that may not appear in any form: the investing words every Vids
 *  caption avoids, plus the gambling ones and "app". Whole words. */
const BANNED_RE = new RegExp(
  `\\b(${['bet', 'betting', 'gamble', 'gambling', 'wager', 'app', ...BANNED_WORDS.filter((w) => !w.includes(' '))].join('|')})s?\\b`,
  'i',
);

export async function POST(req: NextRequest) {
  try {
    const input = Schema.parse(await req.json());
    const day = today();
    const key = JSON.stringify([day, input.brief, input.person, input.position]);
    const kept = input.fresh ? undefined : written.get(key);
    if (kept) return NextResponse.json(kept);

    let person = input.person.trim();
    let position: Position = input.position ?? 'up';
    if (!person) {
      if (!input.brief.trim()) {
        return NextResponse.json(
          { error: 'Nothing to read the trade off — give the screen recordings a context on Edit & file first.' },
          { status: 400 },
        );
      }
      const read = await readTrade(input.brief);
      if (!read.person) {
        return NextResponse.json(
          { error: 'Couldn\'t tell who is being traded. Say who in the screen recording\'s context on Edit & file, like "trading up on ronaldo on pauv.com".' },
          { status: 422 },
        );
      }
      person = read.person;
      position = input.position ?? read.position ?? 'up';
    }

    let news: string;
    try {
      news = await researchFor(person);
    } catch (e) {
      // No brief, no captions: writing from memory is what this replaced.
      const why = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: `Couldn't look up this week's news on ${person}: ${why}` }, { status: 502 });
    }

    const ask = [
      `today: ${day}`,
      `person: ${person}`,
      `trade: ${position === 'up' ? 'UP, the case that they are rising' : 'DOWN, the case that they have peaked'}`,
      '',
      'research brief:',
      news,
    ].join('\n');

    let out = split(await draft(ask));
    const banned = out && `${out.ig}\n${out.tiktok}`.match(BANNED_RE);
    if (!out || banned) {
      const fix = banned
        ? `Your last draft used "${banned[0]}". It may not appear in any form, in either caption.`
        : 'Your last reply lost the OUTPUT layout. Follow it exactly.';
      out = split(await draft(`${ask}\n\n${fix}`)) ?? out;
    }
    if (!out) return NextResponse.json({ error: 'The reply came back without the two captions in it.' }, { status: 502 });

    const captions: Captions = {
      ig: tidy(out.ig, 5), tiktok: fiveTags(tidy(out.tiktok, 5)), person, position,
    };
    if (written.size >= KEEP_MAX) written.clear();
    written.set(key, captions);
    return NextResponse.json(captions);
  } catch (err) {
    console.error('[vids post-captions POST]', err);
    const msg = err instanceof Error ? err.message : 'unexpected error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
