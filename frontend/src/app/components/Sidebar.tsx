'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { AppSection } from '../types';
import { sectionFromPath, pathForSection } from '@/lib/sections';
import { EmojiManager } from './EmojiManager';

interface SidebarProps {
  googleToken: { accessToken: string } | null;
  onConnectGoogle: () => void;
  onOpenSheetsModal: () => void;
  onDisconnectGoogle: () => void;
  onResetAll: () => void;
}

const NAV: { id: AppSection; label: string; icon: React.ReactNode }[] = [
  {
    id: 'deck',
    label: 'Deck',
    // Downward (apex-at-bottom) triangle — matches the icon Phonedeck's own
    // sidebar uses for its home tab.
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="4 6 20 6 12 20"/>
      </svg>
    ),
  },
  {
    id: 'brandkit',
    label: 'Brand Kit',
    // Color swatches — the brand identity (logo / name / handle).
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="13.5" cy="6.5" r="2.5"/>
        <circle cx="17.5" cy="10.5" r="2.5"/>
        <circle cx="8.5" cy="7.5" r="2.5"/>
        <path d="M12 2a10 10 0 1 0 0 20 2.5 2.5 0 0 0 2-4 2.5 2.5 0 0 1 2-4h2a4 4 0 0 0 4-4 10 10 0 0 0-10-8z"/>
      </svg>
    ),
  },
  {
    id: 'media',
    label: 'Media',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
    ),
  },
  {
    id: 'vids',
    label: 'Vids',
    // Film strip — the shared cloud video library + stacked-sequence builder.
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="18" rx="2"/>
        <path d="M7 3v18M17 3v18M2 8h5M2 16h5M17 8h5M17 16h5"/>
      </svg>
    ),
  },
  {
    id: 'vids2',
    label: 'Vids 2',
    // A single frame with a play button in it: nothing to build — five answers
    // and one press make the whole video, and the page it lands on is only for
    // tuning it. Sits under Vids because that is where its footage is filed.
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="3" width="14" height="18" rx="2"/>
        <path d="M10 9.5v5l4-2.5z"/>
      </svg>
    ),
  },
  {
    id: 'carousel',
    label: 'Carousel',
    // Stacked cards — a multi-page swipe post.
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="7" y="3" width="14" height="14" rx="2"/>
        <path d="M17 21H5a2 2 0 0 1-2-2V7"/>
      </svg>
    ),
  },
  {
    id: 'builder',
    label: 'Builder',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <path d="M3 9h18"/>
        <path d="M9 21V9"/>
      </svg>
    ),
  },
  {
    id: 'board',
    label: 'Board',
    // 2×2 grid — a shared spreadsheet of links/info.
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>
      </svg>
    ),
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    // Chat bubble — the ChatGPT lookalike that argues a chosen name is up or down.
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-7.5A8 8 0 0 1 13 4a8 8 0 0 1 8 8z"/>
        <path d="M9 12h.01M13 12h.01M17 12h.01"/>
      </svg>
    ),
  },
  {
    id: 'trade',
    label: 'Trade',
    // Rising line — the Pauv trade recording: search them, read the chart, place the trade.
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17l6-6 4 4 8-8"/>
        <path d="M15 7h6v6"/>
      </svg>
    ),
  },
  {
    id: 'news',
    label: 'News',
    // Newspaper — a real story from an approved outlet, redrawn as that outlet's page.
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 5h13v14a1 1 0 0 0 1 1H6a2 2 0 0 1-2-2z"/>
        <path d="M17 9h3v10a1 1 0 0 1-2 0"/>
        <path d="M7 9h7M7 13h7M7 16h4"/>
      </svg>
    ),
  },
  {
    id: 'pricer',
    label: 'Pricer',
    // Price tag — the AI Pricer: type a name, six steps price them against the master list.
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L3 13V3h10l7.59 7.59a2 2 0 0 1 0 2.82z"/>
        <circle cx="7.5" cy="7.5" r="1.5"/>
      </svg>
    ),
  },
  {
    id: 'photos',
    label: 'Photos',
    // Portrait in a frame — a free-to-use photo for every name on a list, squared and saved one after another.
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="3"/>
        <circle cx="12" cy="10" r="3"/>
        <path d="M6.5 20c1-3 3-4.5 5.5-4.5s4.5 1.5 5.5 4.5"/>
      </svg>
    ),
  },
  {
    id: 'aipersona',
    label: 'AI Persona',
    // A face inside a play button — a still portrait turned into someone talking:
    // ElevenLabs reads the script, Kling makes the photo say it.
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <circle cx="12" cy="10" r="2.6"/>
        <path d="M7.5 17.5c.9-2.2 2.5-3.3 4.5-3.3s3.6 1.1 4.5 3.3"/>
      </svg>
    ),
  },
  {
    id: 'prompts',
    label: 'AI Prompts',
    // Lightbulb — saved topics you turn into fresh trending-news overviews.
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18h6"/>
        <path d="M10 22h4"/>
        <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5"/>
      </svg>
    ),
  },
  {
    id: 'audio',
    label: 'Audio Editor',
    // Waveform — temporary: drop an MP3 and rough it up until it stops sounding like a studio.
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 10v4M7.5 6v12M12 3v18M16.5 8v8M21 10v4"/>
      </svg>
    ),
  },
  {
    id: 'music',
    label: 'Music',
    // A pair of notes — the song library: listen, rename, upload, send an MP3 to the Phonedeck.
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13"/>
        <circle cx="6" cy="18" r="3"/>
        <circle cx="18" cy="16" r="3"/>
      </svg>
    ),
  },
];

export function Sidebar({
  googleToken, onConnectGoogle, onOpenSheetsModal, onDisconnectGoogle, onResetAll,
}: SidebarProps) {
  const pathname = usePathname();
  const active: AppSection = sectionFromPath(pathname);
  // The Emojis drawer toggles open from its sidebar button; it's not a route, so
  // it lives in local state rather than the pathname.
  const [emojiOpen, setEmojiOpen] = useState(false);

  return (
    <>
    <aside className="fixed top-0 left-0 h-screen w-[72px] bg-[#0f0f0f] border-r border-zinc-800 flex flex-col z-30">
      {/* Nav — real links so each section has its own URL (prefetch + open in new tab) */}
      <nav className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-2 py-4 flex flex-col gap-1">
        {NAV.map(({ id, label, icon }) => {
          const isActive = active === id;
          return (
            <Link
              key={id}
              href={pathForSection(id)}
              className={`w-full shrink-0 flex flex-col items-center gap-2 py-2.5 px-1 rounded-lg transition-colors ${
                isActive
                  ? 'text-white'
                  : 'text-zinc-700 hover:text-zinc-200'
              }`}
            >
              {icon}
              <span className="text-[9px] font-medium leading-none text-center">{label}</span>
            </Link>
          );
        })}

        {/* Emojis — opens the customization drawer (pin favorites + set @ shortcuts).
            A toggle button, not a route, so it tints active while the drawer is open. */}
        <button
          onClick={() => setEmojiOpen((o) => !o)}
          title="Emojis — pin & set @ shortcuts"
          className={`w-full shrink-0 flex flex-col items-center gap-2 py-2.5 px-1 rounded-lg transition-colors ${
            emojiOpen ? 'text-white' : 'text-zinc-700 hover:text-zinc-200'
          }`}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
            <line x1="9" y1="9.5" x2="9.01" y2="9.5"/>
            <line x1="15" y1="9.5" x2="15.01" y2="9.5"/>
          </svg>
          <span className="text-[9px] font-medium leading-none text-center">Emojis</span>
        </button>

        {/* X Photo — downloadable cards for posting on X (price strip, newly
            listed). A real route, placed right after Emojis so it reads as the
            next tool in the list. */}
        <Link
          href={pathForSection('xphoto')}
          title="X Photo — price strip and newly listed cards"
          className={`w-full shrink-0 flex flex-col items-center gap-2 py-2.5 px-1 rounded-lg transition-colors ${
            active === 'xphoto' ? 'text-white' : 'text-zinc-700 hover:text-zinc-200'
          }`}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="6" width="20" height="12" rx="4"/>
            <circle cx="7" cy="12" r="2.2"/>
            <path d="M11.5 12.5l2-1.5 1.5 2 2.5-3 2 2.5"/>
          </svg>
          <span className="text-[9px] font-medium leading-none text-center">X Photo</span>
        </Link>

      </nav>

      {/* Bottom */}
      <div className="px-2 py-3 border-t border-zinc-800 flex flex-col gap-1">
        {googleToken ? (
          <>
            <button
              onClick={onOpenSheetsModal}
              title="Import from Sheets"
              className="w-full flex flex-col items-center gap-2 py-2.5 px-1 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900 transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <span className="text-[10px] font-medium leading-none text-center">Sheets</span>
            </button>
            <button
              onClick={onDisconnectGoogle}
              title="Disconnect Google"
              className="w-full flex flex-col items-center gap-2 py-2.5 px-1 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-zinc-900 transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              <span className="text-[10px] font-medium leading-none text-center">Disconnect</span>
            </button>
          </>
        ) : (
          <button
            onClick={onConnectGoogle}
            title="Connect Google"
            className="w-full flex flex-col items-center gap-1 py-2.5 px-1 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
              <polyline points="10 17 15 12 10 7"/>
              <line x1="15" y1="12" x2="3" y2="12"/>
            </svg>
            <span className="text-[10px] font-medium leading-none text-center">Connect</span>
          </button>
        )}

        <button
          onClick={onResetAll}
          title="Reset All"
          className="w-full flex flex-col items-center gap-1 py-2.5 px-1 rounded-lg text-zinc-600 hover:text-orange-400 hover:bg-zinc-900 transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
          <span className="text-[10px] font-medium leading-none text-center">Reset</span>
        </button>
      </div>
    </aside>

    <EmojiManager open={emojiOpen} onClose={() => setEmojiOpen(false)} />
    </>
  );
}
