'use client';

// The clipper page's Save Video popup. A phone opens its share sheet (where
// Save Video puts the file in Photos) only for a tap, and a render that ends a
// minute after Download was pressed no longer counts that press. This is the
// tap: one button over the foot of the page, which stays visible behind it.

import { DownloadIcon } from '@/lib/icons';

export function SavePopup({ onSave, onClose }: { onSave: () => void; onClose: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="relative mx-auto max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-3 shadow-2xl shadow-black">
        <button
          type="button"
          onClick={onClose}
          aria-label="Not now"
          className="absolute -top-3 right-2 grid h-7 w-7 place-items-center rounded-full border border-zinc-700 bg-zinc-900 text-sm text-zinc-400 hover:text-white"
        >
          ×
        </button>
        <button
          type="button"
          onClick={onSave}
          autoFocus
          className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-white text-lg font-semibold text-black active:bg-zinc-200"
        >
          <DownloadIcon size={18} /> Save Video
        </button>
      </div>
    </div>
  );
}
