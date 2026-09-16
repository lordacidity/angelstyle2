'use client';

// VidsBottom — the popup behind the rack's Bottom card, which fills Bottom A
// and Bottom B together. Bottom B is the Pauv recording of someone being
// traded; Bottom A is the ChatGPT search that leads to them. The Bottom B
// folder already holds the recordings, one per person and direction (see
// lib/vidsBottom for how they are read), so the choice here is who, from
// those, and which way — a direction there is no clip of them for is greyed
// out — plus the question ChatGPT gets asked. Go hands the three to the
// builder and closes: the model, the render and the upload run behind it,
// with the progress on the Bottom card, so the rest of the build can go on.
//
// Who is searched for rather than picked off a list: there are as many people
// as there are Bottom B clips, and landing on whoever comes first alphabetically
// only ever meant scrolling past them. The box opens on the whole list when you
// press it and narrows as you type; nobody is chosen until you choose them, so
// Go stays off until you have.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CLIP_SECONDS, VIDEO_H, VIDEO_W } from '@/app/components/chatgpt/chatgpt-video';
import type { BottomPerson, Direction } from '@/lib/vidsBottom';
import { BTN_TEXT } from '@/lib/ui-constants';
import { Empty, Shell } from './VidsPicker';

const QUESTION_KEY = 'vids-bottom-question-v1';
const DIRECTIONS: readonly Direction[] = ['up', 'down'];
const DIRECTION_LABEL: Record<Direction, string> = { up: '📈 Up', down: '📉 Down' };

/** The direction to land on for a person: the one asked for if they have a
 *  clip that way, else whichever they do have. */
function firstDirection(p: BottomPerson | null, prefer: Direction | null): Direction {
  if (p && prefer && p[prefer]) return prefer;
  if (p?.up) return 'up';
  if (p?.down) return 'down';
  return prefer ?? 'up';
}

export function VidsBottomPopup({ people, current, onGo, onClose }: {
  people: BottomPerson[];
  /** Who is on the stage now, when its Bottom B is one of these. */
  current: { key: string; direction: Direction | null } | null;
  /** Make it: who, which way, and the question. Runs behind the popup. */
  onGo: (person: BottomPerson, direction: Direction, question: string) => void;
  onClose: () => void;
}) {
  // Whoever is already on the stage carries over; otherwise nobody, and the
  // search starts empty rather than on the first name alphabetically.
  const [key, setKey] = useState(() => (
    current && people.some((p) => p.key === current.key) ? current.key : ''
  ));
  const person = people.find((p) => p.key === key) ?? null;
  const [direction, setDirection] = useState<Direction>(() => firstDirection(person, current?.direction ?? null));
  const [question, setQuestion] = useState(() => {
    try { return localStorage.getItem(QUESTION_KEY) ?? ''; } catch { return ''; }
  });
  const questionRef = useRef<HTMLTextAreaElement>(null);

  // Changing who keeps the direction if they have it, else takes the one they do.
  const choosePerson = (k: string) => {
    setKey(k);
    setDirection(firstDirection(people.find((p) => p.key === k) ?? null, direction));
  };

  // ── Searching for who ───────────────────────────────────────────────────────
  const [query, setQuery] = useState(() => person?.label ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const needle = query.trim().toLowerCase();
  // A box still reading as whoever is chosen is not somebody narrowing the list
  // down, so pressing it shows everyone rather than just them. `key` is the
  // label lower-cased and squeezed (lib/vidsBottom personKey), which is what
  // makes it the thing to match against.
  const matches = !needle || needle === person?.key
    ? people
    : people.filter((p) => p.key.includes(needle));

  const openList = () => { setOpen(true); setActive(0); };
  /** Put the list away and leave the box reading as whoever is actually chosen,
   *  so a half-typed name never sits there looking like a choice. */
  const closeList = () => { setOpen(false); setQuery(person?.label ?? ''); };
  const choose = (p: BottomPerson) => {
    choosePerson(p.key);
    setQuery(p.label);
    setOpen(false);
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { openList(); return; }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (matches.length ? (i + step + matches.length) % matches.length : 0));
      return;
    }
    if (e.key === 'Enter' && open) {
      e.preventDefault();
      if (matches[active]) choose(matches[active]);
      return;
    }
    // Escape puts the list away and leaves the popup open. Shell closes on
    // Escape from anywhere (VidsPicker), so it must not see this one.
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      closeList();
    }
  };

  // Keep the highlighted row in view when it is walked past the fold.
  useEffect(() => {
    if (open) listRef.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const clip = person?.[direction] ?? null;
  const canGo = !!person && !!clip && !!question.trim();

  const go = () => {
    if (!person || !clip) return;
    const q = question.trim();
    if (!q) { questionRef.current?.focus(); return; }
    try { localStorage.setItem(QUESTION_KEY, q); } catch { /* ignore */ }
    onGo(person, direction, q);
    onClose();
  };

  return (
    <Shell title="Make the bottom" subtitle="ChatGPT looks them up, then their Pauv clip" onClose={onClose}>
      {people.length === 0 ? (
        <Empty>
          Nothing in <span className="text-zinc-300">Bottom B</span> yet. Prep a Pauv recording and file it there,
          named after who it is and which way — “Trump B up”.
        </Empty>
      ) : (
        <div className="space-y-3">
          {/* Not a <label>: it wraps the dropdown, and a label would hand every
              click on a row back to the input. */}
          <div
            className="relative"
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) closeList(); }}
          >
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500">Who</span>
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
              onFocus={openList}
              onPointerDown={openList}
              onKeyDown={onSearchKey}
              placeholder="Search who…"
              spellCheck={false}
              autoComplete="off"
              className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 text-[12px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500"
            />
            {open && (
              <div
                ref={listRef}
                className="absolute inset-x-0 top-full z-10 mt-1 max-h-44 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 py-0.5 shadow-xl"
              >
                {matches.length === 0 ? (
                  <p className="px-2 py-2 text-[11px] text-zinc-500">
                    No Bottom B clip of anyone called “{query.trim()}”
                  </p>
                ) : matches.map((p, i) => (
                  <button
                    key={p.key}
                    type="button"
                    data-active={i === active || undefined}
                    // Keeps the focus on the box, so picking a row is not a blur.
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(p)}
                    className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] ${
                      i === active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{p.label}</span>
                    <span className="shrink-0 text-[9px] text-zinc-500">
                      {[p.up && 'up', p.down && 'down'].filter(Boolean).join(' · ')}
                    </span>
                    {p.key === key && <span className="shrink-0 text-[9px] text-zinc-400">✓</span>}
                  </button>
                ))}
              </div>
            )}
            <span className="mt-1 block text-[9px] text-zinc-600">everyone there is a Bottom B clip of</span>
          </div>

          <div>
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500">Which way</span>
            <div className="grid grid-cols-2 gap-2">
              {DIRECTIONS.map((d) => {
                const has = person?.[d] ?? null;
                const on = direction === d && !!has;
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={!has}
                    onClick={() => setDirection(d)}
                    title={has ? `Bottom B: ${has.name}` : `No Bottom B clip of ${person?.label ?? 'them'} going ${d}`}
                    className={`h-10 rounded-md border text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                      on
                        ? d === 'up'
                          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
                          : 'border-red-500 bg-red-500/15 text-red-300'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {DIRECTION_LABEL[d]}
                  </button>
                );
              })}
            </div>
            {clip && <p className="mt-1 truncate text-[9px] text-zinc-600" title={clip.name}>Bottom B: {clip.name}</p>}
          </div>

          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500">The question</span>
            <textarea
              ref={questionRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canGo) go(); } }}
              rows={2}
              placeholder="e.g. who is the most overrated musician of all time?"
              className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[12px] text-zinc-100 outline-none focus:border-zinc-500"
            />
            <span className="mt-1 block text-[9px] text-zinc-600">
              Typed into ChatGPT in the recording, spelled right. Whatever it asks, the answer is {person?.label ?? 'them'}.
            </span>
          </label>

          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 flex-1 text-[9px] text-zinc-600">
              About {CLIP_SECONDS}s at {VIDEO_W}×{VIDEO_H} with the keyboard on it, filed under Bottom A and paired with
              their Bottom B, marked up search · wait · pick so its three captions land on the beat. It renders behind
              this popup — keep building meanwhile.
            </p>
            <button
              type="button"
              onClick={go}
              disabled={!canGo}
              className={`${BTN_TEXT} shrink-0 border-white bg-white px-4 text-black hover:bg-zinc-200`}
            >
              Go
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}
