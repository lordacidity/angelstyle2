import type { Metadata, Viewport } from 'next';
import { Fraunces } from 'next/font/google';
import SloanPage from './SloanPage';
import './sloan.css';

// angelstyle.com/Sloan — a one-page tribute to Dr. E (Ellis Sloan, CFA), the
// finance professor at Harding University in Searcy, Arkansas. Public: no site
// password (see src/middleware.ts). Built by Claude Fable 5.1 in one sitting,
// from public sources, to show the professor what the model can do.

const fraunces = Fraunces({
  variable: '--font-fraunces',
  subsets: ['latin'],
  weight: ['300', '400', '600', '700', '900'],
  style: ['normal', 'italic'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Dr. E — Ellis Sloan, CFA',
  description:
    'A one-page tribute to Dr. E: Ellis Sloan, CFA, finance professor at Harding University in Searcy, Arkansas. Researched, designed and built by Claude Fable 5.1.',
  openGraph: {
    title: 'Dr. E — Ellis Sloan, CFA',
    description: 'Forty years in finance. Two decades at Harding. One page, built by Claude.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b0f1a',
};

export default function Page() {
  return (
    <div className={`sloan-root ${fraunces.variable}`}>
      <SloanPage />
    </div>
  );
}
