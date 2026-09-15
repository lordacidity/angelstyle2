'use client';

// Photos (Studio > Photos) — a free-to-use photo for every name on a list, one name after another.
//
// Paste names, one a line, press Go. Each name is searched on Wikimedia Commons and Openverse (the same
// /api/photos/search the Pricer's panel uses), a few names ahead of the one on screen. For the name on screen:
// pick a photo, square it up, Save — it downloads as "<name>.jpg" and the next name comes up. Skip moves on
// without a file; Back returns. The end lists what was saved and what was skipped, with a way to go round the
// skipped ones again. The section stays mounted across tab switches (StudioShell), so a list in progress keeps
// its place.

import { useEffect, useRef, useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from 'react';
import { SpinnerIcon } from '@/lib/icons';
import type { FreePhoto, PhotoSource } from '@/lib/photos/types';
import { CropSquare, fileName } from './crop';
import { PhotoGrid } from './grid';
import { SOURCES, fetchPhotos, mergePhotos } from './search';

// How many searches run at once, per source. Openverse allows anonymous callers 20 a minute, so one at a time
// with a gap; Commons is asked twice per name (grid and crop sizes) and answers in about a second.
const LIMITS: Record<PhotoSource, { atOnce: number; gapMs: number }> = {
  wikimedia: { atOnce: 2, gapMs: 0 },
  openverse: { atOnce: 1, gapMs: 3200 },
};

interface Result {
  query: string;                              // what was searched — the name, unless searched again by hand
  photos: FreePhoto[];
  errors: Partial<Record<PhotoSource, string>>;
  done: PhotoSource[];                        // sources that have answered, or failed
}
type Results = Record<string, Result>;
interface Job { name: string; source: PhotoSource; query: string; gen: number }

type Phase = 'input' | 'run' | 'done';
type Outcome = 'saved' | 'skipped';

// One name a line; blank lines and repeats (any case) dropped, first spelling kept.
function parseNames(text: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const n = raw.trim().replace(/\s+/g, ' ');
    if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    names.push(n);
  }
  return names;
}

// Searches every name on the list, a few at a time within each source's limits, the name on screen first. Each
// answer is folded into the results by name. A name searched again, or a new list, makes the old answers stale.
class Searches {
  private queue: Job[] = [];
  private inFlight: Record<PhotoSource, number> = { wikimedia: 0, openverse: 0 };
  private lastStart: Record<PhotoSource, number> = { wikimedia: 0, openverse: 0 };
  private timers: Partial<Record<PhotoSource, ReturnType<typeof setTimeout>>> = {};
  private gen: Record<string, number> = {};
  private first = '';

  constructor(private readonly update: Dispatch<SetStateAction<Results>>) {}

  // A new list. Whatever was queued is dropped and whatever is in flight is ignored when it lands.
  start(names: string[]) {
    this.queue = [];
    for (const n of Object.keys(this.gen)) this.gen[n]++;
    this.update({});
    for (const name of names) this.add(name, name);
    this.pump();
  }

  // One name searched again with other words; its old answers are dropped.
  again(name: string, query: string) {
    this.queue = this.queue.filter(j => j.name !== name);
    this.add(name, query);
    this.pump();
  }

  // The name on screen goes to the front of the queue.
  focus(name: string) {
    this.first = name;
    this.pump();
  }

  private add(name: string, query: string) {
    const gen = (this.gen[name] = (this.gen[name] ?? 0) + 1);
    this.update(prev => ({ ...prev, [name]: { query, photos: [], errors: {}, done: [] } }));
    for (const { key } of SOURCES) this.queue.push({ name, source: key, query, gen });
  }

  private pump() {
    for (const { key: source } of SOURCES) {
      const lim = LIMITS[source];
      while (this.inFlight[source] < lim.atOnce) {
        const wait = lim.gapMs - (Date.now() - this.lastStart[source]);
        if (wait > 0) {
          if (!this.timers[source]) this.timers[source] = setTimeout(() => { this.timers[source] = undefined; this.pump(); }, wait);
          break;
        }
        let at = this.queue.findIndex(j => j.source === source && j.name === this.first);
        if (at < 0) at = this.queue.findIndex(j => j.source === source);
        if (at < 0) break;
        const [job] = this.queue.splice(at, 1);
        this.inFlight[source]++;
        this.lastStart[source] = Date.now();
        this.run(job).finally(() => { this.inFlight[source]--; this.pump(); });
      }
    }
  }

  private async run(job: Job) {
    const live = () => this.gen[job.name] === job.gen;
    const patch = (f: (r: Result) => Partial<Result>) =>
      this.update(prev => (prev[job.name] ? { ...prev, [job.name]: { ...prev[job.name], ...f(prev[job.name]) } } : prev));
    try {
      const fresh = await fetchPhotos(job.source, job.query);
      if (live()) patch(r => ({ photos: mergePhotos(r.photos, fresh) }));
    } catch (e) {
      if (live()) patch(r => ({ errors: { ...r.errors, [job.source]: e instanceof Error ? e.message : String(e) } }));
    } finally {
      if (live()) patch(r => ({ done: [...r.done, job.source] }));
    }
  }
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-block rounded border border-zinc-700 px-2 py-0.5 text-[10px] uppercase tracking-wide whitespace-nowrap text-zinc-400">{children}</span>;
}
const btn = 'h-9 rounded-md border border-zinc-700 px-3 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-30';
const btnGo = 'h-9 rounded-md bg-emerald-500 px-4 text-xs font-semibold text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-30';
const field = 'rounded-md border border-zinc-800 bg-zinc-950 px-3 text-[15px] normal-case tracking-normal text-zinc-100 placeholder-zinc-600 outline-none transition-colors focus:border-zinc-500';

export function PhotosSection({ active }: { active: boolean }) {
  const [text, setText] = useState('');
  const [names, setNames] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>('input');
  const [index, setIndex] = useState(0);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [selected, setSelected] = useState<FreePhoto | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Results>({});
  const [searches] = useState(() => new Searches(setResults));
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (active && phase === 'input') textRef.current?.focus(); }, [active, phase]);

  const name = names[index] ?? '';
  const result = results[name];
  useEffect(() => { if (name) searches.focus(name); }, [name, searches]);

  const begin = (list: string[]) => {
    setNames(list);
    setOutcomes({});
    setIndex(0);
    setSelected(null);
    setQuery(list[0]);
    searches.start(list);
    setPhase('run');
  };
  const start = () => {
    const list = parseNames(text);
    if (list.length) begin(list);
  };
  const go = (i: number) => {
    if (i >= names.length) { setPhase('done'); setSelected(null); return; }
    setIndex(i);
    setSelected(null);
    setQuery(results[names[i]]?.query ?? names[i]);
  };
  const finish = (o: Outcome) => {
    setOutcomes(prev => ({ ...prev, [name]: o }));
    go(index + 1);
  };
  const again = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSelected(null);
    searches.again(name, q);
  };

  const saved = names.filter(n => outcomes[n] === 'saved').length;
  const skipped = names.filter(n => outcomes[n] === 'skipped').length;
  const parsed = parseNames(text);
  const lines = text.split(/\r?\n/).filter(l => l.trim()).length;

  const photos = result?.photos ?? [];
  const busy = !result || result.done.length < SOURCES.length;
  const waitingOn = SOURCES.filter(s => !result?.done.includes(s.key)).map(s => s.label).join(' and ');

  return (
    <div className="flex h-screen flex-col bg-black text-white">
      <div className="shrink-0 border-b border-zinc-900 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">Photos</h1>
            <p className="text-xs text-zinc-500">Paste names, one a line. For each one: pick a free-to-use photo, square it up, Save — it downloads as their name and the next name comes up.</p>
          </div>
          {phase !== 'input' && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Chip>{names.length} name{names.length === 1 ? '' : 's'} · {saved} saved · {skipped} skipped</Chip>
              <button type="button" onClick={() => setPhase('input')} className="h-8 rounded-md border border-zinc-800 px-3 text-xs text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white">
                New list
              </button>
            </div>
          )}
        </div>
      </div>

      {phase === 'input' && (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto w-full max-w-[640px]">
            <label className="grid gap-1.5 text-[11px] uppercase tracking-wide text-zinc-500">
              Names — one a line
              <textarea
                ref={textRef}
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); start(); } }}
                rows={12}
                placeholder={'Tate McRae\nLil Durk\nZendaya'}
                className={`w-full py-2 ${field}`}
              />
            </label>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" onClick={start} disabled={!parsed.length} className={btnGo}>Go</button>
              <span className="text-xs text-zinc-500">
                {parsed.length ? `${parsed.length} name${parsed.length === 1 ? '' : 's'}` : 'Nothing to look for yet'}
                {lines > parsed.length ? ` · ${lines - parsed.length} repeated line${lines - parsed.length === 1 ? '' : 's'} ignored` : ''}
                {parsed.length ? ' · Ctrl+Enter also goes' : ''}
              </span>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-zinc-600">
              Photos come from Wikimedia Commons and Openverse (Flickr and others), commercial-use licences only. Most ask for a credit — every tile shows its licence, and the file page is linked once a photo is picked. Files land wherever the browser puts downloads.
            </p>
          </div>
        </div>
      )}

      {phase === 'run' && (
        <div className="flex min-h-0 flex-1">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">{index + 1} of {names.length}</div>
                <h2 className="truncate text-2xl font-bold text-white">{name}</h2>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => go(index - 1)} disabled={index === 0} className={btn}>Back</button>
                <button type="button" onClick={() => finish('skipped')} className={btn}>Skip</button>
              </div>
            </div>
            <form onSubmit={again} autoComplete="off" className="mb-4 flex gap-2">
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Other words to search" className={`h-9 min-w-0 max-w-[420px] flex-1 text-[13px] ${field}`} />
              <button type="submit" disabled={!query.trim()} className={btn}>Search again</button>
            </form>
            {SOURCES.map(({ key, label }) => result?.errors[key] && (
              <p key={key} className="mb-2 text-xs text-red-400">{label}: {result.errors[key]}</p>
            ))}
            {photos.length === 0 && busy && (
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <SpinnerIcon size={14} className="animate-spin" /> Searching {waitingOn} for &ldquo;{result?.query ?? name}&rdquo;…
              </div>
            )}
            {photos.length === 0 && !busy && (
              <p className="text-xs text-zinc-500">No free-to-use photos found for &ldquo;{result?.query ?? name}&rdquo;. Try other words, or Skip.</p>
            )}
            {photos.length > 0 && (
              <>
                <PhotoGrid photos={photos} selectedId={selected?.id} onSelect={setSelected} cols={4} />
                {busy && (
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-500">
                    <SpinnerIcon size={12} className="animate-spin" /> Still searching {waitingOn}…
                  </div>
                )}
              </>
            )}
          </div>
          <aside className="w-[360px] shrink-0 overflow-y-auto border-l border-zinc-900">
            {selected ? (
              <CropSquare photo={selected} person={name} onClear={() => setSelected(null)} verb="Save" enterSaves={active} onSaved={() => finish('saved')} />
            ) : (
              <p className="p-4 text-xs leading-relaxed text-zinc-600">
                Pick a photo of {name} and it appears here, cropped square. Drag and zoom to frame it, then Save — it downloads as {fileName(name)} and the next name comes up.
              </p>
            )}
          </aside>
        </div>
      )}

      {phase === 'done' && (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto w-full max-w-[640px]">
            <h2 className="text-2xl font-bold text-white">Done</h2>
            <p className="mt-1 text-sm text-zinc-400">{saved} saved{skipped ? `, ${skipped} skipped` : ''}, of {names.length}.</p>
            <ul className="mt-4 divide-y divide-zinc-900 rounded-md border border-zinc-800">
              {names.map(n => (
                <li key={n} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="truncate text-zinc-100">{n}</span>
                  <span className={`shrink-0 text-xs ${outcomes[n] === 'saved' ? 'text-emerald-400' : 'text-zinc-500'}`}>
                    {outcomes[n] === 'saved' ? fileName(n) : 'skipped'}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              {skipped > 0 && (
                <button type="button" onClick={() => begin(names.filter(n => outcomes[n] === 'skipped'))} className={btnGo}>
                  Go round the {skipped} skipped again
                </button>
              )}
              <button type="button" onClick={() => setPhase('input')} className={btn}>New list</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
