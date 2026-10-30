import type { Metadata, Viewport } from 'next';
import KnockoutGame from './KnockoutGame';
import './knockout.css';

// angelstyle.com/knockout: Red vs Black on a round board, pass-and-play on one
// phone. Standalone (no sidebar) and public, like /filler.

export const metadata: Metadata = {
  title: 'Knockout',
  description: 'Shove the other color off the board.',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Knockout' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#141416',
};

export default function Page() {
  return <KnockoutGame />;
}
