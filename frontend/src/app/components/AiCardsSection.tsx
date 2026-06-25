'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { CarouselPage } from '../types';

interface Talent {
  id: string; ticker: string; name: string; bio: string | null; photo_url: string | null;
  industry: string | null; subcategory: string | null; location: string | null;
  price: { usd: number | null; lifetimeChangePct: number | null; holders: number | null; volumeLifetimeUsd: number | null; latestTickAt: string | null; frozen: boolean };
}
interface LookupItem {
  caption: string; source: 'tweet' | 'article'; url: string; mainPerson: string;
  matchedTicker?: string; publishedAt: string | null; imageUrl: string | null;
  rawText: string; sourceName: string; likeCount?: number;
  extractPayload: { title?: string; description?: string | null; tweetText?: string; tweetAuthorName?: string; tweetAuthorHandle?: string };
}
interface Photo { url: string; thumbnail: string; title?: string; source?: string }
interface MeshResult { headline: string; subheadline: string }
type Step = 'market' | 'ai' | 'photo';


interface AiCardsSectionProps {
  onBuildCard: (seed: { imageSrc: string; headline: string; subheadline: string; subheadline2?: string; articleUrl?: string }) => void;
  onBuildCarousel: (pages: CarouselPage[]) => void;
  brandCategory?: 'artists' | 'athletes' | 'gamers';
  onCancel: () => void;
}

export function AiCardsSection({ onBuildCard, onBuildCarousel, brandCategory, onCancel }: AiCardsSectionProps) {
  // Two flows share this screen: "market" (pick a Pauv talent → one card) and
  // "trending" (Gemini finds any hot public figure → a whole multi-page carousel).
  // The carousel toolbar's "AI" button deep-links here with ?flow=trending.
  const searchParams = useSearchParams();
  const [flow, setFlow] = useState<'market' | 'trending'>(
    searchParams.get('flow') === 'trending' ? 'trending' : 'market',
  );
  // Kept mounted across navigation, so re-apply the deep-link on later visits too.
  useEffect(() => {
    if (searchParams.get('flow') === 'trending') setFlow('trending');
  }, [searchParams]);
  const [step, setStep] = useState<Step>('market');
  const [error, setError] = useState<string | null>(null);

  // ── Trending (auto) flow state ──
  const [trNameHint, setTrNameHint] = useState('');
  const [trLoading, setTrLoading] = useState(false);
  const [trFigure, setTrFigure] = useState('');
  const [trArticleUrl, setTrArticleUrl] = useState<string | undefined>(undefined);
  const [trPages, setTrPages] = useState<CarouselPage[]>([]);

  const [talents, setTalents] = useState<Talent[]>([]);
  const [talentsLoading, setTalentsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedTalent, setSelectedTalent] = useState<Talent | null>(null);

  const [lookupLoading, setLookupLoading] = useState(false);
  const [stories, setStories] = useState<LookupItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<LookupItem | null>(null);
  const [meshLoading, setMeshLoading] = useState(false);
  const [headline, setHeadline] = useState('');
  const [subheadline, setSubheadline] = useState('');
  const [subheadline2, setSubheadline2] = useState('');
  const [npsiLoading, setNpsiLoading] = useState(false);

  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [photoQuery, setPhotoQuery] = useState('');
  const [photoOffset, setPhotoOffset] = useState(0);
  const [photoQueryHistory, setPhotoQueryHistory] = useState<string[]>([]);
  const [photoQueryRewriting, setPhotoQueryRewriting] = useState(false);
  const [cachingPhoto, setCachingPhoto] = useState(false);
  const [findMoreLoading, setFindMoreLoading] = useState(false);
  const photoScrollRef = useRef<HTMLDivElement>(null);
  const photoGridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (photoScrollRef.current) {
      photoScrollRef.current.scrollTop = photoScrollRef.current.scrollHeight;
    }
    if (photoGridRef.current) {
      photoGridRef.current.scrollTop = photoGridRef.current.scrollHeight;
    }
  }, [photos]);

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

  const loadPhotos = async (query: string, offset: number, recordHistory: boolean, count = 3) => {
    setPhotosLoading(true); setPhotoQuery(query);
    if (recordHistory) setPhotoQueryHistory(h => h.includes(query) ? h : [...h, query]);
    try {
      const r = await fetch('/api/ai/photos/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, count, offset }) });
      if (!r.ok) throw new Error(await r.text());
      const fresh = await r.json() as Photo[];
      setPhotoOffset(offset + fresh.length);
      setPhotos(fresh);
      setSelectedPhoto(cur => cur && fresh.some(p => p.url === cur.url) ? cur : null);
    } catch (e) { setError(String(e)); }
    finally { setPhotosLoading(false); }
  };

  const findMorePhotos = async () => {
    if (!photoQuery || findMoreLoading || photosLoading) return;
    setFindMoreLoading(true);
    try {
      const r = await fetch('/api/ai/photos/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: photoQuery, count: 3, offset: photoOffset }) });
      if (!r.ok) throw new Error(await r.text());
      const fresh = await r.json() as Photo[];
      if (!fresh.length) return;
      setPhotoOffset(prev => prev + fresh.length);
      setPhotos(current => {
        const seen = new Set(current.map(p => p.url));
        return [...current, ...fresh.filter(p => !seen.has(p.url))];
      });
    } catch (e) { setError(String(e)); }
    finally { setFindMoreLoading(false); }
  };

  const rewritePhotoQuery = async () => {
    if (!selectedTalent) return;
    setPhotoQueryRewriting(true);
    try {
      const r = await fetch('/api/ai/photos/rewrite-query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ personName: selectedTalent.name, personSummary: selectedItem?.caption ?? '', previousQueries: photoQueryHistory }) });
      if (!r.ok) throw new Error(await r.text());
      const { query } = await r.json() as { query: string };
      await loadPhotos(query, 0, true);
    } catch (e) { setError(String(e)); }
    finally { setPhotoQueryRewriting(false); }
  };

  const pickStory = (item: LookupItem) => {
    setSelectedItem(item); setHeadline(''); setSubheadline(''); setSubheadline2('');
    setMeshLoading(true);
    fetch('/api/ai/mesh-headline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ headline: item.caption, category: selectedTalent?.subcategory ?? selectedTalent?.industry ?? '', personName: selectedTalent?.name ?? item.mainPerson }) })
      .then(r => r.json() as Promise<MeshResult>)
      .then(data => { setHeadline(data.headline); setSubheadline(data.subheadline); })
      .catch(e => console.warn('[mesh]', e))
      .finally(() => setMeshLoading(false));

    if (selectedTalent) {
      setNpsiLoading(true);
      fetch('/api/ai/npsi-analysis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ personName: selectedTalent.name, ticker: selectedTalent.ticker, headline: item.caption, priceUsd: selectedTalent.price.usd, lifetimeChangePct: selectedTalent.price.lifetimeChangePct, holders: selectedTalent.price.holders }) })
        .then(r => r.json() as Promise<{ npsiAnalysis?: string }>)
        .then(data => { setSubheadline2(data.npsiAnalysis ?? ''); })
        .catch(e => console.warn('[npsi]', e))
        .finally(() => setNpsiLoading(false));
    }
  };

  const runLookup = async () => {
    if (!selectedTalent) return;
    setError(null); setLookupLoading(true); setStories([]); setSelectedItem(null);
    setHeadline(''); setSubheadline(''); setSubheadline2(''); setPhotos([]); setSelectedPhoto(null); setPhotoQueryHistory([]);
    setStep('ai');
    loadPhotos(selectedTalent.name, 0, true);
    try {
      const r = await fetch('/api/ai/news-lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker: selectedTalent.ticker }) });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json() as { items: LookupItem[] };
      setStories(data.items);
      if (data.items[0]) pickStory(data.items[0]);
    } catch (e) { setError(String(e)); }
    finally { setLookupLoading(false); }
  };

  const buildCard = async () => {
    if (!selectedPhoto) return;
    let imageSrc = selectedPhoto.url;
    if (/^https?:\/\//i.test(imageSrc)) {
      setCachingPhoto(true);
      try {
        const r = await fetch('/api/ai/photos/cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: imageSrc }) });
        if (r.ok) { const data = await r.json() as { localUrl: string }; imageSrc = data.localUrl; }
      } catch (e) { console.warn('[cache]', e); }
      finally { setCachingPhoto(false); }
    }
    onBuildCard({
      imageSrc, headline, subheadline,
      subheadline2: subheadline2 || undefined,
      // Carry the source story's URL through so the media tab's article link
      // field pre-populates instead of needing a manual paste.
      articleUrl: selectedItem?.url,
    });
    // Snap back to step 2 so when the user clicks the back-arrow in the media
    // tab, they land on AI News (not the Photo step they were just on).
    setStep('ai');
  };

  const restart = () => {
    setStep('market'); setSelectedTalent(null); setSearch(''); setStories([]);
    setSelectedItem(null); setHeadline(''); setSubheadline(''); setSubheadline2(''); setPhotos([]); setSelectedPhoto(null); setError(null);
    setTrPages([]); setTrFigure(''); setTrArticleUrl(undefined); setTrNameHint('');
  };

  const generateTrending = async () => {
    setError(null); setTrLoading(true); setTrPages([]); setTrFigure(''); setTrArticleUrl(undefined);
    try {
      const r = await fetch('/api/ai/trending-carousel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nameHint: trNameHint.trim() || undefined, category: brandCategory }),
      });
      const data = await r.json() as { figure?: string; articleUrl?: string; pages?: CarouselPage[]; error?: string };
      if (!r.ok || data.error) throw new Error(data.error ?? `Request failed (${r.status})`);
      if (!data.pages?.length) throw new Error('No pages returned');
      setTrFigure(data.figure ?? '');
      setTrArticleUrl(data.articleUrl);
      setTrPages(data.pages);
    } catch (e) { setError(String(e)); }
    finally { setTrLoading(false); }
  };

  const updateTrPage = (i: number, field: 'headline' | 'subheadline', value: string) =>
    setTrPages(prev => prev.map((p, idx) => idx === i ? { ...p, [field]: value } : p));

  const buildTrending = () => {
    if (!trPages.length) return;
    // Attach the source article to the main page so the media tab's article-link
    // field pre-populates, mirroring the single-card flow.
    onBuildCarousel(trPages.map((p, i) => (i === 0 && trArticleUrl ? { ...p, articleUrl: trArticleUrl } : p)));
  };

  const stepLabels: Array<{ key: Step; label: string }> = [
    { key: 'market', label: '1. Market' },
    { key: 'ai',     label: '2. AI News' },
    { key: 'photo',  label: '3. Photo' },
  ];
  const stepIdx = stepLabels.findIndex(s => s.key === step);

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex flex-col">
      {/* Header — matches CanvasGrid toolbar */}
      <div className="flex items-center gap-4 px-4 py-3 bg-[#0f0f0f] border-b border-zinc-800 shrink-0">
        <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-200 text-sm transition-colors">Back</button>
        <div className="w-px h-4 bg-zinc-800" />
        <span className="text-sm font-semibold text-zinc-100">AI Cards</span>
        {/* Flow toggle: a single card from a Pauv market, or a whole carousel
            auto-built from a trending public figure (not limited to Pauv). */}
        <div className="flex gap-1 rounded-md bg-zinc-950 border border-zinc-800 p-0.5">
          {([['market', 'Pick market'], ['trending', 'Trending (auto)']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setFlow(key)}
              className={`text-xs px-2.5 py-1 rounded transition-colors ${flow === key ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>
              {label}
            </button>
          ))}
        </div>
        {((flow === 'market' && step !== 'market') || (flow === 'trending' && trPages.length > 0)) && (
          <button onClick={restart} className="ml-auto text-xs px-2.5 py-1.5 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors">
            Start over
          </button>
        )}
      </div>

      <div className="flex-1 max-w-5xl mx-auto w-full px-4 py-6">
        {/* Step bar (market flow only) */}
        {flow === 'market' && (
          <div className="flex gap-2 mb-6">
            {stepLabels.map((s, i) => (
              <div key={s.key} className={`px-3 py-1 rounded-md text-xs font-medium border transition-colors ${
                i < stepIdx  ? 'bg-zinc-900 border-zinc-800 text-zinc-500'
                : i === stepIdx ? 'bg-zinc-800 border-zinc-600 text-zinc-200'
                : 'bg-zinc-950 border-zinc-800 text-zinc-600'
              }`}>{s.label}</div>
            ))}
          </div>
        )}

        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-950/50 border border-red-800 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* ── TRENDING (auto) flow ── */}
        {flow === 'trending' && (
          <div className="flex flex-col gap-4">
            <div className="bg-zinc-950 rounded-lg border border-zinc-800 p-6">
              <h2 className="text-sm font-semibold mb-1">Trending carousel</h2>
              <p className="text-xs text-zinc-600 mb-4">
                Gemini searches the web for a trending public figure and writes a full carousel — a main page plus supporting pages ending in a pauv.com CTA. Leave the name blank to let it pick who&rsquo;s hot right now.
              </p>
              <label className="block text-xs text-zinc-500 mb-1.5">Name hint (optional)</label>
              <div className="flex items-center border border-zinc-700 rounded-md px-2.5 h-9 mb-3">
                <input value={trNameHint} onChange={e => setTrNameHint(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !trLoading) generateTrending(); }}
                  placeholder="e.g. Vozinha — or leave blank for auto"
                  className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none min-w-0" />
              </div>
              <div className="flex items-center gap-3">
                {brandCategory && <span className="text-xs text-zinc-600">Steering toward <span className="text-zinc-400">{brandCategory}</span></span>}
                <button onClick={generateTrending} disabled={trLoading}
                  className="ml-auto px-4 py-2 rounded-md bg-white text-black hover:bg-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-semibold transition-colors">
                  {trLoading ? 'Searching & writing…' : trPages.length ? 'Regenerate' : 'Generate carousel'}
                </button>
              </div>
            </div>

            {trLoading && (
              <div className="flex flex-col gap-2">
                {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-24 bg-zinc-900 rounded-lg animate-pulse" />)}
              </div>
            )}

            {!trLoading && trPages.length > 0 && (
              <>
                <div className="flex items-center justify-between px-1">
                  <p className="text-sm text-zinc-400">
                    {trFigure && <>Story: <span className="text-white font-medium">{trFigure}</span> · </>}
                    {trPages.length} pages. Edit freely.
                    {trArticleUrl && <> · <a href={trArticleUrl} target="_blank" rel="noreferrer" className="text-zinc-500 hover:text-zinc-300 underline">source</a></>}
                  </p>
                </div>
                {trPages.map((p, i) => {
                  const isMain = p.slideType === 'main';
                  const isLast = i === trPages.length - 1;
                  const label = isMain ? 'Main' : isLast ? 'CTA · Supporting 1' : 'Supporting 1';
                  return (
                    <div key={i} className="bg-zinc-950 rounded-lg border border-zinc-800 p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-xs font-semibold text-zinc-500">Page {i + 1}</span>
                        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-500">{label}</span>
                      </div>
                      <label className="block text-xs text-zinc-500 mb-1.5">Headline{isMain ? '' : ' (text box)'}</label>
                      <textarea value={p.headline} onChange={e => updateTrPage(i, 'headline', e.target.value)} rows={2}
                        placeholder="Headline…"
                        className="w-full bg-transparent border border-zinc-700 rounded-md px-2.5 py-2 text-sm text-white placeholder-zinc-600 outline-none resize-none mb-3" />
                      <label className="block text-xs text-zinc-500 mb-1.5">
                        Subheadline {isMain ? '(small text)' : '(optional — same size as headline)'}
                      </label>
                      <textarea value={p.subheadline} onChange={e => updateTrPage(i, 'subheadline', e.target.value)} rows={2}
                        placeholder={isMain ? 'Short supporting line…' : 'Optional — leave blank for a single text box'}
                        className="w-full bg-transparent border border-zinc-700 rounded-md px-2.5 py-2 text-sm text-white placeholder-zinc-600 outline-none resize-none" />
                    </div>
                  );
                })}
                <button onClick={buildTrending}
                  className="self-start px-4 py-2 rounded-md bg-white text-black hover:bg-zinc-100 text-sm font-semibold transition-colors">
                  Build carousel ({trPages.length} pages)
                </button>
                <p className="text-xs text-zinc-600">Images are left blank — drop photos onto each page in the editor.</p>
              </>
            )}
          </div>
        )}

        {/* STEP 1: Market picker */}
        {flow === 'market' && step === 'market' && (
          <div className="bg-zinc-950 rounded-lg border border-zinc-800 p-6">
            <h2 className="text-sm font-semibold mb-1">Pick a Pauv market</h2>
            <p className="text-xs text-zinc-600 mb-4">Search by name or ticker. AI will fetch news about them.</p>
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

        {/* STEP 2: AI — news + headline mesh */}
        {flow === 'market' && step === 'ai' && selectedTalent && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3 px-4 py-3 bg-zinc-950 rounded-lg border border-zinc-800">
                {selectedTalent.photo_url
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
                <h2 className="text-sm font-semibold mb-1">AI News</h2>
                <p className="text-xs text-zinc-600 mb-4">
                  {lookupLoading ? `Fetching news about ${selectedTalent.name}…` : `${stories.length} stories found. Click one to remesh.`}
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

              {selectedItem && (
                <div className="bg-zinc-950 rounded-lg border border-zinc-800 p-5">
                  <h2 className="text-sm font-semibold mb-1">Headline</h2>
                  <p className="text-xs text-zinc-600 mb-4">AI reformats into card-ready copy. Edit freely.</p>
                  {meshLoading ? <p className="text-sm text-zinc-600 animate-pulse">Meshing headline…</p> : (
                    <>
                      <label className="block text-xs text-zinc-500 mb-1.5">Headline</label>
                      <div className="flex items-center border border-zinc-700 rounded-md px-2.5 h-9 mb-3">
                        <input value={headline} onChange={e => setHeadline(e.target.value)} placeholder="AI headline…"
                          className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none min-w-0" />
                      </div>
                      <label className="block text-xs text-zinc-500 mb-1.5">Subheadline</label>
                      <div className="flex items-center border border-zinc-700 rounded-md px-2.5 h-9 mb-3">
                        <input value={subheadline} onChange={e => setSubheadline(e.target.value)} placeholder="AI subheadline…"
                          className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none min-w-0" />
                      </div>
                      <label className="block text-xs text-zinc-500 mb-1.5">NPSI Impact</label>
                      <div className="flex items-start border border-zinc-700 rounded-md px-2.5 py-2 min-h-[4rem]">
                        {npsiLoading
                          ? <p className="text-xs text-zinc-600 animate-pulse">Analysing NPSI impact…</p>
                          : <textarea value={subheadline2} onChange={e => setSubheadline2(e.target.value)} placeholder="AI NPSI prediction analysis…" rows={3}
                              className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none min-w-0 resize-none" />}
                      </div>
                    </>
                  )}
                  <button onClick={() => setStep('photo')} disabled={!headline || meshLoading}
                    className="mt-4 w-full px-4 py-2 rounded-md bg-white text-black hover:bg-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-semibold transition-colors">
                    Next: Pick photo
                  </button>
                </div>
              )}
            </div>

            <div className="bg-zinc-950 rounded-lg border border-zinc-800 p-5 self-start">
              <h2 className="text-sm font-semibold mb-1">Photos</h2>
              <p className="text-xs text-zinc-600 mb-4">Auto-fetched for {selectedTalent.name}.</p>
              <div ref={photoScrollRef} className="overflow-y-auto max-h-[480px]">
                {photosLoading && <div className="flex flex-wrap gap-3">{[1,2,3].map(i => <div key={i} className="rounded-md bg-zinc-800 animate-pulse" style={{ width: 140, height: 140 }} />)}</div>}
                {!photosLoading && photos.length === 0 && <p className="text-sm text-zinc-600">No images found yet.</p>}
                <div className="flex flex-wrap gap-3">
                  {photos.map(p => (
                    <div key={p.url} onClick={() => setSelectedPhoto(p)}
                      className={`cursor-pointer rounded-md overflow-hidden border-2 transition-colors ${selectedPhoto?.url === p.url ? 'border-white' : 'border-transparent hover:border-zinc-600'}`}
                      style={{ width: 140, height: 140 }}>
                      <img src={p.thumbnail} alt={p.title ?? ''} className="w-full h-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                    </div>
                  ))}
                  {findMoreLoading ? (
                    <div className="rounded-md bg-zinc-800 animate-pulse" style={{ width: 140, height: 140 }} />
                  ) : photos.length > 0 ? (
                    <button onClick={findMorePhotos} disabled={photosLoading}
                      className="flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-zinc-700 hover:border-zinc-500 hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-zinc-600 hover:text-zinc-300"
                      style={{ width: 140, height: 140 }}>
                      <span className="text-2xl leading-none">+</span>
                      <span className="text-xs">More</span>
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: Photo picker */}
        {flow === 'market' && step === 'photo' && selectedTalent && (
          <div className="bg-zinc-950 rounded-lg border border-zinc-800 p-5">
            <h2 className="text-sm font-semibold mb-4">Pick a photo</h2>
            <div className="flex flex-col gap-2 mb-4">
              <div className="flex gap-2">
                <div className="flex items-center gap-2 flex-1 border border-zinc-700 rounded-md px-2.5 h-9">
                  <input value={photoQuery} onChange={e => setPhotoQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') loadPhotos(photoQuery, 0, true); }}
                    placeholder="Search query…"
                    className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none min-w-0" />
                </div>
                <button onClick={() => loadPhotos(photoQuery, 0, true)} disabled={!photoQuery.trim() || photosLoading}
                  className="px-3 py-2 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 disabled:opacity-40 text-sm transition-colors">Search</button>
              </div>
              <div className="flex gap-2">
                <button onClick={rewritePhotoQuery} disabled={photoQueryRewriting || photosLoading}
                  className="px-2.5 py-1.5 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-500 hover:text-zinc-200 hover:border-zinc-600 disabled:opacity-40 text-xs transition-colors">
                  {photoQueryRewriting ? 'Rewriting…' : 'Rewrite query with AI'}
                </button>
              </div>
            </div>
            {photosLoading && <p className="text-sm text-zinc-600 animate-pulse mb-4">Searching…</p>}
            {!photosLoading && photos.length === 0 && <p className="text-sm text-zinc-600 mb-4">No photos. Try a search or Rewrite query.</p>}
            <div ref={photoGridRef} className="overflow-y-auto max-h-[520px] mb-5">
              <div className="flex flex-wrap gap-3">
                {photos.map(p => (
                  <div key={p.url} onClick={() => setSelectedPhoto(p)}
                    className={`cursor-pointer rounded-md overflow-hidden border-2 transition-colors ${selectedPhoto?.url === p.url ? 'border-white' : 'border-transparent hover:border-zinc-600'}`}
                    style={{ width: 180, height: 180 }}>
                    <img src={p.thumbnail} alt={p.title ?? ''} className="w-full h-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                  </div>
                ))}
                {findMoreLoading ? (
                  <div className="rounded-md bg-zinc-800 animate-pulse" style={{ width: 180, height: 180 }} />
                ) : photoQuery ? (
                  <button onClick={findMorePhotos} disabled={photosLoading}
                    className="flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-zinc-700 hover:border-zinc-500 hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-zinc-600 hover:text-zinc-300"
                    style={{ width: 180, height: 180 }}>
                    <span className="text-2xl leading-none">+</span>
                    <span className="text-xs">More</span>
                  </button>
                ) : null}
              </div>
            </div>
            {selectedPhoto?.source && <p className="text-xs text-zinc-600 mb-4">Credit: <strong className="text-zinc-400">{selectedPhoto.source}</strong>. Verify usage rights before publishing.</p>}
            {selectedPhoto && (
              <button onClick={buildCard} disabled={cachingPhoto}
                className="px-4 py-2 rounded-md bg-white text-black hover:bg-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-semibold transition-colors">
                {cachingPhoto ? 'Downloading photo…' : 'Build card'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
