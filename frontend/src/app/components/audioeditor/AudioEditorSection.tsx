'use client';

// Audio Editor (Studio > Audio Editor) — temporary. Drop an MP3, switch on what
// should make it sound less like a studio, listen, download the WAV.
//
// A dropped file starts playing on repeat. Every change re-renders the whole
// mix (see lib/audioMuffler) a moment after the last one, and playback carries
// on from the same spot in the new render. Before plays the file as dropped,
// for comparing. Audio muffler loads the saved AUDIO_MUFFLER mix.

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { ROOM_TONE_URL, decodeAudio } from '@/lib/vidsAudio';
import { AUDIO_MUFFLER, DEFAULT_SETTINGS, EFFECTS, renderMix, toWav, type EffectId, type Settings } from '@/lib/audioMuffler';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function AudioEditorSection({ active }: { active: boolean }) {
  const ctxRef = useRef<AudioContext | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; voice: AudioBuffer } | null>(null);
  const [room, setRoom] = useState<AudioBuffer | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [mixed, setMixed] = useState<AudioBuffer | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  // ── Playback ──
  const [before, setBefore] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const srcRef = useRef<AudioBufferSourceNode | null>(null);
  const startedRef = useRef(0);   // ctx time the playing source's 0 lines up with
  const offsetRef = useRef(0);    // where playback resumes when nothing is playing
  const heard = before ? file?.voice ?? null : mixed;

  // Playback loops, so the time played wraps back round the clip.
  const now = () => {
    const s = srcRef.current;
    const ctx = ctxRef.current;
    if (!s?.buffer || !ctx) return offsetRef.current;
    return (ctx.currentTime - startedRef.current) % s.buffer.duration;
  };

  const stop = () => {
    const s = srcRef.current;
    if (!s) return;
    srcRef.current = null;
    try { s.stop(); } catch { /* already stopped */ }
    s.disconnect();
  };

  const startAt = (buf: AudioBuffer, at: number) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    stop();
    const t = Math.max(0, at) % buf.duration;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(ctx.destination);
    s.start(0, t);
    srcRef.current = s;
    startedRef.current = ctx.currentTime - t;
  };

  // A new render, or a flip between Before and After, picks up where the last one was.
  useEffect(() => {
    if (!playing || !heard) return;
    startAt(heard, offsetRef.current);
    const tick = setInterval(() => setPos(now()), 100);
    return () => {
      clearInterval(tick);
      offsetRef.current = now();
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, heard]);

  useEffect(() => { if (!active) setPlaying(false); }, [active]);
  useEffect(() => () => { stop(); void ctxRef.current?.close(); }, []);

  const seek = (t: number) => {
    offsetRef.current = t;
    setPos(t);
    if (playing && heard) startAt(heard, t);
  };

  // ── Rendering ──
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    const id = setTimeout(async () => {
      setRendering(true);
      try {
        const out = await renderMix(file.voice, room, settings);
        if (!cancelled) setMixed(out);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setRendering(false);
      }
    }, 180);
    return () => { cancelled = true; clearTimeout(id); };
  }, [file, room, settings]);

  const load = async (f: File) => {
    const ctx = ctxRef.current ?? (ctxRef.current = new AudioContext());
    void ctx.resume();
    setError('');
    if (!room) decodeAudio(ctx, ROOM_TONE_URL).then(setRoom, () => setError("Couldn't load the room tone."));
    try {
      const voice = await ctx.decodeAudioData(await f.arrayBuffer());
      stop();
      offsetRef.current = 0;
      setPos(0);
      setMixed(null);
      setFile({ name: f.name.replace(/\.[^.]+$/, ''), voice });
      // Starts on its own once the first render lands, and repeats until paused.
      setPlaying(true);
    } catch {
      setError(`Couldn't read ${f.name} as audio.`);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) void load(f);
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void load(f);
    e.target.value = '';
  };

  const download = () => {
    if (!mixed || !file) return;
    const url = URL.createObjectURL(toWav(mixed));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${file.name}-muddled.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const set = (id: EffectId, patch: Partial<Settings[EffectId]>) =>
    setSettings((s) => ({ ...s, [id]: { ...s[id], ...patch } }));

  const duration = file?.voice.duration ?? 0;

  return (
    <div
      className="flex h-screen flex-col bg-black text-white"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={onDrop}
    >
      <input ref={inputRef} type="file" accept="audio/*" className="hidden" onChange={onPick} />

      <div className="shrink-0 border-b border-zinc-900 px-6 py-4">
        <h1 className="text-lg font-semibold">Audio Editor</h1>
        <p className="text-xs text-zinc-500">Temporary. Drop an MP3, switch on whatever makes it sound less like a studio, download the WAV.</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {!file ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={`flex h-56 w-full max-w-3xl flex-col items-center justify-center gap-2 rounded-xl border border-dashed transition-colors ${
              dragging ? 'border-zinc-400 bg-zinc-900' : 'border-zinc-800 hover:border-zinc-600'
            }`}
          >
            <span className="text-sm text-zinc-300">Drop an MP3 here</span>
            <span className="text-xs text-zinc-600">or click to choose one</span>
          </button>
        ) : (
          <div className={`max-w-3xl rounded-xl border p-4 transition-colors ${dragging ? 'border-zinc-400 bg-zinc-900' : 'border-zinc-900 bg-zinc-950'}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{file.name}</div>
                <div className="text-xs text-zinc-600">{clock(duration)} · drop another file to replace it</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" onClick={() => setSettings(DEFAULT_SETTINGS)} className="h-8 rounded-md border border-zinc-800 px-3 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-white">
                  Reset
                </button>
                <button type="button" onClick={() => setSettings(AUDIO_MUFFLER)} className="h-8 rounded-md border border-zinc-800 px-3 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-white">
                  Audio muffler
                </button>
                <button type="button" onClick={download} disabled={!mixed || rendering} className="h-8 rounded-md bg-white px-3 text-xs font-medium text-black transition-opacity disabled:opacity-40">
                  Download WAV
                </button>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={() => { void ctxRef.current?.resume(); setPlaying((p) => !p); }}
                disabled={!heard}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black disabled:opacity-40"
                title={playing ? 'Pause' : 'Play'}
              >
                {playing ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="5" height="16" rx="1"/><rect x="14" y="4" width="5" height="16" rx="1"/></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>
                )}
              </button>
              <span className="w-10 text-right text-xs tabular-nums text-zinc-500">{clock(pos)}</span>
              <input
                type="range" min={0} max={duration || 1} step={0.01} value={Math.min(pos, duration)}
                onChange={(e) => seek(Number(e.target.value))}
                className="flex-1 accent-white"
              />
              <span className="w-10 text-xs tabular-nums text-zinc-500">{clock(duration)}</span>
              <div className="flex shrink-0 rounded-md border border-zinc-800 p-0.5 text-xs">
                {(['Before', 'After'] as const).map((label) => {
                  const on = (label === 'Before') === before;
                  return (
                    <button key={label} type="button" onClick={() => setBefore(label === 'Before')}
                      className={`rounded px-2.5 py-1 transition-colors ${on ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-200'}`}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-2 h-4 text-xs text-zinc-600">{rendering ? 'Rendering…' : ''}</div>
          </div>
        )}

        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

        <div className="mt-5 grid max-w-3xl grid-cols-1 gap-3 md:grid-cols-2">
          {EFFECTS.map(({ id, label, hint }) => {
            const fx = settings[id];
            return (
              <div key={id} className={`rounded-xl border p-4 transition-colors ${fx.on ? 'border-zinc-700 bg-zinc-950' : 'border-zinc-900'}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className={`text-sm font-medium ${fx.on ? 'text-white' : 'text-zinc-400'}`}>{label}</span>
                  <button
                    type="button" role="switch" aria-checked={fx.on} aria-label={label}
                    onClick={() => set(id, { on: !fx.on })}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${fx.on ? 'bg-white' : 'bg-zinc-800'}`}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${fx.on ? 'left-[18px] bg-black' : 'left-0.5 bg-zinc-500'}`} />
                  </button>
                </div>
                <p className="mt-1 text-xs text-zinc-600">{hint}</p>
                <div className="mt-3 flex items-center gap-3">
                  <input
                    type="range" min={0} max={100} step={1} value={fx.amount}
                    onChange={(e) => set(id, { amount: Number(e.target.value), on: true })}
                    className={`flex-1 accent-white ${fx.on ? '' : 'opacity-40'}`}
                  />
                  <span className="w-7 text-right text-xs tabular-nums text-zinc-500">{fx.amount}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
