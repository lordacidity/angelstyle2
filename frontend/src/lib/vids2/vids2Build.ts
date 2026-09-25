'use client';

// Vids 2's own bit of logic: the form's answers, and the recordings they turn
// into.
//
// Everything about laying those recordings into a video — the plan, the
// captions, the sound, the export, the record — is Simpler's (lib/simpler/*),
// which Vids 2 shares rather than copies. What lives here is only what Vids 2
// has and Simpler hasn't:
//
//   - the answers, and remembering them between visits;
//   - the Pauv roster the first answer is chosen from;
//   - the intro as a Bottom A: nothing, the ChatGPT search, or a real news
//     story about them — the news recording is rendered here for this one
//     video the way the ChatGPT search already is;
//   - the Pauv trade recording as a Bottom B — Simpler picks that slot off a
//     shelf of filed clips, Vids 2 renders it for this one video.
//
// Every recording is rendered by its one home — components/chatgpt,
// components/news and components/trade — and kept in this tab
// (lib/simpler/vidsLocal). None goes to the library, and none survives the
// page being left.

import {
  loadNewsAssets, renderNewsVideo, type NewsBeats, type NewsPlan,
} from '@/app/components/news/news-video';
import { CLIPPERS, withBase } from '@/lib/clipping';
import {
  AMOUNT_USD, createTradeClip, loadTradeAssets, renderTradeVideo, VIDEO_H, VIDEO_W,
  type Direction, type Theme, type TradeBeats, type TradeTalent, type ZoomLevel,
} from '@/app/components/trade/trade-video';
import {
  findPagePhotos, hitFromStory, isNewsRange, isTrendSort, isTrendWindow, pagePhotosFrom, readNewsStory,
  withHighlight, type NewsRange, type TrendSort, type TrendWindow,
} from '@/lib/news/client';
import { isOutletId, outletById } from '@/lib/news/outlets';
import type { NewsArticle, NewsHit, RailItem } from '@/lib/news/types';
import type { BoomSound } from '@/lib/simpler/vidsAudio';
import { makeLocalClip, type LocalClipMeta } from '@/lib/simpler/vidsLocal';
import {
  MAX_MARK_TEXT, type VidBuildSpec, type VidMark, type VidRecipe, type VidRow, type Vids2Answers,
} from '@/lib/vids-types';
import type { Vids2Early } from './vids2Words';

export type { Direction, NewsRange, Theme, TradeTalent, TrendSort, TrendWindow };

// ── The answers ──────────────────────────────────────────────────────────────

/** How the video talks: Serious, Middle or Degen. Each writes the hook to its
 *  own guide in api/vids/hook: Serious a flat trade, reason and what the money
 *  is for; Middle a money analogy against what the persona is doing, a
 *  mystery trade or how little time it took; Degen a descriptor, the trade, a
 *  nickname and a bracket. Degen also
 *  lays three BOOMs over the recordings (degenBooms), and the song rolled for
 *  it may be one marked degen on the Music page, which no other build ever
 *  rolls (rollableMusic in Vids2Builder). The video underneath is exactly the
 *  same video in all three. */
export type Vids2Mode = 'serious' | 'middle' | 'degen';
export const VIDS2_MODES: readonly Vids2Mode[] = ['serious', 'middle', 'degen'];
export const isVids2Mode = (v: unknown): v is Vids2Mode =>
  typeof v === 'string' && (VIDS2_MODES as readonly string[]).includes(v);

/** Whether Mode is a question at all. Only in the Studio: the clipper page
 *  (pauv.io/clipping, this same code built with NEXT_PUBLIC_APP=clippers)
 *  makes CLIPPER_MODE videos and nothing else. Its form has no Mode card
 *  (Vids2Form), a saved answer is not read back (loadSetup), and a code made
 *  in another mode comes back in CLIPPER_MODE and says so (answersFromRecord). */
export const MODE_ASKED = !CLIPPERS;
/** The mode every clipper video is made in, Mode not being asked there.
 *  Middle since 2026-09-24, Serious before. */
export const CLIPPER_MODE: Vids2Mode = 'middle';
const MODE_NAME: Record<Vids2Mode, string> = { serious: 'Serious', middle: 'Middle', degen: 'Degen' };

/** Which way Pauv comes up in the trade recording, as the form asks it: light,
 *  dark, or rolled at even odds (rollTheme) — the default, so builds spread
 *  across the two the way they spread across songs and caption looks unless
 *  somebody wants one in particular. */
export type Vids2Look = 'roll' | Theme;
export const VIDS2_LOOKS: readonly Vids2Look[] = ['roll', 'light', 'dark'];
export const isVids2Look = (v: unknown): v is Vids2Look =>
  typeof v === 'string' && (VIDS2_LOOKS as readonly string[]).includes(v);

/** Whether Look is a question. Only in the Studio, like Mode: the clipper page
 *  rolls it every time, the way every build did before it was asked. */
export const LOOK_ASKED = !CLIPPERS;

/** What opens the video — the first screen recording, Bottom A. None: there
 *  isn't one, and the video goes straight to trading on them on Pauv.
 *  ChatGPT: the question typed in and them picked off the answer. News: a
 *  real story about them found on Google News, opened and read, with their
 *  name dragged over — the recording Studio > News makes. */
export type Vids2Intro = 'none' | 'chatgpt' | 'news';
export const VIDS2_INTROS: readonly Vids2Intro[] = ['none', 'chatgpt', 'news'];
export const isVids2Intro = (v: unknown): v is Vids2Intro =>
  typeof v === 'string' && (VIDS2_INTROS as readonly string[]).includes(v);

/** Whether "No intro" is on offer. Only in the Studio, like Mode and Look:
 *  every clipper video opens on ChatGPT or a story. The clipper form does
 *  not show it (INTROS_OFFERED), a saved answer of it is not read back
 *  (loadSetup), and one that somehow stands is not an answer (introReady). */
export const NONE_OFFERED = !CLIPPERS;
/** The intros the form puts up, in order. */
export const INTROS_OFFERED: readonly Vids2Intro[] = NONE_OFFERED ? VIDS2_INTROS : VIDS2_INTROS.filter((i) => i !== 'none');

/** Which end the form starts from. Who: the person, then what opens the video,
 *  then which way, the look, the mode and the persona. News: the other way
 *  round — it opens on the stories going out right now that name somebody on
 *  Pauv (lib/news/trending), and picking one answers Who and the intro both,
 *  so what is left is which way, the look, the mode and the persona. A
 *  news-flow setup always has a news intro. */
export type Vids2Flow = 'who' | 'news';
export const isVids2Flow = (v: unknown): v is Vids2Flow => v === 'who' || v === 'news';

/** The story a news intro is made from: the search result it was, and the
 *  article as read off the outlet — already checked, so the form can show its
 *  page — with the outlet's other headlines for the side column. `name` is
 *  who it was searched for: a story found for somebody else is no answer for
 *  this one (see storyFor). */
export interface Vids2Story {
  name: string;
  hit: NewsHit;
  article: NewsArticle;
  rail: RailItem[];
}

/** What the form asks for, and the whole of what Generate needs. */
export interface Vids2Setup {
  /** The persona's id in the library. Its three clips are looked up from it. */
  personaId: string | null;
  /** Who on Pauv the video trades on — their name as the roster spells it. */
  person: string;
  direction: Direction;
  /** What opens the video — see Vids2Intro. */
  intro: Vids2Intro;
  /** What gets typed into ChatGPT, exactly as it is written here — capitals
   *  and all. Only the two Generate question buttons lower-case what they put
   *  in the box (see `lower`); typing over it is nobody's business but the
   *  person typing. Only read for a ChatGPT intro. */
  question: string;
  /** How far back the article search looks, for a news intro. */
  newsRange: NewsRange;
  /** The story chosen for a news intro, or null. Only read for one. */
  story: Vids2Story | null;
  /** Light, dark, or rolled — see Vids2Look. Always 'roll' on the clipper
   *  page, where it is not asked (LOOK_ASKED). */
  look: Vids2Look;
  /** Serious, Middle or Degen — see Vids2Mode. Always CLIPPER_MODE on the
   *  clipper page, where it is not asked (MODE_ASKED). */
  mode: Vids2Mode;
  /** Which end the form starts from — see Vids2Flow. Null until it has been
   *  chosen: the form opens on the two buttons and asks nothing until one of
   *  them is pressed, so nobody is put in a flow they did not pick. Saved like
   *  every other answer but never restored (loadSetup), so a reload — and
   *  Reset, and Back off the first question — is that choice again. */
  flow: Vids2Flow | null;
  /** How far back the news flow's trending list looks. */
  trendWindow: TrendWindow;
  /** Whether that list leaves politics out. */
  hidePolitics: boolean;
  /** Its order: the biggest stories first — the AI's read of what would stop
   *  somebody scrolling — or the newest. */
  trendSort: TrendSort;
  /** A category the list is narrowed to — "cycling", "rap", "politics", or
   *  anything else somebody types. Filters the rows on the spot by what the
   *  people in them are known for; only a press of Search wider puts the words
   *  to Google (lib/news/categories). Empty is the whole list. */
  trendCategory: string;
}

export const EMPTY_SETUP: Vids2Setup = {
  personaId: null, person: '', direction: 'up',
  intro: 'chatgpt', question: '', newsRange: '7d', story: null, look: 'roll', mode: MODE_ASKED ? 'serious' : CLIPPER_MODE,
  flow: null, trendWindow: '24h', hidePolitics: false, trendSort: 'hot', trendCategory: '',
};

/** Which way Pauv is in the trade recording when the Look card says roll (or
 *  is not there to say): even odds, every time. The ChatGPT recording is dark
 *  whatever comes up — that page has no light mode in the renderer. */
export const rollTheme = (): Theme => (Math.random() < 0.5 ? 'light' : 'dark');

/** The theme the trade recording is drawn in for these answers: the one the
 *  Look card names, or a fresh roll. Rolled where the render starts rather
 *  than where Generate does, since by then the frames are already drawn —
 *  so this is called once per run, not once per Generate (Vids2Section). */
export const themeFor = (s: Pick<Vids2Setup, 'look'>): Theme => (s.look === 'roll' ? rollTheme() : s.look);

const SETUP_KEY = 'vids2-setup-v1';

/** How a WRITTEN question comes back: lower case throughout, the way a search
 *  bar is typed into. Only the model's two drafts go through this — a question
 *  typed by hand keeps whatever case it was given. */
export const lower = (s: string) => s.toLowerCase();

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The story chosen for THIS person, or null: one chosen and then Who changed
 *  is a story about somebody else, and the search has to be run again. */
export const storyFor = (s: Pick<Vids2Setup, 'person' | 'story'>): Vids2Story | null =>
  (s.story && sameName(s.story.name, s.person) ? s.story : null);

/** A saved story, loosely checked: enough that the form can show it and
 *  Generate can render it. Anything else is no story. */
function isStory(v: unknown): v is Vids2Story {
  const s = v as Partial<Vids2Story> | null;
  if (!s || typeof s !== 'object' || typeof s.name !== 'string') return false;
  const h = s.hit as Partial<NewsHit> | undefined;
  const a = s.article as Partial<NewsArticle> | undefined;
  return !!h && typeof h.url === 'string' && typeof h.title === 'string' && isOutletId(h.outlet)
    && !!a && typeof a.url === 'string' && typeof a.headline === 'string' && isOutletId(a.outlet)
    && Array.isArray(a.paragraphs) && Array.isArray(a.notes)
    && Array.isArray(s.rail);
}

/** The answers from last time, so a second video is a few words' work rather
 *  than five. Anything missing or wrong falls back to the empty answer. */
export function loadSetup(): Vids2Setup {
  if (typeof window === 'undefined') return EMPTY_SETUP;
  try {
    const raw = localStorage.getItem(SETUP_KEY);
    if (!raw) return EMPTY_SETUP;
    // A saved `theme` is from an older form that asked Look under that name; it
    // is simply not read. Look is `look` now, and can say roll.
    const j = JSON.parse(raw) as Partial<Record<keyof Vids2Setup | 'degen', unknown>>;
    // Which end to start from is asked every time and never restored: the two
    // ways in are the first thing the form puts up, and which one somebody
    // wants is about the video they are making now, not the one they made
    // last. It is still read — a news-flow save had a news intro, and that
    // answer is kept like every other — only never handed back as a choice
    // already made.
    const saved = isVids2Flow(j.flow) ? j.flow : null;
    return {
      personaId: typeof j.personaId === 'string' ? j.personaId : null,
      person: typeof j.person === 'string' ? j.person : '',
      direction: j.direction === 'down' ? 'down' : 'up',
      // Answers saved before there was a choice of intro were ChatGPT ones.
      // The news flow has no intro question: its intro is the story.
      // "No intro" is not on offer on the clipper page (NONE_OFFERED), so a
      // saved one comes back as ChatGPT there.
      intro: saved === 'news' ? 'news' : isVids2Intro(j.intro) && (NONE_OFFERED || j.intro !== 'none') ? j.intro : 'chatgpt',
      question: typeof j.question === 'string' ? j.question : '',
      newsRange: isNewsRange(j.newsRange) ? j.newsRange : EMPTY_SETUP.newsRange,
      story: isStory(j.story) ? j.story : null,
      // Neither is asked on the clipper page, so neither is read back there:
      // a saved answer would be one nothing on that form can change.
      look: LOOK_ASKED && isVids2Look(j.look) ? j.look : 'roll',
      // Answers saved before there were three modes had a degen switch.
      mode: !MODE_ASKED ? CLIPPER_MODE : isVids2Mode(j.mode) ? j.mode : j.degen === true ? 'degen' : 'serious',
      flow: null,
      trendWindow: isTrendWindow(j.trendWindow) ? j.trendWindow : EMPTY_SETUP.trendWindow,
      hidePolitics: j.hidePolitics === true,
      trendSort: isTrendSort(j.trendSort) ? j.trendSort : EMPTY_SETUP.trendSort,
      trendCategory: typeof j.trendCategory === 'string' ? j.trendCategory.slice(0, 60) : '',
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
  /** Which way Pauv came up for this one — rolled, see rollTheme. */
  theme: Theme;
  /** What opened it — see Vids2Intro. */
  intro: Vids2Intro;
  /** The question, for a ChatGPT intro; empty otherwise. */
  question: string;
  /** The story, for a news intro — the outlet's name and the headline, for
   *  the tuning page to say; null otherwise. */
  story: { outlet: string; headline: string } | null;
  /** Anything the renderers wanted known — a name that wasn't on the page, a
   *  photo that couldn't be found — for the tuning page to show. */
  notes: string[];
  /** The mode it was made in — see Vids2Mode. */
  mode: Vids2Mode;
  /** The moments the renderers actually put things at, for whatever wants
   *  to land on one. */
  beats: Vids2Beats;
  /** The words Generate set off while the recordings were still being drawn,
   *  for the tuning page to take rather than ask for again — see Vids2Early. */
  early: Vids2Early;
  /** The answers as the record an export writes down carries them — who as
   *  Pauv spells them, and the theme that came up (Vids2Answers). What a code
   *  typed into the form brings back. */
  answers: Vids2Answers;
  /** The record this build was brought back from by its code, or null for a
   *  build the form made from scratch. The tuning page takes the words, the
   *  look and the sound off it rather than rolling and asking (Vids2Builder). */
  restore: VidRecipe | null;
}

/** The moments degen mode hangs a BOOM on, in each recording's OWN clip
 *  seconds — straight off the renderers' beats, not off the timeline, since
 *  neither recording knows where it will end up sitting. */
export interface Vids2Beats {
  /** Bottom A: the intro landing on them — the first of the quick in-out zoom
   *  pulses on their highlighted name, once it has been dragged over, in the
   *  ChatGPT answer or the news story alike (each renderer's `pulseAt`). Not
   *  the pointer going for the name, nor the drag: the BOOM waits for the
   *  zoom. Null when there is no intro. */
  introPick: number | null;
  /** Bottom B: their page opening — the click after the search. */
  tradeOpen: number;
  /** Bottom B: Place trade pressed. */
  tradePlaced: number;
}

/** Whether the intro has what it needs: nothing, for none; the question, for
 *  ChatGPT; a story found for this person, for news. */
export const introReady = (s: Vids2Setup): boolean =>
  s.intro === 'none' ? NONE_OFFERED
    : s.intro === 'chatgpt' ? !!s.question.trim()
    : !!storyFor(s);

/** Whether the form has been answered enough to press Generate. A persona with
 *  no clips is caught later, by the stage having nothing on it. */
export const setupReady = (s: Vids2Setup): boolean =>
  !!s.flow && !!s.personaId && !!s.person.trim() && introReady(s);

// ── A video brought back by its code ─────────────────────────────────────────
// Every export is written down under a code (lib/simpler/vidsRecipe → the
// recipes API), and the code sits after the title in the file name and on the
// end of the post caption. Typed into the box at the top left of the form
// (Vids2Recall), the record fills the form again and Generate makes the video
// once more: the two recordings were never filed, so they are rendered again
// from the same answers, and the words, the look and the sound go on off the
// record rather than being rolled and asked for. What is here is the reading
// and writing of the answers; what happens with them is the section's.

/** The answers as the record carries them, off a finished Generate: who as
 *  Pauv spells them (the trade recording's name for them), the story by its
 *  address, and the theme that came up. */
export function answersOf(
  s: Pick<Vids2Setup, 'direction' | 'intro' | 'mode'>,
  o: { person: string; question: string; story: Vids2Story | null; theme: Theme },
): Vids2Answers {
  return {
    person: o.person,
    direction: s.direction,
    intro: s.intro,
    question: s.intro === 'chatgpt' ? o.question : '',
    story: s.intro === 'news' && o.story
      ? { url: o.story.hit.url, outlet: o.story.hit.outlet, title: o.story.hit.title }
      : null,
    mode: s.mode,
    theme: o.theme,
  };
}

/** The form's answers, from a record's: over `base` (the answers as they
 *  stand, so the trending list's settings and the like are kept), with the
 *  persona the record names if the library still has it, and the story read
 *  again (readStoryAgain) — or null for one that couldn't be, which leaves
 *  the Intro card to answer. The Look card is set to the way Pauv came up the
 *  first time, since that is the way it is coming up again: the card says
 *  what the video is, and the next video starts from it like every other
 *  answer. Not on the clipper page, where Look is not a card: the record's
 *  theme still goes on the recording there (`restore` in generate), it just
 *  isn't an answer anybody could see or change. */
export function setupFromAnswers(
  base: Vids2Setup, a: Vids2Answers, personaId: string | null, story: Vids2Story | null,
): Vids2Setup {
  return {
    ...base,
    personaId,
    person: a.person,
    direction: a.direction,
    intro: a.intro,
    question: a.intro === 'chatgpt' ? a.question : '',
    story,
    look: LOOK_ASKED ? a.theme : 'roll',
    mode: a.mode,
    flow: a.intro === 'news' && story ? 'news' : 'who',
  };
}

/** Whether `s` is still the video the record was of — the same person, the
 *  same way, the same intro and mode. A restore waits on the form when the
 *  record is short of an answer (a persona gone, a story that can't be read,
 *  a record from before the answers were kept), and answers changed under it
 *  in the meantime make it a different video, whose words the record's are
 *  not. The question and the story are not compared: a record without them
 *  is the very case that waits. */
export const sameVideo = (s: Vids2Setup, a: Vids2Answers): boolean =>
  s.person.trim().toLowerCase() === a.person.trim().toLowerCase()
  && s.direction === a.direction && s.intro === a.intro && s.mode === a.mode;

/** A record's answers, and what about them is missing. Null for a record that
 *  is not a Vids 2 build at all.
 *
 *  A record written since the answers were kept has them whole. One written
 *  before that has only its clips' names to go on — names written to be read
 *  rather than parsed (bottomAName, bottomANewsName, bottomBName), but they
 *  do say who, which way, which way Pauv was and what kind of intro it had,
 *  and that is most of the form. The question or the story and the mode were
 *  never written down: the mode is set to Serious and the Intro card is left
 *  to answer, and both are said.
 *
 *  On the clipper page, where Mode is not asked (MODE_ASKED), a record made
 *  in any other mode comes back in CLIPPER_MODE, and that is said too. The
 *  record's words, look, sound and BOOMs still come back off it — the BOOMs
 *  at the seconds the record has, as hand-laid ones do, rather than laid
 *  afresh on the new recordings' beats the way a Degen build's are. */
export function answersFromRecord(build: VidBuildSpec): { answers: Vids2Answers; problems: string[] } | null {
  const read = readAnswers(build);
  if (!read || MODE_ASKED || read.answers.mode === CLIPPER_MODE) return read;
  return {
    answers: { ...read.answers, mode: CLIPPER_MODE },
    problems: [...read.problems, `This code was made in ${MODE_NAME[read.answers.mode]} mode; every video here is ${MODE_NAME[CLIPPER_MODE]}, so it comes back as one.`],
  };
}

function readAnswers(build: VidBuildSpec): { answers: Vids2Answers; problems: string[] } | null {
  if (build.vids2) return { answers: build.vids2, problems: [] };
  const trade = build.picks.bottomB?.videoName.match(/^(.+) (up|down) B · Pauv (light|dark)$/);
  if (!trade) return null;
  const [, person, direction, theme] = trade as [string, string, Direction, Theme];
  const a = build.picks.bottomA;
  const intro = a?.videoName.match(/^.+ (?:up|down) A · (ChatGPT|News (.+))$/);
  const kind: Vids2Intro = !a ? 'none' : intro?.[1] === 'ChatGPT' ? 'chatgpt' : intro ? 'news' : 'none';
  const mode: Vids2Mode = MODE_ASKED ? 'serious' : CLIPPER_MODE;
  const problems = [
    `This code was written down before Vids 2 kept its answers, so the mode is set to ${MODE_NAME[mode]}${MODE_ASKED ? ' — change it if it was not' : ''}.`,
  ];
  if (kind === 'chatgpt') problems.push('The question was not written down either: type it again, then press Generate.');
  if (kind === 'news') problems.push(`Nor was the ${intro?.[2] ?? ''} story: find it again, then press Generate.`);
  return {
    answers: { person, direction, intro: kind, question: '', story: null, mode, theme },
    problems,
  };
}

/** The story a record names, read off its outlet again — the same route and
 *  the same checks a pasted link goes through (Vids2Form), for the same
 *  person, so the page's own spelling of them is what gets highlighted.
 *  Refused, with the reason, when the page can no longer be read or never
 *  says them. */
export async function readStoryAgain(person: string, url: string, signal?: AbortSignal): Promise<Vids2Story> {
  const { article, rail, people = [], highlight = null } = await readNewsStory(url, signal, person);
  if (!highlight && !people.some((p) => p.name.trim().toLowerCase() === person.trim().toLowerCase())) {
    throw new Error(`The story never says “${person}”, so there would be no name to drag over.`);
  }
  const hit = withHighlight(hitFromStory(article, people, person), highlight);
  return { name: person, hit, article, rail };
}

// ── Degen mode's BOOMs ───────────────────────────────────────────────────────

/** The bang degen reaches for. (It reached for an "oh hell nah" too, over
 *  their page opening, until 2026-09-18; nothing lays that one by itself now.) */
export type DegenSound = 'fahh';

/** Matched against the file name rather than named outright, so a better take
 *  dropped into public/audio/booms under a near-enough name is picked up and a
 *  tidy-up of the folder doesn't break a build — see /api/vids/boom-sounds. A
 *  sound that isn't in the folder is simply not there: its BOOM still lands on
 *  the picture, silently, rather than not landing at all. */
const DEGEN_SOUND: Record<DegenSound, RegExp> = {
  fahh: /fa+h+/i,
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

/** The BOOMs every degen build gets, in play order — two with an intro, one
 *  without. They are the beats somebody watching would react on: the intro
 *  zooming in and out on their highlighted name (in the ChatGPT answer or the
 *  story), and the money going in. Nothing places them by hand — degen mode
 *  is a switch, not a job — and every one of them can still be taken off on
 *  the bar like any other, because they are ordinary BOOMs once they are
 *  down. Each is the whole thing, hit and all, and every bang plays its own
 *  length wherever it is laid. (Their page opening used to get an "oh hell
 *  nah" of its own, the noise alone — `picture: false` — dropped 2026-09-18;
 *  Insert boom still lays one by hand.) */
export const degenBooms = (b: Vids2Beats): DegenBoom[] => [
  ...(b.introPick == null ? [] : [
    { slot: 'bottomA', at: b.introPick, sound: 'fahh', picture: true, on: 'the zoom on their name' } as const,
  ]),
  { slot: 'bottomB', at: b.tradePlaced, sound: 'fahh', picture: true, on: 'the trade going in' },
];

// ── The people on Pauv ───────────────────────────────────────────────────────

/** The roster, once per page. Everyone listed, with a price or without — the
 *  trade recording needs a price and says so itself if there is none, and a
 *  list that quietly left people out would be the harder thing to explain.
 *  Over a thousand of them, so the dropdown searches rather than scrolls. */
/** One person as the search box needs them: a name to match, a ticker to
 *  file under, and the three figures the list opens sorted on. The route's
 *  slim answer (api/ai/talents?slim=1, lib/talents slimTalent) — the whole
 *  roster is two megabytes of bios nobody here reads. */
export type RosterRow = Pick<TradeTalent, 'id' | 'name' | 'ticker'> & {
  price: Pick<TradeTalent['price'], 'change1dPct' | 'change1wPct' | 'holders'>;
};

let rosterP: Promise<RosterRow[]> | null = null;

export function loadRoster(signal?: AbortSignal): Promise<RosterRow[]> {
  if (!rosterP) {
    rosterP = (async () => {
      // Kept on the server and shared, so this is usually back at once.
      const r = await fetch(withBase('/api/ai/talents?slim=1'));
      const data = await r.json().catch(() => null) as RosterRow[] | { error?: string } | null;
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
  return new Promise<RosterRow[]>((resolve, reject) => {
    const abort = () => reject(new DOMException('Cancelled', 'AbortError'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const cancelled = () => new DOMException('Cancelled', 'AbortError');

// ── The news story, as a Bottom A ────────────────────────────────────────────
// The recording Studio > News makes (components/news/news-video), rendered
// here for this one video: Google with the story as the third result, the
// click, the outlet's page loading, their name dragged over and zoomed in on.
// Its photos are found the way that page finds them (lib/news/client) — free
// ones of the person, the side column's thumbnails — and it is filed on the
// stage the way the ChatGPT recording is (lib/simpler/vidsBottom bottomA*):
// a name to read, a context and three marks for the caption writer.

/** What the clip is called on the stage and in the record an export writes
 *  down. Written to be read; nothing parses it. */
export const bottomANewsName = (person: string, direction: Direction, outlet: string) =>
  `${person} ${direction} A · News ${outlet}`;

/** Its context, in the words a hand-filed Bottom A uses, so the caption writer
 *  and the post-caption writer read it the same way — and read that it is
 *  Google and the outlet, not ChatGPT (api/vids/captions takes Bottom A's
 *  site from here). */
export const bottomANewsContext = (person: string, outlet: string, headline: string) =>
  `google news, searching ${person}, opening the ${outlet} story "${headline}" about them, reading it and highlighting their name`;

/** The captions a news intro carries, and where. Three, one per mark, the way
 *  the ChatGPT recording's are: the first two are these, fixed outright —
 *  Google, then the story being opened and looked through — and the third is
 *  the pick, rolled from BOTTOM_A_PICK (lib/simpler/vidsCaptions) the way it
 *  is on a ChatGPT clip ("lock in trump"). The tuning page puts them in
 *  (vids2Words draftLines); the marks below are what put each on its
 *  moment. */
export const NEWS_BOTTOM_A_LINES: readonly string[] = [
  'look for trending news on google',
  'find someone trending',
];

/** Its marks: three, abutting, so each caption goes up on its moment and
 *  holds to the next (lib/simpler/vidsCaptions onMarks) — Google, from the
 *  top until Google goes off the screen; the story, from there through the
 *  paint and the wheel to the pointer pressing on their name; and the name,
 *  from that press to the end. The first two meet where Google LEAVES, not at
 *  the click: Google stays up for most of a second after the click, and "find
 *  someone trending" is the story's line, not Google's. `leftGoogleAt` and
 *  `nameAt` are the renderer's own (NewsClip), like the beats, in clip
 *  seconds. */
export function bottomANewsMarks(
  beats: NewsBeats, leftGoogleAt: number, nameAt: number, person: string, outlet: string,
): VidMark[] {
  const at = (start: number, end: number) => ({ start: r2(start), end: r2(end) });
  const say = (text: string) => text.slice(0, MAX_MARK_TEXT);
  const left = Math.min(Math.max(leftGoogleAt, beats.loading.start), beats.loading.end);
  const press = Math.min(Math.max(nameAt, left), beats.choosing.end);
  return [
    { ...at(beats.searching.start, left), text: say('looking for trending news on google') },
    { ...at(left, press), text: say(`finding someone trending — opening the ${outlet} story, scrolling it`) },
    { ...at(press, beats.choosing.end), text: say(`highlighting ${person}'s name in the story`) },
  ];
}

export interface NewsClipProgress { stage: 'photos' | 'layout' | 'render'; frac: number | null }

export interface MakeNewsClipOptions {
  /** Who — the name the story was found for, and what gets highlighted. */
  name: string;
  direction: Direction;
  story: Vids2Story;
  signal?: AbortSignal;
  onProgress?: (p: NewsClipProgress) => void;
  /** The clip as it will be filed, bar its bytes and poster, as soon as the
   *  renderer has laid it out — before the first frame (renderNewsVideo
   *  onPlanned). */
  onPlanned?: (meta: LocalClipMeta) => void;
}

/** The news recording for this one video, as a clip the stage, the plan, the
 *  captions and the exporter take like any other. Photos first — the page is
 *  drawn with them, the way "Use this one" does it on the News page — then
 *  the recording, rendered by components/news/news-video, the one home for
 *  it, and held in this tab. `nameAt` is the pointer pressing on their name
 *  and `pulseAt` the first zoom pulse on it once dragged over, both in clip
 *  seconds; `notes` is anything worth telling whoever asked. */
export async function makeNewsClip(
  o: MakeNewsClipOptions,
): Promise<{ row: VidRow; beats: NewsBeats; nameAt: number; pulseAt: number; notes: string[] }> {
  const { article, rail } = o.story;
  const outlet = outletById(article.outlet).name;
  o.onProgress?.({ stage: 'photos', frac: null });
  const found = await findPagePhotos(article, rail, o.name, o.signal);
  const { photoIndex, photos } = await pagePhotosFrom({ article, rail, people: found.people, thumbSrcs: found.thumbSrcs }, 0);
  if (o.signal?.aborted) throw cancelled();
  const notes = [...found.notes];
  if (found.people.length > 0 && photoIndex < 0) notes.push('None of the photos found would load, so the page keeps a placeholder.');

  o.onProgress?.({ stage: 'layout', frac: null });
  const assets = await loadNewsAssets({ name: o.name, namedAs: o.story.hit.namedAs, article, rail, photos }, o.signal);
  if (assets.note) notes.push(assets.note);
  const meta = (p: NewsPlan): LocalClipMeta => ({
    name: bottomANewsName(o.name, o.direction, outlet),
    context: bottomANewsContext(o.name, outlet, article.headline),
    marks: bottomANewsMarks(p.beats, p.leftGoogleAt, p.nameAt, o.name, outlet),
    duration: p.seconds,
    width: p.width,
    height: p.height,
    // Its audio track is the mouse — the click on the story, the drag.
    hasSfx: true,
  });
  const r = await renderNewsVideo(assets, {
    signal: o.signal,
    onProgress: (done, total) => o.onProgress?.({ stage: 'render', frac: done / total }),
    onPlanned: (p) => o.onPlanned?.(meta(p)),
  });
  const row = makeLocalClip(r.blob, { ...meta(r), poster: r.poster });
  return { row, beats: r.beats, nameAt: r.nameAt, pulseAt: r.pulseAt, notes };
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
  `pauv.com, searching ${person}, reading their chart, then trading $${AMOUNT_USD} ${direction} on them`;

/** Its marks: the recording's four beats, written the way a hand-marked clip is
 *  — the caption writer turns each into a line and the layout lands that line
 *  where its beat starts (lib/simpler/vidsCaptions onMarks). Times are the
 *  renderer's own, in clip seconds. Only the third line is the writer's: the
 *  other three are fixed whatever comes back for them (bottomBOpen,
 *  bottomBFixed), so the marks around it are there to steer that one. */
export function bottomBMarks(beats: TradeBeats, person: string, direction: Direction): VidMark[] {
  const at = (s: { start: number; end: number }) => ({ start: r2(s.start), end: r2(s.end) });
  const say = (text: string) => text.slice(0, MAX_MARK_TEXT);
  return [
    { ...at(beats.searching), text: say(`searching ${person} on pauv`) },
    { ...at(beats.analyzing), text: say(`reading ${person}'s price chart`) },
    { ...at(beats.trading), text: say(`putting $${AMOUNT_USD} ${direction} on them`) },
    { ...at(beats.confirming), text: say('the trade goes through') },
  ];
}

// ── The trade's captions ─────────────────────────────────────────────────────
// The trade says the same four things every build, and three of them never
// change: the opener is the address and the search (lib/simpler/vidsCaptions
// bottomBOpen), the chart and the confirmation come off the sets below, one at
// random. The third — the trade itself — is the caption writer's, and it always
// carries the amount in $.

/** Bottom B's second caption — reading their chart. */
export const BOTTOM_B_CHART: readonly string[] = ['check their chart', 'look at the price', 'analyze...'];

/** Bottom B's fourth caption — the trade gone through. */
export const BOTTOM_B_CONFIRM: readonly string[] = ['locked in', 'trade confirmed', 'confirmed', 'order placed'];

/** One of a Bottom B slot's fixed lines at random — null for the opener, which
 *  is bottomBOpen's, and for the trade, which is written. `avoid` is lines
 *  already on the video: Bottom A's pick can land on "locked in" too, and the
 *  same words twice in one video read like a mistake. Nothing is avoided when
 *  that would leave nothing. */
export function bottomBFixed(index: number, avoid: readonly string[] = []): string | null {
  const bank = index === 1 ? BOTTOM_B_CHART : index === 3 ? BOTTOM_B_CONFIRM : null;
  if (!bank) return null;
  const fresh = bank.filter((l) => !avoid.includes(l));
  const from = fresh.length ? fresh : bank;
  return from[Math.floor(Math.random() * from.length)];
}

/** The written trade line, held to its money: kept as written when it has a $
 *  amount in it, and otherwise the plain trade, amount and all — "put $10 up
 *  on ronaldo". */
export const bottomBTrade = (line: string, name: string, direction: Direction): string =>
  (/\$\d/.test(line) ? line : `put $${AMOUNT_USD} ${direction} on ${name || 'them'}`);

export interface TradeClipProgress { stage: 'load' | 'render'; frac: number | null }

export interface MakeTradeClipOptions {
  /** Who, as the roster spells them — matched again inside loadTradeAssets. */
  name: string;
  direction: Direction;
  theme: Theme;
  signal?: AbortSignal;
  onProgress?: (p: TradeClipProgress) => void;
  /** The clip as it will be filed, bar its bytes and poster, and who Pauv
   *  turned out to have, as soon as the renderer has laid it out — before the
   *  first frame (renderTradeVideo onPlanned). */
  onPlanned?: (meta: LocalClipMeta, person: TradeTalent) => void;
  /** How hard the recording pushes in on the trade card — the one thing it
   *  moves for (components/trade/trade-video, "The camera"). A Bottom B plays
   *  in the bottom half of a 9:16 frame, so the trade card is small twice
   *  over; the push is what makes the toggle, the amount and the fee readable
   *  at the size it is actually watched. TRADE_ZOOM unless a caller says
   *  otherwise — the renderer's own default is 'off', which is the still frame
   *  every caller had before there was a camera. */
  zoom?: ZoomLevel;
}

/** What a Vids 2 trade is shot at: the same push Studio > Trade opens on, so
 *  what is previewed there is what gets laid in. */
export const TRADE_ZOOM: ZoomLevel = 'normal';

/** The Pauv trade recording for this one video, as a clip the stage, the plan,
 *  the captions and the exporter take like any other. Rendered by
 *  components/trade/trade-video — the one home for it — and held in this tab. */
export async function makeTradeClip(
  o: MakeTradeClipOptions,
): Promise<{ row: VidRow; person: TradeTalent; beats: TradeBeats }> {
  o.onProgress?.({ stage: 'load', frac: null });
  const assets = await loadTradeAssets(o.name, o.theme, o.signal);
  const person = assets.person.name;
  const meta = (p: { beats: TradeBeats; seconds: number }): LocalClipMeta => ({
    name: bottomBName(person, o.direction, o.theme),
    context: bottomBContext(person, o.direction),
    marks: bottomBMarks(p.beats, person, o.direction),
    duration: p.seconds,
    width: VIDEO_W,
    height: VIDEO_H,
    // Its audio track is the keyboard and the mouse (buildTradeAudio).
    hasSfx: true,
    // Which way Pauv was: what the frame puts either side of the recording
    // where it doesn't fill the bottom half (vidsPlan itemBacking).
    theme: o.theme,
  });
  const zoom = o.zoom ?? TRADE_ZOOM;
  const r = await renderTradeVideo(assets, {
    direction: o.direction,
    zoom,
    signal: o.signal,
    onProgress: (done, total) => o.onProgress?.({ stage: 'render', frac: done / total }),
    onPlanned: (p) => o.onPlanned?.(meta(p), assets.person),
  });
  const row = makeLocalClip(r.blob, { ...meta(r), poster: await tradePoster(assets, o.direction, r.beats, zoom) });
  return { row, person: assets.person, beats: r.beats };
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
  zoom: ZoomLevel,
): Promise<Blob | null> {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = VIDEO_W;
    canvas.height = VIDEO_H;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;
    // Shot the same way as the clip, so the card is the frame the video is
    // on at that moment rather than a different view of it.
    const clip = createTradeClip(ctx, assets, direction, { zoom });
    clip.draw(Math.min(beats.confirming.start + 0.8, Math.max(0, clip.seconds - 0.1)));
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  } catch {
    return null;
  }
}
