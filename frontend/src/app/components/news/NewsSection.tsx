'use client';

// News (Studio > News): real articles, redrawn as the outlet's page.
//
// Type a name; Google News lists stories about it from the approved outlets
// only (ESPN, CNN, Fox News, The New York Times with The Athletic, TMZ, BBC),
// article pages only, and "Name has to be in title" narrows that to headlines
// with the name in them. Pick one and the
// server reads the story from the outlet itself (see lib/news/read-article.ts):
// the headline as printed, the byline, the publish time and the article
// paragraphs, word for word. Nothing is written or guessed; a story missing
// any of those is refused. The page is then laid out from lib/news/templates
// and drawn to a PNG right here in the browser (lib/news/rasterize.ts), shown
// in a box you can scroll.
//
// Clicking a story shows its page straight away with grey placeholders, so
// stories can be flicked through quickly. "Use this one" (bottom right) is what
// fetches the photos and redraws that page with them.
//
// Photos are free ones from Wikimedia Commons, never the outlet's own (those
// are licensed to the outlet). The main photo is of the person searched, picked
// and face-centred by the AI (lib/news/free-photos.ts, lib/news/frame-photo.ts);
// side-column thumbnails are about half Pauv profile photos, half stock scenes.
// Credits print under the main photo and are all listed beside the page.

import { useCallback, useEffect, useRef, useState } from 'react';
import { OUTLETS, outletById } from '@/lib/news/outlets';
import { framePersonPhoto, frameThumb, photoCredit } from '@/lib/news/frame-photo';
import { rasterizeNewsPage } from '@/lib/news/rasterize';
import { PHOTO_SLOTS, renderNewsPage, type PagePhotos } from '@/lib/news/templates';
import type {
  NewsArticle, NewsHit, NewsPhoto, OutletId, PersonPhoto, PersonPhotosResponse, RailItem, ThumbPhotosResponse,
} from '@/lib/news/types';

type Range = '1d' | '7d' | '30d' | 'any';
const RANGE_LABEL: Record<Range, string> = { '1d': 'Past day', '7d': 'Past week', '30d': 'Past month', any: 'Any time' };

const SETUP_KEY = 'studio-news-setup-v1';
interface Setup { query: string; outlets: OutletId[]; range: Range; nameInTitle: boolean }
function loadSetup(): Setup {
  const fallback: Setup = { query: '', outlets: OUTLETS.map(o => o.id), range: '30d', nameInTitle: false };
  if (typeof window === 'undefined') return fallback;
  try {
    const j = JSON.parse(localStorage.getItem(SETUP_KEY) ?? 'null') as Partial<Setup> | null;
    if (!j) return fallback;
    const outlets = Array.isArray(j.outlets) ? j.outlets.filter(id => OUTLETS.some(o => o.id === id)) : [];
    return {
      query: typeof j.query === 'string' ? j.query : '',
      outlets: outlets.length ? outlets : fallback.outlets,
      range: j.range && j.range in RANGE_LABEL ? j.range : '30d',
      nameInTitle: j.nameInTitle === true,
    };
  } catch {
    return fallback;
  }
}
function saveSetup(s: Setup) {
  try { localStorage.setItem(SETUP_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function ago(iso: string | null): string {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fullTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'article';
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error ?? `${url} answered ${res.status}`);
  return j as T;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface Loaded {
  hit: NewsHit;
  /** The name that was searched: whose photo the page gets. */
  name: string;
  article: NewsArticle;
  rail: RailItem[];
  /** False until "Use this one"; the page shows placeholders until then. */
  withPhotos: boolean;
  /** Free photos of the person searched, best first. */
  people: PersonPhoto[];
  /** Which of `people` the page shows, or -1 for none. */
  photoIndex: number;
  /** Side-column thumbnails in headline order, and the framed images drawn from them. */
  thumbs: (NewsPhoto | null)[];
  thumbSrcs: (string | null)[];
  photoNotes: string[];
}

/** Draws the page with people[from] (or the next one that loads) as its main
 *  photo. Returns the PNG and which photo it used. */
async function drawPage(l: Loaded, from: number): Promise<{ png: Awaited<ReturnType<typeof rasterizeNewsPage>>; photoIndex: number }> {
  const slots = PHOTO_SLOTS[l.article.outlet];
  let hero: PagePhotos['hero'] = null;
  let photoIndex = -1;
  for (let k = 0; k < l.people.length && !hero; k++) {
    const i = (from + k) % l.people.length;
    try {
      hero = { src: await framePersonPhoto(l.people[i], slots.hero), credit: photoCredit(l.people[i]) };
      photoIndex = i;
    } catch { /* that file wouldn't load; try the next */ }
  }
  const png = await rasterizeNewsPage(renderNewsPage(l.article, l.rail, { hero, thumbs: l.thumbSrcs }));
  return { png, photoIndex };
}

export function NewsSection() {
  const [query, setQuery] = useState(() => loadSetup().query);
  const [outlets, setOutlets] = useState<OutletId[]>(() => loadSetup().outlets);
  const [range, setRange] = useState<Range>(() => loadSetup().range);
  const [nameInTitle, setNameInTitle] = useState(() => loadSetup().nameInTitle);
  useEffect(() => { saveSetup({ query, outlets, range, nameInTitle }); }, [query, outlets, range, nameInTitle]);

  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hits, setHits] = useState<NewsHit[] | null>(null);
  const [searched, setSearched] = useState('');
  const searchCtrl = useRef<AbortController | null>(null);

  const [picked, setPicked] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [image, setImage] = useState<{ url: string; width: number; height: number; blob: Blob } | null>(null);
  const pickCtrl = useRef<AbortController | null>(null);
  // Photos of a name are the same whichever story is picked; ask once.
  const peopleCache = useRef(new Map<string, Promise<PersonPhotosResponse>>());

  // Let go of the old PNG when a new one replaces it.
  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url); }, [image]);

  const search = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2 || outlets.length === 0) return;
    searchCtrl.current?.abort();
    const ctrl = new AbortController();
    searchCtrl.current = ctrl;
    setSearching(true);
    setSearchError(null);
    try {
      const params = new URLSearchParams({ q, outlets: outlets.join(','), range });
      const res = await fetch(`/api/news/search?${params}`, { signal: ctrl.signal });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `Search failed (${res.status})`);
      setHits(j.hits as NewsHit[]);
      setSearched(q);
    } catch (err) {
      if (!ctrl.signal.aborted) setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      if (searchCtrl.current === ctrl) setSearching(false);
    }
  }, [query, outlets, range]);

  const peopleFor = useCallback((name: string) => {
    const key = name.trim().toLowerCase();
    let p = peopleCache.current.get(key);
    if (!p) {
      p = postJson<PersonPhotosResponse>('/api/news/photos/person', { name });
      peopleCache.current.set(key, p);
      p.then(r => { if (!r.ai || r.photos.length === 0) peopleCache.current.delete(key); }, () => peopleCache.current.delete(key));
    }
    return p;
  }, []);

  /** Show a story's page with placeholders; no photo searching yet. */
  const pick = useCallback(async (hit: NewsHit) => {
    pickCtrl.current?.abort();
    const ctrl = new AbortController();
    pickCtrl.current = ctrl;
    setPicked(hit.url);
    setPickError(null);
    setStatus(`Reading the story from ${outletById(hit.outlet).name}…`);
    try {
      const { article, rail } = await postJson<{ article: NewsArticle; rail: RailItem[] }>('/api/news/article', { link: hit.url }, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setStatus('Drawing the page…');
      const next: Loaded = { hit, name: searched, article, rail, withPhotos: false, people: [], photoIndex: -1, thumbs: [], thumbSrcs: [], photoNotes: [] };
      const { png } = await drawPage(next, 0);
      if (ctrl.signal.aborted) return;
      setLoaded(next);
      setImage({ url: URL.createObjectURL(png.blob), width: png.width, height: png.height, blob: png.blob });
      setStatus(null);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setStatus(null);
      setLoaded(null);
      setImage(null);
      setPickError(errorText(err));
    }
  }, [searched]);

  /** "Use this one": find photos for the story on screen and redraw it with them. */
  const addPhotos = useCallback(async () => {
    if (!loaded || loaded.withPhotos) return;
    const base = loaded;
    pickCtrl.current?.abort();
    const ctrl = new AbortController();
    pickCtrl.current = ctrl;
    setPickError(null);
    setStatus(`Finding photos${base.name ? ` of ${base.name}` : ''}…`);
    try {
      const slots = PHOTO_SLOTS[base.article.outlet];
      const headlines = base.rail.slice(0, slots.thumbs.length).map(r => r.title);
      const photoNotes: string[] = [];
      const [people, thumbs] = await Promise.all([
        base.name
          ? peopleFor(base.name).then(r => { if (r.note) photoNotes.push(r.note); return r.photos; },
            err => { photoNotes.push(`Couldn't find a photo: ${errorText(err)}`); return [] as PersonPhoto[]; })
          : Promise.resolve([] as PersonPhoto[]),
        headlines.length
          ? postJson<ThumbPhotosResponse>('/api/news/photos/thumbs', { outlet: base.article.outlet, headlines, name: base.name }, ctrl.signal)
            .then(r => { if (!r.ai) photoNotes.push("The AI couldn't check the thumbnails, so a stranger's face could be in one; look before using the page."); return r.photos; },
              err => { photoNotes.push(`Couldn't find thumbnails: ${errorText(err)}`); return [] as (NewsPhoto | null)[]; })
          : Promise.resolve([] as (NewsPhoto | null)[]),
      ]);
      if (ctrl.signal.aborted) return;
      const thumbSrcs = await Promise.all(slots.thumbs.map((size, i) => (thumbs[i] ? frameThumb(thumbs[i]!, size).catch(() => null) : null)));
      if (ctrl.signal.aborted) return;

      setStatus('Drawing the page…');
      const next: Loaded = { ...base, withPhotos: true, people, photoIndex: -1, thumbs, thumbSrcs, photoNotes };
      const { png, photoIndex } = await drawPage(next, 0);
      if (ctrl.signal.aborted) return;
      if (people.length > 0 && photoIndex < 0) photoNotes.push("None of the photos found would load, so the page keeps a placeholder.");
      setLoaded({ ...next, photoIndex, thumbs: thumbs.map((t, i) => (thumbSrcs[i] ? t : null)) });
      setImage({ url: URL.createObjectURL(png.blob), width: png.width, height: png.height, blob: png.blob });
      setStatus(null);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setStatus(null);
      setPickError(errorText(err));
    }
  }, [loaded, peopleFor]);

  /** Redraw the page with the next photo of the person. */
  const nextPhoto = useCallback(async () => {
    if (!loaded || loaded.people.length < 2) return;
    pickCtrl.current?.abort();
    const ctrl = new AbortController();
    pickCtrl.current = ctrl;
    setPickError(null);
    setStatus('Drawing the page with another photo…');
    try {
      const { png, photoIndex } = await drawPage(loaded, (loaded.photoIndex + 1) % loaded.people.length);
      if (ctrl.signal.aborted) return;
      setLoaded({ ...loaded, photoIndex });
      setImage({ url: URL.createObjectURL(png.blob), width: png.width, height: png.height, blob: png.blob });
      setStatus(null);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setStatus(null);
      setPickError(errorText(err));
    }
  }, [loaded]);

  function toggleOutlet(id: OutletId) {
    setOutlets(cur => (cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]));
  }

  function download() {
    if (!image || !loaded) return;
    const a = document.createElement('a');
    a.href = image.url;
    a.download = `${loaded.article.outlet}-${slug(loaded.article.headline)}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const article = loaded?.article ?? null;
  const photo = loaded && loaded.photoIndex >= 0 ? loaded.people[loaded.photoIndex] : null;
  const thumbCredits = (loaded?.thumbs ?? []).filter((t): t is NewsPhoto => t !== null);
  const shown = hits && nameInTitle ? hits.filter(h => h.named) : hits;

  return (
    <div className="relative min-h-screen bg-black text-white">
      <div className="flex flex-col gap-6 p-4 sm:p-8 xl:flex-row xl:items-start">
        {/* ── Search card ─────────────────────────────────────────────────── */}
        <div className="w-full shrink-0 rounded-2xl border border-zinc-800 bg-[#111] p-6 sm:p-8 flex flex-col gap-5 xl:w-[440px]">
          <div>
            <h1 className="text-3xl font-semibold text-white">News</h1>
            <p className="text-base text-zinc-500 mt-2">
              Search a name, pick a real story from an approved outlet, and get it back as that outlet&apos;s page.
            </p>
          </div>
          <label className="flex flex-col gap-2">
            <span className="text-sm uppercase tracking-wide text-zinc-500">Name</span>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void search(); }}
              placeholder="e.g. Macklemore"
              className="h-14 rounded-xl bg-black border border-zinc-800 px-4 text-white text-xl outline-none focus:border-zinc-500"
            />
          </label>
          <div className="flex flex-col gap-2">
            <span className="text-sm uppercase tracking-wide text-zinc-500">Outlets</span>
            <div className="flex flex-wrap gap-2">
              {OUTLETS.map(o => {
                const on = outlets.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => toggleOutlet(o.id)}
                    className={`h-9 rounded-lg border px-3 text-sm font-semibold transition-colors ${
                      on ? 'bg-white/10 border-zinc-400 text-white' : 'bg-black border-zinc-800 text-zinc-600 hover:text-zinc-300'
                    }`}
                  >
                    {o.name}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={nameInTitle}
            onClick={() => setNameInTitle(v => !v)}
            className="flex items-center gap-3 text-left"
          >
            <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${nameInTitle ? 'bg-white' : 'bg-zinc-800'}`}>
              <span className={`absolute top-1 h-4 w-4 rounded-full transition-all ${nameInTitle ? 'left-6 bg-black' : 'left-1 bg-zinc-500'}`} />
            </span>
            <span className="text-base text-zinc-300">Name has to be in title</span>
          </button>
          <div className="flex gap-3">
            <select
              value={range}
              onChange={e => setRange(e.target.value as Range)}
              className="h-14 flex-1 rounded-xl bg-black border border-zinc-800 px-3 text-white outline-none focus:border-zinc-500"
            >
              {(Object.keys(RANGE_LABEL) as Range[]).map(r => <option key={r} value={r}>{RANGE_LABEL[r]}</option>)}
            </select>
            <button
              type="button"
              onClick={() => void search()}
              disabled={searching || query.trim().length < 2 || outlets.length === 0}
              className="h-14 flex-1 rounded-xl bg-white text-black font-semibold text-lg hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
            >
              {searching ? 'Searching…' : 'Search'}
            </button>
          </div>
          {searchError && <p className="text-sm text-red-300">{searchError}</p>}

          {hits && shown && (
            <div className="flex flex-col gap-2">
              <span className="text-sm text-zinc-500">
                {hits.length === 0
                  ? 'No stories from these outlets. Try a wider time range.'
                  : shown.length === 0
                    ? `None of the ${hits.length} headlines have “${searched}” in them. Turn off “Name has to be in title” to see them.`
                    : `${shown.length} ${shown.length === 1 ? 'story' : 'stories'}${shown.length < hits.length ? ` · ${hits.length - shown.length} more without the name in the title` : ''}`}
              </span>
              <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
                {shown.map(h => {
                  const o = outletById(h.outlet);
                  const on = picked === h.url;
                  return (
                    <button
                      key={h.url}
                      type="button"
                      onClick={() => void pick(h)}
                      className={`rounded-xl border p-3 text-left transition-colors ${
                        on ? 'border-zinc-400 bg-white/10' : 'border-zinc-800 bg-black hover:border-zinc-600'
                      }`}
                    >
                      <div className="flex items-center gap-2 text-xs">
                        <span className="rounded px-1.5 py-0.5 font-bold text-white" style={{ background: o.color }}>{o.name}</span>
                        {h.url.includes('nytimes.com/athletic/') && <span className="font-semibold text-zinc-400">The Athletic</span>}
                        <span className="text-zinc-500">{ago(h.publishedAt)}</span>
                      </div>
                      <div className="mt-1.5 text-[15px] leading-snug text-zinc-100">{h.title}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Page ────────────────────────────────────────────────────────── */}
        <div className="min-w-0 flex-1 flex flex-col gap-4">
          {pickError && (
            <div className="max-w-[1000px] rounded-xl border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-200">{pickError}</div>
          )}
          {status && (
            <div className="max-w-[1000px] rounded-xl border border-zinc-800 bg-[#111] p-4 text-sm text-zinc-300">{status}</div>
          )}
          {!article && !status && !pickError && (
            <div className="flex h-64 max-w-[1000px] items-center justify-center rounded-xl border border-zinc-800 text-sm text-zinc-600">
              Pick a story to build its page here.
            </div>
          )}

          {article && image && (
            <>
              <div className="max-w-[1000px] rounded-xl border border-zinc-800 bg-[#111] p-4 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs uppercase tracking-wide text-zinc-500">Read from {outletById(article.outlet).name}</span>
                  <div className="ml-auto flex gap-2">
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:border-zinc-500"
                    >
                      Open original
                    </a>
                    <button
                      type="button"
                      onClick={download}
                      className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-zinc-200"
                    >
                      Download PNG
                    </button>
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5">
                  <dt className="text-zinc-500">Headline</dt><dd className="text-zinc-100">{article.headline}</dd>
                  <dt className="text-zinc-500">Byline</dt><dd className="text-zinc-100">{article.byline}</dd>
                  <dt className="text-zinc-500">Published</dt>
                  <dd className="text-zinc-100">
                    {article.publishedAt ? fullTime(article.publishedAt) : article.publishedDate ?? ''}
                    {article.updatedAt && article.publishedAt && Date.parse(article.updatedAt) - Date.parse(article.publishedAt) > 60_000 && (
                      <span className="text-zinc-500"> · updated {fullTime(article.updatedAt)}</span>
                    )}
                  </dd>
                  {article.section && (<><dt className="text-zinc-500">Section</dt><dd className="text-zinc-100">{article.section}</dd></>)}
                  <dt className="text-zinc-500">Paragraphs</dt><dd className="text-zinc-100">{article.paragraphs.length} from the article</dd>
                  <dt className="text-zinc-500">Link</dt><dd className="truncate text-zinc-400">{article.url}</dd>
                  <dt className="text-zinc-500">Photo</dt>
                  <dd className="flex flex-wrap items-center gap-x-3 gap-y-1 text-zinc-100">
                    {photo ? (
                      <a href={photo.page} target="_blank" rel="noreferrer" className="hover:underline">
                        {photo.creator || 'Unknown author'} · {photo.license}
                      </a>
                    ) : (
                      <span className="text-zinc-500">{loaded?.withPhotos ? 'Placeholder' : 'Placeholder until you press “Use this one”'}</span>
                    )}
                    {loaded && loaded.people.length > 1 && (
                      <button
                        type="button"
                        onClick={() => void nextPhoto()}
                        disabled={!!status}
                        className="rounded-md border border-zinc-700 px-2 py-0.5 text-xs font-semibold text-zinc-200 hover:border-zinc-500 disabled:opacity-40"
                      >
                        Another photo ({loaded.photoIndex + 1}/{loaded.people.length})
                      </button>
                    )}
                  </dd>
                  {thumbCredits.length > 0 && (
                    <>
                      <dt className="text-zinc-500">Thumbnails</dt>
                      <dd className="flex flex-col gap-0.5 text-zinc-400">
                        {thumbCredits.map(t => (
                          <a key={t.url} href={t.page} target="_blank" rel="noreferrer" className="truncate hover:underline">
                            {t.source === 'pauv' ? `Pauv profile photo · ${t.title}` : `${t.creator || 'Unknown author'} · ${t.license} · ${t.title}`}
                          </a>
                        ))}
                      </dd>
                    </>
                  )}
                </dl>
                {article.notes.length + (loaded?.photoNotes.length ?? 0) > 0 && (
                  <ul className="mt-3 flex flex-col gap-1 text-amber-300/90">
                    {[...article.notes, ...(loaded?.photoNotes ?? [])].map(n => <li key={n}>{n}</li>)}
                  </ul>
                )}
              </div>
              <div className="max-w-[1000px] overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900" style={{ maxHeight: 'calc(100vh - 120px)' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt={article.headline} className="block w-full" width={image.width} height={image.height} />
              </div>
              <span className="text-xs text-zinc-600">
                {image.width}×{image.height} PNG · {loaded?.withPhotos ? 'photos from Wikimedia Commons' : 'placeholders until you press “Use this one”'}
              </span>
              {loaded && !loaded.withPhotos && (
                <button
                  type="button"
                  onClick={() => void addPhotos()}
                  disabled={!!status}
                  className="fixed bottom-6 right-6 z-30 h-14 rounded-xl bg-white px-7 text-lg font-semibold text-black shadow-lg shadow-black/50 hover:bg-zinc-200 disabled:opacity-40 disabled:hover:bg-white"
                >
                  {status ? 'Working…' : 'Use this one'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
