// Who is in the news right now — the search turned around. lib/news/google-news
// takes a name and finds its stories; this takes no name, reads every fresh
// headline the approved outlets have put out, and keeps the ones that name
// somebody on Pauv. It is what Vids 2's "Choose by news" opens on: see who is
// trending, and make the video from the story.
//
//   1. Headlines  Google News, one feed per outlet per window (a feed stops at
//                 100, and a day of ESPN is more than that, so a day is read
//                 as the day and as its last six hours); IMDb from its own
//                 lists, since Google barely carries it. Anything older than
//                 the window by its own timestamp is dropped — `when:` is only
//                 roughly kept to.
//   2. Names      lib/news/roster-match over each headline: whole names only.
//                 How many of the window's headlines name each person is kept
//                 too (`buzz`): somebody in nine of them is what today is
//                 about.
//   3. The read   Gemini (the site's flash model, minimal thinking) over every
//                 match in the window, forty headlines to a call, the calls
//                 side by side. Three things a name match can't know: whether
//                 "Future" is the rapper; whether the story is politics; and
//                 its heat — how hard the headline would stop somebody
//                 scrolling, 0 to 100, with the hook in a few words. The list
//                 is sorted on that, which is why the whole window is read and
//                 not just its newest: the biggest story of the day may be ten
//                 hours old. Without Gemini the matches stand as they fell,
//                 less the one-word names that are also ordinary words,
//                 politics goes by the person and the link alone, and the
//                 order falls back to buzz, then the clock.
//   4. Links      only what will be sent is resolved to the outlet's own URL
//                 — the hottest, the hottest politics, and the newest, so the
//                 form can sort either way and hide politics and still have a
//                 full list. Anything that isn't an article page is left out,
//                 as search does. The newest are resolved while Gemini reads.

import { extractGeminiJson, geminiGenerate } from '@/lib/gemini';
import { matchesCategory, peopleInCategory, topicIsCategory } from './categories';
import { anyOf, fetchFeed, outletOf, resolveGoogleNewsLinks, siteClause, storyKey, stripSourceSuffix } from './google-news';
import { imdbNews, imdbUrl } from './imdb';
import { OUTLET_IDS, articleUrlProblem, outletById, outletForHost } from './outlets';
import { pauvPeople, type PauvPerson } from './pauv-people';
import { isOrdinaryName, rosterMatcher, type RosterFind } from './roster-match';
import type { NamedPerson, OutletId, TrendingHit, TrendingResponse, TrendWindow } from './types';

export const TREND_WINDOWS: readonly TrendWindow[] = ['1h', '6h', '24h', '7d'];
export const isTrendWindow = (v: unknown): v is TrendWindow =>
  typeof v === 'string' && (TREND_WINDOWS as readonly string[]).includes(v);

const WINDOW_MS: Record<TrendWindow, number> = { '1h': 3_600_000, '6h': 6 * 3_600_000, '24h': 24 * 3_600_000, '7d': 7 * 24 * 3_600_000 };
/** The `when:` clauses each window is read by — see the header. */
// A week is read as the week and as its last day, for the same reason a day
// is read as the day and its last six hours: a feed stops at 100.
const WINDOW_FEEDS: Record<TrendWindow, string[]> = { '1h': ['1h'], '6h': ['6h', '1h'], '24h': ['1d', '6h'], '7d': ['7d', '1d'] };

/** The most matches Gemini reads, newest first, and how many go in one call. */
const READ_MAX = 200;
const READ_CHUNK = 40;
/** What is sent: the hottest that aren't politics, the hottest that are, and
 *  the newest of either. The form shows twenty of whichever it is sorted by. */
const SEND_HOT = 30;
const SEND_POLITICS = 15;
const SEND_NEW = 25;

/** The most people a category is asked for by name in one query. Above this
 *  the topic goes as its own words instead — and a category that big is one
 *  the form never offers to widen, since filtering already fills the list. */
const NAME_WIDEN_MAX = 20;

/** A read for a category looks back a week, whatever window the form is on.
 *  The thin categories are thin in the news as well as on Pauv — seven riders,
 *  and most days none of them is in a headline an approved outlet ran — so a
 *  day's worth is usually nothing at all. A week is the difference between
 *  "cycling has no news" and Pogačar's collarbone. The rows carry their own
 *  timestamps and the form prints the age of each, so nothing here pretends a
 *  four-day-old story is from this morning. */
const TOPIC_MS = 7 * 24 * 3_600_000;
const TOPIC_FEEDS = ['7d', '1d'];

// The reader is built once per roster; pauvPeople hands back the same array
// for an hour at a time.
let reader: { for: PauvPerson[]; read: (text: string) => RosterFind<PauvPerson>[] } | null = null;
export async function rosterReader(): Promise<(text: string) => RosterFind<PauvPerson>[]> {
  const people = await pauvPeople();
  if (!reader || reader.for !== people) reader = { for: people, read: rosterMatcher(people) };
  return reader.read;
}

export const asNamed = (p: PauvPerson): NamedPerson =>
  ({ name: p.name, ticker: p.ticker, industry: p.industry, subcategory: p.subcategory });

interface Candidate {
  outlet: OutletId;
  title: string;
  publishedAt: string;
  /** Google's wrapped link, or the outlet's own for IMDb. */
  link: string;
  found: PauvPerson[];
  /** How many of the window's headlines name each of `found`, in its order,
   *  and the most of them: somebody in nine is what today is about. */
  counts: number[];
  buzz: number;
}

const politicsLink = (url: URL) => /\/politics(\/|$)/.test(url.pathname.toLowerCase());

// ── The read ─────────────────────────────────────────────────────────────────

const prompt = (rows: Candidate[]) => `Each numbered line is a news headline, then the people a plain name match found in it. They are all listed on Pauv, a market for public figures; in brackets is what each is known for and how many of today's headlines name them.

These are being ranked for short videos: the ones worth making are the ones that make somebody stop scrolling and go "wait, WHAT?". For each headline say four things.

"about": which of the listed names really are that person in this headline. Leave a name out when the words mean something or somebody else: "Future" as the time to come and not the rapper, "Dave" or "Lisa" as part of another person's name, "Offset" as a word, a namesake from another field. When the headline plainly is about them, keep them. Copy names exactly as listed.

"politics": true when the story is politics — government, elections, politicians and parties, policy, courts ruling on any of it, wars and diplomacy — and false for everything else, a politician's name or not.

"heat": 0 to 100 — how big, shocking, inflammatory or talked-about this is. Eyeballs, not importance. Score each headline on this scale and not against its neighbours:
  90-100  everybody is talking about it today: a death, an arrest, a scandal or an accusation, a shock split, engagement or baby, a blockbuster trade or signing, a record broken, a public feud blowing up, something said that has people furious.
  70-89   a real story with an edge: a lawsuit, a star hurt, a controversial remark, a big win or a collapse, a surprise announcement, a firing.
  40-69   ordinary news about them: a game recap, a release date, an interview, a quote, a contract detail.
  0-39    filler: a listicle, a passing mention, a routine preview, shopping, a photo gallery, a birthday.
Somebody named in many of today's headlines is what people are on about: lean higher. The more famous the person, the higher the same story scores.

"why": the hook, six words or fewer, lower case — "arrested outside a nightclub", "traded to the lakers", "calls out taylor swift".

Reply as JSON, one entry per headline, in order: {"items":[{"i":0,"about":["..."],"politics":false,"heat":72,"why":"..."}]}

${rows.map((c, i) => `${i}. [${outletById(c.outlet).name}] ${c.title} — ${c.found.map((p, n) => `${p.name} (${[p.industry, p.subcategory].filter(Boolean).join(', ')}; in ${c.counts[n]} ${c.counts[n] === 1 ? 'headline' : 'headlines'})`).join('; ')}`).join('\n')}`;

interface Verdict { about: Set<string>; politics: boolean; heat: number | null; why: string | null }

/** What Gemini made of one call's worth of rows, by their index in it; null
 *  when it couldn't be asked or didn't answer in a shape worth reading. */
async function readChunk(rows: Candidate[]): Promise<Map<number, Verdict> | null> {
  try {
    const raw = await geminiGenerate([{ text: prompt(rows) }], {
      temperature: 0, maxOutputTokens: 4000, timeoutMs: 20_000, thinkingLevel: 'minimal',
    });
    const j = JSON.parse(extractGeminiJson(raw)) as { items?: unknown };
    if (!Array.isArray(j.items)) return null;
    const out = new Map<number, Verdict>();
    for (const it of j.items as { i?: unknown; about?: unknown; politics?: unknown; heat?: unknown; why?: unknown }[]) {
      if (typeof it?.i !== 'number' || !rows[it.i] || !Array.isArray(it.about)) continue;
      const heat = typeof it.heat === 'number' && Number.isFinite(it.heat) ? Math.max(0, Math.min(100, Math.round(it.heat))) : null;
      const why = typeof it.why === 'string' ? it.why.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60) : '';
      out.set(it.i, {
        about: new Set(it.about.filter((n): n is string => typeof n === 'string').map(n => n.trim().toLowerCase())),
        politics: it.politics === true,
        heat,
        why: why || null,
      });
    }
    return out.size ? out : null;
  } catch (err) {
    console.warn('[news] trending: an AI read was skipped —', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Every row's verdict (undefined where there is none), and whether every call
 *  came back. The calls go out together: forty headlines is a few seconds, two
 *  hundred in one call is most of a minute. */
async function readAll(rows: Candidate[]): Promise<{ verdicts: (Verdict | undefined)[]; ai: boolean }> {
  const chunks: Candidate[][] = [];
  for (let i = 0; i < rows.length; i += READ_CHUNK) chunks.push(rows.slice(i, i + READ_CHUNK));
  const answers = await Promise.all(chunks.map(readChunk));
  return {
    verdicts: rows.map((_, i) => answers[Math.floor(i / READ_CHUNK)]?.get(i % READ_CHUNK)),
    ai: answers.every(a => a !== null),
  };
}

// ── The list ─────────────────────────────────────────────────────────────────

/** Fresh stories from the approved outlets whose headlines name somebody on
 *  Pauv, each with its heat. Sent newest first; the form sorts. Throws when
 *  Google gave nothing at all to read.
 *
 *  With a `topic` — a category somebody typed, "cycling" — the words go into
 *  the query rather than filtering what came back: the outlets put out far
 *  more in a day than a feed will hand over, so asking Google for the category
 *  reaches stories the plain read never saw. That is the whole point of it,
 *  and why the form only widens this way when filtering the list it already
 *  has comes up short (lib/news/categories). */
export async function trendingNews(window: TrendWindow, topic = ''): Promise<TrendingResponse> {
  const forTopic = !!topic.trim();
  const since = Date.now() - (forTopic ? TOPIC_MS : WINDOW_MS[window]);
  const whens = forTopic ? TOPIC_FEEDS : WINDOW_FEEDS[window];
  const google = OUTLET_IDS.filter(id => id !== 'imdb');
  const want = topic.trim();
  // How a category is put to Google. A bare topic word next to `site:` and
  // `when:` is all but ignored — "cycling site:bbc.com when:1d" comes back as
  // a day of BBC sport, cycling or not — but a NAME is honoured, and the whole
  // point of a category here is that we know exactly who is in it. So a
  // category Pauv files people under is asked for as its people, by name; only
  // a topic nobody is filed under ("crypto") goes as the words themselves.
  // Names are capped because they all go in one query, and a category too big
  // to name is one the form never needs widened — filtering the ordinary list
  // already fills a screen for it.
  const roster = want ? await pauvPeople() : [];
  const inCategory = want ? peopleInCategory(roster, want) : [];
  const byName = inCategory.length > 0 && inCategory.length <= NAME_WIDEN_MAX;
  const q = !want ? ''
    : byName ? `${anyOf(inCategory.map(p => p.name))} `
      : `${want} `;
  let failed = 0;
  const [read, imdb, ...feeds] = await Promise.all([
    rosterReader(),
    imdbNews().catch(() => []),
    ...google.flatMap(id => whens.map(when =>
      fetchFeed(`${q}${siteClause([id])} when:${when}`).catch(() => { failed++; return []; }))),
  ]);
  if (feeds.length > 0 && failed === feeds.length) throw new Error("Google News didn't answer. Try again in a minute.");

  // The press name of each person a widened read went looking for — everything
  // after the first word, so "Wout van Aert" is read by "van Aert" and
  // "Mathieu van der Poel" by "van der Poel". Kept beside the real person, so
  // what a headline matched is still filed under their full name. Short ones
  // are left out: a four-letter surname on its own is a word waiting to be
  // mistaken for somebody.
  const pressNames = byName
    ? rosterMatcher(inCategory.flatMap((p) => {
      const rest = p.name.trim().split(/\s+/).slice(1).join(' ');
      return rest.length >= 5 ? [{ name: rest, real: p }] : [];
    }))
    : null;

  const seen = new Set<string>();
  const all: Candidate[] = [];
  let scanned = 0;
  const consider = (outlet: OutletId, title: string, publishedAt: string | null, link: string) => {
    if (!publishedAt || Date.parse(publishedAt) < since) return;
    const key = `${outlet}|${title.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    scanned++;
    let found = read(title).map(f => f.person);
    // The roster match wants a whole name, and has to: "Future" and "Offset"
    // are words, and there are 1,278 people to be wrong about. A widened read
    // is the one place that can be relaxed — it went looking for at most
    // twenty named people, so their press names can be matched too, which is
    // how half of cycling is written ("Van Aert powers to victory on stage
    // 13", "Pogačar has collarbone surgery"). Only as a fallback, so a whole
    // name still wins where there is one.
    if (!found.length && pressNames) found = pressNames(title).map(f => f.person.real);
    if (found.length) all.push({ outlet, title, publishedAt, link, found, counts: [], buzz: 1 });
  };
  for (const items of feeds) {
    for (const it of items) {
      const outlet = outletOf(it);
      if (outlet && outlet !== 'imdb') consider(outlet, stripSourceSuffix(it.title, it.sourceName), it.publishedAt, it.link);
    }
  }
  for (const it of imdb) consider('imdb', it.headline, it.publishedAt, imdbUrl(it.id));

  const named = new Map<string, number>();
  for (const c of all) for (const p of c.found) named.set(p.ticker, (named.get(p.ticker) ?? 0) + 1);
  for (const c of all) {
    c.counts = c.found.map(p => named.get(p.ticker) ?? 1);
    c.buzz = Math.max(...c.counts);
  }

  const when = (c: Candidate) => Date.parse(c.publishedAt);
  all.sort((a, b) => when(b) - when(a));
  const rows = all.slice(0, READ_MAX);
  // The newest will be sent whatever they score, so their links are opened
  // while Gemini reads; what it cost is remembered, so asking again is free.
  const early = resolveGoogleNewsLinks(rows.slice(0, SEND_NEW).map(c => c.link)).catch(() => []);
  const { verdicts, ai } = await readAll(rows);
  await early;

  // Who each row is really about, and whether it looks like politics before
  // its link has been seen.
  const kept = rows.flatMap((c, i) => {
    const v = verdicts[i];
    const people = v ? c.found.filter(p => v.about.has(p.name.toLowerCase())) : c.found.filter(p => !isOrdinaryName(p.name));
    if (people.length === 0) return [];
    const politics = (v?.politics ?? false) || people.some(p => p.industry === 'Politics');
    return [{ c, people, politics, heat: v?.heat ?? null, why: v?.why ?? null }];
  });
  type Kept = (typeof kept)[number];
  // A query is a suggestion to Google, not a filter: "cycling site:espn.com"
  // comes back with plenty that isn't cycling. So when the topic is one of
  // Pauv's own categories, the rows are held to it by the people they name —
  // the same test the form filters with, so widening can only ever agree with
  // it. A topic nobody is filed under ("crypto") has nothing to be held to,
  // and the query is left to have done its job.
  const onTopic = want && (await topicIsCategory(want))
    ? kept.filter(k => matchesCategory(k.people, want))
    : kept;
  const hotter = (a: Kept, b: Kept) => (b.heat ?? -1) - (a.heat ?? -1) || b.c.buzz - a.c.buzz || when(b.c) - when(a.c);
  const byHeat = [...onTopic].sort(hotter);
  const send = new Set<Kept>([
    ...byHeat.filter(k => !k.politics).slice(0, SEND_HOT),
    ...byHeat.filter(k => k.politics).slice(0, SEND_POLITICS),
    ...onTopic.slice(0, SEND_NEW),
  ]);
  const sending = onTopic.filter(k => send.has(k));

  const urls = await resolveGoogleNewsLinks(sending.map(k => k.c.link));
  if (sending.length > 0 && urls.every(u => u === null)) {
    throw new Error("Google News wouldn't open any of the results. Try again in a minute.");
  }

  const stories = new Set<string>();
  const hits: TrendingHit[] = [];
  sending.forEach((k, i) => {
    const url = urls[i];
    if (!url) return;
    let parsed: URL;
    try { parsed = new URL(url); } catch { return; }
    if (outletForHost(parsed.hostname) !== k.c.outlet || articleUrlProblem(k.c.outlet, parsed)) return;
    const story = storyKey(k.c.outlet, parsed);
    if (stories.has(story)) return;
    stories.add(story);
    hits.push({
      outlet: k.c.outlet, title: k.c.title, publishedAt: k.c.publishedAt, link: k.c.link, url,
      named: true, namedAs: k.people[0].name,
      people: k.people.map(asNamed),
      politics: k.politics || politicsLink(parsed),
      heat: k.heat, why: k.why, buzz: k.c.buzz,
    });
  });
  return { hits, scanned, matched: onTopic.length, ai, topic: want || null };
}
