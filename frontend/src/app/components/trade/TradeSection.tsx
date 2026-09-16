'use client';

// Trade (Studio > Trade): the Pauv trade recording, made here in the browser
// the way the ChatGPT one is — see trade-video.ts for the script. A name and
// a direction are all it takes (the amount is always $10); Light or Dark
// picks the site's theme. Preview builds the clip and plays it on a canvas
// with a scrubber, so the visuals can be checked frame by frame; Start
// renders the MP4 and downloads it. Not yet wired into Vids' Bottom card.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ACTIVITY,
  buildTradeAudio,
  AMOUNT_USD, createTradeClip, loadTradeAssets, renderTradeVideo, VIDEO_H, VIDEO_W, VIEWPORT_W,
  type Direction, type Theme, type TradeAssets, type TradeBeats, type TradeClip,
} from './trade-video';

const SETUP_KEY = 'studio-trade-setup-v1';

interface Setup { name: string; direction: Direction; theme: Theme }
function loadSetup(): Setup {
  const fallback: Setup = { name: '', direction: 'up', theme: 'light' };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(SETUP_KEY);
    if (!raw) return fallback;
    const j = JSON.parse(raw) as Partial<Record<keyof Setup, unknown>>;
    return {
      name: typeof j.name === 'string' ? j.name : '',
      direction: j.direction === 'down' ? 'down' : 'up',
      theme: j.theme === 'dark' ? 'dark' : 'light',
    };
  } catch {
    return fallback;
  }
}
function saveSetup(s: Setup) {
  try { localStorage.setItem(SETUP_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

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

const fmtT = (s: number) => `${s.toFixed(2)}s`;
/** How far ahead the preview's sound is scheduled, so it starts on time. */
const SOUND_LEAD = 0.05;
const BEAT_LABEL: Record<keyof TradeBeats, string> = {
  searching: 'search', analyzing: 'chart', trading: 'trade', confirming: 'confirmed',
};

export function TradeSection({ active }: { active: boolean }) {
  const [name, setName] = useState(() => loadSetup().name);
  const [direction, setDirection] = useState<Direction>(() => loadSetup().direction);
  const [theme, setTheme] = useState<Theme>(() => loadSetup().theme);
  // Loading the person or rendering the file (label + 0..1 once frames go).
  const [busy, setBusy] = useState<{ label: string; pct: number | null } | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // The preview: the assets the clip was built from, the clip, and playback.
  const assetsRef = useRef<{ key: string; assets: TradeAssets } | null>(null);
  const [assets, setAssets] = useState<TradeAssets | null>(null);
  const clipRef = useRef<TradeClip | null>(null);
  const [clipInfo, setClipInfo] = useState<{ seconds: number; beats: TradeBeats } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [time, setTime] = useState(0);
  const timeRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef<number | null>(null);
  // The sound, for the preview: the same buffer the rendered file gets — the
  // keyboard over the typing, the mouse on every click. Mixing it needs the
  // keyboard recording fetched and decoded, so it is started when the clip is
  // built and played from wherever the scrubber is once it is ready.
  const [sound, setSound] = useState(true);
  const soundRef = useRef(true);
  soundRef.current = sound;
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioRef = useRef<Promise<AudioBuffer | null> | null>(null);
  const audioSrcRef = useRef<AudioBufferSourceNode | null>(null);
  // Bumped whenever playback stops, so a bed that finishes mixing after the
  // user has paused or scrubbed doesn't start anyway.
  const soundTokenRef = useRef(0);

  useEffect(() => { saveSetup({ name, direction, theme }); }, [name, direction, theme]);

  const drawAt = useCallback((t: number) => {
    const clip = clipRef.current;
    if (!clip) return;
    timeRef.current = t;
    clip.draw(t);
    setTime(t);
  }, []);

  const stopSound = useCallback(() => {
    soundTokenRef.current++;
    const src = audioSrcRef.current;
    if (!src) return;
    audioSrcRef.current = null;
    try { src.stop(); } catch { /* already finished */ }
    src.disconnect();
  }, []);

  const stopPlayback = useCallback(() => {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    stopSound();
    setPlaying(false);
  }, [stopSound]);

  const startPlayback = useCallback(() => {
    const clip = clipRef.current;
    if (!clip) return;
    stopPlayback();
    setPlaying(true);
    const from = timeRef.current >= clip.seconds - 0.05 ? 0 : timeRef.current;
    const t0 = performance.now() - from * 1000;
    // The picture runs on the page's clock until the sound is going, then on
    // the sound's: the clip time of what is coming out of the speakers now,
    // output latency and all. Starting the sound on a guess of where the
    // picture is (and before the context had even resumed) left it late.
    let shown = from;
    let heard: (() => number) | null = null;
    if (soundRef.current && audioRef.current) {
      const token = soundTokenRef.current;
      void audioRef.current.then(async bed => {
        if (!bed || token !== soundTokenRef.current || !soundRef.current) return;
        try {
          const actx = audioCtxRef.current ?? (audioCtxRef.current = new AudioContext());
          await actx.resume();
          if (token !== soundTokenRef.current) return;
          const offset = shown + SOUND_LEAD;
          if (offset >= bed.duration) return;
          const when = actx.currentTime + SOUND_LEAD;
          const src = actx.createBufferSource();
          src.buffer = bed;
          src.connect(actx.destination);
          src.start(when, offset);
          audioSrcRef.current = src;
          heard = () => {
            const ts = actx.getOutputTimestamp();
            const now = ts.contextTime && ts.performanceTime
              ? ts.contextTime + (performance.now() - ts.performanceTime) / 1000
              : actx.currentTime - actx.baseLatency - (actx.outputLatency || 0);
            return offset + (now - when);
          };
        } catch { /* the picture plays without it */ }
      });
    }
    const tick = () => {
      // Never backwards: while the sound gets under way the picture holds.
      const t = Math.max(shown, heard ? heard() : (performance.now() - t0) / 1000);
      shown = t;
      if (t >= clip.seconds) {
        // Loop, holding the last frame for a beat first.
        drawAt(clip.seconds - 1 / 30);
        rafRef.current = requestAnimationFrame(() => {
          timeRef.current = 0;
          startPlayback();
        });
        return;
      }
      drawAt(t);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [drawAt, stopPlayback]);

  // Turning the sound off mid-play silences it now, not on the next loop.
  useEffect(() => { if (!sound) stopSound(); }, [sound, stopSound]);

  useEffect(() => { if (!active) stopPlayback(); }, [active, stopPlayback]);
  useEffect(() => () => stopPlayback(), [stopPlayback]);

  // Build (or rebuild) the clip on the preview canvas from the assets, for the
  // direction chosen now. Cheap: no network, no decoding.
  const buildClip = useCallback((a: TradeAssets, dir: Direction, at: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    const clip = createTradeClip(ctx, a, dir);
    clipRef.current = clip;
    // A re-cut moves the typing and the clicks, so the bed is mixed again —
    // started now so it is ready by the time Play is pressed.
    audioRef.current = buildTradeAudio(clip, a.person.name).catch(err => {
      console.error('[trade] preview sound skipped:', err);
      return null;
    });
    setClipInfo({ seconds: clip.seconds, beats: clip.beats });
    drawAt(Math.min(at, clip.seconds - 1 / 30));
  }, [drawAt]);

  // A new direction re-cuts the preview in place; the assets are the same.
  useEffect(() => {
    const a = assetsRef.current;
    if (a) buildClip(a.assets, direction, timeRef.current);
  }, [direction, buildClip]);

  function cancel() {
    ctrlRef.current?.abort();
    ctrlRef.current = null;
    setBusy(null);
  }

  // The person and everything drawn about them, fetched once per name and
  // theme and kept for the next preview or render.
  async function prepare(signal: AbortSignal): Promise<TradeAssets> {
    const n = name.trim();
    const key = `${theme}|${n.toLowerCase()}`;
    const have = assetsRef.current;
    if (have && have.key === key) return have.assets;
    setBusy({ label: 'Finding them on Pauv…', pct: null });
    const a = await loadTradeAssets(n, theme, signal);
    assetsRef.current = { key, assets: a };
    setAssets(a);
    return a;
  }

  async function preview() {
    const n = name.trim();
    if (!n) { nameRef.current?.focus(); return; }
    cancel();
    stopPlayback();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setNote(null);
    try {
      const a = await prepare(ctrl.signal);
      if (ctrl.signal.aborted) return;
      timeRef.current = 0;
      buildClip(a, direction, 0);
      startPlayback();
    } catch (err) {
      if (!ctrl.signal.aborted) setNote({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      if (ctrlRef.current === ctrl) { ctrlRef.current = null; setBusy(null); }
    }
  }

  async function start() {
    const n = name.trim();
    if (!n) { nameRef.current?.focus(); return; }
    cancel();
    stopPlayback();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setNote(null);
    try {
      const a = await prepare(ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (!clipRef.current) buildClip(a, direction, 0);
      setBusy({ label: 'Rendering…', pct: 0 });
      const { blob, filename, seconds } = await renderTradeVideo(a, {
        direction,
        signal: ctrl.signal,
        onProgress: (done, total) => setBusy({ label: `Rendering ${Math.round((done / total) * 100)}%`, pct: done / total }),
      });
      downloadBlob(blob, filename);
      setNote({ ok: true, text: `Saved ${filename} (${seconds.toFixed(1)}s)` });
    } catch (err) {
      if (!ctrl.signal.aborted) setNote({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      if (ctrlRef.current === ctrl) { ctrlRef.current = null; setBusy(null); }
    }
  }

  function resetAll() {
    cancel();
    stopPlayback();
    assetsRef.current = null;
    clipRef.current = null;
    setAssets(null);
    setClipInfo(null);
    setNote(null);
    setName('');
    setDirection('up');
    setTheme('light');
    try { localStorage.removeItem(SETUP_KEY); } catch { /* ignore */ }
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  }

  const hasClip = !!clipInfo;
  const person = assets?.person ?? null;

  return (
    <div className="relative min-h-screen bg-black text-white">
      <button
        type="button"
        onClick={resetAll}
        title="Reset everything"
        className="absolute right-4 top-4 z-10 rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-600 hover:text-white"
      >
        Reset
      </button>
      <div className="flex flex-col gap-6 p-4 sm:p-8 xl:flex-row xl:items-start">
        {/* ── Setup card ─────────────────────────────────────────────────── */}
        <div className="w-full shrink-0 rounded-2xl border border-zinc-800 bg-[#111] p-6 sm:p-8 flex flex-col gap-6 xl:w-[420px]">
          <div>
            <h1 className="text-3xl font-semibold text-white">Trade</h1>
            <p className="text-base text-zinc-500 mt-2">
              Type a name and pick a direction. Pauv opens, finds them, reads their chart and trades ${AMOUNT_USD} the way you said.
            </p>
          </div>
          <label className="flex flex-col gap-2">
            <span className="text-sm uppercase tracking-wide text-zinc-500">Name</span>
            <input
              ref={nameRef}
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void preview(); }}
              placeholder="e.g. Donald Trump"
              className="h-14 rounded-xl bg-black border border-zinc-800 px-4 text-white text-xl outline-none focus:border-zinc-500"
            />
            <span className="text-sm text-zinc-600">
              Matched against everyone on Pauv, typed out in full in the recording.
              {person && <> Found <span className="text-zinc-300">{person.name}</span> at ${person.price.usd?.toFixed(2)}.</>}
            </span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setDirection('up')}
              className={`h-16 rounded-xl border text-xl font-semibold transition-colors ${
                direction === 'up'
                  ? 'bg-emerald-500/15 border-emerald-500 text-emerald-300'
                  : 'bg-black border-zinc-800 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              📈 Up
            </button>
            <button
              type="button"
              onClick={() => setDirection('down')}
              className={`h-16 rounded-xl border text-xl font-semibold transition-colors ${
                direction === 'down'
                  ? 'bg-red-500/15 border-red-500 text-red-300'
                  : 'bg-black border-zinc-800 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              📉 Down
            </button>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm uppercase tracking-wide text-zinc-500">Pauv theme</span>
            <div className="grid grid-cols-2 gap-3">
              {(['light', 'dark'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTheme(t)}
                  className={`h-12 rounded-xl border text-base font-semibold transition-colors ${
                    theme === t
                      ? 'bg-white/10 border-zinc-400 text-white'
                      : 'bg-black border-zinc-800 text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {t === 'light' ? '☀️ Light' : '🌙 Dark'}
                </button>
              ))}
            </div>
            {assets?.homeIsFallback && (
              <span className="text-sm text-amber-300/90">
                No dark homepage screenshot yet: the light one is standing in, dimmed. Drop one at
                {' '}<code className="text-amber-200">frontend/public/pauv-home-dark.png</code>.
              </span>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={busy ? undefined : () => void preview()}
                disabled={!!busy || !name.trim()}
                className="h-14 rounded-xl border border-zinc-700 bg-black text-white font-semibold text-lg hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Preview
              </button>
              <button
                type="button"
                onClick={busy ? undefined : () => void start()}
                disabled={!busy && !name.trim()}
                className="relative overflow-hidden h-14 rounded-xl bg-white text-black font-semibold text-lg hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
              >
                {busy?.pct != null && (
                  <span className="absolute inset-y-0 left-0 bg-zinc-400/70" style={{ width: `${Math.round(busy.pct * 100)}%` }} />
                )}
                <span className="relative">{busy ? busy.label : 'Start'}</span>
              </button>
            </div>
            {busy && (
              <div className="flex justify-end text-sm">
                <button type="button" onClick={cancel} className="text-zinc-400 hover:text-white">Cancel</button>
              </div>
            )}
            {note && (
              <p className={`text-sm leading-relaxed ${note.ok ? 'text-emerald-300' : 'text-red-300'}`}>{note.text}</p>
            )}
          </div>
          <p className="text-sm text-zinc-600 leading-relaxed">
            Preview plays the clip here, frame-exact, with a scrubber. Start renders it at {VIDEO_W}×{VIDEO_H} and downloads
            it. The page is laid out at pauv.com&apos;s own sizes for a {VIEWPORT_W}px window and scaled to fill the frame, the way
            the reference screenshots are. Name, bio, photo, price, holders, volume and the changes are Pauv&apos;s, shown at {ACTIVITY}×
            so the page looks busier; the chart&apos;s path and the rest are made up, the same way every time. The pointer is drawn in,
            with the site&apos;s chart hover. You hear the app&apos;s own keyboard over the typing and a click on everything the
            pointer presses — the same sounds the ChatGPT clip uses.
          </p>
        </div>

        {/* ── Preview ────────────────────────────────────────────────────── */}
        <div className="min-w-0 flex-1 flex flex-col gap-3">
          <div className="relative w-full max-w-[1000px] overflow-hidden rounded-xl border border-zinc-800 bg-black" style={{ aspectRatio: `${VIDEO_W} / ${VIDEO_H}` }}>
            <canvas ref={canvasRef} width={VIDEO_W} height={VIDEO_H} className="block h-full w-full" />
            {!hasClip && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-600">
                {busy ? busy.label : 'Preview builds the clip here.'}
              </div>
            )}
          </div>
          {hasClip && clipInfo && (
            <div className="flex w-full max-w-[1000px] flex-col gap-2">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={playing ? stopPlayback : startPlayback}
                  className="h-9 w-20 rounded-md border border-zinc-700 bg-zinc-900 text-sm font-semibold text-white hover:border-zinc-500"
                >
                  {playing ? 'Pause' : 'Play'}
                </button>
                <button
                  type="button"
                  onClick={() => setSound(s => !s)}
                  className={`h-9 w-20 rounded-md border text-sm font-semibold ${sound ? 'border-zinc-700 bg-zinc-900 text-white hover:border-zinc-500' : 'border-zinc-800 bg-zinc-950 text-zinc-500 hover:border-zinc-600'}`}
                  title="What you hear here is what the file gets"
                >
                  {sound ? 'Sound' : 'Muted'}
                </button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, clipInfo.seconds - 1 / 30)}
                  step={1 / 30}
                  value={Math.min(time, clipInfo.seconds)}
                  onChange={e => { stopPlayback(); drawAt(Number(e.target.value)); }}
                  className="flex-1"
                />
                <span className="w-24 text-right font-mono text-xs text-zinc-400">{fmtT(time)} / {fmtT(clipInfo.seconds)}</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                {(Object.keys(clipInfo.beats) as (keyof TradeBeats)[]).map(k => {
                  const b = clipInfo.beats[k];
                  const on = time >= b.start && time < b.end;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => { stopPlayback(); drawAt(b.start); }}
                      className={`font-mono ${on ? 'text-white' : 'hover:text-zinc-300'}`}
                      title="Jump to this beat"
                    >
                      {BEAT_LABEL[k]} {fmtT(b.start)}–{fmtT(b.end)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
