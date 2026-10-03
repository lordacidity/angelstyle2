import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { GAME_KEY } from '@/lib/game-key';
import Game from './Game';

// REDLINE — a phone game, reachable at one exact link (lib/game-key). Any
// other address for this page is a 404, before and after the site password.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'REDLINE',
  description: 'Hold the line.',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'REDLINE' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#000000',
};

export default async function GamePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { k } = await searchParams;
  if (k !== GAME_KEY) notFound();
  return <Game />;
}
