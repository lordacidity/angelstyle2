'use client';

// "Vids" — a shared cloud video library (folders + clips in Supabase Storage)
// in two pages. Nothing is built here: Vids 2 makes the videos. This section
// is where the footage they are made of comes in, and where what the clippers'
// app may use is switched on.
//
//   Edit & file   two pages of its own. Upload: drop footage on the middle
//                 and it runs the whole errand — folder, context, edit, save —
//                 with three files at once taken to be a persona, named once,
//                 given one context, and trimmed clip by clip, and one file on
//                 its own taken to be a persona as well: the same footage fills
//                 Start, Top A and Top B, trimmed three times. Edit: a clip
//                 open in the editor — trim it, cut chunks out of the middle,
//                 change its speed, drop its sound; saving puts the edit back
//                 over that clip. Drop straight onto a folder on the left
//                 instead and it is just filed there, which is how a lone
//                 Bottom B or End gets in.
//   Clippers      what the clippers' app gets (VidsClippers): a switch on
//                 every persona, bottom clip, song and caption look. Off is
//                 ours alone — a build can still use it — and on is theirs as
//                 well. Right-click renames a persona, clip or song
//                 everywhere.
//
// Both pages share one library hook, and an edit keeps its clip's id, so a
// build always uses the current footage — edit Top A and the persona that uses
// it plays the edited Top A, with no re-picking.
//
// Four top-level folders feed the six slots of a sequence:
//   Persona   a bundle of three clips — Start, Top A, Top B — chosen together.
//   Bottom A / Bottom B / End   filed one clip at a time, in the folder of
//                               that name. Bottom A and Bottom B are screen
//                               recordings Vids 2 makes as it builds and never
//                               files, so those two folders only hold what has
//                               been put there by hand.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVidsLibrary } from '../../hooks/useVidsLibrary';
import { VidsPrep } from './VidsPrep';
import { VidsClippers } from './VidsClippers';
import { LIBRARY_FOLDERS, SLOT_META, folderGroupIds, type SlotId } from '@/lib/vidsPlan';
import type { VidRow } from '@/lib/vids-types';

/** The two pages. Filing footage is what you come here to do, so it leads;
 *  Clippers is where what the clippers' app may use is switched on. */
type Page = 'prep' | 'clippers';
const PAGES: { id: Page; label: string }[] = [
  { id: 'prep',     label: 'Edit & file' },
  { id: 'clippers', label: 'Clippers' },
];

export function VidsSection({ active }: { active: boolean }) {
  const lib = useVidsLibrary(active);
  const { loaded, loading, folders, videos, personas, ensureFolders, refreshWhenIdle } = lib;
  const [page, setPage] = useState<Page>('prep');
  const ensuredRef = useRef(false);

  // The four library folders always exist at the top level.
  useEffect(() => {
    if (!loaded || ensuredRef.current) return;
    ensuredRef.current = true;
    void ensureFolders([...LIBRARY_FOLDERS]);
  }, [loaded, ensureFolders]);

  const resolveVideo = useCallback((id: string) => videos.find((v) => v.id === id), [videos]);

  // Everything filed under a slot's folder, sub-folders included.
  const clipsForSlot = useCallback((slot: SlotId): VidRow[] => {
    const ids = folderGroupIds(folders, SLOT_META[slot].folder);
    return videos.filter((v) => v.folderId && ids.has(v.folderId));
  }, [folders, videos]);

  // What the Clippers page lists under each hand-picked slot.
  const clipperClips = useMemo(
    () => ({ bottomA: clipsForSlot('bottomA'), bottomB: clipsForSlot('bottomB'), end: clipsForSlot('end') }),
    [clipsForSlot],
  );

  return (
    <div className="vids-scroll flex h-full flex-col text-white">
      <div className="flex items-center gap-4 border-b border-zinc-800 px-6 py-3">
        <h1 className="text-lg font-semibold">Vids</h1>
        <div className="flex overflow-hidden rounded-md border border-zinc-700">
          {PAGES.map((p, i) => (
            <button
              key={p.id}
              onClick={() => {
                // Coming over to Clippers reads the library again, so whatever
                // was just filed or edited is on the list — once any upload or
                // save still on its way has landed, not over the top of it.
                if (p.id !== 'prep' && page !== p.id) refreshWhenIdle();
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
      </div>

      {/* Both pages stay mounted — switching back must not lose an open edit. */}
      <div className="flex min-h-0 flex-1" style={{ display: page === 'prep' ? undefined : 'none' }}>
        <VidsPrep lib={lib} active={active && page === 'prep'} />
      </div>
      <div className="flex min-h-0 flex-1" style={{ display: page === 'clippers' ? undefined : 'none' }}>
        <VidsClippers
          active={active && page === 'clippers'}
          personas={personas}
          resolveVideo={(id) => (id ? resolveVideo(id) : undefined)}
          clips={clipperClips}
          flags={lib.clipable}
          onPersona={(id, on) => void lib.updatePersona(id, { clipable: on })}
          onClip={(id, on) => void lib.setVideoClipable(id, on)}
          onFlag={(kind, key, on) => void lib.setClipable(kind, key, on)}
          onRenamePersona={(id, name) => void lib.updatePersona(id, { name })}
          onRenameClip={(id, name) => void lib.renameVideo(id, name)}
          onRenameTrack={lib.renameTrack}
        />
      </div>
    </div>
  );
}
