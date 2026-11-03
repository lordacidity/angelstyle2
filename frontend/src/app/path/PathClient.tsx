'use client';

import dynamic from 'next/dynamic';

// The game lives in the browser alone (canvas, localStorage), so nothing to prerender.
const PathGame = dynamic(() => import('./PathGame'), { ssr: false });

export default function PathClient() {
  return <PathGame />;
}
