// Quick make: three of a character's videos saved to Vids as one persona
// video, as they are — no editor, nothing rendered. What "Make persona video"
// (components/aipersona/PersonaVideoMaker) does with an edit in between, done
// in one go from the character's page.
//
// Each video goes up to Vids' Persona folder the way the maker files a part
// left unedited. The persona video is made last, with all three, in the
// character's own folder under Persona (made if there isn't one), not degen
// and on for the clippers — the maker's defaults. A run that fails partway
// leaves the clips it had sent in the Persona folder and no persona video.
//
// Several runs go at once — the page starts one per press of Done and does
// not wait — so what they have in common is held between them (QuickShared):
// a video that has gone up once is copied in Vids for every later part that
// uses it, in this run or another, which is most of them — the same trade and
// the same ending close video after video.
//
// Browser-side, like lib/aipersona/client.

import { copyVideo, createFolder, createPersona, ensureFolder, listLibrary, uploadVideo } from '@/lib/vids-client';
import { PERSONA_FOLDER } from '@/lib/vidsPlan';
import { personaFolders } from '@/lib/vids-persona-folders';
import { PERSONA_PARTS, PERSONA_PART_LABEL, type VidPersona } from '@/lib/vids-types';
import { markTakeUsed } from './client';
import type { PersonaVideo } from './types';

/** What the runs on one character's page share. */
export interface QuickShared {
  /** The clip in Vids each video first went up as, by the video's id — a
   *  promise, so a run that wants one still going up waits for it rather than
   *  sending it again. */
  clips: Map<string, Promise<string>>;
  /** Vids' Persona folder and the character's own under it, found (or made)
   *  once: two runs each making the character's folder would leave two. */
  folders: Promise<{ rootId: string; folderId: string }> | null;
}
export const quickShared = (): QuickShared => ({ clips: new Map(), folders: null });

async function findFolders(character: string): Promise<{ rootId: string; folderId: string }> {
  const rootId = (await ensureFolder(PERSONA_FOLDER)).id;
  const mine = (n: string) => n.trim().toLowerCase() === character.trim().toLowerCase();
  const own = personaFolders((await listLibrary()).folders).find((f) => mine(f.name));
  return { rootId, folderId: own?.id ?? (await createFolder(character.trim().slice(0, 120), rootId)).id };
}

export async function quickMake({ character, name, picks, shared, onProgress }: {
  /** The character's name: whose folder in Vids it goes in. */
  character: string;
  /** What the persona video is called. */
  name: string;
  /** Start, middle, end. */
  picks: readonly [PersonaVideo, PersonaVideo, PersonaVideo];
  shared: QuickShared;
  /** What it is doing now, in words for the page. */
  onProgress?: (text: string) => void;
}): Promise<VidPersona> {
  const folders = (shared.folders ??= findFolders(character));
  const { rootId, folderId } = await folders.catch((err) => {
    if (shared.folders === folders) shared.folders = null;
    throw err;
  });

  /** Send a video up to Vids, whole. */
  const upload = async (video: PersonaVideo, clipName: string, i: number): Promise<string> => {
    onProgress?.(`Getting ${i + 1} of 3…`);
    const res = await fetch(video.url);
    if (!res.ok) throw new Error(`"${video.sceneName}" could not be fetched (${res.status}).`);
    const blob = await res.blob();
    const file = new File([blob], `${video.sceneName}.mp4`, { type: blob.type || 'video/mp4' });
    // The video's own sound is kept, as the maker keeps it.
    const clip = await uploadVideo(file, {
      name: clipName, folderId: rootId, marks: [], hasSfx: true,
      onProgress: (frac) => onProgress?.(`Saving ${i + 1} of 3… ${Math.round(frac * 100)}%`),
    });
    return clip.id;
  };

  const ids: string[] = [];
  for (const [i, video] of picks.entries()) {
    const clipName = `${name} — ${PERSONA_PART_LABEL[PERSONA_PARTS[i]]}`;
    const first = shared.clips.get(video.id);
    if (first) {
      // Already in Vids, or on its way: a copy there, nothing fetched or sent.
      // One that did not get there, or has been deleted since, goes up afresh.
      onProgress?.(`Copying ${i + 1} of 3…`);
      const copy = await first.then((id) => copyVideo(id, clipName, rootId)).catch(() => null);
      if (copy) { ids.push(copy.id); continue; }
      if (shared.clips.get(video.id) === first) shared.clips.delete(video.id);
    }
    const going = upload(video, clipName, i);
    shared.clips.set(video.id, going);
    going.catch(() => { if (shared.clips.get(video.id) === going) shared.clips.delete(video.id); });
    ids.push(await going);
  }

  onProgress?.('Making the persona video…');
  const made = await createPersona(name, false, {
    [PERSONA_PARTS[0]]: ids[0], [PERSONA_PARTS[1]]: ids[1], [PERSONA_PARTS[2]]: ids[2], folderId, clipable: true,
  });
  // Only a note for the character's page, which greys a start already used.
  await markTakeUsed(picks[0].id, made.id).catch(() => {});
  return made;
}
