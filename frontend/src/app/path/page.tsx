import type { Metadata, Viewport } from 'next';
import PathClient from './PathClient';

// angelstyle.com/path: a tower defense for one thumb. Standalone (no sidebar)
// and public, like /filler and /knockout.

export const metadata: Metadata = {
  title: 'PATH',
  description: 'Keep the balls off the end of the road.',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'PATH' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0f0f11',
};

export default function Page() {
  return <PathClient />;
}
