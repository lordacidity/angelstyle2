'use client';

// The code box, top left of the form. Every downloaded video has a code after
// its title — "Velo Ronaldo Salary - K7Q4M2" → K7Q4M2 — and the same code on
// the end of its post caption. Type it here (or paste the whole file name;
// the code is picked out of it) and the video it was comes back: the form
// fills with its answers and Generate runs on them, with the words, the look
// and the sound off the record rather than rolled and asked for again.
//
// Only on the form — the tuning page has a video on it already, and Start over
// is the way back here. Just the box: what happens with the code is the
// section's business (Vids2Section loadCode), since everything it brings back
// lives there.

import { useState, type FormEvent } from 'react';
import type { VidRecipe } from '@/lib/vids-types';
import { SpinnerIcon } from '@/lib/icons';

interface Props {
  /** The library hasn't arrived yet, so there is nothing to resolve a code against. */
  disabled: boolean;
  busy: boolean;
  /** The video last brought back, and whatever about it didn't come back whole. */
  loaded: VidRecipe | null;
  problems: string[];
  error: string | null;
  onLoad: (raw: string) => void;
}

const madeOn = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function Vids2Recall({ disabled, busy, loaded, problems, error, onLoad }: Props) {
  const [raw, setRaw] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (raw.trim() && !busy && !disabled) onLoad(raw);
  };

  return (
    <form
      data-vids2-recall
      onSubmit={submit}
      title="Every downloaded video has a code after its title and on the end of its caption. Type it here and that video comes back — the answers, the words, the song, the look."
      className="absolute left-3 top-3 z-30 w-[236px] rounded-lg border border-zinc-700 bg-zinc-950/90 p-1.5 shadow-lg backdrop-blur"
    >
      <div className="flex items-center gap-1">
        <input
          id="vids2-recall-code"
          aria-label="Bring a video back by its code"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={disabled ? 'loading the library…' : 'Video code, e.g. K7Q4M2'}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="characters"
          className="h-7 min-w-0 flex-1 rounded-md border border-zinc-700 bg-black px-2 font-mono text-xs uppercase tracking-widest text-zinc-100 outline-none placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-zinc-600 focus:border-zinc-500"
        />
        <button
          type="submit"
          disabled={disabled || busy || !raw.trim()}
          className="flex h-7 w-14 shrink-0 items-center justify-center rounded-md bg-white text-xs font-semibold text-black transition-colors hover:bg-zinc-200 disabled:opacity-40"
        >
          {busy ? <SpinnerIcon size={12} className="animate-spin" /> : 'Load'}
        </button>
      </div>
      {error && <p className="mt-1.5 break-words px-0.5 text-[11px] leading-snug text-red-400">{error}</p>}
      {loaded && !error && (
        <div className="mt-1.5 px-0.5 text-[11px] leading-snug">
          <p className="text-emerald-400">
            Loaded <span className="font-medium text-emerald-300">{loaded.title}</span>
            <span className="text-zinc-500"> · </span>
            <span className="font-mono tracking-wider">{loaded.code}</span>
          </p>
          <p className="text-zinc-500">
            made {madeOn(loaded.createdAt)}{problems.length ? '' : ' — everything came back'}
          </p>
          {problems.map((p, i) => <p key={i} className="mt-0.5 text-amber-300">{p}</p>)}
        </div>
      )}
    </form>
  );
}
