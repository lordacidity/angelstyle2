// The Pauv trade "screen recording", drawn here in the browser the way the
// ChatGPT one is (chatgpt-video.ts): every frame on a 1000×750 canvas from a
// fixed timeline, then WebCodecs (via mediabunny) into an H.264 MP4. Same
// inputs, same file, every time.
//
// ── This file is the source of truth for the trade recording ────────────────
// Studio > Trade renders one today, and it is the only caller. When the Vids
// and Simpler builders come to lay one in as a Bottom B, they render it from
// here too rather than taking a copy — the way all three already share
// chatgpt-video.ts. A change here is then a change to every one of them, which
// is the point.
//
// So the same rule holds as for chatgpt-video.ts: this file may NOT import
// from a caller's namespace — nothing from components/vids, components/simpler
// or lib/simpler — and what each caller does with the finished file (download
// it, file it, keep it in the tab) belongs to that caller, not in here.
//
// What is real, from Pauv (the MAIN Supabase project): the person's name,
// bio, photo, current price, holders, lifetime volume and the changes the
// site shows (1H/1D/1W/1M, /api/ai/talents), which way their price has gone
// since their first trade (/api/markets/batch-history), and the faces around
// them in the search grid. Holders, volume and every change are shown at
// ACTIVITY times Pauv's figure — the site is quieter than the clip should
// look — and the chart falls when the price is down overall. Everything else
// — the chart's path, the views count, the positions — is made up on the
// spot, seeded by the name so it never changes between renders.
//
// The script:
//   1. the homepage; the pointer wanders the hero, then goes for the search
//      pill and clicks it
//   2. the search opens; the full name types itself out; the grid fills with
//      them first and other faces after; the pointer circles their card and
//      clicks it
//   3. their page: the chart draws itself in
//   4. the pointer whips around the chart in frantic circles, with the site's
//      hover: the crosshair, the axis line and dot, the date at the top, the
//      price row following the point under it
//   5. the trade card: the pointer clicks the chosen way, the other, then the
//      chosen way again, clicks the amount, $10 types in, the fee
//      updates, Place trade
//   6. "Placing order..." while the pointer circles
//   7. the card flips green — Trade confirmed — holds, and the pointer leaves
//      out of the top
//
// Over all of that runs a camera (see "The camera"), and it moves exactly
// once: the frame is the whole page, still, until the trade card is reached,
// pushes in on it — and out past the page's right edge, so the card sits near
// the middle of the frame rather than three quarters across — and goes back
// out the moment the trade is confirmed. Nothing else is pushed in on. `zoom`
// says how far in it goes, and 'off' is the still frame throughout.
//
// The page is laid out in pauv.com's own CSS pixels, straight from
// pauv-the-app's components (its root font size is 90%, so 1rem is 14.4px:
// see REM), for a 1280px-wide viewport, and scaled to fill the frame — the
// reference screenshots are that same page at 80% zoom. Every number below
// that isn't derived is a prod value with its Tailwind class named beside it.
// The result goes back with its beats in clip seconds (TradeBeats) so a
// Bottom B made this way can be marked up like a hand-cut one.

import { withBase } from '@/lib/clipping';
import { safeExportName } from '@/lib/canvasVideoExport';
import { mixClicks, mixKeys, type ClickEvent } from '@/lib/clipSfx';
import { decodeAudio, SFX_URL } from '@/lib/vidsAudio';
import { DEFAULT_SFX_GAIN } from '@/lib/vidsEdit';
import { drawPointer, loadPointers, type PointerKind } from '@/lib/windowsCursor';

export const VIDEO_W = 1000;
export const VIDEO_H = 750;
const FPS = 30;
/** The trade is always this much. */
export const AMOUNT_USD = 10;
const AUTO_SPREAD = 0.05;
const TRADING_FEE_RATE = 0.0025;
/** Holders, volume and every change are shown at this multiple of Pauv's
 *  figure: the site is quieter today than the clip should look. */
export const ACTIVITY = 4;

/** pauv.com's rem: `html { font-size: 90% }` on a 16px default. */
const REM = 14.4;
const rem = (n: number) => n * REM;
/** The viewport the page is laid out for; the frame shows it whole. */
export const VIEWPORT_W = 1280;
const SCALE = VIDEO_W / VIEWPORT_W;
/** The pointer at half the ChatGPT clip's (windowsCursor POINTER_CELL). */
const POINTER_SIZE = 0.5;
const VIEW_H = VIDEO_H / SCALE;
/** Each homepage screenshot (public/pauv-home-{theme}.png), measured off the
 *  file itself: where the page's centred container starts, and how wide that
 *  container is. The two together say what scale the shot was taken at — 935
 *  across is the page's own 1170 at 80% zoom — so a shot lands with its
 *  container on ours whatever zoom or window width it was captured in, and a
 *  sharper recapture is simply a bigger span.
 *
 *  Both of these are 2x device pixels at 100% zoom (a 2339 span is the page's
 *  1170 doubled), so they carry more detail than the frame shows and land
 *  sharp. Re-measure after any recapture: scratchpad measure-shot.mjs prints
 *  both numbers. (A screenshot too narrow to cover the frame is scaled to the
 *  viewport instead.) */
const HOME_SHOT: Record<Theme, { x: number; span: number }> = {
  light: { x: 324, span: 2339 },
  dark: { x: 324, span: 2339 },
};

/** How hard the camera pushes in on what the hand is doing: 'off' is the
 *  still frame — the page whole, the whole way through — and the rest scale
 *  every zoom written into the track. */
export const ZOOM_LEVELS = { off: 0, subtle: 0.55, normal: 1, punchy: 1.45 } as const;
export type ZoomLevel = keyof typeof ZOOM_LEVELS;

export interface ClipOptions {
  /** Default 'off': a caller that says nothing gets the frame it always had. */
  zoom?: ZoomLevel;
}

export type Direction = 'up' | 'down';
export type Theme = 'light' | 'dark';

/** One person as /api/ai/talents returns them. */
export interface TradeTalent {
  id: string;
  ticker: string;
  name: string;
  bio: string | null;
  photo_url: string | null;
  industry: string | null;
  subcategory: string | null;
  location: string | null;
  listedAt: string | null;
  price: {
    usd: number | null;
    startUsd: number | null;
    lifetimeChangePct: number | null;
    holders: number | null;
    volumeLifetimeUsd: number | null;
    /** The changes as pauv.com shows them (market_overview()), in percent. */
    change1hPct?: number | null;
    change1dPct?: number | null;
    change1wPct?: number | null;
    change1mPct?: number | null;
    changeLifetimePct?: number | null;
  };
}

export interface TradeAssets {
  person: TradeTalent;
  /** The other faces in the search grid, in grid order. */
  others: TradeTalent[];
  photos: Map<string, HTMLImageElement>;
  /** The homepage screenshot for the theme (public/pauv-home-{theme}.png). */
  home: HTMLImageElement | null;
  /** True when the dark screenshot is missing and the light one stands in. */
  homeIsFallback: boolean;
  /** Where the page's container starts in `home` and how wide it is, in the
   *  screenshot's own pixels — see HOME_SHOT. */
  homeShot: { x: number; span: number };
  /** The site's wordmark (public/pauv-wordmark.png, pauv-the-app's pauv.png). */
  wordmark: HTMLImageElement | null;
  theme: Theme;
  /** From the price history (/api/markets/batch-history, all of it): the
   *  change since the first trade — which way the page is overall — and over
   *  the last 30 days; null without enough history. */
  history: HistoryChanges;
}

export interface Stretch { start: number; end: number }
/** The recording's four beats, in clip seconds, abutting and covering the
 *  whole clip: the search (homepage, typing, the grid) up to the click; the
 *  page and its chart up to the trade card being touched; the trade (the
 *  flips, the amount, Place trade); and the wait plus the confirmation. */
export interface TradeBeats { searching: Stretch; analyzing: Stretch; trading: Stretch; confirming: Stretch }
export interface TradeClip {
  draw: (t: number) => void;
  seconds: number;
  beats: TradeBeats;
  /** Every keystroke — the name's letters, then the amount's digits — on the
   *  frame its character appears. */
  keys: number[];
  /** Every time the mouse is pressed — see buildTradeAudio. */
  clicks: ClickEvent[];
}
export interface RenderResult { blob: Blob; filename: string; beats: TradeBeats; seconds: number }

// ── Theme: pauv-the-app lib/configs/theme.config.ts, light and dark ─────────
interface Palette {
  background: string; backgroundInverse: string; surface: string; surfaceRaised: string;
  text: string; textSecondary: string; secondary: string; muted: string; placeholder: string; disabled: string; textInverse: string; onAccent: string;
  border: string; borderStrong: string;
  positive: string; negative: string; chartGrid: string;
  /** The chart hover's axis line (`chart-axis`) and the ring on its dot
   *  (`text-primary` at half). */
  chartAxis: string; hoverRing: string;
  btnBg: string; btnText: string;
  /** The search modal's scrim: prod's token in dark, the reference's white
   *  frost in light (the screenshots), both over an 8px blur. */
  backdrop: string;
  /** The chart watermark: the wordmark greyed (`grayscale light:brightness-75`). */
  watermark: string;
}
const PALETTES: Record<Theme, Palette> = {
  light: {
    background: '#ffffff', backgroundInverse: '#0a0a0a', surface: '#ededed', surfaceRaised: '#ffffff',
    text: '#0a0a0a', textSecondary: '#52525b', secondary: '#52525b', muted: '#71717a', placeholder: '#a1a1aa', disabled: '#808080', textInverse: '#ffffff', onAccent: '#ffffff',
    border: '#d4d4d8', borderStrong: '#a1a1aa',
    positive: '#03c88c', negative: '#dc2626', chartGrid: '#e4e4e7',
    chartAxis: 'rgba(0,0,0,0.4)', hoverRing: 'rgba(10,10,10,0.5)',
    btnBg: '#0a0a0a', btnText: '#ffffff',
    backdrop: 'rgba(255,255,255,0.6)', watermark: '#969696',
  },
  dark: {
    background: '#0a0a0a', backgroundInverse: '#ffffff', surface: '#131313', surfaceRaised: '#18181b',
    text: '#ffffff', textSecondary: '#a1a1aa', secondary: '#808080', muted: '#71717a', placeholder: '#71717a', disabled: '#52525b', textInverse: '#000000', onAccent: '#ffffff',
    border: '#27272a', borderStrong: '#3f3f46',
    positive: '#04df9d', negative: '#FF4B4B', chartGrid: '#1e1e1e',
    chartAxis: 'rgba(255,255,255,0.4)', hoverRing: 'rgba(255,255,255,0.5)',
    btnBg: '#ffffff', btnText: '#000000',
    backdrop: 'rgba(0,0,0,0.85)', watermark: '#c8c8c8',
  },
};

// ── Fonts: the site's (Inter for text, JetBrains Mono for numbers) ──────────
const SANS = '"Inter", system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, Consolas, "Courier New", monospace';
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap';
const FONT_FACES = [
  '400 16px "Inter"', '500 16px "Inter"', '600 16px "Inter"', '700 16px "Inter"',
  '400 16px "JetBrains Mono"', '500 16px "JetBrains Mono"', '600 16px "JetBrains Mono"',
];
let fontsReady: Promise<void> | null = null;
/** The faces, usable on a canvas. The stylesheet has to be parsed before
 *  document.fonts.load can find the faces at all (asked too early it resolves
 *  at once with nothing, and the text gets measured in the fallback), so this
 *  waits for the link first. Once per page. */
export function loadFonts(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  if (!fontsReady) {
    fontsReady = (async () => {
      let link = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).find(l => l.href === FONT_HREF);
      const settled = (l: HTMLLinkElement) => new Promise<void>(res => {
        l.addEventListener('load', () => res(), { once: true });
        l.addEventListener('error', () => res(), { once: true });
        setTimeout(res, 6000);
      });
      if (!link) {
        link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = FONT_HREF;
        const done = settled(link);
        document.head.appendChild(link);
        await done;
      } else if (!link.sheet) {
        await settled(link);
      }
      await Promise.all(FONT_FACES.map(f => document.fonts.load(f))).catch(() => { /* fallback faces then */ });
    })();
  }
  return fontsReady;
}

// ── Small helpers ───────────────────────────────────────────────────────────
type Ctx = CanvasRenderingContext2D;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const easeOut = (u: number) => 1 - Math.pow(1 - clamp(u, 0, 1), 3);
const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

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

type Weight = 400 | 500 | 600 | 700;
/** A font plus its tracking, the way the site's classes pair them
 *  (`tracking-[-0.025em]` and friends). */
interface Font { css: string; track: number }
const sans = (size: number, weight: Weight = 400, trackEm = 0): Font => ({ css: `${weight} ${size}px ${SANS}`, track: size * trackEm });
const mono = (size: number, weight: Weight = 400, trackEm = 0): Font => ({ css: `${weight} ${size}px ${MONO}`, track: size * trackEm });

function setFont(ctx: Ctx, f: Font) {
  ctx.font = f.css;
  ctx.letterSpacing = `${f.track}px`;
}
function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number | number[]) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
function fillRR(ctx: Ctx, x: number, y: number, w: number, h: number, r: number | number[], fill: string) {
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}
// A 1px stroke drawn inside the box, like a CSS border.
function strokeRR(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, stroke: string, width = 1) {
  rr(ctx, x + width / 2, y + width / 2, w - width, h - width, Math.max(0, r - width / 2));
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
}
type Align = 'left' | 'center' | 'right';
function text(ctx: Ctx, s: string, x: number, y: number, f: Font, color: string, align: Align = 'left', baseline: CanvasTextBaseline = 'middle') {
  setFont(ctx, f);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(s, x, y);
  ctx.textAlign = 'left';
  ctx.letterSpacing = '0px';
}
function width(ctx: Ctx, s: string, f: Font) {
  setFont(ctx, f);
  const w = ctx.measureText(s).width;
  ctx.letterSpacing = '0px';
  return w;
}
// Greedy word wrap to `maxLines`; a cut line ends in an ellipsis.
function wrap(ctx: Ctx, s: string, f: Font, maxW: number, maxLines: number): string[] {
  setFont(ctx, f);
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxW || !line) {
      line = next;
    } else {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && lines.join(' ').length < s.trim().length) {
    let last = lines[maxLines - 1];
    while (last.length && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1).trimEnd();
    lines[maxLines - 1] = `${last}…`;
  }
  ctx.letterSpacing = '0px';
  return lines;
}
// A string cut to fit, with an ellipsis (CSS `truncate`).
function truncate(ctx: Ctx, s: string, f: Font, maxW: number) {
  setFont(ctx, f);
  let out = s;
  if (ctx.measureText(out).width > maxW) {
    while (out.length > 1 && ctx.measureText(`${out.trimEnd()}…`).width > maxW) out = out.slice(0, -1);
    out = `${out.trimEnd()}…`;
  }
  ctx.letterSpacing = '0px';
  return out;
}

// The site's TrendArrow: a filled triangle on a 24×18 box, apex up (rotated
// for down), drawn `size` wide.
function trendArrow(ctx: Ctx, cx: number, cy: number, size: number, up: boolean, color: string) {
  const k = size / 24;
  ctx.save();
  ctx.translate(cx, cy);
  if (!up) ctx.rotate(Math.PI);
  ctx.beginPath();
  ctx.moveTo(0, -9 * k);
  ctx.lineTo(10.392 * k, 5.25 * k);
  ctx.lineTo(-10.392 * k, 5.25 * k);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

// Line icons on a 24-box (lucide's), stroked and centred on (cx, cy) at `size`.
type IconPath = (c: Ctx) => void;
const ICONS: Record<string, IconPath> = {
  search: c => { c.moveTo(19, 11); c.arc(11, 11, 8, 0, Math.PI * 2); c.moveTo(21, 21); c.lineTo(16.65, 16.65); },
  chevronDown: c => { c.moveTo(6, 9); c.lineTo(12, 15); c.lineTo(18, 9); },
  arrowUp: c => { c.moveTo(12, 19); c.lineTo(12, 5); c.moveTo(5, 12); c.lineTo(12, 5); c.lineTo(19, 12); },
  arrowDown: c => { c.moveTo(12, 5); c.lineTo(12, 19); c.moveTo(19, 12); c.lineTo(12, 19); c.lineTo(5, 12); },
  arrowRight: c => { c.moveTo(5, 12); c.lineTo(19, 12); c.moveTo(12, 5); c.lineTo(19, 12); c.lineTo(12, 19); },
  users: c => {
    c.moveTo(13, 7); c.arc(9, 7, 4, 0, Math.PI * 2); c.moveTo(1, 21); c.lineTo(1, 19); c.arc(5, 19, 4, Math.PI, Math.PI * 1.5);
    c.lineTo(13, 15); c.arc(13, 19, 4, Math.PI * 1.5, 0); c.lineTo(17, 21);
    c.moveTo(16, 3.13); c.arc(17, 7, 4, -Math.PI / 2 - 0.25, Math.PI / 2 + 0.25); c.moveTo(21, 21); c.lineTo(21, 19); c.arc(19, 19, 3.5, 0, -Math.PI / 2, true);
  },
  share: c => {
    c.moveTo(20.5, 5); c.arc(18, 5, 2.5, 0, Math.PI * 2); c.moveTo(8.5, 12); c.arc(6, 12, 2.5, 0, Math.PI * 2); c.moveTo(20.5, 19); c.arc(18, 19, 2.5, 0, Math.PI * 2);
    c.moveTo(8.2, 10.8); c.lineTo(15.8, 6.3); c.moveTo(8.2, 13.2); c.lineTo(15.8, 17.7);
  },
  sun: c => {
    c.moveTo(16, 12); c.arc(12, 12, 4, 0, Math.PI * 2);
    for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; c.moveTo(12 + Math.cos(a) * 8, 12 + Math.sin(a) * 8); c.lineTo(12 + Math.cos(a) * 10, 12 + Math.sin(a) * 10); }
  },
  help: c => { c.moveTo(21, 12); c.arc(12, 12, 9, 0, Math.PI * 2); c.moveTo(9.5, 9.5); c.arc(12, 9.5, 2.5, Math.PI, 2.2 * Math.PI); c.lineTo(12, 13.5); c.moveTo(12, 16.5); c.lineTo(12, 17); },
  briefcase: c => { c.roundRect(2, 7, 20, 14, 2); c.moveTo(8, 7); c.lineTo(8, 4); c.lineTo(16, 4); c.lineTo(16, 7); c.moveTo(2, 13); c.lineTo(22, 13); },
  pin: c => { c.moveTo(15, 10); c.arc(12, 10, 3, 0, Math.PI * 2); c.moveTo(12, 22); c.lineTo(6.5, 15); c.arc(12, 10, 7, Math.PI * 0.8, Math.PI * 0.2, true); c.lineTo(12, 22); },
  tag: c => { c.moveTo(20.59, 13.41); c.lineTo(13.42, 20.6); c.lineTo(3, 11); c.lineTo(3, 3); c.lineTo(11, 3); c.lineTo(20.59, 12.59); c.closePath(); c.moveTo(9, 7.5); c.arc(7.5, 7.5, 1.5, 0, Math.PI * 2); },
  calendar: c => { c.roundRect(3, 4, 18, 18, 2); c.moveTo(3, 10); c.lineTo(21, 10); c.moveTo(8, 2); c.lineTo(8, 6); c.moveTo(16, 2); c.lineTo(16, 6); },
  globe: c => { c.moveTo(22, 12); c.arc(12, 12, 10, 0, Math.PI * 2); c.moveTo(2, 12); c.lineTo(22, 12); c.moveTo(12, 2); c.bezierCurveTo(16.5, 7, 16.5, 17, 12, 22); c.moveTo(12, 2); c.bezierCurveTo(7.5, 7, 7.5, 17, 12, 22); },
  eye: c => { c.moveTo(2, 12); c.bezierCurveTo(6, 5, 18, 5, 22, 12); c.bezierCurveTo(18, 19, 6, 19, 2, 12); c.moveTo(15, 12); c.arc(12, 12, 3, 0, Math.PI * 2); },
  plus: c => { c.moveTo(12, 5); c.lineTo(12, 19); c.moveTo(5, 12); c.lineTo(19, 12); },
  // A crescent: the r9 disc at (12,12) with an r9 disc at (17.5,6.5) taken
  // out of it, the two arcs meeting at the points where they cross.
  moon: c => { c.arc(12, 12, 9, 0.339, 4.374); c.arc(17.5, 6.5, 9, 3.481, 1.232, true); c.closePath(); },
};
function icon(ctx: Ctx, path: IconPath, cx: number, cy: number, size: number, color: string, lineWidth: number) {
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth * (24 / size);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  path(ctx);
  ctx.stroke();
  ctx.restore();
}
// The profile's social links, as the banner shows them: simple marks in
// pauv's shapes, `size` px, filled.
type Glyph = (c: Ctx, knock: string) => void;
const SOCIAL_GLYPHS: Glyph[] = [
  // Spotify: disc with three arcs.
  (c, k) => { c.arc(12, 12, 10, 0, Math.PI * 2); c.fill(); c.strokeStyle = k; for (const [r, w] of [[6.5, 1.6], [4.5, 1.4], [2.5, 1.2]] as const) { c.lineWidth = w; c.beginPath(); c.arc(12, 14.5, r, Math.PI * 1.15, Math.PI * 1.85); c.stroke(); } },
  // Apple Music: a note in a rounded square.
  (c, k) => { c.roundRect(2, 2, 20, 20, 5); c.fill(); c.fillStyle = k; c.beginPath(); c.arc(9, 16, 2.2, 0, Math.PI * 2); c.arc(15, 14.5, 2.2, 0, Math.PI * 2); c.fill(); c.fillRect(10.2, 6, 1.4, 10); c.fillRect(16.2, 5, 1.4, 9.5); c.fillRect(10.2, 6, 7.4, 1.6); },
  // X.
  c => { c.lineWidth = 2.4; c.lineCap = 'round'; c.moveTo(4, 4); c.lineTo(20, 20); c.moveTo(20, 4); c.lineTo(4, 20); c.stroke(); },
  // Instagram: rounded square, lens, dot.
  c => { c.lineWidth = 2; c.roundRect(3, 3, 18, 18, 5); c.stroke(); c.beginPath(); c.arc(12, 12, 4, 0, Math.PI * 2); c.stroke(); c.beginPath(); c.arc(17, 7, 1.2, 0, Math.PI * 2); c.fill(); },
  // TikTok: a note with a hooked head.
  c => { c.arc(9, 16.5, 4, 0, Math.PI * 2); c.fill(); c.fillRect(11, 3, 2.4, 14); c.beginPath(); c.moveTo(13.4, 3); c.bezierCurveTo(13.8, 7, 16.5, 9, 20, 9.3); c.lineTo(20, 12.3); c.bezierCurveTo(17, 12.2, 14.8, 11, 13.4, 9.5); c.closePath(); c.fill(); },
  // YouTube: rounded rect and a play triangle.
  (c, k) => { c.roundRect(2, 5, 20, 14, 4); c.fill(); c.fillStyle = k; c.beginPath(); c.moveTo(10, 8.5); c.lineTo(15.5, 12); c.lineTo(10, 15.5); c.closePath(); c.fill(); },
  // Facebook: disc with an f.
  (c, k) => { c.arc(12, 12, 10, 0, Math.PI * 2); c.fill(); c.fillStyle = k; c.fillRect(12.2, 8, 2.2, 14); c.fillRect(9.5, 10.5, 7, 2); c.beginPath(); c.arc(15.5, 8, 3.3, Math.PI, Math.PI * 1.5); c.lineTo(15.5, 6.5); c.arc(15.5, 8, 1.5, Math.PI * 1.5, Math.PI, true); c.fill(); },
  // LinkedIn: rounded square with "in".
  (c, k) => { c.roundRect(2, 2, 20, 20, 4); c.fill(); c.fillStyle = k; c.fillRect(6, 10, 2.4, 8); c.beginPath(); c.arc(7.2, 7, 1.4, 0, Math.PI * 2); c.fill(); c.fillRect(10.5, 10, 2.4, 8); c.fillRect(15.6, 13, 2.4, 5); c.beginPath(); c.arc(14.2, 13, 2.8, Math.PI, 0); c.fill(); c.fillRect(11.4, 13, 6.6, 1.5); },
  // Linktree: an asterisk.
  c => { c.lineWidth = 2.4; c.lineCap = 'round'; for (let i = 0; i < 3; i++) { const a = (i * Math.PI) / 3; c.moveTo(12 + Math.cos(a) * 8, 12 + Math.sin(a) * 8); c.lineTo(12 - Math.cos(a) * 8, 12 - Math.sin(a) * 8); } c.stroke(); },
  // Telegram: a paper plane.
  c => { c.moveTo(21, 3); c.lineTo(3, 11); c.lineTo(9.5, 13.5); c.lineTo(11.5, 20); c.lineTo(14.5, 15.5); c.lineTo(19, 18); c.closePath(); c.fill(); },
  // Threads: an @.
  c => { c.lineWidth = 2; c.arc(12, 12, 3.5, 0, Math.PI * 2); c.stroke(); c.beginPath(); c.arc(12, 12, 9, Math.PI * 0.25, Math.PI * 1.9); c.stroke(); c.beginPath(); c.moveTo(15.5, 12); c.lineTo(15.5, 14.5); c.arc(18, 14.5, 2.5, Math.PI, Math.PI * 1.5, false); c.stroke(); },
  // Twitch: a speech bubble with two eyes.
  (c, k) => { c.moveTo(4, 5); c.lineTo(6, 2); c.lineTo(21, 2); c.lineTo(21, 15); c.lineTo(16, 20); c.lineTo(12, 20); c.lineTo(9, 22); c.lineTo(9, 20); c.lineTo(4, 20); c.closePath(); c.fill(); c.fillStyle = k; c.fillRect(11, 7, 2, 6); c.fillRect(16, 7, 2, 6); },
  // Genius: a disc with a G.
  (c, k) => { c.arc(12, 12, 10, 0, Math.PI * 2); c.fill(); c.strokeStyle = k; c.lineWidth = 2.2; c.beginPath(); c.arc(12, 12, 5, -Math.PI * 0.25, Math.PI * 1.6); c.stroke(); c.fillStyle = k; c.fillRect(12, 11.5, 5.5, 2); },
  // SoundCloud: a cloud.
  c => { c.arc(8, 15, 4, Math.PI * 0.5, Math.PI * 1.5); c.arc(12, 10.5, 5, Math.PI * 1.05, Math.PI * 1.95); c.arc(17.5, 14, 4.2, Math.PI * 1.35, Math.PI * 0.5); c.closePath(); c.fill(); },
];
function glyph(ctx: Ctx, g: Glyph, cx: number, cy: number, size: number, color: string, alpha = 1, knock = '#fff') {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.beginPath();
  g(ctx, knock);
  ctx.restore();
}

// The wordmark (pauv.png's colours) as one flat colour, once per use.
function tint(img: HTMLImageElement, color: string, h: number): HTMLCanvasElement {
  const w = Math.max(1, Math.round((img.naturalWidth / img.naturalHeight) * h));
  const c = document.createElement('canvas');
  c.width = w * 2;
  c.height = h * 2;
  const x = c.getContext('2d')!;
  x.drawImage(img, 0, 0, c.width, c.height);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

// Cover-fit an image into a rect, clipped to rounded corners.
function drawCover(ctx: Ctx, img: HTMLImageElement | null, x: number, y: number, w: number, h: number, r: number | number[], fallback: string) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.clip();
  if (img) {
    const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * s;
    const dh = img.naturalHeight * s;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = fallback;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

// ── The sound ───────────────────────────────────────────────────────────────
/** The app's own rate for these beds, so this clip and the ChatGPT one mix
 *  without resampling (lib/clipSfx). */
export const AUDIO_RATE = 44100;
/** The clip's whole sound in one buffer: a keystroke from the shared keyboard
 *  recording on every character, and the mouse on every press. The same
 *  buffer the preview plays and the file carries. */
export async function buildTradeAudio(clip: Pick<TradeClip, 'seconds' | 'keys' | 'clicks'>, seed: string): Promise<AudioBuffer> {
  const length = Math.ceil(clip.seconds * AUDIO_RATE);
  const octx = new OfflineAudioContext(2, length, AUDIO_RATE);
  const sample = await decodeAudio(octx, SFX_URL);
  const bed = octx.createBuffer(2, length, AUDIO_RATE);
  mixKeys(bed, sample, clip.keys, hashStr(seed), DEFAULT_SFX_GAIN);
  mixClicks(bed, clip.clicks, hashStr(seed));
  return bed;
}

// ── Numbers, the site's way (lib/utils/format.ts, index.ts) ─────────────────
// SXPriceChart.pickPriceDecimals: enough places to resolve the band drawn.
function priceDecimals(value: number, range?: number) {
  const v = Math.abs(value);
  const r = range != null ? Math.abs(range) : v;
  let d = 2;
  if (r > 0) d = Math.min(12, Math.max(2, Math.ceil(-Math.log10(r)) + 2));
  if (v > 0 && v < 1) d = Math.max(d, 4);
  return d;
}
// npsiDisplayDecimals: 2 places from $1 (3 under it, 4 under 10¢, and so
// on), and three more while the chart is being scrolled.
function npsiDecimals(v: number, scrolling = false) {
  const p = Math.abs(v);
  const base = !(p > 0) || p >= 1 ? 2 : 2 - Math.floor(Math.log10(p));
  return Math.min(12, base + (scrolling ? 3 : 0));
}
// smallValueDecimals: a sub-0.01 move keeps enough places to show.
function smallDecimals(v: number) {
  const a = Math.abs(v);
  if (!(a > 0) || a >= 0.01) return 2;
  return Math.min(12, Math.max(2, Math.ceil(-Math.log10(a)) + 2));
}
const fmtChart = (v: number, range?: number) => v.toFixed(priceDecimals(v, range));
const fmtNpsi = (v: number, d = 2) => `$${v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const fmtVolume = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(2)}K` : v.toFixed(2));
const fmtGridVolume = (v: number) => (v >= 1e9 ? `Vol. $${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `Vol. $${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `Vol. $${(v / 1e3).toFixed(1)}K` : `Vol. $${v.toFixed(0)}`);
const fmtPct = (p: number) => `${Math.abs(p).toFixed(smallDecimals(p))}%`;
const fmtMoney = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pad2 = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
// formatChartLabel: the hovered point's date, "SEP 4, 3:07 PM".
function fmtChartLabel(ms: number) {
  const d = new Date(ms);
  const h = d.getHours();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${h % 12 || 12}:${pad2(d.getMinutes())} ${h >= 12 ? 'PM' : 'AM'}`;
}

// ── The people: who to show, and what to say about them ─────────────────────
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The roster entry a typed name means: an exact name first, then a name
 *  starting with it, then one containing every word of it, then one
 *  containing it; the better-held of equals. Null when nothing fits. */
export function matchTalent(roster: readonly TradeTalent[], name: string): TradeTalent | null {
  const q = norm(name);
  if (!q) return null;
  const words = q.split(' ');
  let best: { t: TradeTalent; score: number } | null = null;
  for (const t of roster) {
    const n = norm(t.name);
    let score: number;
    if (n === q) score = 0;
    else if (n.startsWith(q)) score = 1;
    else if (words.every(w => n.includes(w))) score = 2;
    else if (n.includes(q)) score = 3;
    else continue;
    const holders = t.price.holders ?? 0;
    if (!best || score < best.score || (score === best.score && holders > (best.t.price.holders ?? 0))) best = { t, score };
  }
  return best?.t ?? null;
}

// The other faces in the grid: names that start the way the typed one does,
// then anyone with a photo, in a seeded order.
function pickOthers(roster: readonly TradeTalent[], person: TradeTalent, n: number): TradeTalent[] {
  const rnd = mulberry32(hashStr(person.name) ^ 0x5bd1e995);
  const shuffle = <T,>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const withPhoto = roster.filter(t => t.id !== person.id && t.photo_url);
  const first2 = norm(person.name).slice(0, 2);
  const alike = shuffle(withPhoto.filter(t => norm(t.name).startsWith(first2) || norm(t.name).split(' ').some(w => w.startsWith(first2))));
  const rest = shuffle(withPhoto.filter(t => !alike.includes(t)));
  return [...alike, ...rest].slice(0, n);
}

/** The page's figures beyond the price: Pauv's where it has them, at
 *  ACTIVITY, and made up (seeded by the name) where it doesn't. */
interface Invented {
  views: number;
  holders: number;
  volume: number;
  change1h: number;
  change24h: number;
  change7d: number;
  socials: number;
  positions: { dir: Direction; paid: number; fee: number; date: string; entry: number; worth: number }[];
}
function invent(person: TradeTalent): Invented {
  const rnd = mulberry32(hashStr(person.name) ^ 0x9e3779b9);
  // The flicker a market that has not traded gets: a tenth of a percent or
  // so, before ACTIVITY. Pauv's own zeros would otherwise print a row of
  // 0.00% and the page would look shut rather than quiet.
  const small = () => (rnd() - 0.35) * 0.04;
  // Pauv's own figure when it has moved, else a seeded flicker — a market
  // that has not traded this hour reports a flat 0, and a row of 0.00% reads
  // as a dead page rather than a quiet one.
  const change = (sitePct: number | null | undefined, fallback: number) => (sitePct != null && sitePct !== 0 ? sitePct : fallback) * ACTIVITY;
  const now = Date.now();
  const stamp = (daysAgo: number) => {
    const d = new Date(now - daysAgo * 864e5);
    return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };
  const paidA = Math.round((2 + rnd() * 18) * 100) / 100;
  const paidB = Math.round((1 + rnd() * 9) * 100) / 100;
  const price = person.price.usd ?? 1;
  // A position is worth what the price has done since it was opened: a few
  // percent either way, seeded, so the P&L column carries something.
  const leg = (dir: Direction, paid: number, daysAgo: number) => {
    const move = (rnd() - 0.42) * 0.09;
    const worth = Math.round(paid * (1 + (dir === 'up' ? move : -move)) * 100) / 100;
    return { dir, paid, fee: Math.round(paid * TRADING_FEE_RATE * 100) / 100, date: stamp(daysAgo), entry: price / (1 + move), worth };
  };
  return {
    views: 180 + Math.floor(rnd() * 5200),
    holders: (person.price.holders ?? 3 + Math.floor(rnd() * 60)) * ACTIVITY,
    volume: (person.price.volumeLifetimeUsd ?? Math.round((40 + rnd() * 3000) * 100) / 100) * ACTIVITY,
    change1h: change(person.price.change1hPct, small()),
    change24h: change(person.price.change1dPct, small() * 1.6),
    change7d: change(person.price.change1wPct, small() * 3),
    socials: 10 + Math.floor(rnd() * 5),
    positions: [
      leg(rnd() < 0.5 ? 'down' : 'up', paidA, 2 + rnd() * 6),
      leg(rnd() < 0.5 ? 'up' : 'down', paidB, 9 + rnd() * 14),
    ],
  };
}

// A month of price, the way Pauv charts look: long flat runs and jumps (a
// price only moves on a trade), from the price the change implies to the
// price now. Seeded by the name.
function makeSeries(person: TradeTalent, p1: number, pct: number, n = 110, salt = 0): number[] {
  const rnd = mulberry32(hashStr(person.name) ^ 0x27d4eb2f ^ salt);
  const p0 = p1 / (1 + pct / 100);
  const move = Math.max(Math.abs(p1 - p0), p1 * 0.012);
  const sigma = move / Math.sqrt(n * 0.32);
  const raw: number[] = [p0];
  for (let i = 1; i < n; i++) {
    const prev = raw[i - 1];
    let v = prev;
    if (rnd() < 0.32) {
      const g = (rnd() + rnd() + rnd() + rnd() - 2) * 1.7;
      v = prev + g * sigma * (0.4 + 1.4 * rnd());
    }
    raw.push(v);
  }
  const dStart = p0 - raw[0];
  const dEnd = p1 - raw[n - 1];
  return raw.map((v, i) => Math.max(p1 * 0.05, v + dStart * (1 - i / (n - 1)) + dEnd * (i / (n - 1))));
}

// ── Assets ──────────────────────────────────────────────────────────────────
function loadImage(src: string, cors: boolean): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = withBase(src);
  });
}
const proxied = (url: string) => withBase(`/api/charts/image-proxy?url=${encodeURIComponent(url)}`);

// The changes the price history gives: since the first trade (the way the
// page is overall) and over the last 30 days; null when the history is
// missing or too thin to say.
export interface HistoryChanges { lifetimePct: number | null; monthPct: number | null }
async function loadHistoryChanges(ticker: string, signal?: AbortSignal): Promise<HistoryChanges> {
  const none: HistoryChanges = { lifetimePct: null, monthPct: null };
  try {
    const r = await fetch(withBase(`/api/markets/batch-history?slugs=${encodeURIComponent(ticker)}&window=all`), { signal });
    if (!r.ok) return none;
    const data = await r.json() as Record<string, { price: number; timestamp: string }[]>;
    const pts = (data[ticker] ?? []).filter(p => p.price > 0);
    if (pts.length < 2) return none;
    const last = pts[pts.length - 1];
    const since = Date.now() - 30 * 864e5;
    const monthStart = pts.find(p => new Date(p.timestamp).getTime() >= since);
    const pct = (from: number) => ((last.price - from) / from) * 100;
    return { lifetimePct: pct(pts[0].price), monthPct: monthStart && monthStart !== last ? pct(monthStart.price) : null };
  } catch {
    return none;
  }
}

const GRID_COUNT = 15;

/** The roster, the person the name means, the faces around them, their
 *  photos, the homepage screenshot for the theme, the wordmark, the fonts, the
 *  pointer. */
export async function loadTradeAssets(name: string, theme: Theme, signal?: AbortSignal): Promise<TradeAssets> {
  const r = await fetch(withBase('/api/ai/talents'), { signal });
  const data = await r.json().catch(() => null) as TradeTalent[] | { error?: string } | null;
  if (!r.ok || !Array.isArray(data)) throw new Error((data && !Array.isArray(data) && data.error) || `Pauv roster: HTTP ${r.status}`);
  const person = matchTalent(data, name);
  if (!person) throw new Error(`No one on Pauv matches "${name.trim()}".`);
  if (person.price.usd == null) throw new Error(`${person.name} has no price on Pauv yet.`);
  const others = pickOthers(data, person, GRID_COUNT - 1);

  const faces = [person, ...others];
  const [photoList, home, homeLight, wordmark, history] = await Promise.all([
    Promise.all(faces.map(t => (t.photo_url ? loadImage(proxied(t.photo_url), true) : Promise.resolve(null)))),
    loadImage(`/pauv-home-${theme}.png`, false),
    theme === 'dark' ? loadImage('/pauv-home-light.png', false) : Promise.resolve(null),
    loadImage('/pauv-wordmark.png', false),
    loadHistoryChanges(person.ticker, signal),
    loadFonts(),
    loadPointers(),
  ]);
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const photos = new Map<string, HTMLImageElement>();
  faces.forEach((t, i) => { const img = photoList[i]; if (img) photos.set(t.ticker, img); });
  const fallback = !home && !!homeLight;
  return {
    person, others, photos,
    home: home ?? homeLight,
    homeIsFallback: fallback,
    homeShot: HOME_SHOT[fallback ? 'light' : theme],
    wordmark, theme, history,
  };
}

// ── The clip ────────────────────────────────────────────────────────────────
export function createTradeClip(ctx: Ctx, a: TradeAssets, direction: Direction, o: ClipOptions = {}): TradeClip {
  const ZOOM = ZOOM_LEVELS[o.zoom ?? 'off'];
  const P = PALETTES[a.theme];
  const person = a.person;
  const price = person.price.usd ?? 1;
  // The 1M change: the site's own figure when it has one, else the price
  // history's, else a tiny seeded move. Its way is the way the page is
  // overall — the change since the first trade (down overall reads down;
  // flat counts as up) — and it is never quite flat, so that shows.
  const sitePct = person.price.change1mPct ?? null;
  const monthPct = (sitePct != null && sitePct !== 0 ? sitePct : null) ?? a.history.monthPct ?? (mulberry32(hashStr(person.ticker))() - 0.45) * 0.4;
  const overall = a.history.lifetimePct ?? person.price.changeLifetimePct ?? monthPct;
  const changePct = (overall < 0 ? -1 : 1) * Math.max(Math.abs(monthPct), 0.005) * ACTIVITY;
  const inv = invent(person);
  const series = makeSeries(person, price, changePct);
  const firstName = person.name.trim().split(/\s+/)[0] || person.name;

  // ── Timeline ──────────────────────────────────────────────────────────────
  const typed = person.name.trim();
  // The pointer wanders the homepage, then clicks the search pill.
  const T_HOME_LOOP: [number, number] = [0.2, 1.3];
  const T_SEARCH = 1.65;
  const T_TYPE = T_SEARCH + 0.5;
  const typeDur = clamp(typed.length * 0.075, 0.6, 1.6);
  const T_TYPED = T_TYPE + typeDur;
  // It circles their card, then clicks it.
  const T_CARD_LOOP: [number, number] = [T_TYPED + 0.3, T_TYPED + 1.2];
  const T_PICK = T_TYPED + 1.45;
  // The analysis — their page up to the trade card — and the trade — the
  // flips, the amount, Place trade — each run ANALYZE_PACE / TRADE_PACE times
  // their old length: every moment in them sits that much further from the
  // start of its beat. The loops are laps a second, so the whip over the chart
  // runs longer at the same frenzy rather than slower. Everything heard and
  // captioned follows by itself: the keys, the clicks and the beats are all
  // read off these times.
  const ANALYZE_PACE = 1.5;
  const TRADE_PACE = 1.5;
  const ana = (s: number) => T_PICK + s * ANALYZE_PACE;
  const T_CHART: [number, number] = [ana(0.15), ana(1.05)];
  // A frantic whip of circles over the chart, then straight to the toggle.
  const T_CHART_LOOP: [number, number] = [ana(0.95), ana(2.15)];
  const T_TRADE = ana(2.55);
  const trd = (s: number) => s * TRADE_PACE;
  // Three presses: the chosen way, the other, the chosen way again.
  const FLIP_GAP = trd(0.45);
  const flipOrder: Direction[] = direction === 'down' ? ['down', 'up', 'down'] : ['up', 'down', 'up'];
  const flips = flipOrder.map((to, i) => ({ t: T_TRADE + i * FLIP_GAP, to }));
  const T_LAST_FLIP = flips[flips.length - 1].t;
  // It clicks the amount, $10 types in, it clicks Place trade.
  const T_AMOUNT_CLICK = T_LAST_FLIP + trd(0.5);
  const T_AMOUNT = T_AMOUNT_CLICK + trd(0.25);
  const amountAt = [T_AMOUNT, T_AMOUNT + trd(0.2)];
  const T_PLACE = T_AMOUNT + trd(1.0);
  const T_CONFIRM = T_PLACE + 1.2;
  // It circles while the order places, rests, and leaves out of the top.
  const T_WAIT: [number, number] = [T_PLACE + 0.12, T_CONFIRM + 0.1];
  const T_EXIT: [number, number] = [T_CONFIRM + 1.5, T_CONFIRM + 2.05];
  const seconds = Math.ceil((T_CONFIRM + 2.5) * FPS) / FPS;
  const beats: TradeBeats = {
    searching: { start: 0, end: T_PICK },
    analyzing: { start: T_PICK, end: T_TRADE },
    trading: { start: T_TRADE, end: T_PLACE },
    confirming: { start: T_PLACE, end: seconds },
  };

  // When each typed character lands: a human rhythm, scaled to typeDur.
  const rnd = mulberry32(hashStr(typed));
  const weights = Array.from(typed, (_, i) => 1 + rnd() * 1.2 + (typed[i - 1] === ' ' ? 0.6 : 0));
  const weightSum = weights.reduce((s, w) => s + w, 0) || 1;
  const charAt: number[] = [];
  let acc = 0;
  for (const w of weights) { acc += w; charAt.push(T_TYPE + typeDur * (acc / weightSum)); }
  const typedCount = (t: number) => { let n = 0; while (n < charAt.length && charAt[n] <= t) n++; return n; };
  const T_FIRST_CHAR = charAt[0] ?? T_TYPE;
  const T_RESULTS = T_FIRST_CHAR + 0.45;
  // What is heard: a key on every character of the name and the amount, and a
  // click on everything the pointer presses — the search, their card, each
  // flip of the toggle, the amount field, and Place trade. Each lands on the
  // first frame that shows it, never a few ms ahead of the picture.
  const onFrame = (t: number) => Math.ceil(t * FPS - 1e-6) / FPS;
  const keystrokes = [...charAt, ...amountAt].map(onFrame);
  const clicks: ClickEvent[] = [
    T_SEARCH, T_PICK, ...flips.map(f => f.t), T_AMOUNT_CLICK, T_PLACE,
  ].map(t => ({ t: onFrame(t), kind: 'full' as const }));

  // ── Page geometry (pauv.com CSS px) ───────────────────────────────────────
  // ProfileClient: `mx-auto max-w-[81.25rem]`; left column `flex-1 md:pr-6`;
  // right rail `width: 23.75rem; paddingLeft: 1rem`. The header shares the
  // container (SXHeader `max-w-[81.25rem]`).
  const CONTAINER_W = rem(81.25);
  // Centred would be 55; the page as captured sits 65 in (its scrollbar
  // narrows the viewport the container centres in).
  const PAGE_L = 65;
  const PAGE_R = PAGE_L + CONTAINER_W;
  const RAIL_W = rem(23.75);
  const LEFT_W = CONTAINER_W - RAIL_W - rem(1.5);
  const LCOL: [number, number] = [PAGE_L, PAGE_L + LEFT_W];
  const PANEL_X = PAGE_R - RAIL_W + rem(1);
  const PANEL_W = RAIL_W - rem(1);
  // Header: `pt-4 pb-1.5` around the 36px row (h-9 avatar), as the page shows it.
  const HEADER_H = rem(1) + rem(2.25) + rem(0.375);
  // Its right side, from the container edge in: the avatar (h-9), `gap-5`,
  // the theme toggle (a 2.25rem button), `gap-4`, the search pill.
  const avR = rem(2.25) / 2;
  const sunCX = PAGE_R - rem(2.25) - rem(1.25) - rem(1.125) + rem(0.375);
  const searchPill = (() => {
    const right = PAGE_R - rem(2.25) - rem(1.25) - (rem(2.25) - rem(0.75) + rem(1));
    const w = rem(17.75);
    const h = rem(0.4375) * 2 + rem(0.875) * 1.375 + 2;
    return { x: right - w, y: HEADER_H / 2 - h / 2, w, h };
  })();

  // ── Precomputed pieces ────────────────────────────────────────────────────
  const logoH = a.wordmark ? rem(3.5) * (a.wordmark.naturalHeight / a.wordmark.naturalWidth) : rem(1);
  const wordmarkText = a.wordmark ? tint(a.wordmark, P.text, logoH) : null;
  const wordmarkMark = a.wordmark ? tint(a.wordmark, P.watermark, rem(1.125)) : null;

  // The homepage: the screenshot drawn at the zoom it was taken at, its
  // container on ours; a screenshot no wider than the viewport is scaled to it.
  const drawHomeImage = (c: Ctx) => {
    c.fillStyle = P.background;
    c.fillRect(0, 0, VIEWPORT_W, VIEW_H);
    const img = a.home;
    if (img) {
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      const k = CONTAINER_W / a.homeShot.span;
      if (img.naturalWidth * k >= VIEWPORT_W) c.drawImage(img, PAGE_L - a.homeShot.x * k, 0, img.naturalWidth * k, img.naturalHeight * k);
      else c.drawImage(img, 0, 0, VIEWPORT_W, (img.naturalHeight / img.naturalWidth) * VIEWPORT_W);
      if (a.homeIsFallback) { c.fillStyle = 'rgba(10,10,10,0.86)'; c.fillRect(0, 0, VIEWPORT_W, VIEW_H); }
    }
  };
  // ...and frosted under the search (`backdropFilter: blur(8px)` + the
  // scrim), made once at frame size.
  const blurred = (() => {
    const c = document.createElement('canvas');
    c.width = VIDEO_W;
    c.height = VIDEO_H;
    const x = c.getContext('2d')!;
    x.scale(SCALE, SCALE);
    drawHomeImage(x);
    const b = document.createElement('canvas');
    b.width = c.width;
    b.height = c.height;
    const y = b.getContext('2d')!;
    y.fillStyle = P.background;
    y.fillRect(0, 0, b.width, b.height);
    y.filter = `blur(${8 * SCALE}px)`;
    y.drawImage(c, -12, -12, b.width + 24, b.height + 24);
    y.filter = 'none';
    y.fillStyle = P.backdrop;
    y.fillRect(0, 0, b.width, b.height);
    return b;
  })();

  // SXProfileBanner: `rounded-2xl border`; photo column `flex-[0_0_21%]`
  // square, the image inset `1rem 0 1rem 1rem` at `borderRadius 0.75rem`;
  // body `p-4 gap-1`: headline (1.5rem/1.2 semibold), `mb-2`, bio (text-xs,
  // leading-relaxed, three lines), then `mt-auto` socials (gap-3) and chips.
  const card = { x: LCOL[0], y: HEADER_H + rem(1), w: LEFT_W, h: 0 };
  card.h = Math.round(card.w * 0.21);
  const photo = { x: card.x + rem(1), y: card.y + rem(1), w: card.h - rem(1), h: card.h - rem(2), r: rem(0.75) };
  const bodyX = card.x + card.h + rem(1);
  const bodyW = card.x + card.w - rem(1) - bodyX;
  const HEADLINE = sans(rem(1.5), 600, -0.02);
  const HEADLINE_LH = rem(1.5) * 1.2;
  const BIO = sans(rem(0.75), 400, -0.025);
  const BIO_LH = rem(0.75) * 1.625;
  const bioLines = wrap(ctx, (person.bio ?? '').trim() || `${person.name} on Pauv.`, BIO, bodyW, 3);
  const headlineY = card.y + rem(1) + HEADLINE_LH / 2;
  const bioY = card.y + rem(1) + HEADLINE_LH + rem(0.5);
  const CHIP_H = rem(0.25) * 2 + rem(0.75) * 1.5;
  const chipsCY = card.y + card.h - rem(1) - CHIP_H / 2;
  const socialsCY = chipsCY - CHIP_H / 2 - rem(0.75) - 7.5;
  const listedYear = person.listedAt ? String(new Date(person.listedAt).getFullYear()) : null;
  const chips: { icon: IconPath; label: string }[] = [];
  if (person.industry) chips.push({ icon: ICONS.briefcase, label: person.industry });
  if (person.location) chips.push({ icon: ICONS.pin, label: person.location });
  if (person.subcategory) chips.push({ icon: ICONS.tag, label: person.subcategory });
  if (listedYear) chips.push({ icon: ICONS.calendar, label: listedYear });
  chips.push({ icon: ICONS.globe, label: 'English' });
  chips.push({ icon: ICONS.eye, label: `${inv.views.toLocaleString('en-US')} views` });
  const CHIP = sans(rem(0.75), 400, -0.025);

  // SXProfileHeader: `pt-4 … pb-8`, price row (AnimatedPrice 24px) on the
  // left, share and LIVE stacked on the right — the taller of the two.
  const ph = { top: card.y + card.h + rem(1) };
  const priceCY = ph.top + rem(1) + 24 * 1.2 / 2;
  const shareCY = ph.top + rem(1) + rem(1.125) / 2 + rem(0.375);
  const liveCY = ph.top + rem(1) + rem(1.125) + rem(0.75) * 2 + rem(0.5) / 2;
  const phBottom = ph.top + rem(1) + rem(1.125) + rem(0.75) * 2 + rem(0.5) + rem(0.75) + rem(2);

  // SXPriceChart: CHART_H 280, V_PAD 40/56, FUTURE_PAD 56; gridlines at
  // quarters with their prices at the right edge; dates `bottom-1.5`.
  const chart = { x: LCOL[0], y: phBottom, w: LEFT_W, h: 280, padT: 40, padB: 56, plotW: LEFT_W - 56 };
  const plotH = chart.h - chart.padT - chart.padB;
  const now = Date.now();
  // The site's chart hover: the pointer's x, the last point at or before it.
  interface Hover { x: number; y: number; price: number; ts: number }
  // One period's chart: its own scale, its own dates, and its own colour —
  // the site reads the line's direction over the period it is showing.
  interface ChartView {
    period: string; series: number[]; days: number;
    pts: { x: number; y: number }[]; min: number; range: number; first: number;
    color: string; labels: { x: number; label: string; align: Align }[];
  }
  function buildView(period: string, s: number[], days: number): ChartView {
    const min = Math.min(...s);
    const max = Math.max(...s);
    const range = max === min ? 1 : max - min;
    const pts = s.map((v, i) => ({
      x: chart.x + (i / (s.length - 1)) * chart.plotW,
      y: chart.y + chart.padT + (1 - (v - min) / range) * plotH,
    }));
    const labels = [0, 0.25, 0.5, 0.75, 1].map(f => {
      const d = new Date(now - (1 - f) * days * 864e5);
      return { x: chart.x + f * chart.plotW, label: `${d.getMonth() + 1}/${d.getDate()}`, align: (f === 0 ? 'left' : f === 1 ? 'right' : 'center') as Align };
    });
    return { period, series: s, days, pts, min, range, first: s[0], color: s[s.length - 1] >= s[0] ? P.positive : P.negative, labels };
  }
  const VIEW_M = buildView('1M', series, 30);
  // Controls row `pt-6 pb-4`: the period tabs (body3) and the watermark.
  const tabsCY = chart.y + chart.h + rem(1.5) + (rem(0.75) * 1.5 + rem(0.25)) / 2;
  const TAB_F = sans(rem(0.75));
  const TABS = (() => {
    let x = LCOL[0];
    return ['1D', '1W', '1M', 'ALL'].map(label => {
      const w = width(ctx, label, TAB_F);
      const tab = { label, x, w };
      x += w + rem(1.5);
      return tab;
    });
  })();
  const TABS_HIT = { x: LCOL[0] - rem(0.5), y: tabsCY - rem(0.75), w: TABS[3].x + TABS[3].w - LCOL[0] + rem(1), h: rem(1.5) };
  const chartBottom = chart.y + chart.h + rem(1.5) + rem(0.75) * 1.5 + rem(0.25) + rem(1);

  // SXMarketStatsRow inside `border-t border-b py-6`: five columns `gap-x-6`,
  // each a body3 label over a body2Semibold mono value, `gap-1`.
  const stats = { y: chartBottom, h: rem(1.5) * 2 + rem(0.75) * 1.5 + rem(0.25) + rem(0.875) * 1.5 };
  const statLabelCY = stats.y + rem(1.5) + (rem(0.75) * 1.5) / 2;
  const statValueCY = stats.y + rem(1.5) + rem(0.75) * 1.5 + rem(0.25) + (rem(0.875) * 1.5) / 2;
  const statColW = (LEFT_W - 4 * rem(1.5)) / 5;

  // SXOpenPosition: `pt-6`, "Positions" `mb-4`, "Open (n)" body3 `mb-2`, a
  // `border-t` table with `h-8` uppercase headers and `py-3` body3 rows.
  const pos = { y: stats.y + stats.h };
  const posTitleCY = pos.y + rem(1.5) + (rem(1) * 1.5) / 2;
  const posOpenCY = pos.y + rem(1.5) + rem(1) * 1.5 + rem(1) + (rem(0.75) * 1.5) / 2;
  const tableY = pos.y + rem(1.5) + rem(1) * 1.5 + rem(1) + rem(0.75) * 1.5 + rem(0.5);
  const tableHeadCY = tableY + rem(2) / 2;
  const ROW_H = rem(0.75) * 2 + rem(0.75) * 1.5;
  const rowCY = (i: number) => tableY + rem(2) + ROW_H * i + ROW_H / 2;
  // Column right edges, read off the page.
  const posCols: { label: string; x: number; align: Align }[] = [
    { label: 'DIRECTION', x: LCOL[0] + rem(1), align: 'left' },
    { label: 'PRICE AT ENTRY', x: LCOL[0] + 194, align: 'right' },
    { label: 'PAID', x: LCOL[0] + 284, align: 'right' },
    { label: 'FEES', x: LCOL[0] + 354, align: 'right' },
    { label: 'WORTH NOW', x: LCOL[0] + 456, align: 'right' },
    { label: 'P&L', x: LCOL[0] + 567, align: 'right' },
    { label: 'DATE', x: LCOL[0] + 677, align: 'right' },
  ];

  // SXTradingPanel: `rounded-2xl bg-surface p-5 mt-4`, a flow — headline,
  // toggle (`pt-3 pb-5`, track `p-1` + 1px border, buttons `py-3` at
  // 0.875rem), amount row, `mt-6 pt-5 border-t space-y-3` rows, `mt-6 py-3`
  // button — its height from the headline's line count.
  const tc = { x: PANEL_X, y: HEADER_H + rem(1), w: PANEL_W, pad: rem(1.25), h: 0 };
  const tcInnerX = tc.x + tc.pad;
  const tcInnerW = tc.w - 2 * tc.pad;
  const headline = (dir: Direction) => wrap(ctx, `I think ${firstName}'s relevance will go ${dir}`, HEADLINE, tcInnerW, 3);
  const headlineLines = Math.max(headline('up').length, headline('down').length);
  const TOGGLE_BTN_H = rem(0.75) * 2 + rem(0.875) * 1.5;
  const toggle = { y: tc.y + tc.pad + headlineLines * HEADLINE_LH + rem(0.75), h: TOGGLE_BTN_H + rem(0.25) * 2 + 2 };
  const tr = { x: tcInnerX, y: toggle.y, w: tcInnerW, h: toggle.h };
  const inner = { x: tr.x + 1 + rem(0.25), y: tr.y + 1 + rem(0.25), w: tr.w - 2 - rem(0.5), h: tr.h - 2 - rem(0.5) };
  const AMOUNT_ROW_H = rem(2.5) * 1.2;
  const amountCY = toggle.y + toggle.h + rem(1.25) + AMOUNT_ROW_H / 2;
  const dividerY = amountCY + AMOUNT_ROW_H / 2 + rem(1.5);
  const ROW_LH = rem(0.75) * 1.5;
  const rowsCY = [0, 1, 2].map(i => dividerY + 1 + rem(1.25) + ROW_LH / 2 + i * (ROW_LH + rem(0.75)));
  const btn = { y: rowsCY[2] + ROW_LH / 2 + rem(1.5), h: rem(0.75) * 2 + rem(1) * 1.5 };
  tc.h = btn.y + btn.h + tc.pad - tc.y;
  // The outlined "How it works" under the card, as the page shows it.
  const how = { y: tc.y + tc.h + 10, h: 37.5 };

  // ── Scenes ────────────────────────────────────────────────────────────────
  // SXHeader: logo `w-14`, nav `gap-8` at 0.8125rem; the balance and Add
  // funds pill centred; search pill `w-[17.75rem]`, theme toggle, avatar `h-9`.
  function drawHeader() {
    const cy = HEADER_H / 2;
    ctx.fillStyle = P.background;
    ctx.fillRect(0, 0, VIEWPORT_W, HEADER_H);
    if (wordmarkText) ctx.drawImage(wordmarkText, PAGE_L, cy - logoH / 2 + rem(0.125), rem(3.5), logoH);
    const NAV = sans(rem(0.8125), 400, -0.025);
    let x = PAGE_L + rem(3.5) + rem(2);
    for (const item of ['Trade', 'About Us', 'How it works']) {
      text(ctx, item, x, cy, NAV, P.text);
      x += width(ctx, item, NAV) + rem(2);
    }
    // Centre: balance, `gap-3`, the pill (`px-3 py-2.5`, Plus 13, label 0.8125rem semibold).
    const BAL = sans(rem(0.8125), 500, -0.02);
    const LABEL = sans(rem(0.8125), 600, -0.02);
    const balW = width(ctx, '$557.83', BAL);
    const pillW = rem(0.75) * 2 + 13 - rem(0.125) + rem(0.25) + width(ctx, 'Add funds', LABEL);
    const pillH = rem(0.625) * 2 + rem(0.8125);
    const cx0 = VIEWPORT_W / 2 - (balW + rem(0.75) + pillW) / 2;
    text(ctx, '$557.83', cx0, cy, BAL, P.text);
    const pillX = cx0 + balW + rem(0.75);
    fillRR(ctx, pillX, cy - pillH / 2, pillW, pillH, pillH / 2, P.backgroundInverse);
    icon(ctx, ICONS.plus, pillX + rem(0.75) - rem(0.125) + 6.5, cy, 13, P.textInverse, 2.5);
    text(ctx, 'Add funds', pillX + rem(0.75) - rem(0.125) + 13 + rem(0.25), cy, LABEL, P.textInverse);
    // Right, from the edge in: avatar, theme toggle, the search pill.
    ctx.beginPath();
    ctx.arc(PAGE_R - avR, cy, avR, 0, Math.PI * 2);
    ctx.fillStyle = P.backgroundInverse;
    ctx.fill();
    text(ctx, 'J', PAGE_R - avR, cy + 0.5, sans(rem(0.8125), 600), P.textInverse, 'center');
    icon(ctx, a.theme === 'dark' ? ICONS.moon : ICONS.sun, sunCX, cy, a.theme === 'dark' ? 19 : 20, P.secondary, 1.75);
    const sp = searchPill;
    fillRR(ctx, sp.x, sp.y, sp.w, sp.h, sp.h / 2, P.surface);
    icon(ctx, ICONS.search, sp.x + rem(1) + 7, cy, 14, P.secondary, 2);
    text(ctx, 'Search markets...', sp.x + rem(1) + 14 + rem(0.5), cy, sans(rem(0.875), 400, -0.025), P.secondary);
  }

  // SXSearchModal: `pt-32`, the bar `max-w-2xl rounded-full border px-4`
  // with a 15px glass and text-sm `py-3.5`; results `mt-4 gap-4` in
  // `minmax(176px, 1fr)` columns inside `max-w-7xl px-4`.
  const bar = { w: Math.min(rem(42), rem(80) - rem(2)), h: rem(0.875) * 2 + rem(0.875) * 1.5 + 2, y: rem(8) };
  const barX = (VIEWPORT_W - bar.w) / 2;
  function drawSearchInput(t: number) {
    fillRR(ctx, barX, bar.y, bar.w, bar.h, bar.h / 2, P.background);
    strokeRR(ctx, barX, bar.y, bar.w, bar.h, bar.h / 2, P.border, 1);
    const cy = bar.y + bar.h / 2;
    icon(ctx, ICONS.search, barX + rem(1) + 7.5, cy, 15, P.muted, 2);
    const n = typedCount(t);
    const shown = typed.slice(0, n);
    const tx = barX + rem(1) + 15 + rem(0.75);
    const F = sans(rem(0.875));
    if (shown) text(ctx, shown, tx, cy, F, P.text);
    else text(ctx, 'Search markets...', tx, cy, F, P.placeholder);
    const typing = t >= T_TYPE && t < T_TYPED + 0.15;
    const caret = typing || Math.floor((t - T_SEARCH) * 2) % 2 === 0;
    if (caret) {
      const cx = tx + (shown ? width(ctx, shown, F) + 1 : 0);
      ctx.fillStyle = P.text;
      ctx.fillRect(cx, cy - rem(0.875) * 0.6, 1, rem(0.875) * 1.2);
    }
  }

  const gridX = (VIEWPORT_W - rem(80)) / 2 + rem(1);
  const gridW = rem(80) - rem(2);
  const GRID_COLS = Math.floor((gridW + rem(1)) / (176 + rem(1)));
  const cardW = (gridW - (GRID_COLS - 1) * rem(1)) / GRID_COLS;
  const imgH = cardW * 8 / 9;
  const cardH = imgH + rem(0.75) * 2 + rem(1) * 1.5 + rem(0.375) + rem(0.75) * 1.5;
  const gridY = bar.y + bar.h + rem(1);
  // GridCard: `rounded-xl bg-surface`; the photo `9/8` with a dark fade and
  // the holders count bottom-right; body `p-3 gap-1.5`: name (1rem) and
  // price (1rem mono semibold), then the change (0.75rem mono) and volume.
  function drawGrid(t: number) {
    const faces = [person, ...a.others];
    const skeleton = t < T_RESULTS;
    const pulse = 0.55 + 0.45 * Math.sin(t * 5);
    for (let i = 0; i < GRID_COUNT; i++) {
      const col = i % GRID_COLS;
      const row = Math.floor(i / GRID_COLS);
      const x = gridX + col * (cardW + rem(1));
      const y = gridY + row * (cardH + rem(1));
      if (y > VIEW_H) break;
      if (skeleton) {
        const base = ctx.globalAlpha;
        ctx.globalAlpha = base * (0.5 + 0.3 * pulse);
        fillRR(ctx, x, y, cardW, cardH, rem(0.75), P.surface);
        ctx.globalAlpha = base;
        continue;
      }
      const p = faces[i];
      if (!p) continue;
      fillRR(ctx, x, y, cardW, cardH, rem(0.75), P.surface);
      drawCover(ctx, a.photos.get(p.ticker) ?? null, x, y, cardW, imgH, [rem(0.75), rem(0.75), 0, 0], P.surfaceRaised);
      ctx.save();
      rr(ctx, x, y, cardW, imgH, [rem(0.75), rem(0.75), 0, 0]);
      ctx.clip();
      const g = ctx.createLinearGradient(0, y, 0, y + imgH);
      g.addColorStop(0.35, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.65)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, cardW, imgH);
      ctx.restore();
      const holders = p.price.holders ?? (3 + (hashStr(p.name) % 40));
      const hs = holders.toLocaleString('en-US');
      const HF = mono(rem(0.75), 500);
      const hw = width(ctx, hs, HF);
      const badgeCY = y + imgH - rem(0.5) - rem(0.75) * 0.75;
      text(ctx, hs, x + cardW - rem(0.5), badgeCY, HF, P.onAccent, 'right');
      icon(ctx, ICONS.users, x + cardW - rem(0.5) - hw - rem(0.25) - 6, badgeCY, 12, P.onAccent, 2);
      const pr = p.price.usd ?? 0;
      const PRICE = mono(rem(1), 600);
      const priceStr = fmtNpsi(pr);
      const pw = width(ctx, priceStr, PRICE);
      const NAME = sans(rem(1));
      const row1CY = y + imgH + rem(0.75) + (rem(1) * 1.5) / 2;
      text(ctx, truncate(ctx, p.name, NAME, cardW - rem(0.75) * 2 - pw - rem(0.5)), x + rem(0.75), row1CY, NAME, P.text);
      text(ctx, priceStr, x + cardW - rem(0.75), row1CY, PRICE, P.text, 'right');
      const row2CY = y + imgH + rem(0.75) + rem(1) * 1.5 + rem(0.375) + (rem(0.75) * 1.5) / 2;
      // The other faces carry their own 1M change, at ACTIVITY like everything
      // else; a market that has not moved gets a seeded flicker instead.
      const own = p.price.change1mPct;
      const chg = p === person ? changePct : (own != null && own !== 0 ? own : (mulberry32(hashStr(p.ticker))() - 0.4) * 0.6) * ACTIVITY;
      const cUp = chg >= 0;
      const cCol = cUp ? P.positive : P.negative;
      trendArrow(ctx, x + rem(0.75) + 4, row2CY, 8, cUp, cCol);
      text(ctx, fmtPct(chg), x + rem(0.75) + 8 + rem(0.25), row2CY, mono(rem(0.75), 500), cCol);
      const vol = p.price.volumeLifetimeUsd ?? (hashStr(p.ticker) % 900);
      text(ctx, fmtGridVolume(vol), x + cardW - rem(0.75), row2CY, mono(rem(0.75), 400, -0.025), P.secondary, 'right');
    }
  }

  function drawHome(t: number) {
    drawHomeImage(ctx);
    if (t < T_SEARCH) return;
    const alpha = clamp((t - T_SEARCH) / 0.2, 0, 1);
    ctx.globalAlpha = alpha;
    // Made at frame size, laid back over the page it was made from: at rest
    // that is pixel for pixel, and the camera scales it with everything else.
    ctx.drawImage(blurred, 0, 0, VIEWPORT_W, VIEW_H);
    drawSearchInput(t);
    if (t >= T_FIRST_CHAR) drawGrid(t);
    ctx.globalAlpha = 1;
  }

  function drawProfileCard() {
    strokeRR(ctx, card.x, card.y, card.w, card.h, rem(1), P.border, 1);
    drawCover(ctx, a.photos.get(person.ticker) ?? null, photo.x, photo.y, photo.w, photo.h, photo.r, P.surface);
    text(ctx, `${person.name}'s Sentiment`, bodyX, headlineY, HEADLINE, P.text);
    bioLines.forEach((ln, i) => text(ctx, ln, bodyX, bioY + BIO_LH / 2 + i * BIO_LH, BIO, P.secondary));
    for (let i = 0; i < inv.socials; i++) glyph(ctx, SOCIAL_GLYPHS[i % SOCIAL_GLYPHS.length], bodyX + 7.5 + i * (15 + rem(0.75)), socialsCY, 15, P.text, 0.7, P.background);
    let cx = bodyX;
    for (const chip of chips) {
      const lw = width(ctx, chip.label, CHIP);
      const cw = rem(0.625) * 2 + 11 + rem(0.375) + lw;
      if (cx + cw > card.x + card.w - rem(1)) break;
      strokeRR(ctx, cx, chipsCY - CHIP_H / 2, cw, CHIP_H, rem(0.375), P.border, 1);
      icon(ctx, chip.icon, cx + rem(0.625) + 5.5, chipsCY, 11, P.secondary, 1.8);
      text(ctx, chip.label, cx + rem(0.625) + 11 + rem(0.375), chipsCY + 0.9, CHIP, P.secondary);
      cx += cw + rem(0.5);
    }
  }

  // The price row follows the chart hover the way the site's does: the
  // hovered price with three more places, and the change measured from the
  // period's first price to it.
  function drawPriceRow(hover: Hover | null, cv: ChartView) {
    const first = cv.first;
    const PRICE = mono(24, 600, -0.02);
    const cur = hover ? hover.price : price;
    const ps = fmtNpsi(cur, npsiDecimals(cur, !!hover));
    text(ctx, ps, LCOL[0], priceCY, PRICE, P.text);
    let x = LCOL[0] + width(ctx, ps, PRICE) + rem(0.75);
    const cy = priceCY - rem(0.125);
    const delta = cur - first;
    const isUp = delta >= 0;
    const col = isUp ? P.positive : P.negative;
    trendArrow(ctx, x + 7, cy + 1, 14, isUp, col);
    x += 14 + rem(0.25);
    const CH = mono(14, 600, -0.02);
    const pct = fmtPct((delta / first) * 100);
    text(ctx, pct, x, cy, CH, col);
    x += width(ctx, pct, CH) + rem(0.75);
    const raw = `${isUp ? '+$' : '-$'}${Math.abs(delta).toFixed(smallDecimals(delta))}`;
    text(ctx, raw, x, cy, CH, col);
    x += width(ctx, raw, CH) + rem(0.125) + 6.5;
    // The (i) beside the change.
    ctx.fillStyle = P.disabled;
    ctx.beginPath();
    ctx.arc(x, cy - 1, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = P.background;
    ctx.beginPath();
    ctx.arc(x, cy - 1, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = P.disabled;
    ctx.fillRect(x - 0.7, cy - 4.3, 1.4, 1.4);
    ctx.fillRect(x - 0.7, cy - 2, 1.4, 4.2);
    // Share (Share2 18px in a 0.375rem-padded button) and LIVE, right.
    icon(ctx, ICONS.share, LCOL[1] - rem(0.375) - 9, shareCY, 18, P.text, 1.8);
    const LIVE = mono(rem(0.5), 600, 0.08);
    const lw = width(ctx, 'LIVE', LIVE);
    text(ctx, 'LIVE', LCOL[1], liveCY, LIVE, P.text, 'right');
    ctx.beginPath();
    ctx.arc(LCOL[1] - lw - rem(0.3125) - rem(0.125), liveCY - 0.3, rem(0.125), 0, Math.PI * 2);
    ctx.fillStyle = P.text;
    ctx.fill();
  }

  function drawChart(t: number, hover: Hover | null, cv: ChartView) {
    const { pts, range, min: minP, color: lineColor } = cv;
    const [drawStart, drawEnd] = T_CHART;
    const YL = mono(rem(0.625));
    for (const f of [0, 0.25, 0.5, 0.75]) {
      const y = chart.y + f * chart.h;
      ctx.save();
      ctx.setLineDash([2, 5]);
      ctx.strokeStyle = P.chartGrid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(chart.x, y);
      ctx.lineTo(chart.x + chart.plotW + 12, y);
      ctx.stroke();
      ctx.restore();
      const v = minP + (1 - (y - (chart.y + chart.padT)) / plotH) * range;
      text(ctx, fmtChart(v, range), chart.x + chart.w - 2, y, YL, P.secondary, 'right');
    }
    if (!hover) {
      const XL = mono(rem(0.625));
      const xlCY = chart.y + chart.h - rem(0.375) - (rem(0.625) * 1.5) / 2;
      for (const d of cv.labels) text(ctx, d.label, d.x, xlCY, XL, P.secondary, d.align);
    }
    // The line, drawing itself in from the left (the site's dash-offset draw).
    const reveal = easeOut((t - drawStart) / (drawEnd - drawStart));
    if (reveal <= 0) return;
    const line = (x0: number, x1: number, alpha: number) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, chart.y - 20, Math.max(0, x1 - x0), chart.h + 40);
      ctx.clip();
      ctx.globalAlpha *= alpha;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    };
    const drawnTo = chart.x - 2 + (chart.plotW + 4) * reveal;
    if (hover) {
      // Hovered (SXPriceChart): the line dims past the point, the pulse goes,
      // an axis line and a ringed dot mark it, and the date sits at the top
      // in place of the dates along the bottom.
      line(chart.x - 2, Math.min(hover.x, drawnTo), 1);
      line(hover.x, drawnTo, 0.15);
      ctx.strokeStyle = P.chartAxis;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hover.x, chart.y - 12);
      ctx.lineTo(hover.x, chart.y + chart.h - chart.padB + 18);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hover.x, hover.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = lineColor;
      ctx.fill();
      ctx.strokeStyle = P.hoverRing;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      text(ctx, fmtChartLabel(hover.ts), hover.x, chart.y + (rem(0.75) * 1.5) / 2, sans(rem(0.75)), P.text, 'center');
      return;
    }
    line(chart.x - 2, drawnTo, 1);
    if (reveal >= 1) {
      const end = pts[pts.length - 1];
      const pulse = 0.5 + 0.5 * Math.sin((t - drawEnd) * 4);
      ctx.beginPath();
      ctx.arc(end.x, end.y, 6 + 3 * pulse, 0, Math.PI * 2);
      ctx.fillStyle = lineColor;
      ctx.globalAlpha = 0.28 - 0.14 * pulse;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(end.x, end.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawTabs(cv: ChartView) {
    for (const tab of TABS) text(ctx, tab.label, tab.x, tabsCY, TAB_F, tab.label === cv.period ? P.text : P.secondary);
    if (wordmarkMark) {
      ctx.globalAlpha = 0.3;
      ctx.drawImage(wordmarkMark, LCOL[1] - wordmarkMark.width / 2, tabsCY - rem(1.125) / 2, wordmarkMark.width / 2, rem(1.125));
      ctx.globalAlpha = 1;
    }
  }

  function drawStats() {
    ctx.fillStyle = P.border;
    ctx.fillRect(LCOL[0], stats.y, LEFT_W, 1);
    ctx.fillRect(LCOL[0], stats.y + stats.h, LEFT_W, 1);
    const cells: { label: string; value: string; pct?: number }[] = [
      { label: 'Total Volume', value: `$${fmtVolume(inv.volume)}` },
      { label: 'Holders', value: inv.holders.toLocaleString('en-US') },
      { label: '1H Change', value: fmtPct(inv.change1h), pct: inv.change1h },
      { label: '24H Change', value: fmtPct(inv.change24h), pct: inv.change24h },
      { label: '7D Change', value: fmtPct(inv.change7d), pct: inv.change7d },
    ];
    const VAL = mono(rem(0.875), 600, -0.025);
    cells.forEach((c, i) => {
      const x = LCOL[0] + i * (statColW + rem(1.5));
      text(ctx, c.label, x, statLabelCY, sans(rem(0.75)), P.secondary);
      if (c.pct == null) text(ctx, c.value, x, statValueCY, VAL, P.text);
      else {
        const cUp = c.pct >= 0;
        const col = cUp ? P.positive : P.negative;
        trendArrow(ctx, x + 4.5, statValueCY, 9, cUp, col);
        text(ctx, c.value, x + 9 + rem(0.25), statValueCY, VAL, col);
      }
    });
  }

  function drawPositions() {
    text(ctx, 'Positions', LCOL[0], posTitleCY, sans(rem(1), 400, -0.025), P.text);
    text(ctx, `Open (${inv.positions.length})`, LCOL[0], posOpenCY, sans(rem(0.75)), P.secondary);
    ctx.fillStyle = P.border;
    ctx.fillRect(LCOL[0], tableY, LEFT_W, 1);
    const HEAD = sans(rem(0.75), 400, 0.02);
    for (const c of posCols) text(ctx, c.label, c.x, tableHeadCY, HEAD, P.secondary, c.align);
    const CELL = mono(rem(0.75));
    const CHIPF = sans(rem(0.625), 500, 0.01);
    inv.positions.forEach((p, i) => {
      const y = rowCY(i);
      if (y - ROW_H / 2 > VIEW_H) return;
      const col = p.dir === 'up' ? P.positive : P.negative;
      const label = p.dir.toUpperCase();
      const padX = p.dir === 'up' ? rem(0.875) : rem(0.625);
      const cw = width(ctx, label, CHIPF) + padX * 2;
      const chipH = rem(0.625) + rem(0.1875) + rem(0.125);
      const chipX = LCOL[0] + rem(1) + rem(0.75) + rem(0.375);
      ctx.globalAlpha = 0.15;
      fillRR(ctx, chipX, y - chipH / 2, cw, chipH, chipH / 2, col);
      ctx.globalAlpha = 1;
      text(ctx, label, chipX + cw / 2, y + 0.5, CHIPF, col, 'center');
      const pnl = p.worth - p.paid;
      const vals = [fmtNpsi(p.entry, npsiDecimals(p.entry)), fmtMoney(p.paid), fmtMoney(p.fee), fmtMoney(p.worth), p.date];
      const at = [0, 1, 2, 3, 5];
      vals.forEach((v, j) => text(ctx, v, posCols[at[j] + 1].x, y, CELL, P.text, 'right'));
      text(ctx, `${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)}`, posCols[5].x, y, CELL, pnl >= 0 ? P.positive : P.negative, 'right');
    });
  }

  // The trade card's state at t.
  function positionAt(t: number): { pos: Direction; prev: Direction; since: number } {
    let pos: Direction = 'up';
    let prev: Direction = 'up';
    let since = -1;
    for (const f of flips) { if (f.t <= t) { prev = pos; pos = f.to; since = f.t; } }
    return { pos, prev, since };
  }
  const amountShown = (t: number) => (t < amountAt[0] ? '' : t < amountAt[1] ? '1' : String(AMOUNT_USD));

  function drawTradeCard(t: number) {
    fillRR(ctx, tc.x, tc.y, tc.w, tc.h, rem(1), P.surface);
    const { pos, prev, since } = positionAt(t);
    headline(pos).forEach((ln, i) => text(ctx, ln, tcInnerX, tc.y + tc.pad + HEADLINE_LH / 2 + i * HEADLINE_LH, HEADLINE, P.text));

    // Toggle: the track, the sliding thumb, the two labels.
    ctx.globalAlpha = 0.04;
    fillRR(ctx, tr.x, tr.y, tr.w, tr.h, tr.h / 2, P.text);
    ctx.globalAlpha = 0.07;
    strokeRR(ctx, tr.x, tr.y, tr.w, tr.h, tr.h / 2, P.text, 1);
    ctx.globalAlpha = 1;
    const thumbW = tr.w / 2 - rem(0.25) - 1;
    const fracOf = (d: Direction) => (d === 'up' ? 0 : 1);
    const u = since < 0 ? 1 : easeOut((t - since) / 0.2);
    const frac = lerp(fracOf(prev), fracOf(pos), u);
    const thumbX = lerp(inner.x, tr.x + tr.w / 2, frac);
    fillRR(ctx, thumbX, inner.y, thumbW, inner.h, inner.h / 2, frac < 0.5 ? P.positive : P.negative);
    const TOG = sans(rem(0.875), 600, -0.015);
    const labelAt = (d: Direction, cx: number) => {
      const on = pos === d;
      const col = on ? P.onAccent : P.textSecondary;
      const lbl = d === 'up' ? 'Up' : 'Down';
      const lw = width(ctx, lbl, TOG);
      const total = 13 + rem(0.375) + lw;
      icon(ctx, d === 'up' ? ICONS.arrowUp : ICONS.arrowDown, cx - total / 2 + 6.5, tr.y + tr.h / 2, 13, col, 2.5);
      text(ctx, lbl, cx - total / 2 + 13 + rem(0.375), tr.y + tr.h / 2, TOG, col);
    };
    labelAt('up', inner.x + inner.w / 4);
    labelAt('down', inner.x + (3 * inner.w) / 4);

    // Amount: label left, `$` and the digits right (2.5rem, leading-none).
    const amt = amountShown(t);
    text(ctx, 'Amount', tcInnerX, amountCY, sans(rem(0.8125), 500), P.text);
    const BIG = sans(rem(2.5));
    const digits = amt || '0';
    const dcol = amt ? P.text : P.borderStrong;
    text(ctx, digits, tcInnerX + tcInnerW, amountCY, BIG, dcol, 'right');
    const dw = Math.max(width(ctx, digits, BIG), digits.length * rem(2.5) * 0.55);
    text(ctx, '$', tcInnerX + tcInnerW - dw, amountCY, BIG, dcol, 'right');
    if (t >= T_AMOUNT_CLICK && t < T_PLACE && Math.floor((t - T_AMOUNT_CLICK) * 2) % 2 === 0) {
      ctx.fillStyle = P.text;
      ctx.fillRect(tcInnerX + tcInnerW + 1, amountCY - rem(2.5) * 0.55, 1.5, rem(2.5) * 1.1);
    }

    // Rows under a hairline: Auto-spread, Fee, See the math.
    ctx.fillStyle = P.border;
    ctx.fillRect(tcInnerX, dividerY, tcInnerW, 1);
    const ROW = sans(rem(0.75), 400, -0.025);
    text(ctx, `Auto-spread (on at ${Math.round(AUTO_SPREAD * 100)}%)`, tcInnerX, rowsCY[0], ROW, P.secondary);
    icon(ctx, ICONS.chevronDown, tcInnerX + tcInnerW - 7, rowsCY[0], 14, P.secondary, 2);
    text(ctx, 'Fee', tcInnerX, rowsCY[1], ROW, P.secondary);
    const n = amt ? Number(amt) : 0;
    const fee = n ? `$${(n * (1 - AUTO_SPREAD) * TRADING_FEE_RATE).toFixed(4)}` : '$0.00';
    text(ctx, fee, tcInnerX + tcInnerW, rowsCY[1], mono(rem(0.8125)), P.text, 'right');
    text(ctx, 'See the math', tcInnerX, rowsCY[2], ROW, P.secondary);
    ctx.fillStyle = P.secondary;
    ctx.fillRect(tcInnerX, rowsCY[2] + rem(0.75) * 0.6, width(ctx, 'See the math', ROW), 0.8);
    icon(ctx, ICONS.chevronDown, tcInnerX + tcInnerW - 7, rowsCY[2], 14, P.secondary, 2);

    // The button (`rounded-full py-3 text-[1rem]`, disabled at half).
    const placing = t >= T_PLACE;
    const enabled = !!amt && !placing;
    ctx.globalAlpha = enabled ? 1 : 0.5;
    fillRR(ctx, tcInnerX, btn.y, tcInnerW, btn.h, btn.h / 2, P.btnBg);
    text(ctx, placing ? 'Placing order...' : amt ? 'Place trade' : 'Enter amount', tcInnerX + tcInnerW / 2, btn.y + btn.h / 2, sans(rem(1)), P.btnText, 'center');
    ctx.globalAlpha = 1;

    // Trade confirmed: the whole card goes green (the site's success state,
    // its 76px check drawing itself in), and holds.
    if (t >= T_CONFIRM) {
      const u = t - T_CONFIRM;
      ctx.globalAlpha = clamp(u / 0.22, 0, 1);
      fillRR(ctx, tc.x, tc.y, tc.w, tc.h, rem(1), P.positive);
      const cx = tc.x + tc.w / 2;
      const stack = 76 + rem(0.75) + rem(1.0625) * 1.5 + rem(0.75) + rem(0.8125) * 1.5;
      const top = tc.y + (tc.h - stack) / 2;
      const cy = top + 38;
      const k = 76 / 52;
      const pu = clamp(u / 0.44, 0, 1);
      const pop = pu < 0.6 ? lerp(0.5, 1.12, easeOut(pu / 0.6)) : lerp(1.12, 1, easeInOut((pu - 0.6) / 0.4));
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(pop * k, pop * k);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const circ = clamp((u - 0.12) / 0.46, 0, 1);
      if (circ > 0) {
        ctx.beginPath();
        ctx.arc(0, 0, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * easeOut(circ));
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
      const mark = clamp((u - 0.44) / 0.3, 0, 1);
      if (mark > 0) {
        const p0 = { x: -11, y: 1 }, p1 = { x: -3.5, y: 8.5 }, p2 = { x: 12, y: -8 };
        const l1 = Math.hypot(p1.x - p0.x, p1.y - p0.y), l2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const d = easeOut(mark) * (l1 + l2);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        if (d <= l1) { const q = d / l1; ctx.lineTo(lerp(p0.x, p1.x, q), lerp(p0.y, p1.y, q)); }
        else { ctx.lineTo(p1.x, p1.y); const q = (d - l1) / l2; ctx.lineTo(lerp(p1.x, p2.x, q), lerp(p1.y, p2.y, q)); }
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 4.5;
        ctx.stroke();
      }
      ctx.restore();
      const rise = clamp((u - 0.48) / 0.34, 0, 1);
      if (rise > 0) {
        const base = ctx.globalAlpha;
        ctx.globalAlpha = base * easeOut(rise);
        const dy = rem(0.5) * (1 - easeOut(rise));
        const t1 = top + 76 + rem(0.75) + (rem(1.0625) * 1.5) / 2;
        text(ctx, 'Trade confirmed', cx, t1 + dy, sans(rem(1.0625), 600), P.onAccent, 'center');
        ctx.globalAlpha = base * easeOut(rise) * 0.9;
        text(ctx, `${direction === 'up' ? 'Up' : 'Down'} · $${AMOUNT_USD.toFixed(2)}`, cx, t1 + (rem(1.0625) * 1.5) / 2 + rem(0.75) + (rem(0.8125) * 1.5) / 2 + dy, sans(rem(0.8125)), P.onAccent, 'center');
      }
      ctx.globalAlpha = 1;
    }

    // Under the card.
    strokeRR(ctx, tc.x, how.y, tc.w, how.h, 15, P.border, 1);
    const HOW = sans(15, 500);
    const hw = 16 + 7 + width(ctx, 'How it works', HOW) + 9 + 15;
    const hx = tc.x + tc.w / 2 - hw / 2;
    icon(ctx, ICONS.help, hx + 8, how.y + how.h / 2, 16, P.text, 1.6);
    text(ctx, 'How it works', hx + 16 + 7, how.y + how.h / 2, HOW, P.text);
    icon(ctx, ICONS.arrowRight, hx + hw - 7.5, how.y + how.h / 2, 15, P.text, 1.8);
  }

  // ── The pointer's path (page px) ──────────────────────────────────────────
  // A day trader's hand, not a demo's: it covers every leg in half the time
  // it has (RUSH), overshoots the mark and snaps back, and never actually
  // stops — a tremor and a drift ride on everything, loudest while it waits.
  // Loops where it circles: the homepage hero, their card, the chart, the
  // button.
  const RUSH = 1.75;
  const easeBack = (u: number) => { const c = 1.6; const p = u - 1; return 1 + (c + 1) * p * p * p + c * p * p; };
  const fidget = (t: number, amp: number) => ({
    x: amp * (0.5 * Math.sin(t * 7.9 + 0.3) + 0.24 * Math.sin(t * 19.7 + 1.7) + 0.9 * Math.sin(t * 2.6)),
    y: amp * (0.5 * Math.cos(t * 6.9 + 1.1) + 0.24 * Math.cos(t * 17.9) + 0.9 * Math.cos(t * 2.1 + 2.1)),
  });
  const heroC = { x: 470, y: 290 };
  const homeLoopAt = (t: number) => {
    const u = t - T_HOME_LOOP[0];
    const ang = -Math.PI / 2 + 2 * Math.PI * (2.2 * u + 0.3 * Math.sin(4.7 * u));
    const r = 1 + 0.28 * Math.sin(4.3 * u + 0.5);
    return { x: heroC.x + 180 * r * Math.cos(ang) + 5 * Math.sin(31 * u), y: heroC.y + 105 * r * Math.sin(ang) + 5 * Math.cos(27 * u) };
  };
  const searchPt = { x: searchPill.x + searchPill.w * 0.4, y: searchPill.y + searchPill.h / 2 + 1 };
  const asidePt = { x: barX + bar.w + 60, y: bar.y + bar.h / 2 + 6 };
  const card0 = { x: gridX, y: gridY, w: cardW, h: cardH };
  const cardLoopAt = (t: number) => {
    const u = (t - T_CARD_LOOP[0]) / (T_CARD_LOOP[1] - T_CARD_LOOP[0]);
    const ang = -Math.PI / 2 + 2 * Math.PI * 2.6 * u;
    return { x: card0.x + card0.w / 2 + (card0.w / 2 + 18) * Math.cos(ang), y: card0.y + card0.h / 2 + (card0.h / 2 + 12) * Math.sin(ang) };
  };
  const pickPt = { x: card0.x + card0.w / 2 - 10, y: card0.y + imgH * 0.55 };
  // A crazed squirrel on the chart: about six laps a second with the speed
  // lurching, the circle snapping between tight and wide, and its centre
  // darting back and forth along the line. The sizes are kept inside the plot
  // so the hover never drops (the tremor rides on top).
  const loopRX = 105;
  const loopRY = 52;
  const loopDX = 150;
  const loopDY = 22;
  const loopC = (() => {
    const f = 0.6;
    const near = VIEW_M.pts[Math.round(f * (VIEW_M.pts.length - 1))].y;
    const reachY = loopRY * 1.2 + loopDY + 24;
    return { x: chart.x + f * chart.plotW, y: clamp(near, chart.y + reachY, chart.y + chart.h - reachY) };
  })();
  const chartLoopAt = (t: number) => {
    const u = t - T_CHART_LOOP[0];
    const ang = -Math.PI / 2 + 2 * Math.PI * (5.8 * u + 0.35 * Math.sin(9.3 * u) + 0.12 * Math.sin(23 * u));
    const r = 0.85 + 0.35 * Math.sin(7.3 * u + 0.8);
    const cx = loopC.x + loopDX * (0.75 * Math.sin(3.1 * u + 0.4) + 0.25 * Math.sin(11.3 * u));
    const cy = loopC.y + loopDY * Math.sin(4.7 * u + 1.3);
    return { x: cx + loopRX * r * Math.cos(ang), y: cy + loopRY * r * Math.sin(ang) };
  };
  const togglePt = (d: Direction) => ({ x: inner.x + (d === 'up' ? 1 : 3) * (inner.w / 4), y: tr.y + tr.h / 2 + 2 });
  const amountPt = { x: tcInnerX + tcInnerW - 26, y: amountCY + 4 };
  const buttonPt = { x: tcInnerX + tcInnerW / 2 + 12, y: btn.y + btn.h / 2 + 3 };
  const waitLoopAt = (t: number) => {
    const u = (t - T_WAIT[0]) / (T_WAIT[1] - T_WAIT[0]);
    const ang = Math.PI / 2 + 2 * Math.PI * 3.4 * u;
    return { x: buttonPt.x + 70 * Math.cos(ang), y: buttonPt.y - 30 + 30 * Math.sin(ang) };
  };
  const restPt = { x: tc.x + tc.w + 16, y: btn.y + 6 };
  const exitPt = { x: restPt.x - 40, y: -40 };
  interface Key { t: number; x: number; y: number; snap?: boolean }
  const keys: Key[] = [
    { t: 0, x: 650, y: 400 },
    { t: T_HOME_LOOP[0], ...homeLoopAt(T_HOME_LOOP[0]) },
    { t: T_HOME_LOOP[1], ...homeLoopAt(T_HOME_LOOP[1]) },
    { t: T_SEARCH, ...searchPt },
    { t: T_SEARCH + 0.12, ...searchPt },
    { t: T_SEARCH + 0.45, ...asidePt },
    { t: T_TYPED + 0.05, ...asidePt },
    { t: T_CARD_LOOP[0], ...cardLoopAt(T_CARD_LOOP[0]) },
    { t: T_CARD_LOOP[1], ...cardLoopAt(T_CARD_LOOP[1]) },
    { t: T_PICK, ...pickPt },
    { t: ana(0.35), ...pickPt },
    { t: T_CHART_LOOP[0], ...chartLoopAt(T_CHART_LOOP[0]) },
    { t: T_CHART_LOOP[1], ...chartLoopAt(T_CHART_LOOP[1]) },
    ...flips.flatMap(f => [{ t: f.t, ...togglePt(f.to) }, { t: f.t + trd(0.15), ...togglePt(f.to) }]),
    { t: T_AMOUNT_CLICK, ...amountPt },
    { t: T_AMOUNT + trd(0.4), ...amountPt },
    { t: T_PLACE, ...buttonPt },
    { t: T_WAIT[0], ...buttonPt },
    { t: T_WAIT[1], ...waitLoopAt(T_WAIT[1]) },
    { t: T_WAIT[1] + 0.35, ...restPt },
    { t: T_EXIT[0], ...restPt },
    // `snap`: this leg accelerates the whole way instead of easing in and out.
    { t: T_EXIT[1], ...exitPt, snap: true },
    { t: seconds + 1, ...exitPt },
  ];
  // While the name is typing the hand is off the keyboard and nearly still;
  // everywhere else it is going somewhere or twitching at where it landed —
  // except for a press, which it settles into and holds still through.
  const TYPING: [number, number] = [T_SEARCH + 0.45, T_TYPED];
  const pressCalm = (t: number) => {
    let d = Infinity;
    for (const c of clicks) d = Math.min(d, Math.abs(t - c.t - 0.03));
    return easeInOut(clamp((d - 0.1) / 0.22, 0, 1));
  };
  const cursorAt = (t: number): { x: number; y: number } => {
    let base: { x: number; y: number };
    let landed = true;
    if (t >= T_HOME_LOOP[0] && t < T_HOME_LOOP[1]) base = homeLoopAt(t);
    else if (t >= T_CARD_LOOP[0] && t < T_CARD_LOOP[1]) base = cardLoopAt(t);
    else if (t >= T_CHART_LOOP[0] && t < T_CHART_LOOP[1]) base = chartLoopAt(t);
    else if (t >= T_WAIT[0] && t < T_WAIT[1]) base = waitLoopAt(t);
    else {
      let i = 0;
      while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
      const k0 = keys[i];
      const k1 = keys[i + 1];
      const raw = k1.t === k0.t ? 1 : clamp((t - k0.t) / (k1.t - k0.t), 0, 1);
      const u = clamp(raw * RUSH, 0, 1);
      const e = k1.snap ? u * u : easeBack(u);
      base = { x: lerp(k0.x, k1.x, e), y: lerp(k0.y, k1.y, e) };
      landed = u >= 1;
    }
    const amp = t >= TYPING[0] && t < TYPING[1] ? 1 : landed ? 7 : 3.4;
    const f = fidget(t, lerp(0.4, amp, pressCalm(t)));
    return { x: base.x + f.x, y: base.y + f.y };
  };

  // The hover the pointer makes (SXPriceChart.handleMouseMove): once the
  // line is drawn and while the pointer is over the plot, the last point at
  // or before it — never the very last one, as the site has it.
  const hoverAt = (t: number): Hover | null => {
    if (t < T_CHART[1]) return null;
    const c = cursorAt(t);
    if (c.x < chart.x || c.x > chart.x + chart.plotW || c.y < chart.y || c.y > chart.y + chart.h) return null;
    const cv = VIEW_M;
    let lo = 0;
    let hi = cv.pts.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cv.pts[mid].x <= c.x) lo = mid;
      else hi = mid - 1;
    }
    return { x: c.x, y: cv.pts[lo].y, price: cv.series[lo], ts: now - (1 - lo / (cv.series.length - 1)) * cv.days * 864e5 };
  };

  // What the pointer looks like where it is: the site's hand over the search
  // pill, the cards, the toggle and the live button; the beam over the amount;
  // the crosshair over the chart while it is hovered; the arrow elsewhere.
  type Pt = { x: number; y: number };
  const inRect = (p: Pt, r: { x: number; y: number; w: number; h: number }) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  const overCard = (t: number, p: Pt) => {
    if (t < T_RESULTS) return false;
    const col = Math.floor((p.x - gridX) / (cardW + rem(1)));
    const row = Math.floor((p.y - gridY) / (cardH + rem(1)));
    if (col < 0 || col >= GRID_COLS || row < 0 || row * GRID_COLS + col >= GRID_COUNT) return false;
    return inRect(p, { x: gridX + col * (cardW + rem(1)), y: gridY + row * (cardH + rem(1)), w: cardW, h: cardH });
  };
  const cursorKind = (t: number, c: Pt): PointerKind => {
    if (t < T_PICK) return (t < T_SEARCH ? inRect(c, searchPill) : overCard(t, c)) ? 'hand' : 'arrow';
    if (hoverAt(t)) return 'cross';
    if (inRect(c, tr) || inRect(c, TABS_HIT)) return 'hand';
    if (t >= T_AMOUNT && t < T_PLACE && inRect(c, { x: tcInnerX, y: btn.y, w: tcInnerW, h: btn.h })) return 'hand';
    if (inRect(c, { x: tcInnerX, y: amountCY - AMOUNT_ROW_H / 2, w: tcInnerW, h: AMOUNT_ROW_H })) return 'beam';
    return 'arrow';
  };

  function drawMarket(t: number) {
    const hover = hoverAt(t);
    const cv = VIEW_M;
    ctx.fillStyle = P.background;
    ctx.fillRect(0, 0, VIEWPORT_W, VIEW_H);
    drawHeader();
    drawProfileCard();
    drawPriceRow(hover, cv);
    drawChart(t, hover, cv);
    drawTabs(cv);
    drawStats();
    drawPositions();
    drawTradeCard(t);
  }

  // ── The camera ────────────────────────────────────────────────────────────
  // The recording moves once. The frame pushes in on the trade card — the
  // only thing in the clip worth pushing in on — and pulls back out when the
  // trade is confirmed. Everything either side of that is the still frame: the
  // whole page, held.
  //
  // It used to visit the search, their card and the chart on the way, the way
  // a screen recording is zoomed after the fact. That read as a tour, and the
  // shot the video exists for arrived as one more stop on it.
  //
  // Each key is a zoom and the page point held in the middle of the frame.
  // Between keys both ease in and out of rest, so the frame slides in and then
  // sits; it never moves with the pointer. That is deliberate: the hand is a
  // squirrel with too much caffeine, and a frame that tried to keep up with it
  // — however filtered — shook. Still under erratic circles is what makes them
  // read as erratic.
  //
  // ZOOM scales every push: at 0 the frame is the still one the clip had
  // before any of this and nothing else changes. Nothing else knows about it
  // either — the page, the pointer, the hover and the sound are all still
  // worked out in page px, and the camera is applied on the way to the canvas.
  interface CamKey {
    t: number; z: number; x: number; y: number;
    /** How much of the push past the page's right edge to take, 0 to 1. The
     *  trade card lives in the right rail, so a frame held inside the page can
     *  never get it near the middle — at this zoom it sits about three
     *  quarters across, which is what made the most important shot in the clip
     *  look like an afterthought. Letting the frame run on past the edge puts
     *  the card where the eye already is. Nothing is lost off the right: the
     *  page's background and the canvas's are the same fill, so the margin
     *  beyond it reads as more page. */
    pan?: number;
  }
  /** The still frame: the whole page, which is where the clip sits whenever it
   *  is not on the trade. */
  const pageMid = { x: VIEWPORT_W / 2, y: VIEW_H / 2 };
  const tcMid = { x: tc.x + tc.w / 2, y: tc.y + tc.h / 2 };
  // The trade is the whole point of the recording, so it is the only thing the
  // frame ever moves for. Everything before it — the homepage, the search, the
  // grid, the chart — is watched from where the clip has always sat, whole and
  // still. The push used to visit each of those in turn, and the cost of that
  // was the one shot that matters arriving as just another stop on the tour.
  const TRADE_Z = 1.5;
  /** Not quite dead centre: the last of the push would only buy a wider band
   *  of empty margin on the right. */
  const TRADE_PAN = 0.85;
  const camKeys: CamKey[] = [
    { t: 0, z: 1, ...pageMid },
    { t: Math.max(0.3, T_TRADE - 0.5), z: 1, ...pageMid },
    // In on the trade card, and right with it.
    { t: T_TRADE + 0.2, z: TRADE_Z, ...tcMid, pan: TRADE_PAN },
    { t: T_CONFIRM, z: TRADE_Z, ...tcMid, pan: TRADE_PAN },
    // Confirmed: straight back out to the whole page, and still again for the
    // hold and the pointer leaving.
    { t: T_CONFIRM + 0.55, z: 1, ...pageMid },
    { t: seconds + 1, z: 1, ...pageMid },
  ];
  // Whatever the name does to the timeline, no move is ever cut shorter than
  // this: the frame slides, it never jumps.
  const CAM_MIN = 0.4;
  for (let i = 1; i < camKeys.length; i++) camKeys[i].t = Math.max(camKeys[i].t, camKeys[i - 1].t + CAM_MIN);
  /** The zoom now, and the page point the frame's top left sits on. */
  const camAt = (t: number) => {
    if (ZOOM <= 0) return { z: 1, left: 0, top: 0 };
    let i = 0;
    while (i < camKeys.length - 2 && camKeys[i + 1].t <= t) i++;
    const k0 = camKeys[i];
    const k1 = camKeys[i + 1];
    const u = easeInOut(clamp((t - k0.t) / (k1.t - k0.t), 0, 1));
    const z = 1 + (lerp(k0.z, k1.z, u) - 1) * ZOOM;
    const x = lerp(k0.x, k1.x, u);
    const y = lerp(k0.y, k1.y, u);
    const vw = VIEWPORT_W / z;
    const vh = VIEW_H / z;
    // How far past the page's right edge this key wants to sit: the whole of
    // what centring its point would take, times how much of it it asked for.
    // Worked out from the zoom actually in force, so it stays right at every
    // ZOOM level rather than only at 'normal'.
    const overOf = (k: CamKey) => (k.pan ? Math.max(0, k.x + vw / 2 - VIEWPORT_W) * k.pan : 0);
    const over = lerp(overOf(k0), overOf(k1), u);
    return { z, left: clamp(x - vw / 2, 0, VIEWPORT_W - vw + over), top: clamp(y - vh / 2, 0, VIEW_H - vh) };
  };

  const draw = (t: number) => {
    const cam = camAt(t);
    const k = SCALE * cam.z;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = P.background;
    ctx.fillRect(0, 0, VIDEO_W, VIDEO_H);
    ctx.save();
    ctx.setTransform(k, 0, 0, k, -cam.left * k, -cam.top * k);
    if (t < T_PICK) drawHome(t);
    else drawMarket(t);
    ctx.restore();
    // The pointer is part of the picture, so it grows with it.
    const c = cursorAt(t);
    drawPointer(ctx, cursorKind(t, c), (c.x - cam.left) * k, (c.y - cam.top) * k, POINTER_SIZE * cam.z);
  };
  return { draw, seconds, beats, keys: keystrokes, clicks };
}

// ── Render + encode ─────────────────────────────────────────────────────────
export interface RenderOptions extends ClipOptions {
  direction: Direction;
  onProgress?: (done: number, total: number) => void;
  /** The clip's beats and length the moment they are worked out, before the
   *  first frame is drawn. For whoever has something to start on those while
   *  the frames go. */
  onPlanned?: (p: Pick<RenderResult, 'beats' | 'seconds'>) => void;
  signal?: AbortSignal;
}
export async function renderTradeVideo(assets: TradeAssets, o: RenderOptions): Promise<RenderResult> {
  if (typeof VideoEncoder === 'undefined') throw new Error('This browser cannot encode video. Use Chrome or Edge.');
  const mb = await import('mediabunny');
  const canvas = document.createElement('canvas');
  canvas.width = VIDEO_W;
  canvas.height = VIDEO_H;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D is unavailable.');
  const clip = createTradeClip(ctx, assets, o.direction, o);
  const { draw, seconds, beats } = clip;
  const frames = Math.round(seconds * FPS);
  o.onPlanned?.({ beats, seconds });

  const codec = await mb.getFirstEncodableVideoCodec(['avc', 'vp9', 'vp8'], { width: canvas.width, height: canvas.height });
  if (!codec) throw new Error('No video encoder is available in this browser.');
  const mp4 = codec === 'avc';
  const output = new mb.Output({
    format: mp4 ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' }) : new mb.WebMOutputFormat(),
    target: new mb.BufferTarget(),
  });
  const source = new mb.CanvasSource(canvas, { codec, bitrate: 8_000_000, keyFrameInterval: 2, latencyMode: 'quality' });
  output.addVideoTrack(source, { frameRate: FPS });
  // The keyboard and the mouse, on their own track, when the browser can
  // encode one and the sound can be mixed. Neither is fatal: the clip still
  // goes out, silent.
  const audioCodec = await mb.getFirstEncodableAudioCodec(mp4 ? ['aac', 'opus'] : ['opus'], { numberOfChannels: 2, sampleRate: AUDIO_RATE, bitrate: 128_000 }).catch(() => null);
  let bed: AudioBuffer | null = null;
  if (audioCodec) {
    try { bed = await buildTradeAudio(clip, assets.person.name); } catch (err) { console.error('[trade video] sound skipped:', err); }
  }
  const audio = bed && audioCodec ? new mb.AudioBufferSource({ codec: audioCodec, bitrate: 128_000 }) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();
  try {
    for (let i = 0; i < frames; i++) {
      if (o.signal?.aborted) throw new DOMException('Render cancelled', 'AbortError');
      draw(i / FPS);
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
  const slug = safeExportName(assets.person.name).toLowerCase().replace(/\s+/g, '-') || 'pauv';
  return {
    blob: new Blob([buf], { type: mp4 ? 'video/mp4' : 'video/webm' }),
    filename: `pauv-${slug}-${o.direction}-${assets.theme}.${mp4 ? 'mp4' : 'webm'}`,
    beats,
    seconds,
  };
}
