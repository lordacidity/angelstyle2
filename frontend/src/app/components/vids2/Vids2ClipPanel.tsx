'use client';

// Vids2ClipPanel — the clipper page's Caption card and the preview beside it.
//
// pauv.io/clipping is one screen: the cards (who, the intro, which way, the
// persona, the caption), the preview, and one button that makes, renders and
// saves the video. The caption is the last card of the form (Vids2ClipCaption
// is its insides); the preview (Vids2ClipPreview) stands to the right of the
// cards from md up and under them, at the very foot, on a phone. There is no tuning page there, so what the tuning page let a clipper
// settle about the opening is settled here, before anything is made:
//
//   Preview   the persona's Start clip, halfway through, with the Start
//             caption on it, drawn by the very calls the stage and the export
//             use (drawPlanItem, drawCaption) off a plan of that one clip — so
//             where the words sit, how they break and how big they come out
//             is what the file will have.
//             Once a Download lands, the finished MP4 plays here instead,
//             straight away, until something about the next one is changed.
//   Caption   the Start caption, written the moment there is a person, a way
//             and a persona to write it from (Vids2Section), and a box to
//             change it in — greyed and locked while one is being written.
//             Rewrite asks for another. Typing "@" in the box
//             brings the emoji picker up, as on the Studio's captions rail.
//   Look      the look the words are drawn in: rolled, and a press to change.
//
// Neither holds anything of its own but the picture: the words and the look are the
// section's, which hands them to the build when the button is pressed
// (Vids2Build.preset).

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useEmojiField } from '@/app/components/simpler/EmojiPicker';
import { useCachedClipSrcs } from '@/app/hooks/useCachedClipSrcs';
import { withBase } from '@/lib/clipping';
import { SpinnerIcon } from '@/lib/icons';
import {
  EMPTY_LINES, buildCaptions, capLine, captionStyle, captionWindows, drawCaption, preloadCaptionEmoji,
  type CaptionStyle,
} from '@/lib/simpler/vidsCaptions';
import { buildPlan, drawPlanItem, freshPick, smoothScaling } from '@/lib/simpler/vidsPlan';
import { isPhoto, type VidRow } from '@/lib/vids-types';
import { VIDS2_BARS, VIDS2_PACE } from '@/lib/vids2/vids2Words';

/** The frame every video goes out at, which is what the words are laid out
 *  against; the canvas is a downscale of it. */
const OUT_W = 1080;
const OUT_H = 1920;
/** Canvas pixels per output pixel: sharp at the size the preview is shown. */
const SCALE = 0.5;

interface PreviewProps {
  /** The persona's Start clip, or null until one is chosen. */
  start: VidRow | null;
  /** The Start caption as it stands. */
  text: string;
  styleId: string;
  /** The video just made, to play in place of the still — see below. */
  made: File | null;
}

interface CaptionProps {
  /** The Start caption as it stands. */
  text: string;
  onText: (text: string) => void;
  /** One is being written. */
  writing: boolean;
  error: string | null;
  /** Ask for another — null while there is nothing to write one from. */
  onRewrite: (() => void) | null;
  looks: readonly CaptionStyle[];
  styleId: string;
  onStyle: (id: string) => void;
}

export function Vids2ClipPreview({ start, text, styleId, made }: PreviewProps) {
  // ── The video just made ──
  // The moment a Download lands, the finished MP4 plays here in place of the
  // still — the file itself, so what is watched is what was saved. It stays
  // until the persona or the caption is changed (the still is about the next
  // video then), another Download starts, or it is sent away by hand.
  // Worked out as the props change rather than in an effect: what is playing
  // follows from them.
  const [seen, setSeen] = useState({ made, start, text, playing: made });
  if (seen.made !== made) setSeen({ made, start, text, playing: made });
  else if (seen.start !== start || seen.text !== text) setSeen({ made, start, text, playing: null });
  const playing = seen.playing;
  const setPlaying = (file: File | null) => setSeen((prev) => ({ ...prev, playing: file }));
  const madeUrl = useMemo(() => (playing ? URL.createObjectURL(playing) : null), [playing]);
  useEffect(() => () => { if (madeUrl) URL.revokeObjectURL(madeUrl); }, [madeUrl]);
  const playerRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = playerRef.current;
    if (!v || !madeUrl) return;
    v.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    // With its sound where the browser allows that — the press that started
    // the render is a minute old, and most will only start a silent video by
    // themselves. Then it plays muted, and the controls have the sound.
    v.muted = false;
    v.play().catch(() => { v.muted = true; void v.play().catch(() => { /* a press on the controls will */ }); });
  }, [madeUrl]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  /** The clip's length as the browser measured it, for a clip the library has
   *  no length for — without one the plan has no Start to place. */
  const [measured, setMeasured] = useState<Record<string, number>>({});
  /** Bumped when a frame or an emoji image arrives, to paint again. */
  const [tick, setTick] = useState(0);
  const repaint = useCallback(() => setTick((n) => n + 1), []);

  const photo = !!start && isPhoto(start);
  const [src] = useCachedClipSrcs([start && !photo ? withBase(start.url) : null]);

  // Start alone, placed the way every build places it. The nudge a build
  // rolls (rollStartNudge) is a few pixels and is not shown.
  const plan = useMemo(
    () => (start ? buildPlan({ start: freshPick('start', start) }, measured, VIDS2_BARS, VIDS2_PACE) : null),
    [start, measured],
  );
  const item = plan?.items.find((i) => i.slot === 'start') ?? null;
  const style = useMemo(() => captionStyle(styleId), [styleId]);
  // Two lines, as the hook always is here (CaptionLine.twoLines).
  const caption = useMemo(() => {
    if (!plan || !text.trim()) return null;
    const laid = buildCaptions(captionWindows(plan), { ...EMPTY_LINES, start: { ...capLine(text.trim()), twoLines: true } });
    return laid.all[0] ?? null;
  }, [plan, text]);

  useEffect(() => {
    if (!caption) return;
    let live = true;
    void preloadCaptionEmoji([caption]).then(() => { if (live) repaint(); });
    return () => { live = false; };
  }, [caption, repaint]);

  // The frame shown is the one halfway through Start — the opening frame is
  // often him still settling in, and the middle is what the clip looks like.
  // The element is put there as soon as its length is known, and again if the
  // plan's idea of the clip changes.
  const half = item ? item.trimStart + item.sourceLength / 2 : null;
  const seekHalf = useCallback(() => {
    const v = videoRef.current;
    if (!v || half == null || v.readyState < 1) return;
    if (Math.abs(v.currentTime - half) > 0.05) v.currentTime = half;
  }, [half]);
  useEffect(() => { seekHalf(); }, [seekHalf, src]);

  // That frame once the browser has it, and until then (or on a phone that
  // will not load a frame it has not been asked to play) the still the
  // library keeps of the clip.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    smoothScaling(ctx);
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, OUT_W, OUT_H);
    if (!plan || !item) return;
    const v = videoRef.current;
    const img = imgRef.current;
    if (v && v.readyState >= 2 && v.videoWidth > 0 && !v.seeking) {
      drawPlanItem(ctx, v, v.videoWidth, v.videoHeight, item, OUT_W, OUT_H, plan.bars);
    } else if (img?.complete && img.naturalWidth > 0) {
      drawPlanItem(ctx, img, img.naturalWidth, img.naturalHeight, item, OUT_W, OUT_H, plan.bars);
    }
    if (caption) drawCaption(ctx, caption, OUT_W, OUT_H, style, plan.bars);
  }, [plan, item, caption, style, tick]);

  const still = start ? (photo ? withBase(start.url) : start.thumbUrl ?? null) : null;

  return (
      <div className="relative mx-auto w-full max-w-[280px] overflow-hidden rounded-2xl border border-zinc-800 bg-black">
        <canvas
          ref={canvasRef}
          width={OUT_W * SCALE}
          height={OUT_H * SCALE}
          className="block aspect-[9/16] w-full"
        />
        {madeUrl && (
          <>
            <video
              key={madeUrl}
              ref={playerRef}
              src={madeUrl}
              controls
              loop
              playsInline
              className="absolute inset-0 h-full w-full bg-black object-contain"
            />
            <button
              type="button"
              onClick={() => setPlaying(null)}
              title="Back to the preview of the next one"
              className="absolute right-2 top-2 rounded-md bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-zinc-200 backdrop-blur hover:text-white"
            >
              ✕ Preview
            </button>
          </>
        )}
        {!start && !madeUrl && (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-[13px] text-zinc-600">
            Choose a persona to see how it opens
          </p>
        )}
        {/* What the canvas samples from. Never shown, never played. */}
        {start && !photo && (
          <video
            key={start.id}
            ref={videoRef}
            src={src ?? undefined}
            muted
            playsInline
            preload="auto"
            onLoadedMetadata={(e) => {
              const d = Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0;
              if (d > 0) setMeasured((prev) => (prev[start.id] === d ? prev : { ...prev, [start.id]: d }));
              seekHalf();
            }}
            onLoadedData={() => { seekHalf(); repaint(); }}
            onSeeked={repaint}
            className="pointer-events-none absolute h-px w-px opacity-0"
            aria-hidden
          />
        )}
        {still && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={still}
            ref={imgRef}
            src={still}
            alt=""
            onLoad={repaint}
            className="pointer-events-none absolute h-px w-px opacity-0"
            aria-hidden
          />
        )}
      </div>
  );
}

/** The Caption card's insides: the Start caption to retype, Rewrite, and the
 *  look it is drawn in. */
export function Vids2ClipCaption({ text, onText, writing, error, onRewrite, looks, styleId, onStyle }: CaptionProps) {
  // "@" for an emoji, the way the Studio's caption lines have it (see
  // CaptionInput in VidsCaptionsRail): the picker comes up under the box, and
  // one put away with Escape stays away until the words change.
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const { detect, close, active, picker } = useEmojiField(boxRef, onText);
  const escaped = useRef<string | null>(null);
  const look = () => {
    if (escaped.current !== null && boxRef.current?.value === escaped.current) return;
    escaped.current = null;
    detect();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape' && active) {
      e.preventDefault();
      escaped.current = boxRef.current?.value ?? '';
      close();
    }
  };
  return (
    <div>
      <div>
        <div className="mb-1.5 flex items-center gap-2">
          <p className="flex-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Start caption <span className="font-normal normal-case tracking-normal text-zinc-600">— edit it if you want</span>
          </p>
          {writing && <SpinnerIcon size={12} className="animate-spin text-zinc-500" />}
          <button
            type="button"
            onClick={() => onRewrite?.()}
            disabled={!onRewrite || writing}
            title="Write another"
            className="text-xs font-semibold text-zinc-400 transition-colors hover:text-white disabled:cursor-not-allowed disabled:text-zinc-700"
          >
            ↻ Rewrite
          </button>
        </div>
        <textarea
          ref={boxRef}
          value={text}
          onChange={(e) => { onText(e.target.value); look(); }}
          onKeyUp={look}
          onClick={look}
          onKeyDown={onKeyDown}
          // Not to be typed in while one is on its way: what was typed would
          // be written over when it lands. Greyed so that is plain to see.
          disabled={writing}
          rows={3}
          placeholder={writing ? 'Writing one…' : 'Type one, or press Rewrite'}
          className="w-full resize-none rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500 disabled:cursor-not-allowed disabled:border-zinc-900 disabled:bg-zinc-900/60 disabled:text-zinc-600"
        />
        {picker}
        {error && <p className="mt-1 text-xs text-red-400">Couldn&rsquo;t write one: {error}</p>}
      </div>

      {looks.length > 1 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">Caption look</p>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(looks.length, 3)}, minmax(0, 1fr))` }}>
            {looks.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onStyle(s.id)}
                title={s.note}
                className={`h-9 rounded-lg border text-[13px] font-semibold transition-colors ${
                  s.id === styleId
                    ? 'border-zinc-300 bg-white/10 text-white'
                    : 'border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
