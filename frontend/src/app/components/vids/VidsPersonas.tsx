'use client';

// VidsPersonas — the Persona folder's view in the library pane. A persona is a
// named bundle of the three clips that always travel together: Start, Top A and
// Top B. A build picks exactly one, and it fills all three slots at once, so
// these three are never chosen individually the way Bottom A / B and End are.
//
// Each persona card shows its three parts as tiles. An empty tile is filled by
// dropping a video file on it (uploads into the Persona folder), by dragging a
// clip up from the upload band, or by clicking it and choosing a file. Clicking
// a tile that already has a clip plays it, so you can check which is which.
// Deleting a persona drops only the bundle — the clips stay in the folder and
// reappear below as unassigned footage.

import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { PersonaPart, VidPersona, VidRow } from '@/lib/vids-types';
import { PERSONA_PARTS, PERSONA_PART_LABEL } from '@/lib/vids-types';
import type { VidsLib } from '../../hooks/useVidsLibrary';
import { PERSONA_DRAG_MIME, VID_DRAG_MIME } from '@/lib/vidsPlan';
import { fmtTime } from '@/lib/utils';
import { CloseIcon, TrashIcon, UploadIcon, VideoIcon } from '@/lib/icons';

const hasVid = (e: DragEvent) => Array.from(e.dataTransfer.types).includes(VID_DRAG_MIME);
const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

/** How many of the three parts a persona has filled. */
export const personaFilled = (p: VidPersona) => PERSONA_PARTS.filter((k) => p[k]).length;
export const personaIsComplete = (p: VidPersona) => personaFilled(p) === PERSONA_PARTS.length;

// ── One part tile (Start / Top A / Top B) ─────────────────────────────────────

interface PartTileProps {
  label: string;
  video: VidRow | undefined;
  busy: boolean;
  onFiles: (files: FileList | File[]) => void;
  onVideoId: (id: string) => void;
  onPreview: (v: VidRow) => void;
  onClear: () => void;
}

function PartTile({ label, video, busy, onFiles, onVideoId, onPreview, onClear }: PartTileProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      title={video ? `${label} — ${video.name} — click to play it` : `${label} — drop a clip or click to choose a file`}
      onClick={(e) => {
        e.stopPropagation();
        if (video) onPreview(video); else fileRef.current?.click();
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
      className={`group/tile relative flex-1 cursor-pointer overflow-hidden rounded border ${
        over ? 'border-emerald-500 bg-emerald-950/30'
          : video ? 'border-zinc-700 bg-black hover:border-zinc-500'
          : 'border-dashed border-zinc-700 bg-zinc-950 hover:border-zinc-500'
      }`}
    >
      <input
        ref={fileRef}
        type="file"
        accept="video/*,.mov,.mkv"
        className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <div className="flex h-12 items-center justify-center">
        {video?.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={video.thumbUrl} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : video ? (
          <VideoIcon size={14} className="text-zinc-600" />
        ) : busy ? (
          <span className="text-[9px] text-zinc-500">uploading…</span>
        ) : (
          <UploadIcon size={13} className="text-zinc-700" />
        )}
      </div>
      <p className={`truncate px-1 pb-0.5 text-center text-[9px] ${video ? 'text-zinc-300' : 'text-zinc-600'}`}>
        {label}
      </p>
      {video && (
        <>
          <span className="absolute bottom-4 right-0.5 rounded bg-black/70 px-0.5 font-mono text-[8px] text-zinc-400">
            {video.duration != null ? fmtTime(video.duration) : '–:––'}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            title={`Unlink this clip from ${label} (it stays in the folder)`}
            className="absolute right-0.5 top-0.5 hidden rounded bg-black/80 p-0.5 text-zinc-400 hover:text-red-400 group-hover/tile:block"
          >
            <CloseIcon size={9} />
          </button>
        </>
      )}
    </div>
  );
}

// ── One persona card ──────────────────────────────────────────────────────────

interface CardProps {
  persona: VidPersona;
  videoById: (id: string | null) => VidRow | undefined;
  busyPart: PersonaPart | null;
  applied: boolean;
  onUse: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onFiles: (part: PersonaPart, files: FileList | File[]) => void;
  onVideoId: (part: PersonaPart, id: string) => void;
  onPreview: (v: VidRow) => void;
  onClear: (part: PersonaPart) => void;
}

function PersonaCard({
  persona, videoById, busyPart, applied, onUse, onRename, onDelete, onFiles, onVideoId, onPreview, onClear,
}: CardProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const filled = personaFilled(persona);
  const complete = personaIsComplete(persona);

  const commit = () => {
    const v = (draft ?? '').trim();
    setDraft(null);
    if (v && v !== persona.name) onRename(v);
  };

  return (
    <div
      data-vids-persona={persona.id}
      draggable={draft === null}
      onDragStart={(e) => {
        e.dataTransfer.setData(PERSONA_DRAG_MIME, persona.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      className={`group mb-2 rounded-md border p-2 ${
        applied ? 'border-emerald-600 bg-emerald-950/20' : 'border-zinc-800 hover:border-zinc-600'
      }`}
    >
      <div className="mb-1.5 flex items-center gap-1">
        {draft !== null ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setDraft(null); }}
            className="min-w-0 flex-1 rounded border border-zinc-600 bg-black px-1 py-0.5 text-[11px] text-white outline-none"
          />
        ) : (
          <span
            onDoubleClick={() => setDraft(persona.name)}
            className="min-w-0 flex-1 truncate text-[11px] font-semibold text-zinc-200"
            title={`${persona.name} — double-click to rename`}
          >
            {persona.name}
          </span>
        )}
        <span className={`text-[9px] ${complete ? 'text-emerald-400' : 'text-amber-400'}`}>{filled}/3</span>
        {draft === null && (
          <button
            onClick={onDelete}
            title="Delete this persona (its clips stay in the folder)"
            className="hidden p-0.5 text-zinc-500 hover:text-red-400 group-hover:block"
          >
            <TrashIcon size={11} />
          </button>
        )}
      </div>

      <div className="flex gap-1">
        {PERSONA_PARTS.map((part) => (
          <PartTile
            key={part}
            label={PERSONA_PART_LABEL[part]}
            video={videoById(persona[part])}
            busy={busyPart === part}
            onFiles={(files) => onFiles(part, files)}
            onVideoId={(id) => onVideoId(part, id)}
            onPreview={onPreview}
            onClear={() => onClear(part)}
          />
        ))}
      </div>

      <button
        onClick={onUse}
        disabled={filled === 0}
        title={complete ? 'Fill Start, Top A and Top B with this persona' : 'Fill the parts this persona has'}
        className={`mt-1.5 w-full rounded border px-2 py-1 text-[10px] transition-colors disabled:opacity-30 ${
          applied
            ? 'border-emerald-600 bg-emerald-600/20 text-emerald-300'
            : 'border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'
        }`}
      >
        {applied ? 'In use' : complete ? 'Use persona' : `Use (${filled}/3)`}
      </button>
    </div>
  );
}

// ── Pane ──────────────────────────────────────────────────────────────────────

interface Props {
  lib: VidsLib;
  /** The Persona folder new uploads are filed into. */
  folderId: string | null;
  /** Everything filed under Persona — what the unassigned list is drawn from. */
  clips: VidRow[];
  appliedPersonaId: string | null;
  onUse: (persona: VidPersona) => void;
  /** Open the playback popup for a clip. */
  onPreview: (v: VidRow) => void;
}

export function VidsPersonas({ lib, folderId, clips, appliedPersonaId, onUse, onPreview }: Props) {
  const [newDraft, setNewDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ persona: string; part: PersonaPart } | null>(null);

  const videoById = (id: string | null) => (id ? lib.videos.find((v) => v.id === id) : undefined);

  // Upload a dropped / chosen file into the Persona folder and point the part at
  // it. Named after the bundle so it reads clearly in the unassigned grid.
  const attachFiles = async (persona: VidPersona, part: PersonaPart, files: FileList | File[]) => {
    const file = Array.from(files)[0];
    if (!file) return;
    setBusy({ persona: persona.id, part });
    try {
      const row = await lib.uploadBlob(file, `${persona.name} — ${PERSONA_PART_LABEL[part]}`, folderId);
      if (row) await lib.updatePersona(persona.id, { [part]: row.id });
    } finally {
      setBusy(null);
    }
  };

  // A clip already in the library: point the part at it and file it under Persona
  // so the bundle's footage all lives in one place.
  const attachVideo = async (persona: VidPersona, part: PersonaPart, id: string) => {
    const row = lib.videos.find((v) => v.id === id);
    if (row && row.folderId !== folderId) await lib.moveVideo(id, folderId);
    await lib.updatePersona(persona.id, { [part]: id });
  };

  const commitNew = async () => {
    const name = (newDraft ?? '').trim();
    setNewDraft(null);
    // Nothing mounts this view any more. The persona list on Edit & file is
    // where a persona is made, and it asks Degen or Not degen (VidsPrep).
    if (name) await lib.createPersona(name, false);
  };

  // Clips sitting in the Persona folder that no persona points at.
  const claimed = new Set(lib.personas.flatMap((p) => PERSONA_PARTS.map((k) => p[k]).filter(Boolean) as string[]));
  const unassigned = clips.filter((v) => !claimed.has(v.id));

  return (
    <div className="flex-1 overflow-y-auto p-2">
      <div className="mb-2 flex items-center gap-2">
        <p className="flex-1 text-[10px] text-zinc-500">One persona fills Start, Top A and Top B.</p>
        <button
          data-vids-new-persona
          onClick={() => setNewDraft('')}
          className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:border-zinc-500 hover:text-white"
        >
          + New persona
        </button>
      </div>

      {newDraft !== null && (
        <input
          autoFocus
          value={newDraft}
          placeholder="Persona name"
          onChange={(e) => setNewDraft(e.target.value)}
          onBlur={() => void commitNew()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitNew();
            if (e.key === 'Escape') setNewDraft(null);
          }}
          className="mb-2 w-full rounded border border-zinc-600 bg-black px-2 py-1 text-[11px] text-white outline-none"
        />
      )}

      {lib.personas.length === 0 && newDraft === null ? (
        <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-zinc-800 p-5 text-center">
          <VideoIcon size={16} className="mb-2 text-zinc-600" />
          <p className="text-[11px] text-zinc-400">No personas yet</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-600">
            Make one, then drop its three clips — Start, Top A, Top B — onto the tiles.
          </p>
        </div>
      ) : (
        lib.personas.map((p) => (
          <PersonaCard
            key={p.id}
            persona={p}
            videoById={videoById}
            busyPart={busy?.persona === p.id ? busy.part : null}
            applied={appliedPersonaId === p.id}
            onUse={() => onUse(p)}
            onRename={(name) => void lib.updatePersona(p.id, { name })}
            onDelete={() => {
              if (window.confirm(`Delete persona "${p.name}"? Its clips stay in the Persona folder — nothing is deleted from the cloud.`)) {
                void lib.deletePersona(p.id);
              }
            }}
            onFiles={(part, files) => void attachFiles(p, part, files)}
            onVideoId={(part, id) => void attachVideo(p, part, id)}
            onPreview={onPreview}
            onClear={(part) => void lib.updatePersona(p.id, { [part]: null })}
          />
        ))
      )}

      {unassigned.length > 0 && (
        <div className="mt-3 border-t border-zinc-800 pt-2">
          <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-600">
            In this folder, not in a persona · {unassigned.length}
          </p>
          <div className="grid grid-cols-3 gap-1">
            {unassigned.map((v) => (
              <div
                key={v.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(VID_DRAG_MIME, v.id);
                  e.dataTransfer.effectAllowed = 'copyMove';
                }}
                title={`${v.name} — click to play it, drag it onto a persona tile`}
                className="group/u relative overflow-hidden rounded border border-zinc-800 bg-black"
              >
                <button onClick={() => onPreview(v)} className="flex h-10 w-full items-center justify-center">
                  {v.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={v.thumbUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    <VideoIcon size={12} className="text-zinc-700" />
                  )}
                </button>
                <p className="truncate px-1 py-0.5 text-[9px] text-zinc-400">{v.name}</p>
                <button
                  onClick={() => {
                    if (window.confirm(`Delete "${v.name}" from the cloud for everyone?`)) void lib.deleteVideo(v);
                  }}
                  title="Delete from the cloud"
                  className="absolute right-0.5 top-0.5 hidden rounded bg-black/80 p-0.5 text-zinc-400 hover:text-red-400 group-hover/u:block"
                >
                  <TrashIcon size={10} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
