// The clipper page — Vids 2 on its own, and nothing else.
//
// This is what pauv.io/clipping serves. It is the same Vids2Section the Studio
// renders, mounted straight rather than through StudioShell: no sidebar, no
// brand kit, no board, no phone feed — none of which a clipper has any business
// with, and all of which would drag Supabase and the rest of the Studio into a
// page that only builds videos.
//
// The route is reachable in the Studio build too (angelstyle.com/clippers),
// which is how you see what a clipper sees without deploying. In the clipper
// build middleware sends the site root here and refuses everything else, so
// pauv.io/clipping lands on this page. See src/lib/clipping.ts.
//
// Most clippers open it on a phone. The window is measured in dvh rather than
// vh (.vids2-screen) so the foot of the page is the foot of the screen with
// Safari's bars showing, and the viewport is pinned at 1× so that pressing a
// box to type in it does not zoom the page — iOS does that for any box whose
// type is under 16px, and every box on the form is. Pinching still zooms.
import type { Viewport } from 'next';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { Vids2Section } from '../components/vids2/Vids2Section';

export const metadata = {
  title: 'Pauv — Clipping',
  description: 'Build a Pauv video.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // Out to the edges of a phone with a notch, so the black page is behind the
  // home bar rather than a white band; the buttons at the foot of either page
  // pad themselves clear of it (env(safe-area-inset-bottom)).
  viewportFit: 'cover',
};

export default function ClippersPage() {
  return (
    <ErrorBoundary>
      {/* Laid out as the Studio lays Vids 2 out: plain black, filling the window. */}
      <div className="vids2-screen flex flex-col bg-black">
        <div className="flex-1 min-h-0">
          <Vids2Section active />
        </div>
      </div>
    </ErrorBoundary>
  );
}
