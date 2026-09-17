// Turns a rendered News page into a PNG, in the browser, with nothing but the
// page itself: no server, no headless browser, so it works on any machine
// the Studio opens on.
//
//   1. The page is laid out in a hidden 1440px iframe so its real height is
//      known once fonts and logos have loaded.
//   2. Logos are swapped for data URLs and the Google Fonts it uses are fetched
//      and inlined (Latin subsets only), so nothing outside the image is needed.
//   3. The page is serialised as XHTML inside an SVG <foreignObject> and drawn
//      onto a canvas at `scale` device pixels per CSS pixel.
//
// Two ways in: rasterizeNewsPage gives the PNG the section shows and downloads;
// paintNewsPage gives the news recording (components/news/news-video.ts) a
// canvas instead, and lets it read the laid-out page first — where the name
// is, where the photos are — since the page is only ever a DOM in step 1.

import { PAGE_WIDTH, type RenderedPage } from './templates';

export interface NewsImage {
  blob: Blob;
  /** Size of the PNG in pixels. */
  width: number;
  height: number;
}

/** Browsers refuse canvases taller than 32,767px; a very long article is
 *  drawn at a slightly lower scale instead of failing. */
const MAX_CANVAS = 32_000;

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
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${page.fontsHref}"><style>html,body{margin:0;padding:0;}${page.css}</style></head><body>${page.html}</body></html>`;
  document.body.appendChild(frame);
  await loaded;
  const doc = frame.contentDocument!;
  await doc.fonts.ready;
  await Promise.all([...doc.images].map(img => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined))));
  const root = doc.querySelector<HTMLElement>('.np');
  if (!root) throw new Error('The page template has no .np root.');
  return { frame, root };
}

/** Steps 2 and 3: the laid-out page as one self-contained image, `height`
 *  CSS px tall. Swaps the page's images for data URLs in place. */
async function svgImageOf(root: HTMLElement, page: RenderedPage, height: number): Promise<HTMLImageElement> {
  // Logos and any other images become data URLs so the SVG is self-contained.
  for (const img of [...root.querySelectorAll('img')]) {
    const src = img.getAttribute('src');
    if (src && !src.startsWith('data:')) img.setAttribute('src', await toDataUrl(new URL(src, window.location.href).href));
  }
  const fontCss = await inlineFontCss(page.fontsHref);
  const markup = new XMLSerializer().serializeToString(root);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${height}">`
    + `<foreignObject x="0" y="0" width="${PAGE_WIDTH}" height="${height}">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${PAGE_WIDTH}px;height:${height}px;margin:0;">`
    + `<style>${xmlEscapeText(fontCss)}\n${xmlEscapeText(page.css)}</style>`
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

export async function rasterizeNewsPage(page: RenderedPage, scale = 1.5): Promise<NewsImage> {
  const { frame, root } = await layOut(page);
  try {
    const height = Math.ceil(root.getBoundingClientRect().height);
    const image = await svgImageOf(root, page, height);
    const drawScale = Math.min(scale, MAX_CANVAS / height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(PAGE_WIDTH * drawScale);
    canvas.height = Math.round(height * drawScale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No canvas to draw on.');
    ctx.scale(drawScale, drawScale);
    ctx.drawImage(image, 0, 0, PAGE_WIDTH, height);
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
    const image = await svgImageOf(root, page, pageHeight);
    const drawScale = Math.min(o.scale, MAX_CANVAS / height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(PAGE_WIDTH * drawScale);
    canvas.height = Math.round(height * drawScale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No canvas to draw on.');
    ctx.scale(drawScale, drawScale);
    ctx.drawImage(image, 0, 0, PAGE_WIDTH, pageHeight);
    return { canvas, scale: drawScale, height, pageHeight, measured };
  } finally {
    frame.remove();
  }
}
