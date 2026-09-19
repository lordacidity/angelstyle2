// A typed category — "cycling", "rap", "politics" — and what it means.
//
// Two jobs, and they are deliberately the same code on both sides of the wire:
//
//   1. The filter   The trending list is already in the form, and every row
//                   carries the people it names with their industry and
//                   subcategory. Typing filters it on the spot, free and
//                   instant, with no route touched (matchesCategory).
//   2. The widening The filter can only ever show what the window already
//                   brought back, and the narrow categories are thin: Pauv
//                   lists 155 rappers and 7 cyclists, so "rap" fills a screen
//                   and "cycling" is usually empty. When it is, the form can
//                   ask Google for the category itself — the same read, its
//                   headlines fetched with the words in the query rather than
//                   sifted afterwards (lib/news/trending, `topic`).
//
// The box takes anything. What Pauv files people under is only what it
// SUGGESTS (newsCategories) — a topic nobody is filed under, "crypto", "the
// olympics", still reads perfectly well as a news search, and the roster match
// at the other end is what decides whether anybody usable is in it.

import { pauvPeople, type PauvPerson } from './pauv-people';
import type { NamedPerson, NewsCategory } from './types';

/** Lower case, no punctuation, single spaces — what both sides compare on, so
 *  "Film and TV" and "film & tv" are the same thing. */
export const normalCategory = (s: string): string => s
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();

/** What people call these categories when they are not reading them off Pauv.
 *  Each entry is a word somebody would type, against the normalised label it
 *  means. Only where the words genuinely differ — "cycling" needs no entry,
 *  because it is what Pauv calls it too. */
const ALIASES: Record<string, string> = {
  soccer: 'football soccer',
  football: 'football soccer',
  futbol: 'football soccer',
  premierleague: 'football soccer',
  nfl: 'american football',
  nba: 'basketball',
  hoops: 'basketball',
  mlb: 'baseball',
  nhl: 'hockey',
  ufc: 'martial arts',
  mma: 'martial arts',
  boxing: 'boxer',
  f1: 'racing',
  formula1: 'racing',
  nascar: 'racing',
  motorsport: 'racing',
  cyclist: 'cycling',
  bike: 'cycling',
  biking: 'cycling',
  tourdefrance: 'cycling',
  hiphop: 'rap',
  rapper: 'rap',
  rappers: 'rap',
  rnb: 'r and b',
  edm: 'dj',
  country: 'country',
  movies: 'film and tv',
  film: 'film and tv',
  tv: 'film and tv',
  hollywood: 'film and tv',
  acting: 'actors',
  actor: 'actors',
  actress: 'actresses',
  director: 'directors',
  politician: 'politicians',
  politicians: 'politics',
  government: 'politics',
  royal: 'royals',
  royalty: 'royals',
  tech: 'business',
  ceo: 'executive',
  founder: 'entrepreneur',
  startup: 'entrepreneur',
  influencers: 'influencer',
  youtuber: 'influencer',
  streamer: 'influencer',
  tiktoker: 'influencer',
  comedy: 'comedians',
  comedian: 'comedians',
  standup: 'comedians',
  athletics: 'track and field',
  swimming: 'swimmer',
};

/** A typed category as the matcher reads it: normalised, then put through the
 *  aliases. "NFL" and "american football" end up the same string. */
export const readCategory = (raw: string): string => {
  const n = normalCategory(raw);
  return ALIASES[n.replace(/ /g, '')] ?? ALIASES[n] ?? n;
};

/** Whether one person is in the category. An industry matches everybody filed
 *  under it, a subcategory only its own — so "sports" keeps the cyclists and
 *  "cycling" doesn't keep every athlete. Either may be typed in part ("bask"),
 *  which is what makes the box feel like a filter while you are still typing. */
function personIn(p: Pick<NamedPerson, 'industry' | 'subcategory'>, want: string): boolean {
  if (!want) return true;
  const fields = [normalCategory(p.industry), p.subcategory ? normalCategory(p.subcategory) : ''];
  return fields.some(f => !!f && (f === want || f.startsWith(want) || f.includes(want)));
}

/** Whether a trending row belongs in the category — true when anybody it names
 *  is in it. A row naming two people is kept for either one's category, which
 *  is right: the video can be made about whichever of them. */
export const matchesCategory = (people: readonly Pick<NamedPerson, 'industry' | 'subcategory'>[], raw: string): boolean => {
  const want = readCategory(raw);
  return !want || people.some(p => personIn(p, want));
};

/** Every category the roster actually has somebody in, biggest first within
 *  its industry — what the box suggests. Industries come with their own count
 *  so "Music 265" and "Rap 155" are both offerable, and the form can say how
 *  thin a category is before it is typed. */
export async function newsCategories(): Promise<NewsCategory[]> {
  const people = await pauvPeople();
  const industries = new Map<string, number>();
  const subs = new Map<string, { under: string; count: number }>();
  for (const p of people) {
    industries.set(p.industry, (industries.get(p.industry) ?? 0) + 1);
    if (!p.subcategory) continue;
    const got = subs.get(p.subcategory);
    if (got) got.count++;
    else subs.set(p.subcategory, { under: p.industry, count: 1 });
  }
  const out: NewsCategory[] = [
    ...[...industries].map(([label, count]): NewsCategory => ({ label, kind: 'industry', under: label, count })),
    ...[...subs].map(([label, { under, count }]): NewsCategory => ({ label, kind: 'subcategory', under, count })),
  ];
  // Biggest first, so the box offers Basketball before Gymnastics; an industry
  // sits above its own subcategories at equal size.
  return out.sort((a, b) => b.count - a.count
    || (a.kind === b.kind ? 0 : a.kind === 'industry' ? -1 : 1)
    || a.label.localeCompare(b.label));
}

/** Everybody on the roster the typed category covers. The list a widened read
 *  is actually built from: Google ignores a weak topic word next to `site:`
 *  and `when:` — "cycling site:bbc.com" comes back as whatever the BBC put out
 *  — but it honours a name, so asking for the seven cyclists by name is what
 *  finds cycling (lib/news/trending). */
export function peopleInCategory<T extends Pick<NamedPerson, 'industry' | 'subcategory'>>(
  people: readonly T[], raw: string,
): T[] {
  const want = readCategory(raw);
  return want ? people.filter(p => personIn(p, want)) : [];
}

/** Whether a typed topic is one of Pauv's own categories — whether anybody at
 *  all is filed under it. "cycling" is; "crypto" isn't, and a read for it has
 *  nothing to hold its rows to (lib/news/trending). */
export async function topicIsCategory(raw: string): Promise<boolean> {
  return peopleInCategory(await pauvPeople(), raw).length > 0;
}

/** How many on the roster a typed category would cover — what the form shows
 *  when a search comes back empty, so "nothing in cycling today" can say that
 *  Pauv lists seven of them and the day simply had none. */
export const rosterDepth = (people: readonly PauvPerson[], raw: string): number => {
  const want = readCategory(raw);
  return want ? people.filter(p => personIn(p, want)).length : people.length;
};
