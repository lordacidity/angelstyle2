// Single source of truth for the URL <-> section mapping. Both the Sidebar
// (links) and StudioShell (derives the active section from the pathname) import
// from here so the two can never drift.

import type { AppSection, VideoMode } from '@/app/types';

// Each left-nav section's canonical path. 'template' doubles as the app root.
export const SECTION_PATHS: Record<AppSection, string> = {
  template: '/template',
  deck: '/deck',
  media: '/media',
  builder: '/builder',
  trending: '/trending',
  images: '/images',
  board: '/board',
  schedule: '/schedule',
  ai: '/ai-cards', // '/ai' is taken by the standalone legacy page
};

export function pathForSection(s: AppSection): string {
  return SECTION_PATHS[s] ?? '/template';
}

// Reverse lookup. '/', '/template' and '/template/<style>' all map to template.
export function sectionFromPath(pathname: string): AppSection {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/' || p === '/template' || p.startsWith('/template/')) return 'template';
  for (const [section, path] of Object.entries(SECTION_PATHS) as [AppSection, string][]) {
    if (p === path) return section;
  }
  return 'template';
}

// Template-style sub-routes: /template/twitter | caption | carousel.
export const TEMPLATE_STYLES = ['twitter', 'caption', 'carousel'] as const;

export function parseStyle(pathname: string): VideoMode | null {
  const m = pathname.replace(/\/+$/, '').match(/^\/template\/([^/]+)$/);
  if (!m) return null;
  return (TEMPLATE_STYLES as readonly string[]).includes(m[1]) ? (m[1] as VideoMode) : null;
}
