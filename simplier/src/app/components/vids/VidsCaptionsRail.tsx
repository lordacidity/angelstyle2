'use client';

// The captions — two sections of the builder's one sidebar, below Sound and
// above the post caption. Not a rail of its own: it renders straight into the
// sidebar the builder owns.
//
// The words write themselves — the builder asks for them as soon as the bottom
// is made, from the persona's context and each bottom clip's marks. There is no
// button for it here: what this shows is the result, line by line beside the
// moment it comes up, editable by hand, since the model is a first draft and
// you are the one who knows what the clip actually shows. The style dropdown
// under them sets how all of them look, and the slider under it how big they
// are drawn — a multiple of the look's own size, so it means the same thing
// whichever look is on.
//
// Where a caption sits is set on the stage rather than here — drag it — so a
// line that has been moved shows a ⤾ to put it back where its section starts.
//
// Typing "@" in any caption line brings the emoji picker up under it, the same
// as the media caption box — see CaptionInput.

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { useEmojiField } from '../EmojiPicker';
import {
  CAPTION_SCALE_STEP, CAPTION_STYLES, MAX_CAPTION_SCALE, MIN_CAPTION_SCALE, clampCaptionScale,
  type Caption, type CaptionGroup, type CaptionLine, type CaptionLines,
  type CaptionRef, type CaptionWindows, type LaidOutCaptions,
} from '@/lib/vidsCaptions';
import { emojiSrcForChar } from '@/lib/emoji';
import { fmtTime } from '@/lib/utils';
import { SpinnerIcon } from '@/lib/icons';

/** One caption's words. Typing "@" pulls the emoji picker up under the line —
 *  the same gesture as the media caption box and the board's cells, and the
 *  same picker, so what comes up first is whatever is pinned in the Emojis
 *  drawer: the set the model is handed to write from, now the set you reach for
 *  by hand as well. A line is its own field, so the hook is wired here rather
 *  than in the row that lists them. */
function CaptionInput({ value, onChange, placeholder, title, className }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  title: string;
  className: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const { detect, close, active, picker } = useEmojiField(ref, onChange);
  /** The line as it read when Escape was pressed. Closing on the key DOWN is
   *  not enough on its own: the key UP that follows re-runs detect over an
   *  "@word" that is still sitting there, and the picker comes straight back.
   *  So it stays shut until the words actually change — moving the caret about
   *  in a line you have dismissed leaves it shut too. */
  const escaped = useRef<string | null>(null);
  const look = () => {
    if (escaped.current !== null && ref.current?.value === escaped.current) return;
    escaped.current = null;
    detect();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Escape puts the picker away and leaves the "@word" as typed, rather than
    // falling through to whatever else Escape does on this page.
    if (e.key === 'Escape' && active) {
      e.preventDefault();
      escaped.current = ref.current?.value ?? '';
      close();
    }
  };
  return (
    <>
      <input
        ref={ref}
        value={value}
        onChange={(e) => { onChange(e.target.value); look(); }}
        onKeyUp={look}
        onClick={look}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        title={title}
        className={className}
      />
      {picker}
    </>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-b border-zinc-800 px-3 py-3">
      <div className="mb-2 flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

/** What the rotating hint cycles through. A handful of the ones these captions
 *  actually reach for, rather than the whole set — the point is to say that
 *  emoji are a keystroke away, not to offer a menu. */
const HINT_EMOJI = ['🔥', '😂', '💀', '📈', '📉', '🤑', '👀', '🚀', '💰', '😳'];
const HINT_MS = 2000;

/** "@ for emojis", top right of the captions — with one of them beside it,
 *  swapping every couple of seconds so the hint catches the eye once without
 *  ever asking to be read twice. Drawn from the app's own Apple images, the
 *  same ones the captions are drawn with, so it looks like what you'd get.
 *
 *  It starts on the first of the set rather than a random one: the server
 *  renders this too, and the two have to agree on the first paint. */
function EmojiHint() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = window.setInterval(
      // Never the one already up — a "change" that changes nothing reads as a
      // stuck page.
      () => setI((prev) => (prev + 1 + Math.floor(Math.random() * (HINT_EMOJI.length - 1))) % HINT_EMOJI.length),
      HINT_MS,
    );
    return () => window.clearInterval(t);
  }, []);
  const char = HINT_EMOJI[i];
  const src = emojiSrcForChar(char);
  return (
    <span className="flex shrink-0 items-center gap-1 text-[9px] text-zinc-500" title="Type @ in any line to pick an emoji">
      <span className="font-mono text-zinc-400">@</span> for emojis
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={char} className="h-3.5 w-3.5" draggable={false} />
      ) : (
        <span className="text-[11px] leading-none">{char}</span>
      )}
    </span>
  );
}

/** A style's name drawn the way that style draws a caption: its family,
 *  weight and casing, but also its colour, its outline, its drop shadow, its
 *  letter spacing and its size relative to the others. A preset differs from
 *  its neighbours in those as much as in the font — all three are Inter —
 *  so a preview that showed only the family showed nothing.
 *
 *  Sizes on a style are a share of the frame width; PREVIEW_PX turns that
 *  share into type big enough to read in a dropdown, keeping the proportions
 *  between the presets. */
const PREVIEW_PX = 260;
const styleFont = (s: (typeof CAPTION_STYLES)[number]): CSSProperties => {
  const px = s.size * PREVIEW_PX;
  return {
    fontFamily: s.family,
    fontWeight: s.weight,
    fontSize: `${px}px`,
    lineHeight: 1.35,
    color: s.color,
    letterSpacing: `${s.tracking}em`,
    textTransform: s.letterCase === 'upper' ? 'uppercase' : s.letterCase === 'lower' ? 'lowercase' : 'none',
    // The black outline, drawn under the fill the way the canvas draws it
    // rather than over it, so the letters keep their shape.
    ...(s.stroke ? { WebkitTextStroke: `${(s.stroke * px).toFixed(2)}px #000`, paintOrder: 'stroke fill' } : {}),
    textShadow: s.shadow ? `0 ${(px * 0.06).toFixed(1)}px ${(s.shadow * PREVIEW_PX).toFixed(1)}px rgba(0,0,0,0.85)` : undefined,
  };
};

/** The look the captions are drawn in, as a dropdown of names — each one
 *  written the way it would be on the video. A native <select> paints its
 *  options in the system font whatever you ask of them, which is the whole
 *  point of showing them, so this is a button and a list.
 *
 *  Every row keeps a dark background, selected or not: these are colours meant
 *  for a video, and white on a light highlight would be a blank row. The tick
 *  says which one is on. */
function StylePicker({ styleId, setStyleId }: { styleId: string; setStyleId: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = CAPTION_STYLES.find((s) => s.id === styleId) ?? CAPTION_STYLES[0];
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={current.note}
        className="flex w-full items-center gap-2 rounded border border-zinc-800 bg-black px-2 py-2 text-left transition-colors hover:border-zinc-600"
      >
        <span className="min-w-0 flex-1 truncate" style={styleFont(current)}>{current.label}</span>
        <span className={`shrink-0 text-[7px] leading-none text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>
      {open && (
        <>
          {/* Anywhere else puts it away, including the page behind it. */}
          <div className="fixed inset-0 z-40" onPointerDown={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded border border-zinc-700 bg-black shadow-xl">
            {CAPTION_STYLES.map((s) => (
              <button
                key={s.id}
                onClick={() => { setStyleId(s.id); setOpen(false); }}
                title={s.note}
                className={`flex w-full items-center gap-2 px-2 py-2 text-left transition-colors ${
                  s.id === styleId ? 'bg-zinc-900' : 'hover:bg-zinc-900/60'
                }`}
              >
                <span className="min-w-0 flex-1 truncate" style={styleFont(s)}>{s.label}</span>
                {s.id === styleId && <span className="shrink-0 text-[10px] text-emerald-400">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** One window's captions: each line beside the moment it comes up, editable by
 *  hand. A line the timeline has no room for is greyed rather than dropped from
 *  view — you can see it was written, and shorten an earlier one to make space
 *  or leave it out.
 *
 *  A marked clip shows a row per mark, so a mark left blank — Bottom B's first,
 *  when the seam was merged into A's last line — is still there, its words as
 *  the placeholder, for you to give a line of its own. */
function CaptionRows({ label, group, laid, lines, moments = [], always = false, onChange, onResetPos }: {
  label: string;
  group: CaptionGroup;
  laid: Caption[];
  lines: CaptionLine[];
  /** The clip's marks, in the order the lines are in — empty when unmarked. */
  moments?: string[];
  /** Show the row even with nothing written in it — for a window that has a
   *  place on the video whether or not the writer filled it, so a line left
   *  blank can still be typed by hand. */
  always?: boolean;
  onChange: (i: number, patch: Partial<CaptionLine>) => void;
  onResetPos: (ref: CaptionRef) => void;
}) {
  if (!lines.length || (!always && !moments.length && !lines.some((l) => l.text.trim()))) return null;
  return (
    <div>
      <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-400">{label}</p>
      <div className="space-y-1">
        {lines.map((l, i) => {
          // Matched by the line it was laid out from, not by position: a blank
          // or dropped line earlier in the list must not shift the times shown
          // against the ones that did make it on screen. A line split with
          // " / " is more than one caption from the one row.
          const parts = laid.filter((c) => c.ref.index === i);
          const at = parts[0];
          const span = (c: Caption) => `${c.start.toFixed(1)}s → ${c.end.toFixed(1)}s`;
          const moment = moments[i];
          const why = at
            ? parts.length > 1
              ? `${parts.length} captions, one after the other: ${parts.map(span).join(', ')}`
              : `on screen ${span(at)}`
            : moment
              ? `no line of its own at "${moment}" — the line before it stays up over this stretch. Type one here to give it its own`
              : 'no room left on this clip — it will not appear';
          return (
            <div key={i} className="flex items-center gap-1">
              <span className={`w-8 shrink-0 text-right font-mono text-[9px] ${at ? 'text-zinc-500' : 'text-zinc-700'}`}>
                {at ? fmtTime(at.start) : '—'}
              </span>
              <CaptionInput
                value={l.text}
                onChange={(text) => onChange(i, { text })}
                placeholder={moment ? `(${moment})` : undefined}
                title={`${why}. Type @ for an emoji.`}
                className={`min-w-0 flex-1 rounded border bg-black px-1.5 py-1 text-[10px] outline-none placeholder:text-zinc-700 focus:border-zinc-500 ${
                  at ? 'border-zinc-800 text-zinc-100' : 'border-zinc-900 text-zinc-600'
                }`}
              />
              {l.pos && (
                <button
                  onClick={() => onResetPos({ group, index: i })}
                  title="Put this caption back where its section starts — it has been dragged"
                  className="shrink-0 rounded border border-violet-800 px-1 py-1 text-[9px] leading-none text-violet-300 hover:border-violet-600 hover:text-violet-200"
                >
                  ⤾
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface Props {
  /** Nothing to caption until Start or a bottom clip is filled. */
  canCaption: boolean;
  lines: CaptionLines;
  setLines: (update: (prev: CaptionLines) => CaptionLines) => void;
  laid: LaidOutCaptions;
  /** The captionable stretches — for the marks on each bottom clip. */
  windows: CaptionWindows;
  hasLines: boolean;
  writing: boolean;
  error: string | null;
  styleId: string;
  setStyleId: (id: string) => void;
  /** How big the words are drawn, as a multiple of the size the look asks for
   *  — see scaleCaptionStyle. */
  size: number;
  setSize: (v: number) => void;
  /** Write the whole set again from the clips — the button beside the title. */
  onRewrite: () => void;
  /** There is something to write from, and nothing else going on. */
  canRewrite: boolean;
  /** Forget where a line was dragged to on the stage. */
  onResetPos: (ref: CaptionRef) => void;
  /** Somebody typed the hook themselves. From then on it is theirs and the
   *  writer leaves it alone — see the builder's `startTouched`. */
  onStartTyped: () => void;
}

export function VidsCaptionsRail({
  canCaption, lines, setLines, laid, windows, hasLines, writing, error,
  styleId, setStyleId, size, setSize, onRewrite, canRewrite, onResetPos, onStartTyped,
}: Props) {
  const momentsOf = (w: CaptionWindows['bottomA']) => (w?.marks ?? []).map((m) => m.text);
  // Bottom A on Fast: two lines the writer put where it chose, not one per mark.
  const placedA = lines.bottomA.some((l) => l.at != null);
  const patchLine = (
    group: 'bottomA' | 'bottomB',
  ) => (i: number, patch: Partial<CaptionLine>) => setLines((l) => ({
    ...l,
    [group]: l[group].map((x, n) => (n === i ? { ...x, ...patch } : x)),
  }));

  return (
    <>
      <Section
        title="Captions"
        action={canCaption ? (
          <>
            <EmojiHint />
            {/* The words write themselves once, when the bottom lands. This is
                for when what came back isn't it: the same call again, a fresh
                set from the same clips. Where a line has been dragged to is
                kept — that is about the caption's place, not its words — and
                so is a hook typed by hand, which is nobody's to overwrite. */}
            <button
              onClick={onRewrite}
              disabled={!canRewrite}
              title="Write them all again from the clips. A hook you typed yourself is kept."
              className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white disabled:border-zinc-900 disabled:text-zinc-700 disabled:hover:border-zinc-900 disabled:hover:text-zinc-700"
            >
              {writing ? 'Writing…' : 'Rewrite'}
            </button>
          </>
        ) : undefined}
      >
        {!canCaption ? (
          <p className="text-[10px] leading-relaxed text-zinc-600">
            Choose a persona first — the hook goes over its opening clip.
          </p>
        ) : (
          <>
            {error && <p className="break-words text-[10px] text-red-400">{error}</p>}

            {/* The hook is here from the moment there is a Start clip to put
                it over — before the rest of the words exist, and while the
                bottom is still rendering. Type one and it is yours: the writer
                fills in around it and leaves it alone. */}
            <div className="space-y-2">
              <CaptionRows
                label="Start"
                group="start"
                laid={laid.start}
                lines={[lines.start]}
                always={!!windows.start}
                onChange={(_i, patch) => {
                  if (patch.text !== undefined) onStartTyped();
                  setLines((l) => ({ ...l, start: { ...l.start, ...patch } }));
                }}
                onResetPos={onResetPos}
              />
              {/* Under the hook, not over it: the hook is already there to be
                  typed, and the rest of the words are what is being waited
                  for — so the waiting sits where they will appear. */}
              {writing && (
                <p className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                  <SpinnerIcon size={11} className="animate-spin" /> Writing them…
                </p>
              )}
              {hasLines && (
                <>
                <CaptionRows
                  label="ChatGPT"
                  group="bottomA"
                  laid={laid.bottomA}
                  lines={lines.bottomA}
                  // Placed lines go where the writer put them, not one per
                  // mark, so the marks are not theirs to show.
                  moments={placedA ? [] : momentsOf(windows.bottomA)}
                  onChange={patchLine('bottomA')}
                  onResetPos={onResetPos}
                />
                <CaptionRows
                  label="Trading"
                  group="bottomB"
                  laid={laid.bottomB}
                  lines={lines.bottomB}
                  moments={momentsOf(windows.bottomB)}
                  onChange={patchLine('bottomB')}
                  onResetPos={onResetPos}
                />
                <CaptionRows
                  label="Ending"
                  group="end"
                  laid={laid.end}
                  lines={[lines.end]}
                  onChange={(_i, patch) => setLines((l) => ({ ...l, end: { ...l.end, ...patch } }))}
                  onResetPos={onResetPos}
                />
                </>
              )}
            </div>
          </>
        )}
      </Section>

      <Section title="Caption style">
        <StylePicker styleId={styleId} setStyleId={setStyleId} />
        {/* How big the words are drawn, either side of the size the look asks
            for — 100% is the look as it comes. The stage shows it as it moves,
            and it is what the file is written with. */}
        <div className="mt-2 flex items-center gap-2">
          <span className="w-8 shrink-0 text-[11px] text-zinc-300">Size</span>
          <input
            type="range"
            min={MIN_CAPTION_SCALE}
            max={MAX_CAPTION_SCALE}
            step={CAPTION_SCALE_STEP}
            value={size}
            onChange={(e) => setSize(clampCaptionScale(Number(e.target.value)))}
            title="How big the captions are drawn"
            className="h-1.5 flex-1"
            style={{
              '--fill': `${((size - MIN_CAPTION_SCALE) / (MAX_CAPTION_SCALE - MIN_CAPTION_SCALE)) * 100}%`,
            } as CSSProperties}
          />
          <span className="w-10 text-right font-mono text-[10px] text-zinc-400">{Math.round(size * 100)}%</span>
        </div>
      </Section>
    </>
  );
}
