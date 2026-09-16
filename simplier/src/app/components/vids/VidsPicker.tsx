'use client';

// VidsPicker — the chooser that opens when you click the Persona card in the
// builder's sidebar, and the shell the Bottom popup is built on (VidsBottom).
// Each persona is one row: its three clips as thumbnails, its name, and how
// many of the three it actually has. Clicking one picks it and closes.

import { useEffect } from 'react';
import type { VidPersona, VidRow } from '@/lib/vids-types';
import { PERSONA_PARTS } from '@/lib/vids-types';
import { CloseIcon, VideoIcon } from '@/lib/icons';

export function Shell({ title, subtitle, action, onClose, children }: {
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


// ── Persona picker ────────────────────────────────────────────────────────────

export function VidsPersonaPicker({ personas, resolveVideo, currentId, onChoose, onClose }: {
  personas: VidPersona[];
  resolveVideo: (id: string) => VidRow | undefined;
  currentId: string | null;
  onChoose: (p: VidPersona) => void;
  onClose: () => void;
}) {
  return (
    <Shell title="Choose persona" subtitle="" onClose={onClose}>
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
                {/* Top A alone. It is the one you recognise a persona by —
                    the shot that rides over the screen recording — and three
                    thumbnails of the same face said no more than one. */}
                {(() => {
                  const v = resolveVideo(p.topAId ?? '');
                  return (
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded border bg-black ${
                        v ? 'border-zinc-700' : 'border-dashed border-zinc-700'
                      }`}
                    >
                      {v?.thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={v.thumbUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                      ) : (
                        <VideoIcon size={14} className="text-zinc-700" />
                      )}
                    </span>
                  );
                })()}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-semibold text-zinc-200">{p.name}</span>
                  {/* A complete persona says nothing — it is the ordinary
                      case. Only a short one is worth a word. */}
                  {filled !== 3 && (
                    <span className="block text-[9px] text-amber-400">{filled} of 3 clips</span>
                  )}
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
