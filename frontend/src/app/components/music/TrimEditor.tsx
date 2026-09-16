'use client';

// The trim editor on the Music page: one song's waveform with a start and an
// end handle, a preview of the stretch between them, and the two ways to keep
// it — as a new song, or (for songs that were added) over the song itself. It
// only picks the stretch; the cut is made on the server (/api/charts/trim-audio).
//
// A press on the waveform takes the nearer handle there and drags it. The
// waveform is drawn from the song decoded at 8 kHz: plenty to see where the
// loud parts are, and a sliver of the memory a full decode takes. The preview
// plays the file through its own <audio>, and stops when the page's player
// starts, so the two are never heard at once.

import { useEffect, useRef, useState, type PointerEvent } from 'react';

const BUCKETS = 1200;
const HEIGHT = 80;
/** Same floor as the route: anything shorter is a slip of a handle. */
const MIN_SECONDS = 0.5;

interface Wave {
  peaks: Float32Array;
  top: number;
  duration: number;
}

/** 62.36 → "1:02.4" */
const stamp = (s: number) => {
  const t = Math.round(Math.max(0, s) * 10) / 10;
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
};

/** "1:02.4" or "62.4" → seconds, or null when it is neither. */
function parseStamp(text: string): number | null {
  const t = text.trim();
  const m = /^(\d+):(\d{1,2}(?:\.\d*)?)$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(t);
  return t !== '' && Number.isFinite(n) ? n : null;
}

async function readWave(src: string, signal: AbortSignal): Promise<Wave> {
  const res = await fetch(src, { signal });
  if (!res.ok) throw new Error(`Couldn't load the song (${res.status}).`);
  const bytes = await res.arrayBuffer();
  // decodeAudioData resamples to the context's rate, so 8 kHz keeps a
  // four-minute song to a few MB.
  const buf = await new OfflineAudioContext(1, 1, 8000).decodeAudioData(bytes);
  const peaks = new Float32Array(BUCKETS);
  const per = Math.max(1, Math.floor(buf.length / BUCKETS));
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const data = buf.getChannelData(c);
    for (let b = 0; b < BUCKETS; b++) {
      const from = Math.floor((b / BUCKETS) * data.length);
      const to = Math.min(data.length, from + per);
      let max = peaks[b];
      for (let i = from; i < to; i++) {
        const v = Math.abs(data[i]);
        if (v > max) max = v;
      }
      peaks[b] = max;
    }
  }
  let top = 0;
  for (const p of peaks) if (p > top) top = p;
  return { peaks, top: top || 1, duration: buf.duration };
}

function StampInput({ label, value, onCommit }: { label: string; value: number; onCommit: (seconds: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
      {label}
      <input
        value={draft ?? stamp(value)}
        onFocus={(e) => { setDraft(stamp(value)); e.currentTarget.select(); }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const t = cancelled.current || draft === null ? null : parseStamp(draft);
          cancelled.current = false;
          setDraft(null);
          if (t !== null) onCommit(t);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { cancelled.current = true; e.currentTarget.blur(); }
        }}
        className="h-6 w-16 rounded border border-zinc-800 bg-zinc-950 px-1.5 text-center text-[11px] tabular-nums text-white focus:border-zinc-500 focus:outline-none"
      />
    </label>
  );
}

export function TrimEditor({
  src, label, canReplace, pagePlaying, pausePage, busy, error, onCancel, onSave,
}: {
  /** The song's file (with a version on the end after a replace). */
  src: string;
  label: string;
  /** Only songs that were added can be written over. */
  canReplace: boolean;
  /** The page's player is playing — the preview stops. */
  pagePlaying: boolean;
  /** Stop the page's player before the preview starts. */
  pausePage: () => void;
  busy: 'copy' | 'replace' | null;
  error: string;
  onCancel: () => void;
  onSave: (mode: 'copy' | 'replace', start: number, end: number) => void;
}) {
  const [wave, setWave] = useState<Wave | null>(null);
  const [loadError, setLoadError] = useState('');
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    readWave(src, ac.signal).then(
      (w) => { setWave(w); setStart(0); setEnd(w.duration); },
      (e) => { if (!ac.signal.aborted) setLoadError(e instanceof Error ? e.message : "Couldn't read the song."); },
    );
    return () => ac.abort();
  }, [src]);

  const duration = wave?.duration ?? 0;
  const setStartAt = (t: number) => setStart(Math.max(0, Math.min(t, end - MIN_SECONDS)));
  const setEndAt = (t: number) => setEnd(Math.min(duration, Math.max(t, start + MIN_SECONDS)));

  // ── Preview ──
  const audioRef = useRef<HTMLAudioElement>(null);
  const frame = useRef(0);
  const endRef = useRef(end);
  const [previewing, setPreviewing] = useState(false);
  const [playhead, setPlayhead] = useState<number | null>(null);

  useEffect(() => { endRef.current = end; }, [end]);
  useEffect(() => { if (pagePlaying) audioRef.current?.pause(); }, [pagePlaying]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const preview = () => {
    const a = audioRef.current;
    if (!a || !wave) return;
    if (previewing) { a.pause(); return; }
    pausePage();
    a.currentTime = start;
    void a.play().then(() => {
      setPreviewing(true);
      const tick = () => {
        if (a.paused) return;
        if (a.currentTime >= endRef.current) { a.pause(); return; }
        setPlayhead(a.currentTime);
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    }, () => setLoadError("Couldn't play the song."));
  };

  // ── Waveform ──
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const g = canvas?.getContext('2d');
    if (!canvas || !g || !wave || !width) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, HEIGHT);

    const x0 = (start / wave.duration) * width;
    const x1 = (end / wave.duration) * width;
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(x0, 0, x1 - x0, HEIGHT);

    for (let x = 0; x < width; x += 2) {
      const from = Math.floor((x / width) * BUCKETS);
      const to = Math.max(from + 1, Math.floor(((x + 2) / width) * BUCKETS));
      let v = 0;
      for (let b = from; b < Math.min(to, BUCKETS); b++) if (wave.peaks[b] > v) v = wave.peaks[b];
      const bar = Math.max(1, (v / wave.top) * (HEIGHT - 12));
      g.fillStyle = x >= x0 && x <= x1 ? '#d4d4d8' : '#3f3f46';
      g.fillRect(x, (HEIGHT - bar) / 2, 1.5, bar);
    }

    g.fillStyle = '#ffffff';
    for (const x of [x0, x1]) {
      g.fillRect(x - 1, 0, 2, HEIGHT);
      g.fillRect(x - 4, 0, 8, 8);
    }
    if (playhead !== null) {
      g.fillStyle = '#04df9d';
      g.fillRect((playhead / wave.duration) * width - 1, 0, 2, HEIGHT);
    }
  }, [wave, width, start, end, playhead]);

  const dragging = useRef<'start' | 'end' | null>(null);
  const timeAt = (clientX: number) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r || !r.width) return 0;
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration;
  };
  const moveTo = (which: 'start' | 'end', t: number) => (which === 'start' ? setStartAt(t) : setEndAt(t));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!wave) return;
    const t = timeAt(e.clientX);
    const which = Math.abs(t - start) <= Math.abs(t - end) ? 'start' : 'end';
    dragging.current = which;
    e.currentTarget.setPointerCapture(e.pointerId);
    moveTo(which, t);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) moveTo(dragging.current, timeAt(e.clientX));
  };
  const onPointerUp = () => { dragging.current = null; };

  const replace = () => {
    if (!confirm(`Replace "${label}" with the part you kept? The rest of the song is gone for good.`)) return;
    audioRef.current?.pause();
    onSave('replace', start, end);
  };
  const saveCopy = () => {
    audioRef.current?.pause();
    onSave('copy', start, end);
  };

  return (
    <div className="mt-2 rounded-lg border border-zinc-800 bg-black p-3">
      <audio
        ref={audioRef}
        src={src}
        preload="auto"
        onPause={() => { cancelAnimationFrame(frame.current); setPreviewing(false); setPlayhead(null); }}
        className="hidden"
      />

      <div
        ref={boxRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`relative touch-none select-none ${wave ? 'cursor-ew-resize' : ''}`}
        style={{ height: HEIGHT }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        {!wave && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-zinc-600">
            {loadError || 'Reading the waveform…'}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={preview}
          disabled={!wave}
          title={previewing ? 'Stop' : 'Play the part you keep'}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-zinc-800 px-2.5 text-[11px] text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white disabled:opacity-40"
        >
          {previewing ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="1.5"/></svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>
          )}
          {previewing ? 'Stop' : 'Preview'}
        </button>
        <StampInput label="Start" value={start} onCommit={setStartAt} />
        <StampInput label="End" value={end} onCommit={setEndAt} />
        <span className="text-[11px] tabular-nums text-zinc-500">
          {wave ? `Keeps ${stamp(end - start)} of ${stamp(duration)}` : ''}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          disabled={!!busy}
          className="h-7 rounded-md px-2.5 text-[11px] text-zinc-500 transition-colors hover:text-white disabled:opacity-40"
        >
          Cancel
        </button>
        {canReplace && (
          <button
            type="button"
            onClick={replace}
            disabled={!wave || !!busy}
            title="Write the part you kept over this song"
            className="h-7 rounded-md border border-zinc-800 px-2.5 text-[11px] text-zinc-300 transition-colors hover:border-red-500/60 hover:text-red-300 disabled:opacity-40"
          >
            {busy === 'replace' ? 'Replacing…' : 'Replace'}
          </button>
        )}
        <button
          type="button"
          onClick={saveCopy}
          disabled={!wave || !!busy}
          title="Keep the original and add the part you kept as its own song"
          className="h-7 rounded-md bg-white px-2.5 text-[11px] font-medium text-black transition-colors hover:bg-zinc-200 disabled:opacity-40"
        >
          {busy === 'copy' ? 'Saving…' : 'Save as new song'}
        </button>
      </div>

      {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
