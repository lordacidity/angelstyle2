'use client';

// "Vids" — a shared cloud video library (folders + clips in Supabase Storage)
// beside the stacked-sequence builder, in two pages:
//
//   Edit & file   three pages of its own. Upload: drop footage on the middle
//                 and it runs the whole errand — folder, context, edit, save —
//                 with three files at once taken to be a persona, named once,
//                 given one context, and trimmed clip by clip. Edit: a clip
//                 open in the editor — trim it, cut chunks out of the middle,
//                 change its speed, drop its sound; saving puts the edit back
//                 over that clip. Link: which Bottom Bs follow on from which
//                 Bottom A, which is what the builder goes by below.
//   Build         pick a persona plus the bottom clips, stack them into one
//                 video, and caption it. Three rails on the right: placement
//                 and sound in one, the captions and how they look in the
//                 next, and in the last the post caption for Instagram (the
//                 person being traded and the case for up or down, read off
//                 the screen recordings' context), the Phonedeck list and the
//                 export buttons.
//                 Everything is picked from the rack in the first rail, so the
//                 page is stage plus controls with no library pane in the way.
//                 That is Advanced. Simple, the other half of the switch top
//                 right, is the same builder with two questions on it — which
//                 persona, which vid — and everything else left to fill itself
//                 in: the second bottom clip off the Link page, End, a song,
//                 the bars, the captions. Play, download, push to Phonedeck,
//                 nothing to adjust. Switching to Advanced opens that very
//                 build with every control on it.
//
// Both pages share one library hook, and an edit keeps its clip's id, so the
// build always uses the current footage — edit Top A and the persona that uses
// it plays the edited Top A, with no re-picking.
//
// Four top-level folders feed the six slots of the sequence:
//   Persona   a bundle of three clips — Start, Top A, Top B — chosen together.
//   Bottom A / Bottom B / End   picked one clip at a time, from the folder of
//                               that name.
// So a build chooses one persona plus up to three bottom clips, and the builder
// plays the sequence: Start full screen → Top A over Bottom A → Bottom B, then
// Top B over End. Bottom A and Bottom B go together only in the pairs the Link
// page has ticked: once a Bottom A is on the stage its Bottom B picker offers
// just those, and Random draws a linked pair rather than two clips at random. Export downloads the MP4 or sends it to Phonedeck's Incoming
// list — where a Media export lands — to be pushed to the phones from the
// Phonedeck panel. No AI, no captions: just footage in, video out.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVidsLibrary } from '../../hooks/useVidsLibrary';
import { VidsBuilder } from './VidsBuilder';
import { VidsPrep } from './VidsPrep';
import {
  DEFAULT_TRIM, LIBRARY_FOLDERS, PERSONA_PART_SLOT, PERSONA_SLOTS, SLOT_META,
  folderGroupIds, freshPick, type Picks, type SlotId,
} from '@/lib/vidsPlan';
import { PERSONA_PARTS } from '@/lib/vids-types';
import type { VidPersona, VidRow } from '@/lib/vids-types';

/** The two pages. Building is what you come here to do — the footage is already
 *  filed most days — so it leads, and Edit & file is where you go when there is
 *  new footage to put through. */
type Page = 'prep' | 'build';
const PAGES: { id: Page; label: string }[] = [
  { id: 'build', label: 'Build' },
  { id: 'prep',  label: 'Edit & file' },
];

/** How much of the builder is on show, switched top right of the Build page.
 *  Simple is a persona, a vid and the finished video — everything else about
 *  the build fills itself in out of sight. Advanced is the whole workbench.
 *
 *  It is remembered between visits, since it is how you like to work rather
 *  than anything about the build in hand, and switching keeps what is on the
 *  stage either way: a Simple build that wants one adjustment is one click
 *  from every control there is. */
type BuildMode = 'simple' | 'advanced';
const BUILD_MODES: { id: BuildMode; label: string; hint: string }[] = [
  {
    id: 'simple',
    label: 'Simple',
    hint: 'Choose a persona and a vid — the second bottom clip, End, the sound, the bars and the captions all fill themselves in. Play it, then download it or push it to Phonedeck.',
  },
  {
    id: 'advanced',
    label: 'Advanced',
    hint: 'The whole builder: every slot, all three rails, the captions, the post caption for Instagram, and a stage you can drag, zoom and trim clips on.',
  },
];
const BUILD_MODE_KEY = 'pauv.vids.buildMode';

export function VidsSection({ active }: { active: boolean }) {
  const lib = useVidsLibrary(active);
  const { loaded, loading, folders, videos, personas, links, ensureFolders, refreshWhenIdle } = lib;
  const [page, setPage] = useState<Page>('build');
  // Advanced until this browser says otherwise — read after the first render
  // rather than in the initial state, which the server has no way to know.
  const [buildMode, setBuildMode] = useState<BuildMode>('advanced');
  const [picks, setPicks] = useState<Picks>({});
  const [selectedSlot, setSelectedSlot] = useState<SlotId | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<number | null>(null);
  const ensuredRef = useRef(false);

  // Read after mount on purpose: the server render and the first client paint
  // have to agree, and only the client has a localStorage to read.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(BUILD_MODE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      if (saved === 'simple' || saved === 'advanced') setBuildMode(saved);
    } catch { /* a browser that won't remember anything: Advanced, then */ }
  }, []);

  const chooseBuildMode = useCallback((mode: BuildMode) => {
    setBuildMode(mode);
    try { window.localStorage.setItem(BUILD_MODE_KEY, mode); } catch { /* not remembered */ }
  }, []);

  // The four library folders always exist at the top level.
  useEffect(() => {
    if (!loaded || ensuredRef.current) return;
    ensuredRef.current = true;
    void ensureFolders([...LIBRARY_FOLDERS]);
  }, [loaded, ensureFolders]);

  // What the build actually uses. A pick stores the row it was made from, and a
  // clip edited on the first page keeps its id but gets new footage at a new URL
  // (the old object is gone from the bucket) — so every slot is resolved against
  // the library each render rather than trusting that snapshot. Edit Top A and
  // the persona using it plays the edited Top A, with nothing to re-pick.
  //
  // A clip whose row has gone empties its slot; new footage resets that slot's
  // in / out points, since they pointed into footage that no longer exists.
  // Framing, sound and speed are the build's own and stay. Unchanged picks keep
  // their identity, so an ordinary library refresh doesn't churn the stage.
  const livePicks = useMemo(() => {
    let changed = false;
    const next: Picks = {};
    for (const slot of Object.keys(picks) as SlotId[]) {
      const pick = picks[slot];
      if (!pick) continue;
      const cur = videos.find((v) => v.id === pick.video.id);
      if (!cur) { changed = true; continue; }
      const sameFootage = cur.url === pick.video.url;
      if (sameFootage && cur.name === pick.video.name && cur.duration === pick.video.duration) {
        next[slot] = pick;
        continue;
      }
      next[slot] = sameFootage
        ? { ...pick, video: cur }
        : { ...pick, video: cur, trim: { ...DEFAULT_TRIM } };
      changed = true;
    }
    return changed ? next : picks;
  }, [picks, videos]);

  const flash = useCallback((message: string) => {
    setHint(message);
    if (hintTimer.current) window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), 4500);
  }, []);

  // What a freshly picked clip starts from is freshPick's business: re-picking
  // a slot keeps its fit / align (unless the slot has a placement of its own),
  // and the new clip arrives untrimmed and silent unless Prep gave it sound.
  const assign = useCallback((slot: SlotId, video: VidRow) => {
    setPicks((prev) => ({ ...prev, [slot]: freshPick(slot, video, prev[slot]) }));
    setSelectedSlot(slot);
  }, []);

  // Choosing a persona fills Start, Top A and Top B together. A part the persona
  // hasn't got yet clears its slot, so what's on the stage always matches the
  // bundle rather than leaving a clip behind from the persona before it.
  const usePersona = useCallback((persona: VidPersona) => {
    setPicks((prev) => {
      const next = { ...prev };
      for (const part of PERSONA_PARTS) {
        const slot = PERSONA_PART_SLOT[part];
        const video = videos.find((v) => v.id === persona[part]);
        if (video) next[slot] = freshPick(slot, video, prev[slot]);
        else delete next[slot];
      }
      return next;
    });
    const missing = PERSONA_PARTS.filter((k) => !persona[k]).length;
    if (missing) flash(`"${persona.name}" is missing ${missing} of its three clips — drop them onto its tiles.`);
  }, [videos, flash]);

  const clearPersona = useCallback(() => {
    setPicks((prev) => {
      const next = { ...prev };
      for (const slot of PERSONA_SLOTS) delete next[slot];
      return next;
    });
  }, []);

  // Which persona the three top slots currently hold. Derived rather than
  // stored, so editing one of those slots by hand silently drops the badge
  // instead of claiming a persona that is no longer really in use.
  const appliedPersonaId = useMemo(() => {
    const found = personas.find((p) => {
      const parts = PERSONA_PARTS.filter((k) => p[k]);
      if (parts.length === 0) return false;
      return PERSONA_PARTS.every((k) => livePicks[PERSONA_PART_SLOT[k]]?.video.id === (p[k] ?? undefined));
    });
    return found?.id ?? null;
  }, [personas, livePicks]);

  const onPicksChange = useCallback((updater: (prev: Picks) => Picks) => setPicks(updater), []);
  const resolveVideo = useCallback((id: string) => videos.find((v) => v.id === id), [videos]);

  // Everything filed under a slot's folder, sub-folders included — what that
  // slot's picker in the rack offers.
  const clipsForSlot = useCallback((slot: SlotId): VidRow[] => {
    const ids = folderGroupIds(folders, SLOT_META[slot].folder);
    return videos.filter((v) => v.folderId && ids.has(v.folderId));
  }, [folders, videos]);

  return (
    <div className="vids-scroll flex h-full flex-col text-white">
      <div className="flex items-center gap-4 border-b border-zinc-800 px-6 py-3">
        <h1 className="text-lg font-semibold">Vids</h1>
        <div className="flex overflow-hidden rounded-md border border-zinc-700">
          {PAGES.map((p, i) => (
            <button
              key={p.id}
              onClick={() => {
                // Coming over to Build reads the library again, so whatever was
                // just filed or edited is in the rack — once any upload or save
                // still on its way has landed, not over the top of it.
                if (p.id === 'build' && page !== 'build') refreshWhenIdle();
                setPage(p.id);
              }}
              className={`px-3 py-1.5 text-[11px] font-medium transition-colors ${
                page === p.id ? 'bg-zinc-200 text-black' : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'
              }`}
            >
              <span className="mr-1 text-[9px] opacity-60">{i + 1}</span>{p.label}
            </button>
          ))}
        </div>
        {loaded && loading && (
          <span className="text-[10px] text-zinc-500">Refreshing the library…</span>
        )}
        <span className="flex-1" />
        {hint && (
          <p className="rounded-md border border-amber-800 bg-amber-950/40 px-3 py-1.5 text-[11px] text-amber-300">{hint}</p>
        )}
        {/* How much of the builder to show. The Build page's own switch, so it
            is only up while that page is. */}
        {page === 'build' && (
          <div className="flex overflow-hidden rounded-md border border-zinc-700">
            {BUILD_MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => chooseBuildMode(m.id)}
                title={m.hint}
                className={`px-3 py-1.5 text-[11px] font-medium transition-colors ${
                  buildMode === m.id ? 'bg-zinc-200 text-black' : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Both pages stay mounted — switching back must not lose an open edit or
          the slots that have already been picked. */}
      <div className="flex min-h-0 flex-1" style={{ display: page === 'build' ? undefined : 'none' }}>
        <VidsBuilder
          picks={livePicks}
          onPicksChange={onPicksChange}
          onAssign={assign}
          selectedSlot={selectedSlot}
          onSelectSlot={setSelectedSlot}
          resolveVideo={resolveVideo}
          clipsForSlot={clipsForSlot}
          personas={personas}
          links={links}
          appliedPersonaId={appliedPersonaId}
          onUsePersona={usePersona}
          onClearPersona={clearPersona}
          active={active && page === 'build'}
          libraryLoaded={loaded}
          simple={buildMode === 'simple'}
        />
      </div>
      <div className="flex min-h-0 flex-1" style={{ display: page === 'prep' ? undefined : 'none' }}>
        <VidsPrep lib={lib} active={active && page === 'prep'} />
      </div>
    </div>
  );
}
