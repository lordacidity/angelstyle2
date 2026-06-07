'use client';

// StudioShell — the persistent Studio app shell. Rendered once by the (studio)
// route-group layout, so it stays mounted across all section navigations and
// nothing (live phone feed, AI wizard, video rows, scroll) resets when the URL
// changes. The visible section is derived from the pathname instead of local
// state; the thin route page.tsx files just make each URL resolve.

import React, { lazy, Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useVideoEntries } from './hooks/useVideoEntries';
import { useGoogleSheets } from './hooks/useGoogleSheets';
import { useBrandKit } from './hooks/useBrandKit';
import { usePauvSession } from './hooks/usePauvSession';
import type { CarouselSettings } from './components/carouselTypes';
import { Sidebar } from './components/Sidebar';
import { BoardSection } from './components/BoardSection';
import { BrandKit } from './components/BrandKit';
import { CanvasGrid } from './components/CanvasGrid';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GoogleSheetsModal } from './components/GoogleSheetsModal';
import { PhonedeckMiniPanel } from './components/PhonedeckMiniPanel';
import { BoardWidget } from './components/BoardWidget';
import PixelTroll from './components/PixelTroll';
import { useBoard, type BoardRow, type BoardTable } from './hooks/useBoard';
import { PhonedeckApp } from './phonedeck/PhonedeckApp';
import { PhonedeckTrending } from './phonedeck/PhonedeckTrending';
import { PhonedeckImages } from './phonedeck/PhonedeckImages';
import { GRID_BG_STYLE } from '@/lib/ui-constants';
import { makeEmptyEntry } from '@/lib/entry';
import { sectionFromPath, pathForSection } from '@/lib/sections';
import type { VideoMode } from './types';

const AiCardsSection = lazy(() =>
  import('./components/AiCardsSection').then(m => ({ default: m.AiCardsSection }))
);

const BuilderGrid = lazy(() =>
  import('./components/BuilderGrid').then(m => ({ default: m.BuilderGrid }))
);

const AiPromptsSection = lazy(() =>
  import('./components/AiPromptsSection').then(m => ({ default: m.AiPromptsSection }))
);

function SectionLoader() {
  return (
    <div className="flex items-center justify-center h-full min-h-[200px]">
      <div className="w-6 h-6 rounded-full border-2 border-zinc-700 border-t-zinc-400 animate-spin" />
    </div>
  );
}

function GridSection({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-screen" style={GRID_BG_STYLE}>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

// Wraps a Phonedeck-side view (PhonedeckApp/Trending/Images) in the
// .phonedeck-root scope so the bundled CSS only applies inside. Stays mounted
// across tab changes (display toggled) so SSE / scroll / selection state
// survive nav between Studio sections.
function PhonedeckPane({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  return (
    <div className="phonedeck-root" style={{ display: visible ? 'block' : 'none', minHeight: '100vh' }}>
      {children}
    </div>
  );
}

// The one-paste bootstrap a teammate runs once on a fresh PC. Installs Git/Node/
// scrcpy+adb, clones the repo, registers the phonedeck:// protocol, and starts
// the server. Kept in sync with /setup.ps1 at the repo root.
const SETUP_COMMAND =
  'irm https://raw.githubusercontent.com/lordacidity/angelstyle2/main/setup.ps1 | iex';

// Launch-server control. The Vercel-hosted page can't spawn a process, so the
// main button is a deep-link into the phonedeck:// protocol (registered once by
// setup.ps1) that runs launch-server.bat → the local Express backend. The
// attached "First time?" dropdown shows the one-paste setup command; it
// auto-opens once per browser so a new teammate sees how to get started.
function LaunchServerButton() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem('phonedeck.setupSeen')) setOpen(true);
    } catch { /* localStorage blocked — just don't auto-open */ }
  }, []);

  function markSeen() {
    try { localStorage.setItem('phonedeck.setupSeen', '1'); } catch { /* ignore */ }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(SETUP_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — the code is select-all, copy manually */ }
    markSeen();
  }

  return (
    <div className="fixed bottom-3 left-[84px] z-[15]">
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-[370px] rounded-lg border border-zinc-800 bg-zinc-950/95 p-3 shadow-xl backdrop-blur">
          <div className="mb-2 flex items-start justify-between gap-2">
            <p className="text-[11px] font-semibold text-white">First time on this PC?</p>
            <button
              onClick={() => { setOpen(false); markSeen(); }}
              className="shrink-0 text-xs text-zinc-500 hover:text-white"
            >
              ✕
            </button>
          </div>
          <p className="mb-2 text-[11px] leading-relaxed text-zinc-400">
            Open <span className="text-zinc-200">Windows PowerShell</span> and paste this once —
            it installs everything and starts the server:
          </p>
          <div className="flex items-stretch gap-1.5">
            <code className="flex-1 select-all break-all rounded border border-zinc-800 bg-black/60 px-2 py-1.5 font-mono text-[10.5px] text-emerald-300">
              {SETUP_COMMAND}
            </code>
            <button
              onClick={copy}
              className="shrink-0 rounded border border-zinc-700 px-2 text-[11px] font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
            Done once. After that just press <span className="text-zinc-300">Launch server</span> each
            time — it restarts in one click, no setup again.
          </p>
        </div>
      )}

      <div className="flex items-stretch overflow-hidden rounded-md border border-zinc-800 bg-zinc-900/90 backdrop-blur">
        <a
          href="phonedeck://launch"
          title="Start the local Phonedeck server on this PC"
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 transition-colors hover:bg-zinc-800/60 hover:text-white"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          Launch server
        </a>
        <button
          onClick={() => setOpen(o => !o)}
          title="First-time setup instructions"
          className="flex items-center gap-1 border-l border-zinc-800 px-1.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-white"
        >
          First time?
          <svg
            width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform ${open ? 'rotate-180' : ''}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function StudioShell() {
  const pathname = usePathname();
  const router = useRouter();
  const activeSection = sectionFromPath(pathname);

  const [carouselSettingsMap, setCarouselSettingsMap] = useState<Record<string, CarouselSettings>>({});
  // No login UI — silently signed in as the shared Pauv account so the brand
  // kit / templates persist against a real Supabase user.
  const { userId } = usePauvSession();
  const { brand, saving, uploading, loading, error, setError, save, uploadLogo, deleteLogo, selectLogo } = useBrandKit(userId);

  const {
    entries, setEntries, canvasRefsMap, carouselRefsMap,
    addRow, removeRow, resetEverything, updateEntry, updateCarouselEntry, updateLocalVideo,
    handleVideoError, fetchVideo, downloadAll, setCarouselSubMode,
  } = useVideoEntries();

  const googleSheets = useGoogleSheets({ onImport: setEntries });

  // One board instance for the whole shell — shared with the floating BoardWidget
  // so a sent row can be flipped to Posted once its exported video is pushed to a
  // phone from the Phonedeck panel.
  const board = useBoard();
  // entry id → the board row it came from. Set when a row is sent to the
  // generator; read at export time to remember which row a file belongs to.
  const [boardOrigins, setBoardOrigins] = useState<Record<string, { table: BoardTable; id: string }>>({});
  // Phonedeck upload filename → the board row it came from. Populated at export
  // time (NOT marked Posted yet); consumed when that file is pushed to a phone,
  // which is the moment we flip the row to Posted.
  const [pushOrigins, setPushOrigins] = useState<Record<string, { table: BoardTable; id: string }>>({});

  const [pendingAiSeed, setPendingAiSeed] = useState<{ imageSrc: string; headline: string; subheadline: string; subheadline2?: string; articleUrl?: string } | null>(null);

  // Set to an entry id when the Board widget's send arrow drops a row into the
  // generator; CanvasGrid picks it up, runs the fetch→crop→caption pipeline for
  // that entry, then clears it.
  const [pendingBoardSend, setPendingBoardSend] = useState<string | null>(null);
  // Drives the green "currently working on" highlight in BoardWidget. Lifted
  // here so handleClearAll can wipe it at the same time it wipes the entries.
  const [activeBoardRowId, setActiveBoardRowId] = useState<string | null>(null);

  // Once the user has visited AI Cards, keep that section mounted (just hidden)
  // so its internal state — picked talent, fetched stories, drafted headline,
  // chosen photo — survives navigating away and back via the media-tab back
  // arrow. Without this, AiCardsSection unmounts and resets to step 1.
  const [aiEverVisited, setAiEverVisited] = useState(false);
  useEffect(() => { if (activeSection === 'ai') setAiEverVisited(true); }, [activeSection]);

  useEffect(() => {
    const raw = sessionStorage.getItem('ai-card-seed');
    if (!raw) return;
    sessionStorage.removeItem('ai-card-seed');
    try {
      const seed = JSON.parse(raw) as { imageSrc: string; headline: string; subheadline: string; subheadline2?: string; articleUrl?: string };
      setPendingAiSeed(seed);
      // Drop into carousel mode so savedSlides loads before we apply content.
      setEntries(prev => prev.map(e => ({ ...e, mode: 'carousel' as const })));
      setTimeout(() => router.push(pathForSection('media')), 400);
    } catch { /* malformed seed — ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleBuildCard(seed: { imageSrc: string; headline: string; subheadline: string; subheadline2?: string; articleUrl?: string }) {
    setPendingAiSeed(seed);
    setEntries(prev => prev.map(e => ({ ...e, mode: 'carousel' as const })));
    setTimeout(() => router.push(pathForSection('media')), 400);
  }

  // Board widget → generator. Replace the current rows with a single fresh entry
  // carrying this row's link/caption/context, then hand its id to CanvasGrid via
  // pendingBoardSend so it auto-fetches and advances to cropping. Carousel mode
  // can't crop a raw video, so we fall back to a video mode.
  function handleSendBoardRow(row: BoardRow) {
    const mode: VideoMode = entries[0]?.mode && entries[0].mode !== 'carousel' ? entries[0].mode : 'twitter';
    const id = Date.now().toString();
    setEntries([{ ...makeEmptyEntry(id, mode), url: row.url, caption: row.vidCaption, context: row.context }]);
    setBoardOrigins(prev => ({ ...prev, [id]: { table: board.active, id: row.id } }));
    setPendingBoardSend(id);
    setActiveBoardRowId(row.id);
    router.push(pathForSection('media'));
  }

  // Export finished for an entry — DON'T mark Posted here. Instead, if it came
  // from the board and actually landed in Phonedeck Incoming (we got a filename),
  // remember filename→row so the later "Push" can mark it Posted.
  function handleEntryExported(entryId: string, fileName?: string) {
    const origin = boardOrigins[entryId];
    if (origin && fileName) setPushOrigins(prev => ({ ...prev, [fileName]: origin }));
  }
  // A file was pushed to phone(s) from the Phonedeck panel — if it traces back to
  // a board row, flip that row to Posted now (reflected in the widget + board DB).
  function handlePhonedeckPushed(fileName: string) {
    const origin = pushOrigins[fileName];
    if (!origin) return;
    board.markPosted(origin.table, origin.id);
    setPushOrigins(prev => { const next = { ...prev }; delete next[fileName]; return next; });
  }

  function handleResetAll() {
    resetEverything();
    router.push(pathForSection('brandkit'));
  }

  // "Clear" in the media toolbar: wipe all rows back to one empty entry (keeping
  // the current format) and stay on the media insert screen, so the user lands
  // right back at the empty link / caption / context form.
  function handleClearAll() {
    setEntries(prev => [makeEmptyEntry('1', prev[0]?.mode ?? 'twitter')]);
    setActiveBoardRowId(null);
  }

  // Media format toggle (Twitter / Caption / Carousel) — replaces the old
  // template picker. Applies the chosen mode to every row; new rows inherit
  // row 0's mode, so future rows follow too.
  const currentFormat: VideoMode = entries[0]?.mode ?? 'twitter';
  function handleSetFormat(mode: VideoMode) {
    setEntries(prev => prev.map(e => ({ ...e, mode })));
  }

  return (
    <div className="flex min-h-screen bg-black text-white">
      {/* Floating Phonedeck panel — bottom-right, mirrors Phonedeck's Incoming
          list over HTTP/SSE so a fresh export can be pushed to phones without
          switching tabs. Works locally; can point at a peer machine on the LAN
          via NEXT_PUBLIC_PHONEDECK_URL. Hidden on the Brand Kit / template
          selector landing page since no content is being created or exported
          there — kept mounted (display:none) so the SSE connection persists
          across navigation. */}
      <div style={{ display: activeSection === 'media' ? undefined : 'none' }}>
        <PhonedeckMiniPanel onPushed={handlePhonedeckPushed} />
      </div>
      {/* Floating Shared Board widget — left of the centered generator. Same
          board as the /board page, in a movable/resizable panel so links can be
          triaged without leaving Media. Kept mounted (display:none) off-tab so
          an in-progress draft / resize survives navigation, like the panel
          above. */}
      <div style={{ display: activeSection === 'media' ? undefined : 'none' }}>
        <BoardWidget board={board} onSendRow={handleSendBoardRow} activeRowId={activeBoardRowId} />
      </div>
      <Sidebar
        googleToken={googleSheets.googleToken}
        onConnectGoogle={googleSheets.connectGoogle}
        onOpenSheetsModal={() => googleSheets.setShowSheetsModal(true)}
        onDisconnectGoogle={() => googleSheets.setGoogleToken(null)}
        onResetAll={handleResetAll}
      />

      <main className="flex-1 ml-[72px] min-h-screen">

        {aiEverVisited && (
          <div style={{ display: activeSection === 'ai' ? undefined : 'none' }}>
            <Suspense fallback={<SectionLoader />}>
              <AiCardsSection
                onBuildCard={handleBuildCard}
                onCancel={() => router.push(pathForSection('brandkit'))}
              />
            </Suspense>
          </div>
        )}

        {activeSection === 'brandkit' && (
          <BrandKit
            brand={brand}
            loading={loading}
            saving={saving}
            uploading={uploading}
            error={error}
            onSave={save}
            onUploadLogo={uploadLogo}
            onDeleteLogo={deleteLogo}
            onSelectLogo={selectLogo}
            onClearError={() => setError(null)}
          />
        )}

        <ErrorBoundary>
          <div style={{ display: activeSection === 'media' ? undefined : 'none' }}>
            <GridSection>
              <CanvasGrid
                entries={entries}
                canvasRefsMap={canvasRefsMap}
                carouselRefsMap={carouselRefsMap}
                brand={brand}
                onAddRow={addRow}
                onRemoveRow={(id) => {
                  // Drop the board highlight whenever the entry it traces back to
                  // gets removed, so the "currently working on" green doesn't
                  // outlive the row in the generator.
                  const origin = boardOrigins[id];
                  if (origin && origin.id === activeBoardRowId) setActiveBoardRowId(null);
                  removeRow(id);
                }}
                onClearAll={handleClearAll}
                onDownloadAll={downloadAll}
                onHandleVideoError={handleVideoError}
                onUpdateEntry={updateEntry}
                onUpdateCarouselEntry={updateCarouselEntry}
                onUpdateLocalVideo={updateLocalVideo}
                onFetchVideo={fetchVideo}
                onSetCarouselSubMode={setCarouselSubMode}
                userId={userId}
                format={currentFormat}
                onSetFormat={handleSetFormat}
                settingsMap={carouselSettingsMap}
                setSettingsMap={setCarouselSettingsMap}
                pendingAiSeed={pendingAiSeed}
                onAiSeedConsumed={() => setPendingAiSeed(null)}
                pendingBoardSend={pendingBoardSend}
                onBoardSendConsumed={() => setPendingBoardSend(null)}
                onEntryExported={handleEntryExported}
                onBackToAi={() => router.push(pathForSection('ai'))}
              />
            </GridSection>
          </div>
        </ErrorBoundary>

        {activeSection === 'builder' && (
          <ErrorBoundary>
            <GridSection>
              <Suspense fallback={<SectionLoader />}>
                <BuilderGrid brand={brand} onSelectLogo={selectLogo} userId={userId} />
              </Suspense>
            </GridSection>
          </ErrorBoundary>
        )}

        {activeSection === 'board' && (
          <ErrorBoundary>
            <GridSection>
              <BoardSection />
            </GridSection>
          </ErrorBoundary>
        )}

        {activeSection === 'prompts' && (
          <ErrorBoundary>
            <GridSection>
              <Suspense fallback={<SectionLoader />}>
                <AiPromptsSection />
              </Suspense>
            </GridSection>
          </ErrorBoundary>
        )}

        {activeSection === 'schedule' && (
          <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-3">
            <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500">
                <rect x="3" y="4" width="18" height="18" rx="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
            <p className="text-sm font-medium text-zinc-400">Schedule posts</p>
            <p className="text-xs text-zinc-600">Coming soon</p>
          </div>
        )}

        {/* Phonedeck-side sections — iframe-mount the existing Phonedeck web
            app routes so we get the live UI without duplicating any code.
            Each iframe stays mounted (display toggled) so SSE connections +
            scroll/selection state survive nav between tabs. The shared
            mini-panel widget is hidden on the Deck tab below since the full
            Phonedeck UI is already on-screen there. */}
        <PhonedeckPane visible={activeSection === 'deck'}>     <PhonedeckApp /></PhonedeckPane>
        <PhonedeckPane visible={activeSection === 'trending'}> <PhonedeckTrending /></PhonedeckPane>
        <PhonedeckPane visible={activeSection === 'images'}>   <PhonedeckImages /></PhonedeckPane>
      </main>

      {googleSheets.showSheetsModal && (
        <GoogleSheetsModal
          spreadsheetId={googleSheets.spreadsheetId}
          setSpreadsheetId={googleSheets.setSpreadsheetId}
          sheetName={googleSheets.sheetName}
          setSheetName={googleSheets.setSheetName}
          startRow={googleSheets.startRow}
          setStartRow={googleSheets.setStartRow}
          endRow={googleSheets.endRow}
          setEndRow={googleSheets.setEndRow}
          loadingSheets={googleSheets.loadingSheets}
          sheetsError={googleSheets.sheetsError}
          onClose={() => googleSheets.setShowSheetsModal(false)}
          onImport={googleSheets.importFromSheets}
        />
      )}

      {/* Wandering pixel-troll easter egg. Mounted once here so he persists
          across section nav; shown only on Media and Board. On Media he treads
          the top edge of the trim bar (data-troll-floor); elsewhere he walks the
          screen bottom. Click him for a reaction. zIndex 20 keeps him above page
          and board content (board grid tops out at z-10) but below the floating
          Studio widgets (z-40) and the sidebar (z-30). */}
      <PixelTroll
        hidden={activeSection !== 'media' && activeSection !== 'board'}
        floorSelector="[data-troll-floor]"
        obstacleSelector="[data-troll-obstacle]"
        zIndex={20}
      />

      {/* Launch-server split button + first-time setup dropdown (see component). */}
      <LaunchServerButton />
    </div>
  );
}
