'use client';

// The Carousel section (left-sidebar route /carousel) — home with the three
// entry flows, the wizard (From a name / Trending), and the editor. Pages live
// here (useCarouselPages) so a wizard build seeds the editor with plain state,
// and the editor stays mounted once visited so canvases survive view switches.

import { useState } from 'react';
import { useCarouselPages } from './useCarouselPages';
import { CarouselStudio } from './CarouselStudio';
import type { CarouselModuleSeed } from './CarouselStudio';
import { CarouselWizard } from './CarouselWizard';
import type { BuiltCarouselModule } from './CarouselWizard';
import { makeEmptyEntry } from '@/lib/entry';
import type { BrandProps } from '../../types';

type View = 'home' | 'wizard' | 'editor';
type WizardFlow = 'name' | 'trending';

export function CarouselSection({ userId, brand }: { userId: string | null; brand: BrandProps }) {
  const [view,          setView]          = useState<View>('home');
  const [wizardFlow,    setWizardFlow]    = useState<WizardFlow>('name');
  const [editorVisited, setEditorVisited] = useState(false);
  const [pendingSeed,   setPendingSeed]   = useState<CarouselModuleSeed | null>(null);
  const pagesApi = useCarouselPages();

  function openEditor() {
    setEditorVisited(true);
    setView('editor');
  }

  function openWizard(flow: WizardFlow) {
    setWizardFlow(flow);
    setView('wizard');
  }

  // Wizard result → the fixed 4-card module: cards 1–3 are photo pages (main +
  // two supporting) with the pauv logo + swipe stamped on, card 4 is the
  // market's bare chart page (no text — configured via seed).
  function handleBuild(module: BuiltCarouselModule) {
    const stamp = Date.now();
    const photoEntries = module.pages.map((p, i) => ({
      ...makeEmptyEntry(`${stamp}-${i}`, 'carousel' as const, i === 0 ? ('main' as const) : ('supporting_1' as const)),
      headline: p.headline,
      subheadline: p.subheadline,
      imageSrc: module.photoUrls[i],
      ...(i === 0 && module.articleUrl ? { articleUrl: module.articleUrl } : {}),
    }));
    const chartEntry = {
      ...makeEmptyEntry(`${stamp}-3`, 'carousel' as const, 'supporting_1' as const),
      carouselSubMode: 'image' as const,
    };
    pagesApi.replacePages([...photoEntries, chartEntry]);
    setPendingSeed({
      chartEntryId: chartEntry.id,
      photoPageIds: photoEntries.map(e => e.id),
      circlePhotoUrl: module.circlePhotoUrl,
      circleQuery: module.circleQuery,
      photoPool: module.photoPool,
      market: {
        id: module.talent.id,
        ticker: module.talent.ticker,
        name: module.talent.name,
        photo_url: module.talent.photo_url,
        industry: module.talent.industry,
        price: { usd: module.talent.price.usd, lifetimeChangePct: module.talent.price.lifetimeChangePct },
      },
    });
    openEditor();
  }

  const tiles: Array<{ title: string; desc: string; onClick: () => void; icon: React.ReactNode }> = [
    {
      title: 'From scratch',
      desc: 'Open the editor with a blank carousel — add Main and Supporting pages yourself.',
      onClick: openEditor,
      icon: (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <line x1="12" y1="8" x2="12" y2="16"/>
          <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
      ),
    },
    {
      title: 'From a name',
      desc: 'Pick a Pauv market, choose the news, choose 3 photos — DeepSeek writes the 4-card module, ending on their chart as a video.',
      onClick: () => openWizard('name'),
      icon: (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
      ),
    },
    {
      title: 'Trending',
      desc: 'AI finds the Pauv-listed figure trending right now and builds the same 4-card module automatically.',
      onClick: () => openWizard('trending'),
      icon: (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
          <polyline points="17 6 23 6 23 12"/>
        </svg>
      ),
    },
  ];

  return (
    <div className="h-full">
      {/* ── Home — the three entry flows ── */}
      {view === 'home' && (
        <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-8 px-6">
          <div className="text-center">
            <h1 className="text-lg font-semibold text-zinc-100">Carousel</h1>
            <p className="text-sm text-zinc-500 mt-1">Multi-page swipe posts — 3 story cards + their live chart as a video.</p>
          </div>
          <div className="flex flex-wrap items-stretch justify-center gap-4">
            {tiles.map(t => (
              <button
                key={t.title}
                onClick={t.onClick}
                className="flex flex-col items-start gap-3 w-[240px] p-5 rounded-xl bg-zinc-950 border border-zinc-800 hover:border-zinc-600 text-left transition-colors group"
              >
                <div className="flex items-center justify-center w-11 h-11 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 group-hover:text-zinc-100 transition-colors">
                  {t.icon}
                </div>
                <span className="text-sm font-semibold text-zinc-100">{t.title}</span>
                <span className="text-xs text-zinc-500 leading-relaxed">{t.desc}</span>
              </button>
            ))}
          </div>
          {pagesApi.pages.length > 0 && (
            <button
              onClick={openEditor}
              className="text-xs text-zinc-500 hover:text-zinc-200 underline underline-offset-4 transition-colors"
            >
              Continue editing ({pagesApi.pages.length} page{pagesApi.pages.length === 1 ? '' : 's'})
            </button>
          )}
        </div>
      )}

      {/* ── Wizard ── */}
      {view === 'wizard' && (
        <CarouselWizard
          flow={wizardFlow}
          brandCategory={brand.category}
          onBuild={handleBuild}
          onCancel={() => setView('home')}
        />
      )}

      {/* ── Editor — kept mounted once visited so canvas state survives ── */}
      {editorVisited && (
        <div className="h-full" style={{ display: view === 'editor' ? undefined : 'none' }}>
          <CarouselStudio
            pagesApi={pagesApi}
            userId={userId}
            brand={brand}
            onBackHome={() => setView('home')}
            pendingSeed={pendingSeed}
            onSeedConsumed={() => setPendingSeed(null)}
          />
        </div>
      )}
    </div>
  );
}
