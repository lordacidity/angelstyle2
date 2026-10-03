// Personas, and whose each persona video is.
//
// The words first, because the screen and the code use them differently:
//
//   on screen       a PERSONA is a person — Blorky, Dorky, Aiden. A PERSONA
//                   VIDEO is one video of that person doing something ("Walk
//                   In", "Chipotle"): what a build picks, and what is moved
//                   from one persona to another.
//   in the code     the person is a folder — an ordinary library folder
//                   (vids_folders) directly under the top-level Persona folder —
//                   and the video is a `VidPersona`, the row that bundles its
//                   three clips (Start, Top A, Top B). The names are older than
//                   the words: a VidPersona was "a persona" until 2026-10-02.
//
// So a build chooses in two steps — whose, then which video — and Vids keeps
// each person's videos together. A video points at its persona through
// `VidPersona.folderId`; one that points at none has not been attributed yet,
// and is listed under UNFILED_LABEL wherever the personas are. The three clips
// themselves stay where they were filed — in the Persona folder — whichever
// persona their video belongs to.
//
// Nothing here imports the plan or the database, so the Studio, the clipper
// page and AI Persona all read the same answer.

import type { VidFolder, VidPersona, VidRow } from '@/lib/vids-types';
import { PERSONA_PARTS } from '@/lib/vids-types';

const ROOT = 'persona';
const isRoot = (f: VidFolder) => !f.parentId && f.name.trim().toLowerCase() === ROOT;

/** What the videos that are nobody's yet are listed under. */
export const UNFILED_LABEL = 'No persona';

/** The personas — the people: every folder directly under Persona, by name.
 *  (Under any Persona — see folderGroupIds for why there can be two.) */
export function personaFolders(folders: readonly VidFolder[]): VidFolder[] {
  const roots = new Set(folders.filter(isRoot).map((f) => f.id));
  return folders
    .filter((f) => f.parentId !== null && roots.has(f.parentId))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** The persona a video belongs to, or null when it belongs to none — which is
 *  also the answer for one whose persona has since been deleted. */
export function personaFolderOf(
  persona: Pick<VidPersona, 'folderId'> | null | undefined, folders: readonly VidFolder[],
): VidFolder | null {
  if (!persona?.folderId) return null;
  return personaFolders(folders).find((f) => f.id === persona.folderId) ?? null;
}

/** A video said in full: who, then what — "Dorky · Walk In". Just its name
 *  when it is nobody's. */
export function personaLabel(persona: VidPersona, folders: readonly VidFolder[]): string {
  const folder = personaFolderOf(persona, folders);
  return folder ? `${folder.name} · ${persona.name}` : persona.name;
}

/** One persona and their videos. `folder` is null for the videos in none. */
export interface PersonaGroup {
  folder: VidFolder | null;
  personas: VidPersona[];
}

/** The videos persona by persona, in name order, with the unattributed ones
 *  last. A persona with no videos is listed too (`empty: false` leaves those
 *  out, for a page that only chooses), and the unattributed group is there
 *  only when it has something in it. */
export function groupPersonas(
  personas: readonly VidPersona[], folders: readonly VidFolder[], opts: { empty?: boolean } = {},
): PersonaGroup[] {
  const mine = personaFolders(folders);
  const known = new Set(mine.map((f) => f.id));
  const groups: PersonaGroup[] = mine
    .map((folder) => ({ folder, personas: personas.filter((p) => p.folderId === folder.id) }))
    .filter((g) => opts.empty !== false || g.personas.length > 0);
  const unfiled = personas.filter((p) => !p.folderId || !known.has(p.folderId));
  if (unfiled.length) groups.push({ folder: null, personas: unfiled });
  return groups;
}

/** All three clips are there, and in the library — a video a build can use
 *  without a gap. */
export function isWholePersona(persona: VidPersona, resolveVideo: (id: string) => VidRow | undefined): boolean {
  return PERSONA_PARTS.every((part) => {
    const id = persona[part];
    return !!id && !!resolveVideo(id);
  });
}
