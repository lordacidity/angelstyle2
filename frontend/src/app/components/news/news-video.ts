// The News "screen recording", drawn here in the browser the way the ChatGPT
// (chatgpt-video.ts) and Pauv trade (trade-video.ts) recordings are: every
// frame on a 1000×750 screen laid down at twice that size (RENDER_SCALE), the
// Windows pointer on top, and the frames through WebCodecs (via mediabunny)
// into an H.264 MP4. Same inputs, same file, every time.
//
// ── This file is the source of truth for the news recording ─────────────────
// Studio > News renders one today, and it is the only caller. When the Vids
// and Simpler builders come to lay one in as a Bottom, they render it from
// here too rather than taking a copy — the way all three already share
// chatgpt-video.ts. Same rule, then: nothing in here may import from a
// caller's namespace (components/vids, components/simpler, lib/simpler), and
// what a caller does with the finished file — download it, file it, keep it
// in the tab — belongs to that caller, not in here.
//
// What is real: the story. The headline, byline and paragraphs were read from
// the outlet itself, the page is the outlet's (lib/news/templates), and the
// photos are the free ones the News section found for it. The Google page is
// a screenshot of a real "news" search (public/news/google-news.png, the dark
// theme, taken at 2x) with the third result repainted as the chosen story —
// the other results are whatever was in the news that day, which is fine.
//
// The script, about 8 seconds:
//   1. Google, "news" already typed and the News tab open; the pointer drops
//      in and the wheel rips down the results and back up, twice
//   2. it goes for the third result — the story — the title underlines under
//      the hand, click
//   3. nothing for most of a second while the pointer rips around, annoyed;
//      a blank flash; then the outlet's page paints without its pictures,
//      which come in one at a time over the next second, the way they do
//   4. the wheel rips well down the page and back, then to where the name is
//   5. the pointer drags across the name — in the headline when it is there,
//      else the first time the story says it — a letter at a time; the view
//      slams in and out on it twice; three fast laps around it; out of the top
//
// Both pages sit in a browser window a little smaller than the frame — wider
// than it is tall — with the page's own colour around it (GUTTER_X/Y,
// drawSurround), and Google is zoomed in (GOOGLE_ZOOM) so its type reads. The
// file goes back with its beats in clip seconds (NewsBeats) so a Bottom made
// this way can be marked up like a hand-cut one.

import { withBase } from '@/lib/clipping';
import { mixClicks, type ClickEvent } from '@/lib/clipSfx';
import { measureNewsPage, type PageMeasure, type Rect } from '@/lib/news/page-measure';
import { paintNewsPage } from '@/lib/news/rasterize';
import { PAGE_WIDTH, renderNewsPage, type PagePhotos } from '@/lib/news/templates';
import type { NewsArticle, OutletId, RailItem } from '@/lib/news/types';
import { safeExportName } from '@/lib/utils';
import { smoothScaling, videoBitrate } from '@/lib/vidsPlan';
import { drawPointer, loadPointers, type PointerKind } from '@/lib/windowsCursor';

/** The screen, in CSS px: the grid every number below is on. */
export const VIDEO_W = 1000;
export const VIDEO_H = 750;
/** Device pixels per CSS px in the file (see chatgpt-video.ts: the small text
 *  survives the build's second H.264 pass only when drawn at two). */
export const RENDER_SCALE = 2;
export const FILE_W = VIDEO_W * RENDER_SCALE;
export const FILE_H = VIDEO_H * RENDER_SCALE;
/** What a clip runs to, about: the script is timed to land here, and only a
 *  name deep in a long story pushes past it (more notches to reach it). */
export const CLIP_SECONDS = 9;
const FPS = 30;
const MAX_ZOOM = 1.9;
/** The app's own rate for these beds (lib/clipSfx), so this clip mixes with
 *  the ChatGPT and trade ones without resampling. */
export const AUDIO_RATE = 44100;
const POSTER_W = 480;
/** The frame shows a browser window a little smaller than itself — this much
 *  frame px either side, and this much above and below, so it comes out
 *  wider than it is tall. What is around the window is painted the page's
 *  own colour (drawSurround) — Google's dark, then whatever the outlet's page
 *  is — so there is no edge to see: the page simply sits in from the frame.
 *  Both pages are laid into the window. */
const GUTTER_X = 45;
const GUTTER_Y = 40;
const WINDOW_X = GUTTER_X;
const WINDOW_Y = GUTTER_Y;
const WINDOW_W = VIDEO_W - 2 * GUTTER_X;
const WINDOW_H = VIDEO_H - 2 * GUTTER_Y;
/** Google is shown zoomed in, the way Chrome's Ctrl-plus does it, so its
 *  type reads at this size: the window holds the screenshot's 1434 CSS px
 *  divided by this. What doesn't fit is taken out of the header's slack (the
 *  search pill's empty middle, the gap before the apps grid), never the
 *  results, so it lays out the way Google does in a narrower window. */
const GOOGLE_ZOOM = 1.42;
/** Both pages come out at about 0.6 frame px per device px, so a 32px
 *  pointer (Windows' at 130%, see lib/windowsCursor) is about 25 frame px:
 *  life size against the page, the way the trade clip draws it. */
const POINTER_SIZE = 0.6;
/** Chrome on Windows: a wheel notch scrolls 100 CSS px, over about 150ms. */
const NOTCH = 100;
const NOTCH_DUR = 0.16;
/** The page is painted at this many device px per CSS px; shown at about 1.4
 *  in the file, so it only ever shrinks. */
const PAGE_RASTER_SCALE = 2;
/** What an <img> that hasn't arrived leaves on the page. */
const PLACEHOLDER = '#e9eaec';
/** Chrome's text selection on a light page. */
const SELECTION = 'rgba(0, 120, 215, 0.34)';

// ── The Google screenshot, measured off the file (2 device px per CSS px) ───
const SHOT = {
  src: '/news/google-news.png',
  dpr: 2,
  cssW: 1434,
  bg: '#22242a', link: '#99c3ff', body: '#bdc1c6', time: '#9e9e9e', source: '#e8e8e8',
  /** The results column and the thumbnail column, CSS px. */
  colX: 167.5, colW: 540, thumbX: 727, thumbW: 92, thumbR: 8,
  /** Inside a result block, from its top: the 16px source icon, the source
   *  name's baseline, the first headline baseline and the line pitch, the gap
   *  from the last headline baseline to the first snippet baseline, the
   *  snippet's pitch, and the gap from the last snippet baseline to the time. */
  iconX: 167, iconW: 16, sourceX: 191, sourceBase: 11.5,
  headBase: 43.5, headLH: 26, snipGap: 30, snipLH: 22, timeGap: 27,
  /** Every result block: its top and how many lines its headline runs to.
   *  A block's height follows from its lines (blockH); the next block starts
   *  where the last ends. */
  blocks: [
    { top: 163, lines: 2 }, { top: 344, lines: 1 }, { top: 499, lines: 2 }, { top: 680, lines: 3 },
    { top: 887, lines: 2 }, { top: 1068, lines: 2 }, { top: 1248.5, lines: 2 }, { top: 1430, lines: 1 },
  ],
  /** Which of those the story goes in: the third. */
  slot: 2,
  /** The search box, "news" in it. */
  searchBox: { x: 297, y: 27, w: 706, h: 46 },
  /** The header band above the tabs, and where its slack is: the pill's
   *  empty middle runs from just after "news" (pillCut) to its icons; the
   *  pill ends at pillEnd; the apps grid and avatar start at clusterX and
   *  run to the edge. `gap` is the breathing room kept either side of what
   *  is taken out. */
  header: { h: 100, pillCut: 420, pillEnd: 1003, clusterX: 1290, gap: 20 },
};
/** CSS px of the screenshot the window shows across, zoomed. */
const GOOGLE_VIEW_W = SHOT.cssW / GOOGLE_ZOOM;
/** A block with a headline of `lines` lines: two snippet lines and the time
 *  under it; 155px with a one-line headline, 26 more per line. */
const blockH = (lines: number) => 129 + SHOT.headLH * lines;
const HEAD_FONT = '400 20px "Google Sans", Arial, sans-serif';
const SNIP_FONT = '14px Arial, sans-serif';
const SRC_FONT = '12px Arial, sans-serif';
const GOOGLE_SANS_HREF = 'https://fonts.googleapis.com/css?family=Google+Sans:400,500&display=swap';

/** How Google shows each outlet in the source line: its name, and the 16px
 *  badge — the site's favicon, which is the logo on the brand colour. */
const SOURCE_BADGE: Record<OutletId, { name: string; logo: string; bg: string; tint: string | null; fit: 'contain' | 'cover'; pad: number }> = {
  espn: { name: 'ESPN', logo: '/news/espn.png', bg: '#d00', tint: '#fff', fit: 'contain', pad: 2.5 },
  cnn: { name: 'CNN', logo: '/news/cnn.png', bg: '#cc0000', tint: '#fff', fit: 'contain', pad: 2.5 },
  fox: { name: 'Fox News', logo: '/news/fox.webp', bg: '#003366', tint: null, fit: 'cover', pad: 0 },
  nyt: { name: 'The New York Times', logo: '/news/nyt-t.png', bg: '#fff', tint: null, fit: 'contain', pad: 2 },
  tmz: { name: 'TMZ', logo: '/news/tmz.svg', bg: '#d8000f', tint: '#fff', fit: 'contain', pad: 2.5 },
  bbc: { name: 'BBC', logo: '/news/bbc.png', bg: '#000', tint: null, fit: 'contain', pad: 1 },
  people: { name: 'People', logo: '/news/people.png', bg: '#fff', tint: null, fit: 'contain', pad: 2 },
  imdb: { name: 'IMDb', logo: '/news/imdb.png', bg: '#f5c518', tint: null, fit: 'contain', pad: 1.5 },
};

// ── Small helpers ───────────────────────────────────────────────────────────
type Ctx = CanvasRenderingContext2D;
type Pt = { x: number; y: number };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const easeOut = (u: number) => 1 - Math.pow(1 - clamp(u, 0, 1), 3);
const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const inRect = (p: Pt, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = withBase(src);
  });
}

let googleSans: Promise<void> | null = null;
/** Google Sans, usable on a canvas — the Google Fonts API serves it. The
 *  stylesheet has to be parsed before document.fonts.load can find the face
 *  (asked too early it resolves at once with nothing), so this waits for the
 *  link first. Once per page. Falls through to Arial if it never comes. */
function loadGoogleSans(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  if (!googleSans) {
    googleSans = (async () => {
      let link = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).find(l => l.href === GOOGLE_SANS_HREF);
      const settled = (l: HTMLLinkElement) => new Promise<void>(res => {
        l.addEventListener('load', () => res(), { once: true });
        l.addEventListener('error', () => res(), { once: true });
        setTimeout(res, 6000);
      });
      if (!link) {
        link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = GOOGLE_SANS_HREF;
        const done = settled(link);
        document.head.appendChild(link);
        await done;
      } else if (!link.sheet) {
        await settled(link);
      }
      await document.fonts.load('400 20px "Google Sans"').catch(() => { /* Arial then */ });
    })();
  }
  return googleSans;
}

function text(ctx: Ctx, s: string, x: number, y: number, font: string, color: string) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
}

/** Greedy word wrap to `maxLines`, the cut line ending the way Google ends
 *  one ("..."). Measured in whatever font the context has. */
function wrapText(ctx: Ctx, s: string, maxW: number, maxLines: number): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  let used = 0;
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxW || !line) { line = next; used++; }
    else {
      lines.push(line);
      if (lines.length === maxLines) { line = ''; break; }
      line = w;
      used++;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (used < words.length && lines.length) {
    let last = lines[lines.length - 1];
    while (last.length && ctx.measureText(`${last}...`).width > maxW) last = last.slice(0, -1).replace(/[\s,.;:]+$/, '');
    lines[lines.length - 1] = `${last}...`;
  }
  return lines;
}

/** An image as one flat colour (its alpha kept), for the badges. */
function tinted(img: HTMLImageElement, color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.min(img.naturalWidth, 256));
  c.height = Math.max(1, Math.round(img.naturalHeight * (c.width / img.naturalWidth)));
  const x = c.getContext('2d')!;
  x.drawImage(img, 0, 0, c.width, c.height);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

/** "40 minutes ago", "2 hours ago", "3 days ago", else the date. */
function googleAgo(a: NewsArticle, now: number): string {
  const iso = a.publishedAt ?? (a.publishedDate ? `${a.publishedDate}T12:00:00Z` : null);
  if (!iso) return '';
  const mins = Math.max(1, Math.floor((now - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── The page: how far the frame sees, where the wheel settles ───────────────
/** Frame px per page CSS px: the page fills the window's width. */
const kA = WINDOW_W / PAGE_WIDTH;
/** Page CSS px the window shows. */
const VIEW_A = WINDOW_H / kA;
/** How far down the story the wheel goes before coming back up: a screen and
 *  a half (VIEW_A is about 1060 CSS px), so it is well into the story. Was 12
 *  until 2026-09-18 — a little longer, so there is time to read. */
const DOWN_NOTCHES = 16;
/** Where the wheel settles to read the name: the name about two fifths down
 *  the screen, on a notch, inside the page. */
function readScrollFor(nameTop: number, pageHeight: number): number {
  const max = Math.max(0, pageHeight - VIEW_A);
  return clamp(Math.round((nameTop - VIEW_A * 0.4) / NOTCH) * NOTCH, 0, max);
}
const nameTopOf = (m: PageMeasure) => (m.name ? Math.min(...m.name.chars.map(c => c.y)) : 0);

// ── Assets ──────────────────────────────────────────────────────────────────
/** What a recording is made from: the story as the section has it. */
export interface NewsClipSource {
  /** The name that was searched: whose name gets highlighted. */
  name: string;
  /** The short form the search found in the headline ("Putin", "AOC") when
   *  that is how it names them — NewsHit.namedAs — so that is what gets
   *  highlighted there, even where it is no part of the name. */
  namedAs?: string;
  article: NewsArticle;
  rail: RailItem[];
  /** The photos the page was drawn with, cut to their boxes. */
  photos: PagePhotos;
}
export interface NewsAssets {
  source: NewsClipSource;
  /** The Google page with the story in the third slot, at the screenshot's own
   *  2x, and its CSS height. `blocks` are the result blocks as they now sit. */
  google: { canvas: HTMLCanvasElement; cssH: number; blocks: { top: number; lines: number; own: boolean }[]; slot: { top: number; lines: { text: string; w: number }[] } };
  /** The outlet's page painted, its measurements read off the layout. */
  page: { canvas: HTMLCanvasElement; scale: number; height: number; pageHeight: number; measure: PageMeasure };
  /** Set when the name was nowhere on the page and the start of the headline
   *  stands in for it. */
  note: string | null;
}

/** The Google page with the story in the third slot. Drawn once, at the
 *  screenshot's own 2x: the rows above the slot as they are, the slot
 *  repainted, the rows below moved down or up to fit the headline's lines. */
function composeGoogle(shot: HTMLImageElement, src: NewsClipSource, logo: HTMLImageElement | null, thumb: HTMLImageElement | null, now: number): NewsAssets['google'] {
  const d = SHOT.dpr;
  const a = src.article;
  const badge = SOURCE_BADGE[a.outlet];
  const meas = document.createElement('canvas').getContext('2d')!;
  meas.font = HEAD_FONT;
  const lines = wrapText(meas, a.headline.replace(/\s+/g, ' ').trim(), SHOT.colW, 3).map(t => ({ text: t, w: meas.measureText(t).width }));
  meas.font = SNIP_FONT;
  const snippet = wrapText(meas, (a.dek ?? a.paragraphs[0] ?? '').replace(/\s+/g, ' ').trim(), SHOT.colW, 2);
  const n = Math.max(1, lines.length);
  const old = SHOT.blocks[SHOT.slot];
  const next = SHOT.blocks[SHOT.slot + 1];
  const delta = blockH(n) - blockH(old.lines);
  const shotH = shot.naturalHeight / d;

  // The window's width of the screenshot: the results are left-aligned and
  // fit whole; the header is re-laid for the narrower window below.
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(GOOGLE_VIEW_W * d);
  canvas.height = Math.round((shotH + delta) * d);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = SHOT.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const cut = old.top * d;
  const rest = next.top * d;
  ctx.drawImage(shot, 0, 0, canvas.width, cut, 0, 0, canvas.width, cut);
  ctx.drawImage(shot, 0, rest, canvas.width, shot.naturalHeight - rest, 0, rest + delta * d, canvas.width, shot.naturalHeight - rest);
  // The header in the narrower window: what the zoom takes away comes out of
  // the gap before the apps grid first, then the search pill's empty middle,
  // so the pill keeps its icons and the grid and avatar sit at the edge.
  {
    const hd = SHOT.header;
    const take = SHOT.cssW - GOOGLE_VIEW_W;
    const fromGap = Math.min(take, hd.clusterX - hd.pillEnd - 2 * hd.gap);
    const fromPill = Math.max(0, take - fromGap);
    const hh = hd.h * d;
    ctx.fillStyle = SHOT.bg;
    ctx.fillRect(0, 0, canvas.width, hh);
    const piece = (sx: number, ex: number, dx: number) => ctx.drawImage(shot, sx * d, 0, (ex - sx) * d, hh, dx * d, 0, (ex - sx) * d, hh);
    piece(0, hd.pillCut, 0);
    piece(hd.pillCut + fromPill, hd.pillEnd + hd.gap, hd.pillCut);
    piece(hd.clusterX - hd.gap, SHOT.cssW, GOOGLE_VIEW_W - (SHOT.cssW - hd.clusterX + hd.gap));
  }

  ctx.scale(d, d);
  const top = old.top;
  // The source line: the badge, then the outlet's name.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(SHOT.iconX, top, SHOT.iconW, SHOT.iconW, 3);
  ctx.clip();
  ctx.fillStyle = badge.bg;
  ctx.fillRect(SHOT.iconX, top, SHOT.iconW, SHOT.iconW);
  if (logo) {
    const img: CanvasImageSource = badge.tint ? tinted(logo, badge.tint) : logo;
    const iw = logo.naturalWidth, ih = logo.naturalHeight;
    const box = SHOT.iconW - 2 * badge.pad;
    const s = badge.fit === 'cover' ? Math.max(box / iw, box / ih) : Math.min(box / iw, box / ih);
    smoothScaling(ctx).drawImage(img, SHOT.iconX + SHOT.iconW / 2 - (iw * s) / 2, top + SHOT.iconW / 2 - (ih * s) / 2, iw * s, ih * s);
  }
  ctx.restore();
  text(ctx, badge.name, SHOT.sourceX, top + SHOT.sourceBase, SRC_FONT, SHOT.source);
  lines.forEach((l, i) => text(ctx, l.text, SHOT.colX, top + SHOT.headBase + SHOT.headLH * i, HEAD_FONT, SHOT.link));
  const snip0 = top + SHOT.headBase + SHOT.headLH * (n - 1) + SHOT.snipGap;
  snippet.forEach((s, j) => text(ctx, s, SHOT.colX, snip0 + SHOT.snipLH * j, SNIP_FONT, SHOT.body));
  const ago = googleAgo(a, now);
  if (ago) text(ctx, ago, SHOT.colX, snip0 + SHOT.snipLH * Math.max(0, snippet.length - 1) + SHOT.timeGap, SNIP_FONT, SHOT.time);
  // The thumbnail: the story's photo, cut square.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(SHOT.thumbX, top, SHOT.thumbW, SHOT.thumbW, SHOT.thumbR);
  ctx.clip();
  if (thumb) {
    const s = Math.max(SHOT.thumbW / thumb.naturalWidth, SHOT.thumbW / thumb.naturalHeight);
    const w = thumb.naturalWidth * s, h = thumb.naturalHeight * s;
    smoothScaling(ctx).drawImage(thumb, SHOT.thumbX + (SHOT.thumbW - w) / 2, top + (SHOT.thumbW - h) / 2, w, h);
  } else {
    ctx.fillStyle = '#3c4043';
    ctx.fillRect(SHOT.thumbX, top, SHOT.thumbW, SHOT.thumbW);
  }
  ctx.restore();

  const blocks = SHOT.blocks.map((b, i) => ({ top: i > SHOT.slot ? b.top + delta : b.top, lines: i === SHOT.slot ? n : b.lines, own: i === SHOT.slot }));
  return { canvas, cssH: shotH + delta, blocks, slot: { top, lines } };
}

/** The screenshot, the outlet's badge, the story's photo for the thumbnail,
 *  Google Sans, the pointer, and the outlet's page painted and measured. */
export async function loadNewsAssets(src: NewsClipSource, signal?: AbortSignal): Promise<NewsAssets> {
  const badge = SOURCE_BADGE[src.article.outlet];
  const page = renderNewsPage(src.article, src.rail, src.photos);
  const [shot, logo, thumb, painted] = await Promise.all([
    loadImage(SHOT.src),
    loadImage(badge.logo),
    src.photos.hero ? loadImage(src.photos.hero.src) : Promise.resolve(null),
    paintNewsPage(page, {
      scale: PAGE_RASTER_SCALE,
      measure: root => measureNewsPage(root, src.name, src.namedAs),
      // As far as the wheel goes: DOWN_NOTCHES down, or to the name — which
      // it may pass by up to half a notch — plus the screen under that.
      heightFor: (m, h) => Math.max(DOWN_NOTCHES * NOTCH, readScrollFor(nameTopOf(m), h) + NOTCH / 2) + VIEW_A + 2,
    }),
    loadGoogleSans(),
    loadPointers(),
  ]);
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (!shot) throw new Error(`The Google screenshot is missing (${SHOT.src}).`);
  const m = painted.measured;
  if (!m.name) throw new Error('There is nothing on the page to highlight.');
  const note = m.name.standIn
    ? `“${src.name}” isn't in the headline or the story, so the clip highlights the start of the headline instead.`
    : null;
  return {
    source: src,
    google: composeGoogle(shot, src, logo, thumb, Date.now()),
    page: { canvas: painted.canvas, scale: painted.scale, height: painted.height, pageHeight: painted.pageHeight, measure: m },
    note,
  };
}

// ── The clip ────────────────────────────────────────────────────────────────
/** A stretch of the clip, in clip seconds. */
export interface Stretch { start: number; end: number }
/** The three things the recording shows, in order, abutting and covering the
 *  whole clip: Google — the results, the wheel, the pointer going for the
 *  story — up to the click; the wait, the page painting and its pictures
 *  arriving, up to the wheel moving on it; and the story — the wheel, the
 *  name dragged, the zoom, the laps — to the end. */
export type NewsBeats = { searching: Stretch; loading: Stretch; choosing: Stretch };
export interface NewsClip {
  draw: (t: number) => void;
  seconds: number;
  beats: NewsBeats;
  /** The pointer pressing down on the name — the start of the drag, the
   *  moment the recording gets to them. Clip seconds, inside `choosing`. */
  nameAt: number;
  /** The first of the hard in-out zoom pulses on the name, once it has been
   *  dragged over. Clip seconds, inside `choosing`. */
  pulseAt: number;
  /** Google going off the screen: the blank flash after the click, before
   *  the story paints. Google stays up for most of a second after the click,
   *  so this is the first moment nothing on screen is Google. Clip seconds,
   *  inside `loading`. */
  leftGoogleAt: number;
  /** Every press of the mouse — the click on the story, the drag's press and
   *  release — see buildNewsAudio. */
  clicks: ClickEvent[];
}

/** A wheel notch as Chrome takes it: the target moves NOTCH from wherever the
 *  last one left it, never past the ends; one at the end of the page does
 *  nothing. `from`/`to` are what it animates between. */
interface Notch { t: number; from: number; to: number; dur: number }
interface Step { t: number; dir: 1 | -1; dur: number }
function planNotches(steps: Step[], max: number, from = 0): Notch[] {
  const out: Notch[] = [];
  let pos = from;
  for (const s of steps) {
    const to = clamp(pos + s.dir * NOTCH, 0, max);
    out.push({ t: s.t, from: pos, to, dur: s.dur });
    pos = to;
  }
  return out;
}
/** A flick of the wheel: `n` notches one way, across exactly the stretch of
 *  time an even run would have taken, but not evenly spread and not all
 *  decaying alike.
 *
 *  Evenly spaced notches are what made this read as a page being animated
 *  rather than somebody scrolling. A hand does not tick: two or three notches
 *  arrive almost on top of each other, then there is a beat while the eye
 *  catches up, then another scramble. So the gaps are drawn mostly short with
 *  the odd long one — the beats — and then normalised back to the same total,
 *  which is what keeps the run ending when it used to. Everything downstream
 *  is timed off the end of a run (the click on the story, the drag over the
 *  name, the length of the clip), so the span is not ours to move.
 *
 *  Each notch also gets its own decay: a sharp one bites and settles, a lazy
 *  one drifts. Same seed as everything else in the clip, so a given story
 *  always scrolls the same way. */
const run = (t0: number, n: number, dir: 1 | -1, gap: number, rnd: () => number): Step[] => {
  if (n <= 0) return [];
  const dur = () => NOTCH_DUR * (0.65 + rnd() * 0.5);
  if (n === 1) return [{ t: t0, dir, dur: dur() }];
  // Mostly tight, one in four a beat. Normalised to the span below, so the
  // mix changes the texture and never the timing.
  const gaps = Array.from({ length: n - 1 }, () => (rnd() < 0.25 ? 1.9 + rnd() * 1.3 : 0.35 + rnd() * 0.45));
  const total = gaps.reduce((a, b) => a + b, 0);
  const span = (n - 1) * gap;
  const out: Step[] = [];
  let t = t0;
  for (let i = 0; i < n; i++) {
    out.push({ t, dir, dur: dur() });
    if (i < n - 1) t += (gaps[i] / total) * span;
  }
  return out;
};
/** Where the page sits at t: every notch so far, each easing out over its own
 *  duration, on top of each other the way quick notches stack. */
function scrollOf(notches: Notch[], t: number, from = 0): number {
  let s = notches.length ? notches[0].from : from;
  for (const n of notches) {
    if (t < n.t) break;
    s += (n.to - n.from) * easeOut((t - n.t) / n.dur);
  }
  return s;
}
const endOf = (notches: Notch[], from = 0) => (notches.length ? notches[notches.length - 1].to : from);

export function createNewsClip(ctx: Ctx, a: NewsAssets): NewsClip {
  const W = VIDEO_W;
  const H = VIDEO_H;
  const g = a.google;
  /** Frame px per Google CSS px: the zoomed page fills the window's width. */
  const kG = WINDOW_W / GOOGLE_VIEW_W;
  /** Google CSS px the window shows. */
  const viewG = WINDOW_H / kG;
  const gMax = Math.max(0, g.cssH - viewG);
  const pg = a.page;
  const m = pg.measure;
  const name = m.name!;
  const pageMax = Math.max(0, pg.pageHeight - VIEW_A);
  const readScroll = readScrollFor(nameTopOf(m), pg.pageHeight);
  const rnd = mulberry32(hashStr(`${a.source.article.url}|${a.source.name}`));

  // ── Timeline ──────────────────────────────────────────────────────────────
  // Google: down four, up four, down two, up two, all fast; then the story.
  const gNotches = planNotches([
    ...run(0.32, 4, 1, 0.07, rnd), ...run(0.78, 4, -1, 0.07, rnd),
    ...run(1.2, 2, 1, 0.07, rnd), ...run(1.5, 2, -1, 0.07, rnd),
  ], gMax);
  const T_GO = 1.66;
  const T_HOVER = 1.98;
  const T_CLICK = 2.12;
  // Nothing happens for most of a second, then the blank, then the paint.
  const T_NAV = T_CLICK + 0.7;
  const T_PAINT = T_NAV + 0.28;
  // The pictures, one at a time: the main one first, as it is first on the
  // page. They come in quickly — a moment after the paint, close on each other.
  const loadAt = m.photos.map((_, i) => T_PAINT + 0.2 + i * 0.09 + rnd() * 0.07);
  // The pointer rips around from just after the click until the page is up.
  const T_LOOP: [number, number] = [T_CLICK + 0.14, T_PAINT + 0.32];
  // The story: down DOWN_NOTCHES, up three, then to the name.
  //
  // A short page — the Times' has no article text, a BBC story can be a few
  // paragraphs — runs out under the wheel: the notches down stop at the
  // bottom, which is almost never on the 100px grid, and a notch up that meets
  // the top does nothing. Two things follow. The steps are planned once and
  // kept, never read back off the notches (a notch that did nothing has no
  // direction to read, and taking it for a notch down sent the page back down
  // after it had reached the top). And the notches to the name are counted to
  // land nearest it, not past it — from off the grid they can't land on it —
  // unless it is the top or the bottom of the page, which the page itself
  // stops at, so going past lands exactly.
  // A beat and a half on the headline before the wheel moves (0.7s until
  // 2026-09-18): the headline is the story, and it wants reading.
  const T_A = T_PAINT + 1.5;
  const T_UP = T_A + DOWN_NOTCHES * 0.07 + 0.33;
  const roam = [...run(T_A, DOWN_NOTCHES, 1, 0.07, rnd), ...run(T_UP, 3, -1, 0.07, rnd)];
  const after = endOf(planNotches(roam, pageMax));
  const atEnd = readScroll <= 0 || readScroll >= pageMax;
  const toName = (atEnd ? Math.ceil : Math.round)(Math.abs(readScroll - after) / NOTCH - (atEnd ? 1e-6 : 0));
  const aNotches = planNotches([
    ...roam,
    ...run(T_UP + 0.5, toName, readScroll >= after ? 1 : -1, 0.06, rnd),
  ], pageMax);
  const T_LAST = aNotches.length ? aNotches[aNotches.length - 1].t : T_UP + 0.4;
  /** Where the wheel really leaves the page for the drag — within half a notch
   *  of readScroll, and exactly it on a long page. Everything about the name
   *  on screen is worked out from this, so the highlight is always drawn where
   *  the page is, wherever the wheel stopped. */
  const readAt = endOf(aNotches);
  // The drag across the name, two hard in-out zoom pulses, three fast laps, out.
  const T_DRAG: [number, number] = [T_LAST + 0.6, T_LAST + 0.95];
  const PULSE = 0.13;
  const T_PULSE = T_DRAG[1] + 0.08;
  const T_PULSED = T_PULSE + 4 * PULSE;
  const T_LAPS: [number, number] = [T_PULSED + 0.05, T_PULSED + 0.55];
  const T_EXIT: [number, number] = [T_LAPS[1], T_LAPS[1] + 0.1];
  const seconds = Math.ceil((T_EXIT[1] + 0.7) * FPS) / FPS;
  const beats: NewsBeats = {
    searching: { start: 0, end: T_CLICK },
    loading: { start: T_CLICK, end: T_A },
    choosing: { start: T_A, end: seconds },
  };
  // What is heard: the click on the story, and the drag's press and release,
  // each on the first frame that shows it.
  const onFrame = (t: number) => Math.ceil(t * FPS - 1e-6) / FPS;
  const clicks: ClickEvent[] = [
    { t: onFrame(T_CLICK), kind: 'full' },
    { t: onFrame(T_DRAG[0]), kind: 'press' },
    { t: onFrame(T_DRAG[1]), kind: 'release' },
  ];

  // ── Geometry ──────────────────────────────────────────────────────────────
  // The story's headline on the Google page, frame px, at the scroll it is
  // clicked at (the wheel is back at the top by then).
  const slotScroll = scrollOf(gNotches, T_CLICK);
  const clickPt: Pt = {
    x: WINDOW_X + (SHOT.colX + Math.min(g.slot.lines[0]?.w ?? 200, 300) * 0.4) * kG,
    y: WINDOW_Y + (g.slot.top + SHOT.headBase - 7 - slotScroll) * kG,
  };
  // The name on the page, frame px, at the scroll it is read at.
  const chars = name.chars;
  const nameBox = chars.reduce((b, r) => {
    const x = Math.min(b.x, r.x), y = Math.min(b.y, r.y);
    return { x, y, w: Math.max(b.x + b.w, r.x + r.w) - x, h: Math.max(b.y + b.h, r.y + r.h) - y };
  });
  const toFrame = (r: Rect, scroll: number): Rect => ({ x: WINDOW_X + r.x * kA, y: WINDOW_Y + (r.y - scroll) * kA, w: r.w * kA, h: r.h * kA });
  const sel = toFrame(nameBox, readAt);
  const selCX = sel.x + sel.w / 2;
  const selCY = sel.y + sel.h / 2;
  const firstC = toFrame(chars[0], readAt);
  const lastC = toFrame(chars[chars.length - 1], readAt);
  const wob = mulberry32(hashStr(a.source.name));
  const dragFrom: Pt = { x: firstC.x + 2 + wob() * 2, y: firstC.y + firstC.h * 0.62 + wob() * 3 };
  const dragTo: Pt = { x: lastC.x + lastC.w + 1 + wob() * 4, y: lastC.y + lastC.h * 0.58 + wob() * 4 };

  // ── The pointer's path (frame px) ─────────────────────────────────────────
  // The trade clip's hand: every leg in half its time (RUSH), an overshoot
  // and a snap back, and never quite still — a tremor rides on everything,
  // loudest once it has landed; calm through a press, and steady on a drag.
  const RUSH = 1.75;
  const easeBack = (u: number) => { const c = 1.6; const p = u - 1; return 1 + (c + 1) * p * p * p + c * p * p; };
  const fidget = (t: number, amp: number) => ({
    x: amp * (0.5 * Math.sin(t * 7.9 + 0.3) + 0.24 * Math.sin(t * 19.7 + 1.7) + 0.9 * Math.sin(t * 2.6)),
    y: amp * (0.5 * Math.cos(t * 6.9 + 1.1) + 0.24 * Math.cos(t * 17.9) + 0.9 * Math.cos(t * 2.1 + 2.1)),
  });
  const startPt: Pt = { x: 860, y: -40 };
  // Off to the right of the thumbnails, on Google's empty side.
  const restG: Pt = { x: 850, y: 345 };
  // Big, fast, uneven loops in the middle of the screen while nothing
  // happens: the speed and the radius both wobble, the centre drifts, and a
  // fine shake rides on top (the ChatGPT clip's wait).
  const loopC: Pt = { x: 520, y: 400 };
  const loopAt = (t: number): Pt => {
    const u = t - T_LOOP[0];
    const ang = -Math.PI / 2 + 2 * Math.PI * (3.0 * u + 0.3 * Math.sin(4.7 * u));
    const r = 150 * (0.7 + 0.3 * Math.sin(3.1 * u + 0.8));
    return {
      x: loopC.x + 40 * Math.sin(1.7 * u) + r * Math.cos(ang) + 3 * Math.sin(37 * u),
      y: loopC.y + 25 * Math.cos(2.2 * u) + r * 0.85 * Math.sin(ang) + 3 * Math.cos(29 * u),
    };
  };
  const restA: Pt = { x: 905, y: 330 };
  // Three tight laps around the selection, six a second.
  const lapRX = Math.max(42, sel.w / 2 + 14);
  const lapRY = Math.max(22, sel.h / 2 + 14);
  const lapAt = (t: number): Pt => {
    const ang = -Math.PI / 2 + 2 * Math.PI * 6 * (t - T_LAPS[0]);
    return { x: selCX + lapRX * Math.cos(ang), y: selCY + lapRY * Math.sin(ang) };
  };
  const exitPt: Pt = { x: selCX + 24, y: -40 };
  interface Key { t: number; x: number; y: number; snap?: boolean }
  const keys: Key[] = [
    { t: 0, ...startPt },
    { t: 0.3, ...restG },
    { t: T_GO, ...restG },
    { t: T_HOVER, ...clickPt },
    { t: T_CLICK + 0.1, ...clickPt },
    { t: T_LOOP[0], ...loopAt(T_LOOP[0]) },
    { t: T_LOOP[1], ...loopAt(T_LOOP[1]) },
    { t: T_LOOP[1] + 0.3, ...restA },
    { t: T_LAST + 0.2, ...restA },
    { t: T_DRAG[0], ...dragFrom },
    { t: T_DRAG[1], ...dragTo },
    { t: T_PULSED, ...dragTo },
    { t: T_LAPS[0], ...lapAt(T_LAPS[0]) },
    { t: T_EXIT[0], ...lapAt(T_LAPS[1]) },
    // `snap`: this leg accelerates the whole way instead of easing in and out.
    { t: T_EXIT[1], ...exitPt, snap: true },
    { t: seconds + 1, ...exitPt },
  ];
  const pressCalm = (t: number) => {
    let d = Infinity;
    for (const c of clicks) d = Math.min(d, Math.abs(t - c.t - 0.03));
    return easeInOut(clamp((d - 0.1) / 0.22, 0, 1));
  };
  const cursorAt = (t: number): Pt => {
    let base: Pt;
    let landed = true;
    if (t >= T_LOOP[0] && t < T_LOOP[1]) base = loopAt(t);
    else if (t >= T_LAPS[0] && t < T_LAPS[1]) base = lapAt(t);
    else {
      let i = 0;
      while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
      const k0 = keys[i];
      const k1 = keys[i + 1];
      const raw = k1.t === k0.t ? 1 : clamp((t - k0.t) / (k1.t - k0.t), 0, 1);
      const u = clamp(raw * RUSH, 0, 1);
      // The drag is a straight, steady pull; everything else rushes.
      const dragging = t >= T_DRAG[0] && t < T_DRAG[1];
      const e = k1.snap ? u * u : dragging ? easeInOut(raw) : easeBack(u);
      base = { x: lerp(k0.x, k1.x, e), y: lerp(k0.y, k1.y, e) };
      landed = u >= 1;
    }
    const steady = t >= T_DRAG[0] && t < T_PULSED;
    const amp = steady ? 0.6 : landed ? 6 : 3;
    const f = fidget(t, lerp(0.4, amp, pressCalm(t)));
    return { x: base.x + f.x, y: base.y + f.y };
  };

  // ── What is selected under the drag ───────────────────────────────────────
  // A character joins once the pointer passes its middle, the way browsers
  // do it — a line above the pointer is all in, a line below not yet.
  const frameChars = chars.map(c => toFrame(c, readAt));
  const selectedAt = (t: number): Rect[] => {
    if (t >= T_DRAG[1]) return frameChars;
    const p = cursorAt(t);
    return frameChars.filter(c => {
      if (p.y > c.y + c.h) return true;
      if (p.y < c.y) return false;
      return c.x + c.w / 2 <= p.x;
    });
  };

  // in, out, in, out: four PULSE-long legs, each one snapping off the mark.
  const zoomAt = (t: number) => {
    const u = t - T_PULSE;
    if (u < 0 || u >= 4 * PULSE) return 1;
    const leg = Math.floor(u / PULSE);
    const f = easeOut((u - leg * PULSE) / PULSE);
    return leg % 2 === 0 ? 1 + (MAX_ZOOM - 1) * f : MAX_ZOOM - (MAX_ZOOM - 1) * f;
  };
  // The zoom scales the screen around the selection, which stays put, never
  // showing past the screen's edges.
  const zoomShift = (z: number): Pt => ({ x: clamp(selCX * (1 - z), W * (1 - z), 0), y: clamp(selCY * (1 - z), H * (1 - z), 0) });

  // ── What the pointer looks like where it is ───────────────────────────────
  // Google: the hand over a result's title, its thumbnail and its source (all
  // links), the I-beam over the snippet, the time and the search box; the
  // page: the I-beam over text; the arrow everywhere else.
  const googleKind = (x: number, y: number): PointerKind => {
    if (inRect({ x, y }, SHOT.searchBox)) return 'beam';
    for (const b of g.blocks) {
      const headTop = b.top + SHOT.headBase - 19.5;
      const headBot = b.top + SHOT.headBase + SHOT.headLH * (b.lines - 1) + 6.5;
      const w = b.own ? Math.max(...g.slot.lines.map(l => l.w)) : SHOT.colW;
      if (inRect({ x, y }, { x: SHOT.colX, y: headTop, w, h: headBot - headTop })) return 'hand';
      if (inRect({ x, y }, { x: SHOT.thumbX, y: b.top, w: SHOT.thumbW, h: SHOT.thumbW })) return 'hand';
      if (inRect({ x, y }, { x: SHOT.iconX, y: b.top, w: 220, h: SHOT.iconW })) return 'hand';
      const snip0 = b.top + SHOT.headBase + SHOT.headLH * (b.lines - 1) + SHOT.snipGap;
      if (inRect({ x, y }, { x: SHOT.colX, y: snip0 - 15, w: SHOT.colW, h: SHOT.snipLH + 20 })) return 'beam';
      const timeY = snip0 + SHOT.snipLH + SHOT.timeGap;
      if (inRect({ x, y }, { x: SHOT.colX, y: timeY - 15, w: 100, h: 20 })) return 'beam';
    }
    return 'arrow';
  };
  const kindAt = (t: number, p: Pt): PointerKind => {
    if (t < T_NAV) return googleKind((p.x - WINDOW_X) / kG, (p.y - WINDOW_Y) / kG + scrollOf(gNotches, t));
    if (t < T_PAINT) return 'arrow';
    const z = zoomAt(t);
    const s = z > 1 ? zoomShift(z) : { x: 0, y: 0 };
    const sc = scrollOf(aNotches, t);
    const q = { x: ((p.x - s.x) / z - WINDOW_X) / kA, y: ((p.y - s.y) / z - WINDOW_Y) / kA + sc };
    return m.text.some(r => inRect(q, r)) ? 'beam' : 'arrow';
  };

  // ── Drawing ───────────────────────────────────────────────────────────────
  // The title underlines under the hand, as Google's do.
  const hovering = (t: number) => t >= T_HOVER - 0.03 && t < T_NAV;
  // The window sits in the middle of the frame, and the frame around it is
  // the colour of the page in it — Google's dark, then whatever the outlet's
  // page is (measured off the layout) — so the page reads as sitting in from
  // the edges rather than boxed in grey, and the blank at the navigation is
  // the whole frame going to the new page's colour.
  const drawSurround = (color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, W, H);
  };
  function drawGoogle(t: number) {
    drawSurround(SHOT.bg);
    const sc = scrollOf(gNotches, t);
    const sy = sc * SHOT.dpr;
    const sh = Math.max(0, Math.min(g.canvas.height - sy, viewG * SHOT.dpr));
    if (sh > 0) smoothScaling(ctx).drawImage(g.canvas, 0, sy, g.canvas.width, sh, WINDOW_X, WINDOW_Y, WINDOW_W, (sh / SHOT.dpr) * kG);
    if (hovering(t)) {
      ctx.fillStyle = SHOT.link;
      g.slot.lines.forEach((l, i) => {
        const y = WINDOW_Y + (g.slot.top + SHOT.headBase + SHOT.headLH * i + 2.5 - sc) * kG;
        ctx.fillRect(WINDOW_X + SHOT.colX * kG, y, l.w * kG, kG);
      });
    }
  }
  function drawArticle(t: number) {
    drawSurround(m.background);
    if (t < T_PAINT) return;
    const sc = scrollOf(aNotches, t);
    const rs = pg.scale;
    const sy = sc * rs;
    const sh = Math.max(0, Math.min(pg.canvas.height - sy, VIEW_A * rs));
    if (sh > 0) smoothScaling(ctx).drawImage(pg.canvas, 0, sy, pg.canvas.width, sh, WINDOW_X, WINDOW_Y, WINDOW_W, (sh / rs) * kA);
    // The pictures still on their way.
    ctx.fillStyle = PLACEHOLDER;
    m.photos.forEach((r, i) => {
      if (t < loadAt[i]) { const f = toFrame(r, sc); ctx.fillRect(f.x, f.y, f.w, f.h); }
    });
    if (t >= T_DRAG[0]) {
      ctx.fillStyle = SELECTION;
      for (const r of selectedAt(t)) ctx.fillRect(r.x, r.y, r.w, r.h);
    }
  }

  // Everything is drawn in CSS px on a canvas RENDER_SCALE times the screen:
  // the base transform is the scale, and the zoom and the pointer ride on it.
  const S = RENDER_SCALE;
  const draw = (t: number) => {
    ctx.setTransform(S, 0, 0, S, 0, 0);
    const z = zoomAt(t);
    if (z > 1) {
      const s = zoomShift(z);
      ctx.setTransform(z * S, 0, 0, z * S, s.x * S, s.y * S);
    }
    if (t < T_NAV) drawGoogle(t);
    else drawArticle(t);
    ctx.setTransform(S, 0, 0, S, 0, 0);
    const c = cursorAt(t);
    drawPointer(ctx, kindAt(t, c), c.x, c.y, POINTER_SIZE);
  };
  return { draw, seconds, beats, nameAt: T_DRAG[0], pulseAt: T_PULSE, leftGoogleAt: T_NAV, clicks };
}

// ── The sound ───────────────────────────────────────────────────────────────
/** The clip's whole sound in one buffer: the mouse on every press, from the
 *  same synthesis the trade clip uses (lib/clipSfx), so the two cut together
 *  as one recording. Nothing is typed, so no keyboard. The same buffer the
 *  preview plays and the file carries. */
export function buildNewsAudio(clip: Pick<NewsClip, 'seconds' | 'clicks'>, seed: string): AudioBuffer {
  const length = Math.ceil(clip.seconds * AUDIO_RATE);
  const bed = new AudioBuffer({ numberOfChannels: 2, length, sampleRate: AUDIO_RATE });
  mixClicks(bed, clip.clicks, hashStr(seed));
  return bed;
}

// ── Render + encode ─────────────────────────────────────────────────────────
export interface RenderOptions {
  onProgress?: (done: number, total: number) => void;
  /** The clip as it will come out — its beats, its length, its size — the
   *  moment it is worked out, before the first frame is drawn. For whoever has
   *  something to start on those while the frames go. */
  onPlanned?: (p: NewsPlan) => void;
  signal?: AbortSignal;
}
/** Everything a render hands back that is known before it starts drawing. */
export type NewsPlan = Pick<RenderResult, 'beats' | 'nameAt' | 'pulseAt' | 'leftGoogleAt' | 'seconds' | 'width' | 'height'>;
export interface RenderResult {
  blob: Blob;
  filename: string;
  beats: NewsBeats;
  /** The pointer pressing on the name, clip seconds — see NewsClip.nameAt. */
  nameAt: number;
  /** The first zoom pulse on the name, clip seconds — see NewsClip.pulseAt. */
  pulseAt: number;
  /** Google going off the screen, clip seconds — see NewsClip.leftGoogleAt. */
  leftGoogleAt: number;
  /** How long the file runs, in seconds — whole frames. */
  seconds: number;
  /** The file's size in pixels (the screen times RENDER_SCALE). */
  width: number;
  height: number;
  /** A frame out of the middle of the clip as a JPEG, for wherever the clip
   *  is shown as a card. Null if the browser wouldn't give one. */
  poster: Blob | null;
}
export async function renderNewsVideo(assets: NewsAssets, o: RenderOptions = {}): Promise<RenderResult> {
  if (typeof VideoEncoder === 'undefined') throw new Error('This browser cannot encode video. Use Chrome or Edge.');
  const mb = await import('mediabunny');
  const canvas = document.createElement('canvas');
  canvas.width = FILE_W;
  canvas.height = FILE_H;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D is unavailable.');
  const clip = createNewsClip(ctx, assets);
  const { draw, seconds, beats } = clip;
  const frames = Math.round(seconds * FPS);
  o.onPlanned?.({
    beats, nameAt: clip.nameAt, pulseAt: clip.pulseAt, leftGoogleAt: clip.leftGoogleAt,
    seconds, width: canvas.width, height: canvas.height,
  });

  // H.264 in an MP4 wherever the browser can encode it (Chrome and Edge on a
  // normal machine); VP9/VP8 in a WebM otherwise.
  const codec = await mb.getFirstEncodableVideoCodec(['avc', 'vp9', 'vp8'], { width: canvas.width, height: canvas.height });
  if (!codec) throw new Error('No video encoder is available in this browser.');
  const mp4 = codec === 'avc';
  const output = new mb.Output({
    format: mp4 ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' }) : new mb.WebMOutputFormat(),
    target: new mb.BufferTarget(),
  });
  // Written as generously as the build writes its own file (lib/vidsPlan
  // videoBitrate): the first of two H.264 passes, the one with the small text.
  const source = new mb.CanvasSource(canvas, {
    codec,
    bitrate: videoBitrate(canvas.width, canvas.height, FPS),
    keyFrameInterval: 2,
    latencyMode: 'quality',
  });
  output.addVideoTrack(source, { frameRate: FPS });
  // The mouse, on its own track, when the browser can encode one. Not fatal:
  // the clip still goes out, silent.
  const audioCodec = await mb.getFirstEncodableAudioCodec(mp4 ? ['aac', 'opus'] : ['opus'], { numberOfChannels: 2, sampleRate: AUDIO_RATE, bitrate: 128_000 }).catch(() => null);
  let bed: AudioBuffer | null = null;
  if (audioCodec) {
    try { bed = buildNewsAudio(clip, assets.source.article.url); } catch (err) { console.error('[news video] sound skipped:', err); }
  }
  const audio = bed && audioCodec ? new mb.AudioBufferSource({ codec: audioCodec, bitrate: 128_000 }) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();
  try {
    for (let i = 0; i < frames; i++) {
      if (o.signal?.aborted) throw new DOMException('Render cancelled', 'AbortError');
      draw(i / FPS);
      // Resolves once the encoder can take more, so this loop never runs ahead.
      await source.add(i / FPS, 1 / FPS);
      o.onProgress?.(i + 1, frames);
      if (i % 6 === 5) await new Promise(r => setTimeout(r, 0));
    }
    if (audio && bed) {
      await audio.add(bed);
      audio.close();
    }
  } catch (err) {
    await output.cancel().catch(() => { /* already gone */ });
    throw err;
  }
  await output.finalize();
  const buf = output.target.buffer;
  if (!buf) throw new Error('The encoder produced nothing.');
  const slug = safeExportName(assets.source.name).toLowerCase().replace(/\s+/g, '-') || 'news';
  return {
    blob: new Blob([buf], { type: mp4 ? 'video/mp4' : 'video/webm' }),
    filename: `news-${slug}-${assets.source.article.outlet}.${mp4 ? 'mp4' : 'webm'}`,
    beats,
    nameAt: clip.nameAt,
    pulseAt: clip.pulseAt,
    leftGoogleAt: clip.leftGoogleAt,
    seconds,
    width: canvas.width,
    height: canvas.height,
    poster: await poster(canvas, () => draw(seconds / 2)),
  };
}

/** A frame out of the middle of the clip, the size the library's own posters
 *  are (lib/vids-client probeVideoFile), so a card shows the story rather than
 *  Google. Never throws: no poster is not no clip. */
function poster(canvas: HTMLCanvasElement, drawMiddle: () => void): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      drawMiddle();
      const k = Math.min(1, POSTER_W / canvas.width);
      const small = document.createElement('canvas');
      small.width = Math.max(1, Math.round(canvas.width * k));
      small.height = Math.max(1, Math.round(canvas.height * k));
      const sctx = small.getContext('2d');
      if (!sctx) { resolve(null); return; }
      smoothScaling(sctx).drawImage(canvas, 0, 0, small.width, small.height);
      small.toBlob((b) => resolve(b), 'image/jpeg', 0.82);
    } catch {
      resolve(null);
    }
  });
}
