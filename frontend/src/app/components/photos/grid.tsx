'use client';

// The grid of free-to-use photos: square tiles, each with its licence. Shared by the Pricer's photo panel and
// the Photos section.

import { useState } from 'react';
import type { FreePhoto } from '@/lib/photos/types';

const COLS = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' } as const;

// Openverse's thumbnailer fails on some files; fall back to the photo itself.
function Thumb({ photo }: { photo: FreePhoto }) {
  const [src, setSrc] = useState(photo.thumb);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={photo.title}
      loading="lazy"
      draggable={false}
      onError={() => { if (src !== photo.full) setSrc(photo.full); }}
      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
    />
  );
}

export function PhotoGrid({ photos, selectedId, onSelect, cols = 2 }: {
  photos: FreePhoto[];
  selectedId?: string;
  onSelect: (photo: FreePhoto) => void;
  cols?: keyof typeof COLS;
}) {
  return (
    <div className={`grid gap-2 ${COLS[cols]}`}>
      {photos.map(p => (
        <button
          key={p.id}
          type="button"
          onClick={() => onSelect(p)}
          title={`${p.title}${p.creator ? ` · ${p.creator}` : ''} · ${p.license}`}
          className={`group relative aspect-square overflow-hidden rounded-md bg-zinc-900 ring-1 transition ${
            selectedId === p.id ? 'ring-emerald-400' : 'ring-transparent hover:ring-zinc-500'
          }`}
        >
          <Thumb photo={p} />
          <span className="absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)] truncate rounded bg-black/70 px-1 py-px text-[9px] uppercase tracking-wide text-zinc-300">
            {p.license}
          </span>
        </button>
      ))}
    </div>
  );
}
