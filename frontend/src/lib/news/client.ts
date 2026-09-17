'use client';

// The News section's browser side — what Studio > News does between its
// buttons, kept here so Vids 2 can do the same from its form without a second
// copy of any of it:
//
//   searchNews       Google News for a name, approved outlets only
//   readNewsStory    the story off the outlet itself, checked (api/news/article)
//   findPagePhotos   free photos for the page — the person, the side column
//   pagePhotosFrom   those photos cut to the page's boxes, a hero that loads
//   drawNewsPage     the page drawn to a PNG with them
//
// The server routes under api/news do the reading and the finding; this is the
// calling of them and what is done with the answers. No React in here, and
// nothing about what a caller shows or saves.

import { framePersonPhoto, frameThumb, photoCredit } from './frame-photo';
import type { NewsRange } from './google-news';
import { rasterizeNewsPage, type NewsImage } from './rasterize';
import { PHOTO_SLOTS, renderNewsPage, type PagePhotos } from './templates';
import type {
  NewsArticle, NewsHit, NewsPhoto, OutletId, PersonPhoto, PersonPhotosResponse, RailItem, ThumbPhotosResponse,
} from './types';

export type { NewsRange };

/** How far back a search looks — the same four api/news/search takes. */
export const NEWS_RANGES: readonly NewsRange[] = ['1d', '7d', '30d', 'any'];
export const NEWS_RANGE_LABEL: Record<NewsRange, string> = {
  '1d': 'Past day', '7d': 'Past week', '30d': 'Past month', any: 'Any time',
};
export const isNewsRange = (v: unknown): v is NewsRange =>
  typeof v === 'string' && (NEWS_RANGES as readonly string[]).includes(v);

export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
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

/** Stories about `q` from the approved outlets, article pages only, as Google
 *  News lists them. Throws with the route's reason. */
export async function searchNews(q: string, outlets: readonly OutletId[], range: NewsRange, signal?: AbortSignal): Promise<NewsHit[]> {
  const params = new URLSearchParams({ q, outlets: outlets.join(','), range });
  const res = await fetch(`/api/news/search?${params}`, { signal });
  const j = await res.json().catch(() => ({})) as { hits?: NewsHit[]; error?: string };
  if (!res.ok) throw new Error(j.error ?? `Search failed (${res.status})`);
  return j.hits ?? [];
}

/** The story read from the outlet itself — headline, byline, date and every
 *  paragraph, word for word — with the outlet's other headlines for the side
 *  column. Refused, with the reason, when any of that is missing. */
export const readNewsStory = (link: string, signal?: AbortSignal) =>
  postJson<{ article: NewsArticle; rail: RailItem[] }>('/api/news/article', { link }, signal);

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
