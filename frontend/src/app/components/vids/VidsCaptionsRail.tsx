'use client';

// The captions column — the middle of the build page's three rails, between
// the one holding placement and sound and the one the build leaves by (the
// post caption, Phonedeck and Export — VidsExportRail).
//
// Write captions drafts them from the persona's context and each bottom clip's
// marks; everything it produces is editable by hand afterwards, since the model
// is a first draft and you are the one who knows what the clip actually shows.
// Each line carries the moment it comes up and a one-line toggle, and the four
// style presets set how all of them look.
//
// Where a caption sits is set on the stage rather than here — drag it — so a
// line that has been moved shows a ⤾ to put it back where its section starts.
//
// Typing "@" in any caption line brings the emoji picker up under it, the same
// as the media caption box — see CaptionInput.

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useEmojiField } from '../EmojiPicker';
import {
  CAPTION_STYLES, type Caption, type CaptionGroup, type CaptionLine, type CaptionLines,
  type CaptionRef, type CaptionWindows, type LaidOutCaptions,
} from '@/lib/vidsCaptions';
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-zinc-800 px-3 py-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{title}</p>
      {children}
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
function CaptionRows({ label, hint, group, laid, lines, moments = [], onChange, onResetPos }: {
  label: string;
  hint: string;
  group: CaptionGroup;
  laid: Caption[];
  lines: CaptionLine[];
  /** The clip's marks, in the order the lines are in — empty when unmarked. */
  moments?: string[];
  onChange: (i: number, patch: Partial<CaptionLine>) => void;
  onResetPos: (ref: CaptionRef) => void;
}) {
  if (!lines.length || (!moments.length && !lines.some((l) => l.text.trim()))) return null;
  return (
    <div>
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-400">{label}</span>
        <span className="truncate text-[9px] text-zinc-600">{hint}</span>
      </div>
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
              <button
                onClick={() => onChange(i, { oneLine: !l.oneLine })}
                title={l.oneLine
                  ? 'Back to normal size — it wraps onto as many lines as it needs'
                  : 'Shrink the type until this whole caption fits across in one line'}
                className={`shrink-0 rounded border px-1 py-1 text-[9px] leading-none transition-colors ${
                  l.oneLine
                    ? 'border-sky-500 bg-sky-500/20 text-sky-200'
                    : 'border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
                }`}
              >
                1 line
              </button>
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
  onWrite: () => void;
  onClear: () => void;
  notes: string;
  setNotes: (v: string) => void;
  /** Let the writer put a couple of emoji in, where one actually lands. */
  emojis: boolean;
  setEmojis: (on: boolean) => void;
  styleId: string;
  setStyleId: (id: string) => void;
  /** Forget where a line was dragged to on the stage. */
  onResetPos: (ref: CaptionRef) => void;
}

export function VidsCaptionsRail({
  canCaption, lines, setLines, laid, windows, hasLines, writing, error,
  onWrite, onClear, notes, setNotes, emojis, setEmojis, styleId, setStyleId, onResetPos,
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
    <aside className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-l border-zinc-800">
      <Section title="Captions">
        {!canCaption ? (
          <p className="text-[10px] leading-relaxed text-zinc-600">
            Fill Start, a bottom clip or End first — those are the windows captions go over.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <button
                onClick={onWrite}
                disabled={writing}
                className="flex items-center gap-1.5 rounded bg-white px-2.5 py-1 text-[11px] font-medium text-black hover:bg-zinc-200 disabled:opacity-40"
              >
                {writing && <SpinnerIcon size={11} className="animate-spin" />}
                {writing ? 'Writing…' : hasLines ? 'Rewrite' : 'Write captions'}
              </button>
              {hasLines && !writing && (
                <button onClick={onClear} className="text-[10px] text-zinc-500 hover:text-white">Clear</button>
              )}
              <span className="flex-1" />
              {/* Applied when the words are written, so it reads as part of the
                  brief rather than something that edits what is already there. */}
              <button
                onClick={() => setEmojis(!emojis)}
                title={emojis
                  ? 'Two or three emoji across the whole set, picked from the ones pinned in the Emojis drawer, only where one lands. Applied on the next write.'
                  : 'No emoji at all. Applied on the next write.'}
                className={`shrink-0 rounded border px-1.5 py-1 text-[10px] leading-none transition-colors ${
                  emojis
                    ? 'border-sky-500 bg-sky-500/20 text-sky-200'
                    : 'border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
                }`}
              >
                Emojis
              </button>
            </div>

            <div className="mt-1.5">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                // Typing a note and pressing Enter is one gesture — say the
                // change and get it. Shift keeps the newline, for a note that
                // wants more than one line.
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.shiftKey || writing) return;
                  e.preventDefault();
                  onWrite();
                }}
                rows={2}
                maxLength={500}
                placeholder="less funny · be more specific · shorter"
                title="Anything you want changed about how these are written. Enter rewrites with it; Shift+Enter starts a new line. Kept for the next rewrite."
                className="w-full resize-none rounded border border-zinc-800 bg-black px-1.5 py-1 text-[10px] leading-relaxed text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-500"
              />
            </div>

            {error && <p className="mt-1.5 break-words text-[10px] text-red-400">{error}</p>}

            {hasLines && (
              <div className="mt-2 space-y-2">
                <CaptionRows
                  label="Start"
                  hint="the hook · sits up top"
                  group="start"
                  laid={laid.start}
                  lines={[lines.start]}
                  onChange={(_i, patch) => setLines((l) => ({ ...l, start: { ...l.start, ...patch } }))}
                  onResetPos={onResetPos}
                />
                <CaptionRows
                  label="Bottom A"
                  hint={placedA ? 'two lines, timed by the writer' : 'over the first recording'}
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
                  label="Bottom B"
                  hint="over the second"
                  group="bottomB"
                  laid={laid.bottomB}
                  lines={lines.bottomB}
                  moments={momentsOf(windows.bottomB)}
                  onChange={patchLine('bottomB')}
                  onResetPos={onResetPos}
                />
                <CaptionRows
                  label="End · money"
                  hint="he made it · first half of End"
                  group="payoff"
                  laid={laid.payoff}
                  lines={[lines.payoff]}
                  onChange={(_i, patch) => setLines((l) => ({ ...l, payoff: { ...l.payoff, ...patch } }))}
                  onResetPos={onResetPos}
                />
                <CaptionRows
                  label="End · comment"
                  hint="comment “…” for the link · second half"
                  group="end"
                  laid={laid.end}
                  lines={[lines.end]}
                  onChange={(_i, patch) => setLines((l) => ({ ...l, end: { ...l.end, ...patch } }))}
                  onResetPos={onResetPos}
                />
              </div>
            )}
          </>
        )}
      </Section>

      <Section title="Style">
        <div className="grid grid-cols-2 gap-1.5">
          {CAPTION_STYLES.map((s) => (
            <button
              key={s.id}
              onClick={() => setStyleId(s.id)}
              title={s.note}
              className={`rounded border px-2 py-1.5 text-left transition-colors ${
                styleId === s.id
                  ? 'border-zinc-300 bg-zinc-200 text-black'
                  : 'border-zinc-800 text-zinc-300 hover:border-zinc-600'
              }`}
            >
              <span
                className="block truncate text-[11px]"
                style={{
                  fontFamily: s.family,
                  fontWeight: s.weight,
                  textTransform: s.letterCase === 'upper' ? 'uppercase' : s.letterCase === 'lower' ? 'lowercase' : 'none',
                }}
              >
                {s.label}
              </span>
              <span className={`block truncate text-[9px] ${styleId === s.id ? 'text-black/60' : 'text-zinc-600'}`}>
                {s.note}
              </span>
            </button>
          ))}
        </div>
      </Section>
    </aside>
  );
}
