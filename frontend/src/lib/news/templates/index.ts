// Picks the outlet's template and returns the page ready for rasterize.ts.

import type { NewsArticle, OutletId, RailItem } from '../types';
import { NO_PHOTOS, type PagePhotos, type RenderedPage } from './shared';
import { renderBbc } from './bbc';
import { renderCnn } from './cnn';
import { renderEspn } from './espn';
import { renderFox } from './fox';
import { renderNyt } from './nyt';
import { renderTmz } from './tmz';

export { NO_PHOTOS, PAGE_WIDTH, PHOTO_SLOTS, type PagePhotos, type PhotoSize, type RenderedPage } from './shared';

const TEMPLATES: Record<OutletId, (a: NewsArticle, rail: RailItem[], now: Date, photos: PagePhotos) => RenderedPage> = {
  espn: renderEspn, cnn: renderCnn, fox: renderFox, nyt: renderNyt, tmz: renderTmz, bbc: renderBbc,
};

/** Templates write plain selectors; every one is scoped under `.np` so a page
 *  can't reach anything outside itself. `.np` rules are left as they are. */
export function scopeCss(css: string): string {
  return css.replace(/(^|})(\s*)([^{}@]+)\{/g, (_m, close: string, space: string, selectors: string) => {
    const scoped = selectors
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => (s === '.np' || s.startsWith('.np ') || s.startsWith('.np.') || s.startsWith('.np-') ? s : `.np ${s}`))
      .join(', ');
    return `${close}${space}${scoped} {`;
  });
}

export function renderNewsPage(article: NewsArticle, rail: RailItem[], photos: PagePhotos = NO_PHOTOS, now = new Date()): RenderedPage {
  const page = TEMPLATES[article.outlet](article, rail, now, photos);
  return { ...page, css: scopeCss(page.css) };
}
