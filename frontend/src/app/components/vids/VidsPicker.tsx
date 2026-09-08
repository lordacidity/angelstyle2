'use client';

// VidsPicker — the chooser that opens when you click a card in the builder's
// rack. Clicking "Bottom A" shows what is in the Bottom A folder; clicking
// "Persona" shows the personas. Either way you pick from the popup instead of
// hunting through the library pane on the far side of the screen.
//
// A tile's play button previews it inline (muted, looping) so you can tell two
// similar clips apart without leaving the popup; clicking the tile itself picks
// it and closes.

import { useEffect, useState } from 'react';
import type { PersonaPart, VidPersona, VidRow } from '@/lib/vids-types';
import { PERSONA_PARTS, PERSONA_PART_LABEL, isPhoto } from '@/lib/vids-types';
import { fmtTime } from '@/lib/utils';
import { CloseIcon, VideoIcon } from '@/lib/icons';

function PlayBadge() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function Shell({ title, subtitle, action, onClose, children }: {
  title: string;
  subtitle: string;
  /** Something for the top right, beside Close — Bottom B's "Choose from any". */
  action?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onPointerDown={onClose}>
      <div
        data-vids-picker
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
          <span className="text-[12px] font-semibold text-zinc-200">{title}</span>
          <span className="min-w-0 flex-1 truncate text-[10px] text-zinc-500">{subtitle}</span>
          {action}
          <button onClick={onClose} title="Close (Esc)" className="text-zinc-500 hover:text-white">
            <CloseIcon size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-zinc-800 p-6 text-center">
      <VideoIcon size={18} className="mb-2 text-zinc-700" />
      <p className="text-[11px] leading-relaxed text-zinc-500">{children}</p>
    </div>
  );
}

// ── One clip tile ─────────────────────────────────────────────────────────────
// Shared with the Link page, where `current` means linked rather than in use —
// hence the badge is a prop.

export function ClipTile({ video, current, badge = 'In use', tag, title, onChoose }: {
  video: VidRow;
  current: boolean;
  /** What the corner says while `current`. */
  badge?: string;
  /** A word after the length — "Linked", when the list shows more than the
   *  linked ones. */
  tag?: string;
  title?: string;
  onChoose: () => void;
}) {
  const [playing, setPlaying] = useState(false);

  return (
    <div
      onClick={onChoose}
      title={title ?? `${video.name} — click to use it here`}
      className={`group relative cursor-pointer overflow-hidden rounded-md border bg-zinc-950 ${
        current ? 'border-emerald-600' : 'border-zinc-800 hover:border-zinc-500'
      }`}
    >
      <div className="flex h-24 items-center justify-center bg-black">
        {playing ? (
          <video
            src={video.url}
            poster={video.thumbUrl ?? undefined}
            crossOrigin="anonymous"
            autoPlay
            loop
            muted
            playsInline
            className="h-full w-full object-contain"
          />
        ) : video.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={video.thumbUrl} alt="" className="h-full w-full object-contain" draggable={false} />
        ) : (
          <VideoIcon size={20} className="text-zinc-700" />
        )}
      </div>
      <div className="px-2 py-1">
        <p className="truncate text-[10px] text-zinc-200" title={video.name}>{video.name}</p>
        <p className="text-[9px] text-zinc-500">
          {isPhoto(video) ? 'Photo' : video.duration != null ? fmtTime(video.duration) : '–:––'}
          {tag && <span className="text-emerald-400"> · {tag}</span>}
        </p>
      </div>
      {/* A still has nothing to play — the tile already shows the whole of it. */}
      {!isPhoto(video) && (
      <button
        onClick={(e) => { e.stopPropagation(); setPlaying((v) => !v); }}
        title={playing ? 'Stop the preview' : 'Play a preview'}
        className={`absolute left-1 top-1 rounded bg-black/75 p-1 text-white transition-opacity ${
          playing ? 'opacity-100' : 'opacity-60 group-hover:opacity-100'
        }`}
      >
        {playing ? <CloseIcon size={10} /> : <PlayBadge />}
      </button>
      )}
      {current && (
        <span className="absolute right-1 top-1 rounded bg-emerald-600/90 px-1 py-px text-[9px] font-medium text-white">
          {badge}
        </span>
      )}
    </div>
  );
}

// ── Clip picker (Bottom A / Bottom B / End) ───────────────────────────────────

export function VidsClipPicker({
  title, folder, clips, subtitle, linkedIds, onShowAll, currentId, onChoose, onClose,
}: {
  title: string;
  folder: string;
  clips: VidRow[];
  /** Where these came from, when it isn't simply the folder — Bottom B narrowed
   *  to what is linked to the Bottom A on the stage, say. */
  subtitle?: string;
  /** The clips the Link page pairs with the Bottom A on the stage. Tagged, so
   *  they still stand out once the list shows more than them. */
  linkedIds?: Set<string>;
  /** The list is narrowed to the linked ones, and this opens it up to the whole
   *  folder — the "Choose from any" button, top right. */
  onShowAll?: () => void;
  currentId: string | null;
  onChoose: (v: VidRow) => void;
  onClose: () => void;
}) {
  // While the list is only the linked ones, tagging every tile says nothing.
  const tagLinked = !!linkedIds && !onShowAll;
  return (
    <Shell
      title={`Choose ${title}`}
      subtitle={subtitle ?? `from the ${folder} folder`}
      onClose={onClose}
      action={onShowAll && (
        <button
          onClick={onShowAll}
          title={`Show everything in the ${folder} folder, not just what is linked`}
          className="shrink-0 rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-white"
        >
          Choose from any
        </button>
      )}
    >
      {clips.length === 0 ? (
        <Empty>
          Nothing in <span className="text-zinc-300">{folder}</span> yet. Upload clips in the library pane, then drag
          them onto that folder.
        </Empty>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {clips.map((v) => (
            <ClipTile
              key={v.id}
              video={v}
              current={v.id === currentId}
              tag={tagLinked && linkedIds.has(v.id) ? 'Linked' : undefined}
              onChoose={() => { onChoose(v); onClose(); }}
            />
          ))}
        </div>
      )}
    </Shell>
  );
}

// ── Persona picker ────────────────────────────────────────────────────────────

export function VidsPersonaPicker({ personas, resolveVideo, currentId, onChoose, onClose }: {
  personas: VidPersona[];
  resolveVideo: (id: string) => VidRow | undefined;
  currentId: string | null;
  onChoose: (p: VidPersona) => void;
  onClose: () => void;
}) {
  return (
    <Shell title="Choose persona" subtitle="fills Start, Top A and Top B" onClose={onClose}>
      {personas.length === 0 ? (
        <Empty>
          No personas yet. Open the <span className="text-zinc-300">Persona</span> folder in the library pane and make
          one, then drop its three clips onto its tiles.
        </Empty>
      ) : (
        <div className="space-y-2">
          {personas.map((p) => {
            const filled = PERSONA_PARTS.filter((k) => p[k]).length;
            const current = p.id === currentId;
            return (
              <button
                key={p.id}
                onClick={() => { onChoose(p); onClose(); }}
                disabled={filled === 0}
                title={`Use ${p.name}`}
                className={`flex w-full items-center gap-2 rounded-md border p-2 text-left transition-colors disabled:opacity-40 ${
                  current ? 'border-emerald-600 bg-emerald-950/20' : 'border-zinc-800 hover:border-zinc-500'
                }`}
              >
                <span className="flex shrink-0 gap-1">
                  {PERSONA_PARTS.map((part: PersonaPart) => {
                    const v = resolveVideo(p[part] ?? '');
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
                  <span className="block truncate text-[11px] font-semibold text-zinc-200">{p.name}</span>
                  <span className={`block text-[9px] ${filled === 3 ? 'text-zinc-500' : 'text-amber-400'}`}>
                    {filled === 3 ? 'Start · Top A · Top B' : `${filled} of 3 clips`}
                  </span>
                </span>
                {current && <span className="shrink-0 text-[9px] text-emerald-400">In use</span>}
              </button>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
