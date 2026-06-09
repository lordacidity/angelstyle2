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
      className="fixed z-[1000] rounded-lg bg-zinc-900 border border-zinc-700 shadow-2xl overflow-hidden"
      style={{ left: rect.left, top: rect.bottom + 4, width: Math.max(rect.width, 300) }}
    >
      <div className="p-2 border-b border-zinc-800">
        <input
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          placeholder="Search emoji…"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500"
        />
      </div>
      <div className="p-2 max-h-[220px] overflow-y-auto">
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

  // The "@" must start the field or follow whitespace, so emails/@handles inside
  // a word don't trigger the picker.
  const detect = useCallback(() => {
    const el = ref.current;
    if (!el) return;
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
      onClose={() => setTrigger(null)}
    />
  ) : null;

  return { detect, close: () => setTrigger(null), active: !!trigger, picker };
}
