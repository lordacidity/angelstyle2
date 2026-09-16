'use client';

// "Vids" — the stacked-sequence builder over a shared cloud video library
// (folders + clips in Supabase Storage).
//
// There are four decisions on the page: which persona, which bottom, which
// song, and the captions and the look they are drawn in. Everything else
// about a build fills itself in — the End clip, the frame, the pace, where
// each clip sits — and the stage is there to watch, not to work on. See
// VidsBuilder.
//
// Four top-level folders feed the six slots of the sequence:
//   Persona   a bundle of three clips — Start, Top A, Top B — chosen together.
//   Bottom A / Bottom B / End   Bottom A and Bottom B are made as a pair by
//                               the Bottom card, which renders the ChatGPT
//                               search for this one video and keeps it in the
//                               tab (lib/vidsLocal) rather than filing it;
//                               End picks itself from its folder.
// So a build chooses one persona plus a bottom pair, and the builder plays the
// sequence: Start full screen → Top A over Bottom A → Bottom B, then Top B
// over End. Export renders the MP4 and downloads it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVidsLibrary } from '../../hooks/useVidsLibrary';
import { VidsBuilder } from './VidsBuilder';
import {
  DEFAULT_TRIM, LIBRARY_FOLDERS, PERSONA_PART_SLOT, SLOT_META,
  folderGroupIds, freshPick, type Picks, type SlotId,
} from '@/lib/vidsPlan';
import { PERSONA_PARTS } from '@/lib/vids-types';
import type { VidPersona, VidRow } from '@/lib/vids-types';
import { isLocalClip } from '@/lib/vidsLocal';

export function VidsSection({ active }: { active: boolean }) {
  const lib = useVidsLibrary(active);
  const { loaded, loading, folders, videos, personas, ensureFolders } = lib;
  const [picks, setPicks] = useState<Picks>({});
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<number | null>(null);
  const ensuredRef = useRef(false);

  // The four library folders always exist at the top level.
  useEffect(() => {
    if (!loaded || ensuredRef.current) return;
    ensuredRef.current = true;
    void ensureFolders([...LIBRARY_FOLDERS]);
  }, [loaded, ensureFolders]);

  // What the build actually uses. A pick stores the row it was made from, and a
  // clip whose footage has been replaced keeps its id but arrives at a new URL
  // (the old object is gone from the bucket) — so every slot is resolved against
  // the library each render rather than trusting that snapshot.
  //
  // A clip whose row has gone empties its slot; new footage resets that slot's
  // in / out points, since they pointed into footage that no longer exists.
  // Unchanged picks keep their identity, so an ordinary library refresh doesn't
  // churn the stage. The Bottom card's recording has no row to resolve against
  // — it lives in this tab (lib/vidsLocal) — and passes through as it is.
  const livePicks = useMemo(() => {
    let changed = false;
    const next: Picks = {};
    for (const slot of Object.keys(picks) as SlotId[]) {
      const pick = picks[slot];
      if (!pick) continue;
      if (isLocalClip(pick.video)) { next[slot] = pick; continue; }
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
    if (missing) flash(`"${persona.name}" is missing ${missing} of its three clips.`);
  }, [videos, flash]);

  // Which persona the three top slots currently hold. Derived rather than
  // stored, so a part swapped out from under it silently drops the badge
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

  // Everything filed under a slot's folder, sub-folders included.
  const clipsForSlot = useCallback((slot: SlotId): VidRow[] => {
    const ids = folderGroupIds(folders, SLOT_META[slot].folder);
    return videos.filter((v) => v.folderId && ids.has(v.folderId));
  }, [folders, videos]);

  return (
    <div className="vids-scroll relative flex h-full flex-col text-white">
      {/* No page header: the builder fills the window. What the header used to
          carry turns up over the stage instead, and only while there is
          something to say. */}
      {(hint || (loaded && loading)) && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2">
          {hint ? (
            <p className="rounded-md border border-amber-800 bg-amber-950/90 px-3 py-1.5 text-[11px] text-amber-300 backdrop-blur">{hint}</p>
          ) : (
            <p className="rounded-md border border-zinc-800 bg-zinc-950/90 px-3 py-1.5 text-[10px] text-zinc-500 backdrop-blur">Refreshing the library…</p>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <VidsBuilder
          picks={livePicks}
          onPicksChange={onPicksChange}
          resolveVideo={resolveVideo}
          clipsForSlot={clipsForSlot}
          personas={personas}
          appliedPersonaId={appliedPersonaId}
          onUsePersona={usePersona}
          active={active}
          libraryLoaded={loaded}
        />
      </div>
    </div>
  );
}
