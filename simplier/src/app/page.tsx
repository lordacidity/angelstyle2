'use client';

// The whole app: the Vids builder, full screen. There is one section and no
// nav, so it lives at the root rather than behind a route.

import { ErrorBoundary } from './components/ErrorBoundary';
import { VidsSection } from './components/vids/VidsSection';

export default function Page() {
  return (
    <div className="flex h-screen flex-col bg-[#0f0f0f] text-white">
      <div className="min-h-0 flex-1">
        <ErrorBoundary>
          <VidsSection active />
        </ErrorBoundary>
      </div>
    </div>
  );
}
