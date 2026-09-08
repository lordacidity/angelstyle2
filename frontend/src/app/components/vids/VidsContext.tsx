'use client';

// The context a piece of footage carries: what it is showing, said in your own
// words ("chatgpt looking up ronaldo", "pauv.com looking up and trading on
// ronaldo").
//
// Two ways in, both on the Edit & file page:
//   the editor's Context panel   for the clip that is open
//   right-click a thumbnail      the popup below, without opening anything
//
// An ordinary clip carries its own. A persona's three clips do not — they are
// one performance, so the persona holds the context for all three and you set it
// by right-clicking the persona (or any of its parts).

import { useEffect, useRef, useState } from 'react';
import type { VidContext, VidContextPatch } from '@/lib/vids-types';
import { CloseIcon } from '@/lib/icons';

export const CONTEXT_PLACEHOLDER = 'chatgpt looking up ronaldo';

interface DialogProps {
  /** What this context belongs to, for the heading. */
  title: string;
  /** One line under it — which clips this actually covers. */
  hint: string;
  value: VidContext;
  onSave: (patch: VidContextPatch) => void;
  onClose: () => void;
}

/** The right-click popup. Nothing is written until Save, so Escape or a click
 *  outside leaves the context exactly as it was. */
export function VidsContextDialog({ title, hint, value, onSave, onClose }: DialogProps) {
  const [text, setText] = useState(value.context);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { areaRef.current?.focus(); }, []);

  const save = () => {
    onSave({ context: text.trim() });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
          // Enter saves; Shift+Enter is a new line, since context can be a
          // sentence or two.
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
        }}
        className="w-[380px] rounded-lg border border-zinc-700 bg-zinc-950 p-4 shadow-2xl"
      >
        <div className="mb-2 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold text-zinc-100" title={title}>{title}</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500">{hint}</p>
          </div>
          <button onClick={onClose} title="Close" className="shrink-0 text-zinc-500 hover:text-white">
            <CloseIcon size={13} />
          </button>
        </div>

        <textarea
          ref={areaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder={CONTEXT_PLACEHOLDER}
          className="w-full resize-none rounded border border-zinc-700 bg-black px-2 py-1.5 text-[11px] leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500"
        />

        <div className="mt-3 flex items-center gap-1.5">
          <span className="flex-1 text-[9px] text-zinc-600">Enter saves · Shift+Enter for a new line</span>
          <button
            onClick={onClose}
            className="rounded border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="rounded bg-white px-3 py-1 text-[11px] font-medium text-black hover:bg-zinc-200"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
