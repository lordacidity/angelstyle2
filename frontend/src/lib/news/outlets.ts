// The approved outlets. Search only ever returns stories from these, and a
// story only renders if its URL is one of their article pages.

import type { OutletId } from './types';

export interface Outlet {
  id: OutletId;
  name: string;
  /** Hostnames that belong to the outlet (subdomains included). */
  hosts: string[];
  /** Brand colour for the Studio UI (not the rendered page). */
  color: string;
}

export const OUTLETS: Outlet[] = [
  { id: 'espn', name: 'ESPN', hosts: ['espn.com'], color: '#d00' },
  { id: 'cnn', name: 'CNN', hosts: ['cnn.com'], color: '#cc0000' },
  { id: 'fox', name: 'Fox News', hosts: ['foxnews.com'], color: '#003366' },
  { id: 'nyt', name: 'The New York Times', hosts: ['nytimes.com'], color: '#121212' },
  { id: 'tmz', name: 'TMZ', hosts: ['tmz.com'], color: '#d8000f' },
  { id: 'bbc', name: 'BBC', hosts: ['bbc.com', 'bbc.co.uk'], color: '#141414' },
];

export const OUTLET_IDS = OUTLETS.map(o => o.id);

export function outletById(id: OutletId): Outlet {
  return OUTLETS.find(o => o.id === id)!;
}

export function isOutletId(v: unknown): v is OutletId {
  return typeof v === 'string' && (OUTLET_IDS as string[]).includes(v);
}

/** Which approved outlet a hostname belongs to, or null. */
export function outletForHost(host: string): OutletId | null {
  const h = host.toLowerCase().replace(/\.$/, '');
  for (const o of OUTLETS) {
    if (o.hosts.some(x => h === x || h.endsWith('.' + x))) return o.id;
  }
  return null;
}

/** The Athletic publishes on nytimes.com under /athletic/<id>/...; its stories
 *  render as Times pages. Null for anything that isn't an Athletic article. */
export function athleticId(url: URL): string | null {
  return url.pathname.match(/^\/athletic\/(\d+)\//)?.[1] ?? null;
}

/** Why a URL on an approved outlet isn't an article page we can render, or
 *  null when it is. Video, audio and live pages are refused rather than
 *  dressed up as articles; search leaves them out altogether. */
export function articleUrlProblem(outlet: OutletId, url: URL): string | null {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  switch (outlet) {
    case 'espn':
      return /\/id\/\d+/.test(path) ? null : 'That ESPN link is not a story page.';
    case 'cnn':
      if (/\/(videos?|audio|interactive|gallery)\//.test(path)) return 'That CNN link is a video or interactive page, not an article.';
      return /\/\d{4}\/\d{2}\/\d{2}\//.test(path) ? null : 'That CNN link is not an article page.';
    case 'fox':
      if (host !== 'www.foxnews.com' && host !== 'foxnews.com') return 'That Fox link is not a foxnews.com article.';
      if (/^\/(video|videos|shows|live)\b/.test(path)) return 'That Fox link is a video page, not an article.';
      return path.split('/').filter(Boolean).length >= 2 ? null : 'That Fox link is not an article page.';
    case 'nyt':
      if (path.startsWith('/athletic/')) return athleticId(url) ? null : 'That Athletic link is not an article page.';
      if (/\/(video|interactive|slideshow|podcasts?)\//.test(path)) return 'That Times link is a video or interactive page, not an article.';
      return /\/\d{4}\/\d{2}\/\d{2}\//.test(path) ? null : 'That Times link is not an article page.';
    case 'tmz':
      if (/\/(watch|photos?)\//.test(path)) return 'That TMZ link is a video or gallery, not an article.';
      return /^\/\d{4}\/\d{2}\/\d{2}\//.test(path) ? null : 'That TMZ link is not an article page.';
    case 'bbc':
      if (/\/(audio|videos?|sounds|iplayer|live)\//.test(path)) return 'That BBC link is audio, video or a live page, not an article.';
      return /\/articles\/|\/news\/[a-z-]+-\d{6,}/.test(path) ? null : 'That BBC link is not an article page.';
  }
}
