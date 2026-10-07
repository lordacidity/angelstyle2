'use client';

// VidsPrep — page one of the Vids section: the personas, and their videos.
//
// The words, since they changed on 2026-10-02:
//   persona         a person — Blorky, Dorky, Aiden. In the library it is a
//                   folder under the top-level Persona folder
//                   (lib/vids-persona-folders).
//   persona video   one video of that person doing something — "Walk In",
//                   "Chipotle". It is what a build picks and what gets moved
//                   about here. In code it is still a VidPersona, and it is
//                   still made of three clips (Start, Top A, Top B), but those
//                   are its insides: nothing on this page asks you to think
//                   about them unless you open a video to edit it.
//
//   Left    the upload, as a narrow strip: drop one video (it is trimmed three
//           times, for the three parts) or three (one each), name it, say
//           whose it is, trim. Under it, whatever is still rendering or going
//           up.
//   Right   most of the page, and what the page is for: the personas down its
//           left edge with a way to make one, and beside them the videos of
//           whichever persona is pressed, as tiles. A video is moved to its
//           persona by dragging its tile onto the name, or with the Move to
//           list on the tile; the ones nobody has attributed yet sit under
//           "No persona". The pencil renames a persona, the trash deletes it
//           (its videos stay, under No persona), and the switch beside the
//           count says whether the clippers get them: off, every video of that
//           persona is ours alone, whatever its own switch on the Clippers
//           page says, and so is one made of them later. Right-click a video to rename
//           it, move it or say what he is doing in it. Dropping footage onto a
//           persona's name starts the upload with that persona already chosen.
//           Clicking a video opens its three clips, and clicking one of those
//           opens it in the editor — the only place the parts show. While a
//           clip is open (that way, or by a run that is trimming one) the
//           editor has this whole side, until it is closed.
//           (What the clippers' app gets is its own page of the section,
//           beside this one — see VidsClippers.)
//
// Videos are made here and in AI Persona ("Make persona video"), and after
// that they are mostly just used. The Inbox, Bottom B and End folders this
// page used to list are gone from it — nobody files those by hand any more.
// They are still in the library, and a build still takes its End from the End
// folder; they are only not shown here. (VidsIntake still knows how to walk
// loose clips into a folder; nothing on this page starts that run now.)
//
// A video being walked in saves its Start and its Top A behind you: Save
// moves straight on to the next part while that one renders and goes up (the
// list top left says how far along it is). Only the last part is waited for.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type {
  PersonaPart, VidContext, VidEdit, VidFolder, VidMark, VidPersona, VidRow, VidTheme,
} from '@/lib/vids-types';
import { PERSONA_PARTS, PERSONA_PART_LABEL, isPhoto } from '@/lib/vids-types';
import { MEDIA_ONLY, isMediaFile, isVideoFile, type VidsLib } from '../../hooks/useVidsLibrary';
import { PERSONA_FOLDER, intakeSpeed, isPersonaFolderName, slotForFolderName } from '@/lib/vidsPlan';
import { UNFILED_LABEL, groupPersonas, personaFolders } from '@/lib/vids-persona-folders';
import { VidsClipEditor, type ClipSaveJob, type ContextOwner } from './VidsClipEditor';
import { VidsContextDialog, type VidsContextSave } from './VidsContext';
import {
  PERSONA_DROP, VidsIntakeBanner, VidsIntakeStage, hasFiles,
  type FolderChoice, type Intake, type LocalRow,
} from './VidsIntake';
import { VidPreview } from './VidPreview';
import { fmtTime } from '@/lib/utils';
import { CloseIcon, SpinnerIcon, TrashIcon, UploadIcon, VideoIcon } from '@/lib/icons';

/** What the left pane is showing: one persona's videos (`group:<folder id>`,
 *  or `group:${UNFILED}` for the videos in no persona), or one video opened
 *  up to its three clips (`persona:<id>`). */
const GROUP = 'group:';
const UNFILED = '__unfiled__';
const groupList = (folderId: string | null) => `${GROUP}${folderId ?? UNFILED}`;
const personaKey = (id: string) => `persona:${id}`;
const personaOf = (list: string) => (list.startsWith('persona:') ? list.slice('persona:'.length) : null);

/** A video's tile being dragged onto a persona — its own drag, so nothing that
 *  takes clips or files mistakes it for one. */
const VIDEO_DRAG_MIME = 'application/x-pauv-persona';
const hasVideo = (e: DragEvent) => Array.from(e.dataTransfer.types).includes(VIDEO_DRAG_MIME);

/** A video's part saving behind the editor: rendering, then going up. */
interface BackSave { id: string; name: string; frac: number; error: string | null }

/** The ids of an intake run's local rows — clips still on the disk, not yet
 *  saved — so the editor's saves and mark edits know where to write. */
const LOCAL_PREFIX = 'local:';
const isLocalId = (id: string | null | undefined): id is string => !!id && id.startsWith(LOCAL_PREFIX);

/** What a video's three clips are called where they are shown: where each
 *  plays in a build. (PERSONA_PART_LABEL has the library's own names for them —
 *  Start, Top A, Top B — which is what the clips themselves are named after.) */
const PART_SAID: Record<PersonaPart, string> = { startId: 'Start', topAId: 'Middle', topBId: 'End' };

/** The folders a run of loose clips could be filed in: none, from this page. */
const NO_FOLDERS: readonly FolderChoice[] = [];

/** The clipper switch on a persona's row — green is on offer, grey is ours
 *  alone. It is the person's, so it has the last word over the switch each of
 *  their videos carries on the Clippers page: off, not one of them reaches the
 *  clippers' app, and nor does one added to them later. */
function OfferSwitch({ on, label, onChange }: {
  on: boolean;
  label: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={`${label} — on offer to the clippers`}
      title={on
        ? `${label} is on offer to the clippers — switch off to keep every video of theirs ours alone`
        : `${label} is ours alone — switch on to offer the clippers their videos`}
      onClick={(e) => { e.stopPropagation(); onChange(!on); }}
      className={`relative h-3.5 w-6 shrink-0 rounded-full transition-colors ${
        on ? 'bg-emerald-500' : 'bg-zinc-700 hover:bg-zinc-600'
      }`}
    >
      <span
        className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white shadow transition-[left] ${on ? 'left-3' : 'left-0.5'}`}
      />
    </button>
  );
}

/** One persona on the list — a person — with a still of one of their videos
 *  and how many they have. Pressing it shows the videos below. A video dragged
 *  onto it becomes theirs; footage dropped on it starts a new video of them. */
function PersonaRow({
  label, count, thumb, selected, title, clipable, onSelect, onVideoDrop, onFiles, onRename, onDelete, onClipable,
}: {
  label: string;
  count: number;
  thumb: string | null;
  selected: boolean;
  title: string;
  /** Whether the clippers get this persona — see OfferSwitch. */
  clipable: boolean;
  onSelect: () => void;
  onVideoDrop: (personaVideoId: string) => void;
  /** Left out on the "No persona" row, which is nobody to make a video of. */
  onFiles?: (files: FileList) => void;
  onRename?: () => void;
  onDelete?: () => void;
  onClipable?: (on: boolean) => void;
}) {
  const [over, setOver] = useState(false);
  const takes = (e: DragEvent) => hasVideo(e) || (!!onFiles && hasFiles(e));
  return (
    <div
      title={title}
      onClick={onSelect}
      // dragenter as well as dragover: both have to be taken for the row to
      // win the drop.
      onDragEnter={(e) => { if (!takes(e)) return; e.preventDefault(); e.stopPropagation(); setOver(true); }}
      onDragOver={(e) => {
        if (!takes(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = hasVideo(e) ? 'move' : 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!takes(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const id = e.dataTransfer.getData(VIDEO_DRAG_MIME);
        if (id) { onVideoDrop(id); return; }
        if (e.dataTransfer.files.length) onFiles?.(e.dataTransfer.files);
      }}
      className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] ${
        over ? 'bg-emerald-900/40 ring-1 ring-emerald-600'
          : selected ? 'bg-zinc-800 text-white' : 'text-zinc-300 hover:bg-zinc-900'
      }`}
    >
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-black ${thumb ? '' : 'border border-dashed border-zinc-700'}`}>
        {thumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="h-full w-full object-cover" draggable={false} />
        )}
      </span>
      <span className={`min-w-0 flex-1 truncate font-medium ${onClipable && !clipable ? 'text-zinc-500' : ''}`}>
        {label}
      </span>
      {onRename && (
        <button
          onClick={(e) => { e.stopPropagation(); onRename(); }}
          title="Rename this persona"
          className="hidden p-0.5 text-zinc-500 hover:text-white group-hover:block"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </button>
      )}
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete this persona (its videos stay, under No persona)"
          className="hidden p-0.5 text-zinc-500 hover:text-red-400 group-hover:block"
        >
          <TrashIcon size={11} />
        </button>
      )}
      {onClipable && <OfferSwitch on={clipable} label={label} onChange={onClipable} />}
      <span className="text-[10px] tabular-nums text-zinc-500">{count}</span>
    </div>
  );
}

/** One persona video, as a tile: its picture, its name, and whose it is — the
 *  list under the name moves it. Drag it onto a persona to do the same; click
 *  it to open its three clips; right-click to rename it or say what he is
 *  doing in it. */
function VideoCard({ video, thumb, filled, people, onOpen, onMove, onDelete, onDegen, onContext }: {
  video: VidPersona;
  thumb: string | null;
  /** How many of its three clips it has. */
  filled: number;
  /** The personas it can be moved to. */
  people: readonly VidFolder[];
  onOpen: () => void;
  onMove: (folderId: string | null) => void;
  onDelete: () => void;
  onDegen: () => void;
  onContext: () => void;
}) {
  const mine = people.some((f) => f.id === video.folderId) ? video.folderId ?? '' : '';
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(VIDEO_DRAG_MIME, video.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onContextMenu={(e) => { e.preventDefault(); onContext(); }}
      title={`${video.name}${video.context ? ` — ${video.context}` : ''} — drag it onto a persona to move it, click to open it, right-click to rename it`}
      className="group relative overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 hover:border-zinc-600"
    >
      <button onClick={onOpen} className="block h-48 w-full bg-black">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="h-full w-full object-contain" draggable={false} />
        ) : (
          <span className="flex h-full items-center justify-center text-zinc-700"><VideoIcon size={20} /></span>
        )}
      </button>
      <div className="px-2 py-1.5">
        <p className="truncate text-[12px] font-medium text-zinc-200">{video.name}</p>
        <select
          value={mine}
          onChange={(e) => onMove(e.target.value || null)}
          onClick={(e) => e.stopPropagation()}
          title="Whose video this is"
          className={`mt-1 w-full rounded border bg-black px-1 py-0.5 text-[10px] outline-none focus:border-zinc-400 ${
            mine ? 'border-zinc-800 text-zinc-400' : 'border-amber-700/70 text-amber-200'
          }`}
        >
          <option value="">{mine ? 'No persona' : 'Move to…'}</option>
          {people.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>
      <div className="absolute left-1 top-1 flex gap-1">
        {filled < PERSONA_PARTS.length && (
          <span title="It is missing a clip — open it to add one" className="rounded bg-black/80 px-1 text-[9px] font-bold text-amber-300">{filled}/3</span>
        )}
        {!video.clipable && (
          <span title="Off for the clippers — switch it on the Clippers page" className="rounded bg-black/80 px-1 text-[9px] text-zinc-400">ours</span>
        )}
      </div>
      <div className="absolute right-1 top-1 flex gap-1">
        <button
          onClick={onDegen}
          aria-pressed={video.degen}
          title={video.degen ? 'Degen — click to make it not degen' : 'Not degen — click to make it degen'}
          className={`rounded bg-black/75 px-1 py-0.5 text-[10px] leading-none transition ${
            video.degen ? 'ring-1 ring-amber-400/80' : 'hidden opacity-60 grayscale hover:opacity-100 hover:grayscale-0 group-hover:block'
          }`}
        >
          💀
        </button>
        <button
          onClick={onDelete}
          title="Delete this video (its footage stays in the cloud)"
          className="hidden rounded bg-black/75 p-1 text-zinc-400 hover:text-red-400 group-hover:block"
        >
          <TrashIcon size={11} />
        </button>
      </div>
    </div>
  );
}

/** One of an open video's three clips: click to edit it, drop footage on it to
 *  replace it. The only place the parts of a video show. */
function PartCard({ label, video, open, busy, onOpen, onFiles, onContext }: {
  label: string;
  video: VidRow | undefined;
  open: boolean;
  busy: boolean;
  onOpen: () => void;
  onFiles: (files: FileList | File[]) => void;
  /** Right-click — the video's name and context, which its three clips share. */
  onContext: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      title={video
        ? `${label} — click to edit it, drop footage on it to replace it`
        : `${label} — drop footage here, or click to choose a file`}
      onContextMenu={(e) => { e.preventDefault(); onContext(); }}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
      }}
      className={`relative overflow-hidden rounded-md border ${
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
        className="flex h-56 w-full items-center justify-center bg-black"
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
        <span className="min-w-0 flex-1 truncate text-[9px] text-zinc-600">{video ? '' : 'missing'}</span>
        <span className="shrink-0 font-mono text-[9px] text-zinc-600">
          {video?.duration != null ? fmtTime(video.duration) : ''}
        </span>
      </div>
      {open && (
        <span className="absolute left-1 top-1 rounded bg-sky-600/90 px-1 py-px text-[9px] font-medium text-white">Editing</span>
      )}
    </div>
  );
}

export function VidsPrep({ lib, active }: { lib: VidsLib; active: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  /** What the personas side is showing — see GROUP. Empty until something is
   *  pressed: the videos in no persona then, while there are any (they are
   *  what is waiting to be moved), else the first persona's. */
  const [list, setList] = useState<string>('');
  /** A persona being named: a new one (id null), or one being renamed. */
  const [folderDraft, setFolderDraft] = useState<{ id: string | null; name: string } | null>(null);
  const folderDraftRef = useRef(folderDraft);
  useEffect(() => { folderDraftRef.current = folderDraft; }, [folderDraft]);
  /** The video parts saving behind the editor — see fileLater. */
  const [backSaves, setBackSaves] = useState<BackSave[]>([]);
  const [busyPart, setBusyPart] = useState<PersonaPart | null>(null);
  // The video the right-click popup is asking about, if it is up.
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

  // The library's top-level Persona folder: where a video's clips are filed,
  // and what the personas — a folder each — sit under. The oldest of that
  // name, should there be two (see folderGroupIds).
  const personaFolderId = useMemo(
    () => lib.folders
      .filter((f) => !f.parentId && isPersonaFolderName(f.name))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.id ?? null,
    [lib.folders],
  );

  const openPersonaId = personaOf(list);
  /** The video opened up to its three clips, if one is. */
  const openPersona = openPersonaId ? lib.personas.find((p) => p.id === openPersonaId) ?? null : null;

  // The personas — a folder each under Persona — every one listed, with or
  // without videos (an empty one is somewhere to move a video to), and the
  // videos in none of them last.
  const personFolders = useMemo(() => personaFolders(lib.folders), [lib.folders]);
  const personaGroups = useMemo(() => groupPersonas(lib.personas, lib.folders), [lib.personas, lib.folders]);
  /** Whose videos the lower half is showing: the persona pressed, the one the
   *  open video belongs to, or — before anything has been pressed — the videos
   *  in no persona, while there are any. */
  const shownGroup = useMemo(() => {
    const keyOf = (g: (typeof personaGroups)[number]) => g.folder?.id ?? UNFILED;
    const wanted = openPersona
      ? (personFolders.some((f) => f.id === openPersona.folderId) ? openPersona.folderId! : UNFILED)
      : list.startsWith(GROUP) ? list.slice(GROUP.length) : null;
    return personaGroups.find((g) => keyOf(g) === wanted)
      ?? personaGroups.find((g) => !g.folder)
      ?? personaGroups[0]
      ?? null;
  }, [list, openPersona, personFolders, personaGroups]);
  /** The still a video goes by: its Start, which is him full screen. */
  const thumbOf = useCallback((p: VidPersona): string | null => {
    for (const part of PERSONA_PARTS) {
      const thumb = lib.videos.find((v) => v.id === p[part])?.thumbUrl;
      if (thumb) return thumb;
    }
    return null;
  }, [lib.videos]);

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
  // a new name and a new persona with it. A video's three clips share what is
  // said of it, so it lands on the video.
  const saveContext = useCallback((target: { kind: 'clip' | 'persona'; id: string }, patch: VidsContextSave) => {
    if (target.kind === 'persona') { void lib.updatePersona(target.id, patch); return; }
    // Whose it is belongs to a video; a loose clip has nobody.
    const { folderId: _folder, ...own } = patch;
    void _folder;
    if (isLocalId(target.id)) patchLocal(target.id, own);
    else void lib.setVideoContext(target.id, own);
  }, [lib, patchLocal]);

  // What the popup shows, resolved live so an edit elsewhere can't leave it
  // sitting on a video that has since gone. Only videos are asked about here.
  const ctxDialog = useMemo(() => {
    if (!ctxTarget || ctxTarget.kind !== 'persona') return null;
    const p = lib.personas.find((x) => x.id === ctxTarget.id);
    return p && {
      kind: 'persona' as const,
      name: p.name,
      hint: 'What the video is called, whose it is, and what he is doing in it.',
      value: { context: p.context },
      folderId: personFolders.some((f) => f.id === p.folderId) ? p.folderId : null,
    };
  }, [ctxTarget, lib.personas, personFolders]);

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
  // The persona whose videos are on screen, for a run started while they are.
  const openGroupRef = useRef<string | null>(null);
  useEffect(() => { openGroupRef.current = shownGroup?.folder?.id ?? null; }, [shownGroup]);
  // A run's saves, one after another: a part saved behind the editor and the
  // one after it must not both find no persona yet and each make one.
  const savesRef = useRef<Promise<unknown>>(Promise.resolve());
  // The persona a run has made, and which run — read by the part saved next,
  // which can land before the page has rendered the first one's answer.
  const personaMadeRef = useRef<{ token: number; id: string } | null>(null);
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
      sourcePath: null,
      sourceUrl: null,
      edit: null,
      clipable: false,
      theme: null,
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

  /** Footage has been dropped: start the run that makes a persona video of it.
   *  One video is the whole of it — trimmed three times, for the three parts
   *  — and three are a part each; anything else is not something this page
   *  files, and says so. `groupId` is the persona it was dropped on, when it
   *  was dropped on one; otherwise the setup card opens on the persona whose
   *  videos are on screen, which is most likely whose it is. */
  const startIntake = useCallback((files: FileList | File[], groupId?: string | null) => {
    const list = Array.from(files).filter(isMediaFile);
    if (list.length === 0) { lib.setError(MEDIA_ONLY); return; }
    if (!((list.length === PERSONA_DROP || list.length === 1) && list.every(isVideoFile))) {
      lib.setError('Drop one video, or three, to make a persona video — one is trimmed three times, three are a part each.');
      return;
    }
    // A finished run still on screen makes way; a live one never gets here,
    // since the stage takes no drop while it is asking something.
    endRun();
    setIntake({
      mode: 'persona',
      step: 'setup',
      files: list,
      local: list.map((f) => localRow(f, f.name)),
      folderId: personaFolderId,
      folderName: PERSONA_FOLDER,
      rows: list.map(() => null),
      index: 0,
      personaId: null,
      personaName: '',
      personaContext: '',
      personaDegen: false,
      personaGroupId: groupId === undefined ? openGroupRef.current : groupId,
      saving: false,
    });
  }, [lib, personaFolderId, endRun, localRow]);

  /** The folder is only remembered here — nothing goes to it until a save. */
  const chooseFolder = useCallback((choice: FolderChoice) => {
    setIntake((prev) => (prev ? { ...prev, step: 'context', folderId: choice.id, folderName: choice.name } : prev));
  }, []);

  /** Persona setup is done: the parts take their names, in the order given, and
   *  go straight to trimming. The persona itself is made when the first trim is
   *  saved, alongside that part — so a run cancelled before then leaves nothing
   *  behind, not even an empty persona.
   *
   *  One clip stands in for all three parts: it is copied up to the three the
   *  run needs, so Start, Top A and Top B are trimmed and filed separately off
   *  the one recording. The copies are File objects of their own over the same
   *  bytes, rather than the one object three times over, because a part is told
   *  apart by its file's identity all the way from here to its save: the same
   *  object three times finds the same local row three times, and all three
   *  saves would land on Start. */
  const startPersona = useCallback((
    name: string, context: VidContext, order: File[], degen: boolean, groupId: string | null,
  ) => {
    if (!intake) return;
    const clean = name.trim();
    const parts = order.length === 1
      ? [order[0], ...Array.from({ length: PERSONA_DROP - 1 }, () => (
          new File([order[0]], order[0].name, { type: order[0].type, lastModified: order[0].lastModified })
        ))]
      : order;
    const local = parts.map((f, i) => ({
      ...(intake.local[intake.files.indexOf(f)] ?? localRow(f, f.name)),
      name: `${clean} — ${PERSONA_PART_LABEL[PERSONA_PARTS[i]]}`,
    }));
    setIntake({
      ...intake,
      step: 'edit',
      files: parts,
      local,
      rows: parts.map(() => null),
      folderId: personaFolderId,
      folderName: PERSONA_FOLDER,
      personaId: null,
      personaName: clean,
      personaContext: context.context,
      personaDegen: degen,
      personaGroupId: groupId,
      index: 0,
    });
  }, [intake, personaFolderId, localRow]);

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

  /** The clip's name, what it is showing and — for a Bottom B — which way Pauv
   *  was, kept on its local row for the editor to open with and for the save to
   *  send. Then straight into the editor. A photo has nothing to trim, cut or
   *  listen to, so naming it is the whole of filing one: it is saved right
   *  here, and the run goes on to the next. */
  const intakeContext = useCallback(async (name: string, context: VidContext, theme: VidTheme | null) => {
    const cur = intakeRef.current;
    const row = cur?.local[cur.index];
    if (!cur || !row) return;
    if (!isPhoto(row)) {
      setIntake((prev) => (prev ? {
        ...prev,
        step: 'edit',
        local: prev.local.map((r) => (r.id === row.id ? { ...r, name, context: context.context, theme } : r)),
      } : prev));
      return;
    }
    const token = runRef.current;
    const at = cur.index;
    setIntake((prev) => (prev ? { ...prev, saving: true } : prev));
    const saved = await lib.uploadBlob(row.file, name, cur.folderId, { context: context.context, theme });
    if (runRef.current !== token) return;
    setIntake((prev) => (prev ? { ...prev, saving: false } : prev));
    // It failed — the upload list on the left says why, and the run stays put.
    if (!saved) return;
    setIntake((prev) => (prev ? { ...prev, rows: prev.rows.map((r, n) => (n === at ? saved : r)) } : prev));
    advanceIntake();
  }, [lib, advanceIntake]);

  // A run standing on a clip is that clip in the editor, playing off the disk:
  // this is the only thing that opens one on the run's behalf, so the step it
  // is on and what is on screen can't drift apart — and the editor takes the
  // big side of the page for as long as it has one. Keyed on the step and the
  // clip rather than the whole run, so a mark or a context typed against the
  // clip doesn't keep pulling you back if you went to look at something else.
  const intakeClipId = intake?.step === 'edit' ? (intake.local[intake.index]?.id ?? null) : null;
  useEffect(() => {
    if (intakeClipId) setOpenId(intakeClipId);
  }, [intakeClipId]);

  /** Clicking a clip while a run is going. A run that had a clip open ends
   *  first — you have left it — and asks before dropping anything unsaved; if
   *  you keep the run, the click does nothing. A run still asking a question
   *  keeps its place and puts the question back when you close this. */
  const openClip = useCallback((id: string | null) => {
    const cur = intakeRef.current;
    if (cur && (cur.step === 'edit' || cur.step === 'done') && !cancelIntake()) return;
    setOpenId(id);
  }, [cancelIntake]);

  // ── A video's clips ──
  // Only met by opening a video to edit it: footage dropped on one of its
  // three parts replaces that part.
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

  // ── Personas ──
  // A persona is a person, and in the library a folder under Persona — so
  // making, renaming and deleting one is what it is for any folder. A video
  // only points at its persona, so deleting a persona leaves its videos
  // standing, in none.

  /** The persona being named is made, or takes its new name. */
  const commitFolder = async () => {
    // Off the ref, and taken from it: Enter and the blur that follows it both
    // land here, and only the first may find a name to act on.
    const draft = folderDraftRef.current;
    folderDraftRef.current = null;
    setFolderDraft(null);
    const name = draft?.name.trim();
    if (!draft || !name) return;
    if (draft.id) { void lib.renameFolder(draft.id, name); return; }
    if (!personaFolderId) return;
    const made = await lib.createFolder(name, personaFolderId);
    if (made) setList(groupList(made.id));
  };

  /** A video goes to a persona — dragged onto the name, or picked from the
   *  list on its tile — or to none. */
  const moveVideoTo = (id: string, folderId: string | null) => {
    const p = lib.personas.find((x) => x.id === id);
    if (p && (p.folderId ?? null) !== folderId) void lib.updatePersona(id, { folderId });
  };

  const deletePerson = (folder: VidFolder, holds: number) => {
    const stay = holds ? ` ${holds === 1 ? 'Its video stays' : `Its ${holds} videos stay`}, under ${UNFILED_LABEL}.` : '';
    if (!window.confirm(`Delete the persona "${folder.name}"?${stay}`)) return;
    if (list === groupList(folder.id)) setList('');
    void lib.deleteFolder(folder.id);
  };

  /** A video is taken off the list. Its three clips are left in the cloud —
   *  nothing about a stray click should destroy footage. */
  const deleteVideo = (p: VidPersona) => {
    if (!window.confirm(`Delete the video "${p.name}"? It comes off the list; its footage stays in the cloud.`)) return;
    if (list === personaKey(p.id)) setList(groupList(personFolders.some((f) => f.id === p.folderId) ? p.folderId : null));
    void lib.deletePersona(p.id);
  };

  /** The 💀 on a video's tile. Making one degen asks first, so a stray click
   *  can't; taking it back off doesn't need to. */
  const toggleDegen = (p: VidPersona) => {
    if (!p.degen && !window.confirm(`Make "${p.name}" degen?`)) return;
    void lib.updatePersona(p.id, { degen: !p.degen });
  };

  /** A run's saves take turns — see savesRef. One that fails does not hold up
   *  the next. */
  const inTurn = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const next = savesRef.current.then(work, work);
    savesRef.current = next.catch(() => {});
    return next;
  }, []);

  /** File one of a run's local clips: the bytes up into the folder the run
   *  chose, and — for a persona — onto the persona, which is made with its
   *  first part. `run` is the run as it stood when the save was asked for and
   *  `token` which run that was, since by the time a part saved behind the
   *  editor lands the page has moved on. `advance` moves the run on when this
   *  clip is still the one it is standing on. */
  const fileLocal = useCallback(async (
    run: Intake, at: number, token: number,
    blob: Blob | null, name: string, hasSfx: boolean, marks: VidMark[], edit: VidEdit | null, advance: boolean,
  ) => {
    // A render goes up with the recording it was made from and the edit that
    // made it, so the clip can be re-edited from the recording later. The file
    // as dropped goes up on its own: it is the recording.
    const file = run.local[at].file;
    const row = await lib.uploadBlob(blob ?? file, name, run.folderId, {
      context: run.local[at].context, marks, hasSfx, theme: run.local[at].theme,
      ...(blob ? { source: file, sourceName: file.name, edit } : {}),
    });
    if (!row) throw new Error('Saving failed — see the message on the left.');
    // The run was called off while this went up. The clip is saved either way —
    // it was already on its way — but nothing more is done on the run's behalf.
    if (runRef.current !== token) return;

    if (run.mode === 'persona') {
      const part = PERSONA_PARTS[at];
      const made = personaMadeRef.current?.token === token ? personaMadeRef.current.id : null;
      if (made) {
        await lib.updatePersona(made, { [part]: row.id });
      } else {
        const persona = await lib.createPersona(run.personaName, run.personaDegen, {
          [part]: row.id, folderId: run.personaGroupId,
        });
        if (!persona) throw new Error('The clip is saved, but the persona could not be made — see the message on the left.');
        personaMadeRef.current = { token, id: persona.id };
        if (run.personaContext) void lib.updatePersona(persona.id, { context: run.personaContext });
        setIntake((prev) => (prev ? { ...prev, personaId: persona.id } : prev));
        setList(personaKey(persona.id));
      }
    }
    setIntake((prev) => (prev ? { ...prev, rows: prev.rows.map((r, n) => (n === at ? row : r)) } : prev));
    const now = intakeRef.current;
    if (advance && now?.step === 'edit' && now.index === at) advanceIntake();
  }, [lib, advanceIntake]);

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
    blob: Blob | null, name: string, hasSfx: boolean, marks: VidMark[], videoId: string, edit: VidEdit | null,
  ) => {
    if (!isLocalId(videoId)) {
      if (blob) {
        const row = await lib.replaceVideo(videoId, blob, name, hasSfx, marks, edit);
        if (!row) throw new Error('Saving failed — see the message on the left.');
      } else {
        await lib.renameVideo(videoId, name);
      }
      return;
    }

    const cur = intakeRef.current;
    const at = cur ? cur.local.findIndex((r) => r.id === videoId) : -1;
    if (!cur || at < 0) throw new Error('This clip is no longer part of a run — drop it again to file it.');
    // In its turn: behind any part of the same run still saving (fileLater).
    const token = runRef.current;
    await inTurn(() => fileLocal(cur, at, token, blob, name, hasSfx, marks, edit, true));
  }, [lib, inTurn, fileLocal]);

  /** Save hands a persona's Start or Top A over instead of waiting on it (the
   *  editor's onSaveLater): the run goes on to the next part now, and this one
   *  is rendered and filed behind it, in its turn. The last part is saved the
   *  ordinary way, waited for — by which time these have landed. One that fails
   *  says so in the list top left, where it can be tried again. */
  const fileLater = useCallback((job: ClipSaveJob) => {
    const cur = intakeRef.current;
    const at = cur ? cur.local.findIndex((r) => r.id === job.videoId) : -1;
    if (!cur || at < 0) return;
    const token = runRef.current;
    if (cur.step === 'edit' && cur.index === at) advanceIntake();
    const id = job.videoId;
    const patch = (p: Partial<BackSave>) => setBackSaves((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));
    setBackSaves((prev) => [...prev.filter((s) => s.id !== id), { id, name: job.name, frac: 0, error: null }]);
    void inTurn(async () => {
      // The run was called off while this waited: it said nothing more of it
      // would be saved, so nothing is.
      if (runRef.current !== token) { setBackSaves((prev) => prev.filter((s) => s.id !== id)); return; }
      try {
        const blob = job.render ? await job.render((frac) => patch({ frac })) : null;
        patch({ frac: 1 });
        await fileLocal(cur, at, token, blob, job.name, job.hasSfx, job.marks, job.edit, false);
        setBackSaves((prev) => prev.filter((s) => s.id !== id));
      } catch (e) {
        patch({ error: e instanceof Error ? e.message : String(e) });
      }
    });
  }, [advanceIntake, inTurn, fileLocal]);

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

  /** The box a persona is named in — a new one, or one being renamed. */
  const folderBox = folderDraft && (
    <input
      autoFocus
      value={folderDraft.name}
      placeholder="Persona name — Blorky, Dorky, Aiden"
      maxLength={80}
      onChange={(e) => setFolderDraft({ ...folderDraft, name: e.target.value })}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void commitFolder();
        if (e.key === 'Escape') setFolderDraft(null);
      }}
      onBlur={() => void commitFolder()}
      className="mt-0.5 w-full rounded border border-zinc-600 bg-black px-2 py-1 text-[12px] text-white outline-none"
    />
  );

  /** Whose videos are showing: the persona's own key, as the list remembers it. */
  const shownKey = shownGroup ? groupList(shownGroup.folder?.id ?? null) : '';
  const shownName = shownGroup ? (shownGroup.folder?.name ?? UNFILED_LABEL) : '';

  return (
    <div className="flex min-h-0 flex-1">
      {/* Left: the upload — a narrow strip. The drop target, the few questions
          a run asks, and whatever is still going up. */}
      <div className="flex w-[300px] shrink-0 flex-col border-r border-zinc-800">
        <p className="shrink-0 px-4 pt-3 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Upload a video</p>
        {lib.error && (
          <div className="mx-2 mt-2 flex items-start gap-2 rounded border border-red-900 bg-red-950/40 px-2 py-1.5 text-[11px] text-red-300">
            <span className="flex-1 break-words">{lib.error}</span>
            <button onClick={() => lib.setError(null)} className="text-red-400 hover:text-white"><CloseIcon size={11} /></button>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <VidsIntakeStage
            intake={intake}
            // No loose clips are filed from this page any more, so the run
            // that asks for a folder never starts and has none to offer.
            choices={NO_FOLDERS}
            onFiles={(files) => startIntake(files)}
            onOpenClip={openClip}
            onChooseFolder={chooseFolder}
            onStartPersona={startPersona}
            personaGroups={personFolders}
            onContext={intakeContext}
            onCancel={cancelIntake}
          />
        </div>

        {/* A video's parts saving behind the editor: rendering first, then
            in the upload list below like anything else going up. */}
        {backSaves.length > 0 && (
          <div className="shrink-0 border-t border-zinc-800 p-3">
            {backSaves.map((s) => (
              <div key={s.id} className="mb-1.5 last:mb-0">
                <div className="flex items-center gap-2 text-[10px]">
                  <span className={`flex-1 truncate ${s.error ? 'text-red-300' : 'text-zinc-300'}`} title={s.error ?? s.name}>{s.name}</span>
                  <span className="font-mono text-zinc-500">
                    {s.error ? 'not saved' : s.frac >= 1 ? 'saving' : `rendering ${Math.round(s.frac * 100)}%`}
                  </span>
                  {s.error && (
                    <button
                      onClick={() => setBackSaves((prev) => prev.filter((x) => x.id !== s.id))}
                      className="text-zinc-500 hover:text-white"
                    >
                      <CloseIcon size={10} />
                    </button>
                  )}
                </div>
                {s.error ? (
                  <p className="text-[10px] text-red-400">{s.error} Open the video and drop the footage onto that part to add it.</p>
                ) : (
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-800">
                    <div className="h-full bg-sky-400" style={{ width: `${Math.max(4, s.frac * 100)}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {lib.uploads.length > 0 && (
          <div className="shrink-0 border-t border-zinc-800 p-3">
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
      </div>

      {/* Right, and most of the page: the personas and their videos — or, once
          a clip is open (a run trimming one, or a video's clip clicked), the
          editor in their place until it is closed. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {openVideo && !isPhoto(openVideo) ? (
          <>
            {run && (
              <VidsIntakeBanner intake={run} onSkip={advanceIntake} onCancel={cancelIntake} />
            )}
            <VidsClipEditor
              video={openVideo}
              onSave={saveEdited}
              // A video's Start and Top A are saved behind the next part
              // (fileLater); its last part is waited for.
              onSaveLater={run?.mode === 'persona' && run.index < run.files.length - 1 ? fileLater : undefined}
              active={active}
              onClose={closeEditor}
              contextOwner={contextOwner}
              onMarksChange={(marks) => {
                if (isLocalId(openId)) patchLocal(openId, { marks });
                else if (openId) void lib.setVideoMarks(openId, marks);
              }}
              onContextChange={(patch) => {
                if (contextOwner) saveContext({ kind: contextOwner.kind, id: contextOwner.id }, patch);
              }}
              // A video's clips only get trimmed as they are walked in, and the
              // run's own Save is what hands over the next one — except Top A,
              // which loops under the whole bottom sequence in a build. That is
              // the one place jump cuts have to be made, so it gets Cut and
              // Auto cut on top of the in / out points. A clip opened on its
              // own, from a video on the list, gets the whole editor.
              mode={run?.mode !== 'persona'
                ? 'full'
                : PERSONA_PARTS[run.index] === 'topAId' ? 'cut' : 'trim'}
              startSpeed={run ? intakeSpeed(slotForFolderName(run.folderName)) : undefined}
              saveLabel={run
                ? (run.index >= run.files.length - 1 ? 'Save · finish' : 'Save · next clip')
                : undefined}
              savingLabel={run ? 'Saving the video…' : undefined}
            />
          </>
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* The personas */}
            <div className="w-[230px] shrink-0 overflow-y-auto border-r border-zinc-800 px-2 py-3">
              <p className="mb-1.5 px-2 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Personas</p>
              {personaGroups.map(({ folder, personas }) => {
                const key = groupList(folder?.id ?? null);
                if (folder && folderDraft?.id === folder.id) return <div key={key} className="px-1">{folderBox}</div>;
                return (
                  <PersonaRow
                    key={key}
                    label={folder?.name ?? UNFILED_LABEL}
                    count={personas.length}
                    thumb={folder ? personas.map(thumbOf).find(Boolean) ?? null : null}
                    selected={shownKey === key}
                    title={folder
                      ? `${folder.name} — ${personas.length} video${personas.length === 1 ? '' : 's'} · drag a video here to make it ${folder.name}'s, or drop footage here to make a new one`
                      : 'Videos that are nobody’s yet — move each to its persona'}
                    clipable={folder ? folder.clipable : true}
                    onSelect={() => setList(key)}
                    onVideoDrop={(id) => moveVideoTo(id, folder?.id ?? null)}
                    onFiles={folder ? (files) => startIntake(files, folder.id) : undefined}
                    onRename={folder ? () => setFolderDraft({ id: folder.id, name: folder.name }) : undefined}
                    onDelete={folder ? () => deletePerson(folder, personas.length) : undefined}
                    onClipable={folder ? (on) => void lib.setFolderClipable(folder.id, on) : undefined}
                  />
                );
              })}
              {folderDraft !== null && folderDraft.id === null ? <div className="px-1">{folderBox}</div> : (
                <button
                  onClick={() => setFolderDraft({ id: null, name: '' })}
                  title="A persona is a person — Blorky, Dorky, Aiden — and holds every video of them"
                  className="mt-1 w-full rounded-md border border-dashed border-zinc-800 px-2 py-1.5 text-left text-[12px] text-zinc-400 hover:border-zinc-600 hover:text-white"
                >
                  + New persona
                </button>
              )}
            </div>

            {/* The videos of the persona pressed — or one of them, opened up */}
            <div className="min-w-0 flex-1 overflow-y-auto p-5">
              {openPersona ? (
                <div className="max-w-[760px]">
                  <button onClick={() => setList(shownKey)} className="mb-3 text-[12px] text-zinc-500 hover:text-white">
                    ← {shownName}
                  </button>
                  <div className="mb-1 flex items-center gap-3">
                    <h2 className="min-w-0 truncate text-[18px] font-semibold text-zinc-100" title={openPersona.name}>{openPersona.name}</h2>
                    <button
                      onClick={() => setCtxTarget({ kind: 'persona', id: openPersona.id })}
                      className="shrink-0 rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-white"
                    >
                      Rename or move
                    </button>
                  </div>
                  <p className="mb-4 text-[12px] leading-relaxed text-zinc-500">
                    Its three clips, for when one needs editing: click one to open it in the editor, or drop footage on it to replace it.
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    {PERSONA_PARTS.map((part) => (
                      <PartCard
                        key={part}
                        label={PART_SAID[part]}
                        video={videoById(openPersona[part])}
                        open={!!openPersona[part] && openPersona[part] === openId}
                        busy={busyPart === part}
                        onOpen={() => openClip(openPersona[part])}
                        onFiles={(files) => void attachFiles(openPersona, part, files)}
                        onContext={() => setCtxTarget({ kind: 'persona', id: openPersona.id })}
                      />
                    ))}
                  </div>
                </div>
              ) : !lib.loaded ? (
                <div className="flex justify-center py-12 text-zinc-600"><SpinnerIcon size={18} className="animate-spin" /></div>
              ) : !shownGroup ? (
                <div className="flex h-full min-h-[160px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-800 p-6 text-center">
                  <p className="text-[14px] font-semibold text-zinc-200">No personas yet</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">Make one with + New persona, then drop a video of them on the left.</p>
                </div>
              ) : (
                <>
                  <div className="mb-4">
                    <h2 className="text-[18px] font-semibold text-zinc-100">
                      {shownName}
                      <span className="ml-2 text-[12px] font-normal text-zinc-500">
                        {shownGroup.personas.length} video{shownGroup.personas.length === 1 ? '' : 's'}
                      </span>
                    </h2>
                    {!shownGroup.folder && shownGroup.personas.length > 0 && (
                      <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
                        These are nobody&rsquo;s yet. Move each to its persona: drag it onto a name on the left, or pick from the list under it.
                      </p>
                    )}
                  </div>
                  {shownGroup.personas.length === 0 ? (
                    <div className="flex min-h-[160px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-800 p-6 text-center">
                      <p className="text-[14px] font-semibold text-zinc-200">No videos of {shownName} yet</p>
                      <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
                        Drop one on the left, make one in AI Persona, or move one here from {UNFILED_LABEL}.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
                      {shownGroup.personas.map((p) => (
                        <VideoCard
                          key={p.id}
                          video={p}
                          thumb={thumbOf(p)}
                          filled={PERSONA_PARTS.filter((k) => p[k]).length}
                          people={personFolders}
                          onOpen={() => setList(personaKey(p.id))}
                          onMove={(folderId) => moveVideoTo(p.id, folderId)}
                          onDelete={() => deleteVideo(p)}
                          onDegen={() => toggleDegen(p)}
                          onContext={() => setCtxTarget({ kind: 'persona', id: p.id })}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
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
          folders={personFolders.length ? personFolders : undefined}
          folderId={ctxDialog.folderId}
          onSave={(patch) => saveContext(ctxTarget, patch)}
          onClose={() => setCtxTarget(null)}
        />
      )}
    </div>
  );
}
