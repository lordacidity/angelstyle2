'use client';

// A player for the recordings drawn frame by frame in the browser (Studio >
// News today; the trade and ChatGPT clips are drawn the same way). The clip
// draws itself onto the canvas here, frame-exact, behind Play/Pause, a
// scrubber, the beats to jump to, and the clip's own sound — the same buffer
// its file gets — behind a Sound/Muted button.
//
// Playback is the trade section's: the picture runs on the page's clock until
// the sound is going, then on the sound's — the clip time of what is coming
// out of the speakers now, output latency and all — so the two never drift.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore, type RefObject } from 'react';

export interface Stretch { start: number; end: number }
export interface PlayableClip {
  draw: (t: number) => void;
  seconds: number;
  beats: Record<string, Stretch>;
}
export interface ClipPlayerHandle {
  /** Play from wherever the scrubber is (from the top once it has finished). */
  play: () => void;
  stop: () => void;
  /** Show frame `t`, stopped. */
  seek: (t: number) => void;
}
interface Props {
  /** The canvas the clip draws on; the caller builds the clip against its
   *  context. Its pixel size is `width`×`height`; it is shown at the frame's
   *  aspect, up to `maxWidth` CSS px wide. */
  canvasRef: RefObject<HTMLCanvasElement | null>;
  width: number;
  height: number;
  maxWidth?: number;
  clip: PlayableClip | null;
  /** The clip's sound, when it has one. Null plays silent. */
  audio: Promise<AudioBuffer | null> | null;
  beatLabels: Record<string, string>;
  /** False while the section is hidden: playback stops. */
  active: boolean;
  /** What the empty box says. */
  placeholder: string;
  /** Bump to play a new clip from the top as soon as it is on the canvas —
   *  the clip's first frame goes down first, so a play() from outside can't
   *  race it. */
  autoplay?: number;
}

const fmtT = (s: number) => `${s.toFixed(2)}s`;
/** How far ahead the sound is scheduled, so it starts on time. */
const SOUND_LEAD = 0.05;

/** Where playback is: running or not, and the frame on the canvas. The
 *  animation loop and the sound live outside React, so this is kept outside
 *  it too and subscribed to — effects and callbacks move it freely. */
interface Transport { playing: boolean; time: number }
function useTransport(): [Transport, (patch: Partial<Transport>) => void] {
  const store = useRef({ state: { playing: false, time: 0 } as Transport, listeners: new Set<() => void>() }).current;
  const subscribe = useCallback((l: () => void) => { store.listeners.add(l); return () => { store.listeners.delete(l); }; }, [store]);
  const get = useCallback(() => store.state, [store]);
  const set = useCallback((patch: Partial<Transport>) => {
    store.state = { ...store.state, ...patch };
    store.listeners.forEach(l => l());
  }, [store]);
  return [useSyncExternalStore(subscribe, get, get), set];
}

export const ClipPlayer = forwardRef<ClipPlayerHandle, Props>(function ClipPlayer(
  { canvasRef, width, height, maxWidth = 1000, clip, audio, beatLabels, active, placeholder, autoplay = 0 }, ref,
) {
  // The clip, the sound and the switch as refs too, for the playback loop and
  // the sound's own callback, which outlive a render. Kept in step by effects
  // declared ahead of the ones that read them.
  const clipRef = useRef<PlayableClip | null>(clip);
  const audioRef = useRef(audio);
  const [{ playing, time }, setTransport] = useTransport();
  const timeRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const [sound, setSound] = useState(true);
  const soundRef = useRef(true);
  useEffect(() => { clipRef.current = clip; }, [clip]);
  useEffect(() => { audioRef.current = audio; }, [audio]);
  useEffect(() => { soundRef.current = sound; }, [sound]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSrcRef = useRef<AudioBufferSourceNode | null>(null);
  // Bumped whenever playback stops, so a bed that finishes mixing after the
  // user has paused or scrubbed doesn't start anyway.
  const soundTokenRef = useRef(0);
  // The loop's way back to the top: startPlayback, once it exists.
  const restartRef = useRef<() => void>(() => {});

  const drawAt = useCallback((t: number) => {
    const c = clipRef.current;
    if (!c) return;
    timeRef.current = t;
    c.draw(t);
    setTransport({ time: t });
  }, [setTransport]);

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
    setTransport({ playing: false });
  }, [stopSound, setTransport]);

  const startPlayback = useCallback(() => {
    const c = clipRef.current;
    if (!c) return;
    stopPlayback();
    setTransport({ playing: true });
    const from = timeRef.current >= c.seconds - 0.05 ? 0 : timeRef.current;
    const t0 = performance.now() - from * 1000;
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
      if (t >= c.seconds) {
        // Loop, holding the last frame for a beat first.
        drawAt(c.seconds - 1 / 30);
        rafRef.current = requestAnimationFrame(() => {
          timeRef.current = 0;
          restartRef.current();
        });
        return;
      }
      drawAt(t);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [drawAt, stopPlayback, setTransport]);
  useEffect(() => { restartRef.current = startPlayback; }, [startPlayback]);

  useImperativeHandle(ref, () => ({
    play: startPlayback,
    stop: stopPlayback,
    seek: (t: number) => { stopPlayback(); drawAt(t); },
  }), [startPlayback, stopPlayback, drawAt]);

  // Turning the sound off mid-play silences it now, not on the next loop.
  useEffect(() => { if (!sound) stopSound(); }, [sound, stopSound]);
  useEffect(() => { if (!active) stopPlayback(); }, [active, stopPlayback]);
  useEffect(() => () => stopPlayback(), [stopPlayback]);
  // A new clip shows its first frame, then plays if asked, else waits.
  useEffect(() => {
    stopPlayback();
    timeRef.current = 0;
    if (!clip) return;
    drawAt(0);
    if (autoplay) startPlayback();
  }, [clip, autoplay, drawAt, stopPlayback, startPlayback]);

  return (
    <div className="flex w-full flex-col gap-3" style={{ maxWidth: `${maxWidth}px` }}>
      <div className="relative w-full overflow-hidden rounded-xl border border-zinc-800 bg-black" style={{ aspectRatio: `${width} / ${height}` }}>
        <canvas ref={canvasRef} width={width} height={height} className="block h-full w-full" />
        {!clip && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-600">{placeholder}</div>
        )}
      </div>
      {clip && (
        <div className="flex w-full flex-col gap-2">
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
              max={Math.max(0, clip.seconds - 1 / 30)}
              step={1 / 30}
              value={Math.min(time, clip.seconds)}
              onChange={e => { stopPlayback(); drawAt(Number(e.target.value)); }}
              className="flex-1"
            />
            <span className="w-24 text-right font-mono text-xs text-zinc-400">{fmtT(time)} / {fmtT(clip.seconds)}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
            {Object.keys(clip.beats).map(k => {
              const b = clip.beats[k];
              const on = time >= b.start && time < b.end;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => { stopPlayback(); drawAt(b.start); }}
                  className={`font-mono ${on ? 'text-white' : 'hover:text-zinc-300'}`}
                  title="Jump to this beat"
                >
                  {beatLabels[k] ?? k} {fmtT(b.start)}–{fmtT(b.end)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});
