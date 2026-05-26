'use client';

import { useEffect, useState } from 'react';

// ---- types ----

interface Talent {
  id: string;
  ticker: string;
  name: string;
  bio: string | null;
  photo_url: string | null;
  industry: string | null;
  subcategory: string | null;
  location: string | null;
  price: {
    usd: number | null;
    lifetimeChangePct: number | null;
    holders: number | null;
    volumeLifetimeUsd: number | null;
    latestTickAt: string | null;
    frozen: boolean;
  };
}

interface LookupItem {
  caption: string;
  source: 'tweet' | 'article';
  url: string;
  mainPerson: string;
  matchedTicker?: string;
  publishedAt: string | null;
  imageUrl: string | null;
  rawText: string;
  sourceName: string;
  extractPayload: {
    title?: string;
    description?: string | null;
  };
}

interface Photo { url: string; thumbnail: string; title?: string; source?: string; }
interface MeshResult { headline: string; subheadline: string; }

type Step = 'market' | 'ai' | 'photo' | 'card';

// ---- helpers ----

async function verifyAndCache(raw: Photo[]): Promise<Photo[]> {
  const results = await Promise.all(
    raw.map(async (p) => {
      if (!p.url || !/^https?:\/\//i.test(p.url)) return p;
      try {
        const r = await fetch('/api/ai/photos/cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: p.url }),
        });
        if (!r.ok) return null;
        const data = await r.json() as { localUrl: string };
        return { ...p, url: data.localUrl, thumbnail: data.localUrl };
      } catch { return null; }
    }),
  );
  return results.filter((p): p is Photo => p !== null);
}

// ---- component ----

export default function AICardsPage() {
  const [step, setStep] = useState<Step>('market');
  const [error, setError] = useState<string | null>(null);

  // step 1 — market picker
  const [talents, setTalents] = useState<Talent[]>([]);
  const [talentsLoading, setTalentsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedTalent, setSelectedTalent] = useState<Talent | null>(null);

  // step 2 — news + AI
  const [lookupLoading, setLookupLoading] = useState(false);
  const [stories, setStories] = useState<LookupItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<LookupItem | null>(null);
  const [meshLoading, setMeshLoading] = useState(false);
  const [headline, setHeadline] = useState('');
  const [subheadline, setSubheadline] = useState('');

  // photos
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [photoQuery, setPhotoQuery] = useState('');
  const [photoOffset, setPhotoOffset] = useState(0);
  const [photoQueryHistory, setPhotoQueryHistory] = useState<string[]>([]);
  const [photoQueryRewriting, setPhotoQueryRewriting] = useState(false);
  const [cachingPhoto, setCachingPhoto] = useState(false);
  const [articleImagesLoading, setArticleImagesLoading] = useState(false);
  const [findMoreLoading, setFindMoreLoading] = useState(false);

  // load all Pauv markets on mount
  useEffect(() => {
    fetch('/api/ai/talents')
      .then((r) => r.json())
      .then((d: Talent[]) => setTalents(d))
      .catch((e) => setError(String(e)))
      .finally(() => setTalentsLoading(false));
  }, []);

  // filtered talent list
  const filteredTalents = search.trim()
    ? talents.filter((t) => {
        const q = search.toLowerCase();
        return (
          t.name.toLowerCase().includes(q) ||
          t.ticker.toLowerCase().includes(q) ||
          (t.industry ?? '').toLowerCase().includes(q) ||
          (t.subcategory ?? '').toLowerCase().includes(q)
        );
      })
    : talents;

  // ---- photo helpers ----

  // count: how many to fetch. photoOffset after this call = offset + count,
  // so the next append or replace always continues from where we left off.
  const loadPhotos = async (query: string, offset: number, recordHistory: boolean, count = 3) => {
    setPhotosLoading(true);
    setPhotoQuery(query);
    if (recordHistory) setPhotoQueryHistory((h) => (h.includes(query) ? h : [...h, query]));
    try {
      const r = await fetch('/api/ai/photos/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, count, offset }),
      });
      if (!r.ok) throw new Error(await r.text());
      const fresh = await r.json() as Photo[];
      setPhotoOffset(offset + fresh.length);
      setPhotos(fresh);
      setSelectedPhoto((cur) => (cur && fresh.some((p) => p.url === cur.url) ? cur : null));
    } catch (e) {
      setError(String(e));
    } finally {
      setPhotosLoading(false);
    }
  };

  const findMorePhotos = async () => {
    if (!photoQuery || findMoreLoading || photosLoading) return;
    setFindMoreLoading(true);
    try {
      const r = await fetch('/api/ai/photos/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: photoQuery, count: 3, offset: photoOffset }),
      });
      if (!r.ok) throw new Error(await r.text());
      const fresh = await r.json() as Photo[];
      if (!fresh.length) return;
      setPhotoOffset((prev) => prev + fresh.length);
      setPhotos((current) => {
        const seen = new Set(current.map((p) => p.url));
        return [...current, ...fresh.filter((p) => !seen.has(p.url))];
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setFindMoreLoading(false);
    }
  };

  const rewritePhotoQuery = async () => {
    if (!selectedTalent) return;
    setPhotoQueryRewriting(true);
    try {
      const r = await fetch('/api/ai/photos/rewrite-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personName: selectedTalent.name,
          personSummary: selectedItem?.caption ?? '',
          previousQueries: photoQueryHistory,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const { query } = await r.json() as { query: string };
      await loadPhotos(query, 0, true);
    } catch (e) {
      setError(String(e));
    } finally {
      setPhotoQueryRewriting(false);
    }
  };

  // ---- step 1 → 2: fetch news for the selected talent ----

  const runLookup = async () => {
    if (!selectedTalent) return;
    setError(null);
    setLookupLoading(true);
    setStories([]);
    setSelectedItem(null);
    setHeadline('');
    setSubheadline('');
    setPhotos([]);
    setSelectedPhoto(null);
    setPhotoQueryHistory([]);
    setStep('ai');

    // Load 6 images immediately so the grid isn't sparse while news fetches.
    loadPhotos(selectedTalent.name, 0, true, 6);

    try {
      const r = await fetch('/api/ai/news-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: selectedTalent.ticker }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json() as { items: LookupItem[]; personName: string; candidatesConsidered: number };
      setStories(data.items);
      // Auto-pick the top story and mesh its headline.
      if (data.items[0]) pickStory(data.items[0]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLookupLoading(false);
    }
  };

  // Collects images from all available sources for the picked story, caches
  // them server-side, then prepends them to the photo grid ahead of the SerpAPI
  // results already there. Sources in priority order:
  //   1. imageUrl from newsdata API (direct image, no scraping needed)
  //   2. og:image / twitter:image scraped from the article URL
  const loadStoryImages = async (item: LookupItem) => {
    if (item.source !== 'article') return;
    setArticleImagesLoading(true);
    try {
      // Source 1: direct image from newsdata (already a URL, no scraping).
      const directCandidates: string[] = item.imageUrl ? [item.imageUrl] : [];

      // Source 2: og:image / twitter:image scraped from the article page.
      let scrapedCandidates: string[] = [];
      let siteName: string | null = null;
      if (item.url) {
        try {
          const r = await fetch('/api/ai/article/scrape-images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: item.url }),
          });
          if (r.ok) {
            const data = await r.json() as { images: string[]; siteName: string | null };
            scrapedCandidates = data.images ?? [];
            siteName = data.siteName;
          }
        } catch (e) {
          console.warn('[article scrape]', e);
        }
      }

      // Merge, dedupe by URL, build Photo objects.
      const seen = new Set<string>();
      const candidates: Photo[] = [];
      for (const src of [...directCandidates, ...scrapedCandidates]) {
        if (!src || seen.has(src)) continue;
        seen.add(src);
        candidates.push({
          url: src,
          thumbnail: src,
          title: candidates.length === 0 ? 'Article image' : `Article image ${candidates.length + 1}`,
          source: siteName ?? item.sourceName,
        });
      }

      if (!candidates.length) return;

      // Cache each image server-side (drops any that fail to download).
      const verified = await verifyAndCache(candidates);
      if (!verified.length) return;

      // Prepend to grid; remove any SerpAPI duplicates by URL.
      setPhotos((current) => {
        const articleUrls = new Set(verified.map((p) => p.url));
        const deduped = current.filter((p) => !articleUrls.has(p.url));
        return [...verified, ...deduped];
      });
    } finally {
      setArticleImagesLoading(false);
    }
  };

  // Picking a story: mesh headline + load all article image sources into the grid.
  const pickStory = (item: LookupItem) => {
    setSelectedItem(item);
    setHeadline('');
    setSubheadline('');

    setMeshLoading(true);
    fetch('/api/ai/mesh-headline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        headline: item.caption,
        category: selectedTalent?.subcategory ?? selectedTalent?.industry ?? '',
        personName: selectedTalent?.name ?? item.mainPerson,
      }),
    })
      .then((r) => r.json() as Promise<MeshResult>)
      .then((data) => { setHeadline(data.headline); setSubheadline(data.subheadline); })
      .catch((e) => console.warn('[mesh]', e))
      .finally(() => setMeshLoading(false));

    loadStoryImages(item);
  };

  const buildCard = async () => {
    if (!selectedPhoto) return;
    let imageSrc = selectedPhoto.url;

    if (/^https?:\/\//i.test(imageSrc)) {
      setCachingPhoto(true);
      try {
        const r = await fetch('/api/ai/photos/cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: imageSrc }),
        });
        if (r.ok) {
          const data = await r.json() as { localUrl: string };
          imageSrc = data.localUrl;
        }
      } catch (e) { console.warn('[cache]', e); }
      finally { setCachingPhoto(false); }
    }

    sessionStorage.setItem('ai-card-seed', JSON.stringify({ imageSrc, headline, subheadline }));
    window.location.href = '/';
  };

  const restart = () => {
    setStep('market');
    setSelectedTalent(null);
    setSearch('');
    setStories([]);
    setSelectedItem(null);
    setHeadline('');
    setSubheadline('');
    setPhotos([]);
    setSelectedPhoto(null);
    setError(null);
  };

  // ---- render ----

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-20 flex items-center gap-4 px-6 py-3 bg-zinc-950 border-b border-zinc-800">
        <a href="/" className="text-zinc-500 hover:text-zinc-200 text-sm transition-colors">← Studio</a>
        <div className="w-px h-4 bg-zinc-800" />
        <h1 className="text-sm font-semibold text-zinc-100">AI Cards</h1>
        <p className="text-xs text-zinc-500 hidden sm:block">Pauv market → AI news → DeepSeek headline → card</p>
        <div className="ml-auto">
          {step !== 'market' && (
            <button onClick={restart} className="text-xs px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors">
              ← Start over
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 max-w-5xl mx-auto w-full px-4 py-6">
        <StepBar step={step} />

        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-950/50 border border-red-800 text-red-300 text-sm whitespace-pre-wrap">
            {error}
          </div>
        )}

        {/* STEP 1: Market picker */}
        {step === 'market' && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
            <h2 className="text-base font-semibold mb-1">Pick a Pauv market</h2>
            <p className="text-xs text-zinc-500 mb-4">Search by name or ticker — AI will fetch news about them.</p>

            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or ticker…"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-green-500 mb-3"
            />

            {talentsLoading && (
              <p className="text-sm text-zinc-500 animate-pulse">Loading markets…</p>
            )}

            <div className="max-h-72 overflow-y-auto flex flex-col gap-1 mb-5">
              {filteredTalents.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTalent(t)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors border ${
                    selectedTalent?.id === t.id
                      ? 'border-green-500 bg-green-500/10'
                      : 'border-transparent hover:bg-zinc-800'
                  }`}
                >
                  {/* Avatar / photo */}
                  {t.photo_url ? (
                    <img src={t.photo_url} alt={t.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs text-zinc-400 shrink-0">
                      {t.name[0]}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-100">{t.name}</span>
                      <span className="text-xs text-zinc-500">${t.ticker}</span>
                      {t.price.frozen && <span className="text-xs text-zinc-600">frozen</span>}
                    </div>
                    <div className="text-xs text-zinc-500 truncate">{t.subcategory ?? t.industry ?? ''}</div>
                  </div>
                  <div className="text-right shrink-0">
                    {t.price.usd != null && (
                      <div className="text-sm font-medium text-zinc-200">${t.price.usd.toFixed(2)}</div>
                    )}
                    {t.price.lifetimeChangePct != null && (
                      <div className={`text-xs ${t.price.lifetimeChangePct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {t.price.lifetimeChangePct >= 0 ? '+' : ''}{t.price.lifetimeChangePct.toFixed(1)}%
                      </div>
                    )}
                  </div>
                </button>
              ))}
              {!talentsLoading && filteredTalents.length === 0 && (
                <p className="text-sm text-zinc-500 px-3">No results for "{search}"</p>
              )}
            </div>

            {selectedTalent && (
              <div className="flex items-center gap-3 pt-4 border-t border-zinc-800">
                <div className="text-sm text-zinc-300">
                  Selected: <span className="text-white font-medium">{selectedTalent.name}</span>
                  <span className="text-zinc-500 ml-2">${selectedTalent.ticker}</span>
                </div>
                <button
                  onClick={runLookup}
                  disabled={lookupLoading}
                  className="ml-auto px-5 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-40 text-sm font-medium text-white transition-colors"
                >
                  {lookupLoading ? 'Fetching news…' : 'Fetch news with AI →'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* STEP 2: AI — news + headline mesh */}
        {step === 'ai' && selectedTalent && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left: stories + headline mesh */}
            <div className="flex flex-col gap-4">
              {/* Selected talent card */}
              <div className="flex items-center gap-3 px-4 py-3 bg-zinc-900 rounded-xl border border-zinc-800">
                {selectedTalent.photo_url ? (
                  <img src={selectedTalent.photo_url} alt={selectedTalent.name} className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-zinc-700 flex items-center justify-center text-sm text-zinc-300">
                    {selectedTalent.name[0]}
                  </div>
                )}
                <div>
                  <div className="text-sm font-semibold text-zinc-100">{selectedTalent.name}</div>
                  <div className="text-xs text-zinc-500">
                    ${selectedTalent.ticker}
                    {selectedTalent.subcategory ?? selectedTalent.industry ? ` · ${selectedTalent.subcategory ?? selectedTalent.industry}` : ''}
                    {selectedTalent.price.usd != null ? ` · $${selectedTalent.price.usd.toFixed(2)}` : ''}
                  </div>
                </div>
              </div>

              {/* Stories */}
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                <h2 className="text-sm font-semibold mb-1">✨ AI News</h2>
                <p className="text-xs text-zinc-500 mb-4">
                  {lookupLoading
                    ? `Fetching news about ${selectedTalent.name}…`
                    : `${stories.length} stories found. Click one — AI re-meshes the headline instantly.`}
                </p>

                {lookupLoading && (
                  <div className="flex flex-col gap-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-14 bg-zinc-800 rounded-lg animate-pulse" />
                    ))}
                  </div>
                )}

                {!lookupLoading && stories.length === 0 && (
                  <p className="text-sm text-zinc-500">No recent news found for {selectedTalent.name}. Try another market.</p>
                )}

                <div className="flex flex-col gap-2">
                  {stories.map((item, idx) => (
                    <button
                      key={`${item.url}-${idx}`}
                      onClick={() => pickStory(item)}
                      className={`text-left p-3 rounded-lg border transition-colors ${
                        selectedItem?.url === item.url
                          ? 'border-green-500 bg-green-500/10'
                          : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-500'
                      }`}
                    >
                      <div className="text-sm font-medium text-zinc-100 leading-snug">{item.caption}</div>
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-zinc-500">📰 {item.sourceName}</span>
                        {item.publishedAt && <span className="text-xs text-zinc-600">· {item.publishedAt}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Headline mesh */}
              {selectedItem && (
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                  <h2 className="text-sm font-semibold mb-1">✨ DeepSeek — Headline</h2>
                  <p className="text-xs text-zinc-500 mb-4">AI reformats into card-ready copy. Edit freely.</p>

                  {meshLoading ? (
                    <p className="text-sm text-zinc-500 animate-pulse">Meshing headline…</p>
                  ) : (
                    <>
                      <label className="block text-xs text-zinc-400 mb-1">Headline</label>
                      <input
                        value={headline}
                        onChange={(e) => setHeadline(e.target.value)}
                        placeholder="AI headline…"
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-green-500 mb-3"
                      />
                      <label className="block text-xs text-zinc-400 mb-1">Subheadline</label>
                      <input
                        value={subheadline}
                        onChange={(e) => setSubheadline(e.target.value)}
                        placeholder="AI subheadline…"
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-green-500"
                      />
                    </>
                  )}

                  <button
                    onClick={() => setStep('photo')}
                    disabled={!headline || meshLoading}
                    className="mt-4 w-full px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors"
                  >
                    Next: Pick photo →
                  </button>
                </div>
              )}
            </div>

            {/* Right: Images */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
              <h2 className="text-sm font-semibold mb-1">Images</h2>
              <p className="text-xs text-zinc-500 mb-4">
                {selectedItem?.source === 'article'
                  ? 'Article images (newsdata + og:image) appear first, then Google Images.'
                  : `Google Images for ${selectedTalent.name}. Pick a story to load article images.`}
              </p>

              {articleImagesLoading && (
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-4 h-4 rounded-full border-2 border-zinc-600 border-t-green-500 animate-spin" />
                  <span className="text-xs text-zinc-500">Scraping article images…</span>
                </div>
              )}

              {photosLoading && (
                <div className="flex flex-wrap gap-3">
                  {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="w-36 h-36 rounded-lg bg-zinc-800 animate-pulse" />)}
                </div>
              )}
              {!photosLoading && !articleImagesLoading && photos.length === 0 && (
                <p className="text-sm text-zinc-500">No images found yet.</p>
              )}
              <div className="flex flex-wrap gap-3">
                {photos.map((p) => (
                  <div
                    key={p.url}
                    onClick={() => setSelectedPhoto(p)}
                    className={`relative cursor-pointer rounded-lg overflow-hidden border-2 transition-colors ${
                      selectedPhoto?.url === p.url ? 'border-green-500' : 'border-transparent hover:border-zinc-500'
                    }`}
                    style={{ width: 140, height: 140 }}
                  >
                    <img
                      src={p.thumbnail}
                      alt={p.title ?? ''}
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    />
                    {p.title?.startsWith('Article') && (
                      <div className="absolute bottom-0 left-0 right-0 text-center text-[10px] bg-black/60 text-zinc-300 px-1 py-0.5">
                        article
                      </div>
                    )}
                  </div>
                ))}
                {findMoreLoading ? (
                  <div className="rounded-lg bg-zinc-800 animate-pulse" style={{ width: 140, height: 140 }} />
                ) : photos.length > 0 ? (
                  <button
                    onClick={findMorePhotos}
                    disabled={photosLoading}
                    className="flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-zinc-500 hover:text-zinc-300"
                    style={{ width: 140, height: 140 }}
                  >
                    <span className="text-2xl leading-none">+</span>
                    <span className="text-xs">More</span>
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: Photo picker */}
        {step === 'photo' && selectedTalent && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
            <h2 className="text-sm font-semibold mb-4">Pick a photo</h2>

            <div className="flex flex-col gap-2 mb-4">
              <div className="flex gap-2">
                <input
                  value={photoQuery}
                  onChange={(e) => setPhotoQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') loadPhotos(photoQuery, 0, true); }}
                  placeholder="Search query…"
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-green-500"
                />
                <button
                  onClick={() => loadPhotos(photoQuery, 0, true)}
                  disabled={!photoQuery.trim() || photosLoading}
                  className="px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-sm text-zinc-200 transition-colors"
                >
                  Search
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={rewritePhotoQuery}
                  disabled={photoQueryRewriting || photosLoading}
                  className="px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 text-xs text-zinc-300 transition-colors"
                >
                  {photoQueryRewriting ? 'Rewriting…' : '✨ Rewrite query (DeepSeek)'}
                </button>
              </div>
            </div>

            {photosLoading && <p className="text-sm text-zinc-500 animate-pulse mb-4">Searching…</p>}
            {!photosLoading && photos.length === 0 && (
              <p className="text-sm text-zinc-500 mb-4">No photos — try a search or Rewrite query.</p>
            )}

            <div className="flex flex-wrap gap-3 mb-5">
              {photos.map((p) => (
                <div
                  key={p.url}
                  onClick={() => setSelectedPhoto(p)}
                  className={`cursor-pointer rounded-lg overflow-hidden border-2 transition-colors ${
                    selectedPhoto?.url === p.url ? 'border-green-500' : 'border-transparent hover:border-zinc-500'
                  }`}
                  style={{ width: 180, height: 180 }}
                >
                  <img
                    src={p.thumbnail}
                    alt={p.title ?? ''}
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              ))}
              {findMoreLoading ? (
                <div className="rounded-lg bg-zinc-800 animate-pulse" style={{ width: 180, height: 180 }} />
              ) : photoQuery ? (
                <button
                  onClick={findMorePhotos}
                  disabled={photosLoading}
                  className="flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-zinc-500 hover:text-zinc-300"
                  style={{ width: 180, height: 180 }}
                >
                  <span className="text-2xl leading-none">+</span>
                  <span className="text-xs">More</span>
                </button>
              ) : null}
            </div>

            {selectedPhoto?.source && (
              <p className="text-xs text-zinc-500 mb-4">📸 <strong>{selectedPhoto.source}</strong> — verify usage rights before publishing.</p>
            )}

            {selectedPhoto && (
              <button
                onClick={buildCard}
                disabled={cachingPhoto}
                className="px-5 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-40 text-sm font-medium text-white transition-colors"
              >
                {cachingPhoto ? 'Downloading photo…' : 'Build card →'}
              </button>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

// ---- StepBar ----

function StepBar({ step }: { step: Step }) {
  const steps: Array<{ key: Step; label: string }> = [
    { key: 'market', label: '1. Market' },
    { key: 'ai', label: '2. AI' },
    { key: 'photo', label: '3. Photo' },
    { key: 'card', label: '4. Build' },
  ];
  const idx = steps.findIndex((s) => s.key === step);
  return (
    <div className="flex gap-2 mb-6">
      {steps.map((s, i) => (
        <div
          key={s.key}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
            i < idx
              ? 'bg-green-500/10 border-green-800 text-green-600'
              : i === idx
              ? 'bg-green-500/15 border-green-500 text-green-400'
              : 'bg-zinc-900 border-zinc-800 text-zinc-600'
          }`}
        >
          {s.label}
        </div>
      ))}
    </div>
  );
}
