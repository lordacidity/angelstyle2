'use client';

import dynamic from 'next/dynamic';

const FillerGame = dynamic(() => import('./FillerGame'), { ssr: false });

export default function FillerClient() {
  return <FillerGame />;
}
