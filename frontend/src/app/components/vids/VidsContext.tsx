'use client';

// The context a piece of footage carries: what it is showing, said in your own
// words ("chatgpt looking up ronaldo", "pauv.com looking up and trading on
// ronaldo").
//
// Two ways in, both on the Edit & file page:
//   the editor's Context panel   for the clip that is open
//   right-click a thumbnail      the popup below, without opening anything —
//                                and that one takes the name as well, since
//                                what a thing is called and what it shows are
//                                usually fixed together
//
// An ordinary clip carries its own. A persona's three clips do not — they are
// one performance, so the persona holds the context for all three and you set it
// by right-clicking the persona (or any of its parts).

import { useEffect, useRef, useState } from 'react';
import type { VidContext, VidContextPatch } from '@/lib/vids-types';
import { CloseIcon } from '@/lib/icons';

export const CONTEXT_PLACEHOLDER = 'chatgpt looking up ronaldo';

/** What a save from the popup can change: the context, and the name when it
 *  was edited. */
export type VidsContextSave = VidContextPatch & { name?: string };

interface DialogProps {
  /** Whose name and context these are — the heading says which. */
  kind: 'clip' | 'persona';
  /** What it is called now. */
  name: string;
  /** One line under the heading — which clips this actually covers. */
  hint: string;
  value: VidContext;
  onSave: (patch: VidsContextSave) => void;
  onClose: () => void;
}

/** The right-click popup: the name, and what it is showing. Nothing is written
 *  until Save, so Escape or a click outside leaves both exactly as they were;
 *  a name wiped blank is left as it was too, since nothing can be called
 *  nothing. */
export function VidsContextDialog({ kind, name, hint, value, onSave, onClose }: DialogProps) {
  const [title, setTitle] = useState(name);
  const [text, setText] = useState(value.context);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { areaRef.current?.focus(); }, []);

  const save = () => {
    const clean = title.trim();
    onSave({ ...(clean && clean !== name ? { name: clean } : {}), context: text.trim() });
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
            <p className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
              {kind === 'persona' ? 'Persona' : 'Clip'}
            </p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500">{hint}</p>
          </div>
          <button onClick={onClose} title="Close" className="shrink-0 text-zinc-500 hover:text-white">
            <CloseIcon size={13} />
          </button>
        </div>

        <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Name</p>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={name}
          maxLength={kind === 'persona' ? 120 : 200}
          className="mb-2 w-full rounded border border-zinc-700 bg-black px-2 py-1.5 text-[11px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-400"
        />

        <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
          {kind === 'persona' ? 'What he is doing' : 'What it shows'}
        </p>
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
