'use client';

// Guided builder for the 4-card carousel module. Two flows share it:
//   'name'     — pick a Pauv market manually → choose the news → choose photos
//   'trending' — Gemini picks the Pauv-listed figure who's trending right now
// Both end the same way: DeepSeek writes the 4 pages of copy
// (2 news beats → the Pauv angle → a chart CTA), the user picks 3 of 9 photos
// (cards 1–3; card 4 is always the market's chart video), and onBuild hands the
// module to the editor. Adapted from the old AiCardsSection.

import { useEffect, useState } from 'react';
import type { BrandCategory } from '../../types';
import type { CarouselPlatform } from '../carouselTypes';
import { resolvePhotoSrc } from './photoSrc';

interface Talent {
  id: string; ticker: string; name: string; bio: string | null; photo_url: string | null;
  industry: string | null; subcategory: string | null; location: string | null;
  price: { usd: number | null; lifetimeChangePct: number | null; holders: number | null; volumeLifetimeUsd: number | null; latestTickAt: string | null; frozen: boolean };
}
interface LookupItem {
  caption: string; source: 'tweet' | 'article'; url: string; mainPerson: string;
  matchedTicker?: string; publishedAt: string | null; imageUrl: string | null;
  rawText: string; sourceName: string; likeCount?: number;
}
interface Photo { url: string; thumbnail: string; title?: string; source?: string }

export interface CopyPage {
  slideType: 'main' | 'supporting_1';
  headline: string;
  subheadline: string;
}

export interface BuiltCarouselModule {
  pages: CopyPage[];    // exactly 3 — [news hook, what happened, pauv transition]; card 4 is the bare chart
  photoUrls: string[];  // exactly 3, cached/local — cards 1–3 in order
  // Every photo the user saw in the wizard — the editor offers these as
  // one-click swaps if a chosen photo doesn't look right on the card.
  photoPool: Photo[];
  // Context image for card 1's circle (a logo/symbol tying the person to the
  // story — NOT the person). Cached/local URL.
  circlePhotoUrl?: string;
  // The AI-suggested search phrase behind the circle image — the editor reuses
  // it when the user wants to change the circle photo later.
  circleQuery?: string;
  talent: Talent;
  articleUrl?: string;
}

const PAGE_LABELS = ['Main · News hook', 'Supporting · What happened', 'Supporting · Pauv transition'];
// Per-search batch size — two searches (person + story context) of 5 each.
const PHOTO_BATCH = 5;

export function CarouselWizard({
  flow, platform, brandCategory, onBuild, onCancel,
}: {
  flow: 'name' | 'trending';
  // IG builds the 4-card module (3 photo cards + chart); X builds a 2-card
  // post (one story card + chart) — copy generation is shared, X keeps page 1.
  platform: CarouselPlatform;
  brandCategory?: BrandCategory;
  onBuild: (module: BuiltCarouselModule) => void;
  onCancel: () => void;
}) {
  type Step = 'person' | 'news' | 'photos';
  const [step,  setStep]  = useState<Step>('person');
  const [error, setError] = useState<string | null>(null);
  const photosNeeded = platform === 'x' ? 1 : 3;
  const moduleLabel  = platform === 'x' ? '2-card X post' : '4-card module';

  // Roster — the 'name' flow picks from it; 'trending' resolves the AI pick
  // against it (trending is restricted to Pauv-listed figures).
  const [talents,        setTalents]        = useState<Talent[]>([]);
  const [talentsLoading, setTalentsLoading] = useState(true);
  const [search,         setSearch]         = useState('');
  const [selectedTalent, setSelectedTalent] = useState<Talent | null>(null);

  const [lookupLoading, setLookupLoading] = useState(false);
  const [stories,       setStories]       = useState<LookupItem[]>([]);
  const [selectedItem,  setSelectedItem]  = useState<LookupItem | null>(null);

  // Trending flow
  const [trNameHint,   setTrNameHint]   = useState('');
  const [trLoading,    setTrLoading]    = useState(false);
  const [trStory,      setTrStory]      = useState<{ figure: string; ticker: string; storySummary: string; articleUrl?: string } | null>(null);

  // DeepSeek copy
  const [copyPages,   setCopyPages]   = useState<CopyPage[] | null>(null);
  const [copyLoading, setCopyLoading] = useState(false);

  // Card 1's circle context image — DeepSeek suggests the search phrase (e.g.
  // "FIFA World Cup logo"), we fetch candidates, the user picks one.
  const [circleQuery,    setCircleQuery]    = useState('');
  const [circlePhotos,   setCirclePhotos]   = useState<Photo[]>([]);
  const [circleLoading,  setCircleLoading]  = useState(false);
  const [circleOffset,   setCircleOffset]   = useState(0);
  const [circleMore,     setCircleMore]     = useState(false);
  const [selectedCircle, setSelectedCircle] = useState<Photo | null>(null);

  // Photos — TWO searches, 5 each: the person themselves + context photos of
  // the story (the event/scene). Select exactly 3 across both pools
  // (selection order = cards 1–3).
  const [personPhotos,  setPersonPhotos]  = useState<Photo[]>([]);
  const [personQuery,   setPersonQuery]   = useState('');
  const [personOffset,  setPersonOffset]  = useState(0);
  const [personLoading, setPersonLoading] = useState(false);
  const [personMore,    setPersonMore]    = useState(false);
  const [ctxPhotos,     setCtxPhotos]     = useState<Photo[]>([]);
  const [ctxQuery,      setCtxQuery]      = useState('');
  const [ctxOffset,     setCtxOffset]     = useState(0);
  const [ctxLoading,    setCtxLoading]    = useState(false);
  const [ctxMore,       setCtxMore]       = useState(false);
  const [selectedPhotos,      setSelectedPhotos]      = useState<Photo[]>([]);
  const [photoQueryHistory,   setPhotoQueryHistory]   = useState<string[]>([]);
  const [photoQueryRewriting, setPhotoQueryRewriting] = useState(false);
  const [building,            setBuilding]            = useState(false);
  // Master pool — EVERY background-photo search result fetched this run
  // (person + context, replaced grids included), deduped. The editor's Swap
  // strip receives all of them so nothing seen here is ever lost.
  const [photoPoolAll, setPhotoPoolAll] = useState<Photo[]>([]);
  const addToPool = (fresh: Photo[]) => setPhotoPoolAll(cur => {
    const seen = new Set(cur.map(p => p.url));
    return [...cur, ...fresh.filter(p => !seen.has(p.url))];
  });

  useEffect(() => {
    fetch('/api/ai/talents')
      .then(r => r.json()).then((d) => {
        if (Array.isArray(d)) setTalents(d);
        else setError(d?.error ?? 'Failed to load talents');
      })
      .catch(e => setError(String(e))).finally(() => setTalentsLoading(false));
  }, []);

  const filteredTalents = search.trim()
    ? talents.filter(t => {
        const q = search.toLowerCase();
        return t.name.toLowerCase().includes(q) || t.ticker.toLowerCase().includes(q) ||
          (t.industry ?? '').toLowerCase().includes(q) || (t.subcategory ?? '').toLowerCase().includes(q);
      })
    : talents;

  // ── Photos ──────────────────────────────────────────────────────────────────

  const fetchPhotoBatch = async (query: string, offset: number): Promise<Photo[]> => {
    const r = await fetch('/api/ai/photos/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, count: PHOTO_BATCH, offset }) });
    if (!r.ok) throw new Error(await r.text());
    return await r.json() as Photo[];
  };

  const loadPersonPhotos = async (query: string, offset: number, append: boolean, recordHistory = false) => {
    if (!query.trim()) return;
    (append ? setPersonMore : setPersonLoading)(true);
    setPersonQuery(query);
    if (recordHistory) setPhotoQueryHistory(h => h.includes(query) ? h : [...h, query]);
    try {
      const fresh = await fetchPhotoBatch(query, offset);
      setPersonOffset(offset + fresh.length);
      addToPool(fresh);
      setPersonPhotos(cur => {
        if (!append) return fresh;
        const seen = new Set(cur.map(p => p.url));
        return [...cur, ...fresh.filter(p => !seen.has(p.url))];
      });
    } catch (e) { setError(String(e)); }
    finally { (append ? setPersonMore : setPersonLoading)(false); }
  };

  const loadCtxPhotos = async (query: string, offset: number, append: boolean) => {
    if (!query.trim()) return;
    (append ? setCtxMore : setCtxLoading)(true);
    setCtxQuery(query);
    try {
      const fresh = await fetchPhotoBatch(query, offset);
      setCtxOffset(offset + fresh.length);
      addToPool(fresh);
      setCtxPhotos(cur => {
        if (!append) return fresh;
        const seen = new Set(cur.map(p => p.url));
        return [...cur, ...fresh.filter(p => !seen.has(p.url))];
      });
    } catch (e) { setError(String(e)); }
    finally { (append ? setCtxMore : setCtxLoading)(false); }
  };

  const rewritePhotoQuery = async () => {
    if (!selectedTalent) return;
    setPhotoQueryRewriting(true);
    try {
      const r = await fetch('/api/ai/photos/rewrite-query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ personName: selectedTalent.name, personSummary: selectedItem?.caption ?? trStory?.storySummary ?? '', previousQueries: photoQueryHistory }) });
      if (!r.ok) throw new Error(await r.text());
      const { query } = await r.json() as { query: string };
      await loadPersonPhotos(query, 0, false, true);
    } catch (e) { setError(String(e)); }
    finally { setPhotoQueryRewriting(false); }
  };

  const togglePhoto = (p: Photo) => {
    setSelectedPhotos(cur => {
      const idx = cur.findIndex(s => s.url === p.url);
      if (idx !== -1) return cur.filter(s => s.url !== p.url);
      if (cur.length >= photosNeeded) return cur;
      return [...cur, p];
    });
  };

  // ── Copy generation (shared by both flows) ─────────────────────────────────

  const generateCopy = async (
    talent: Talent,
    story: { headline: string; rawText: string; sourceName: string; url?: string },
  ) => {
    setCopyLoading(true); setCopyPages(null); setError(null);
    try {
      const r = await fetch('/api/ai/carousel-copy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personName: talent.name,
          ticker: talent.ticker,
          category: brandCategory,
          story,
        }),
      });
      const data = await r.json() as { pages?: CopyPage[]; personQuery?: string; circleQuery?: string; contextQuery?: string; error?: string };
      if (!r.ok || data.error) throw new Error(data.error ?? `Request failed (${r.status})`);
      if (!data.pages || data.pages.length !== 3) throw new Error('The AI did not return 3 pages');
      setCopyPages(data.pages);
      setCircleQuery(data.circleQuery ?? '');
      setCirclePhotos([]);
      setSelectedCircle(null);
      setCtxQuery(data.contextQuery ?? '');
      setCtxPhotos([]);
      // Story-aware person search (e.g. both names for a two-person story).
      setPersonQuery(data.personQuery?.trim() || talent.name);
      setPersonPhotos([]);
    } catch (e) { setError(String(e)); }
    finally { setCopyLoading(false); }
  };

  const updateCopyPage = (i: number, field: 'headline' | 'subheadline', value: string) =>
    setCopyPages(prev => prev ? prev.map((p, idx) => idx === i ? { ...p, [field]: value } : p) : prev);

  // ── 'name' flow: news lookup ────────────────────────────────────────────────

  const runLookup = async () => {
    if (!selectedTalent) return;
    setError(null); setLookupLoading(true); setStories([]); setSelectedItem(null); setCopyPages(null);
    setPersonPhotos([]); setCtxPhotos([]); setSelectedPhotos([]); setPhotoQueryHistory([]); setPhotoPoolAll([]);
    setStep('news');
    try {
      const r = await fetch('/api/ai/news-lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker: selectedTalent.ticker }) });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json() as { items: LookupItem[] };
      setStories(data.items);
      if (data.items[0]) pickStory(data.items[0], selectedTalent);
    } catch (e) { setError(String(e)); }
    finally { setLookupLoading(false); }
  };

  const pickStory = (item: LookupItem, talent?: Talent) => {
    setSelectedItem(item);
    void generateCopy(talent ?? selectedTalent!, {
      headline: item.caption,
      rawText: item.rawText || item.caption,
      sourceName: item.sourceName,
      url: item.url,
    });
  };

  // ── 'trending' flow: Gemini pick, restricted to the Pauv roster ────────────

  const generateTrending = async () => {
    setError(null); setTrLoading(true); setTrStory(null); setCopyPages(null); setSelectedTalent(null);
    setPersonPhotos([]); setCtxPhotos([]); setSelectedPhotos([]); setPhotoPoolAll([]);
    try {
      const r = await fetch('/api/ai/trending-pick', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nameHint: trNameHint.trim() || undefined, category: brandCategory }),
      });
      const data = await r.json() as { figure?: string; ticker?: string; storySummary?: string; articleUrl?: string; error?: string };
      if (!r.ok || data.error) throw new Error(data.error ?? `Request failed (${r.status})`);
      if (!data.figure || !data.ticker || !data.storySummary) throw new Error('Incomplete trending pick');

      const talent = talents.find(t => t.ticker.toLowerCase() === data.ticker!.toLowerCase())
        ?? talents.find(t => t.name.toLowerCase() === data.figure!.toLowerCase());
      if (!talent) throw new Error(`"${data.figure}" [${data.ticker}] is not in the loaded Pauv roster`);

      setSelectedTalent(talent);
      setTrStory({ figure: data.figure, ticker: data.ticker, storySummary: data.storySummary, articleUrl: data.articleUrl });
      void generateCopy(talent, {
        headline: data.storySummary.split(/(?<=\.)\s/)[0] ?? data.storySummary,
        rawText: data.storySummary,
        sourceName: '',
        url: data.articleUrl,
      });
    } catch (e) { setError(String(e)); }
    finally { setTrLoading(false); }
  };

  const loadCirclePhotos = async (query: string, offset: number, append: boolean) => {
    if (!query.trim()) return;
    (append ? setCircleMore : setCircleLoading)(true);
    setCircleQuery(query);
    try {
      const r = await fetch('/api/ai/photos/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, count: PHOTO_BATCH, offset }) });
      if (!r.ok) throw new Error(await r.text());
      const fresh = await r.json() as Photo[];
      setCircleOffset(offset + fresh.length);
      setCirclePhotos(cur => {
        if (!append) return fresh;
        const seen = new Set(cur.map(p => p.url));
        return [...cur, ...fresh.filter(p => !seen.has(p.url))];
      });
      if (!append) setSelectedCircle(cur => cur && fresh.some(p => p.url === cur.url) ? cur : null);
    } catch (e) { setError(String(e)); }
    finally { (append ? setCircleMore : setCircleLoading)(false); }
  };

  const goToPhotos = () => {
    if (!selectedTalent || !copyPages) return;
    setStep('photos');
    if (personPhotos.length === 0) void loadPersonPhotos(personQuery.trim() || selectedTalent.name, 0, false, true);
    if (ctxPhotos.length === 0 && ctxQuery.trim()) void loadCtxPhotos(ctxQuery, 0, false);
    if (circlePhotos.length === 0 && circleQuery.trim()) void loadCirclePhotos(circleQuery, 0, false);
  };

  // ── Build ───────────────────────────────────────────────────────────────────

  const build = async () => {
    if (!selectedTalent || !copyPages || selectedPhotos.length !== photosNeeded || building) return;
    setBuilding(true);
    try {
      const photoUrls: string[] = [];
      for (const p of selectedPhotos) photoUrls.push(await resolvePhotoSrc(p.url, p.thumbnail));
      const circlePhotoUrl = selectedCircle ? await resolvePhotoSrc(selectedCircle.url, selectedCircle.thumbnail) : undefined;
      onBuild({
        // X keeps only the hook page — its card 2 is the chart.
        pages: platform === 'x' ? copyPages.slice(0, 1) : copyPages,
        photoUrls,
        photoPool: photoPoolAll,
        circlePhotoUrl,
        circleQuery,
        talent: selectedTalent,
        articleUrl: flow === 'name' ? selectedItem?.url : trStory?.articleUrl,
      });
    } finally { setBuilding(false); }
  };

  const restart = () => {
    setStep('person'); setSelectedTalent(null); setSearch(''); setStories([]); setSelectedItem(null);
    setCopyPages(null); setPersonPhotos([]); setCtxPhotos([]); setSelectedPhotos([]); setPhotoPoolAll([]); setError(null);
    setTrStory(null); setTrNameHint('');
    setCircleQuery(''); setCirclePhotos([]); setSelectedCircle(null); setCircleOffset(0);
    setCtxQuery(''); setPersonQuery(''); setPersonOffset(0); setCtxOffset(0);
  };

  const stepLabels: Array<{ key: Step; label: string }> = [
    { key: 'person', label: flow === 'name' ? '1. Market' : '1. Trending pick' },
    { key: 'news',   label: '2. News & copy' },
    { key: 'photos', label: photosNeeded === 1 ? '3. Photo (1 of 9)' : '3. Photos (3 of 9)' },
  ];
  // Trending has no separate news step — the pick screen shows the copy too.
  const visibleSteps = flow === 'trending' ? stepLabels.filter(s => s.key !== 'news') : stepLabels;
  const stepIdx = visibleSteps.findIndex(s => s.key === step);

  // Selectable photo grid shared by the person + context sections. Selection
  // (and its 1/2/3 order badges) spans both pools.
  const photoGrid = (pool: Photo[], loading: boolean, more: boolean, onMore: () => void) => (
    <>
      {loading && <p className="text-sm text-zinc-600 animate-pulse mb-2">Searching…</p>}
      {!loading && pool.length === 0 && <p className="text-sm text-zinc-600 mb-2">No photos yet — press Search.</p>}
      <div className="flex flex-wrap gap-3">
        {pool.map(p => {
          const selIdx = selectedPhotos.findIndex(s => s.url === p.url);
          const isSel = selIdx !== -1;
          return (
            <div key={p.url} onClick={() => togglePhoto(p)}
              className={`relative cursor-pointer rounded-md overflow-hidden border-2 transition-colors ${isSel ? 'border-white' : 'border-transparent hover:border-zinc-600'}`}
              style={{ width: 170, height: 170 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumbnail} alt={p.title ?? ''} className="w-full h-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
              {isSel && (
                <span className="absolute top-1.5 left-1.5 flex items-center justify-center w-6 h-6 rounded-full bg-white text-black text-xs font-bold shadow">
                  {selIdx + 1}
                </span>
              )}
            </div>
          );
        })}
        {more ? (
          <div className="rounded-md bg-zinc-800 animate-pulse" style={{ width: 170, height: 170 }} />
        ) : pool.length > 0 ? (
          <button onClick={onMore} disabled={loading}
            className="flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-zinc-700 hover:border-zinc-500 hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-zinc-600 hover:text-zinc-300"
            style={{ width: 170, height: 170 }}>
            <span className="text-2xl leading-none">+</span>
            <span className="text-xs">More</span>
          </button>
        ) : null}
      </div>
    </>
  );

  // Shared copy editor + continue button. X uses only card 1 (hook headline +
  // subline) — the other two pages exist but stay hidden and unused.
  const visibleCopyPages = copyPages ? (platform === 'x' ? copyPages.slice(0, 1) : copyPages) : null;
  const copyEditor = visibleCopyPages && !copyLoading && (
    <>
      {visibleCopyPages.map((p, i) => (
        <div key={i} className="bg-zinc-950 rounded-lg border border-zinc-800 p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold text-zinc-500">Card {i + 1}</span>
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-500">{PAGE_LABELS[i]}</span>
          </div>
          <label className="block text-xs text-zinc-500 mb-1.5">Headline{i === 1 ? ' (~2 sentences — this card is all headline)' : ''}</label>
          <textarea value={p.headline} onChange={e => updateCopyPage(i, 'headline', e.target.value)} rows={i === 1 ? 3 : 2}
            placeholder="Headline…"
            className="w-full bg-transparent border border-zinc-700 rounded-md px-2.5 py-2 text-sm text-white placeholder-zinc-600 outline-none resize-none mb-3" />
          {i !== 1 && (
            <>
              <label className="block text-xs text-zinc-500 mb-1.5">Subheadline {i === 0 ? '(small text)' : '(optional)'}</label>
              <textarea value={p.subheadline} onChange={e => updateCopyPage(i, 'subheadline', e.target.value)} rows={2}
                placeholder={i === 0 ? 'Short supporting line…' : 'Optional — leave blank for a single text box'}
                className="w-full bg-transparent border border-zinc-700 rounded-md px-2.5 py-2 text-sm text-white placeholder-zinc-600 outline-none resize-none" />
            </>
          )}
        </div>
      ))}
      <button onClick={goToPhotos}
        className="self-start px-4 py-2 rounded-md bg-white text-black hover:bg-zinc-100 text-sm font-semibold transition-colors">
        {photosNeeded === 1 ? 'Next: pick a photo' : 'Next: pick 3 photos'}
      </button>
    </>
  );

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-3 bg-[#0f0f0f] border-b border-zinc-800 shrink-0">
        <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-200 text-sm transition-colors">Back</button>
        <div className="w-px h-4 bg-zinc-800" />
        <span className="text-sm font-semibold text-zinc-100">{flow === 'name' ? 'Carousel · From a name' : 'Carousel · Trending'}</span>
        <div className="flex gap-2">
          {visibleSteps.map((s, i) => (
            <div key={s.key} className={`px-3 py-1 rounded-md text-xs font-medium border transition-colors ${
              i < stepIdx  ? 'bg-zinc-900 border-zinc-800 text-zinc-500'
              : i === stepIdx ? 'bg-zinc-800 border-zinc-600 text-zinc-200'
              : 'bg-zinc-950 border-zinc-800 text-zinc-600'
            }`}>{s.label}</div>
          ))}
        </div>
        {(step !== 'person' || trStory || copyPages) && (
          <button onClick={restart} className="ml-auto text-xs px-2.5 py-1.5 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors">
            Start over
          </button>
        )}
      </div>

      <div className="flex-1 max-w-5xl mx-auto w-full px-4 py-6">
        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-950/50 border border-red-800 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* ── STEP: person — market picker ('name') or trending pick ── */}
        {step === 'person' && flow === 'name' && (
          <div className="bg-zinc-950 rounded-lg border border-zinc-800 p-6">
            <h2 className="text-sm font-semibold mb-1">Pick a Pauv market</h2>
            <p className="text-xs text-zinc-600 mb-4">Search by name or ticker. AI fetches the news, DeepSeek writes the {moduleLabel}.</p>
            <div className="flex items-center gap-2 border border-zinc-700 rounded-md px-2.5 h-9 mb-3">
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search name or ticker…"
                className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none min-w-0"
              />
            </div>
            {talentsLoading && <p className="text-sm text-zinc-500 animate-pulse">Loading markets…</p>}
            <div className="max-h-72 overflow-y-auto flex flex-col gap-1 mb-5">
              {filteredTalents.map(t => (
                <button key={t.id} onClick={() => setSelectedTalent(t)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors border ${selectedTalent?.id === t.id ? 'border-zinc-600 bg-zinc-800' : 'border-transparent hover:bg-zinc-900'}`}>
                  {t.photo_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={t.photo_url} alt={t.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
                    : <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs text-zinc-500 shrink-0">{t.name[0]}</div>}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-100">{t.name}</span>
                      <span className="text-xs text-zinc-600">${t.ticker}</span>
                      {t.price.frozen && <span className="text-xs text-zinc-700">frozen</span>}
                    </div>
                    <div className="text-xs text-zinc-600 truncate">{t.subcategory ?? t.industry ?? ''}</div>
                  </div>
                  <div className="text-right shrink-0">
                    {t.price.usd != null && <div className="text-sm font-medium text-zinc-300">${t.price.usd.toFixed(2)}</div>}
                    {t.price.lifetimeChangePct != null && (
                      <div className={`text-xs ${t.price.lifetimeChangePct >= 0 ? 'text-zinc-400' : 'text-red-400'}`}>
                        {t.price.lifetimeChangePct >= 0 ? '+' : ''}{t.price.lifetimeChangePct.toFixed(1)}%
                      </div>
                    )}
                  </div>
                </button>
              ))}
              {!talentsLoading && filteredTalents.length === 0 && <p className="text-sm text-zinc-600 px-3">No results for &ldquo;{search}&rdquo;</p>}
            </div>
            {selectedTalent && (
              <div className="flex items-center gap-3 pt-4 border-t border-zinc-800">
                <div className="text-sm text-zinc-400">
                  Selected: <span className="text-white font-medium">{selectedTalent.name}</span>
                  <span className="text-zinc-600 ml-2">${selectedTalent.ticker}</span>
                </div>
                <button onClick={runLookup} disabled={lookupLoading}
                  className="ml-auto px-4 py-2 rounded-md bg-white text-black hover:bg-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-semibold transition-colors">
                  {lookupLoading ? 'Fetching…' : 'Fetch news with AI'}
                </button>
              </div>
            )}
          </div>
        )}

        {step === 'person' && flow === 'trending' && (
          <div className="flex flex-col gap-4">
            <div className="bg-zinc-950 rounded-lg border border-zinc-800 p-6">
              <h2 className="text-sm font-semibold mb-1">Trending on Pauv</h2>
              <p className="text-xs text-zinc-600 mb-4">
                Gemini searches the web for the Pauv-listed figure who&rsquo;s trending right now, then DeepSeek writes the {moduleLabel}. Leave the name blank to let it pick.
              </p>
              <label className="block text-xs text-zinc-500 mb-1.5">Name hint (optional)</label>
              <div className="flex items-center border border-zinc-700 rounded-md px-2.5 h-9 mb-3">
                <input value={trNameHint} onChange={e => setTrNameHint(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !trLoading) generateTrending(); }}
                  placeholder="e.g. a name from the roster — or leave blank for auto"
                  className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none min-w-0" />
              </div>
              <div className="flex items-center gap-3">
                {brandCategory && <span className="text-xs text-zinc-600">Steering toward <span className="text-zinc-400">{brandCategory}</span></span>}
                <button onClick={generateTrending} disabled={trLoading || talentsLoading}
                  className="ml-auto px-4 py-2 rounded-md bg-white text-black hover:bg-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-semibold transition-colors">
                  {trLoading ? 'Searching & writing…' : trStory ? 'Regenerate' : 'Find who’s trending'}
                </button>
              </div>
            </div>

            {(trLoading || copyLoading) && (
              <div className="flex flex-col gap-2">
                {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-zinc-900 rounded-lg animate-pulse" />)}
              </div>
            )}

            {trStory && !trLoading && (
              <div className="bg-zinc-950 rounded-lg border border-zinc-800 p-5">
                <div className="flex items-center gap-3">
                  {selectedTalent?.photo_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={selectedTalent.photo_url} alt={trStory.figure} className="w-9 h-9 rounded-full object-cover shrink-0" />
                  )}
                  <div>
                    <div className="text-sm font-semibold text-zinc-100">{trStory.figure} <span className="text-zinc-600 font-normal">${trStory.ticker}</span></div>
                    {trStory.articleUrl && <a href={trStory.articleUrl} target="_blank" rel="noreferrer" className="text-xs text-zinc-500 hover:text-zinc-300 underline">source</a>}
                  </div>
                </div>
                <p className="mt-3 text-sm text-zinc-400 leading-relaxed">{trStory.storySummary}</p>
              </div>
            )}

            {copyEditor}
          </div>
        )}

        {/* ── STEP: news ('name' flow) — stories + DeepSeek copy ── */}
        {step === 'news' && flow === 'name' && selectedTalent && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 px-4 py-3 bg-zinc-950 rounded-lg border border-zinc-800">
              {selectedTalent.photo_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={selectedTalent.photo_url} alt={selectedTalent.name} className="w-9 h-9 rounded-full object-cover shrink-0" />
                : <div className="w-9 h-9 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-sm text-zinc-500 shrink-0">{selectedTalent.name[0]}</div>}
              <div>
                <div className="text-sm font-semibold text-zinc-100">{selectedTalent.name}</div>
                <div className="text-xs text-zinc-600">
                  ${selectedTalent.ticker}
                  {selectedTalent.subcategory ?? selectedTalent.industry ? ` · ${selectedTalent.subcategory ?? selectedTalent.industry}` : ''}
                  {selectedTalent.price.usd != null ? ` · $${selectedTalent.price.usd.toFixed(2)}` : ''}
                </div>
              </div>
            </div>

            <div className="bg-zinc-950 rounded-lg border border-zinc-800 p-5">
              <h2 className="text-sm font-semibold mb-1">Choose the news</h2>
              <p className="text-xs text-zinc-600 mb-4">
                {lookupLoading ? `Fetching news about ${selectedTalent.name}…` : `${stories.length} stories found. Picking one rewrites the ${platform === 'x' ? 'card' : '4 cards'}.`}
              </p>
              {lookupLoading && <div className="flex flex-col gap-2">{[1,2,3].map(i => <div key={i} className="h-14 bg-zinc-800 rounded-md animate-pulse" />)}</div>}
              {!lookupLoading && stories.length === 0 && <p className="text-sm text-zinc-600">No recent news found. Try another market.</p>}
              <div className="flex flex-col gap-1.5">
                {stories.map((item, idx) => (
                  <button key={`${item.url}-${idx}`} onClick={() => pickStory(item)}
                    className={`text-left p-3 rounded-md border transition-colors ${selectedItem?.url === item.url ? 'border-zinc-600 bg-zinc-800' : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'}`}>
                    <div className="text-sm font-medium text-zinc-100 leading-snug">{item.caption}</div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-xs text-zinc-600">{item.sourceName}</span>
                      {item.publishedAt && <span className="text-xs text-zinc-700">· {item.publishedAt}</span>}
                      {item.source === 'tweet' && item.likeCount ? <span className="text-xs text-zinc-700">· {item.likeCount.toLocaleString()} likes</span> : null}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {copyLoading && (
              <div className="flex flex-col gap-2">
                {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-zinc-900 rounded-lg animate-pulse" />)}
              </div>
            )}

            {copyEditor}
          </div>
        )}

        {/* ── STEP: photos — pick exactly 3 of 9 (order = cards 1–3) ── */}
        {step === 'photos' && selectedTalent && (
          <div className="bg-zinc-950 rounded-lg border border-zinc-800 p-5">
            <h2 className="text-sm font-semibold mb-1">{photosNeeded === 1 ? 'Pick 1 photo' : 'Pick 3 photos'}</h2>
            <p className="text-xs text-zinc-600 mb-4">
              {photosNeeded === 1
                ? <>Pick from either search — the person or the story. It becomes the story card; card 2 is {selectedTalent.name}&rsquo;s live chart — no photo needed.</>
                : <>Pick from both searches — the person AND the story. Selection order maps to cards 1–3. Card 4 uses {selectedTalent.name}&rsquo;s live chart — no photo needed.</>}
            </p>

            {/* Search 1 — the person */}
            <div className="mb-5">
              <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">The person</h3>
              <div className="flex gap-2 mb-2">
                <div className="flex items-center gap-2 flex-1 border border-zinc-700 rounded-md px-2.5 h-9">
                  <input value={personQuery} onChange={e => setPersonQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') loadPersonPhotos(personQuery, 0, false, true); }}
                    placeholder={`${selectedTalent.name}…`}
                    className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none min-w-0" />
                </div>
                <button onClick={() => loadPersonPhotos(personQuery, 0, false, true)} disabled={!personQuery.trim() || personLoading}
                  className="px-3 py-2 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 disabled:opacity-40 text-sm transition-colors">Search</button>
                <button onClick={rewritePhotoQuery} disabled={photoQueryRewriting || personLoading}
                  className="px-2.5 py-1.5 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-500 hover:text-zinc-200 hover:border-zinc-600 disabled:opacity-40 text-xs transition-colors">
                  {photoQueryRewriting ? 'Rewriting…' : 'AI rewrite'}
                </button>
              </div>
              {photoGrid(personPhotos, personLoading, personMore, () => void loadPersonPhotos(personQuery, personOffset, true))}
            </div>

            {/* Search 2 — context photos of the story itself */}
            <div className="mb-5 border-t border-zinc-800 pt-4">
              <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">Context — the story</h3>
              <p className="text-xs text-zinc-600 mb-2">The event, venue, or moment — not just portraits.</p>
              <div className="flex gap-2 mb-2">
                <div className="flex items-center gap-2 flex-1 border border-zinc-700 rounded-md px-2.5 h-9">
                  <input value={ctxQuery} onChange={e => setCtxQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') loadCtxPhotos(ctxQuery, 0, false); }}
                    placeholder="e.g. world cup final stadium…"
                    className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none min-w-0" />
                </div>
                <button onClick={() => loadCtxPhotos(ctxQuery, 0, false)} disabled={!ctxQuery.trim() || ctxLoading}
                  className="px-3 py-2 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 disabled:opacity-40 text-sm transition-colors">Search</button>
              </div>
              {photoGrid(ctxPhotos, ctxLoading, ctxMore, () => void loadCtxPhotos(ctxQuery, ctxOffset, true))}
            </div>
            {/* Additional photo — the circle context image on card 1 (a logo/symbol
                tying the person to the story, NOT the person). AI suggested the
                query; edit it and re-search if the results miss. */}
            <div className="border-t border-zinc-800 pt-4 mb-5">
              <h3 className="text-sm font-semibold mb-1">Additional photo — card 1 circle</h3>
              <p className="text-xs text-zinc-600 mb-3">
                Goes in the circle behind {selectedTalent.name} on the first card. A logo or symbol for the story — not the person.
              </p>
              <div className="flex gap-2 mb-3">
                <div className="flex items-center gap-2 flex-1 border border-zinc-700 rounded-md px-2.5 h-9">
                  <input value={circleQuery} onChange={e => setCircleQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') loadCirclePhotos(circleQuery, 0, false); }}
                    placeholder="e.g. FIFA World Cup logo…"
                    className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none min-w-0" />
                </div>
                <button onClick={() => loadCirclePhotos(circleQuery, 0, false)} disabled={!circleQuery.trim() || circleLoading}
                  className="px-3 py-2 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 disabled:opacity-40 text-sm transition-colors">Search</button>
              </div>
              {circleLoading && <p className="text-sm text-zinc-600 animate-pulse mb-3">Searching…</p>}
              {!circleLoading && circlePhotos.length === 0 && circleQuery.trim() !== '' && (
                <p className="text-sm text-zinc-600 mb-3">No results yet — press Search.</p>
              )}
              <div className="flex flex-wrap gap-3">
                {circlePhotos.map(p => (
                  <div key={p.url} onClick={() => setSelectedCircle(cur => cur?.url === p.url ? null : p)}
                    className={`cursor-pointer rounded-full overflow-hidden border-2 transition-colors ${selectedCircle?.url === p.url ? 'border-white' : 'border-zinc-800 hover:border-zinc-600'}`}
                    style={{ width: 110, height: 110 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.thumbnail} alt={p.title ?? ''} className="w-full h-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                  </div>
                ))}
                {circleMore ? (
                  <div className="rounded-full bg-zinc-800 animate-pulse" style={{ width: 110, height: 110 }} />
                ) : circlePhotos.length > 0 ? (
                  <button onClick={() => loadCirclePhotos(circleQuery, circleOffset, true)} disabled={circleLoading}
                    className="flex flex-col items-center justify-center gap-1 rounded-full border-2 border-dashed border-zinc-700 hover:border-zinc-500 hover:bg-zinc-900 disabled:opacity-40 transition-colors text-zinc-600 hover:text-zinc-300"
                    style={{ width: 110, height: 110 }}>
                    <span className="text-2xl leading-none">+</span>
                    <span className="text-xs">More</span>
                  </button>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-zinc-500">
                {selectedPhotos.length}/{photosNeeded} selected{selectedCircle ? ' · circle photo ✓' : ' · no circle photo'}
              </span>
              <button onClick={build} disabled={selectedPhotos.length !== photosNeeded || building}
                className="ml-auto px-4 py-2 rounded-md bg-white text-black hover:bg-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-semibold transition-colors">
                {building ? 'Downloading photos…' : `Build ${moduleLabel}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
