'use client';

import dynamic from 'next/dynamic';

// The AI-maker (Aier) feature, merged into Studio as a native route. It's a ported Vite SPA,
// so we load it client-only (ssr: false) to avoid server-rendering its browser-only code.
// Full-page dark UI reached from the sidebar AI button; backend lives at /api/aier/*.
const AierApp = dynamic(() => import('./_app/AierApp.jsx'), { ssr: false });

export default function AiMakerPage() {
  return <AierApp />;
}
