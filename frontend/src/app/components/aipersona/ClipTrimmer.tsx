'use client';

// The video a scene is cut from, with the two things that can be done to it
// before Go: trim the start and the end, and speed it up.
//
// The preview plays only what is inside the trim, at the chosen speed, and
// loops. At rest it sits on the start of the trim — because that picture, the
// very first frame after the trim, is the one every persona is drawn into.

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { MAX_CLIP_SECONDS, MAX_SPEED, MIN_CLIP_SECONDS, MIN_SPEED, clipSeconds } from '@/lib/aipersona/types';
import { LABEL } from './aipersona-ui';

export interface Trim { start: number; end: number; speed: number }

/** The handles never come closer than this. */
const MIN_GAP = 0.2;
/** One arrow-key press on a handle: about a frame. Shift makes it half a second. */
const NUDGE = 1 / 30;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

export function ClipTrimmer({ url, duration, trim, onChange, onLoaded, onUnreadable, disabled }: {
  url: string;
  /** 0 until the browser has read the file. */
  duration: number;
  trim: Trim;
  onChange: (trim: Trim) => void;
  onLoaded: (duration: number) => void;
  onUnreadable: () => void;
  disabled?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const { start, end, speed } = trim;

  useEffect(() => {
    if (video.current) video.current.playbackRate = speed;
  }, [speed, duration]);

  // While it plays, the playhead stays inside the trim: its end loops to its start.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = video.current;
      if (v) {
        if (v.currentTime >= end || v.currentTime < start - 0.05) v.currentTime = start;
        setTime(v.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, start, end]);

  function seek(t: number) {
    const v = video.current;
    if (!v) return;
    v.currentTime = t;
    setTime(t);
  }

  function toggle() {
    const v = video.current;
    if (!v || !duration) return;
    if (!v.paused) { v.pause(); return; }
    if (v.currentTime >= end - 0.05 || v.currentTime < start) v.currentTime = start;
    void v.play();
  }

  /** Move a handle, and show the frame it now sits on. */
  function move(which: 'start' | 'end', t: number) {
    if (disabled) return;
    const next = which === 'start'
      ? { ...trim, start: clamp(t, 0, end - MIN_GAP) }
      : { ...trim, end: clamp(t, start + MIN_GAP, duration) };
    video.current?.pause();
    onChange(next);
    seek(next[which]);
  }

  const at = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    return box ? clamp((clientX - box.left) / box.width, 0, 1) * duration : 0;
  };

  const handle = (which: 'start' | 'end') => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (!disabled) e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: PointerEvent<HTMLButtonElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) move(which, at(e.clientX));
    },
    onPointerUp: (e: PointerEvent<HTMLButtonElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      e.currentTarget.releasePointerCapture(e.pointerId);
      // Back to the first frame, which is the one that matters.
      if (which === 'end') seek(start);
    },
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      move(which, trim[which] + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.5 : NUDGE));
    },
  });

  const pct = (t: number) => `${duration ? (t / duration) * 100 : 0}%`;
  const seconds = clipSeconds(start, end, speed);
  const outOfRange = seconds > MAX_CLIP_SECONDS || seconds < MIN_CLIP_SECONDS;
  const HANDLE = 'absolute top-0 z-10 h-full w-2.5 cursor-ew-resize touch-none bg-emerald-400 outline-none focus-visible:bg-white';

  return (
    <div className="grid gap-3">
      <div className="relative overflow-hidden rounded-md border border-zinc-800 bg-black">
        <video
          ref={video}
          src={url}
          playsInline
          preload="auto"
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) onLoaded(d);
            else onUnreadable();
          }}
          onError={onUnreadable}
          className="max-h-[38vh] w-full cursor-pointer object-contain"
        />
        {duration > 0 && !playing && (
          <button
            type="button"
            onClick={toggle}
            aria-label="Play the trimmed clip"
            className="absolute left-1/2 top-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20 7 4" /></svg>
          </button>
        )}
      </div>

      {duration > 0 && (
        <>
          <div className="grid gap-1.5">
            {/* The padding is where the two handles sit when the trim is the whole video. */}
            <div className="rounded bg-zinc-900 px-2.5">
              <div
                ref={track}
                onPointerDown={(e) => seek(clamp(at(e.clientX), start, end))}
                className="relative h-9 cursor-pointer"
              >
                <div
                  className="absolute top-0 h-full border-y-2 border-emerald-400 bg-emerald-400/15"
                  style={{ left: pct(start), width: pct(end - start) }}
                />
                <div className="pointer-events-none absolute top-0 h-full w-0.5 bg-white" style={{ left: pct(clamp(time, start, end)) }} />
                <button type="button" aria-label="Trim the start" disabled={disabled} {...handle('start')} className={`${HANDLE} -translate-x-full rounded-l`} style={{ left: pct(start) }} />
                <button type="button" aria-label="Trim the end" disabled={disabled} {...handle('end')} className={`${HANDLE} rounded-r`} style={{ left: pct(end) }} />
              </div>
            </div>
            <div className="flex justify-between text-[11px] tabular-nums text-zinc-500">
              <span>starts {clock(start)}</span>
              <span>ends {clock(end)}</span>
            </div>
          </div>

          <label className={`grid gap-1.5 ${LABEL}`}>
            Speed
            <span className="flex items-center gap-3">
              <input
                type="range"
                min={MIN_SPEED}
                max={MAX_SPEED}
                step={0.05}
                value={speed}
                disabled={disabled}
                onChange={(e) => onChange({ ...trim, speed: Number(e.target.value) })}
                className="w-full cursor-pointer accent-emerald-500"
              />
              <span className="w-12 text-right text-xs normal-case tabular-nums tracking-normal text-zinc-300">{speed.toFixed(2)}×</span>
            </span>
          </label>

          <p className={`text-xs tabular-nums ${outOfRange ? 'text-red-400' : 'text-zinc-500'}`}>
            The clip runs {seconds.toFixed(1)}s
            {seconds > MAX_CLIP_SECONDS && ` — Kling takes up to ${MAX_CLIP_SECONDS}s. Trim it or speed it up.`}
            {seconds < MIN_CLIP_SECONDS && ` — Kling needs at least ${MIN_CLIP_SECONDS}s.`}
            {!outOfRange && '. The first frame is where the trim starts.'}
          </p>
        </>
      )}
    </div>
  );
}
