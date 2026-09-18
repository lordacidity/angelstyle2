'use client';

// The words a Vids 2 video goes out with — the captions on it and the post
// captions under it — as calls that need nothing but the plan and its picks.
//
// That is what lets them go out while the recordings are still being drawn
// (Vids2Section generate). The hook and the post captions read nothing off a
// recording — who, which way, the mode, the persona — so they go the moment
// Generate is pressed. The rest of the captions are timed against the
// recordings, and a recording knows its length and its beats before its first
// frame (each renderer's onPlanned), so they go the moment both have laid
// themselves out. The tuning page takes whatever came back when the build
// lands (Vids2Builder, Vids2PostCaption) instead of asking again. A Rewrite
// there asks again, from the stage.

import { useMemo } from 'react';
import { emojiByUnified } from '@/lib/emoji';
import { pinnedUnifieds, useEmojiPrefs } from '@/lib/emoji-prefs-store';
import { personKey } from '@/lib/simpler/vidsBottom';
import {
  FAST_BOTTOM_A_CAPTIONS, MIN_SHARE,
  bareFixedLine, bottomBOpen, captionWindows, fixedLine, seamNeedsMerge, wantedCount,
  type CaptionWindow,
} from '@/lib/simpler/vidsCaptions';
import {
  DEFAULT_BARS, DEFAULT_BOTTOM_A_PACE, slotSpeed,
  type BottomAPace, type Picks, type Plan,
} from '@/lib/simpler/vidsPlan';
import { writeCaptions, type PostCaptionsDraft, type TradePosition } from '@/lib/vids-client';
import type { VidPersona } from '@/lib/vids-types';
import {
  bottomBFixed, bottomBTrade, NEWS_BOTTOM_A_LINES, type Direction, type Vids2Intro,
} from './vids2Build';

/** No bars, always — nothing switches them on, but the plan still asks. */
export const VIDS2_BARS = DEFAULT_BARS;
/** Bottom A is always sped up to fit its ten seconds. */
export const VIDS2_PACE: BottomAPace = DEFAULT_BOTTOM_A_PACE;

/** What the writer is steered with. Nothing sets either any more — the
 *  captions write themselves — but both still go to the route and into the
 *  record, so a build says what it was written from. */
export const CAPTION_NOTES = '';
/** Two or three emoji across the whole set, where one actually lands: these
 *  are captions for short vertical video, and a bare set reads flat next to
 *  everything else on the feed. */
export const CAPTION_EMOJIS = true;

/** Which emoji the writer may use: the ones pinned in the sidebar's Emojis
 *  drawer — the set already chosen to reach for — handed over as their
 *  characters. They are drawn from the app's Apple images on the stage and in
 *  the file (lib/simpler/vidsCaptions), so what is picked from here is what
 *  goes out. */
export function useEmojiPalette(): string[] {
  const { prefs } = useEmojiPrefs();
  return useMemo(
    () => pinnedUnifieds(prefs).map((u) => emojiByUnified(u)?.char).filter((c): c is string => !!c),
    [prefs],
  );
}

/** The hook is the persona's bit, so it comes from the persona's context; a
 *  build with no persona applied falls back to whatever the Start clip itself
 *  says. */
export const personaContextOf = (persona: VidPersona | null, picks: Picks): string =>
  persona?.context || picks.start?.video.context || '';

// ── The captions ─────────────────────────────────────────────────────────────

export interface LinesAsk {
  plan: Plan;
  picks: Picks;
  pace: BottomAPace;
  intro: Vids2Intro;
  /** Who, as Pauv spells them — what the fixed lines put in place of {name}. */
  person: string;
  direction: Direction;
  personaName: string;
  personaContext: string;
  emojiPalette: readonly string[];
  signal?: AbortSignal;
}

/** Everything but the hook, as the writer and the fixed lines left it: the
 *  words only, for the tuning page to lay into its own lines — keeping
 *  whatever it had set to one line and wherever it had dragged each. `at` is
 *  when a placed Bottom A line goes up, on the clip's own clock. */
export interface LinesDraft {
  bottomA: { text: string; at?: number }[];
  bottomB: string[];
  end: string;
}

/** What the writer is told about one screen recording: its overall context
 *  and, when it has been marked up, the ordered steps — which is what makes
 *  the captions land on the beat rather than merely inside the clip. */
const clipBrief = (w: CaptionWindow | null, context: string | undefined) => (w
  ? { context: context ?? '', marks: w.marks.map((m) => m.text), count: wantedCount(w) }
  : null);

/** The captions under the hook, written off the recordings' context and
 *  timed against `plan`. The hook is its own call (api/vids/hook). */
export async function draftLines(a: LinesAsk): Promise<LinesDraft> {
  const { plan, picks } = a;
  const windows = captionWindows(plan);
  const capName = personKey(a.person);
  // Bottom A on Fast carries FAST_BOTTOM_A_CAPTIONS lines, and the writer
  // says when each goes up as well as what it says: it is handed the clip's
  // moments on the sped-up window, and what comes back is put on the clip's
  // own clock, so a line stays on its moment whatever the pace does later.
  // Except a marked clip Fast has not had to speed up — one that already
  // fits, playing at its own speed, like the ChatGPT recording the Bottom
  // card makes, marked by the renderer beat by beat (search, wait, pick).
  // Its marks are exact and there is room for them, so it is captioned like
  // any marked clip: one line each, on the mark.
  const aWin = windows.bottomA;
  const aItem = plan.items.find((i) => i.slot === 'bottomA') ?? null;
  const aSped = !!aItem && !!picks.bottomA
    && aItem.speed > slotSpeed('bottomA', picks.bottomA.speed, aItem.sourceLength, 'normal') + 1e-6;
  // A news intro is always captioned on its marks: three lines, the first
  // two fixed outright (NEWS_BOTTOM_A_LINES), the pick rolled — never the
  // two placed lines Fast asks the writer for.
  const newsA = a.intro === 'news';
  const placeA = a.pace === 'fast' && !newsA && !!aWin && !!aItem
    && (aSped || !aWin.marks.length)
    && aWin.end - aWin.start >= FAST_BOTTOM_A_CAPTIONS * MIN_SHARE;
  const briefA = clipBrief(aWin, picks.bottomA?.video.context);
  const draft = await writeCaptions({
    personaName: a.personaName,
    personaContext: a.personaContext,
    wantStart: false,
    notes: CAPTION_NOTES.trim(),
    bottomA: placeA && briefA && aWin
      ? {
        ...briefA,
        count: FAST_BOTTOM_A_CAPTIONS,
        placed: {
          length: aWin.end - aWin.start,
          spans: aWin.marks.map((m) => ({ start: m.start - aWin.start, end: m.end - aWin.start })),
        },
      }
      : briefA,
    bottomB: clipBrief(windows.bottomB, picks.bottomB?.video.context),
    wantEnd: !!windows.end,
    endContext: picks.end?.video.context ?? '',
    emojis: CAPTION_EMOJIS,
    emojiPalette: [...a.emojiPalette],
    // The one place two marks share a line, and only when the timeline
    // says neither side has room for its own. Never across a placed
    // Bottom A: its two lines are the search and the pick.
    mergeSeam: !placeA && seamNeedsMerge(windows),
    // Bottom B is always the rendered trade here, so the writer is told its
    // chart and confirmation lines are fixed and its trade line carries $.
    renderedTrade: true,
  }, a.signal);
  const atA = placeA ? draft.bottomAAt : undefined;
  const toClip = (at: number) => (aItem ? Math.round((aItem.trimStart + at * aItem.speed) * 100) / 100 : at);
  // Some of Bottom A's lines are not the model's to write, so whatever came
  // back in those slots is dropped for a fixed one: on a news intro the first
  // two outright, then the rolled pick; on a ChatGPT one the rolled wait and
  // pick (lib/simpler/vidsCaptions). They are taken by mark, so they only
  // stand in on a clip marked the way the rendered recordings are — three
  // beats, one line each — never the two placed lines Fast asks for. Rolled
  // once, here: the line checked against Bottom B below is the line shown.
  const fixedA = !placeA && draft.bottomA.length >= 3;
  const textA = draft.bottomA.map((t, i) =>
    (newsA && NEWS_BOTTOM_A_LINES[i]) || (fixedA && fixedLine('bottomA', i, capName)) || t);
  // Bottom B is the rendered trade, and three of its four lines are not the
  // model's either: the opener, the chart and the confirmation. The trade
  // between them is, held to having its amount in $ (lib/vids2
  // bottomBFixed, bottomBTrade). The chart and confirmation steer clear of
  // whatever Bottom A just said.
  const fixedB = draft.bottomB.length >= 4;
  const saidA = textA.map(bareFixedLine);
  const textB = draft.bottomB.map((t, i) => (i === 0 ? bottomBOpen(capName)
    : !fixedB ? t
    : bottomBFixed(i, saidA) ?? (i === 2 ? bottomBTrade(t, capName, a.direction) : t)));
  return {
    bottomA: textA.map((text, i) => {
      const at = atA?.[i];
      return at != null && Number.isFinite(at) ? { text, at: toClip(at) } : { text };
    }),
    bottomB: textB,
    end: draft.end,
  };
}

// ── Set off early ────────────────────────────────────────────────────────────

/** The words Generate has already asked for by the time the build lands. Each
 *  is a promise the tuning page takes in place of asking again; each is null
 *  where Generate didn't ask, and the page asks as it always has. */
export interface Vids2Early {
  /** The hook, asked for the moment Generate was pressed: it is written off
   *  who, which way, the mode and the persona, none of which waits on a
   *  recording. With the name it was asked for — the form's, which is the
   *  roster's — so a build Pauv spelled differently asks again. */
  hook: { person: string; start: Promise<string> } | null;
  /** Everything else, off the plan the recordings were about to make, asked
   *  for as soon as both had laid themselves out. Null when a clip's length
   *  wasn't known up front — the page waits for the browser to measure it,
   *  as before. */
  lines: Promise<LinesDraft> | null;
  /** The post captions, asked for the moment Generate was pressed, and who
   *  and which way they were asked for — told outright, so the route never
   *  has to read either off the recordings (api/vids/post-captions). Taken
   *  only by a build Pauv spelled the same way. */
  post: { person: string; position: TradePosition; draft: Promise<PostCaptionsDraft> } | null;
}
