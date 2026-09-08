'use client';

// The code box, at the very top-left of the build stage. Type the code off a
// finished video's title — "Velo Ronaldo Salary - K7Q4M2" → K7Q4M2 — and the
// build it came from goes back on the stage exactly: persona, clips, framing,
// trims, bars, sound, output size, captions and their style. The whole file
// name pastes too; the code is picked out of it.
//
// Just the box. What happens with the code is the builder's business, since
// everything it restores lives there.

import { useState, type FormEvent } from 'react';
import type { VidRecipe } from '@/lib/vids-types';
import { SpinnerIcon } from '@/lib/icons';

interface Props {
  /** The library hasn't arrived yet, so there is nothing to resolve a code against. */
  disabled: boolean;
  busy: boolean;
  /** The build last brought back, and whatever about it didn't come back exactly. */
  loaded: VidRecipe | null;
  problems: string[];
  error: string | null;
  onLoad: (raw: string) => void;
}

const madeOn = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function VidsRecall({ disabled, busy, loaded, problems, error, onLoad }: Props) {
  const [raw, setRaw] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (raw.trim() && !busy && !disabled) onLoad(raw);
  };

  return (
    <form
      data-vids-recall
      onSubmit={submit}
      title="Every downloaded or saved video has a code after its title. Type it here and that exact build comes back — persona, clips, captions, everything."
      className="absolute left-3 top-3 z-10 w-[236px] rounded-md border border-zinc-800 bg-zinc-950/90 p-2 shadow-lg backdrop-blur"
    >
      <label htmlFor="vids-recall-code" className="block text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
        Bring a build back
      </label>
      <div className="mt-1 flex items-center gap-1">
        <input
          id="vids-recall-code"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={disabled ? 'loading the library…' : 'code off the title, e.g. K7Q4M2'}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="characters"
          className="min-w-0 flex-1 rounded border border-zinc-700 bg-black px-1.5 py-1 font-mono text-[11px] uppercase tracking-widest text-zinc-100 outline-none placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-zinc-600 focus:border-zinc-500"
        />
        <button
          type="submit"
          disabled={disabled || busy || !raw.trim()}
          className="flex h-6 w-12 shrink-0 items-center justify-center rounded bg-white text-[10px] font-medium text-black hover:bg-zinc-200 disabled:opacity-40"
        >
          {busy ? <SpinnerIcon size={11} className="animate-spin" /> : 'Load'}
        </button>
      </div>
      {error && <p className="mt-1 break-words text-[10px] text-red-400">{error}</p>}
      {loaded && !error && (
        <div className="mt-1 text-[10px] leading-snug">
          <p className="text-emerald-400">
            Loaded <span className="font-medium text-emerald-300">{loaded.title}</span>
            <span className="text-zinc-500"> · </span>
            <span className="font-mono tracking-wider">{loaded.code}</span>
          </p>
          <p className="text-zinc-600">
            made {madeOn(loaded.createdAt)}{problems.length ? '' : ' — everything matched'}
          </p>
          {problems.map((p, i) => <p key={i} className="mt-0.5 text-amber-300">{p}</p>)}
        </div>
      )}
    </form>
  );
}
