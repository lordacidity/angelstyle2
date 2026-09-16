// Helpers every outlet template uses. Templates build a page as an HTML string
// laid out for a 1440px-wide window; rasterize.ts turns it into the PNG.
//
// Every piece of article text goes through esc(). Nothing here invents
// content: a template only lays out the NewsArticle and RailItems it is given.

import type { OutletId } from '../types';

export const PAGE_WIDTH = 1440;

export interface PhotoSize { width: number; height: number }

/** Every photo box on each outlet's page, in CSS pixels: the article's main
 *  photo and the side column's thumbnails in headline order. Photos are cut to
 *  these sizes before the page is drawn (frame-photo.ts). */
export const PHOTO_SLOTS: Record<OutletId, { hero: PhotoSize; thumbs: PhotoSize[] }> = {
  espn: { hero: { width: 800, height: 450 }, thumbs: [] },
  cnn: { hero: { width: 680, height: 453 }, thumbs: [{ width: 400, height: 225 }, { width: 128, height: 72 }, { width: 128, height: 72 }, { width: 128, height: 72 }] },
  fox: { hero: { width: 1020, height: 540 }, thumbs: Array.from({ length: 4 }, () => ({ width: 352, height: 198 })) },
  nyt: { hero: { width: 705, height: 470 }, thumbs: [] },
  tmz: { hero: { width: 870, height: 490 }, thumbs: Array.from({ length: 6 }, () => ({ width: 133, height: 95 })) },
  bbc: { hero: { width: 1084, height: 609 }, thumbs: [] },
};

/** The photos a page is drawn with, already cut to their boxes (data URLs).
 *  Anything missing stays a grey placeholder. */
export interface PagePhotos {
  hero: { src: string; credit: string } | null;
  thumbs: (string | null)[];
}

export const NO_PHOTOS: PagePhotos = { hero: null, thumbs: [] };

export interface RenderedPage {
  /** CSS for the page. Selectors are scoped under `.np` when rendered. */
  css: string;
  /** Markup for the page, rooted at a single `<div class="np">`. */
  html: string;
  /** Google Fonts stylesheet the page uses. */
  fontsHref: string;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');
}

interface Parts {
  year: string; month: number; day: string; hour: string; minute: string; dayPeriod: string; tz: string; weekday: string;
}
/** A timestamp's calendar parts in an outlet's home time zone. */
export function partsIn(iso: string, timeZone: string): Parts {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit',
    hour12: true, timeZoneName: 'short', weekday: 'short',
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(iso))) p[x.type] = x.value;
  return {
    year: p.year, month: Number(p.month), day: p.day, hour: p.hour, minute: p.minute,
    dayPeriod: (p.dayPeriod ?? '').toUpperCase(), tz: p.timeZoneName ?? '', weekday: p.weekday ?? '',
  };
}

export const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** True when an update is really a later edit, not the publish time repeated. */
export function wasUpdated(publishedAt: string | null, updatedAt: string | null): boolean {
  if (!publishedAt || !updatedAt) return false;
  return Date.parse(updatedAt) - Date.parse(publishedAt) > 60_000;
}

/** "5 minutes ago", "3 hours ago", "2 days ago". */
export function agoLong(iso: string, now: Date): string {
  const mins = Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 60_000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** "12m", "6h", "3d". */
export function agoShort(iso: string, now: Date): string {
  const mins = Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

/** A grey stand-in where the article's photo will go. */
export function photoPlaceholder(width: number, height: number, extraStyle = ''): string {
  const icon = Math.round(Math.min(width, height) * 0.16);
  return `<div class="np-photo" style="width:${width}px;height:${height}px;${extraStyle}">`
    + `<svg width="${icon}" height="${icon}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>`
    + `</div>`;
}

/** The photo when there is one, else the placeholder. */
export function photoBox(src: string | null | undefined, size: PhotoSize, extraStyle = ''): string {
  if (!src) return photoPlaceholder(size.width, size.height, extraStyle);
  return `<img class="np-img" src="${esc(src)}" alt="" width="${size.width}" height="${size.height}" style="width:${size.width}px;height:${size.height}px;${extraStyle}"/>`;
}

export const PLACEHOLDER_CSS = `.np-img { display: block; flex: none; object-fit: cover; }
.np-photo { background: #d7d9dc; color: #a9acb1; display: flex; align-items: center; justify-content: center; flex: none; }`;

export const GOOGLE_G = `<svg width="16" height="16" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.9 6.2C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/></svg>`;
