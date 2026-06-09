'use client';

// Emoji manager — the slide-out drawer opened from the left sidebar's "Emojis"
// button. Browse the full Apple set by category (or search), pin the ones you
// reach for most, and give each a custom "@" shortcut. Pins + aliases persist to
// Railway via the shared emoji-prefs store, so they immediately change what the
// "@" picker (in Media captions / Board cells) surfaces.

import { useMemo, useState } from 'react';
import { EMOJIS, emojiSrc, emojiByUnified, type EmojiDef } from '@/lib/emoji';
import {
  useEmojiPrefs, setEmojiPref, aliasOf, isPinned, pinnedUnifieds, type EmojiPrefMap,
} from '@/lib/emoji-prefs-store';

// Category tabs, in first-seen order from the dataset. Browsing one category at a
// time keeps the rendered grid (and image loads) bounded instead of mounting all
// ~1900 glyphs at once.
const CATEGORIES: string[] = (() => {
  const seen: string[] = [];
  for (const e of EMOJIS) if (!seen.includes(e.category)) seen.push(e.category);
  return seen;
})();

const BY_CATEGORY: Record<string, EmojiDef[]> = (() => {
  const m: Record<string, EmojiDef[]> = {};
  for (const e of EMOJIS) (m[e.category] ??= []).push(e);
  return m;
})();

// Short tab labels so they fit the narrow drawer.
const TAB_LABEL: Record<string, string> = {
  'Smileys & Emotion': 'Smileys',
  'People & Body': 'People',
  'Animals & Nature': 'Animals',
  'Food & Drink': 'Food',
  'Travel & Places': 'Travel',
  Activities: 'Activities',
  Objects: 'Objects',
  Symbols: 'Symbols',
  Flags: 'Flags',
};

const PINNED_TAB = '★ Pinned';

function searchEmojis(prefs: EmojiPrefMap, query: string): EmojiDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return EMOJIS
    .filter((e) => {
      const alias = aliasOf(prefs, e.unified);
      return e.name.toLowerCase().includes(q)
        || e.keywords.some((k) => k.includes(q))
        || (!!alias && alias.includes(q));
    })
    .slice(0, 120);
}

export function EmojiManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { prefs } = useEmojiPrefs();
  const [tab, setTab] = useState<string>(PINNED_TAB);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null); // unified
  const [aliasDraft, setAliasDraft] = useState('');

  const pinned = useMemo(
    () => pinnedUnifieds(prefs).map((u) => emojiByUnified(u)).filter(Boolean) as EmojiDef[],
    [prefs],
  );

  if (!open) return null;

  const searching = query.trim().length > 0;
  const grid: EmojiDef[] = searching
    ? searchEmojis(prefs, query)
    : tab === PINNED_TAB
      ? pinned
      : (BY_CATEGORY[tab] ?? []);

  const selectedDef = selected ? emojiByUnified(selected) : null;

  function selectEmoji(e: EmojiDef) {
    setSelected(e.unified);
    setAliasDraft(aliasOf(prefs, e.unified));
  }

  function commitAlias() {
    if (!selectedDef) return;
    const next = aliasDraft.toLowerCase().replace(/[@\s]+/g, '');
    if (next !== aliasOf(prefs, selectedDef.unified)) {
      void setEmojiPref(selectedDef.unified, { alias: next });
    }
  }

  return (
    <>
      {/* Click-catcher so clicking the page outside the drawer closes it. Starts
          at left-[72px] so the sidebar itself stays clickable (navigate away or
          toggle the drawer off); the drawer (z-39) sits above this catcher. */}
      <div className="fixed top-0 bottom-0 left-[72px] right-0 z-[38]" onClick={onClose} />

      <aside className="fixed top-0 left-[72px] h-screen w-[340px] bg-zinc-950 border-r border-zinc-800 flex flex-col z-[39] shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold text-white">Emojis</h2>
            <p className="text-[11px] text-zinc-500 leading-tight">
              Pin favorites & set <span className="text-zinc-300">@</span> shortcuts
            </p>
          </div>
          <button
            onClick={onClose}
            title="Close"
            className="shrink-0 text-zinc-500 hover:text-white text-sm leading-none p-1"
          >
            ✕
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pt-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all emoji…"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600"
          />
        </div>

        {/* Category tabs (hidden while searching) */}
        {!searching && (
          <div className="px-3 pt-2 flex flex-wrap gap-1">
            {[PINNED_TAB, ...CATEGORIES].map((c) => (
              <button
                key={c}
                onClick={() => setTab(c)}
                className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-medium transition-colors ${
                  tab === c
                    ? 'bg-zinc-700 text-white'
                    : 'bg-zinc-900 text-zinc-500 hover:text-zinc-200'
                }`}
              >
                {c === PINNED_TAB ? c : (TAB_LABEL[c] ?? c)}
              </button>
            ))}
          </div>
        )}

        {/* Grid */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {grid.length === 0 ? (
            <p className="text-xs text-zinc-600 text-center py-10">
              {searching
                ? 'No emoji found.'
                : tab === PINNED_TAB
                  ? 'No pinned emoji yet. Pick one below and tap the star.'
                  : 'Nothing here.'}
            </p>
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {grid.map((e) => {
                const pinnedHere = isPinned(prefs, e.unified);
                const isSel = selected === e.unified;
                return (
                  <div key={e.unified} className="relative">
                    <button
                      type="button"
                      title={e.name}
                      onClick={() => selectEmoji(e)}
                      className={`flex h-9 w-full items-center justify-center rounded-md transition-colors ${
                        isSel ? 'bg-zinc-700 ring-1 ring-zinc-500' : 'hover:bg-zinc-800'
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={emojiSrc(e.unified)} alt={e.name} width={24} height={24} draggable={false} />
                    </button>
                    {/* Quick-pin star — toggles without opening the editor.
                        Amber when pinned, dim otherwise so it stays discoverable. */}
                    <button
                      type="button"
                      title={pinnedHere ? 'Unpin' : 'Pin'}
                      onClick={() => void setEmojiPref(e.unified, { pinned: !pinnedHere })}
                      className={`absolute -top-1 -right-1 h-4 w-4 rounded-full text-[9px] leading-none flex items-center justify-center transition-colors ${
                        pinnedHere
                          ? 'bg-amber-400 text-black'
                          : 'bg-zinc-800/80 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-200'
                      }`}
                    >
                      ★
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Editor footer — the selected emoji's @-shortcut + pin */}
        {selectedDef && (
          <div className="border-t border-zinc-800 px-4 py-3 flex flex-col gap-2 bg-zinc-900/40">
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={emojiSrc(selectedDef.unified)} alt={selectedDef.name} width={26} height={26} draggable={false} />
              <span className="flex-1 min-w-0 truncate text-xs text-zinc-300">{selectedDef.name}</span>
              <button
                onClick={() => void setEmojiPref(selectedDef.unified, { pinned: !isPinned(prefs, selectedDef.unified) })}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                  isPinned(prefs, selectedDef.unified)
                    ? 'bg-amber-400 text-black hover:bg-amber-300'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
              >
                {isPinned(prefs, selectedDef.unified) ? '★ Pinned' : '☆ Pin'}
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-zinc-500">@</span>
              <input
                value={aliasDraft}
                onChange={(e) => setAliasDraft(e.target.value)}
                onBlur={commitAlias}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitAlias(); } }}
                placeholder="shortcut (e.g. cry)"
                className="flex-1 min-w-0 bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600"
              />
            </div>
            <p className="text-[10px] text-zinc-600 leading-tight">
              Type <span className="text-zinc-400">@{aliasDraft.toLowerCase().replace(/[@\s]+/g, '') || '…'}</span> in a caption to insert this emoji.
            </p>
          </div>
        )}
      </aside>
    </>
  );
}
