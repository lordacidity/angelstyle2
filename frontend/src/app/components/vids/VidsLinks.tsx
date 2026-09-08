'use client';

// VidsLinks — the Link page of Edit & file: which Bottom B clips follow on
// from which Bottom A.
//
// A Bottom A is the search; a Bottom B is what came of it. Most Bottom Bs
// don't follow from most Bottom As, and the ones that do are two or three
// rather than all of them — so instead of hoping a random pair lines up, the
// pairs are ticked here. Pick a Bottom A on the left; the grid on the right is
// every Bottom B, and ticking one links it. The Build page then offers only
// the ticked ones once that Bottom A is on the stage, and Random draws its
// pair from here rather than from two folders.
//
// A Bottom A with nothing ticked is left alone by both: its picker shows the
// whole folder, and Random passes over it once anything at all is linked.

import { useMemo, useState } from 'react';
import type { VidLink, VidRow } from '@/lib/vids-types';
import { isPhoto } from '@/lib/vids-types';
import { ClipTile, Empty } from './VidsPicker';
import { fmtTime } from '@/lib/utils';
import { VideoIcon } from '@/lib/icons';

interface Props {
  /** Everything filed under Bottom A and under Bottom B, in library order. */
  bottomA: VidRow[];
  bottomB: VidRow[];
  links: VidLink[];
  /** Replace the Bottom Bs ticked for one Bottom A. */
  onSetLinks: (bottomAId: string, bottomBIds: string[]) => void;
}

/** The pairs by Bottom A, as sets of Bottom B ids. */
function linksByA(links: VidLink[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const l of links) {
    let s = m.get(l.bottomAId);
    if (!s) { s = new Set(); m.set(l.bottomAId, s); }
    s.add(l.bottomBId);
  }
  return m;
}

const SMALL_BTN = 'shrink-0 rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-white disabled:cursor-default disabled:opacity-30 disabled:hover:border-zinc-700 disabled:hover:text-zinc-400';

export function VidsLinks({ bottomA, bottomB, links, onSetLinks }: Props) {
  const [chosenId, setChosenId] = useState<string | null>(null);
  const byA = useMemo(() => linksByA(links), [links]);
  // Only a pair whose Bottom B is still filed under Bottom B counts — a tick on
  // a clip since moved or deleted means nothing to the builder either.
  const bIds = useMemo(() => new Set(bottomB.map((v) => v.id)), [bottomB]);
  const countFor = (aId: string) => {
    let n = 0;
    for (const id of byA.get(aId) ?? []) if (bIds.has(id)) n++;
    return n;
  };

  // The Bottom A whose links are on the right: the one clicked, or the first
  // there is — resolved live, so one deleted under you drops back to the top.
  const chosen = bottomA.find((v) => v.id === chosenId) ?? bottomA[0] ?? null;
  const linked = chosen ? byA.get(chosen.id) ?? new Set<string>() : new Set<string>();
  const linkedCount = chosen ? countFor(chosen.id) : 0;

  const toggle = (bId: string) => {
    if (!chosen) return;
    const next = new Set(linked);
    if (next.has(bId)) next.delete(bId); else next.add(bId);
    onSetLinks(chosen.id, Array.from(next));
  };
  const setAll = (on: boolean) => {
    if (!chosen) return;
    onSetLinks(chosen.id, on ? bottomB.map((v) => v.id) : []);
  };

  return (
    <div className="flex min-h-0 flex-1">
      {/* Bottom A — pick one */}
      <div className="flex w-[280px] shrink-0 flex-col border-r border-zinc-800">
        <div className="shrink-0 border-b border-zinc-800 px-3 py-2">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Bottom A</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-600">
            Pick one, then tick what can follow it on the right.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {bottomA.length === 0 ? (
            <Empty>Nothing in <span className="text-zinc-300">Bottom A</span> yet — file some search recordings there first.</Empty>
          ) : bottomA.map((v) => {
            const n = countFor(v.id);
            const on = chosen?.id === v.id;
            return (
              <button
                key={v.id}
                onClick={() => setChosenId(v.id)}
                title={`${v.name} — ${n ? `${n} Bottom B${n === 1 ? '' : 's'} linked` : 'nothing linked yet'}`}
                className={`flex w-full items-center gap-2 rounded-md border p-1.5 text-left transition-colors ${
                  on ? 'border-white/70 bg-zinc-900' : 'border-transparent hover:border-zinc-700 hover:bg-zinc-900/60'
                }`}
              >
                <span className="h-10 w-10 shrink-0 overflow-hidden rounded bg-black">
                  {v.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={v.thumbUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    <span className="flex h-full items-center justify-center text-zinc-700"><VideoIcon size={14} /></span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[11px] ${on ? 'text-white' : 'text-zinc-200'}`}>{v.name}</span>
                  <span className="block text-[9px] text-zinc-500">
                    {isPhoto(v) ? 'Photo' : v.duration != null ? fmtTime(v.duration) : '–:––'}
                  </span>
                </span>
                <span className={`shrink-0 text-[10px] ${n ? 'text-emerald-400' : 'text-zinc-600'}`}>
                  {n ? `${n} linked` : 'none'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom B — tick what follows */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-4 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Bottom B</p>
            <p className="mt-0.5 truncate text-[11px] text-zinc-200">
              {chosen ? (
                <>
                  after <span className="font-semibold">{chosen.name}</span>
                  <span className="text-zinc-500"> — {linkedCount} of {bottomB.length} linked</span>
                </>
              ) : 'Pick a Bottom A on the left'}
            </p>
          </div>
          <button
            onClick={() => setAll(true)}
            disabled={!chosen || !bottomB.length || linkedCount === bottomB.length}
            title="Tick every Bottom B for this Bottom A"
            className={SMALL_BTN}
          >
            Link all
          </button>
          <button
            onClick={() => setAll(false)}
            disabled={!chosen || linked.size === 0}
            title="Untick them all — this Bottom A goes back to offering the whole folder"
            className={SMALL_BTN}
          >
            Clear
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {bottomB.length === 0 ? (
            <Empty>Nothing in <span className="text-zinc-300">Bottom B</span> yet — file the follow-on recordings there first.</Empty>
          ) : !chosen ? (
            <Empty>Pick a Bottom A on the left to see what is linked to it.</Empty>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
              {bottomB.map((v) => {
                const on = linked.has(v.id);
                return (
                  <ClipTile
                    key={v.id}
                    video={v}
                    current={on}
                    badge="Linked"
                    title={`${v.name} — ${on ? 'linked; click to unlink' : 'click to link it'} to ${chosen.name}`}
                    onChoose={() => toggle(v.id)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
