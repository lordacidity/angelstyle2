'use client';

// VidsLibrary — the library pane of the Vids section, in three bands:
//
//   Folders   the four that always exist — Persona, Bottom A, Bottom B, End.
//             They are created for you and cannot be added to, renamed or
//             deleted, so there is nothing to set up and nothing to misname.
//             Each one is a drop target.
//   Open      what is inside the folder you clicked. The Persona folder shows
//             its bundles (VidsPersonas); the rest show their clips.
//   Upload    where new footage lands. Drop files anywhere on the pane and they
//             arrive here unfiled, then you drag each one up onto the folder it
//             belongs in.
//
// Clicking any clip opens a playback popup rather than acting on it, so you can
// see what a piece of footage is before filing it or using it.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { isPhoto } from '@/lib/vids-types';
import type { VidFolder, VidPersona, VidRow } from '@/lib/vids-types';
import type { VidsLib } from '../../hooks/useVidsLibrary';
import {
  LIBRARY_FOLDERS, SLOT_META, VID_DRAG_MIME, folderGroupIds, isPersonaFolderName, slotForFolderName,
} from '@/lib/vidsPlan';
import { VidsPersonas } from './VidsPersonas';
import { VidPreview, fmtBytes } from './VidPreview';
import { fmtTime } from '@/lib/utils';
import { CloseIcon, SpinnerIcon, TrashIcon, UploadIcon, VideoIcon } from '@/lib/icons';

const hasVid = (e: DragEvent) => Array.from(e.dataTransfer.types).includes(VID_DRAG_MIME);
const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** One of the four fixed folders, and every folder id that counts as it. */
interface FolderGroup {
  name: string;
  /** Where new clips are filed. Undefined until the folder has been created. */
  canonical: VidFolder | undefined;
  ids: Set<string>;
}

// ── Small bits ────────────────────────────────────────────────────────────────

function IconBtn({ onClick, title, children }: { onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
    >
      {children}
    </button>
  );
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${open ? 'text-amber-300' : 'text-zinc-500'}`}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

// ── Folder row ────────────────────────────────────────────────────────────────
// Fixed rows: no rename, no delete, no children. Just a target and a count.

function FolderRow({ label, count, selected, muted, onSelect, onDrop }: {
  label: string;
  count: number;
  selected: boolean;
  muted?: boolean;
  onSelect: () => void;
  onDrop: (e: DragEvent) => void;
}) {
  const [over, setOver] = useState(false);

  return (
    <div
      data-vids-folder={label}
      title={`${label} — drop clips here to file them`}
      className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2 text-[11px] ${
        over ? 'bg-emerald-900/40 ring-1 ring-emerald-600'
          : selected ? 'bg-zinc-800 text-white'
          : muted ? 'text-zinc-500 hover:bg-zinc-900' : 'text-zinc-300 hover:bg-zinc-900'
      }`}
      onClick={onSelect}
      onDragOver={(e) => {
        if (!hasVid(e) && !hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = hasVid(e) ? 'move' : 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); onDrop(e); }}
    >
      <FolderIcon open={selected} />
      <span className="min-w-0 flex-1 truncate py-1.5">{label}</span>
      <span className="text-[10px] text-zinc-600">{count || ''}</span>
    </div>
  );
}

// ── Clip card ─────────────────────────────────────────────────────────────────

function VideoCard({ v, inEditor, onOpen, onDelete }: {
  v: VidRow; inEditor: boolean; onOpen: () => void; onDelete: () => void;
}) {
  return (
    <div
      data-vids-video={v.id}
      data-vids-name={v.name}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(VID_DRAG_MIME, v.id);
        e.dataTransfer.effectAllowed = 'copyMove';
      }}
      className={`group relative overflow-hidden rounded-md border bg-zinc-950 ${
        inEditor ? 'border-emerald-700' : 'border-zinc-800 hover:border-zinc-600'
      }`}
    >
      <button onClick={onOpen} title={`${v.name} — click to play it, drag to file it`} className="block h-20 w-full bg-black">
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
      </div>
      <button
        onClick={onDelete}
        title="Delete from the cloud"
        className="absolute right-1 top-1 hidden rounded bg-black/70 p-1 text-zinc-400 hover:text-red-400 group-hover:block"
      >
        <TrashIcon size={12} />
      </button>
      {inEditor && (
        <span className="absolute left-1 top-1 rounded bg-emerald-600/90 px-1 py-px text-[9px] font-medium text-white">In use</span>
      )}
    </div>
  );
}

// ── Pane ──────────────────────────────────────────────────────────────────────

interface Props {
  lib: VidsLib;
  onPick: (v: VidRow) => void;
  /** Video ids currently picked into a slot (badged in the grids). */
  usedIds: Set<string>;
  /** Apply a persona — fills Start, Top A and Top B in one go. */
  onUsePersona: (p: VidPersona) => void;
  /** The persona currently filling those three slots, if any. */
  appliedPersonaId: string | null;
}

export function VidsLibrary({ lib, onPick, usedIds, onUsePersona, appliedPersonaId }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [paneOver, setPaneOver] = useState(false);
  const [preview, setPreview] = useState<VidRow | null>(null);
  // dragenter/dragleave fire for every child crossed; count them so the
  // highlight only drops once the pointer truly leaves the pane.
  const paneDepth = useRef(0);

  const countIn = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of lib.videos) {
      if (!v.folderId) continue;
      m.set(v.folderId, (m.get(v.folderId) ?? 0) + 1);
    }
    return m;
  }, [lib.videos]);

  // The four folders, in build order. They are created for us on first load, so
  // a missing one just means that has not landed yet. Each row stands for every
  // folder of that name plus anything nested under them, so a stray duplicate
  // reads as one place instead of hiding clips in a second row.
  const groups: FolderGroup[] = useMemo(
    () => LIBRARY_FOLDERS.map((name) => ({
      name,
      canonical: lib.folders
        .filter((f) => !f.parentId && sameName(f.name, name))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0],
      ids: folderGroupIds(lib.folders, name),
    })),
    [lib.folders],
  );

  const countOf = (g: FolderGroup) => {
    let n = 0;
    for (const id of g.ids) n += countIn.get(id) ?? 0;
    return n;
  };

  // Anything else that still holds footage — folders from before this layout, or
  // a sub-folder someone made earlier. Listed so nothing becomes unreachable;
  // each disappears once its clips have been dragged somewhere sensible.
  const others = useMemo(() => {
    const known = new Set(groups.flatMap((g) => [...g.ids]));
    return lib.folders.filter((f) => !known.has(f.id) && (countIn.get(f.id) ?? 0) > 0);
  }, [lib.folders, groups, countIn]);

  const current = lib.selectedFolderId;
  const currentFolder: VidFolder | undefined = current ? lib.folders.find((f) => f.id === current) : undefined;
  const openGroup = current ? groups.find((g) => g.ids.has(current)) : undefined;
  const currentName = openGroup?.name ?? currentFolder?.name ?? 'Library';
  const showPersonas = !!openGroup && isPersonaFolderName(openGroup.name);

  // Open the Persona folder by default — it is the first thing a build needs.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || current) return;
    const persona = groups.find((g) => isPersonaFolderName(g.name))?.canonical;
    if (!persona) return;
    autoOpened.current = true;
    lib.setSelectedFolderId(persona.id);
  }, [current, groups, lib]);

  // What the open folder shows: the whole group when one is open, so a duplicate
  // folder's clips are not stranded out of sight.
  const filed = useMemo(
    () => lib.videos.filter((v) => (v.folderId ? (openGroup ? openGroup.ids.has(v.folderId) : v.folderId === current) : false)),
    [lib.videos, current, openGroup],
  );
  const unfiled = useMemo(() => lib.videos.filter((v) => !v.folderId), [lib.videos]);

  // Which slot the open folder feeds, so the preview popup can offer to use the
  // clip straight away. The Persona folder feeds three at once, so it offers none.
  const slotHere = openGroup ? slotForFolderName(openGroup.name) : null;

  // Drop onto a folder row: a dragged clip moves there; dropped files upload there.
  const dropInto = (folderId: string | null) => (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    paneDepth.current = 0;
    setPaneOver(false);
    const vid = e.dataTransfer.getData(VID_DRAG_MIME);
    if (vid) { void lib.moveVideo(vid, folderId); return; }
    if (e.dataTransfer.files.length) void lib.uploadFiles(e.dataTransfer.files, folderId);
  };

  // Files dropped anywhere else on the pane land unfiled, in the upload band.
  const onPaneDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    paneDepth.current++;
    setPaneOver(true);
  };
  const onPaneDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    paneDepth.current = Math.max(0, paneDepth.current - 1);
    if (paneDepth.current === 0) setPaneOver(false);
  };
  const onPaneDragOver = (e: DragEvent) => {
    if (!hasFiles(e) && !hasVid(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = hasVid(e) ? 'move' : 'copy';
  };
  const onPaneDrop = (e: DragEvent) => {
    paneDepth.current = 0;
    setPaneOver(false);
    const vid = e.dataTransfer.getData(VID_DRAG_MIME);
    if (vid) { e.preventDefault(); void lib.moveVideo(vid, null); return; }
    if (!hasFiles(e)) return;
    e.preventDefault();
    void lib.uploadFiles(e.dataTransfer.files, null);
  };

  const confirmDelete = (v: VidRow) => {
    if (window.confirm(`Delete "${v.name}" from the cloud for everyone?`)) void lib.deleteVideo(v);
  };

  return (
    <div
      className={`relative flex w-[300px] shrink-0 flex-col border-r border-zinc-800 ${paneOver ? 'bg-emerald-950/20' : ''}`}
      onDragEnter={onPaneDragEnter}
      onDragLeave={onPaneDragLeave}
      onDragOver={onPaneDragOver}
      onDrop={onPaneDrop}
    >
      <input
        ref={fileRef}
        type="file"
        accept="video/*,.mov,.mkv"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void lib.uploadFiles(e.target.files, null);
          e.target.value = '';
        }}
      />

      {lib.error && (
        <div className="mx-2 mt-2 flex items-start gap-2 rounded border border-red-900 bg-red-950/40 px-2 py-1.5 text-[11px] text-red-300">
          <span className="flex-1 break-words">{lib.error}</span>
          <button onClick={() => lib.setError(null)} className="text-red-400 hover:text-white"><CloseIcon size={11} /></button>
        </div>
      )}

      {/* The four folders */}
      <div className="shrink-0 border-b border-zinc-800 px-1.5 py-1.5">
        {groups.map((g) => (
          <FolderRow
            key={g.name}
            label={g.name}
            count={countOf(g)}
            selected={openGroup?.name === g.name}
            onSelect={() => g.canonical && lib.setSelectedFolderId(g.canonical.id)}
            onDrop={g.canonical ? dropInto(g.canonical.id) : () => {}}
          />
        ))}
        {others.length > 0 && (
          <>
            <p className="mt-1.5 px-2 text-[9px] uppercase tracking-wider text-zinc-600">Older folders</p>
            {others.map((f) => (
              <FolderRow
                key={f.id}
                label={f.name}
                count={countIn.get(f.id) ?? 0}
                selected={current === f.id}
                muted
                onSelect={() => lib.setSelectedFolderId(f.id)}
                onDrop={dropInto(f.id)}
              />
            ))}
          </>
        )}
      </div>

      {/* Open folder */}
      <div className="flex shrink-0 items-center gap-1 border-b border-zinc-800 px-2 py-1.5">
        <span className="flex-1 truncate px-1 text-[11px] font-semibold text-zinc-300" title={currentName}>{currentName}</span>
        <IconBtn onClick={() => void lib.refresh()} title="Refresh">
          <span className={lib.loading ? 'inline-flex animate-spin' : 'inline-flex'}><RefreshIcon /></span>
        </IconBtn>
      </div>

      {showPersonas ? (
        <VidsPersonas
          lib={lib}
          folderId={openGroup?.canonical?.id ?? current}
          clips={filed}
          appliedPersonaId={appliedPersonaId}
          onUse={onUsePersona}
          onPreview={setPreview}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {lib.loading && filed.length === 0 ? (
            <div className="flex justify-center py-8 text-zinc-600"><SpinnerIcon size={16} className="animate-spin" /></div>
          ) : filed.length === 0 ? (
            <div className="flex h-full min-h-[100px] flex-col items-center justify-center rounded-md border border-dashed border-zinc-800 p-4 text-center">
              <p className="text-[11px] text-zinc-400">{currentName} is empty</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-600">
                Upload below, then drag a clip up onto this folder.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {filed.map((v) => (
                <VideoCard
                  key={v.id}
                  v={v}
                  inEditor={usedIds.has(v.id)}
                  onOpen={() => setPreview(v)}
                  onDelete={() => confirmDelete(v)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Upload band — everything new lands here, unfiled */}
      <div className="max-h-[45%] shrink-0 overflow-y-auto border-t border-zinc-800 bg-zinc-950/60 p-2">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Upload</span>
          <span className="flex-1 text-[9px] text-zinc-600">{unfiled.length ? 'drag each clip up onto a folder' : ''}</span>
          <button
            data-vids-upload
            onClick={() => fileRef.current?.click()}
            className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:border-zinc-500 hover:text-white"
          >
            Choose files
          </button>
        </div>

        {unfiled.length === 0 ? (
          <div
            onClick={() => fileRef.current?.click()}
            className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-zinc-800 p-4 text-center hover:border-zinc-600"
          >
            <UploadIcon size={15} className="mb-1.5 text-zinc-600" />
            <p className="text-[10px] text-zinc-400">Drop videos here</p>
            <p className="mt-0.5 text-[9px] text-zinc-600">then drag them onto Persona, Bottom A, Bottom B or End</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {unfiled.map((v) => (
              <VideoCard
                key={v.id}
                v={v}
                inEditor={usedIds.has(v.id)}
                onOpen={() => setPreview(v)}
                onDelete={() => confirmDelete(v)}
              />
            ))}
          </div>
        )}

        {/* Uploads in flight */}
        {lib.uploads.length > 0 && (
          <div className="mt-2 border-t border-zinc-800 pt-2">
            {lib.uploads.map((u) => (
              <div key={u.id} className="mb-1.5">
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

      {paneOver && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/50">
          <p className="rounded-md border border-emerald-600 bg-zinc-950 px-3 py-2 text-xs text-emerald-300">Drop to upload</p>
        </div>
      )}

      {preview && (
        <VidPreview
          video={preview}
          action={slotHere && preview.folderId && openGroup?.ids.has(preview.folderId)
            ? { label: `Use for ${SLOT_META[slotHere].label}`, onClick: () => onPick(preview) }
            : null}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
