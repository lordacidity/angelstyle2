import type { Metadata, Viewport } from 'next';
import SudokuClient from './SudokuClient';
import './sud.css';

// angelstyle.com/sud: sudoku, Hard and Expert only. Standalone (no sidebar)
// and public (no site password, see src/middleware.ts), cached by
// public/sud-sw.js so it opens with no connection once it has been visited.
// Puzzles are made on the device, so nothing here needs a server.

export const metadata: Metadata = {
  title: 'Sudoku',
  description: 'Hard and expert sudoku, offline.',
  manifest: '/sud/manifest.webmanifest',
  icons: { icon: '/sud/icon-192.png', apple: '/sud/icon-180.png' },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Sudoku' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#121214' },
  ],
};

export default function Page() {
  return <SudokuClient />;
}
