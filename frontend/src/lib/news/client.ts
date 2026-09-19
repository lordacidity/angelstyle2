'use client';

// The News section's browser side — what Studio > News does between its
// buttons, kept here so Vids 2 can do the same from its form without a second
// copy of any of it:
//
//   searchNews       Google News for a name, approved outlets only
//   loadTrending     the other way round: fresh headlines that name anybody on
//                    Pauv, newest first (api/news/trending)
//   readNewsStory    the story off the outlet itself, checked (api/news/article)
//                    — a search result's link, or one pasted in by hand
//                    (pastedLinkProblem, hitFromStory)
//   findPagePhotos   free photos for the page — the person, the side column
//   pagePhotosFrom   those photos cut to the page's boxes, a hero that loads
//   drawNewsPage     the page drawn to a PNG with them
//
// The server routes under api/news do the reading and the finding; this is the
// calling of them and what is done with the answers. No React in here, and
// nothing about what a caller shows or saves.

import { withBase } from '@/lib/clipping';
import { framePersonPhoto, frameThumb, photoCredit } from './frame-photo';
import type { NewsRange } from './google-news';
import type { NameForms } from './name-forms';
import { OUTLETS, articleUrlProblem, outletForHost } from './outlets';
import { rasterizeNewsPage, type NewsImage } from './rasterize';
import { PHOTO_SLOTS, renderNewsPage, type PagePhotos } from './templates';
import type {
  NewsArticle, NewsCategory, NewsHit, NewsPhoto, OutletId, PersonPhoto, PersonPhotosResponse, RailItem,
  StoryPerson, ThumbPhotosResponse, TrendingHit, TrendingResponse, TrendSort, TrendWindow,
} from './types';

export type { NewsRange, TrendSort, TrendWindow };
// The category filter itself lives in lib/news/categories — the same code the
// server holds a widened read to, so the box and the search can't disagree.
export { matchesCategory, readCategory, normalCategory } from './categories';

/** How far back a search looks — the same four api/news/search takes. */
export const NEWS_RANGES: readonly NewsRange[] = ['1d', '7d', '30d', 'any'];
export const NEWS_RANGE_LABEL: Record<NewsRange, string> = {
  '1d': 'Past day', '7d': 'Past week', '30d': 'Past month', any: 'Any time',
};
export const isNewsRange = (v: unknown): v is NewsRange =>
  typeof v === 'string' && (NEWS_RANGES as readonly string[]).includes(v);

export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(withBase(url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error ?? `${url} answered ${res.status}`);
  return j as T;
}

/** "40m ago", "3h ago", else the date — how a result's time is shown. */
export function ago(iso: string | null): string {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** What a search found, and the short forms of the name it went by as well as
 *  the whole of it (lib/news/name-forms). */
export interface NewsSearch { hits: NewsHit[]; forms: NameForms }

/** Stories about `q` from the approved outlets, article pages only, as Google
 *  News lists them — found by the whole name and by the short forms the press
 *  uses for it ("Putin"), which count as the name in a headline too. Throws
 *  with the route's reason. */
export async function searchNews(q: string, outlets: readonly OutletId[], range: NewsRange, signal?: AbortSignal): Promise<NewsSearch> {
  const params = new URLSearchParams({ q, outlets: outlets.join(','), range });
  const res = await fetch(withBase(`/api/news/search?${params}`), { signal });
  const j = await res.json().catch(() => ({})) as { hits?: NewsHit[]; forms?: NameForms; error?: string };
  if (!res.ok) throw new Error(j.error ?? `Search failed (${res.status})`);
  return { hits: j.hits ?? [], forms: j.forms ?? { search: [], headline: [], ai: false } };
}

/** What a search went by, to say under it: the name, then its short forms —
 *  "Vladimir Putin, Putin". Empty when there were none beyond the name. */
export const searchedForms = (q: string, forms: NameForms): string =>
  (forms.search.length || forms.headline.length ? [q.trim(), ...forms.search, ...forms.headline].join(', ') : '');

/** The story read from the outlet itself — headline, byline, date and every
 *  paragraph, word for word — with the outlet's other headlines for the side
 *  column, and whoever on Pauv it names (the headline's first, then by how
 *  often). Refused, with the reason, when any of the story is missing. The
 *  link is a search result's or one pasted in by hand. */
export const readNewsStory = (link: string, signal?: AbortSignal) =>
  postJson<{ article: NewsArticle; rail: RailItem[]; people?: StoryPerson[] }>('/api/news/article', { link }, signal);

// ── A link pasted in by hand ─────────────────────────────────────────────────

/** Why a pasted link can't be read, or null when it looks like an article
 *  page on an approved outlet — the check the route makes, made before asking
 *  so the reason is there as soon as the link is. */
export function pastedLinkProblem(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return 'That is not a link.'; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'That is not a link.';
  const outlet = outletForHost(url.hostname);
  if (!outlet) return `${url.hostname.replace(/^www\./, '')} is not an approved outlet — ${OUTLETS.map(o => o.name).join(', ')}.`;
  return articleUrlProblem(outlet, url);
}

/** A story read off a pasted link, as the search result it never was — what
 *  everything downstream of a pick takes. `person` is whoever it is being used
 *  for; the headline names them when the route found them in it. */
export function hitFromStory(article: NewsArticle, people: readonly StoryPerson[], person: string): NewsHit {
  const p = people.find(x => x.name.trim().toLowerCase() === person.trim().toLowerCase());
  const named = !!p?.inHeadline;
  return {
    outlet: article.outlet, title: article.headline, publishedAt: article.publishedAt,
    link: article.url, url: article.url, named, ...(named && p ? { namedAs: p.name } : {}),
  };
}

// ── Trending ─────────────────────────────────────────────────────────────────

/** How far back the trending list looks — the four api/news/trending takes. */
export const TREND_WINDOWS: readonly TrendWindow[] = ['1h', '6h', '24h', '7d'];
export const TREND_WINDOW_LABEL: Record<TrendWindow, string> = { '1h': 'Past hour', '6h': 'Past 6 hours', '24h': 'Past 24 hours', '7d': 'Past week' };
export const isTrendWindow = (v: unknown): v is TrendWindow =>
  typeof v === 'string' && (TREND_WINDOWS as readonly string[]).includes(v);

/** Fresh stories whose headlines name somebody on Pauv, each with its heat
 *  (lib/news/trending). Throws with the route's reason.
 *
 *  `topic` asks Google for a category — "cycling" — instead of reading
 *  everything the outlets put out. The form only sends one when filtering the
 *  list it already has left too little to choose from: see matchesCategory in
 *  lib/news/categories, which is what does the filtering and costs nothing. */
export async function loadTrending(window: TrendWindow, topic = '', signal?: AbortSignal): Promise<TrendingResponse> {
  const q = topic.trim() ? `&topic=${encodeURIComponent(topic.trim())}` : '';
  const res = await fetch(withBase(`/api/news/trending?window=${window}${q}`), { signal, cache: 'no-store' });
  const j = await res.json().catch(() => ({})) as Partial<TrendingResponse> & { error?: string };
  if (!res.ok) throw new Error(j.error ?? `Trending failed (${res.status})`);
  return {
    hits: j.hits ?? [], scanned: j.scanned ?? 0, matched: j.matched ?? 0,
    ai: j.ai ?? false, topic: j.topic ?? null,
  };
}

/** The categories the box suggests, biggest first (api/news/categories). An
 *  empty list is not an error: the box still takes anything typed into it. */
export async function loadNewsCategories(signal?: AbortSignal): Promise<NewsCategory[]> {
  try {
    const res = await fetch(withBase('/api/news/categories'), { signal, cache: 'no-store' });
    const j = await res.json().catch(() => ({})) as { categories?: NewsCategory[] };
    return res.ok ? (j.categories ?? []) : [];
  } catch {
    return [];
  }
}

/** The two orders the trending list comes in. Biggest: the AI's heat — how
 *  hard the headline would stop somebody scrolling — then how many headlines
 *  are about them, then the clock, which is also what is left of it when the
 *  AI read nothing. Newest: the clock. */
export const TREND_SORTS: readonly TrendSort[] = ['hot', 'new'];
export const TREND_SORT_LABEL: Record<TrendSort, string> = { hot: '🔥 Biggest', new: '🕒 Newest' };
export const isTrendSort = (v: unknown): v is TrendSort => v === 'hot' || v === 'new';

export function sortTrending(hits: readonly TrendingHit[], sort: TrendSort): TrendingHit[] {
  const at = (h: TrendingHit) => (h.publishedAt ? Date.parse(h.publishedAt) : 0);
  return [...hits].sort(sort === 'new'
    ? (a, b) => at(b) - at(a)
    : (a, b) => (b.heat ?? -1) - (a.heat ?? -1) || b.buzz - a.buzz || at(b) - at(a));
}

/** When a story went out, to the minute: "11:42 AM", or "Yesterday 9:10 PM" —
 *  shown beside `ago` on the trending list, where the order is the point. */
export function clock(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(new Date()) - day(d)) / 86_400_000);
  return days === 0 ? time : days === 1 ? `Yesterday ${time}` : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`;
}

// Photos of a name are the same whichever story is picked; ask once per page.
// An answer with nothing in it, or one the AI didn't check, is asked again
// next time rather than kept.
const peopleCache = new Map<string, Promise<PersonPhotosResponse>>();
export function personPhotosFor(name: string): Promise<PersonPhotosResponse> {
  const key = name.trim().toLowerCase();
  let p = peopleCache.get(key);
  if (!p) {
    p = postJson<PersonPhotosResponse>('/api/news/photos/person', { name });
    peopleCache.set(key, p);
    p.then(r => { if (!r.ai || r.photos.length === 0) peopleCache.delete(key); }, () => peopleCache.delete(key));
  }
  return p;
}

export interface FoundPhotos {
  /** Free photos of the person searched, best first. */
  people: PersonPhoto[];
  /** Side-column thumbnails in headline order — null where nothing suitable
   *  turned up or the file wouldn't load — and the framed images cut from them. */
  thumbs: (NewsPhoto | null)[];
  thumbSrcs: (string | null)[];
  /** Anything the reader should know about what was and wasn't found. */
  notes: string[];
}

const cancelled = () => new DOMException('Cancelled', 'AbortError');

/** Free photos for a page: the person's and the side column's, found at the
 *  same time. Nothing here fails for want of a photo — the page keeps its
 *  placeholder and a note says why. */
export async function findPagePhotos(article: NewsArticle, rail: RailItem[], name: string, signal?: AbortSignal): Promise<FoundPhotos> {
  const slots = PHOTO_SLOTS[article.outlet];
  const headlines = rail.slice(0, slots.thumbs.length).map(r => r.title);
  const notes: string[] = [];
  const [people, thumbs] = await Promise.all([
    name.trim()
      ? personPhotosFor(name).then(r => { if (r.note) notes.push(r.note); return r.photos; },
        err => { notes.push(`Couldn't find a photo: ${errorText(err)}`); return [] as PersonPhoto[]; })
      : Promise.resolve([] as PersonPhoto[]),
    headlines.length
      ? postJson<ThumbPhotosResponse>('/api/news/photos/thumbs', { outlet: article.outlet, headlines, name }, signal)
        .then(r => { if (!r.ai) notes.push("The AI couldn't check the thumbnails, so a stranger's face could be in one; look before using the page."); return r.photos; },
          err => { notes.push(`Couldn't find thumbnails: ${errorText(err)}`); return [] as (NewsPhoto | null)[]; })
      : Promise.resolve([] as (NewsPhoto | null)[]),
  ]);
  if (signal?.aborted) throw cancelled();
  const thumbSrcs = await Promise.all(slots.thumbs.map((size, i) => (thumbs[i] ? frameThumb(thumbs[i]!, size).catch(() => null) : null)));
  if (signal?.aborted) throw cancelled();
  return { people, thumbs: thumbs.map((t, i) => (thumbSrcs[i] ? t : null)), thumbSrcs, notes };
}

/** What a page is drawn from: the story, and the photos found for it. */
export interface PageSource {
  article: NewsArticle;
  rail: RailItem[];
  people: PersonPhoto[];
  thumbSrcs: (string | null)[];
}

/** The page's photos with people[from] (or the next one that loads) as the
 *  main one: which of them it is (-1 for none), and the photos as the page
 *  takes them, each cut to its box. */
export async function pagePhotosFrom(src: PageSource, from: number): Promise<{ photoIndex: number; photos: PagePhotos }> {
  const slots = PHOTO_SLOTS[src.article.outlet];
  let hero: PagePhotos['hero'] = null;
  let photoIndex = -1;
  for (let k = 0; k < src.people.length && !hero; k++) {
    const i = (from + k) % src.people.length;
    try {
      hero = { src: await framePersonPhoto(src.people[i], slots.hero), credit: photoCredit(src.people[i]) };
      photoIndex = i;
    } catch { /* that file wouldn't load; try the next */ }
  }
  return { photoIndex, photos: { hero, thumbs: src.thumbSrcs } };
}

export interface DrawnPage { png: NewsImage; photoIndex: number; photos: PagePhotos }

/** The page drawn to a PNG with those photos — what is shown in a box to
 *  scroll. Which photo it used, and the photos it was drawn with, come back
 *  with it so the recording can be made from the same page. */
export async function drawNewsPage(src: PageSource, from: number): Promise<DrawnPage> {
  const { photoIndex, photos } = await pagePhotosFrom(src, from);
  const png = await rasterizeNewsPage(renderNewsPage(src.article, src.rail, photos));
  return { png, photoIndex, photos };
}
