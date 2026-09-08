'use client';

// VidPreview — the little playback popup. Clicking a clip anywhere in the
// library opens this rather than acting on it, so you can see what a piece of
// footage actually is before dragging it into a folder or dropping it on a
// slot. Plays muted on a loop (browsers block autoplay with sound); the native
// controls are there to scrub or unmute.

import { useEffect, useRef } from 'react';
import { isPhoto } from '@/lib/vids-types';
import type { VidRow } from '@/lib/vids-types';
import { fmtTime } from '@/lib/utils';
import { CloseIcon } from '@/lib/icons';

export function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

interface Props {
  video: VidRow;
  /** Shown as the primary action when this clip can go somewhere useful. */
  action?: { label: string; onClick: () => void } | null;
  onClose: () => void;
}

export function VidPreview({ video, action, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Pause before unmounting so the decoder is released promptly when a burst of
  // clips is being checked one after another.
  useEffect(() => () => { videoRef.current?.pause(); }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onPointerDown={onClose}
    >
      <div
        data-vids-preview
        className="w-full max-w-md overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-zinc-200" title={video.name}>
            {video.name}
          </span>
          <button onClick={onClose} title="Close (Esc)" className="text-zinc-500 hover:text-white">
            <CloseIcon size={14} />
          </button>
        </div>

        {isPhoto(video) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={video.url} alt={video.name} className="max-h-[60vh] w-full bg-black object-contain" />
        ) : (
          <video
            ref={videoRef}
            src={video.url}
            poster={video.thumbUrl ?? undefined}
            crossOrigin="anonymous"
            controls
            autoPlay
            loop
            muted
            playsInline
            className="max-h-[60vh] w-full bg-black"
          />
        )}

        <div className="flex items-center gap-2 px-3 py-2">
          <p className="min-w-0 flex-1 truncate text-[10px] text-zinc-500">
            {isPhoto(video) ? 'Photo' : video.duration != null ? fmtTime(video.duration) : '–:––'} · {fmtBytes(video.sizeBytes)}
            {video.width && video.height ? ` · ${video.width}×${video.height}` : ''}
          </p>
          {action && (
            <button
              onClick={() => { action.onClick(); onClose(); }}
              className="shrink-0 rounded border border-zinc-600 bg-white px-2 py-1 text-[10px] font-medium text-black hover:bg-zinc-200"
            >
              {action.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
