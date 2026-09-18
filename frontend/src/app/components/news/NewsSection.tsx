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
// A link can be pasted instead of a story searched for — any article page on
// an approved outlet, read and checked the same way. Its page is for the name
// in the box, or, with the box empty, whoever on Pauv the story names first.
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
//
// With the photos in, the page can be made into the "screen recording" the
// ChatGPT and Trade sections make (news-video.ts): Google with the story as
// the third result, the click, the page loading with its pictures arriving
// late, the name dragged and zoomed in on. Preview plays it here with its
// sound; Save renders the MP4 and downloads it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { OUTLETS, outletById } from '@/lib/news/outlets';
// Searching, reading a story, finding its photos and drawing its page are
// lib/news/client — shared with the Vids 2 form, which does the same from
// its news intro.
import {
  ago, drawNewsPage, errorText, findPagePhotos, hitFromStory, NEWS_RANGE_LABEL, pastedLinkProblem, readNewsStory,
  searchedForms, searchNews, type NewsRange,
} from '@/lib/news/client';
import { NO_PHOTOS, type PagePhotos } from '@/lib/news/templates';
import type { NewsArticle, NewsHit, NewsPhoto, OutletId, PersonPhoto, RailItem } from '@/lib/news/types';
import { ClipPlayer, type ClipPlayerHandle } from '../ClipPlayer';
import {
  buildNewsAudio, CLIP_SECONDS, createNewsClip, FILE_H, FILE_W, loadNewsAssets, renderNewsVideo,
  type NewsAssets, type NewsBeats, type NewsClip, type NewsClipSource,
} from './news-video';

type Range = NewsRange;
const RANGE_LABEL = NEWS_RANGE_LABEL;

// v2 moved the defaults to the past week with the name in the title (the
// Vids 2 form's too). A v1 setup keeps its name and outlets and takes the new
// defaults once; it is written back under v2 on the first change.
const SETUP_KEY = 'studio-news-setup-v2';
const OLD_SETUP_KEY = 'studio-news-setup-v1';
interface Setup { query: string; outlets: OutletId[]; range: Range; nameInTitle: boolean }
function loadSetup(): Setup {
  const fallback: Setup = { query: '', outlets: OUTLETS.map(o => o.id), range: '7d', nameInTitle: true };
  if (typeof window === 'undefined') return fallback;
  try {
    const saved = localStorage.getItem(SETUP_KEY);
    const j = JSON.parse(saved ?? localStorage.getItem(OLD_SETUP_KEY) ?? 'null') as Partial<Setup> | null;
    if (!j) return fallback;
    const outlets = Array.isArray(j.outlets) ? j.outlets.filter(id => OUTLETS.some(o => o.id === id)) : [];
    return {
      query: typeof j.query === 'string' ? j.query : '',
      outlets: outlets.length ? outlets : fallback.outlets,
      range: saved && j.range && j.range in RANGE_LABEL ? j.range : fallback.range,
      nameInTitle: saved ? j.nameInTitle === true : fallback.nameInTitle,
    };
  } catch {
    return fallback;
  }
}
function saveSetup(s: Setup) {
  try { localStorage.setItem(SETUP_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function fullTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'article';
}

// Hand a rendered recording to the browser's downloads.
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const BEAT_LABEL: Record<keyof NewsBeats, string> = { searching: 'google', loading: 'loading', choosing: 'name' };

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
  /** The photos the page on screen was drawn with — what the recording gets. */
  pagePhotos: PagePhotos;
}

/** Draws the page with people[from] (or the next one that loads) as its main
 *  photo. Returns the PNG, which photo it used, and the photos it was drawn
 *  with. */
const drawPage = (l: Loaded, from: number) =>
  drawNewsPage({ article: l.article, rail: l.rail, people: l.people, thumbSrcs: l.thumbSrcs }, from);

export function NewsSection({ active = true }: { active?: boolean }) {
  const [query, setQuery] = useState(() => loadSetup().query);
  const [outlets, setOutlets] = useState<OutletId[]>(() => loadSetup().outlets);
  const [range, setRange] = useState<Range>(() => loadSetup().range);
  const [nameInTitle, setNameInTitle] = useState(() => loadSetup().nameInTitle);
  useEffect(() => { saveSetup({ query, outlets, range, nameInTitle }); }, [query, outlets, range, nameInTitle]);

  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hits, setHits] = useState<NewsHit[] | null>(null);
  const [searched, setSearched] = useState('');
  /** The name and the short forms it was searched by — "Vladimir Putin,
   *  Putin" — or empty when there were none beyond the name. */
  const [searchedAs, setSearchedAs] = useState('');
  const searchCtrl = useRef<AbortController | null>(null);

  const [picked, setPicked] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [image, setImage] = useState<{ url: string; width: number; height: number; blob: Blob } | null>(null);
  const pickCtrl = useRef<AbortController | null>(null);

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
      const found = await searchNews(q, outlets, range, ctrl.signal);
      setHits(found.hits);
      setSearched(q);
      setSearchedAs(searchedForms(q, found.forms));
    } catch (err) {
      if (!ctrl.signal.aborted) setSearchError(errorText(err));
    } finally {
      if (searchCtrl.current === ctrl) setSearching(false);
    }
  }, [query, outlets, range]);

  /** Show a story's page with placeholders; no photo searching yet. */
  const pick = useCallback(async (hit: NewsHit) => {
    pickCtrl.current?.abort();
    const ctrl = new AbortController();
    pickCtrl.current = ctrl;
    setPicked(hit.url);
    setPickError(null);
    setStatus(`Reading the story from ${outletById(hit.outlet).name}…`);
    try {
      const { article, rail } = await readNewsStory(hit.url, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setStatus('Drawing the page…');
      const next: Loaded = { hit, name: searched, article, rail, withPhotos: false, people: [], photoIndex: -1, thumbs: [], thumbSrcs: [], photoNotes: [], pagePhotos: NO_PHOTOS };
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

  // A link pasted in instead of a story searched for: any article page on an
  // approved outlet, read and checked the way a result is. The page is for
  // the name in the box; with the box empty it is for whoever on Pauv the
  // story names first, and the box is filled in with them.
  const [link, setLink] = useState('');
  const linkUrl = link.trim();
  const linkProblem = linkUrl ? pastedLinkProblem(linkUrl) : null;

  const readLink = useCallback(async () => {
    const url = link.trim();
    if (!url || pastedLinkProblem(url)) return;
    pickCtrl.current?.abort();
    const ctrl = new AbortController();
    pickCtrl.current = ctrl;
    setPicked(url);
    setPickError(null);
    setStatus('Reading the story from the outlet…');
    try {
      const { article, rail, people = [] } = await readNewsStory(url, ctrl.signal);
      if (ctrl.signal.aborted) return;
      const typed = query.trim();
      const name = typed || people[0]?.name || '';
      if (!typed && name) setQuery(name);
      setStatus('Drawing the page…');
      const next: Loaded = {
        hit: hitFromStory(article, people, name), name, article, rail,
        withPhotos: false, people: [], photoIndex: -1, thumbs: [], thumbSrcs: [], photoNotes: [], pagePhotos: NO_PHOTOS,
      };
      const { png } = await drawPage(next, 0);
      if (ctrl.signal.aborted) return;
      setPicked(article.url);
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
  }, [link, query]);

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
      const { people, thumbs, thumbSrcs, notes: photoNotes } = await findPagePhotos(base.article, base.rail, base.name, ctrl.signal);
      if (ctrl.signal.aborted) return;

      setStatus('Drawing the page…');
      const next: Loaded = { ...base, withPhotos: true, people, photoIndex: -1, thumbs, thumbSrcs, photoNotes };
      const { png, photoIndex, photos } = await drawPage(next, 0);
      if (ctrl.signal.aborted) return;
      if (people.length > 0 && photoIndex < 0) photoNotes.push("None of the photos found would load, so the page keeps a placeholder.");
      setLoaded({ ...next, photoIndex, pagePhotos: photos });
      setImage({ url: URL.createObjectURL(png.blob), width: png.width, height: png.height, blob: png.blob });
      setStatus(null);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setStatus(null);
      setPickError(errorText(err));
    }
  }, [loaded]);

  /** Redraw the page with the next photo of the person. */
  const nextPhoto = useCallback(async () => {
    if (!loaded || loaded.people.length < 2) return;
    pickCtrl.current?.abort();
    const ctrl = new AbortController();
    pickCtrl.current = ctrl;
    setPickError(null);
    setStatus('Drawing the page with another photo…');
    try {
      const { png, photoIndex, photos } = await drawPage(loaded, (loaded.photoIndex + 1) % loaded.people.length);
      if (ctrl.signal.aborted) return;
      setLoaded({ ...loaded, photoIndex, pagePhotos: photos });
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

  // ── The video ─────────────────────────────────────────────────────────────
  // Once the page has its photos: Preview builds the recording and plays it
  // here; Save renders the MP4 and downloads it. What both are made from (the
  // Google page with the story in it, the outlet's page painted and measured)
  // is made once per page and kept for the next preview or save.
  const playerRef = useRef<ClipPlayerHandle>(null);
  const clipCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoAssets = useRef<{ key: string; assets: NewsAssets } | null>(null);
  const [clip, setClip] = useState<NewsClip | null>(null);
  const [clipAudio, setClipAudio] = useState<Promise<AudioBuffer | null> | null>(null);
  const [playToken, setPlayToken] = useState(0);
  const [videoBusy, setVideoBusy] = useState<{ label: string; pct: number | null } | null>(null);
  const [videoNote, setVideoNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [assetNote, setAssetNote] = useState<string | null>(null);
  const videoCtrl = useRef<AbortController | null>(null);

  // A different page — another story, another photo — is a different clip.
  useEffect(() => { setClip(null); setClipAudio(null); setVideoNote(null); setAssetNote(null); }, [loaded]);

  const clipSource = (l: Loaded): NewsClipSource => ({
    name: l.name, namedAs: l.hit.namedAs, article: l.article, rail: l.rail, photos: l.pagePhotos,
  });
  const clipKey = (l: Loaded) => `${l.article.url}|${l.name}|${l.pagePhotos.hero?.src.length ?? 0}|${l.pagePhotos.thumbs.map(t => t?.length ?? 0).join(',')}`;

  async function assetsFor(l: Loaded, signal: AbortSignal): Promise<NewsAssets> {
    const key = clipKey(l);
    const have = videoAssets.current;
    if (have && have.key === key) return have.assets;
    setVideoBusy({ label: 'Laying out the pages…', pct: null });
    const a = await loadNewsAssets(clipSource(l), signal);
    videoAssets.current = { key, assets: a };
    setAssetNote(a.note);
    return a;
  }

  function cancelVideo() {
    videoCtrl.current?.abort();
    videoCtrl.current = null;
    setVideoBusy(null);
  }

  async function previewVideo() {
    if (!loaded?.withPhotos) return;
    cancelVideo();
    playerRef.current?.stop();
    const ctrl = new AbortController();
    videoCtrl.current = ctrl;
    setVideoNote(null);
    try {
      const a = await assetsFor(loaded, ctrl.signal);
      if (ctrl.signal.aborted) return;
      const ctx = clipCanvasRef.current?.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('The preview canvas is not on screen.');
      const c = createNewsClip(ctx, a);
      setClip(c);
      setClipAudio(Promise.resolve().then(() => buildNewsAudio(c, a.source.article.url)).catch(err => {
        console.error('[news] preview sound skipped:', err);
        return null;
      }));
      setPlayToken(n => n + 1);
    } catch (err) {
      if (!ctrl.signal.aborted) setVideoNote({ ok: false, text: errorText(err) });
    } finally {
      if (videoCtrl.current === ctrl) { videoCtrl.current = null; setVideoBusy(null); }
    }
  }

  async function saveVideo() {
    if (!loaded?.withPhotos) return;
    cancelVideo();
    playerRef.current?.stop();
    const ctrl = new AbortController();
    videoCtrl.current = ctrl;
    setVideoNote(null);
    try {
      const a = await assetsFor(loaded, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setVideoBusy({ label: 'Rendering…', pct: 0 });
      const { blob, filename, seconds } = await renderNewsVideo(a, {
        signal: ctrl.signal,
        onProgress: (done, total) => setVideoBusy({ label: `Rendering ${Math.round((done / total) * 100)}%`, pct: done / total }),
      });
      downloadBlob(blob, filename);
      setVideoNote({ ok: true, text: `Saved ${filename} (${seconds.toFixed(1)}s)` });
    } catch (err) {
      if (!ctrl.signal.aborted) setVideoNote({ ok: false, text: errorText(err) });
    } finally {
      if (videoCtrl.current === ctrl) { videoCtrl.current = null; setVideoBusy(null); }
    }
  }

  useEffect(() => () => { videoCtrl.current?.abort(); }, []);

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

          <div className="flex flex-col gap-2">
            <span className="text-sm uppercase tracking-wide text-zinc-500">Or paste an article link</span>
            <div className="flex gap-3">
              <input
                value={link}
                onChange={e => setLink(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && linkUrl && !linkProblem) void readLink(); }}
                placeholder="https://… from an approved outlet"
                spellCheck={false}
                autoComplete="off"
                className="h-12 min-w-0 flex-1 rounded-xl bg-black border border-zinc-800 px-4 text-white outline-none focus:border-zinc-500"
              />
              <button
                type="button"
                onClick={() => void readLink()}
                disabled={!linkUrl || !!linkProblem || !!status}
                className="h-12 shrink-0 rounded-xl border border-zinc-600 px-4 font-semibold text-zinc-100 hover:border-zinc-400 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Use link
              </button>
            </div>
            {linkProblem
              ? <p className="text-sm text-amber-300/90">{linkProblem}</p>
              : <p className="text-xs text-zinc-600">The page is made for the name above; leave it empty and it is whoever on Pauv the story names.</p>}
          </div>

          {hits && shown && (
            <div className="flex flex-col gap-2">
              <span className="text-sm text-zinc-500">
                {hits.length === 0
                  ? 'No stories from these outlets. Try a wider time range.'
                  : shown.length === 0
                    ? `None of the ${hits.length} headlines have “${searched}”${searchedAs ? ' or a short form of it' : ''} in them. Turn off “Name has to be in title” to see them.`
                    : `${shown.length} ${shown.length === 1 ? 'story' : 'stories'}${shown.length < hits.length ? ` · ${hits.length - shown.length} more without the name in the title` : ''}`}
              </span>
              {searchedAs && <span className="-mt-1 text-xs text-zinc-600">Searched as {searchedAs}</span>}
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

              {/* ── Video ───────────────────────────────────────────────────── */}
              {loaded?.withPhotos && (
                <div className="max-w-[1000px] rounded-xl border border-zinc-800 bg-[#111] p-4 text-sm flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs uppercase tracking-wide text-zinc-500">Video</span>
                    <span className="text-zinc-500">
                      Google, this story clicked, the page loading, {loaded.name ? `“${loaded.name}”` : 'the name'} highlighted.
                      About {CLIP_SECONDS}s at {FILE_W}×{FILE_H}.
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      {videoBusy && (
                        <button type="button" onClick={cancelVideo} className="px-2 text-xs text-zinc-400 hover:text-white">Cancel</button>
                      )}
                      <button
                        type="button"
                        onClick={videoBusy ? undefined : () => void previewVideo()}
                        disabled={!!videoBusy || !!status}
                        className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:border-zinc-500 disabled:opacity-40"
                      >
                        Preview
                      </button>
                      <button
                        type="button"
                        onClick={videoBusy ? undefined : () => void saveVideo()}
                        disabled={!!videoBusy || !!status}
                        className="relative overflow-hidden rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-zinc-200 disabled:opacity-40 disabled:hover:bg-white"
                      >
                        {videoBusy?.pct != null && (
                          <span className="absolute inset-y-0 left-0 bg-zinc-400/70" style={{ width: `${Math.round(videoBusy.pct * 100)}%` }} />
                        )}
                        <span className="relative">{videoBusy ? videoBusy.label : 'Save video'}</span>
                      </button>
                    </div>
                  </div>
                  <ClipPlayer
                    ref={playerRef}
                    canvasRef={clipCanvasRef}
                    width={FILE_W}
                    height={FILE_H}
                    clip={clip}
                    audio={clipAudio}
                    beatLabels={BEAT_LABEL}
                    active={active}
                    placeholder={videoBusy ? videoBusy.label : 'Preview builds the recording here.'}
                    autoplay={playToken}
                  />
                  {assetNote && <p className="text-amber-300/90">{assetNote}</p>}
                  {videoNote && (
                    <p className={`leading-relaxed ${videoNote.ok ? 'text-emerald-300' : 'text-red-300'}`}>{videoNote.text}</p>
                  )}
                </div>
              )}

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
