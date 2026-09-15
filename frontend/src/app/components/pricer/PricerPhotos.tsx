'use client';

// Pricer photos — the panel down the left of the Pricer: a free-to-use photo of the person being priced.
//
// When a pricing starts the panel searches Wikimedia Commons and Openverse (Flickr and friends, commercial-use
// licences only) for the name — /api/photos/search, one request per source — and shows the results as square
// tiles, each with its licence, as each source answers. If the bio step identifies them under another spelling,
// the panel searches again with that. Pick one and it is cropped to a square: drag to move, the slider or the
// wheel to zoom. Download renders that crop to a JPEG named after the person ("Tate McRae.jpg"). The query can be
// edited and searched again without pricing again. The crop and the grid are shared with the Photos section
// (components/photos).

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { SpinnerIcon } from '@/lib/icons';
import type { FreePhoto, PhotoSource } from '@/lib/photos/types';
import { CropSquare } from '../photos/crop';
import { PhotoGrid } from '../photos/grid';
import { SOURCES, fetchPhotos, mergePhotos } from '../photos/search';

const sameName = (a: string, b: string) => {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  return norm(a) === norm(b);
};

// person: the name as typed for the pricing. canonical: the bio step's name for them, once it has one.
export function PricerPhotos({ person, canonical }: { person: string; canonical?: string }) {
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [photos, setPhotos] = useState<FreePhoto[]>([]);
  const [errors, setErrors] = useState<Partial<Record<PhotoSource, string>>>({});
  const [pending, setPending] = useState<PhotoSource[]>([]);
  const [selected, setSelected] = useState<FreePhoto | null>(null);
  const seq = useRef(0);
  const renamedTo = useRef('');
  const typedIn = useRef(false);   // the search box was changed by hand since the pricing started

  // One request per source, and each one's photos join the grid when they land, so a slow Openverse never holds
  // up Commons.
  const search = useCallback((q: string) => {
    const s = ++seq.current;
    setQuery(q);
    setSearched(q);
    setPhotos([]);
    setErrors({});
    setSelected(null);
    setPending(SOURCES.map(x => x.key));
    for (const { key } of SOURCES) {
      fetchPhotos(key, q)
        .then(fresh => { if (s === seq.current) setPhotos(prev => mergePhotos(prev, fresh)); })
        .catch(e => { if (s === seq.current) setErrors(prev => ({ ...prev, [key]: e instanceof Error ? e.message : String(e) })); })
        .finally(() => { if (s === seq.current) setPending(prev => prev.filter(k => k !== key)); });
    }
  }, []);

  // A new pricing searches for its name. The name arrives as a prop from a run that started elsewhere, so these two
  // effects are where the search starts, and search() clears the old results straight away.
  useEffect(() => {
    if (!person) return;
    renamedTo.current = '';
    typedIn.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    search(person);
  }, [person, search]);

  // The bio step may know them by another spelling ("Lil Dirk" typed, "Lil Durk" found). Search that once it
  // arrives — unless a photo is already being cropped or the search box has been changed by hand.
  useEffect(() => {
    if (!canonical || !person || sameName(canonical, person) || renamedTo.current === canonical) return;
    renamedTo.current = canonical;
    if (selected || typedIn.current) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see "A new pricing" above
    search(canonical);
  }, [canonical, person, selected, search]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q) search(q);
  };

  const busy = pending.length > 0;
  const waitingOn = SOURCES.filter(x => pending.includes(x.key)).map(x => x.label).join(' and ');

  return (
    <aside className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-r border-zinc-900">
      <form onSubmit={submit} autoComplete="off" className="border-b border-zinc-900 p-4">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="text-[13px] font-semibold text-white">Photo</h2>
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">Wikimedia · Openverse</span>
        </div>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={e => { typedIn.current = true; setQuery(e.target.value); }}
            placeholder="Who to look for"
            className="h-9 min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-[13px] text-zinc-100 placeholder-zinc-600 outline-none transition-colors focus:border-zinc-500"
          />
          <button
            type="submit"
            disabled={!query.trim()}
            className="h-9 shrink-0 rounded-md border border-zinc-700 px-3 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          >
            Search
          </button>
        </div>
      </form>

      {selected && (
        <div className="border-b border-zinc-900">
          <CropSquare photo={selected} person={canonical || person || searched} onClear={() => setSelected(null)} />
        </div>
      )}

      <div className="p-4">
        {!searched ? (
          <p className="text-xs leading-relaxed text-zinc-600">Price someone and free-to-use photos of them appear here. Pick one, square it up, download it under their name.</p>
        ) : (
          <>
            {SOURCES.map(({ key, label }) => errors[key] && (
              <p key={key} className="mb-2 text-xs text-red-400">{label}: {errors[key]}</p>
            ))}
            {photos.length === 0 && busy && (
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <SpinnerIcon size={14} className="animate-spin" /> Searching {waitingOn} for &ldquo;{searched}&rdquo;…
              </div>
            )}
            {photos.length === 0 && !busy && <p className="text-xs text-zinc-500">No free-to-use photos found for &ldquo;{searched}&rdquo;.</p>}
            {photos.length > 0 && (
              <>
                <PhotoGrid photos={photos} selectedId={selected?.id} onSelect={setSelected} />
                {busy && (
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-500">
                    <SpinnerIcon size={12} className="animate-spin" /> Still searching {waitingOn}…
                  </div>
                )}
                <p className="mt-3 text-[11px] leading-snug text-zinc-600">
                  {photos.length} photo{photos.length === 1 ? '' : 's'}. Most CC licences ask for a credit — the file page is linked once you pick one.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
