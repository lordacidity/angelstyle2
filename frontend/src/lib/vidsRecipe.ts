// A build written down, and read back. VidBuildSpec (lib/vids-types) is the
// record; this is the bridge between it and the builder's live state — one
// function to take the record off the stage as an export starts, one to put it
// back on when a code is typed in. Pure: nothing here cares whether the record
// is a minute or a year old, it just says what no longer matches.

import type { RecipePick, VidBuildSpec, VidPersona, VidRow } from '@/lib/vids-types';
import { SLOTS, clampSpeed, type BarsLayout, type Picks, type SlotPick } from '@/lib/vidsPlan';
import type { CaptionLines } from '@/lib/vidsCaptions';
import type { Music, RoomTone } from '@/lib/vidsAudio';

/** The builder's state that goes into the record: what is on the stage and
 *  every setting around it. */
export interface BuildState {
  picks: Picks;
  /** The persona filling the top three slots, if they still match one. */
  persona: VidPersona | null;
  bars: BarsLayout;
  roomTone: RoomTone;
  music: Music;
  clipLevel: number;
  /** Output preset id. */
  preset: string;
  lines: CaptionLines;
  styleId: string;
  notes: string;
  emojis: boolean;
}

const pickSpec = (p: SlotPick): RecipePick => ({
  videoId: p.video.id,
  videoName: p.video.name,
  storagePath: p.video.storagePath,
  muted: p.muted,
  fit: p.fit,
  align: p.align,
  transform: { ...p.transform },
  trim: { ...p.trim },
  speed: p.speed,
});

/** The record of what is on the stage right now. Copies rather than shares, so
 *  what is written down is what was there at that moment. */
export function specFromBuild(s: BuildState): VidBuildSpec {
  const picks: VidBuildSpec['picks'] = {};
  for (const { id } of SLOTS) {
    const p = s.picks[id];
    if (p) picks[id] = pickSpec(p);
  }
  return {
    persona: s.persona ? { id: s.persona.id, name: s.persona.name } : null,
    picks,
    bars: { ...s.bars },
    roomTone: { ...s.roomTone },
    music: { ...s.music },
    clipLevel: s.clipLevel,
    preset: s.preset,
    captions: {
      lines: structuredClone(s.lines),
      styleId: s.styleId,
      notes: s.notes,
      emojis: s.emojis,
    },
  };
}

export interface RestoredPicks {
  picks: Picks;
  /** What could not be brought back exactly, one line each. Empty when every
   *  clip is still there and still the same footage. */
  problems: string[];
}

/** The slots as the record has them, against the library as it is now. A clip
 *  that has gone leaves its slot empty and says so; one whose footage has been
 *  re-edited since is used, with a warning, because its in / out points were
 *  set on the old bytes. Everything else comes back to the number. */
export function picksFromSpec(
  spec: VidBuildSpec,
  resolveVideo: (id: string) => VidRow | undefined,
  personas: readonly VidPersona[],
): RestoredPicks {
  const picks: Picks = {};
  const problems: string[] = [];
  for (const { id, label } of SLOTS) {
    const rp = spec.picks[id];
    if (!rp) continue;
    const video = resolveVideo(rp.videoId);
    if (!video) {
      problems.push(`${label}: "${rp.videoName || 'its clip'}" is no longer in the library, so that slot is empty.`);
      continue;
    }
    if (rp.storagePath && video.storagePath !== rp.storagePath) {
      problems.push(`${label}: "${video.name}" has been re-edited since, so its trim may not land where it did.`);
    }
    picks[id] = {
      video,
      muted: rp.muted,
      fit: rp.fit,
      align: rp.align,
      transform: { ...rp.transform },
      trim: { ...rp.trim },
      speed: clampSpeed(rp.speed),
    };
  }
  const persona = spec.persona;
  if (persona && !personas.some((p) => p.id === persona.id)) {
    problems.push(`Persona "${persona.name}" has since been deleted — its clips are still used where they were.`);
  }
  return { picks, problems };
}
