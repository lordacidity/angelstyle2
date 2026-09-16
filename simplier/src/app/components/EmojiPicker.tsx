'use client';

// Shared "@"-triggered emoji picker + field wiring. Used by the media caption box
// (CanvasGrid) and the Shared Board text cells (BoardGrid), so typing "@" in
// either surface opens the same Apple-glyph picker and inserts the chosen char.
//
// The picker floats in a portal anchored under the field; pinned emoji (😂 🔥)
// sort to the front; the search box filters by name/keyword. Picking calls
// onPick with the literal unicode char. See ../../lib/emoji for the glyph set.

import type { RefObject } from 'react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EMOJIS, emojiSrc, emojiByUnified, type EmojiDef } from '@/lib/emoji';
import { useEmojiPrefs, aliasOf, isPinned, pinnedUnifieds, type EmojiPrefMap } from '@/lib/emoji-prefs-store';

// How many matches to render at once. The full set is ~1900 glyphs, so an
// unfiltered grid would be a huge DOM — typing narrows it, and an empty query
// just shows the pinned strip.
const MAX_RESULTS = 80;

// ── Where it floats ───────────────────────────────────────────────────────────
// Under the field it was typed in, and always wholly on the screen. The field
// is often in a rail against the right edge of the window, or near the foot of
// one, so the naive place — the field's own left, just below it — hangs half
// the picker off the side or off the bottom. So it is pushed back inside the
// window horizontally, and it opens upwards instead when there isn't the room
// under it. Whatever room it does get, it takes as its height and the grid
// scrolls inside that.

/** The picker is at least this wide, whatever the field is. */
const MIN_W = 300;
/** How tall it would like to be, given the room. */
const WANT_H = 300;
/** Between the picker and the field. */
const GAP = 4;
/** And between the picker and the edge of the window — never flush to it. */
const EDGE = 8;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Where to put a picker anchored to `r`, in fixed-position coordinates. It
 *  hangs from its top under the field and from its BOTTOM when it has flipped
 *  above one, so a short list still sits against the field instead of floating
 *  off the top of wherever a full one would have reached. */
function placePicker(r: DOMRect, vw: number, vh: number) {
  const width = Math.min(Math.max(r.width, MIN_W), Math.max(MIN_W, vw - 2 * EDGE));
  const left = clamp(r.left, EDGE, vw - width - EDGE);
  const under = vh - r.bottom - GAP - EDGE;
  const over = r.top - GAP - EDGE;
  // Upwards only when there is not the room below AND there is more above:
  // with both cramped it stays under the field and takes what it can get.
  const flip = under < Math.min(WANT_H, over);
  return {
    left,
    width,
    maxHeight: Math.max(0, flip ? over : under),
    ...(flip ? { bottom: vh - r.top + GAP } : { top: r.bottom + GAP }),
  };
}

// Resolve which emoji to show for the current query, honouring the user's custom
// "@" aliases and pins from Railway. Empty query → the pinned strip (falling back
// to a small default slice if nothing is pinned yet).
function resolveResults(prefs: EmojiPrefMap, query: string): EmojiDef[] {
  const q = query.trim().toLowerCase();
  const pins = pinnedUnifieds(prefs);

  if (!q) {
    const pinned = pins.map((u) => emojiByUnified(u)).filter(Boolean) as EmojiDef[];
    return pinned.length ? pinned : EMOJIS.slice(0, 40);
  }

  const pinSet = new Set(pins);
  const matches = EMOJIS.filter((e) => {
    const alias = aliasOf(prefs, e.unified);
    return e.name.toLowerCase().includes(q)
      || e.keywords.some((k) => k.includes(q))
      || (!!alias && alias.includes(q));
  });

  // Rank: exact custom alias first, then pinned, then alias / name prefixes.
  const score = (e: EmojiDef): number => {
    const alias = aliasOf(prefs, e.unified);
    if (alias && alias === q) return 0;
    if (pinSet.has(e.unified)) return 1;
    if (alias && alias.startsWith(q)) return 2;
    if (e.name.toLowerCase().startsWith(q)) return 3;
    return 4;
  };
  return matches.sort((a, b) => score(a) - score(b)).slice(0, MAX_RESULTS);
}

// Generic over the anchor element so a textarea ref (caption) OR an
// input-or-textarea ref (board cells) both fit — RefObject is invariant in
// @types/react 19, so a plain `HTMLElement` param wouldn't accept them.
export function EmojiPicker<T extends HTMLElement = HTMLElement>({
  anchorRef,
  query,
  onQueryChange,
  onPick,
  onClose,
}: {
  anchorRef: RefObject<T | null>;
  query: string;
  onQueryChange: (q: string) => void;
  onPick: (char: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /** The search box takes the keyboard the moment the picker opens, so "@"
   *  and then the word you are after is one movement with nothing to click.
   *  Once only — the picker re-measures itself on every scroll, and stealing
   *  focus each time would be a fight with whatever else is being typed. */
  const tookFocus = useRef(false);
  const { prefs } = useEmojiPrefs();
  // Track the anchor's position so the portal can sit just under it. Recompute
  // on scroll/resize so it stays anchored.
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const update = () => setRect(el.getBoundingClientRect());
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anchorRef]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current && !ref.current.contains(t) && anchorRef.current && !anchorRef.current.contains(t)) onClose();
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [onClose, anchorRef]);

  if (!rect || typeof document === 'undefined') return null;

  const results = resolveResults(prefs, query);

  // Rendered in a portal on document.body so no ancestor's `overflow-hidden`
  // clips it — it floats on top of everything.
  return createPortal(
    <div
      ref={ref}
      // A column, so the search box keeps its place and the grid is what
      // gives when the picker has to fit into a little space.
      className="fixed z-[1000] flex flex-col rounded-lg bg-zinc-900 border border-zinc-700 shadow-2xl overflow-hidden"
      style={placePicker(rect, window.innerWidth, window.innerHeight)}
    >
      <div className="shrink-0 p-2 border-b border-zinc-800">
        <input
          // preventScroll: the picker is already where it can be seen (see
          // placePicker), so nothing should jump to bring it into view.
          ref={(el) => { if (el && !tookFocus.current) { tookFocus.current = true; el.focus({ preventScroll: true }); } }}
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          // Enter takes the first one — the whole thing without the mouse —
          // and Escape puts the picker away and hands the line back, caret
          // where it was, rather than leaving the keyboard in a box that is
          // about to disappear.
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (results[0]) onPick(results[0].char);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onClose();
              anchorRef.current?.focus();
            }
          }}
          placeholder="Search emoji…"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500"
        />
      </div>
      {/* min-h-0 is what lets this shrink past its contents when the picker
          has been squeezed into what room there was; the search box above it
          does not give, so what is lost is grid, and the grid scrolls. */}
      <div className="min-h-0 p-2 max-h-[220px] overflow-y-auto">
        {results.length === 0 ? (
          <p className="text-xs text-zinc-600 text-center py-4">No emoji found.</p>
        ) : (
          <div className="grid grid-cols-8 gap-1">
            {results.map(e => (
              <button
                key={e.unified}
                type="button"
                title={e.name}
                onMouseDown={ev => ev.preventDefault()}
                onClick={() => onPick(e.char)}
                className="relative flex items-center justify-center rounded-md hover:bg-zinc-800 transition-colors"
                style={{ width: 34, height: 34 }}
              >
                {isPinned(prefs, e.unified) && <span className="absolute top-0.5 right-0.5 w-1 h-1 rounded-full bg-amber-400" />}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={emojiSrc(e.unified)} alt={e.name} width={24} height={24} draggable={false} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// useEmojiField — wires the "@word" trigger + insertion for one text field
// (input or textarea). Call detect() on every keystroke/caret move; render the
// returned `picker` right after the field. insert() replaces the "@query" with
// the chosen emoji and restores the caret after it. Mirrors the inline logic the
// media caption box used before this was factored out.
export function useEmojiField(
  ref: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  onChange: (value: string) => void,
): { detect: () => void; close: () => void; active: boolean; picker: ReactNode } {
  // `start` is the index of the triggering "@"; `query` is the text after it.
  const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null);
  /** The field as it read when the picker was last dismissed. An "@word" that
   *  somebody has already said no to does not bring the picker back every time
   *  the caret moves through it — only new typing does. */
  const dismissed = useRef<string | null>(null);

  /** Put it away, and remember the line as it stands so it stays away. */
  const dismiss = useCallback(() => {
    dismissed.current = ref.current?.value ?? '';
    setTrigger(null);
  }, [ref]);

  // The "@" must start the field or follow whitespace, so emails/@handles inside
  // a word don't trigger the picker.
  const detect = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (dismissed.current !== null && el.value === dismissed.current) return;
    dismissed.current = null;
    const caret = el.selectionStart ?? 0;
    const value = el.value;
    let i = caret - 1;
    while (i >= 0 && value[i] !== '@' && !/\s/.test(value[i])) i--;
    if (i < 0 || value[i] !== '@' || (i > 0 && !/\s/.test(value[i - 1]))) {
      setTrigger(null);
      return;
    }
    setTrigger({ start: i, query: value.slice(i + 1, caret) });
  }, [ref]);

  const insert = useCallback((char: string) => {
    const el = ref.current;
    if (!el) return;
    setTrigger(t => {
      if (!t) return null;
      const caret = el.selectionStart ?? el.value.length;
      const before = el.value.slice(0, t.start);
      const after = el.value.slice(caret);
      onChange(before + char + after);
      const pos = before.length + char.length;
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos); });
      return null;
    });
  }, [ref, onChange]);

  const picker = trigger ? (
    <EmojiPicker
      anchorRef={ref}
      query={trigger.query}
      onQueryChange={q => setTrigger(t => (t ? { ...t, query: q } : t))}
      onPick={insert}
      onClose={dismiss}
    />
  ) : null;

  return { detect, close: dismiss, active: !!trigger, picker };
}
