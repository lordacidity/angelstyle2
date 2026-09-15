'use client';

// Pricer photos — the panel down the left of the Pricer: a free-to-use photo of the person being priced.
//
// When a pricing starts the panel searches Wikimedia Commons and Openverse (Flickr and friends, commercial-use
// licences only) for the name — /api/pricer/photos — and shows the results as square tiles, each with its licence.
// Pick one and it is cropped to a square: drag to move, the slider or the wheel to zoom. Download renders that
// crop to a JPEG named after the person ("Tate McRae.jpg"). The query can be edited and searched again without
// pricing again.
//
// The full image is loaded through /api/charts/image-proxy, so it is same-origin and the canvas can read it back
// whatever the host's CORS headers say.

import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { CloseIcon, DownloadIcon, SpinnerIcon } from '@/lib/icons';
import type { PhotosResponse, PricerPhoto } from '@/lib/pricer/types';

const MAX_ZOOM = 4;
// The JPEG is the crop at the photo's own resolution, within these: a tight crop of a small photo is scaled up
// to MIN_OUT so nothing comes out tiny, and a loose crop of a huge one is scaled down to MAX_OUT.
const MIN_OUT = 512;
const MAX_OUT = 1600;

const proxied = (u: string) => `/api/charts/image-proxy?url=${encodeURIComponent(u)}`;
// "Tate McRae" → "Tate McRae.jpg": the name as typed, minus what a filename can't hold.
const fileName = (person: string) => `${person.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() || 'photo'}.jpg`;

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── The square crop ──────────────────────────────────────────────────────────

interface Pan { x: number; y: number }
interface View { zoom: number; pan: Pan }
const HOME: View = { zoom: 1, pan: { x: 0, y: 0 } };

function CropSquare({ photo, person, onClear }: { photo: PricerPhoto; person: string; onClear: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState(0);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>(HOME);
  const [exporting, setExporting] = useState(false);
  const drag = useRef<{ x: number; y: number; pan: Pan } | null>(null);

  // The square is as wide as the panel; follow it if the panel resizes.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSide(el.clientWidth));
    ro.observe(el);
    setSide(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Load the full photo and start from the centred cover crop.
  useEffect(() => {
    let on = true;
    setImg(null);
    setFailed(false);
    setView(HOME);
    const el = new Image();
    el.onload = () => { if (on) setImg(el); };
    el.onerror = () => { if (on) setFailed(true); };
    el.src = proxied(photo.full);
    return () => { on = false; };
  }, [photo]);

  // Geometry. At zoom 1 the photo covers the square (its short side fits); pan is measured from the centre and
  // clamped so the square never shows background.
  const clampPan = useCallback((p: Pan, zoom: number): Pan => {
    if (!img || !side) return { x: 0, y: 0 };
    const s = Math.max(side / img.naturalWidth, side / img.naturalHeight) * zoom;
    const mx = Math.max(0, (img.naturalWidth * s - side) / 2);
    const my = Math.max(0, (img.naturalHeight * s - side) / 2);
    return { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) };
  }, [img, side]);
  useEffect(() => { setView(v => ({ ...v, pan: clampPan(v.pan, v.zoom) })); }, [clampPan]);

  // Zoom about the centre: the pan scales with the zoom so whatever is in the middle stays there.
  const zoomTo = useCallback((z: number) => {
    setView(v => {
      const zoom = Math.min(MAX_ZOOM, Math.max(1, z));
      const k = zoom / v.zoom;
      return { zoom, pan: clampPan({ x: v.pan.x * k, y: v.pan.y * k }, zoom) };
    });
  }, [clampPan]);
  const zoomBy = useCallback((f: number) => {
    setView(v => {
      const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom * f));
      const k = zoom / v.zoom;
      return { zoom, pan: clampPan({ x: v.pan.x * k, y: v.pan.y * k }, zoom) };
    });
  }, [clampPan]);

  // Wheel to zoom. Registered by hand: React's onWheel is passive, so it could not stop the page scrolling.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * 0.0015)); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!img) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, pan: view.pan };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const { clientX, clientY } = e;
    setView(v => ({ ...v, pan: clampPan({ x: d.pan.x + clientX - d.x, y: d.pan.y + clientY - d.y }, v.zoom) }));
  };
  const onPointerUp = () => { drag.current = null; };

  const iw = img?.naturalWidth ?? 0;
  const ih = img?.naturalHeight ?? 0;
  const scale = img && side ? Math.max(side / iw, side / ih) * view.zoom : 0;
  const dispW = iw * scale;
  const dispH = ih * scale;
  const left = (side - dispW) / 2 + view.pan.x;
  const top = (side - dispH) / 2 + view.pan.y;

  const download = () => {
    if (!img || !scale || exporting) return;
    setExporting(true);
    try {
      const srcSide = side / scale;          // the crop's side in the photo's own pixels
      const out = Math.round(Math.min(MAX_OUT, Math.max(MIN_OUT, srcSide)));
      const c = document.createElement('canvas');
      c.width = out;
      c.height = out;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, -left / scale, -top / scale, srcSide, srcSide, 0, 0, out, out);
      c.toBlob(b => { if (b) triggerDownload(b, fileName(person)); setExporting(false); }, 'image/jpeg', 0.92);
    } catch (e) {
      console.error('[pricer photos] export failed:', e);
      setExporting(false);
    }
  };

  const link = 'underline decoration-zinc-700 underline-offset-2 hover:text-zinc-200';
  return (
    <div className="border-b border-zinc-900 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">Drag to move · scroll or slide to zoom</span>
        <button type="button" onClick={onClear} title="Put it back" className="text-zinc-500 transition-colors hover:text-white">
          <CloseIcon size={14} />
        </button>
      </div>
      <div
        ref={boxRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`relative aspect-square w-full touch-none select-none overflow-hidden rounded-md bg-zinc-900 ${img ? 'cursor-grab active:cursor-grabbing' : ''}`}
      >
        {img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img.src}
            alt=""
            draggable={false}
            className="pointer-events-none absolute max-w-none"
            style={{ left, top, width: dispW, height: dispH }}
          />
        )}
        {!img && !failed && <SpinnerIcon size={20} className="absolute inset-0 m-auto animate-spin text-zinc-500" />}
        {failed && <div className="absolute inset-0 grid place-items-center px-4 text-center text-xs text-red-400">Couldn&rsquo;t load this photo</div>}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={view.zoom}
          disabled={!img}
          onChange={e => zoomTo(Number(e.target.value))}
          aria-label="Zoom"
          className="min-w-0 flex-1 accent-white"
        />
        <button type="button" onClick={() => setView(HOME)} disabled={!img} className="text-[11px] text-zinc-500 transition-colors hover:text-white disabled:opacity-30">
          Reset
        </button>
      </div>
      <div className="mt-2 text-[11px] leading-snug text-zinc-500">
        {photo.creator && <>{photo.creator} · </>}
        {photo.licenseUrl
          ? <a href={photo.licenseUrl} target="_blank" rel="noopener noreferrer" className={link}>{photo.license}</a>
          : photo.license}
        {' · '}
        <a href={photo.page} target="_blank" rel="noopener noreferrer" className={link}>
          {photo.source}{photo.provider ? ` / ${photo.provider}` : ''}
        </a>
      </div>
      <button
        type="button"
        onClick={download}
        disabled={!img || exporting}
        className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-emerald-500 px-3 text-xs font-semibold text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-30"
      >
        {exporting ? <SpinnerIcon size={14} className="animate-spin" /> : <DownloadIcon size={14} />}
        <span className="truncate">Download {fileName(person)}</span>
      </button>
    </div>
  );
}

// ── The grid ─────────────────────────────────────────────────────────────────

// Openverse's thumbnailer fails on some files; fall back to the photo itself.
function Thumb({ photo }: { photo: PricerPhoto }) {
  const [src, setSrc] = useState(photo.thumb);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={photo.title}
      loading="lazy"
      draggable={false}
      onError={() => { if (src !== photo.full) setSrc(photo.full); }}
      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
    />
  );
}

// ── The panel ────────────────────────────────────────────────────────────────

export function PricerPhotos({ person }: { person: string }) {
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [photos, setPhotos] = useState<PricerPhoto[]>([]);
  const [errors, setErrors] = useState<PhotosResponse['errors']>({});
  const [failed, setFailed] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<PricerPhoto | null>(null);
  const seq = useRef(0);

  const search = useCallback(async (q: string) => {
    const s = ++seq.current;
    setLoading(true);
    setFailed('');
    setSelected(null);
    try {
      const r = await fetch(`/api/pricer/photos?q=${encodeURIComponent(q)}`);
      const j = await r.json() as PhotosResponse & { error?: string };
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      if (s !== seq.current) return;
      setPhotos(j.photos);
      setErrors(j.errors);
    } catch (e) {
      if (s !== seq.current) return;
      setPhotos([]);
      setErrors({});
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      if (s === seq.current) { setSearched(q); setLoading(false); }
    }
  }, []);

  // A new pricing searches for its name.
  useEffect(() => {
    if (!person) return;
    setQuery(person);
    void search(person);
  }, [person, search]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q && !loading) void search(q);
  };

  return (
    <aside className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-r border-zinc-900">
      <form onSubmit={submit} autoComplete="off" className="border-b border-zinc-900 p-4">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="text-[13px] font-semibold text-white">Photo</h2>
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">Wikimedia · Openverse</span>
        </div>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Who to look for"
            className="h-9 min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-[13px] text-zinc-100 placeholder-zinc-600 outline-none transition-colors focus:border-zinc-500"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="h-9 shrink-0 rounded-md border border-zinc-700 px-3 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          >
            Search
          </button>
        </div>
      </form>

      {selected && <CropSquare photo={selected} person={person || searched} onClear={() => setSelected(null)} />}

      <div className="p-4">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <SpinnerIcon size={14} className="animate-spin" /> Searching Wikimedia Commons and Openverse…
          </div>
        ) : !searched ? (
          <p className="text-xs leading-relaxed text-zinc-600">Price someone and free-to-use photos of them appear here. Pick one, square it up, download it under their name.</p>
        ) : (
          <>
            {failed && <p className="mb-3 text-xs text-red-400">Search failed: {failed}</p>}
            {errors.wikimedia && <p className="mb-2 text-xs text-red-400">Wikimedia Commons: {errors.wikimedia}</p>}
            {errors.openverse && <p className="mb-2 text-xs text-red-400">Openverse: {errors.openverse}</p>}
            {!failed && photos.length === 0 && <p className="text-xs text-zinc-500">No free-to-use photos found for &ldquo;{searched}&rdquo;.</p>}
            {photos.length > 0 && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {photos.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelected(p)}
                      title={`${p.title}${p.creator ? ` · ${p.creator}` : ''} · ${p.license}`}
                      className={`group relative aspect-square overflow-hidden rounded-md bg-zinc-900 ring-1 transition ${
                        selected?.id === p.id ? 'ring-emerald-400' : 'ring-transparent hover:ring-zinc-500'
                      }`}
                    >
                      <Thumb photo={p} />
                      <span className="absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)] truncate rounded bg-black/70 px-1 py-px text-[9px] uppercase tracking-wide text-zinc-300">
                        {p.license}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-[11px] leading-snug text-zinc-600">
                  {photos.length} photo{photos.length === 1 ? '' : 's'}. Most CC licences ask for a credit — the file page is linked once you pick one.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
