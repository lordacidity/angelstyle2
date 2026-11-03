import type { Metadata, Viewport } from 'next';
import PathClient from './PathClient';

// angelstyle.com/path: a tower defense for one thumb. Standalone (no sidebar)
// and public, like /filler and /knockout.

export const metadata: Metadata = {
  title: 'PATH',
  description: 'Hold the road.',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'PATH' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#000000',
};

export default function Page() {
  return <PathClient />;
}
