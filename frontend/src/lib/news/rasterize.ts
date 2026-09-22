// Turns a rendered News page into a PNG, in the browser, with nothing but the
// page itself: no server, no headless browser, so it works on any machine
// the Studio opens on.
//
//   1. The page is laid out in a hidden 1440px iframe so its real height is
//      known once fonts and logos have loaded.
//   2. The Google Fonts it uses are fetched and inlined (Latin subsets only),
//      and every picture on it — the photos, the logos — is taken off the
//      page and kept, with where it sat, leaving a plain box of the same size
//      in its place, so the page is text and CSS and nothing else.
//   3. The page is serialised as XHTML inside an SVG <foreignObject> and drawn
//      onto a canvas at `scale` device pixels per CSS pixel; then the pictures
//      are drawn onto the canvas by hand, each where its box was.
//
// The pictures are drawn by hand because an <img> inside a foreignObject is
// the one thing the SVG route cannot be trusted with: WebKit (every browser on
// an iPhone) renders the text and the CSS of such an SVG and leaves the
// pictures out, or leaves them out on the first draw. A box on the page and a
// drawImage onto the canvas are the same on every browser. The photos are
// composited through a key rather than pasted over, so what the page prints
// on top of a photo — the BBC's credit box, People's rank number — stays on
// top (see compositeMatte).
//
// Two ways in: rasterizeNewsPage gives the PNG the section shows and downloads;
// paintNewsPage gives the news recording (components/news/news-video.ts) a
// canvas instead, and lets it read the laid-out page first — where the name
// is, where the photos are — since the page is only ever a DOM in step 1.

import { PAGE_WIDTH, type RenderedPage } from './templates';
import { BASE_PATH, withBase } from '@/lib/clipping';

/** The templates write their logos as <img src="/news/…">, a path this app
 *  serves. In the clipper build it serves them under /clipping, so the markup
 *  is rebased on the way into the frame — here rather than in each template,
 *  so a new outlet cannot be added without it. */
const rebase = (html: string) => (BASE_PATH ? html.replace(/(\ssrc=")\/(?!\/)/g, `$1${BASE_PATH}/`) : html);

export interface NewsImage {
  blob: Blob;
  /** Size of the PNG in pixels. */
  width: number;
  height: number;
}

/** Browsers refuse canvases taller than 32,767px; a very long article is
 *  drawn at a slightly lower scale instead of failing. */
const MAX_CANVAS = 32_000;
/** And phones refuse canvases past about sixteen million pixels (iOS), so a
 *  long article is drawn at a lower scale on the way there too. */
const MAX_PIXELS = 15_000_000;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

const dataUrlCache = new Map<string, Promise<string>>();
function toDataUrl(url: string): Promise<string> {
  let p = dataUrlCache.get(url);
  if (!p) {
    p = fetch(url).then(res => {
      if (!res.ok) throw new Error(`${url} answered ${res.status}`);
      return res.blob();
    }).then(blobToDataUrl);
    p.catch(() => dataUrlCache.delete(url));
    dataUrlCache.set(url, p);
  }
  return p;
}

const fontCssCache = new Map<string, Promise<string>>();
/** The Google Fonts stylesheet with its Latin font files inlined. */
function inlineFontCss(href: string): Promise<string> {
  let p = fontCssCache.get(href);
  if (!p) {
    p = (async () => {
      const css = await (await fetch(href)).text();
      // Google labels each block with its subset; keep the Latin ones.
      const blocks = css.split(/(?=\/\*\s*[\w-]+\s*\*\/)/).filter(b => /^\/\*\s*latin\s*\*\//.test(b.trim()));
      const kept = blocks.length ? blocks : [css];
      const out: string[] = [];
      for (const block of kept) {
        const urls = [...block.matchAll(/url\((['"]?)(https:[^)'"]+)\1\)/g)].map(m => m[2]);
        let b = block;
        for (const u of urls) b = b.split(u).join(await toDataUrl(u));
        out.push(b);
      }
      return out.join('\n');
    })();
    p.catch(() => fontCssCache.delete(href));
    fontCssCache.set(href, p);
  }
  return p;
}

function xmlEscapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

async function layOut(page: RenderedPage): Promise<{ frame: HTMLIFrameElement; root: HTMLElement }> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = `position:fixed;left:-100000px;top:0;width:${PAGE_WIDTH}px;height:900px;border:0;visibility:hidden;pointer-events:none;`;
  const loaded = new Promise<void>(resolve => frame.addEventListener('load', () => resolve(), { once: true }));
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${page.fontsHref}"><style>html,body{margin:0;padding:0;}${page.css}</style></head><body>${rebase(page.html)}</body></html>`;
  document.body.appendChild(frame);
  await loaded;
  const doc = frame.contentDocument!;
  await doc.fonts.ready;
  await Promise.all([...doc.images].map(img => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined))));
  const root = doc.querySelector<HTMLElement>('.np');
  if (!root) throw new Error('The page template has no .np root.');
  return { frame, root };
}

// ── The pictures ────────────────────────────────────────────────────────────

/** The two colours a photo's box is painted in the two draws of the page.
 *  Nothing a template paints is either of them. */
const KEY_A = '#ff00fe';
const KEY_B = '#00ff01';

/** A picture taken off the page: its bytes, and its box in the page's CSS px. */
interface Placed {
  src: string;
  x: number; y: number; w: number; h: number;
  /** True for the photos (opaque JPEGs the page may print on top of): they
   *  go in through the key. A logo is drawn straight on, over the page. */
  matte: boolean;
}

/** Every <img> on the page swapped for a <div> in the same box — the same
 *  computed style, so the layout does not move — and the picture kept, with
 *  where it sat. A photo's box is painted the key; a logo's is left clear, so
 *  what the page paints behind the logo (TMZ's black bar) is there for it to
 *  be drawn over. Run after the page has been measured: the measuring reads
 *  the <img>s. */
async function detachImages(root: HTMLElement): Promise<Placed[]> {
  const base = root.getBoundingClientRect();
  const win = root.ownerDocument.defaultView ?? window;
  const out: Placed[] = [];
  for (const img of [...root.querySelectorAll('img')]) {
    const r = img.getBoundingClientRect();
    const src = img.getAttribute('src') ?? '';
    const bytes = src.startsWith('data:')
      ? src
      : await toDataUrl(new URL(withBase(src), window.location.href).href).catch(() => '');
    const matte = img.classList.contains('np-img');
    const cs = win.getComputedStyle(img);
    const style: string[] = [];
    for (let i = 0; i < cs.length; i++) {
      const prop = cs[i];
      // The box is set below, from the measured rectangle; the background is
      // the key or nothing; what was the picture's fit means nothing to a div.
      if (/^(width|height|inline-size|block-size|min-|max-|background|object-)/.test(prop)) continue;
      style.push(`${prop}:${cs.getPropertyValue(prop)}`);
    }
    style.push(
      `display:${cs.display === 'inline' ? 'inline-block' : cs.display}`,
      `width:${r.width}px`, `height:${r.height}px`, 'box-sizing:border-box',
      `background:${matte ? KEY_A : 'transparent'}`,
    );
    const box = img.ownerDocument.createElement('div');
    box.className = img.className;
    if (img.id) box.id = img.id;
    box.setAttribute('style', style.join(';'));
    img.replaceWith(box);
    if (bytes && r.width > 0 && r.height > 0) {
      out.push({ src: bytes, x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height, matte });
    }
  }
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('A picture on the page could not be drawn.'));
    img.src = src;
  });
}

/** The page as one self-contained SVG image, `height` CSS px tall. */
async function svgImage(markup: string, fontCss: string, css: string, height: number): Promise<HTMLImageElement> {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${height}">`
    + `<foreignObject x="0" y="0" width="${PAGE_WIDTH}" height="${height}">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${PAGE_WIDTH}px;height:${height}px;margin:0;">`
    + `<style>${xmlEscapeText(fontCss)}\n${xmlEscapeText(css)}</style>`
    + markup
    + `</div></foreignObject></svg>`;
  // A data: URL, not a blob: one: Chrome lets a canvas export an SVG
  // <foreignObject> drawing only when the SVG came from a data URL.
  const image = new Image();
  image.decoding = 'sync';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The page could not be drawn as an image.'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  // Give the SVG's embedded fonts a moment to apply before it is drawn.
  await image.decode().catch(() => undefined);
  await new Promise(r => setTimeout(r, 150));
  return image;
}

/** A photo into its box on the canvas, under whatever the page printed over
 *  it. The page was drawn twice, the box painted KEY_A and then KEY_B: where
 *  the two draws differ, the key showed through, by exactly how much — a
 *  pixel entirely the key, one half covered by a credit box, an edge pixel
 *  the box only reaches into — and that share of each pixel is where the
 *  photo goes. Exact for anything the page paints on top, whatever its
 *  colour or transparency, since only the key changed between the draws. */
function compositeMatte(
  ctx: CanvasRenderingContext2D, second: CanvasRenderingContext2D, secondTop: number,
  photo: HTMLImageElement, p: Placed, s: number, W: number, H: number,
) {
  const x0 = Math.max(0, Math.floor(p.x * s));
  const y0 = Math.max(0, Math.floor(p.y * s));
  const x1 = Math.min(W, Math.ceil((p.x + p.w) * s));
  const y1 = Math.min(H, Math.ceil((p.y + p.h) * s));
  if (x1 <= x0 || y1 <= y0) return;
  const w = x1 - x0;
  const h = y1 - y0;
  const pc = document.createElement('canvas');
  pc.width = w;
  pc.height = h;
  const pctx = pc.getContext('2d')!;
  pctx.imageSmoothingQuality = 'high';
  pctx.drawImage(photo, p.x * s - x0, p.y * s - y0, p.w * s, p.h * s);
  const a = ctx.getImageData(x0, y0, w, h);
  const b = second.getImageData(x0, y0 - secondTop, w, h);
  const q = pctx.getImageData(0, 0, w, h).data;
  const A = a.data;
  const B = b.data;
  for (let i = 0; i < A.length; i += 4) {
    // How much of this pixel the key showed through: KEY_A and KEY_B are 255
    // apart in red and in green, so each says, and the two are averaged.
    const c = ((A[i] - B[i]) + (B[i + 1] - A[i + 1])) / 510;
    if (c <= 0) continue;
    // What was drawn is (page over key); the same page over the photo is
    // that, less the key's share, plus the photo's.
    A[i] += c * (q[i] - 255);
    A[i + 1] += c * q[i + 1];
    A[i + 2] += c * (q[i + 2] - 254);
  }
  ctx.putImageData(a, x0, y0);
}

/** Steps 2 and 3: the laid-out page drawn onto `ctx`, which is scaled to
 *  `s` device px per CSS px and holds `heightCss` px of the page from the
 *  top. Takes the pictures off the page in place. */
async function drawPage(ctx: CanvasRenderingContext2D, root: HTMLElement, page: RenderedPage, pageHeight: number, s: number, heightCss: number) {
  const placed = await detachImages(root);
  const fontCss = await inlineFontCss(page.fontsHref);
  const markup = new XMLSerializer().serializeToString(root);
  const mattes = placed.filter(p => p.matte);
  const [first, second] = await Promise.all([
    svgImage(markup, fontCss, page.css, pageHeight),
    mattes.length ? svgImage(markup.split(KEY_A).join(KEY_B), fontCss, page.css, pageHeight) : null,
  ]);
  ctx.drawImage(first, 0, 0, PAGE_WIDTH, pageHeight);

  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  if (second) {
    // The second draw, over the band the photos are in and no more: a page
    // is a lot of pixels, and a phone has only so many to give.
    const top = Math.max(0, Math.floor(Math.min(...mattes.map(p => p.y)) * s));
    const bottom = Math.min(H, Math.ceil(Math.max(...mattes.map(p => p.y + p.h)) * s));
    if (bottom > top) {
      const scratch = document.createElement('canvas');
      scratch.width = W;
      scratch.height = bottom - top;
      const sctx = scratch.getContext('2d')!;
      sctx.translate(0, -top);
      sctx.scale(s, s);
      sctx.drawImage(second, 0, 0, PAGE_WIDTH, pageHeight);
      for (const p of mattes) {
        if (p.y * s >= heightCss * s) continue;
        try { compositeMatte(ctx, sctx, top, await loadImage(p.src), p, s, W, H); } catch { /* that photo stays a box */ }
      }
      scratch.width = 0;
      scratch.height = 0;
    }
  }
  // The logos, straight on: nothing on a page is printed over one.
  ctx.imageSmoothingQuality = 'high';
  for (const p of placed) {
    if (p.matte || p.y >= heightCss) continue;
    try { ctx.drawImage(await loadImage(p.src), p.x, p.y, p.w, p.h); } catch { /* left clear */ }
  }
}

/** The scale a page can be drawn at: what was asked for, unless the canvas
 *  would be too tall or too many pixels for the browser. */
const drawScaleFor = (scale: number, heightCss: number) =>
  Math.min(scale, MAX_CANVAS / heightCss, Math.sqrt(MAX_PIXELS / (PAGE_WIDTH * heightCss)));

export async function rasterizeNewsPage(page: RenderedPage, scale = 1.5): Promise<NewsImage> {
  const { frame, root } = await layOut(page);
  try {
    const height = Math.ceil(root.getBoundingClientRect().height);
    const drawScale = drawScaleFor(scale, height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(PAGE_WIDTH * drawScale);
    canvas.height = Math.round(height * drawScale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No canvas to draw on.');
    ctx.scale(drawScale, drawScale);
    await drawPage(ctx, root, page, height, drawScale, height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The image could not be saved.');
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    frame.remove();
  }
}

export interface PaintOptions<M> {
  /** Device pixels per CSS pixel. */
  scale: number;
  /** Runs against the laid-out page before it is drawn; the DOM is real here
   *  (fonts loaded, images decoded), so boxes measure true. */
  measure: (root: HTMLElement) => M;
  /** How much of the page, from the top, to actually paint (CSS px) — a
   *  recording that never scrolls past a point has no use for the rest.
   *  Left out, the whole page. */
  heightFor?: (measured: M, pageHeight: number) => number;
}
export interface PaintedPage<M> {
  canvas: HTMLCanvasElement;
  /** Device pixels per CSS pixel the canvas was drawn at. */
  scale: number;
  /** CSS px of the page the canvas holds, from the top. */
  height: number;
  /** The whole page's height in CSS px. */
  pageHeight: number;
  measured: M;
}

/** The page on a canvas, plus whatever `measure` read off its layout. */
export async function paintNewsPage<M>(page: RenderedPage, o: PaintOptions<M>): Promise<PaintedPage<M>> {
  const { frame, root } = await layOut(page);
  try {
    const pageHeight = Math.ceil(root.getBoundingClientRect().height);
    const measured = o.measure(root);
    const height = Math.max(1, Math.min(pageHeight, Math.ceil(o.heightFor?.(measured, pageHeight) ?? pageHeight)));
    const drawScale = drawScaleFor(o.scale, height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(PAGE_WIDTH * drawScale);
    canvas.height = Math.round(height * drawScale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No canvas to draw on.');
    ctx.scale(drawScale, drawScale);
    await drawPage(ctx, root, page, pageHeight, drawScale, height);
    return { canvas, scale: drawScale, height, pageHeight, measured };
  } finally {
    frame.remove();
  }
}
