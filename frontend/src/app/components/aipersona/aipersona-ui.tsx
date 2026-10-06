'use client';

// The bits the AI Persona screens share: the buttons, a place to drop a file,
// and a delete that asks twice.

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MAX_PHOTO_BYTES, PHOTO_TYPES } from '@/lib/aipersona/types';

export const PRIMARY =
  'flex h-9 items-center justify-center gap-2 rounded-md bg-emerald-500 px-4 text-xs font-semibold text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-30';
export const GHOST =
  'flex h-9 items-center justify-center gap-1.5 rounded-md border border-zinc-800 px-3 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-30';
export const FIELD =
  'w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-colors focus:border-zinc-500';
export const LABEL = 'text-[11px] uppercase tracking-wide text-zinc-500';

export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Why this file can't be a character photo, or nothing if it can. */
export function photoProblem(file: File): string {
  if (!PHOTO_TYPES.includes(file.type)) return `A character photo is a JPEG, PNG or WebP — that one is ${file.type || 'of no stated type'}.`;
  if (file.size > MAX_PHOTO_BYTES) return `That photo is ${(file.size / 1024 / 1024).toFixed(1)}MB; the limit is ${MAX_PHOTO_BYTES / 1024 / 1024}MB.`;
  return '';
}

/** A scene's two halves: the panel on the left that drives it, and the
 *  personas on the right. */
export function Split({ title, backLabel, onBack, side, footer, children }: {
  title: string; backLabel: string; onBack: () => void; side: ReactNode; footer?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="flex h-full bg-black text-white">
      <aside className="flex w-[380px] shrink-0 flex-col border-r border-zinc-900">
        <div className="shrink-0 border-b border-zinc-900 px-5 py-4">
          <button type="button" onClick={onBack} className="text-xs text-zinc-500 transition-colors hover:text-white">
            ← {backLabel}
          </button>
          <h1 className="mt-1 truncate text-lg font-semibold">{title}</h1>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{side}</div>
        {footer && <div className="shrink-0 border-t border-zinc-900 px-5 py-4">{footer}</div>}
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto px-6 py-6">{children}</main>
    </div>
  );
}

/** Somewhere to drop a file, or click to pick one. What it looks like inside
 *  is the caller's. */
export function DropZone({ accept, onFile, disabled, label, className = '', children }: {
  accept: string; onFile: (file: File) => void; disabled?: boolean; label: string; className?: string; children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pick = () => { if (!disabled) input.current?.click(); };
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      onClick={pick}
      onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file && !disabled) onFile(file);
      }}
      className={`overflow-hidden border border-dashed transition-colors ${
        disabled ? 'cursor-default' : 'cursor-pointer'
      } ${over ? 'border-zinc-400 bg-zinc-900' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'} ${className}`}
    >
      {children}
      <input
        ref={input}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
    </div>
  );
}

/** A delete that asks twice: the first click arms it, the second does it, and
 *  it stands down by itself if the second never comes. */
export function ConfirmButton({ onConfirm, disabled, className = '', armedLabel = 'Click again to delete', children }: {
  onConfirm: () => void; disabled?: boolean; className?: string; armedLabel?: string; children: ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!armed) { setArmed(true); return; }
        setArmed(false);
        onConfirm();
      }}
      className={`${className} ${armed ? '!border-red-500 !text-red-400' : ''}`}
    >
      {armed ? armedLabel : children}
    </button>
  );
}
