import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Fraunces } from 'next/font/google';
import SloanPage from './SloanPage';
import Gate from './Gate';
import './sloan.css';

// angelstyle.com/Sloan — Claude says hello to Dr. E (Ellis Sloan, CFA, the
// finance professor at Harding University in Searcy, Arkansas), on an iPhone
// and nowhere else. Public: no site password (see src/middleware.ts). Any
// other device gets a closed door with a QR code on it (Gate.tsx).
//
// The device check reads the request's User-Agent on the server, so the
// decision is made before a byte of the page is sent and nothing flashes.

export const dynamic = 'force-dynamic';

const fraunces = Fraunces({
  variable: '--font-fraunces',
  subsets: ['latin'],
  weight: ['300', '400', '600', '700', '900'],
  style: ['normal', 'italic'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Hey Dr. E, I’m Claude',
  description: 'A page Claude Fable 5.1 built for Ellis Sloan, CFA, of Harding University. iPhone only.',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Dr. E' },
  openGraph: { title: 'Hey Dr. E, I’m Claude', description: 'Open this on an iPhone.', type: 'website' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0b0f1a',
};

export default async function Page() {
  const ua = (await headers()).get('user-agent') || '';
  const iphone = /iPhone/i.test(ua);
  return (
    <div className={`sloan-root ${fraunces.variable}`}>
      {iphone ? <SloanPage /> : <Gate ua={ua} />}
    </div>
  );
}
