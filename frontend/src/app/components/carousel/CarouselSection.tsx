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
import type { CarouselPlatform } from '../carouselTypes';
import type { BrandProps } from '../../types';

type View = 'home' | 'wizard' | 'editor';
type WizardFlow = 'name' | 'trending' | 'article';

export function CarouselSection({ userId, brand }: { userId: string | null; brand: BrandProps }) {
  const [view,          setView]          = useState<View>('home');
  const [wizardFlow,    setWizardFlow]    = useState<WizardFlow>('name');
  // IG: 4:5 cards, 3 story cards + chart, SWIPE stamps. X: 15:17 cards, one
  // story card + chart, no swipe. Applies to all three entry flows.
  const [platform,      setPlatform]      = useState<CarouselPlatform>('ig');
  // The platform the (kept-mounted) editor was last opened with. Separate from
  // `platform` so toggling Instagram/X on the home screen only re-renders the
  // lightweight home UI — it does NOT remount the hidden editor + its four heavy
  // canvases every toggle (which was the source of the IG↔X jank). The editor
  // resyncs to the current platform only when it's actually opened.
  const [editorPlatform, setEditorPlatform] = useState<CarouselPlatform>('ig');
  const [editorVisited, setEditorVisited] = useState(false);
  const [pendingSeed,   setPendingSeed]   = useState<CarouselModuleSeed | null>(null);
  const pagesApi = useCarouselPages();

  function openEditor() {
    setEditorVisited(true);
    setEditorPlatform(platform); // resync the editor to the chosen platform on entry
    setView('editor');
  }

  function openWizard(flow: WizardFlow) {
    setWizardFlow(flow);
    setView('wizard');
  }

  // Wizard result → the module pages: photo cards first (3 on IG, 1 on X) with
  // the pauv logo (+ swipe on IG) stamped on, then the market's bare chart page
  // (no text — configured via seed) as the last card.
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

  const tiles: Array<{ title: string; onClick: () => void; icon: React.ReactNode }> = [
    {
      title: 'From scratch',
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
      onClick: () => openWizard('name'),
      icon: (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
      ),
    },
    {
      title: 'From an article',
      onClick: () => openWizard('article'),
      icon: (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 3h11l5 5v13a0 0 0 0 1 0 0H4a0 0 0 0 1 0 0V3z"/>
          <polyline points="14 3 14 8 19 8"/>
          <line x1="8" y1="13" x2="16" y2="13"/>
          <line x1="8" y1="17" x2="16" y2="17"/>
          <line x1="8" y1="9" x2="10" y2="9"/>
        </svg>
      ),
    },
  ];

  return (
    <div className="h-full">
      {/* ── Home — the three entry flows ── */}
      {view === 'home' && (
        <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-8 px-6">
          {/* Platform toggle — applies to all three flows below */}
          <div className="flex items-center rounded-full border border-zinc-700 bg-zinc-900 p-0.5" title="Which platform the cards are built for">
            {([['ig', 'Instagram'], ['x', 'X']] as const).map(([p, label]) => (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                  platform === p ? 'bg-white text-black' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >{label}</button>
            ))}
          </div>
          <div className="text-center">
            <h1 className="text-lg font-semibold text-zinc-100">Carousel</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Build multi-page swipe posts with story cards and a live chart.
            </p>
          </div>
          <div className="flex flex-wrap items-stretch justify-center gap-4">
            {tiles.map(t => (
              <button
                key={t.title}
                onClick={t.onClick}
                className="flex flex-col items-center justify-center gap-4 w-[200px] py-8 px-5 rounded-xl bg-zinc-950 border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900/40 text-center transition-colors group"
              >
                <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 group-hover:text-zinc-100 transition-colors">
                  {t.icon}
                </div>
                <span className="text-sm font-semibold text-zinc-100">{t.title}</span>
              </button>
            ))}
          </div>
          {pagesApi.pages.length > 0 && (
            <button
              onClick={openEditor}
              className="text-xs text-zinc-500 hover:text-zinc-200 underline underline-offset-4 transition-colors"
            >
              Continue editing{pagesApi.lastEditedAt ? ` · ${new Date(pagesApi.lastEditedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
            </button>
          )}
        </div>
      )}

      {/* ── Wizard ── */}
      {view === 'wizard' && (
        <CarouselWizard
          flow={wizardFlow}
          platform={platform}
          brandCategory={brand.category}
          onBuild={handleBuild}
          onCancel={() => setView('home')}
        />
      )}

      {/* ── Editor — kept mounted once visited so canvas state survives ── */}
      {editorVisited && (
        <div className="h-full" style={{ display: view === 'editor' ? undefined : 'none' }}>
          <CarouselStudio
            key={editorPlatform} // remount only when the editor is (re)opened at a new platform — canvases fix their frame size at mount
            pagesApi={pagesApi}
            userId={userId}
            brand={brand}
            platform={editorPlatform}
            onBackHome={() => setView('home')}
            pendingSeed={pendingSeed}
            onSeedConsumed={() => setPendingSeed(null)}
          />
        </div>
      )}
    </div>
  );
}
