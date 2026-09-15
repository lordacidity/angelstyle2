'use client';

// A square crop of a free-to-use photo, and the button that downloads it as a JPEG named after a person. Drag to
// move, the slider or the wheel to zoom. Shared by the Pricer's photo panel and the Photos section.
//
// The full image is loaded through /api/charts/image-proxy, so it is same-origin and the canvas can read it back
// whatever the host's CORS headers say.

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { CloseIcon, DownloadIcon, SpinnerIcon } from '@/lib/icons';
import type { FreePhoto } from '@/lib/photos/types';

const MAX_ZOOM = 4;
// The JPEG is the crop at the photo's own resolution, within these: a tight crop of a small photo is scaled up
// to MIN_OUT so nothing comes out tiny, and a loose crop of a huge one is scaled down to MAX_OUT.
const MIN_OUT = 512;
const MAX_OUT = 1600;

const proxied = (u: string) => `/api/charts/image-proxy?url=${encodeURIComponent(u)}`;
// "Tate McRae" → "Tate McRae.jpg": the name as typed, minus what a filename can't hold.
export const fileName = (person: string) => `${person.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() || 'photo'}.jpg`;

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

interface Pan { x: number; y: number }
interface View { zoom: number; pan: Pan }
const HOME: View = { zoom: 1, pan: { x: 0, y: 0 } };

export function CropSquare({ photo, person, onClear, verb = 'Download', onSaved, enterSaves = false }: {
  photo: FreePhoto;
  person: string;                 // the file is named after them
  onClear: () => void;
  verb?: string;                  // the button reads "<verb> <name>.jpg"
  onSaved?: () => void;           // after the file has been handed to the browser
  enterSaves?: boolean;           // Enter, outside a text field, presses the button
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState(0);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>(HOME);
  const [exporting, setExporting] = useState(false);
  const drag = useRef<{ x: number; y: number; pan: Pan } | null>(null);

  // The square is as wide as its column; follow it if that resizes.
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
      c.toBlob(b => {
        if (b) triggerDownload(b, fileName(person));
        setExporting(false);
        if (b) onSaved?.();
      }, 'image/jpeg', 0.92);
    } catch (e) {
      console.error('[photo crop] export failed:', e);
      setExporting(false);
    }
  };

  // Enter presses the button — unless the typing is going somewhere else, or the button itself has focus (its own
  // click already fires). The handler is read through a ref so the listener is registered once.
  const downloadRef = useRef(download);
  useEffect(() => { downloadRef.current = download; });
  useEffect(() => {
    if (!enterSaves) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (t?.closest('[data-crop-save]')) return;
      e.preventDefault();
      downloadRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enterSaves]);

  const link = 'underline decoration-zinc-700 underline-offset-2 hover:text-zinc-200';
  return (
    <div className="p-4">
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
        data-crop-save=""
        onClick={download}
        disabled={!img || exporting}
        className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-emerald-500 px-3 text-xs font-semibold text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-30"
      >
        {exporting ? <SpinnerIcon size={14} className="animate-spin" /> : <DownloadIcon size={14} />}
        <span className="truncate">{verb} {fileName(person)}</span>
      </button>
      {enterSaves && <p className="mt-1.5 text-center text-[10px] text-zinc-600">or press Enter</p>}
    </div>
  );
}
