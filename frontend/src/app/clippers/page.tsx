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
import { ErrorBoundary } from '../components/ErrorBoundary';
import { Vids2Section } from '../components/vids2/Vids2Section';

export const metadata = {
  title: 'Pauv — Clipping',
  description: 'Build a Pauv video.',
};

export default function ClippersPage() {
  return (
    <ErrorBoundary>
      {/* Laid out as the Studio lays Vids 2 out: plain black, filling the window. */}
      <div className="flex flex-col h-screen">
        <div className="flex-1 min-h-0">
          <Vids2Section active />
        </div>
      </div>
    </ErrorBoundary>
  );
}
