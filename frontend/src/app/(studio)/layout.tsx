// Route-group layout for all Studio sections. It renders the persistent
// StudioShell, which stays mounted across child-route navigations (that's what
// preserves the live phone feed, AI wizard, video rows and scroll). The child
// `page.tsx` files are thin null markers — the shell renders the actual content
// based on the URL.
import { StudioShell } from '../StudioShell';
import { CLIPPERS } from '@/lib/clipping';

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  // The clipper build serves none of this. Middleware already 404s every Studio
  // path there, and rewrites its site root to /clippers — but middleware runs
  // only when the request reaches it, and these pages are statically
  // prerendered: a cache holding one could answer for it first. That is not
  // theory, it is what once served the whole shell at pauv.io/clipping,
  // unauthenticated. So the shell is never rendered in that build — every page
  // in this group prerenders to an empty document and hydrates into nothing,
  // which leaves a stale copy of one with nothing to show.
  if (CLIPPERS) return null;

  return (
    <>
      <StudioShell />
      {children}
    </>
  );
}
