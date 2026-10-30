import type { Metadata, Viewport } from 'next';
import FillerClient from './FillerClient';
import './filler.css';

// angelstyle.com/filler — the two-player color-flood game, played against a
// bot. Standalone: outside the (studio) group, so no sidebar. Public (no site
// password, see src/middleware.ts) and cached by public/filler-sw.js so it
// opens with no connection once it has been visited.

export const metadata: Metadata = {
  title: 'Filler',
  description: 'Flood the board with your color before the bot does.',
  manifest: '/filler/manifest.webmanifest',
  icons: { icon: '/filler/icon-192.png', apple: '/filler/icon-180.png' },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Filler' },
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
  return <FillerClient />;
}
