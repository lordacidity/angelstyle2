'use client';

import React, { lazy, Suspense, useEffect, useState } from 'react';
import { useVideoEntries } from './hooks/useVideoEntries';
import { useGoogleSheets } from './hooks/useGoogleSheets';
import { useBrandKit } from './hooks/useBrandKit';
import { useAuth } from './hooks/useAuth';
import type { CarouselSettings } from './components/carouselTypes';
import { Sidebar } from './components/Sidebar';
import { TemplateSelector } from './components/TemplateSelector';
import { CanvasGrid } from './components/CanvasGrid';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GoogleSheetsModal } from './components/GoogleSheetsModal';
import { GRID_BG_STYLE } from '@/lib/ui-constants';
import type { AppSection, VideoMode } from './types';

const AiCardsSection = lazy(() =>
  import('./components/AiCardsSection').then(m => ({ default: m.AiCardsSection }))
);

const BuilderGrid = lazy(() =>
  import('./components/BuilderGrid').then(m => ({ default: m.BuilderGrid }))
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

export default function Home() {
  const [activeSection, setActiveSection] = useState<AppSection>('template');
  const [selectedTemplate, setSelectedTemplate] = useState<VideoMode | null>(null);
  const [carouselSettingsMap, setCarouselSettingsMap] = useState<Record<string, CarouselSettings>>({});
  const { user, loading: authLoading, signIn, signUp, signOut, resetPassword, changePassword } = useAuth();
  const { brand, setBrand, saving, uploading, loading, error, setError, save, uploadLogo, deleteLogo, selectLogo } = useBrandKit(user?.id ?? null);

  const {
    entries, setEntries, canvasRefsMap, carouselRefsMap,
    addRow, removeRow, resetEverything, updateEntry, updateCarouselEntry, updateLocalVideo,
    handleVideoError, fetchVideo, downloadAll, setCarouselSubMode,
  } = useVideoEntries();

  const googleSheets = useGoogleSheets({ onImport: setEntries });

  const [pendingAiSeed, setPendingAiSeed] = useState<{ imageSrc: string; headline: string; subheadline: string; subheadline2?: string } | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem('ai-card-seed');
    if (!raw) return;
    sessionStorage.removeItem('ai-card-seed');
    try {
      const seed = JSON.parse(raw) as { imageSrc: string; headline: string; subheadline: string; subheadline2?: string };
      setPendingAiSeed(seed);
      // Go through the normal carousel template flow so savedSlides loads before we apply content
      setSelectedTemplate('carousel');
      setEntries(prev => prev.map(e => ({ ...e, mode: 'carousel' as const })));
      setTimeout(() => setActiveSection('media'), 400);
    } catch { /* malformed seed — ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleTemplateSelect(mode: VideoMode) {
    setSelectedTemplate(mode);
    setEntries(prev => prev.map(e => ({ ...e, mode })));
    setTimeout(() => setActiveSection('media'), 400);
  }

  function handleBuildCard(seed: { imageSrc: string; headline: string; subheadline: string; subheadline2?: string }) {
    setPendingAiSeed(seed);
    handleTemplateSelect('carousel');
  }

  function handleResetAll() {
    resetEverything();
    setSelectedTemplate(null);
    setActiveSection('template');
  }

  return (
    <div className="flex min-h-screen bg-black text-white">
      <Sidebar
        active={activeSection}
        onSelect={setActiveSection}
        googleToken={googleSheets.googleToken}
        onConnectGoogle={googleSheets.connectGoogle}
        onOpenSheetsModal={() => googleSheets.setShowSheetsModal(true)}
        onDisconnectGoogle={() => googleSheets.setGoogleToken(null)}
        onResetAll={handleResetAll}
      />

      <main className="flex-1 ml-[72px] min-h-screen">

        {activeSection === 'ai' && (
          <Suspense fallback={<SectionLoader />}>
            <AiCardsSection
              onBuildCard={handleBuildCard}
              onCancel={() => setActiveSection('template')}
            />
          </Suspense>
        )}

        {activeSection === 'template' && (
          <TemplateSelector
            selected={selectedTemplate}
            onSelect={handleTemplateSelect}
            onSelectWithAi={() => setActiveSection('ai')}
            onGoToBuilder={() => setActiveSection('builder')}
            brand={brand}
            loading={loading}
            saving={saving}
            uploading={uploading}
            error={error}
            user={user}
            authLoading={authLoading}
            onSignIn={signIn}
            onSignUp={signUp}
            onResetPassword={resetPassword}
            onChangePassword={changePassword}
            onSignOut={signOut}
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
                onRemoveRow={removeRow}
                onDownloadAll={downloadAll}
                onHandleVideoError={handleVideoError}
                onUpdateEntry={updateEntry}
                onUpdateCarouselEntry={updateCarouselEntry}
                onUpdateLocalVideo={updateLocalVideo}
                onFetchVideo={fetchVideo}
                onSetCarouselSubMode={setCarouselSubMode}
                userId={user?.id ?? null}
                settingsMap={carouselSettingsMap}
                setSettingsMap={setCarouselSettingsMap}
                pendingAiSeed={pendingAiSeed}
                onAiSeedConsumed={() => setPendingAiSeed(null)}
              />
            </GridSection>
          </div>
        </ErrorBoundary>

        {activeSection === 'builder' && (
          <ErrorBoundary>
            <GridSection>
              <Suspense fallback={<SectionLoader />}>
                <BuilderGrid brand={brand} onSelectLogo={selectLogo} userId={user?.id ?? null} />
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
    </div>
  );
}
