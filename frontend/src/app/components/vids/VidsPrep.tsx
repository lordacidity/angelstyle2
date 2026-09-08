'use client';

// VidsPrep — page one of the Vids section: get footage in, make each clip what
// you want it to be, and file it.
//
//   Left    the folder rows, and the clips of whichever list is open. Click a
//           clip to edit it; drag it onto a folder to file it. There is no drop
//           panel up here any more — everything new comes in through the middle
//           — but the pane still takes a drop that misses a folder, and files it
//           in the Inbox.
//   Right   three pages under one strip:
//           Upload   the intake stage: the whole middle is a drop target, and
//                    a drop runs the pipeline in VidsIntake. One clip walks
//                    folder → context → edit → save; three at once is taken
//                    to be a persona and walks name + one context → trim each
//                    of the three. Dropping onto a folder on the left still
//                    just files footage, and clicking a clip still opens it
//                    on its own — the pipeline is a way through, not the only
//                    way in.
//           Edit     the editor for the open clip — trim, cut, speed, sound,
//                    save. Opening a clip from anywhere lands here.
//           Link     which Bottom Bs follow on from which Bottom A
//                    (VidsLinks) — what the builder's Bottom B picker and its
//                    Random button go by.
//           A run turns the page for you — Upload while it is asking
//           something, Edit once it has a clip open — and all three stay
//           mounted, so nothing half-done is lost to a look elsewhere.
//
// Right-click says what a piece of footage is showing: a clip's thumbnail opens
// the context popup for that clip, a persona row (or one of its part tiles) for
// the whole bundle — a persona's three clips are one performance, so they share
// one context rather than carrying three.
//
// Personas hang off the Persona row as folders of their own: open one and you
// see its three parts — Start, Top A, Top B — each of which opens in the editor
// on a click, takes a different clip on a drop, and unlinks on the ×. That way a
// persona is somewhere you can work rather than three tiles on a card. The row
// starts closed — press it to see them — since most of the filing done here is
// bottom clips, and a long persona list pushed the other folders off-screen.
//
// Page two (the builder) is where these clips get stacked into a video, so
// nothing here knows about slots: this page is only ever about one clip at a time.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { PersonaPart, VidContext, VidFolder, VidMark, VidPersona, VidRow } from '@/lib/vids-types';
import { PERSONA_PARTS, PERSONA_PART_LABEL, isPhoto } from '@/lib/vids-types';
import { MEDIA_ONLY, isMediaFile, isVideoFile, type VidsLib } from '../../hooks/useVidsLibrary';
import {
  LIBRARY_FOLDERS, PERSONA_FOLDER, SLOT_META, VID_DRAG_MIME, folderGroupIds, isPersonaFolderName,
  slotForFolderName,
} from '@/lib/vidsPlan';
import { VidsClipEditor, type ContextOwner } from './VidsClipEditor';
import { VidsContextDialog, type VidsContextSave } from './VidsContext';
import {
  PERSONA_DROP, VidsIntakeBanner, VidsIntakeStage, hasFiles, hasVid,
  type FolderChoice, type Intake, type LocalRow,
} from './VidsIntake';
import { VidPreview, fmtBytes } from './VidPreview';
import { VidsLinks } from './VidsLinks';
import { fmtTime } from '@/lib/utils';
import { CloseIcon, SpinnerIcon, TrashIcon, UploadIcon, VideoIcon } from '@/lib/icons';

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Which list the left pane is showing: the unfiled Inbox, one folder group, or
 *  a single persona (`persona:<id>`). */
const INBOX = '__inbox__';
const personaKey = (id: string) => `persona:${id}`;
const personaOf = (list: string) => (list.startsWith('persona:') ? list.slice('persona:'.length) : null);

/** The ids of an intake run's local rows — clips still on the disk, not yet
 *  saved — so the editor's saves and mark edits know where to write. */
const LOCAL_PREFIX = 'local:';
const isLocalId = (id: string | null | undefined): id is string => !!id && id.startsWith(LOCAL_PREFIX);

/** The three pages on the right. */
type Tab = 'upload' | 'edit' | 'link';
const TABS: { id: Tab; label: string }[] = [
  { id: 'upload', label: 'Upload' },
  { id: 'edit',   label: 'Edit' },
  { id: 'link',   label: 'Link' },
];

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${open ? 'text-amber-300' : 'text-zinc-500'}`}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function InboxIcon({ open }: { open: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${open ? 'text-sky-300' : 'text-zinc-500'}`}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

function ListRow({ label, count, selected, icon, indent, tone, title, expanded, onToggle, onSelect, onDrop, onDelete, onContext }: {
  label: string;
  count: number | string;
  selected: boolean;
  icon: React.ReactNode;
  indent?: boolean;
  tone?: 'ok' | 'partial';
  title?: string;
  /** Given a toggle, the row grows a chevron and shows this state. Only the
   *  Persona row has children of its own to show or hide. */
  expanded?: boolean;
  onToggle?: () => void;
  onSelect: () => void;
  onDrop: (e: DragEvent) => void;
  onDelete?: () => void;
  /** Right-click — used by persona rows to open their context popup. */
  onContext?: () => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      title={title ?? `${label} — drop clips here to file them`}
      onClick={onSelect}
      onContextMenu={onContext ? (e) => { e.preventDefault(); onContext(); } : undefined}
      // dragenter as well as dragover: both have to be taken for this to win the
      // drop, otherwise it falls through to the pane behind and the file lands in
      // the Inbox instead of here.
      onDragEnter={(e) => {
        if (!hasVid(e) && !hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!hasVid(e) && !hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = hasVid(e) ? 'move' : 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); onDrop(e); }}
      className={`group flex cursor-pointer items-center gap-1.5 rounded-md px-2 text-[11px] ${indent ? 'ml-3' : ''} ${
        over ? 'bg-emerald-900/40 ring-1 ring-emerald-600'
          : selected ? 'bg-zinc-800 text-white' : 'text-zinc-300 hover:bg-zinc-900'
      }`}
    >
      {onToggle && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          title={expanded ? 'Hide what is in here' : 'Show what is in here'}
          className="-ml-1 shrink-0 p-0.5 text-zinc-500 hover:text-white"
        >
          <svg
            width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform ${expanded ? '' : '-rotate-90'}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}
      {icon}
      <span className="min-w-0 flex-1 truncate py-1.5">{label}</span>
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete this persona (its clips stay in the folder)"
          className="hidden p-0.5 text-zinc-500 hover:text-red-400 group-hover:block"
        >
          <TrashIcon size={11} />
        </button>
      )}
      <span className={`text-[10px] ${tone === 'ok' ? 'text-emerald-400' : tone === 'partial' ? 'text-amber-400' : 'text-zinc-600'}`}>
        {count || ''}
      </span>
    </div>
  );
}

function ClipCard({ v, open, onOpen, onDelete, onContext }: {
  v: VidRow; open: boolean; onOpen: () => void; onDelete: () => void; onContext: () => void;
}) {
  return (
    <div
      onContextMenu={(e) => { e.preventDefault(); onContext(); }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(VID_DRAG_MIME, v.id);
        e.dataTransfer.effectAllowed = 'copyMove';
      }}
      className={`group relative overflow-hidden rounded-md border bg-zinc-950 ${
        open ? 'border-sky-500' : 'border-zinc-800 hover:border-zinc-600'
      }`}
    >
      <button
        onClick={onOpen}
        title={`${v.name} — click to edit it, drag to file it, right-click to rename it or say what it shows`}
        className="block h-20 w-full bg-black"
      >
        {v.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.thumbUrl} alt="" className="h-full w-full object-contain" draggable={false} />
        ) : (
          <span className="flex h-full items-center justify-center text-zinc-700"><VideoIcon size={20} /></span>
        )}
      </button>
      <div className="px-2 py-1">
        <p className="truncate text-[10px] text-zinc-200" title={v.name}>{v.name}</p>
        <p className="text-[9px] text-zinc-500">
          {isPhoto(v) ? 'Photo' : v.duration != null ? fmtTime(v.duration) : '–:––'} · {fmtBytes(v.sizeBytes)}
        </p>
        {v.context && (
          <p className="truncate text-[9px] italic text-sky-300/70" title={v.context}>{v.context}</p>
        )}
      </div>
      <button
        onClick={onDelete}
        title="Delete from the cloud"
        className="absolute right-1 top-1 hidden rounded bg-black/70 p-1 text-zinc-400 hover:text-red-400 group-hover:block"
      >
        <TrashIcon size={12} />
      </button>
      {open && (
        <span className="absolute left-1 top-1 rounded bg-sky-600/90 px-1 py-px text-[9px] font-medium text-white">Editing</span>
      )}
    </div>
  );
}

/** One part of an open persona: click to edit that clip, drop to change it. */
function PartCard({ label, video, open, busy, onOpen, onFiles, onVideoId, onClear, onContext }: {
  label: string;
  video: VidRow | undefined;
  open: boolean;
  busy: boolean;
  onOpen: () => void;
  onFiles: (files: FileList | File[]) => void;
  onVideoId: (id: string) => void;
  onClear: () => void;
  /** Right-click — the persona's context, since the three parts share one. */
  onContext: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      title={video
        ? `${label} — ${video.name} — click to edit it, right-click for the persona's name and context`
        : `${label} — drop a clip here, or click to choose a file`}
      onContextMenu={(e) => { e.preventDefault(); onContext(); }}
      draggable={!!video}
      onDragStart={(e) => {
        if (!video) return;
        e.dataTransfer.setData(VID_DRAG_MIME, video.id);
        e.dataTransfer.effectAllowed = 'copyMove';
      }}
      // dragenter as well as dragover: both have to be taken for this to win the
      // drop, otherwise it falls through to the pane behind and the file lands in
      // the Inbox instead of here.
      onDragEnter={(e) => {
        if (!hasVid(e) && !hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!hasVid(e) && !hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = hasVid(e) ? 'move' : 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!hasVid(e) && !hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const id = e.dataTransfer.getData(VID_DRAG_MIME);
        if (id) { onVideoId(id); return; }
        if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
      }}
      className={`group relative overflow-hidden rounded-md border ${
        over ? 'border-emerald-500 bg-emerald-950/30'
          : open ? 'border-sky-500 bg-zinc-950'
          : video ? 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'
          : 'border-dashed border-zinc-700 bg-zinc-950 hover:border-zinc-500'
      }`}
    >
      <input
        ref={fileRef}
        type="file"
        accept="video/*,.mov,.mkv"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <button
        onClick={() => { if (video) onOpen(); else fileRef.current?.click(); }}
        className="flex h-20 w-full items-center justify-center bg-black"
      >
        {video?.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={video.thumbUrl} alt="" className="h-full w-full object-contain" draggable={false} />
        ) : video ? (
          <VideoIcon size={18} className="text-zinc-700" />
        ) : busy ? (
          <span className="text-[10px] text-zinc-500">uploading…</span>
        ) : (
          <UploadIcon size={16} className="text-zinc-700" />
        )}
      </button>
      <div className="flex items-center gap-1 px-2 py-1">
        <span className={`text-[10px] font-semibold ${video ? 'text-zinc-200' : 'text-zinc-500'}`}>{label}</span>
        <span className="min-w-0 flex-1 truncate text-[9px] text-zinc-600" title={video?.name}>
          {video ? video.name : 'empty'}
        </span>
        <span className="shrink-0 font-mono text-[9px] text-zinc-600">
          {video?.duration != null ? fmtTime(video.duration) : ''}
        </span>
      </div>
      {video && (
        <button
          onClick={onClear}
          title={`Unlink this clip from ${label} — it stays in the Persona folder`}
          className="absolute right-1 top-1 hidden rounded bg-black/80 p-1 text-zinc-400 hover:text-red-400 group-hover:block"
        >
          <CloseIcon size={10} />
        </button>
      )}
      {open && (
        <span className="absolute left-1 top-1 rounded bg-sky-600/90 px-1 py-px text-[9px] font-medium text-white">Editing</span>
      )}
    </div>
  );
}

/** The Edit page with nothing open: how to open something. A run that is
 *  asking a question on the Upload page is pointed back to. */
function EditIdle({ waiting, onUpload }: { waiting: boolean; onUpload: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-6">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-800 px-8 text-center">
        <VideoIcon size={30} className="text-zinc-700" />
        <p className="mt-3 text-[14px] font-semibold text-zinc-100">Nothing open</p>
        <p className="mt-1 max-w-[420px] text-[11px] leading-relaxed text-zinc-500">
          {waiting
            ? 'Your drop is waiting on a question on the Upload page.'
            : 'Click a clip on the left to open it here — trim it, cut it, change its speed, lay the keys over it, save.'}
        </p>
        {waiting ? (
          <button
            onClick={onUpload}
            className="mt-4 rounded bg-white px-3 py-1 text-[11px] font-medium text-black hover:bg-zinc-200"
          >
            Back to it
          </button>
        ) : (
          <p className="mt-4 text-[10px] text-zinc-600">New footage goes in on the Upload page.</p>
        )}
      </div>
    </div>
  );
}

export function VidsPrep({ lib, active }: { lib: VidsLib; active: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('upload');
  const [list, setList] = useState<string>(INBOX);
  const [paneOver, setPaneOver] = useState(false);
  // The Persona row is closed until you press it. Naming a new one, or landing
  // on a persona from anywhere else (a finished intake run, say), forces it open
  // without anyone having to remember to — hence derived rather than an effect.
  const [personaOpen, setPersonaOpen] = useState(false);
  const [newPersona, setNewPersona] = useState<string | null>(null);
  const [busyPart, setBusyPart] = useState<PersonaPart | null>(null);
  // Which thing the right-click popup is asking about, if it is up.
  const [ctxTarget, setCtxTarget] = useState<{ kind: 'clip' | 'persona'; id: string } | null>(null);
  // The intake run, if one is going — see the Intake section below. Declared
  // up here because the clip on screen can be one of its local rows.
  const [intake, setIntake] = useState<Intake | null>(null);
  /** Change one of the run's local rows — its name, context or marks as they
   *  are given, kept there for the editor to show and the save to send. */
  const patchLocal = useCallback((id: string, patch: Partial<VidRow>) => {
    setIntake((prev) => (prev
      ? { ...prev, local: prev.local.map((r) => (r.id === id ? { ...r, ...patch } : r)) }
      : prev));
  }, []);
  // dragenter/dragleave fire for every child crossed; count them so the
  // highlight only drops once the pointer truly leaves the pane.
  const paneDepth = useRef(0);

  // The four fixed folders, each standing for every same-named top-level folder
  // plus anything nested under it — same rule the library pane uses, so a
  // duplicate folder never strands clips out of sight.
  const groups = useMemo(
    () => LIBRARY_FOLDERS.map((name) => ({
      name,
      canonical: lib.folders
        .filter((f) => !f.parentId && sameName(f.name, name))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] as VidFolder | undefined,
      ids: folderGroupIds(lib.folders, name),
    })),
    [lib.folders],
  );

  const personaGroup = groups.find((g) => isPersonaFolderName(g.name));
  const personaFolderId = personaGroup?.canonical?.id ?? null;

  const countIn = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of lib.videos) {
      if (!v.folderId) continue;
      m.set(v.folderId, (m.get(v.folderId) ?? 0) + 1);
    }
    return m;
  }, [lib.videos]);

  const unfiled = useMemo(() => lib.videos.filter((v) => !v.folderId), [lib.videos]);
  const openPersonaId = personaOf(list);
  const openPersona = openPersonaId ? lib.personas.find((p) => p.id === openPersonaId) ?? null : null;

  const shown = useMemo(() => {
    if (list === INBOX) return unfiled;
    const g = groups.find((x) => x.name === list);
    return g ? lib.videos.filter((v) => v.folderId && g.ids.has(v.folderId)) : [];
  }, [list, unfiled, groups, lib.videos]);

  // What the Link page pairs up: everything filed under Bottom A and Bottom B.
  const clipsIn = useCallback((name: string) => {
    const g = groups.find((x) => sameName(x.name, name));
    return g ? lib.videos.filter((v) => v.folderId && g.ids.has(v.folderId)) : [];
  }, [groups, lib.videos]);
  const bottomAClips = useMemo(() => clipsIn(SLOT_META.bottomA.folder), [clipsIn]);
  const bottomBClips = useMemo(() => clipsIn(SLOT_META.bottomB.folder), [clipsIn]);

  // Clips filed under Persona that this persona isn't already using — what an
  // open persona offers as swap-ins for its three parts.
  const personaSpares = useMemo(() => {
    if (!openPersona || !personaGroup) return [];
    const mine = new Set(PERSONA_PARTS.map((k) => openPersona[k]).filter(Boolean) as string[]);
    return lib.videos.filter((v) => v.folderId && personaGroup.ids.has(v.folderId) && !mine.has(v.id));
  }, [openPersona, personaGroup, lib.videos]);

  const videoById = useCallback(
    (id: string | null | undefined) => (id ? lib.videos.find((v) => v.id === id) : undefined),
    [lib.videos],
  );
  /** A run's local row by id — a clip the editor plays off the disk. */
  const localById = useCallback(
    (id: string | null | undefined) => (isLocalId(id) ? intake?.local.find((r) => r.id === id) : undefined),
    [intake],
  );
  const openVideo = videoById(openId) ?? localById(openId) ?? null;

  // ── Context ──
  // What a piece of footage is showing. An ordinary clip carries its own; the
  // three clips of a persona are one performance, so their context lives on the
  // persona and every way in redirects there.
  const personaOfVideo = useCallback(
    (id: string | null | undefined) =>
      (id ? lib.personas.find((p) => PERSONA_PARTS.some((k) => p[k] === id)) ?? null : null),
    [lib.personas],
  );

  const contextOwner = useMemo<ContextOwner | null>(() => {
    if (!openVideo) return null;
    const persona = personaOfVideo(openVideo.id);
    return persona
      ? { id: persona.id, kind: 'persona', name: persona.name, value: { context: persona.context } }
      : { id: openVideo.id, kind: 'clip', name: openVideo.name, value: { context: openVideo.context } };
  }, [openVideo, personaOfVideo]);

  // The editor's panel sends the context alone; the right-click popup can send
  // a new name with it. Both land on the clip or on the persona the same way.
  const saveContext = useCallback((target: { kind: 'clip' | 'persona'; id: string }, patch: VidsContextSave) => {
    if (target.kind === 'persona') void lib.updatePersona(target.id, patch);
    else if (isLocalId(target.id)) patchLocal(target.id, patch);
    else void lib.setVideoContext(target.id, patch);
  }, [lib, patchLocal]);

  /** Right-clicking a clip that a persona is using asks about the persona. */
  const askClipContext = useCallback((v: VidRow) => {
    const persona = personaOfVideo(v.id);
    setCtxTarget(persona ? { kind: 'persona', id: persona.id } : { kind: 'clip', id: v.id });
  }, [personaOfVideo]);

  // What the popup shows, resolved live so an edit elsewhere can't leave it
  // sitting on a clip or persona that has since gone.
  const ctxDialog = useMemo(() => {
    if (!ctxTarget) return null;
    if (ctxTarget.kind === 'persona') {
      const p = lib.personas.find((x) => x.id === ctxTarget.id);
      return p && {
        kind: 'persona' as const,
        name: p.name,
        hint: 'Its name, and what it is doing — shared by its Start, Top A and Top B.',
        value: { context: p.context },
      };
    }
    const v = lib.videos.find((x) => x.id === ctxTarget.id);
    return v && {
      kind: 'clip' as const,
      name: v.name,
      hint: 'What to call this clip, and what it is showing, in your words.',
      value: { context: v.context },
    };
  }, [ctxTarget, lib.personas, lib.videos]);

  const dropInto = (folderId: string | null) => (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    paneDepth.current = 0;
    setPaneOver(false);
    const vid = e.dataTransfer.getData(VID_DRAG_MIME);
    if (vid) { void lib.moveVideo(vid, folderId); return; }
    if (e.dataTransfer.files.length) void lib.uploadFiles(e.dataTransfer.files, folderId);
  };

  const confirmDelete = (v: VidRow) => {
    if (!window.confirm(`Delete "${v.name}" from the cloud for everyone?`)) return;
    if (v.id === openId) setOpenId(null);
    void lib.deleteVideo(v);
  };

  // ── Intake ──
  // Footage dropped on the middle of the page doesn't just land in the Inbox: it
  // starts a run that asks the few things a clip needs and then puts the editor
  // in front of you. Three files at once is a persona — Start, Top A and Top B
  // are shot together — so that run asks for one name and one context and then
  // walks the three, trimming only.
  //
  // Nothing is uploaded until the end. Each file plays in the editor straight
  // off the disk, as a local row standing in for the clip it will become, and
  // Save is what files it: the bytes go up with the name, the context and the
  // marks already on them, into the folder the run chose. A clip skipped, or a
  // run cancelled, was never saved anywhere. A photo has nothing to edit, so
  // naming it is what files it.
  //
  // A run is a plan, not a lock: it holds the files, where they are going, the
  // rows as their saves land, and which one it is standing on. (`intake` itself
  // is declared up with the other state — the clip on screen can be one of its
  // local rows.)
  //
  // Read from callbacks that run after an await, where the closure's copy would
  // be a render behind.
  const intakeRef = useRef<Intake | null>(null);
  useEffect(() => { intakeRef.current = intake; }, [intake]);
  // Bumped whenever a run starts or stops, so a save from an abandoned one can
  // tell it is no longer the one steering the page.
  const runRef = useRef(0);
  // The object URLs the run's local rows play from, let go when the run ends.
  const localUrls = useRef<string[]>([]);

  /** A row that stands in for a file until it is saved — the same shape the
   *  editor and the context panel already take, playing off the disk. The
   *  editor reads the length off the footage itself, so it is left unknown. */
  const localRow = useCallback((file: File, name: string): LocalRow => {
    const url = URL.createObjectURL(file);
    localUrls.current.push(url);
    return {
      file,
      id: `${LOCAL_PREFIX}${crypto.randomUUID()}`,
      folderId: null,
      name,
      storagePath: '',
      thumbPath: null,
      mimeType: file.type || 'video/mp4',
      sizeBytes: file.size,
      duration: null,
      width: null,
      height: null,
      createdAt: new Date().toISOString(),
      url,
      thumbUrl: null,
      context: '',
      marks: [],
      hasSfx: false,
    };
  }, []);

  /** End the run outright: whatever it saved stays, the local rows are let go. */
  const endRun = useCallback(() => {
    runRef.current++;
    for (const u of localUrls.current) URL.revokeObjectURL(u);
    localUrls.current = [];
    setOpenId(null);
    setIntake(null);
  }, []);

  /** Stop the run. Whatever it hadn't saved yet was never anywhere but the
   *  disk, so a run with clips still waiting asks first. Says whether it
   *  actually ended. */
  const cancelIntake = useCallback((): boolean => {
    const cur = intakeRef.current;
    if (cur && cur.step !== 'done') {
      const left = cur.files.length - cur.rows.filter(Boolean).length;
      const what = left === 1 ? "The clip you dropped hasn't" : `${left} of the clips you dropped haven't`;
      if (left > 0 && !window.confirm(`Stop here? ${what} been saved, and won't be — nothing goes up until an edit is saved.`)) {
        return false;
      }
    }
    endRun();
    return true;
  }, [endRun]);

  /** Where a run can file footage: the Inbox, or one of the fixed folders with
   *  the reason it exists said in the words the builder uses. */
  const folderChoices = useMemo<FolderChoice[]>(() => {
    const out: FolderChoice[] = [{ id: null, name: 'Inbox', hint: 'unfiled — decide later, on the left' }];
    for (const g of groups) {
      if (!g.canonical) continue;
      const slot = slotForFolderName(g.name);
      out.push({
        id: g.canonical.id,
        name: g.name,
        hint: slot ? SLOT_META[slot].hint : 'footage for the three clips a persona is made of',
      });
    }
    return out;
  }, [groups]);

  const startIntake = useCallback((files: FileList | File[]) => {
    const list = Array.from(files).filter(isMediaFile);
    if (list.length === 0) { lib.setError(MEDIA_ONLY); return; }
    // A finished run still on screen makes way; a live one never gets here,
    // since the stage takes no drop while it is asking something.
    endRun();
    // Three files is a persona only when all three are footage: a persona is one
    // performance, and a photo is never part of one.
    const persona = list.length === PERSONA_DROP && list.every(isVideoFile);
    setIntake({
      mode: persona ? 'persona' : 'clips',
      step: persona ? 'setup' : 'folder',
      files: list,
      local: list.map((f) => localRow(f, f.name)),
      folderId: persona ? personaFolderId : null,
      folderName: persona ? PERSONA_FOLDER : 'Inbox',
      rows: list.map(() => null),
      index: 0,
      personaId: null,
      personaName: '',
      personaContext: '',
      saving: false,
    });
  }, [lib, personaFolderId, endRun, localRow]);

  /** The folder is only remembered here — nothing goes to it until a save. */
  const chooseFolder = useCallback((choice: FolderChoice) => {
    setIntake((prev) => (prev ? { ...prev, step: 'context', folderId: choice.id, folderName: choice.name } : prev));
  }, []);

  /** Persona setup is done: the three take their parts' names, in the order
   *  given, and go straight to trimming. The persona itself is made when the
   *  first trim is saved, alongside that part — so a run cancelled before then
   *  leaves nothing behind, not even an empty persona. */
  const startPersona = useCallback((name: string, context: VidContext, order: File[]) => {
    if (!intake) return;
    const clean = name.trim();
    const local = order.map((f, i) => ({
      ...(intake.local[intake.files.indexOf(f)] ?? localRow(f, f.name)),
      name: `${clean} — ${PERSONA_PART_LABEL[PERSONA_PARTS[i]]}`,
    }));
    setIntake({
      ...intake,
      step: 'edit',
      files: order,
      local,
      rows: order.map(() => null),
      folderId: personaFolderId,
      folderName: PERSONA_FOLDER,
      personaId: null,
      personaName: clean,
      personaContext: context.context,
      index: 0,
    });
  }, [intake, personaFolderId, localRow]);

  /** Three files that turn out not to be a persona: nothing has been uploaded
   *  at that point (nothing ever is until a save), so it just becomes an
   *  ordinary run. */
  const fileAsClips = useCallback(() => {
    setIntake((prev) => (prev ? { ...prev, mode: 'clips', step: 'folder' } : prev));
  }, []);

  /** This clip is done with — on to the next, or the run is over. */
  const advanceIntake = useCallback(() => {
    setOpenId(null);
    setIntake((prev) => {
      if (!prev) return prev;
      const next = prev.index + 1;
      if (next >= prev.files.length) return { ...prev, step: 'done' };
      return { ...prev, index: next, step: prev.mode === 'persona' ? 'edit' : 'context' };
    });
  }, []);

  /** The clip's name and what it is showing, kept on its local row for the
   *  editor to open with — then straight into the editor. A photo has nothing
   *  to trim, cut or listen to, so naming it is the whole of filing one: it is
   *  saved right here, and the run goes on to the next. */
  const intakeContext = useCallback(async (name: string, context: VidContext) => {
    const cur = intakeRef.current;
    const row = cur?.local[cur.index];
    if (!cur || !row) return;
    if (!isPhoto(row)) {
      setIntake((prev) => (prev ? {
        ...prev,
        step: 'edit',
        local: prev.local.map((r) => (r.id === row.id ? { ...r, name, context: context.context } : r)),
      } : prev));
      return;
    }
    const token = runRef.current;
    const at = cur.index;
    setIntake((prev) => (prev ? { ...prev, saving: true } : prev));
    const saved = await lib.uploadBlob(row.file, name, cur.folderId, { context: context.context });
    if (runRef.current !== token) return;
    setIntake((prev) => (prev ? { ...prev, saving: false } : prev));
    // It failed — the upload list on the left says why, and the run stays put.
    if (!saved) return;
    setIntake((prev) => (prev ? { ...prev, rows: prev.rows.map((r, n) => (n === at ? saved : r)) } : prev));
    advanceIntake();
  }, [lib, advanceIntake]);

  // A run standing on a clip is that clip in the editor, playing off the disk:
  // this is the only thing that opens one on the run's behalf, so the step it
  // is on and what is on screen can't drift apart. It also turns the page to
  // wherever the run is — Edit once it has a clip, Upload while it is asking
  // something — keyed on the step and the clip rather than the whole run, so a
  // mark or a context typed against the clip doesn't keep pulling you back if
  // you went to look at something else.
  const intakeStep = intake?.step ?? null;
  const intakeClipId = intake?.step === 'edit' ? (intake.local[intake.index]?.id ?? null) : null;
  useEffect(() => {
    if (!intakeStep) return;
    if (intakeStep === 'edit') {
      if (intakeClipId) { setOpenId(intakeClipId); setTab('edit'); }
      return;
    }
    setTab('upload');
  }, [intakeStep, intakeClipId]);

  /** Clicking a clip while a run is going. A run that had a clip open ends
   *  first — you have left it — and asks before dropping anything unsaved; if
   *  you keep the run, the click does nothing. A run still asking a question
   *  keeps its place and puts the question back when you close this. */
  const openClip = useCallback((id: string | null) => {
    const cur = intakeRef.current;
    if (cur && (cur.step === 'edit' || cur.step === 'done') && !cancelIntake()) return;
    setOpenId(id);
    if (id) setTab('edit');
  }, [cancelIntake]);

  // ── Personas ──
  // A part points at an ordinary clip filed under Persona, so attaching one is
  // "move it there, then point at it" — exactly what the library pane does.
  const attachVideo = useCallback(async (persona: VidPersona, part: PersonaPart, id: string) => {
    const row = videoById(id);
    if (row && row.folderId !== personaFolderId) await lib.moveVideo(id, personaFolderId);
    await lib.updatePersona(persona.id, { [part]: id });
  }, [lib, personaFolderId, videoById]);

  const attachFiles = useCallback(async (persona: VidPersona, part: PersonaPart, files: FileList | File[]) => {
    const file = Array.from(files)[0];
    if (!file) return;
    setBusyPart(part);
    try {
      const row = await lib.uploadBlob(file, `${persona.name} — ${PERSONA_PART_LABEL[part]}`, personaFolderId);
      if (row) await lib.updatePersona(persona.id, { [part]: row.id });
    } finally {
      setBusyPart(null);
    }
  }, [lib, personaFolderId]);

  /** Dropping onto a persona row fills the first part it hasn't got. */
  const dropOnPersona = (persona: VidPersona) => (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const part = PERSONA_PARTS.find((k) => !persona[k]) ?? PERSONA_PARTS[0];
    const id = e.dataTransfer.getData(VID_DRAG_MIME);
    if (id) { void attachVideo(persona, part, id); return; }
    if (e.dataTransfer.files.length) void attachFiles(persona, part, e.dataTransfer.files);
  };

  const commitNewPersona = async () => {
    const name = (newPersona ?? '').trim();
    setNewPersona(null);
    if (!name) return;
    const p = await lib.createPersona(name);
    if (p) setList(personaKey(p.id));
  };

  // Save is what files a clip. For a row the run holds locally, the bytes go up
  // here for the first time — the edit as rendered, or the file as dropped when
  // the editor found nothing to change — with the name, the context and the
  // marks on them, into the folder the run chose; then the run moves on. A
  // persona's part goes up the same way, and the persona is made with its
  // first part. A clip already in the library takes the edit over itself: same
  // row, same folder, same persona part — only the footage changes. No blob
  // there means the editor found nothing about the footage to change, so the
  // row just takes the name.
  //
  // `videoId` comes from the editor rather than from what is open here: a render
  // takes long enough that another clip can be open by the time it lands, and the
  // bytes belong to the clip they were made from.
  const saveEdited = useCallback(async (
    blob: Blob | null, name: string, hasSfx: boolean, marks: VidMark[], videoId: string,
  ) => {
    if (!isLocalId(videoId)) {
      if (blob) {
        const row = await lib.replaceVideo(videoId, blob, name, hasSfx, marks);
        if (!row) throw new Error('Saving failed — see the message on the left.');
      } else {
        await lib.renameVideo(videoId, name);
      }
      return;
    }

    const cur = intakeRef.current;
    const at = cur ? cur.local.findIndex((r) => r.id === videoId) : -1;
    if (!cur || at < 0) throw new Error('This clip is no longer part of a run — drop it again to file it.');
    const token = runRef.current;
    const row = await lib.uploadBlob(blob ?? cur.local[at].file, name, cur.folderId, {
      context: cur.local[at].context, marks, hasSfx,
    });
    if (!row) throw new Error('Saving failed — see the message on the left.');
    // The run was called off while this went up. The clip is saved either way —
    // it was already on its way — but nothing more is done on the run's behalf.
    if (runRef.current !== token) return;

    if (cur.mode === 'persona') {
      const part = PERSONA_PARTS[at];
      const personaId = intakeRef.current?.personaId ?? null;
      if (personaId) {
        await lib.updatePersona(personaId, { [part]: row.id });
      } else {
        const persona = await lib.createPersona(cur.personaName, { [part]: row.id });
        if (!persona) throw new Error('The clip is saved, but the persona could not be made — see the message on the left.');
        if (cur.personaContext) void lib.updatePersona(persona.id, { context: cur.personaContext });
        setIntake((prev) => (prev ? { ...prev, personaId: persona.id } : prev));
        setList(personaKey(persona.id));
      }
    }
    setIntake((prev) => (prev ? { ...prev, rows: prev.rows.map((r, n) => (n === at ? row : r)) } : prev));
    const now = intakeRef.current;
    if (now?.step === 'edit' && now.index === at) advanceIntake();
  }, [lib, advanceIntake]);

  // Closing the clip a run has open ends the run — otherwise it would just put
  // the same clip straight back — asking first if clips are still waiting, and
  // leaving the clip open if you keep the run. A run that is only holding a
  // question is left alone: closing here is how you get back to it.
  const closeEditor = useCallback(() => {
    if (intakeRef.current?.step === 'edit') { cancelIntake(); return; }
    setOpenId(null);
  }, [cancelIntake]);

  /** The run, only while the clip on screen really is the one it is standing on
   *  — what the banner, the trim-only editor and the Save label all key off. */
  const run = intake?.step === 'edit' && intake.local[intake.index]?.id === openId ? intake : null;

  /** Whether the Persona row is showing its personas. Pressed open by hand, and
   *  forced open whenever one of them is what you are looking at or naming. */
  const personaShown = personaOpen || personaOf(list) !== null || newPersona !== null;

  /** One line beside the strip saying what the open page is for. */
  const tabHint = tab === 'upload'
    ? 'Drop footage in the middle. One clip walks through folder, name, edit and save; three at once make a persona.'
    : tab === 'edit'
      ? (openVideo ? `Editing ${openVideo.name}` : 'Click a clip on the left to open it here.')
      : 'Pick a Bottom A, then tick the Bottom Bs that follow it. Build offers only those, and Random picks its pairs from here.';

  return (
    <div className="flex min-h-0 flex-1">
      {/* Left: upload + filing */}
      <div
        title={paneOver ? undefined : 'Drop onto a folder to file it there — anywhere else in here goes to the Inbox'}
        className={`relative flex w-[320px] shrink-0 flex-col border-r transition-colors ${
          paneOver ? 'border-emerald-700 bg-emerald-950/20' : 'border-zinc-800'
        }`}
        onDragEnter={(e) => { if (!hasFiles(e)) return; paneDepth.current++; setPaneOver(true); }}
        onDragLeave={(e) => {
          if (!hasFiles(e)) return;
          paneDepth.current = Math.max(0, paneDepth.current - 1);
          if (paneDepth.current === 0) setPaneOver(false);
        }}
        onDragOver={(e) => {
          if (!hasFiles(e) && !hasVid(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = hasVid(e) ? 'move' : 'copy';
        }}
        onDrop={dropInto(null)}
      >
        {lib.error && (
          <div className="mx-2 mt-2 flex items-start gap-2 rounded border border-red-900 bg-red-950/40 px-2 py-1.5 text-[11px] text-red-300">
            <span className="flex-1 break-words">{lib.error}</span>
            <button onClick={() => lib.setError(null)} className="text-red-400 hover:text-white"><CloseIcon size={11} /></button>
          </div>
        )}

        {/* Whatever is still going up. The drop panel that used to sit here is
            gone — the middle of the page is the way footage comes in now, and
            two drop targets side by side only made you pick one. */}
        {lib.uploads.length > 0 && (
          <div className="shrink-0 border-b border-zinc-800 p-3">
            {lib.uploads.map((u) => (
              <div key={u.id} className="mb-1.5 last:mb-0">
                <div className="flex items-center gap-2 text-[10px]">
                  <span className={`flex-1 truncate ${u.error ? 'text-red-300' : 'text-zinc-300'}`} title={u.error ?? u.name}>{u.name}</span>
                  <span className="font-mono text-zinc-500">
                    {u.error ? 'failed' : u.done ? 'done' : `${Math.round(u.progress * 100)}%`}
                  </span>
                  {(u.error || u.done) && (
                    <button onClick={() => lib.dismissUpload(u.id)} className="text-zinc-500 hover:text-white"><CloseIcon size={10} /></button>
                  )}
                </div>
                {u.error ? (
                  <p className="text-[10px] text-red-400">{u.error}</p>
                ) : (
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-800">
                    <div className={`h-full ${u.done ? 'bg-emerald-500' : 'bg-white'}`} style={{ width: `${u.progress * 100}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Where a finished clip goes */}
        <div className="max-h-[40%] shrink-0 overflow-y-auto border-y border-zinc-800 px-1.5 py-1.5">
          <ListRow
            label="Inbox"
            count={unfiled.length}
            selected={list === INBOX}
            icon={<InboxIcon open={list === INBOX} />}
            onSelect={() => setList(INBOX)}
            onDrop={dropInto(null)}
          />
          {groups.map((g) => (
            <div key={g.name}>
              <ListRow
                label={g.name}
                count={[...g.ids].reduce((n, id) => n + (countIn.get(id) ?? 0), 0)}
                selected={list === g.name}
                icon={<FolderIcon open={list === g.name} />}
                expanded={isPersonaFolderName(g.name) ? personaShown : undefined}
                onToggle={isPersonaFolderName(g.name) ? () => setPersonaOpen((o) => !o) : undefined}
                /* Pressing the Persona row opens it, and pressing it again once
                   it is the row you are already on puts it away. Every other
                   folder just selects. */
                onSelect={() => {
                  if (isPersonaFolderName(g.name)) setPersonaOpen(list === g.name ? !personaShown : true);
                  setList(g.name);
                }}
                onDrop={g.canonical ? dropInto(g.canonical.id) : () => {}}
              />
              {/* Each persona is a folder of its own under Persona */}
              {isPersonaFolderName(g.name) && personaShown && (
                <>
                  {lib.personas.map((p) => {
                    const filled = PERSONA_PARTS.filter((k) => p[k]).length;
                    return (
                      <ListRow
                        key={p.id}
                        label={p.name}
                        count={`${filled}/3`}
                        tone={filled === PERSONA_PARTS.length ? 'ok' : 'partial'}
                        indent
                        selected={list === personaKey(p.id)}
                        icon={<FolderIcon open={list === personaKey(p.id)} />}
                        title={`${p.name}${p.context ? ` — ${p.context}` : ''} — right-click to give it context`}
                        onSelect={() => setList(personaKey(p.id))}
                        onDrop={dropOnPersona(p)}
                        onContext={() => setCtxTarget({ kind: 'persona', id: p.id })}
                        onDelete={() => {
                          if (!window.confirm(`Delete persona "${p.name}"? Its clips stay in the Persona folder — nothing is deleted from the cloud.`)) return;
                          if (list === personaKey(p.id)) setList(PERSONA_FOLDER);
                          void lib.deletePersona(p.id);
                        }}
                      />
                    );
                  })}
                  {newPersona !== null ? (
                    <input
                      autoFocus
                      value={newPersona}
                      placeholder="Persona name"
                      onChange={(e) => setNewPersona(e.target.value)}
                      onBlur={() => void commitNewPersona()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitNewPersona();
                        if (e.key === 'Escape') setNewPersona(null);
                      }}
                      className="ml-3 mt-1 w-[calc(100%-0.75rem)] rounded border border-zinc-600 bg-black px-2 py-1 text-[11px] text-white outline-none"
                    />
                  ) : (
                    <button
                      onClick={() => setNewPersona('')}
                      className="ml-3 px-2 py-1 text-[10px] text-zinc-500 hover:text-white"
                    >
                      + New persona
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>

        {/* What the open list holds */}
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {openPersona ? (
            <div>
              <p className="mb-1.5 text-[10px] text-zinc-500">
                {openPersona.name} — click a part to edit that clip, drop a clip on it to swap it,
                right-click for this persona’s context.
              </p>
              <div className="space-y-1.5">
                {PERSONA_PARTS.map((part) => (
                  <PartCard
                    key={part}
                    label={PERSONA_PART_LABEL[part]}
                    video={videoById(openPersona[part])}
                    open={!!openPersona[part] && openPersona[part] === openId}
                    busy={busyPart === part}
                    onOpen={() => openClip(openPersona[part])}
                    onFiles={(files) => void attachFiles(openPersona, part, files)}
                    onVideoId={(id) => void attachVideo(openPersona, part, id)}
                    onClear={() => void lib.updatePersona(openPersona.id, { [part]: null })}
                    onContext={() => setCtxTarget({ kind: 'persona', id: openPersona.id })}
                  />
                ))}
              </div>

              {/* Spare footage in the Persona folder — drag one onto a part above
                  to swap it in without leaving this persona. */}
              {personaSpares.length > 0 && (
                <div className="mt-3 border-t border-zinc-800 pt-2">
                  <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-600">
                    In the Persona folder · {personaSpares.length}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {personaSpares.map((v) => (
                      <ClipCard
                        key={v.id}
                        v={v}
                        open={v.id === openId}
                        onOpen={() => openClip(v.id)}
                        onDelete={() => confirmDelete(v)}
                        onContext={() => askClipContext(v)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : lib.loading && shown.length === 0 ? (
            <div className="flex justify-center py-8 text-zinc-600"><SpinnerIcon size={16} className="animate-spin" /></div>
          ) : shown.length === 0 ? (
            <div className="flex h-full min-h-[100px] flex-col items-center justify-center rounded-md border border-dashed border-zinc-800 p-4 text-center">
              <p className="text-[11px] text-zinc-400">{list === INBOX ? 'Nothing waiting' : `${list} is empty`}</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-600">
                {list === INBOX
                  ? 'Drop footage in the middle of the page, or drag a filed clip back here.'
                  : 'Drag a clip from the Inbox onto this folder.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {shown.map((v) => (
                <ClipCard
                  key={v.id}
                  v={v}
                  open={v.id === openId}
                  onOpen={() => openClip(v.id)}
                  onDelete={() => confirmDelete(v)}
                  onContext={() => askClipContext(v)}
                />
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Right: three pages under one strip — Upload (the intake stage, and the
          questions a run asks), Edit (the open clip), Link (Bottom A → Bottom
          B). All three stay mounted: switching away from a half-done edit, a
          half-typed name or a chosen Bottom A must not lose it. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b border-zinc-800 px-4 py-2">
          <div className="flex overflow-hidden rounded-md border border-zinc-700">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1 text-[11px] font-medium transition-colors ${
                  tab === t.id ? 'bg-zinc-200 text-black' : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="min-w-0 flex-1 truncate text-[10px] text-zinc-500" title={tabHint}>{tabHint}</p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col" style={{ display: tab === 'upload' ? undefined : 'none' }}>
          <VidsIntakeStage
            intake={intake}
            choices={folderChoices}
            onFiles={startIntake}
            onOpenClip={openClip}
            onChooseFolder={chooseFolder}
            onStartPersona={startPersona}
            onFileAsClips={fileAsClips}
            onContext={intakeContext}
            onCancel={cancelIntake}
            onResume={() => setTab('edit')}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col" style={{ display: tab === 'edit' ? undefined : 'none' }}>
          {openVideo && !isPhoto(openVideo) ? (
            <>
              {run && (
                <VidsIntakeBanner intake={run} onSkip={advanceIntake} onCancel={cancelIntake} />
              )}
              <VidsClipEditor
                video={openVideo}
                onSave={saveEdited}
                active={active && tab === 'edit'}
                onClose={closeEditor}
                contextOwner={contextOwner}
                onMarksChange={(marks) => {
                  if (isLocalId(openId)) patchLocal(openId, { marks });
                  else if (openId) void lib.setVideoMarks(openId, marks);
                }}
                onContextChange={(patch) => {
                  if (contextOwner) saveContext({ kind: contextOwner.kind, id: contextOwner.id }, patch);
                }}
                // A persona's clips only get trimmed, and the run's own Save is what
                // hands over the next one — except Top A, which loops under the whole
                // bottom sequence in a build. That is the one place jump cuts have to
                // be made, so it gets Cut and Auto cut on top of the in / out points.
                mode={run?.mode !== 'persona'
                  ? 'full'
                  : PERSONA_PARTS[run.index] === 'topAId' ? 'cut' : 'trim'}
                saveLabel={run
                  ? (run.index >= run.files.length - 1 ? 'Save · finish' : 'Save · next clip')
                  : undefined}
                savingLabel={run ? `Saving to ${run.folderName}…` : undefined}
              />
            </>
          ) : (
            <EditIdle
              waiting={!!intake && intake.step !== 'edit' && intake.step !== 'done'}
              onUpload={() => setTab('upload')}
            />
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col" style={{ display: tab === 'link' ? undefined : 'none' }}>
          <VidsLinks
            bottomA={bottomAClips}
            bottomB={bottomBClips}
            links={lib.links}
            onSetLinks={(a, bs) => void lib.setLinks(a, bs)}
          />
        </div>
      </div>

      {openVideo && isPhoto(openVideo) && (
        <VidPreview video={openVideo} onClose={closeEditor} />
      )}

      {ctxTarget && ctxDialog && (
        <VidsContextDialog
          kind={ctxDialog.kind}
          name={ctxDialog.name}
          hint={ctxDialog.hint}
          value={ctxDialog.value}
          onSave={(patch) => saveContext(ctxTarget, patch)}
          onClose={() => setCtxTarget(null)}
        />
      )}
    </div>
  );
}
