'use client';

// VidsClippers — the Clippers page of the Vids section: what the clippers get.
//
// The clippers are the people who will make vids of their own, in an app of
// their own, out of what is approved here and nothing else. This page is the
// approving: every persona, every Bottom A, Bottom B and End clip, every song
// in the audio library and every caption look, each with a switch. On, and
// the clippers' app offers it; off, and it is ours alone — still used here,
// on Build, exactly as before. Everything starts off.
//
// A persona is one switch for its three clips. A clip is listed under the
// folder it is filed in, so one dragged back to the Inbox drops off the page
// (its switch stays as it was, and comes back with it). Songs and looks live
// in code rather than in the library, so their switches are kept as a list of
// what is on — see VidClipableFlag.
//
// Right-click a persona, a clip or a song to rename it. It is the thing
// itself that is renamed, not a label for this page: a persona or clip is the
// same row Build and Edit & file show, and a song's new name is kept where
// the audio library is listed from, so it is the name on Build's Sound rail
// and in the charts and carousel pickers too. Caption looks are named in code
// and have no such menu.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ClipableKind, VidClipableFlag, VidPersona, VidRow } from '@/lib/vids-types';
import { MAX_SUGGESTED, PERSONA_PARTS, PERSONA_PART_LABEL, isClipable, suggestedFrom } from '@/lib/vids-types';
import { withBase } from '@/lib/clipping';
import { CAPTION_STYLES, type CaptionStyle } from '@/lib/vidsCaptions';
import { listMusic, type MusicTrack } from '@/lib/vidsAudio';
import { SLOT_META, type SlotId } from '@/lib/vidsPlan';
import { ClipTile, Empty } from './VidsPicker';
import { fmtTime } from '@/lib/utils';
import { CloseIcon } from '@/lib/icons';

/** Somebody on Pauv, as /api/ai/talents lists them. Fetched here rather than
 *  through lib/vids2, whose roster loader comes attached to the whole news and
 *  trade recording tree — a name and a ticker is all this page wants. */
interface RosterPerson { name: string; ticker: string }

/** The three slots picked by hand — the ones whose clips are approved one by
 *  one. Start / Top A / Top B come with the persona. */
const CLIP_SLOTS = ['bottomA', 'bottomB', 'end'] as const;
export type ClipSlot = (typeof CLIP_SLOTS)[number];

interface Props {
  /** Whether the page is on screen — the song list is fetched the first time it is. */
  active: boolean;
  personas: VidPersona[];
  resolveVideo: (id: string | null) => VidRow | undefined;
  /** Everything filed under Bottom A, Bottom B and End, in library order. */
  clips: Record<ClipSlot, VidRow[]>;
  /** The songs and caption looks that are on. */
  flags: VidClipableFlag[];
  onPersona: (id: string, on: boolean) => void;
  onClip: (id: string, on: boolean) => void;
  onFlag: (kind: ClipableKind, key: string, on: boolean) => void;
  /** Right-click → rename. A persona or clip is renamed on its row; a song's
   *  name is kept server side and comes back with the next listing. The song
   *  one says whether it took, so the list here can be put right if not. */
  onRenamePersona: (id: string, name: string) => void;
  onRenameClip: (id: string, name: string) => void;
  onRenameTrack: (url: string, label: string) => Promise<boolean>;
}

const SMALL_BTN = 'shrink-0 rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-white disabled:cursor-default disabled:opacity-30 disabled:hover:border-zinc-700 disabled:hover:text-zinc-400';

const onOffTitle = (name: string, on: boolean) =>
  `${name} — ${on ? 'on offer to the clippers; click to take it off' : 'ours alone; click to put it on offer'} — right-click to rename it`;

// ── Rename popup ──────────────────────────────────────────────────────────────
// Nothing is written until Save; Escape, a click outside, a blank or an
// unchanged name leave it exactly as it was.

/** What is being renamed: which kind, what it is keyed by, what it is called. */
type Renaming =
  | { kind: 'persona'; id: string; name: string }
  | { kind: 'clip'; id: string; name: string }
  | { kind: 'song'; url: string; name: string };

const RENAME_KIND: Record<Renaming['kind'], { heading: string; hint: string; max: number }> = {
  persona: { heading: 'Persona', hint: 'Its name everywhere — on Build, in the pickers, on Edit & file. Its three clips follow if they are still named after it.', max: 120 },
  clip:    { heading: 'Clip',    hint: 'Its name everywhere — on Build, in the pickers, on Edit & file.', max: 200 },
  song:    { heading: 'Song',    hint: 'Its name everywhere the audio library is listed — Build\'s Sound rail, the charts, the carousel.', max: 120 },
};

function RenameDialog({ target, onSave, onClose }: {
  target: Renaming;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(target.name);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.select(); }, []);
  const meta = RENAME_KIND[target.kind];

  const save = () => {
    const clean = draft.trim();
    if (clean && clean !== target.name) onSave(clean);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
          if (e.key === 'Enter') { e.preventDefault(); save(); }
        }}
        className="w-[380px] rounded-lg border border-zinc-700 bg-zinc-950 p-4 shadow-2xl"
      >
        <div className="mb-2 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Rename {meta.heading.toLowerCase()}</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500">{meta.hint}</p>
          </div>
          <button onClick={onClose} title="Close" className="shrink-0 text-zinc-500 hover:text-white">
            <CloseIcon size={13} />
          </button>
        </div>
        <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Name</p>
        <input
          ref={inputRef}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={target.name}
          maxLength={meta.max}
          className="w-full rounded border border-zinc-700 bg-black px-2 py-1.5 text-[11px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-400"
        />
        <div className="mt-3 flex items-center gap-1.5">
          <span className="flex-1 text-[9px] text-zinc-600">Enter saves</span>
          <button
            onClick={onClose}
            className="rounded border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="rounded bg-white px-3 py-1 text-[11px] font-medium text-black hover:bg-zinc-200"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Small bits ────────────────────────────────────────────────────────────────

/** The switch itself. Green is on offer; grey is ours alone. */
function Switch({ on, title, onChange }: { on: boolean; title: string; onChange: (on: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      title={title}
      onClick={(e) => { e.stopPropagation(); onChange(!on); }}
      className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-zinc-700 hover:bg-zinc-600'}`}
    >
      <span
        className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-[left] ${on ? 'left-3.5' : 'left-0.5'}`}
      />
    </button>
  );
}

/** The five names Vids 2 puts up before anybody types a search. Not about
 *  what a clipper may use — the whole roster is searchable either way — but
 *  about what is offered first, which is most of what gets made. */
function SuggestedPeople({ chosen, roster, error, onChange }: {
  chosen: string[];
  roster: RosterPerson[] | null;
  error: string | null;
  onChange: (name: string, on: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const full = chosen.length >= MAX_SUGGESTED;
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !roster) return [];
    return roster.filter((p) => p.name.toLowerCase().includes(q) && !chosen.includes(p.name)).slice(0, 8);
  }, [query, roster, chosen]);

  return (
    <div className="px-3 py-2.5">
      {chosen.length === 0 ? (
        <p className="text-[11px] text-zinc-600">Nobody suggested yet — Vids 2 opens straight on the search.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {chosen.map((name) => (
            <span
              key={name}
              className="flex items-center gap-1.5 rounded-full border border-amber-400/70 bg-gradient-to-b from-amber-200/25 to-amber-500/10 py-1 pl-3 pr-1.5 text-[12px] font-semibold text-amber-100"
            >
              ★ {name}
              <button
                type="button"
                onClick={() => onChange(name, false)}
                title={`Stop suggesting ${name}`}
                className="rounded-full px-1 text-amber-200/70 transition-colors hover:bg-amber-400/20 hover:text-white"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative mt-2.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={full || !roster}
          spellCheck={false}
          placeholder={full
            ? `${MAX_SUGGESTED} is the lot — take one off to swap it`
            : roster ? `Add somebody — ${roster.length.toLocaleString('en-US')} on Pauv` : 'Loading the roster…'}
          className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-[12px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500 disabled:opacity-40"
        />
        {matches.length > 0 && (
          <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-950 py-0.5 shadow-xl">
            {matches.map((p) => (
              <button
                key={p.ticker}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(p.name, true); setQuery(''); }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800"
              >
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="shrink-0 font-mono text-[9px] text-zinc-500">{p.ticker}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <p className="mt-1 text-[10px] text-red-400">Couldn’t load the roster: {error}</p>}
    </div>
  );
}

/** A section's heading: what it is, how many of it are on, and All / None. */
function SectionHead({ title, hint, on, total, onAll, onNone }: {
  title: string;
  hint: string;
  on: number;
  total: number;
  /** Left out where putting every one on makes no sense — five suggestions
   *  cannot be picked for you. The button is then not there at all, rather
   *  than there and doing nothing. */
  onAll?: () => void;
  onNone: () => void;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-zinc-200">
          {title}
          <span className={`ml-2 text-[10px] font-normal ${on ? 'text-emerald-400' : 'text-zinc-500'}`}>
            {total ? `${on} of ${total} on` : 'nothing here yet'}
          </span>
        </p>
        <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500">{hint}</p>
      </div>
      {onAll && (
        <button onClick={onAll} disabled={!total || on === total} title="Put every one of these on offer" className={SMALL_BTN}>
          All
        </button>
      )}
      <button onClick={onNone} disabled={on === 0} title="Take every one of these off" className={SMALL_BTN}>
        None
      </button>
    </div>
  );
}

function Section({ children }: { children: ReactNode }) {
  return <section className="mb-6 border-b border-zinc-800 pb-6 last:border-b-0">{children}</section>;
}

/** One row with a switch on the right — a persona, a song, a look. */
function Row({ on, title, onChange, onContext, children }: {
  on: boolean;
  title: string;
  onChange: (on: boolean) => void;
  /** Right-click, for the rows that have a name of their own to change. */
  onContext?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      onClick={() => onChange(!on)}
      onContextMenu={onContext ? (e) => { e.preventDefault(); onContext(); } : undefined}
      title={title}
      className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 transition-colors ${
        on ? 'border-emerald-700/70 bg-emerald-950/15' : 'border-zinc-800 hover:border-zinc-600'
      }`}
    >
      {children}
      <Switch on={on} title={title} onChange={onChange} />
    </div>
  );
}

// ── Personas ──────────────────────────────────────────────────────────────────

function PersonaRow({ persona, resolveVideo, onChange, onContext }: {
  persona: VidPersona;
  resolveVideo: (id: string | null) => VidRow | undefined;
  onChange: (on: boolean) => void;
  onContext: () => void;
}) {
  const filled = PERSONA_PARTS.filter((k) => persona[k]).length;
  return (
    <Row on={persona.clipable} title={onOffTitle(persona.name, persona.clipable)} onChange={onChange} onContext={onContext}>
      <span className="flex shrink-0 gap-1">
        {PERSONA_PARTS.map((part) => {
          const v = resolveVideo(persona[part]);
          return (
            <span
              key={part}
              title={v ? `${PERSONA_PART_LABEL[part]} — ${v.name}` : `${PERSONA_PART_LABEL[part]} — missing`}
              className={`flex h-10 w-10 items-center justify-center overflow-hidden rounded border bg-black ${
                v ? 'border-zinc-700' : 'border-dashed border-zinc-700'
              }`}
            >
              {v?.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={v.thumbUrl} alt="" className="h-full w-full object-cover" draggable={false} />
              ) : (
                <span className="text-[8px] text-zinc-600">{PERSONA_PART_LABEL[part]}</span>
              )}
            </span>
          );
        })}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-semibold text-zinc-200">{persona.name}</span>
        <span className={`block truncate text-[9px] ${filled === PERSONA_PARTS.length ? 'text-zinc-500' : 'text-amber-400'}`}>
          {filled === PERSONA_PARTS.length
            ? (persona.context || 'Start · Top A · Top B')
            : `${filled} of 3 clips — the clippers would get a persona with a gap in it`}
        </span>
      </span>
    </Row>
  );
}

// ── Songs ─────────────────────────────────────────────────────────────────────

function PlayMark({ playing }: { playing: boolean }) {
  return playing ? <CloseIcon size={10} /> : (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function SongRow({ track, on, playing, onPlay, onChange, onContext }: {
  track: MusicTrack;
  on: boolean;
  playing: boolean;
  onPlay: () => void;
  onChange: (on: boolean) => void;
  onContext: () => void;
}) {
  return (
    <Row on={on} title={onOffTitle(track.label, on)} onChange={onChange} onContext={onContext}>
      <button
        onClick={(e) => { e.stopPropagation(); onPlay(); }}
        title={playing ? 'Stop' : 'Listen'}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
          playing ? 'border-white bg-white text-black' : 'border-zinc-700 text-zinc-300 hover:border-zinc-400 hover:text-white'
        }`}
      >
        <PlayMark playing={playing} />
      </button>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] text-zinc-200">{track.label}</span>
        <span className="block font-mono text-[9px] text-zinc-500">
          {track.durationMs ? fmtTime(track.durationMs / 1000) : '–:––'}
        </span>
      </span>
    </Row>
  );
}

// ── Caption looks ─────────────────────────────────────────────────────────────

/** A line drawn the way the look draws it, near enough to tell the looks
 *  apart: face, weight, colour, case, tracking and the outline. Sized for a
 *  row rather than a frame. */
function lookStyle(s: CaptionStyle): CSSProperties {
  const px = 15;
  return {
    fontFamily: s.family,
    fontWeight: s.weight,
    fontSize: px,
    color: s.color,
    letterSpacing: `${s.tracking}em`,
    textTransform: s.letterCase === 'upper' ? 'uppercase' : s.letterCase === 'lower' ? 'lowercase' : 'none',
    WebkitTextStroke: s.stroke ? `${Math.max(0.5, s.stroke * px * 0.5)}px #000` : undefined,
    paintOrder: 'stroke fill',
    textShadow: s.shadow ? `0 1px ${Math.round(s.shadow * 200)}px rgba(0,0,0,0.8)` : undefined,
  };
}

function LookRow({ look, on, onChange }: { look: CaptionStyle; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <Row
      on={on}
      title={`${look.label} — ${on ? 'on offer to the clippers; click to take it off' : 'ours alone; click to put it on offer'}`}
      onChange={onChange}
    >
      <span className="flex h-10 w-[150px] shrink-0 items-center justify-center overflow-hidden rounded bg-zinc-900 px-2">
        <span className="truncate" style={lookStyle(look)}>made bank off ronaldo</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-semibold text-zinc-200">{look.label}</span>
        <span className="block truncate text-[9px] text-zinc-500">{look.note}</span>
      </span>
    </Row>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function VidsClippers({
  active, personas, resolveVideo, clips, flags, onPersona, onClip, onFlag,
  onRenamePersona, onRenameClip, onRenameTrack,
}: Props) {
  // The songs, as the audio library lists them — fetched the first time the
  // page is looked at, and again only if a rename didn't take (see below).
  const [tracks, setTracks] = useState<MusicTrack[] | null>(null);
  const [tracksError, setTracksError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Renaming | null>(null);

  // Who is on Pauv, for the suggestions. Fetched once, like the songs.
  const [roster, setRoster] = useState<RosterPerson[] | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  useEffect(() => {
    if (!active || roster !== null) return;
    const ctrl = new AbortController();
    fetch(withBase('/api/ai/talents'), { signal: ctrl.signal })
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok || !Array.isArray(data)) throw new Error((data && data.error) || `HTTP ${r.status}`);
        return (data as RosterPerson[]).slice().sort((a, b) => a.name.localeCompare(b.name));
      })
      .then((list) => { setRoster(list); setRosterError(null); })
      .catch((e) => { if (!ctrl.signal.aborted) setRosterError(e instanceof Error ? e.message : String(e)); });
    return () => ctrl.abort();
  }, [active, roster]);

  useEffect(() => {
    if (!active || tracks !== null) return;
    const ctrl = new AbortController();
    listMusic(ctrl.signal)
      .then((list) => { setTracks(list); setTracksError(null); })
      .catch((e) => { if (!ctrl.signal.aborted) setTracksError(e instanceof Error ? e.message : String(e)); });
    return () => ctrl.abort();
  }, [active, tracks]);

  // A song left playing stops when you go elsewhere — reset as the page goes
  // hidden, during render rather than in an effect, so nothing plays on for
  // a frame after the switch.
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) setPlaying(null);
  }

  const personasOn = useMemo(() => personas.filter((p) => p.clipable).length, [personas]);
  const songsOn = useMemo(
    () => (tracks ?? []).filter((t) => isClipable(flags, 'music', t.url)).length,
    [tracks, flags],
  );
  const looksOn = useMemo(() => CAPTION_STYLES.filter((s) => isClipable(flags, 'captionStyle', s.id)).length, [flags]);
  const suggested = useMemo(() => suggestedFrom(flags), [flags]);

  const setEvery = <T,>(items: T[], isOn: (t: T) => boolean, set: (t: T, on: boolean) => void, on: boolean) => {
    for (const it of items) if (isOn(it) !== on) set(it, on);
  };

  // The song is renamed here first, so the row reads right as Save is
  // pressed; if the server refused, the list is dropped and fetched again,
  // which puts the old name back.
  const renameTrack = async (url: string, label: string) => {
    setTracks((prev) => prev && prev.map((t) => (t.url === url ? { ...t, label } : t)));
    if (!(await onRenameTrack(url, label))) setTracks(null);
  };

  const rename = (name: string) => {
    if (!renaming) return;
    if (renaming.kind === 'persona') onRenamePersona(renaming.id, name);
    else if (renaming.kind === 'clip') onRenameClip(renaming.id, name);
    else void renameTrack(renaming.url, name);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[860px] px-6 py-5">
        <div className="mb-5">
          <p className="text-[13px] font-semibold text-zinc-100">What the clippers get</p>
          <p className="mt-1 max-w-[640px] text-[11px] leading-relaxed text-zinc-500">
            The clippers make vids of their own out of what is switched on here, and see nothing else.
            Anything off stays ours alone — Build here goes on using all of it either way.
            Right-click a persona, a clip or a song to rename it; the new name is the name everywhere.
          </p>
        </div>

        <Section>
          <SectionHead
            title="Suggested people"
            hint={`Up to ${MAX_SUGGESTED}. Vids 2 puts these up in gold on the Who question, before anybody searches — everyone else is still a search away.`}
            on={suggested.length}
            total={MAX_SUGGESTED}
            onNone={() => suggested.forEach((name) => onFlag('suggested', name, false))}
          />
          <SuggestedPeople
            chosen={suggested}
            roster={roster}
            error={rosterError}
            onChange={(name, on) => onFlag('suggested', name, on)}
          />
        </Section>

        <Section>
          <SectionHead
            title="Personas"
            hint="One switch for the persona's Start, Top A and Top B together."
            on={personasOn}
            total={personas.length}
            onAll={() => setEvery(personas, (p) => p.clipable, (p, on) => onPersona(p.id, on), true)}
            onNone={() => setEvery(personas, (p) => p.clipable, (p, on) => onPersona(p.id, on), false)}
          />
          {personas.length === 0 ? (
            <Empty>No personas yet — make one under <span className="text-zinc-300">Persona</span> on Edit &amp; file.</Empty>
          ) : (
            <div className="space-y-1.5">
              {personas.map((p) => (
                <PersonaRow
                  key={p.id}
                  persona={p}
                  resolveVideo={resolveVideo}
                  onChange={(on) => onPersona(p.id, on)}
                  onContext={() => setRenaming({ kind: 'persona', id: p.id, name: p.name })}
                />
              ))}
            </div>
          )}
        </Section>

        {CLIP_SLOTS.map((slot: SlotId & ClipSlot) => {
          const list = clips[slot];
          const on = list.filter((v) => v.clipable).length;
          const meta = SLOT_META[slot];
          return (
            <Section key={slot}>
              <SectionHead
                title={meta.label}
                hint={`Everything filed under ${meta.folder} — ${meta.hint}.`}
                on={on}
                total={list.length}
                onAll={() => setEvery(list, (v) => v.clipable, (v, o) => onClip(v.id, o), true)}
                onNone={() => setEvery(list, (v) => v.clipable, (v, o) => onClip(v.id, o), false)}
              />
              {list.length === 0 ? (
                <Empty>Nothing in <span className="text-zinc-300">{meta.folder}</span> yet.</Empty>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
                  {list.map((v) => (
                    // The tile is shared with the pickers, which have no
                    // right-click, so the menu sits on a wrapper around it.
                    <div
                      key={v.id}
                      onContextMenu={(e) => { e.preventDefault(); setRenaming({ kind: 'clip', id: v.id, name: v.name }); }}
                    >
                      <ClipTile
                        video={v}
                        current={v.clipable}
                        badge="Clipable"
                        title={onOffTitle(v.name, v.clipable)}
                        onChoose={() => onClip(v.id, !v.clipable)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </Section>
          );
        })}

        <Section>
          <SectionHead
            title="Songs"
            hint="The audio library, as Build's Sound rail lists it. Right-click one to rename it everywhere it is listed."
            on={songsOn}
            total={tracks?.length ?? 0}
            onAll={() => setEvery(tracks ?? [], (t) => isClipable(flags, 'music', t.url), (t, on) => onFlag('music', t.url, on), true)}
            onNone={() => setEvery(tracks ?? [], (t) => isClipable(flags, 'music', t.url), (t, on) => onFlag('music', t.url, on), false)}
          />
          {tracksError ? (
            <Empty>Couldn&apos;t list the audio library: {tracksError}</Empty>
          ) : tracks === null ? (
            <p className="py-4 text-center text-[10px] text-zinc-600">Listing the audio library…</p>
          ) : tracks.length === 0 ? (
            <Empty>No tracks in the audio library yet.</Empty>
          ) : (
            <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
              {tracks.map((t) => (
                <SongRow
                  key={t.url}
                  track={t}
                  on={isClipable(flags, 'music', t.url)}
                  playing={playing === t.url}
                  onPlay={() => setPlaying((cur) => (cur === t.url ? null : t.url))}
                  onChange={(on) => onFlag('music', t.url, on)}
                  onContext={() => setRenaming({ kind: 'song', url: t.url, name: t.label })}
                />
              ))}
            </div>
          )}
          {playing && (
            <audio src={playing} autoPlay onEnded={() => setPlaying(null)} onError={() => setPlaying(null)} />
          )}
        </Section>

        <Section>
          <SectionHead
            title="Caption looks"
            hint="How the captions are drawn. Build rolls one of these per build; the clippers roll from what is on."
            on={looksOn}
            total={CAPTION_STYLES.length}
            onAll={() => setEvery([...CAPTION_STYLES], (s) => isClipable(flags, 'captionStyle', s.id), (s, on) => onFlag('captionStyle', s.id, on), true)}
            onNone={() => setEvery([...CAPTION_STYLES], (s) => isClipable(flags, 'captionStyle', s.id), (s, on) => onFlag('captionStyle', s.id, on), false)}
          />
          <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
            {CAPTION_STYLES.map((s) => (
              <LookRow
                key={s.id}
                look={s}
                on={isClipable(flags, 'captionStyle', s.id)}
                onChange={(on) => onFlag('captionStyle', s.id, on)}
              />
            ))}
          </div>
        </Section>
      </div>

      {renaming && (
        <RenameDialog target={renaming} onSave={rename} onClose={() => setRenaming(null)} />
      )}
    </div>
  );
}
