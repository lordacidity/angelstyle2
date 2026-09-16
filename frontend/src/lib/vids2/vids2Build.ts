'use client';

// Vids 2's own bit of logic: the form's five answers, and the two recordings
// they turn into.
//
// Everything about laying those recordings into a video — the plan, the
// captions, the sound, the export, the record — is Simpler's (lib/simpler/*),
// which Vids 2 shares rather than copies. What lives here is only what Vids 2
// has and Simpler hasn't:
//
//   - the five answers, and remembering them between visits;
//   - the Pauv roster the second answer is chosen from;
//   - the Pauv trade recording as a Bottom B — Simpler picks that slot off a
//     shelf of filed clips, Vids 2 renders it for this one video the way it
//     already renders the ChatGPT search for Bottom A.
//
// Both recordings are rendered by their one home — components/chatgpt and
// components/trade — and kept in this tab (lib/simpler/vidsLocal). Neither goes
// to the library, and neither survives the page being left.

import {
  createTradeClip, loadTradeAssets, renderTradeVideo, VIDEO_H, VIDEO_W,
  type Direction, type Theme, type TradeBeats, type TradeTalent,
} from '@/app/components/trade/trade-video';
import type { BoomSound } from '@/lib/simpler/vidsAudio';
import { makeLocalClip } from '@/lib/simpler/vidsLocal';
import { MAX_MARK_TEXT, type VidMark, type VidRow } from '@/lib/vids-types';

export type { Direction, Theme, TradeTalent };

// ── The answers ──────────────────────────────────────────────────────────────

/** How the video talks: Serious, Middle or Degen. Only Degen does anything of
 *  its own so far — three things change, and only in Vids 2: the hook is
 *  written to DEGEN_HOOK (api/vids/captions) — no money, a self-own and a cry
 *  for help — three BOOMs lay themselves over the recordings (degenBooms), and
 *  the song rolled for it may be one marked degen on the Music page, which no
 *  other build ever rolls (rollableMusic in Vids2Builder). The video
 *  underneath is exactly the same video. Serious and Middle are still to be
 *  defined, and until they are, both make the ordinary video. */
export type Vids2Mode = 'serious' | 'middle' | 'degen';
export const VIDS2_MODES: readonly Vids2Mode[] = ['serious', 'middle', 'degen'];
export const isVids2Mode = (v: unknown): v is Vids2Mode =>
  typeof v === 'string' && (VIDS2_MODES as readonly string[]).includes(v);

/** What the form asks for, and the whole of what Generate needs. */
export interface Vids2Setup {
  /** The persona's id in the library. Its three clips are looked up from it. */
  personaId: string | null;
  /** Who on Pauv the video trades on — their name as the roster spells it. */
  person: string;
  direction: Direction;
  /** Which way Pauv is in the trade recording. The ChatGPT one is dark
   *  whatever this says — that page has no light mode in the renderer. */
  theme: Theme;
  /** What gets typed into ChatGPT, exactly as it is written here — capitals
   *  and all. Only the two Generate question buttons lower-case what they put
   *  in the box (see `lower`); typing over it is nobody's business but the
   *  person typing. */
  question: string;
  /** Serious, Middle or Degen — see Vids2Mode. */
  mode: Vids2Mode;
}

export const EMPTY_SETUP: Vids2Setup = {
  personaId: null, person: '', direction: 'up', theme: 'light', question: '', mode: 'serious',
};

const SETUP_KEY = 'vids2-setup-v1';

/** How a WRITTEN question comes back: lower case throughout, the way a search
 *  bar is typed into. Only the model's two drafts go through this — a question
 *  typed by hand keeps whatever case it was given. */
export const lower = (s: string) => s.toLowerCase();

/** The answers from last time, so a second video is a few words' work rather
 *  than five. Anything missing or wrong falls back to the empty answer. */
export function loadSetup(): Vids2Setup {
  if (typeof window === 'undefined') return EMPTY_SETUP;
  try {
    const raw = localStorage.getItem(SETUP_KEY);
    if (!raw) return EMPTY_SETUP;
    const j = JSON.parse(raw) as Partial<Record<keyof Vids2Setup | 'degen', unknown>>;
    return {
      personaId: typeof j.personaId === 'string' ? j.personaId : null,
      person: typeof j.person === 'string' ? j.person : '',
      direction: j.direction === 'down' ? 'down' : 'up',
      theme: j.theme === 'dark' ? 'dark' : 'light',
      question: typeof j.question === 'string' ? j.question : '',
      // Answers saved before there were three modes had a degen switch.
      mode: isVids2Mode(j.mode) ? j.mode : j.degen === true ? 'degen' : 'serious',
    };
  } catch {
    return EMPTY_SETUP;
  }
}

export function saveSetup(s: Vids2Setup): void {
  try { localStorage.setItem(SETUP_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

/** A generate that finished: what the form asked for, and who Pauv turned out
 *  to have. It is what the tuning page is told about the video under it — the
 *  clips themselves are in the picks — and what the captions' name comes from,
 *  so nothing there has to read a person back off a file name. */
export interface Vids2Build {
  /** Goes up on every Generate. The tuning page watches it, and nothing else,
   *  to know the clips beneath it have been replaced. */
  id: number;
  /** Who, as Pauv spells them — the roster's name rather than what was typed. */
  person: string;
  direction: Direction;
  theme: Theme;
  question: string;
  /** The mode it was made in — see Vids2Mode. */
  mode: Vids2Mode;
  /** The moments the two renderers actually put things at, for whatever wants
   *  to land on one. */
  beats: Vids2Beats;
}

/** The moments degen mode hangs a BOOM on, in each recording's OWN clip
 *  seconds — straight off the renderers' beats, not off the timeline, since
 *  neither recording knows where it will end up sitting. */
export interface Vids2Beats {
  /** Bottom A: ChatGPT has got to the name and the pointer goes for it. */
  chatPick: number;
  /** Bottom B: their page opening — the click after the search. */
  tradeOpen: number;
  /** Bottom B: Place trade pressed. */
  tradePlaced: number;
}

/** Whether the form has been answered enough to press Generate. A persona with
 *  no clips is caught later, by the stage having nothing on it. */
export const setupReady = (s: Vids2Setup): boolean =>
  !!s.personaId && !!s.person.trim() && !!s.question.trim();

// ── Degen mode's BOOMs ───────────────────────────────────────────────────────

/** The two bangs degen reaches for. */
export type DegenSound = 'fahh' | 'ohHellNah';

/** Matched against the file name rather than named outright, so a better take
 *  dropped into public/audio/booms under a near-enough name is picked up and a
 *  tidy-up of the folder doesn't break a build — see /api/vids/boom-sounds. A
 *  sound that isn't in the folder is simply not there: its BOOM still lands on
 *  the picture, silently, rather than not landing at all. */
const DEGEN_SOUND: Record<DegenSound, RegExp> = {
  fahh: /fa+h+/i,
  ohHellNah: /hell.?nah|oh.?hell/i,
};

export const degenBoomSound = (sounds: readonly BoomSound[], kind: DegenSound): BoomSound | null =>
  sounds.find((s) => DEGEN_SOUND[kind].test(s.url)) ?? null;

/** One BOOM degen mode lays itself. */
export interface DegenBoom {
  slot: 'bottomA' | 'bottomB';
  /** Clip seconds into that slot's recording. The tuning page puts it on the
   *  timeline, where the speed each slot plays at decides where it lands. */
  at: number;
  sound: DegenSound;
  /** Whether the BOOM's picture goes on with it, or it is the noise alone.
   *  See degenBooms. */
  picture: boolean;
  /** What it is landing on — for the tuning page to say, and for whoever reads
   *  this later wondering why there are three. */
  on: string;
}

/** The three BOOMs every degen build gets, in play order. They are the beats
 *  somebody watching would react on: the answer naming them, their page coming
 *  up, and the money going in. Nothing places them by hand — degen mode is a
 *  switch, not a job — and every one of them can still be taken off on the bar
 *  like any other, because they are ordinary BOOMs once they are down.
 *
 *  The middle one is its noise and nothing else (`picture: false`). The oh hell
 *  nah runs for several seconds, far longer than a BOOM is ever on screen, and
 *  it is a reaction TO what is on the screen — their page coming up — so it
 *  plays out in full over that page instead of covering it. The two fahhs are
 *  the whole thing, hit and all. Every bang plays its own length wherever it
 *  is laid, and two that run into each other simply both play. */
export const degenBooms = (b: Vids2Beats): DegenBoom[] => [
  { slot: 'bottomA', at: b.chatPick, sound: 'fahh', picture: true, on: 'chatgpt naming them' },
  { slot: 'bottomB', at: b.tradeOpen, sound: 'ohHellNah', picture: false, on: 'their page opening' },
  { slot: 'bottomB', at: b.tradePlaced, sound: 'fahh', picture: true, on: 'the trade going in' },
];

// ── The people on Pauv ───────────────────────────────────────────────────────

/** The roster, once per page. Everyone listed, with a price or without — the
 *  trade recording needs a price and says so itself if there is none, and a
 *  list that quietly left people out would be the harder thing to explain.
 *  Over a thousand of them, so the dropdown searches rather than scrolls. */
let rosterP: Promise<TradeTalent[]> | null = null;

export function loadRoster(signal?: AbortSignal): Promise<TradeTalent[]> {
  if (!rosterP) {
    rosterP = (async () => {
      const r = await fetch('/api/ai/talents');
      const data = await r.json().catch(() => null) as TradeTalent[] | { error?: string } | null;
      if (!r.ok || !Array.isArray(data)) {
        throw new Error((data && !Array.isArray(data) && data.error) || `Pauv roster: HTTP ${r.status}`);
      }
      return [...data].sort((a, b) => a.name.localeCompare(b.name));
    })();
    // A failed fetch shouldn't be the answer for the rest of the session.
    rosterP.catch(() => { rosterP = null; });
  }
  const p = rosterP;
  if (!signal) return p;
  return new Promise<TradeTalent[]>((resolve, reject) => {
    const abort = () => reject(new DOMException('Cancelled', 'AbortError'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

// ── The trade recording, as a Bottom B ───────────────────────────────────────

/** What the clip is called on the stage and in the record an export writes
 *  down. Nothing parses it — Vids 2 knows who it is from the form — so it is
 *  written to be read. */
export const bottomBName = (person: string, direction: Direction, theme: Theme) =>
  `${person} ${direction} B · Pauv ${theme}`;

/** Its context, in the words a hand-filed Bottom B uses, so the caption writer
 *  and the post-caption writer read it the same way. */
export const bottomBContext = (person: string, direction: Direction) =>
  `pauv.com, searching ${person}, reading their chart, then trading $10 ${direction} on them`;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Its marks: the recording's four beats, written the way a hand-marked clip is
 *  — the caption writer turns each into a line and the layout lands that line
 *  where its beat starts (lib/simpler/vidsCaptions onMarks). Times are the
 *  renderer's own, in clip seconds. The first line is replaced by the fixed
 *  opener ("go to pauv.com / search them") whatever comes back for it, so this
 *  one is what steers the three after it. */
export function bottomBMarks(beats: TradeBeats, person: string, direction: Direction): VidMark[] {
  const at = (s: { start: number; end: number }) => ({ start: r2(s.start), end: r2(s.end) });
  const say = (text: string) => text.slice(0, MAX_MARK_TEXT);
  return [
    { ...at(beats.searching), text: say(`searching ${person} on pauv`) },
    { ...at(beats.analyzing), text: say(`reading ${person}'s price chart`) },
    { ...at(beats.trading), text: say(`putting $10 ${direction} on them`) },
    { ...at(beats.confirming), text: say('the trade goes through') },
  ];
}

export interface TradeClipProgress { stage: 'load' | 'render'; frac: number | null }

export interface MakeTradeClipOptions {
  /** Who, as the roster spells them — matched again inside loadTradeAssets. */
  name: string;
  direction: Direction;
  theme: Theme;
  signal?: AbortSignal;
  onProgress?: (p: TradeClipProgress) => void;
}

/** The Pauv trade recording for this one video, as a clip the stage, the plan,
 *  the captions and the exporter take like any other. Rendered by
 *  components/trade/trade-video — the one home for it — and held in this tab. */
export async function makeTradeClip(
  o: MakeTradeClipOptions,
): Promise<{ row: VidRow; person: TradeTalent; beats: TradeBeats }> {
  o.onProgress?.({ stage: 'load', frac: null });
  const assets = await loadTradeAssets(o.name, o.theme, o.signal);
  const { blob, beats, seconds } = await renderTradeVideo(assets, {
    direction: o.direction,
    signal: o.signal,
    onProgress: (done, total) => o.onProgress?.({ stage: 'render', frac: done / total }),
  });
  const person = assets.person.name;
  const row = makeLocalClip(blob, {
    name: bottomBName(person, o.direction, o.theme),
    context: bottomBContext(person, o.direction),
    marks: bottomBMarks(beats, person, o.direction),
    duration: seconds,
    width: VIDEO_W,
    height: VIDEO_H,
    // Its audio track is the keyboard and the mouse (buildTradeAudio).
    hasSfx: true,
    // Which way Pauv was: what the frame puts either side of the recording
    // where it doesn't fill the bottom half (vidsPlan itemBacking).
    theme: o.theme,
    poster: await tradePoster(assets, o.direction, beats),
  });
  return { row, person: assets.person, beats };
}

/** A frame off the end of the recording — the card green, Trade confirmed —
 *  for wherever the clip is shown as a card. The clip is built a second time
 *  for it, which is closures and arithmetic rather than anything drawn, and
 *  costs nothing next to the render it follows. Null if the browser won't give
 *  a blob, which is nothing worth failing a build over. */
async function tradePoster(
  assets: Awaited<ReturnType<typeof loadTradeAssets>>,
  direction: Direction,
  beats: TradeBeats,
): Promise<Blob | null> {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = VIDEO_W;
    canvas.height = VIDEO_H;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;
    const clip = createTradeClip(ctx, assets, direction);
    clip.draw(Math.min(beats.confirming.start + 0.8, Math.max(0, clip.seconds - 0.1)));
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  } catch {
    return null;
  }
}
