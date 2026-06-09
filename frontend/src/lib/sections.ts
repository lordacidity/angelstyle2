// Single source of truth for the URL <-> section mapping. Both the Sidebar
// (links) and StudioShell (derives the active section from the pathname) import
// from here so the two can never drift.

import type { AppSection } from '@/app/types';

// Each left-nav section's canonical path. 'brandkit' doubles as the app root.
export const SECTION_PATHS: Record<AppSection, string> = {
  brandkit: '/brand-kit',
  deck: '/deck',
  media: '/media',
  builder: '/builder',
  trending: '/trending',
  images: '/images',
  board: '/board',
  schedule: '/schedule',
  ai: '/ai-cards', // '/ai' is taken by the standalone legacy page
  prompts: '/ai-prompts',
  pricer: '/pricer',
};

export function pathForSection(s: AppSection): string {
  return SECTION_PATHS[s] ?? '/brand-kit';
}

// Reverse lookup. '/' and '/brand-kit' both map to the Brand Kit landing.
export function sectionFromPath(pathname: string): AppSection {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/' || p === '/brand-kit') return 'brandkit';
  for (const [section, path] of Object.entries(SECTION_PATHS) as [AppSection, string][]) {
    if (p === path) return section;
  }
  return 'brandkit';
}
