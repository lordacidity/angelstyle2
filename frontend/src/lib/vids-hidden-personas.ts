// Persona videos switched off for now, kept in the database, left out of the
// library.
//
// A persona video that should not be picked for a while, and should not be
// deleted either, is named here and the library (lib/vids-db listLibrary)
// leaves it out of what it sends. Nothing downstream has to know: the clipper
// page, Vids 2 and the Studio's own Vids pages all read the library, so a
// video held back here is not there to choose in any of them, the same way
// a deleted one would not be, only the row and its clips are still in the
// database and come back the moment the rule below is changed.
//
// This is the backend's switch, by hand, in code. The Clippers page has a
// switch of its own (VidClipable) but that one is about the clippers alone:
// the Studio goes on using everything whatever it says. This one is the
// opposite, off means off everywhere, which is what "hide it for now" asks.
//
// The three clips of a hidden video go with it, unless a video still showing
// uses one of them (a part can be re-pointed, so the same clip may be in two
// videos), so the Persona folder does not fill up with footage that looks
// unassigned and is not.
//
// Since 2026-10-13: every video of Aiden's but serious1 and serious2, until
// told otherwise. To unhide them, take Aiden out of HIDDEN. To hide somebody
// else's, add a line.

import type { VidFolder, VidPersona, VidRow, VidsLibraryPayload } from '@/lib/vids-types';
import { PERSONA_PARTS } from '@/lib/vids-types';
import { personaFolders } from '@/lib/vids-persona-folders';

/** Whose videos are held back, and which of theirs are not. `person` is the
 *  persona folder's name (a folder directly under Persona); `keep` is the
 *  names of the videos of theirs that stay. Names are matched loosely, see
 *  `loose`, so "Serious 1" and "serious1" are the same video. */
export interface HiddenPerson {
  person: string;
  keep: readonly string[];
}

export const HIDDEN: readonly HiddenPerson[] = [
  { person: 'Aiden', keep: ['serious1', 'serious2'] },
];

/** A name as it is compared: lower-case, letters and digits only. Written
 *  by hand on both sides, so neither spacing nor case should decide. */
const loose = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The ids of every persona video the rules hide, among `personas`. The folders
 *  say who is whose. */
export function hiddenPersonaIds(
  personas: readonly VidPersona[], folders: readonly VidFolder[], rules: readonly HiddenPerson[] = HIDDEN,
): Set<string> {
  const out = new Set<string>();
  if (!rules.length) return out;
  const people = personaFolders(folders);
  for (const rule of rules) {
    const person = loose(rule.person);
    const keep = new Set(rule.keep.map(loose));
    const theirs = new Set(people.filter((f) => loose(f.name) === person).map((f) => f.id));
    if (!theirs.size) continue;
    for (const p of personas) {
      if (p.folderId && theirs.has(p.folderId) && !keep.has(loose(p.name))) out.add(p.id);
    }
  }
  return out;
}

/** The library without the hidden videos, or their clips. The payload is
 *  handed back as it came when nothing is hidden. */
export function withoutHiddenPersonas(
  lib: VidsLibraryPayload, rules: readonly HiddenPerson[] = HIDDEN,
): VidsLibraryPayload {
  const hidden = hiddenPersonaIds(lib.personas, lib.folders, rules);
  if (!hidden.size) return lib;
  const partsOf = (p: VidPersona) => PERSONA_PARTS.map((k) => p[k]).filter((id): id is string => !!id);
  const personas = lib.personas.filter((p) => !hidden.has(p.id));
  const stillUsed = new Set(personas.flatMap(partsOf));
  const gone = new Set(lib.personas.filter((p) => hidden.has(p.id)).flatMap(partsOf));
  const videos = lib.videos.filter((v: VidRow) => !gone.has(v.id) || stillUsed.has(v.id));
  return { ...lib, personas, videos };
}
