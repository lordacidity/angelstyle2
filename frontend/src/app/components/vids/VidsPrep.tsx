'use client';

// VidsPrep — page one of the Vids section: get footage in, make each clip what
// you want it to be, and file it.
//
//   Left    the folder rows, and the clips of whichever list is open. Click a
//           clip to edit it; drag it onto a folder to file it. There is no drop
//           panel up here any more — everything new comes in through the middle
//           — but the pane still takes a drop that misses a folder, and files it
//           in the Inbox.
//   Right   the editor for the open clip — trim, cut, speed, sound, save — or,
//           while nothing is open, the intake stage: the whole middle is a drop
//           target, and a drop runs the pipeline in VidsIntake. One clip walks
//           folder → context → edit → save; three at once is taken to be a
//           persona and walks name + one context → trim each of the three.
//           Dropping onto a folder on the left still just files footage, and
//           clicking a clip still opens it on its own — the pipeline is a way
//           through, not the only way in.
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
import type { PersonaPart, VidContext, VidContextPatch, VidFolder, VidMark, VidPersona, VidRow } from '@/lib/vids-types';
import { PERSONA_PARTS, PERSONA_PART_LABEL, isPhoto } from '@/lib/vids-types';
import { MEDIA_ONLY, isMediaFile, isVideoFile, type VidsLib } from '../../hooks/useVidsLibrary';
import {
  LIBRARY_FOLDERS, PERSONA_FOLDER, SLOT_META, VID_DRAG_MIME, folderGroupIds, isPersonaFolderName,
  slotForFolderName,
} from '@/lib/vidsPlan';
import { VidsClipEditor, type ContextOwner } from './VidsClipEditor';
import { VidsContextDialog } from './VidsContext';
import {
  PERSONA_DROP, VidsIntakeBanner, VidsIntakeStage, hasFiles, hasVid,
  type FolderChoice, type Intake,
} from './VidsIntake';
import { VidPreview, fmtBytes } from './VidPreview';
import { fmtTime } from '@/lib/utils';
import { CloseIcon, SpinnerIcon, TrashIcon, UploadIcon, VideoIcon } from '@/lib/icons';

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Which list the left pane is showing: the unfiled Inbox, one folder group, or
 *  a single persona (`persona:<id>`). */
const INBOX = '__inbox__';
const personaKey = (id: string) => `persona:${id}`;
const personaOf = (list: string) => (list.startsWith('persona:') ? list.slice('persona:'.length) : null);

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
        title={`${v.name} — click to edit it, drag to file it, right-click for context`}
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
        ? `${label} — ${video.name} — click to edit it, right-click for the persona's context`
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

export function VidsPrep({ lib, active }: { lib: VidsLib; active: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
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
  const openVideo = videoById(openId) ?? null;

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

  const saveContext = useCallback((target: { kind: 'clip' | 'persona'; id: string }, patch: VidContextPatch) => {
    if (target.kind === 'persona') void lib.updatePersona(target.id, patch);
    else void lib.setVideoContext(target.id, patch);
  }, [lib]);

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
        title: p.name,
        hint: 'What this persona is doing — shared by its Start, Top A and Top B.',
        value: { context: p.context },
      };
    }
    const v = lib.videos.find((x) => x.id === ctxTarget.id);
    return v && {
      title: v.name,
      hint: 'What this clip is showing, in your words.',
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
  // A run is a plan, not a lock: it holds the files, where they are going, the
  // rows as their uploads land, and which one it is standing on. Saving in the
  // editor moves it on; cancelling leaves everything it already did in place.
  const [intake, setIntake] = useState<Intake | null>(null);
  // Read from callbacks that run after an await, where the closure's copy would
  // be a render behind.
  const intakeRef = useRef<Intake | null>(null);
  useEffect(() => { intakeRef.current = intake; }, [intake]);
  // Bumped whenever a run starts or stops, so an upload loop from an abandoned
  // one can tell it is no longer the one steering the page.
  const runRef = useRef(0);

  const cancelIntake = useCallback(() => {
    runRef.current++;
    setIntake(null);
  }, []);

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

  /** Push a run's files up one at a time, dropping each row into the run as it
   *  lands so the first clip can be edited while the rest are still going. */
  const runUploads = useCallback(async (
    token: number,
    files: File[],
    folderId: string | null,
    nameOf: (i: number) => string,
    onRow?: (i: number, row: VidRow) => Promise<void> | void,
  ) => {
    for (let i = 0; i < files.length; i++) {
      const row = await lib.uploadBlob(files[i], nameOf(i), folderId);
      if (row && onRow) await onRow(i, row);
      // A run that has been called off stops steering the page, but the footage
      // still goes up: you dropped it, so it belongs in the library either way.
      if (runRef.current !== token) continue;
      if (!row) break;   // it failed — the upload list on the left says why
      setIntake((prev) => (prev ? { ...prev, rows: prev.rows.map((r, n) => (n === i ? row : r)) } : prev));
    }
    if (runRef.current === token) setIntake((prev) => (prev ? { ...prev, busy: false } : prev));
  }, [lib]);

  const startIntake = useCallback((files: FileList | File[]) => {
    const list = Array.from(files).filter(isMediaFile);
    if (list.length === 0) { lib.setError(MEDIA_ONLY); return; }
    runRef.current++;
    setOpenId(null);
    // Three files is a persona only when all three are footage: a persona is one
    // performance, and a photo is never part of one.
    const persona = list.length === PERSONA_DROP && list.every(isVideoFile);
    setIntake({
      mode: persona ? 'persona' : 'clips',
      step: persona ? 'setup' : 'folder',
      files: list,
      folderId: persona ? personaFolderId : null,
      folderName: persona ? PERSONA_FOLDER : 'Inbox',
      rows: list.map(() => null),
      index: 0,
      personaId: null,
      personaName: '',
      busy: false,
    });
  }, [lib, personaFolderId]);

  const chooseFolder = useCallback((choice: FolderChoice) => {
    if (!intake) return;
    const token = ++runRef.current;
    setIntake({ ...intake, step: 'context', folderId: choice.id, folderName: choice.name, busy: true });
    void runUploads(token, intake.files, choice.id, (i) => intake.files[i].name);
  }, [intake, runUploads]);

  /** The persona exists from the moment its name is given, and each of its three
   *  parts is pointed at its clip as that upload lands — so a run interrupted
   *  halfway leaves a real persona with the parts it got, not a stray file. */
  const startPersona = useCallback(async (name: string, context: VidContext, order: File[]) => {
    if (!intake) return;
    const token = ++runRef.current;
    const persona = await lib.createPersona(name);
    if (!persona) { setIntake(null); return; }   // lib.error says why
    if (context.context) void lib.updatePersona(persona.id, context);
    if (runRef.current !== token) return;
    setIntake((prev) => (prev ? {
      ...prev,
      step: 'edit',
      files: order,
      rows: order.map(() => null),
      folderId: personaFolderId,
      folderName: PERSONA_FOLDER,
      personaId: persona.id,
      personaName: persona.name,
      index: 0,
      busy: true,
    } : prev));
    setList(personaKey(persona.id));
    void runUploads(
      token,
      order,
      personaFolderId,
      (i) => `${persona.name} — ${PERSONA_PART_LABEL[PERSONA_PARTS[i]]}`,
      (i, row) => lib.updatePersona(persona.id, { [PERSONA_PARTS[i]]: row.id }),
    );
  }, [intake, lib, personaFolderId, runUploads]);

  /** Three files that turn out not to be a persona: nothing has been uploaded
   *  yet at that point, so it just becomes an ordinary run. */
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

  /** What this clip is showing, then straight into the editor — unless it is a
   *  photo, which has nothing to trim, cut or listen to: saying what it shows is
   *  the whole of filing one, so the run goes straight on to the next. */
  const intakeContext = useCallback((name: string, context: VidContext) => {
    if (!intake) return;
    const row = intake.rows[intake.index];
    if (!row) return;
    void lib.renameVideo(row.id, name);
    if (context.context) void lib.setVideoContext(row.id, context);
    if (isPhoto(row)) advanceIntake();
    else setIntake({ ...intake, step: 'edit' });
  }, [intake, lib, advanceIntake]);

  // A run standing on a clip that has finished uploading is a clip in the
  // editor: this is the only thing that opens one on the run's behalf, so the
  // step it is on and what is on screen can't drift apart.
  useEffect(() => {
    if (intake?.step !== 'edit') return;
    const id = intake.rows[intake.index]?.id;
    if (id) setOpenId(id);
  }, [intake]);

  /** Clicking a clip while a run is going. One of the run's own clips moves the
   *  run onto it. Anything else ends a run that had a clip open — you have left
   *  it, and nothing more should be saved on its behalf — but a run still asking
   *  a question keeps its place and puts the question back when you close this. */
  const openClip = useCallback((id: string | null) => {
    setOpenId(id);
    const cur = intakeRef.current;
    if (!cur) return;
    const at = id ? cur.rows.findIndex((r) => r?.id === id) : -1;
    if (at >= 0 && cur.step !== 'done') setIntake({ ...cur, index: at, step: 'edit' });
    else if (cur.step === 'edit' || cur.step === 'done') cancelIntake();
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

  // The edit goes back over the clip it came from: same row, same folder, same
  // persona part — only the footage changes. Saving is also what moves a run on,
  // so the last thing you do to a clip is the thing that hands you the next one.
  //
  // `videoId` comes from the editor rather than from what is open here: a render
  // takes long enough that another clip can be open by the time it lands, and the
  // bytes belong to the clip they were made from.
  // No blob means the editor found nothing about the footage to change — the
  // clip was only renamed, so the row takes the name and the bytes in the bucket
  // are left exactly where they are. Marks are already saved as they are made,
  // so there is nothing else to carry over. Either way the run moves on.
  const saveEdited = useCallback(async (
    blob: Blob | null, name: string, hasSfx: boolean, marks: VidMark[], videoId: string,
  ) => {
    if (blob) {
      const row = await lib.replaceVideo(videoId, blob, name, hasSfx, marks);
      if (!row) throw new Error('Saving failed — see the message on the left.');
    } else {
      await lib.renameVideo(videoId, name);
    }
    const cur = intakeRef.current;
    if (cur?.step !== 'edit' || cur.rows[cur.index]?.id !== videoId) return;
    setIntake((prev) => (prev
      ? { ...prev, rows: prev.rows.map((r) => (r?.id === videoId ? { ...r, name } : r)) }
      : prev));
    advanceIntake();
  }, [lib, advanceIntake]);

  // Closing the clip a run has open ends the run — otherwise it would just put
  // the same clip straight back. A run that is only holding a question is left
  // alone: closing here is how you get back to it.
  const closeEditor = useCallback(() => {
    setOpenId(null);
    if (intakeRef.current?.step === 'edit') cancelIntake();
  }, [cancelIntake]);

  /** The run, only while the clip on screen really is the one it is standing on
   *  — what the banner, the trim-only editor and the Save label all key off. */
  const run = intake?.step === 'edit' && intake.rows[intake.index]?.id === openId ? intake : null;

  /** Whether the Persona row is showing its personas. Pressed open by hand, and
   *  forced open whenever one of them is what you are looking at or naming. */
  const personaShown = personaOpen || personaOf(list) !== null || newPersona !== null;

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

      {/* Right: the editor once a clip is open, the intake stage until then —
          the middle of the page is never dead space. */}
      {openVideo && !isPhoto(openVideo) ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {run && (
            <VidsIntakeBanner intake={run} onSkip={advanceIntake} onCancel={cancelIntake} />
          )}
          <VidsClipEditor
            video={openVideo}
            onSave={saveEdited}
            active={active}
            onClose={closeEditor}
            contextOwner={contextOwner}
            onMarksChange={(marks) => { if (openId) void lib.setVideoMarks(openId, marks); }}
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
          />
        </div>
      ) : (
        <VidsIntakeStage
          intake={intake}
          choices={folderChoices}
          onFiles={startIntake}
          onOpenClip={openClip}
          onChooseFolder={chooseFolder}
          onStartPersona={(name, context, order) => void startPersona(name, context, order)}
          onFileAsClips={fileAsClips}
          onContext={intakeContext}
          onCancel={cancelIntake}
        />
      )}

      {openVideo && isPhoto(openVideo) && (
        <VidPreview video={openVideo} onClose={closeEditor} />
      )}

      {ctxTarget && ctxDialog && (
        <VidsContextDialog
          title={ctxDialog.title}
          hint={ctxDialog.hint}
          value={ctxDialog.value}
          onSave={(patch) => saveContext(ctxTarget, patch)}
          onClose={() => setCtxTarget(null)}
        />
      )}
    </div>
  );
}
