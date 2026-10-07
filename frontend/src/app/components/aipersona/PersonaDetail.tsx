'use client';

// One persona: its videos, and the two things about it that can be edited —
// the name, and the character photo. Drop a new photo on the old one to
// replace it; scenes made from here on use the new one.
//
// The videos are also what a Vids persona is made from: "Make persona video"
// picks three of them — a start, a middle and an end — edits each, and saves
// them to Vids as a persona (PersonaVideoMaker). Under the videos are the
// personas made that way so far: whatever is in this character's folder in
// Vids.

import { useEffect, useRef, useState } from 'react';
import { DownloadIcon, SpinnerIcon } from '@/lib/icons';
import { deletePersona, deleteTake, downloadUrl, fileSlug, makeAvatar, renameTake, updatePersona, uploadFile } from '@/lib/aipersona/client';
import { quickMake, quickShared, type QuickShared } from '@/lib/aipersona/quick-make';
import { MAX_NAME_CHARS, PHOTO_TYPES, type Persona, type PersonaVideo } from '@/lib/aipersona/types';
import { deletePersona as deleteMade, listLibrary, updatePersona as renameMade } from '@/lib/vids-client';
import { personaFolders } from '@/lib/vids-persona-folders';
import { PERSONA_PARTS, type VidPersona, type VidRow, type VidsLibraryPayload } from '@/lib/vids-types';
import { PersonaVideoMaker } from './PersonaVideoMaker';
import { ConfirmButton, DropZone, FIELD, GHOST, LABEL, PRIMARY, Split, errorText, photoProblem } from './aipersona-ui';

type Busy = 'name' | 'photo' | 'video' | 'delete' | 'avatar';

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** The grid every list of videos on the page is laid out in: small cards, so
 *  a section is seen whole. */
const CARDS = 'grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] items-start gap-3';

/** A persona video played whole: its clips one after the other as one video
 *  — Start, then Middle, then End — and back to the start when the last one
 *  ends. */
function WholeVideo({ clips }: { clips: VidRow[] }) {
  // The clips sit on top of each other, each in its own player, and only the
  // one playing shows — so the next is already loaded when its turn comes and
  // the three read as one video, under one bar that runs the length of them all.
  const els = useRef<(HTMLVideoElement | null)[]>([]);
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  /** Played at least once: from then on the clips after the first load too. */
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(false);
  /** Seconds into the clip that is showing. */
  const [time, setTime] = useState(0);
  const [lens, setLens] = useState<number[]>(() => clips.map((c) => c.duration ?? 0));
  const before = (i: number) => lens.slice(0, i).reduce((a, b) => a + b, 0);
  const total = before(clips.length);

  function go(i: number, t: number, play: boolean) {
    els.current.forEach((v, n) => { if (v && n !== i) v.pause(); });
    const v = els.current[i];
    if (!v) return;
    v.currentTime = t;
    setAt(i);
    setTime(t);
    setPlaying(play);
    if (play) {
      setStarted(true);
      v.play().catch(() => setPlaying(false));
    } else {
      v.pause();
    }
  }

  function toggle() {
    go(at, els.current[at]?.currentTime ?? 0, !playing);
  }

  function seek(to: number) {
    let i = 0;
    while (i < clips.length - 1 && to >= before(i + 1)) i++;
    go(i, to - before(i), playing);
  }

  return (
    <div className="group relative aspect-[9/16] w-full bg-black">
      {clips.map((clip, i) => (
        <video
          key={`${i}-${clip.id}`}
          ref={(el) => { els.current[i] = el; }}
          src={clip.url}
          poster={i === 0 ? clip.thumbUrl ?? undefined : undefined}
          playsInline
          muted={muted}
          preload={started ? 'auto' : 'none'}
          onClick={toggle}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d)) setLens((was) => was.map((l, n) => (n === i ? d : l)));
          }}
          onTimeUpdate={(e) => { if (i === at) setTime(e.currentTarget.currentTime); }}
          onEnded={() => {
            if (i !== at) return;
            if (i < clips.length - 1) go(i + 1, 0, true);
            else go(0, 0, false);
          }}
          className={`absolute inset-0 h-full w-full cursor-pointer object-contain ${i === at ? '' : 'invisible'}`}
        />
      ))}
      <div className={`absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-2.5 pb-2 pt-6 transition-opacity ${playing ? 'opacity-0 group-hover:opacity-100' : ''}`}>
        <button type="button" onClick={toggle} title={playing ? 'Pause' : 'Play'} className="grid h-6 w-6 shrink-0 place-items-center text-white">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
            {playing ? <path d="M2 1h3.5v12H2zM8.5 1H12v12H8.5z" /> : <path d="M3 1l9 6-9 6z" />}
          </svg>
        </button>
        <input
          type="range"
          min={0}
          max={total || 1}
          step={0.05}
          value={Math.min(before(at) + time, total || 1)}
          onChange={(e) => seek(Number(e.target.value))}
          disabled={!total}
          aria-label="Position"
          className="h-1 min-w-0 flex-1 cursor-pointer accent-white"
        />
        <button type="button" onClick={() => setMuted(!muted)} title={muted ? 'Sound on' : 'Sound off'} className="grid h-6 w-6 shrink-0 place-items-center text-white">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M1.5 5v4h2.5l3 2.5v-9L4 5z" fill="currentColor" />
            {muted ? <path d="M9.5 5.2l3 3.6M12.5 5.2l-3 3.6" /> : <path d="M9.5 4.8a3.2 3.2 0 010 4.4M11.2 3a5.6 5.6 0 010 8" />}
          </svg>
        </button>
      </div>
    </div>
  );
}

/** A name that is renamed by typing over it: Enter or leaving it saves, Escape
 *  puts it back. Keyed by the name where it is used, so a rename that lands
 *  (or one made elsewhere) is what it shows. */
function NameInput({ value, max, disabled, onRename }: {
  value: string; max: number; disabled?: boolean; onRename: (next: string) => void;
}) {
  const [name, setName] = useState(value);
  return (
    <input
      value={name}
      onChange={(e) => setName(e.target.value.slice(0, max))}
      onBlur={() => {
        const next = name.trim();
        if (!next) { setName(value); return; }
        if (next !== value) onRename(next);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setName(value);
      }}
      disabled={disabled}
      title="Rename"
      aria-label="Name"
      className="-mx-1 block w-[calc(100%+0.5rem)] truncate rounded border border-transparent bg-transparent px-1 text-sm outline-none transition-colors hover:border-zinc-800 focus:border-zinc-600"
    />
  );
}

/** One of the character's videos in a list. What is shown is a small still of
 *  it — a page of full-size videos, each loading itself, is what made this
 *  page drag — and the video itself is fetched only when it is pressed. */
function TakeCard({ video, fileName, disabled, used = false, pickedAs, onPick, onRename, onDelete }: {
  video: PersonaVideo;
  fileName: string;
  disabled: boolean;
  /** A persona video has already been made from it: its still is greyed, so
   *  the ones not used yet stand out. Playing it shows it as it is. */
  used?: boolean;
  /** What Quick make has it down as — "1 · Start" — when it has been pressed. */
  pickedAs: string | null;
  /** Given while Quick make is picking: a press on the card picks it (or lets
   *  it go) instead of playing it. */
  onPick?: () => void;
  onRename: (next: string) => void;
  onDelete: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const still = video.thumbUrl ?? video.frameUrl;
  return (
    <div className={`overflow-hidden rounded-lg border bg-zinc-950 ${pickedAs ? 'border-emerald-400' : onPick ? 'border-zinc-800 hover:border-zinc-500' : 'border-zinc-800'}`}>
      <div className="relative">
      {onPick && (
        <button type="button" onClick={onPick} title={pickedAs ? 'Press to take it out' : 'Press to pick it'} className="absolute inset-0 z-[2] cursor-pointer">
          {pickedAs && (
            <span className="absolute right-1.5 top-1.5 rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold text-black">{pickedAs}</span>
          )}
        </button>
      )}
      {playing || !still ? (
        <video src={video.url} controls playsInline loop autoPlay={playing} preload={playing ? 'auto' : 'metadata'} className="max-h-[60vh] w-full bg-black object-contain" />
      ) : (
        <button type="button" onClick={() => setPlaying(true)} title="Play" className="group relative block w-full bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={still}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            // The card is the right height before the still arrives.
            style={video.width && video.height ? { aspectRatio: `${video.width} / ${video.height}` } : undefined}
            className={`w-full object-contain ${used ? 'opacity-30 grayscale' : ''}`}
          />
          {used && (
            <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-zinc-400" title="A persona video has already been made from this one">
              used
            </span>
          )}
          {!onPick && (
            <span className="absolute inset-0 grid place-items-center opacity-70 transition-opacity group-hover:opacity-100">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white">
                <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor" aria-hidden><path d="M3 1l9 6-9 6z" /></svg>
              </span>
            </span>
          )}
        </button>
      )}
      </div>
      <div className={`px-2.5 py-2 ${used && !playing ? 'text-zinc-500' : ''}`}>
        <NameInput key={video.sceneName} value={video.sceneName} max={MAX_NAME_CHARS} disabled={disabled} onRename={onRename} />
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">{day(video.savedAt)}</span>
          <a href={downloadUrl(video.url, fileName)} download={fileName} title="Download" className="text-zinc-500 transition-colors hover:text-white">
            <DownloadIcon size={13} />
          </a>
          <ConfirmButton
            onConfirm={onDelete}
            disabled={disabled}
            armedLabel="Delete?"
            className="border border-transparent text-[11px] text-zinc-600 transition-colors hover:text-white"
          >
            Delete
          </ConfirmButton>
        </div>
      </div>
    </div>
  );
}

/** One press of Quick make's Done: three videos on their way to Vids as a
 *  persona video. */
interface QuickJob {
  id: number;
  /** What it will be called — its start's name. */
  name: string;
  /** Its start, which the Hook list greys from the moment Done is pressed. */
  startId: string;
  /** What it is doing now. */
  text: string;
  error: string;
  done: boolean;
}

/** What the three videos Quick make is given become, in the order pressed. */
const QUICK_SLOTS = ['Start', 'Middle', 'End'] as const;

/** The three kinds of video a character has, by what they are called: one
 *  with "trading" in its name is the trade, one with "end" as a word of its
 *  own (or "ending") is an ending, and everything else is a hook. */
const TAKE_SECTIONS = [
  { key: 'hook', label: 'Hook' },
  { key: 'trading', label: 'Trading' },
  { key: 'end', label: 'End' },
] as const;
type TakeSection = (typeof TAKE_SECTIONS)[number]['key'];
const takeSection = (name: string): TakeSection =>
  (/trading/i.test(name) ? 'trading' : /\bend(ing)?\b/i.test(name) ? 'end' : 'hook');

/** One persona video made from this character: played whole, renamed by
 *  typing over its name, deleted with a second click. Deleting drops the
 *  persona video; its clips stay in Vids as footage. */
function MadeVideo({ persona, clips, onChanged }: {
  persona: VidPersona;
  clips: VidRow[];
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 ${busy ? 'opacity-60' : ''}`}>
      {clips.length ? (
        <WholeVideo clips={clips} />
      ) : (
        <div className="grid aspect-[9/16] place-items-center bg-black text-[11px] text-zinc-600">no clips</div>
      )}
      <div className="px-3 py-2.5">
        <NameInput key={persona.name} value={persona.name} max={120} disabled={busy} onRename={(next) => void run(() => renameMade(persona.id, { name: next }))} />
        <span className={`block text-[11px] ${clips.length === PERSONA_PARTS.length ? 'text-zinc-500' : 'text-amber-400'}`}>
          {clips.length === PERSONA_PARTS.length ? 'Start · Middle · End' : `${clips.length} of 3 parts`}
          {' · '}
          <span className={persona.clipable ? 'text-emerald-400' : 'text-zinc-500'}>{persona.clipable ? 'on for clippers' : 'off for clippers'}</span>
        </span>
        {error && <p className="mt-1 text-[11px] text-red-400">{error}</p>}
        <ConfirmButton
          onConfirm={() => void run(() => deleteMade(persona.id))}
          disabled={busy}
          armedLabel="Click again to delete"
          className="mt-1.5 block border border-transparent text-xs text-zinc-600 transition-colors hover:text-white"
        >
          Delete
        </ConfirmButton>
      </div>
    </div>
  );
}

export function PersonaDetail({ persona, onBack, onChanged }: {
  persona: Persona;
  onBack: () => void;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState(persona.name);
  /** "Make persona video" — the one with the editor — is open in place of
   *  the videos. */
  const [making, setMaking] = useState(false);

  // Quick make, which never leaves the page: press it, press three videos in
  // the order they play — start, middle, end — and press Done. Null while it
  // is not on; otherwise the videos pressed so far.
  const [quick, setQuick] = useState<PersonaVideo[] | null>(null);
  /** The ones Done has been pressed on, in the order it was: each saves to
   *  Vids behind the page while the next is picked. */
  const [jobs, setJobs] = useState<QuickJob[]>([]);
  const jobSeq = useRef(0);
  /** What the runs share — see QuickShared. */
  const shared = useRef<QuickShared>(quickShared());
  const saving = jobs.some((j) => !j.done && !j.error);

  // The saves live in this tab: leaving it mid-save loses them.
  useEffect(() => {
    if (!saving) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saving]);

  /** A press on a video while Quick make is on: picked next, or let go if it
   *  was already picked. A fourth is not taken. */
  function quickPick(video: PersonaVideo) {
    setQuick((prev) => {
      if (!prev) return prev;
      if (prev.some((p) => p.id === video.id)) return prev.filter((p) => p.id !== video.id);
      return prev.length < QUICK_SLOTS.length ? [...prev, video] : prev;
    });
  }

  /** Done: the three go off to be saved, and the page is ready for the next
   *  three straight away. */
  function quickDone() {
    if (!quick || quick.length !== QUICK_SLOTS.length) return;
    const [a, b, c] = quick;
    const id = ++jobSeq.current;
    const patch = (p: Partial<QuickJob>) => setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...p } : j)));
    // Named after its start, as the maker names one; renamed below if wanted.
    setJobs((prev) => [...prev, { id, name: a.sceneName, startId: a.id, text: 'Starting…', error: '', done: false }]);
    setQuick([]);
    quickMake({
      character: persona.name, name: a.sceneName, picks: [a, b, c], shared: shared.current,
      onProgress: (text) => patch({ text }),
    }).then(
      async () => {
        patch({ done: true });
        // The new one under Persona videos, and its start greyed for good.
        await Promise.all([listLibrary().then(setVids, () => {}), onChanged()]);
      },
      (err) => patch({ error: errorText(err) }),
    );
  }
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState('');

  // The personas already made from this character: the ones in its folder in
  // Vids — the folder under Persona with its name, which is where "Make
  // persona video" puts them (lib/vids-persona-folders). Read when the page
  // opens and again when the maker closes, since it may have just made one.
  const [vids, setVids] = useState<VidsLibraryPayload | null>(null);
  useEffect(() => {
    if (making) return;
    let live = true;
    listLibrary().then(
      (lib) => { if (live) setVids(lib); },
      () => { /* Vids could not be read: the videos above are still the page */ },
    );
    return () => { live = false; };
  }, [making]);
  const sameName = (a: string) => a.trim().toLowerCase() === persona.name.trim().toLowerCase();
  const folderIds = new Set(vids ? personaFolders(vids.folders).filter((f) => sameName(f.name)).map((f) => f.id) : []);
  const made = vids ? vids.personas.filter((p) => p.folderId && folderIds.has(p.folderId)) : [];

  // Whether a hook has already been made into a persona video: the maker
  // notes the persona video a start went into (PersonaVideo.usedIn), read
  // against what Vids still has, so deleting the persona video frees the hook
  // again. One made before that note was kept is known by its name instead —
  // a persona video is named after its start unless the name was typed over.
  const liveIds = new Set(vids?.personas.map((p) => p.id));
  const madeNames = new Set(made.map((p) => p.name.trim().toLowerCase()));
  const isUsed = (v: PersonaVideo) =>
    v.usedIn.some((id) => liveIds.has(id)) || madeNames.has(v.sceneName.trim().toLowerCase())
    // And one on its way there now.
    || jobs.some((j) => j.startId === v.id && !j.error);

  async function run(what: Busy, action: () => Promise<unknown>) {
    setBusy(what);
    setError('');
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  function rename() {
    const next = name.trim();
    if (!next) { setName(persona.name); return; }
    if (next !== persona.name) void run('name', () => updatePersona(persona.id, { name: next }));
  }

  function replacePhoto(file: File) {
    const problem = photoProblem(file);
    setError(problem);
    if (!problem) void run('photo', async () => updatePersona(persona.id, { photoPath: await uploadFile('photo', file) }));
  }

  const side = (
    <div className="grid gap-5">
      <div className="flex items-center gap-3">
        <span className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-zinc-900">
          {persona.avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={persona.avatarUrl} alt="" className={`h-full w-full object-cover ${busy === 'avatar' ? 'opacity-40' : ''}`} />
          )}
          {busy === 'avatar' && <SpinnerIcon size={18} className="absolute animate-spin text-white" />}
        </span>
        <button
          type="button"
          onClick={() => void run('avatar', () => makeAvatar(persona.id))}
          disabled={!!busy}
          className="text-xs text-zinc-400 transition-colors hover:text-white disabled:opacity-40"
        >
          {busy === 'avatar' ? 'Making a profile pic…' : persona.avatarUrl ? 'New profile pic' : 'Make a profile pic'}
        </button>
      </div>

      <div className="grid gap-1.5">
        <span className={LABEL}>Character photo</span>
        <DropZone accept={PHOTO_TYPES.join(',')} onFile={replacePhoto} disabled={!!busy} label="Replace the character photo" className="relative grid place-items-center rounded-md">
          {/* The small copy: the photo itself can be tens of megabytes, and
              was most of what this page waited on. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={persona.thumbUrl} alt="" decoding="async" className={`w-full object-contain ${busy === 'photo' ? 'opacity-40' : ''}`} />
          {busy === 'photo' && <SpinnerIcon size={22} className="absolute animate-spin text-white" />}
        </DropZone>
        <span className="text-[11px] text-zinc-600">Drop a new photo on it, or click, to replace it.</span>
      </div>

      <label className={`grid gap-1.5 ${LABEL}`}>
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_CHARS))}
          onBlur={rename}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          disabled={busy === 'delete'}
          className={`${FIELD} h-9 normal-case tracking-normal`}
        />
      </label>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <ConfirmButton
        onConfirm={() => run('delete', async () => { await deletePersona(persona.id); onBack(); })}
        disabled={!!busy}
        armedLabel={`Click again to delete ${persona.name}${persona.videos.length ? ' and its videos' : ''}`}
        className="w-fit border border-transparent text-xs text-zinc-600 transition-colors hover:text-white"
      >
        Delete this character
      </ConfirmButton>
    </div>
  );

  const pickedAs = (v: PersonaVideo) => {
    const i = quick ? quick.findIndex((p) => p.id === v.id) : -1;
    return i < 0 ? null : `${i + 1} · ${QUICK_SLOTS[i]}`;
  };

  // It takes the whole page: the editor it opens needs the room.
  if (making) return <PersonaVideoMaker persona={persona} onClose={() => { setMaking(false); void onChanged(); }} />;

  const none = !persona.videos.length;
  return (
    <Split title={persona.name} backLabel="Characters" onBack={onBack} side={side}>
      {/* Quick make: press it, press three videos below in the order they
          play, press Done. The bar stays in view while the videos are picked. */}
      <div className={`mb-6 flex flex-wrap items-center gap-2 ${quick ? 'sticky top-0 z-10 -mx-1 rounded-lg border border-emerald-400/50 bg-black px-3 py-2.5' : ''}`}>
        {!quick ? (
          <>
            <button
              type="button"
              onClick={() => setQuick([])}
              disabled={none}
              title={none ? 'This character has no videos yet' : 'Press three videos — start, middle, end — and Done: saved to Vids as one persona video, with no editing'}
              className={PRIMARY}
            >
              Quick make
            </button>
            <button
              type="button"
              onClick={() => setMaking(true)}
              disabled={none}
              title={none ? 'This character has no videos yet' : 'Pick a start, a middle and an end from these videos, edit each, and save them to Vids as one persona video'}
              className={GHOST}
            >
              Make with editing
            </button>
          </>
        ) : (
          <>
            <span className="text-sm">
              {quick.length < QUICK_SLOTS.length
                ? `Press the ${QUICK_SLOTS[quick.length].toLowerCase()} video`
                : 'Three picked'}
              <span className="ml-2 text-xs tabular-nums text-zinc-500">{quick.length} of 3</span>
            </span>
            <span className="flex-1" />
            <button type="button" onClick={quickDone} disabled={quick.length !== QUICK_SLOTS.length} className={PRIMARY}>Done</button>
            <button type="button" onClick={() => setQuick(null)} className={GHOST}>{jobs.length ? 'Finish' : 'Cancel'}</button>
          </>
        )}
        {/* Every one Done was pressed on: saving behind the page, saved, or not. */}
        {jobs.length > 0 && (
          <ul className="grid w-full gap-1 pt-1">
            {jobs.map((j) => (
              <li key={j.id} className="flex items-center gap-2 text-xs">
                {j.error
                  ? <span className="text-red-400">✕</span>
                  : j.done
                    ? <span className="text-emerald-400">✓</span>
                    : <SpinnerIcon size={12} className="animate-spin text-zinc-400" />}
                <span className="min-w-0 truncate text-zinc-200">{j.name}</span>
                <span className={`min-w-0 flex-1 truncate tabular-nums ${j.error ? 'text-red-400' : 'text-zinc-500'}`} title={j.error || undefined}>
                  {j.error || (j.done ? 'saved to Vids' : j.text)}
                </span>
              </li>
            ))}
            {!saving && (
              <li>
                <button type="button" onClick={() => setJobs([])} className="text-[11px] text-zinc-600 transition-colors hover:text-white">Clear the list</button>
              </li>
            )}
          </ul>
        )}
      </div>
      {none ? (
        <p className="text-sm text-zinc-500">No videos yet. They land here when a scene with {persona.name} in it is approved.</p>
      ) : (
        TAKE_SECTIONS.map((section) => {
          const videos = persona.videos.filter((v) => takeSection(v.sceneName) === section.key);
          return (
            <section key={section.key} className="mb-8">
              <h2 className="mb-3 text-sm font-semibold">
                {section.label} <span className="ml-1 text-xs font-normal tabular-nums text-zinc-500">{videos.length}</span>
              </h2>
              {videos.length === 0 ? (
                <p className="text-xs text-zinc-600">
                  {section.key === 'hook' ? 'None.' : `None — a video with “${section.key}” in its name is listed here.`}
                </p>
              ) : (
                <div className={CARDS}>
                  {videos.map((v) => (
                    <TakeCard
                      key={v.id}
                      video={v}
                      fileName={`${fileSlug(v.sceneName)}-${fileSlug(persona.name)}.mp4`}
                      disabled={!!busy}
                      used={section.key === 'hook' && isUsed(v)}
                      pickedAs={pickedAs(v)}
                      onPick={quick ? () => quickPick(v) : undefined}
                      onRename={(next) => void run('video', () => renameTake(v.id, next))}
                      onDelete={() => void run('video', () => deleteTake(v.id))}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}

      {/* What has been made of them already: this character's persona videos
          in Vids — the ones under the persona of the same name there. */}
      <h2 className="mb-3 mt-2 text-sm font-semibold">
        Persona videos <span className="ml-1 text-xs font-normal tabular-nums text-zinc-500">{vids ? made.length : ''}</span>
      </h2>
      {!vids ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500"><SpinnerIcon size={13} className="animate-spin" /> Reading Vids…</p>
      ) : made.length === 0 ? (
        <p className="max-w-[560px] text-sm leading-relaxed text-zinc-500">
          None yet. A video made with “Make persona video” is filed under {persona.name} in Vids and is listed here —
          as is any other video moved to {persona.name} there.
        </p>
      ) : (
        <div className={CARDS}>
          {made.map((p) => (
            <MadeVideo
              key={p.id}
              persona={p}
              clips={PERSONA_PARTS.map((part) => vids.videos.find((v) => v.id === p[part])).filter((c): c is VidRow => !!c)}
              onChanged={async () => setVids(await listLibrary())}
            />
          ))}
        </div>
      )}
    </Split>
  );
}
