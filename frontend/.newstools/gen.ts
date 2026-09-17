// Renders one outlet's page to an HTML file, the way the News section does:
// search for a name, read the story from the outlet, collect the rail, then
// lay it out with the outlet's template. Photos are free Commons scenes
// dropped straight into the slots (the app crops them first; cover-fit here
// comes out the same size).
import { searchApprovedNews } from '../src/lib/news/google-news';
import { searchImdbNews, imdbRail, imdbIdOf } from '../src/lib/news/imdb';
import { readNewsArticle } from '../src/lib/news/read-article';
import { latestFromOutlet } from '../src/lib/news/google-news';
import { renderNewsPage, PHOTO_SLOTS, type PagePhotos } from '../src/lib/news/templates';
import type { NewsHit, OutletId, RailItem } from '../src/lib/news/types';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const UA = 'PauvNewsPreview/1.0 (distribution@pauv.com)';

async function commons(search: string, limit: number, width: number): Promise<string[]> {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query', format: 'json', generator: 'search', gsrnamespace: '6',
    gsrlimit: String(limit), gsrsearch: `${search} filetype:bitmap`,
    prop: 'imageinfo', iiprop: 'url|size|mime', iiurlwidth: String(width),
  }).toString();
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  const pages = ((await res.json()) as { query?: { pages?: Record<string, { index: number; imageinfo?: { thumburl?: string; mime: string }[] }> } }).query?.pages ?? {};
  return Object.values(pages)
    .sort((a, b) => a.index - b.index)
    .map(p => p.imageinfo?.[0])
    .filter((i): i is { thumburl: string; mime: string } => !!i?.thumburl && /^image\/(jpeg|png|webp)$/.test(i.mime))
    .map(i => i.thumburl);
}

async function photosFor(outlet: OutletId, topic: string): Promise<PagePhotos> {
  const slots = PHOTO_SLOTS[outlet];
  const wide = await commons(topic, 12, 1200);
  const small = await commons('film premiere red carpet', 14, 400);
  return {
    hero: wide[0] ? { src: wide[0], credit: 'Photo: Wikimedia Commons (CC BY-SA 4.0)' } : null,
    thumbs: slots.thumbs.map((_, i) => small[i % Math.max(1, small.length)] ?? wide[(i + 1) % Math.max(1, wide.length)] ?? null),
  };
}

const PAGE = (title: string, fontsHref: string, css: string, html: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="${fontsHref}">
<style>html,body{margin:0;padding:0;background:#fff}${css}</style>
</head><body>${html}</body></html>`;

async function main() {
  const [, , outlet, name, out] = process.argv as [string, string, OutletId, string, string];
  let hits: NewsHit[];
  if (outlet === 'imdb') hits = await searchImdbNews(name, '30d');
  else hits = await searchApprovedNews(name, [outlet], '30d');
  if (!hits.length) throw new Error(`No ${outlet} stories about ${name}.`);

  let article = null;
  let picked: NewsHit | null = null;
  for (const h of hits.slice(0, 6)) {
    try {
      article = await readNewsArticle(h.url);
      picked = h;
      break;
    } catch (err) {
      console.log('  skipped', h.url, String(err instanceof Error ? err.message : err).slice(0, 90));
    }
  }
  if (!article || !picked) throw new Error('Could not read any story.');

  let rail: RailItem[] = [];
  if (outlet === 'imdb') rail = await imdbRail(imdbIdOf(new URL(article.url)) ?? '');
  else rail = await latestFromOutlet(outlet, article.headline).catch(() => []);

  const photos = await photosFor(outlet, outlet === 'imdb' ? 'movie theater interior' : 'red carpet event');
  const page = renderNewsPage(article, rail, photos, new Date());
  // The logos are served from /news/... by the app; from a file:// page they
  // have to point at public/.
  const html = page.html.replace(/src="\/news\//g, `src="${pathToFileURL(resolve('public/news')).href}/`);
  writeFileSync(out, PAGE(article.headline, page.fontsHref, page.css, html), 'utf8');
  console.log(JSON.stringify({
    outlet, url: article.url, headline: article.headline, byline: article.byline,
    published: article.publishedAt, source: article.sourceName, dek: article.dek,
    paragraphs: article.paragraphs.length, keyPoints: article.keyPoints.length,
    rail: rail.length, notes: article.notes,
  }, null, 1));
}

main().catch(err => { console.error('FAILED', err); process.exit(1); });
