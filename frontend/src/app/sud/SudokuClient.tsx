'use client';

import dynamic from 'next/dynamic';

// The game lives in localStorage and makes its puzzles on the device, so
// there is nothing to prerender: load it on the client only.
const SudokuGame = dynamic(() => import('./SudokuGame'), { ssr: false });

export default function SudokuClient() {
  return <SudokuGame />;
}
