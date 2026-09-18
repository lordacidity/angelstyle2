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
import { withBase } from '@/lib/clipping';
import {
  AMOUNT_USD, createTradeClip, loadTradeAssets, renderTradeVideo, VIDEO_H, VIDEO_W,
  type Direction, type Theme, type TradeBeats, type TradeTalent,
} from '@/app/components/trade/trade-video';
import {
  findPagePhotos, isNewsRange, isTrendSort, isTrendWindow, pagePhotosFrom,
  type NewsRange, type TrendSort, type TrendWindow,
} from '@/lib/news/client';
import { isOutletId, outletById } from '@/lib/news/outlets';
import type { NewsArticle, NewsHit, RailItem } from '@/lib/news/types';
import type { BoomSound } from '@/lib/simpler/vidsAudio';
import { makeLocalClip, type LocalClipMeta } from '@/lib/simpler/vidsLocal';
import { MAX_MARK_TEXT, type VidMark, type VidRow } from '@/lib/vids-types';
import type { Vids2Early } from './vids2Words';

export type { Direction, NewsRange, Theme, TradeTalent, TrendSort, TrendWindow };

// ── The answers ──────────────────────────────────────────────────────────────

/** How the video talks: Serious, Middle or Degen. Each writes the hook to its
 *  own guide in api/vids/hook: Serious a flat trade, reason and what the money
 *  is for; Middle two of a money analogy, what the persona is doing and the
 *  trade; Degen a descriptor, the trade, a nickname and a bracket. Degen also
 *  lays three BOOMs over the recordings (degenBooms), and the song rolled for
 *  it may be one marked degen on the Music page, which no other build ever
 *  rolls (rollableMusic in Vids2Builder). The video underneath is exactly the
 *  same video in all three. */
export type Vids2Mode = 'serious' | 'middle' | 'degen';
export const VIDS2_MODES: readonly Vids2Mode[] = ['serious', 'middle', 'degen'];
export const isVids2Mode = (v: unknown): v is Vids2Mode =>
  typeof v === 'string' && (VIDS2_MODES as readonly string[]).includes(v);

/** What opens the video — the first screen recording, Bottom A. None: there
 *  isn't one, and the video goes straight to trading on them on Pauv.
 *  ChatGPT: the question typed in and them picked off the answer. News: a
 *  real story about them found on Google News, opened and read, with their
 *  name dragged over — the recording Studio > News makes. */
export type Vids2Intro = 'none' | 'chatgpt' | 'news';
export const VIDS2_INTROS: readonly Vids2Intro[] = ['none', 'chatgpt', 'news'];
export const isVids2Intro = (v: unknown): v is Vids2Intro =>
  typeof v === 'string' && (VIDS2_INTROS as readonly string[]).includes(v);

/** Which end the form starts from. Who: the person first, the intro last —
 *  five questions. News: the other way round — it opens on the stories going
 *  out right now that name somebody on Pauv (lib/news/trending), and picking
 *  one answers Who and the intro both, so what is left is which way, the mode
 *  and the persona. A news-flow setup always has a news intro. */
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
  /** Serious, Middle or Degen — see Vids2Mode. */
  mode: Vids2Mode;
  /** Which end the form starts from — see Vids2Flow. */
  flow: Vids2Flow;
  /** How far back the news flow's trending list looks. */
  trendWindow: TrendWindow;
  /** Whether that list leaves politics out. */
  hidePolitics: boolean;
  /** Its order: the biggest stories first — the AI's read of what would stop
   *  somebody scrolling — or the newest. */
  trendSort: TrendSort;
}

export const EMPTY_SETUP: Vids2Setup = {
  personaId: null, person: '', direction: 'up',
  intro: 'chatgpt', question: '', newsRange: '7d', story: null, mode: 'serious',
  flow: 'who', trendWindow: '24h', hidePolitics: false, trendSort: 'hot',
};

/** Which way Pauv is in the trade recording: not asked, rolled at even odds on
 *  every Generate, so builds spread across the two the way they spread across
 *  songs and caption looks. The ChatGPT recording is dark whatever comes up —
 *  that page has no light mode in the renderer. */
export const rollTheme = (): Theme => (Math.random() < 0.5 ? 'light' : 'dark');

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
    // A saved `theme` is from when Look was a question; it is simply not read.
    const j = JSON.parse(raw) as Partial<Record<keyof Vids2Setup | 'degen', unknown>>;
    const flow = isVids2Flow(j.flow) ? j.flow : 'who';
    return {
      personaId: typeof j.personaId === 'string' ? j.personaId : null,
      person: typeof j.person === 'string' ? j.person : '',
      direction: j.direction === 'down' ? 'down' : 'up',
      // Answers saved before there was a choice of intro were ChatGPT ones.
      // The news flow has no intro question: its intro is the story.
      intro: flow === 'news' ? 'news' : isVids2Intro(j.intro) ? j.intro : 'chatgpt',
      question: typeof j.question === 'string' ? j.question : '',
      newsRange: isNewsRange(j.newsRange) ? j.newsRange : EMPTY_SETUP.newsRange,
      story: isStory(j.story) ? j.story : null,
      // Answers saved before there were three modes had a degen switch.
      mode: isVids2Mode(j.mode) ? j.mode : j.degen === true ? 'degen' : 'serious',
      flow,
      trendWindow: isTrendWindow(j.trendWindow) ? j.trendWindow : EMPTY_SETUP.trendWindow,
      hidePolitics: j.hidePolitics === true,
      trendSort: isTrendSort(j.trendSort) ? j.trendSort : EMPTY_SETUP.trendSort,
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
  s.intro === 'none' ? true
    : s.intro === 'chatgpt' ? !!s.question.trim()
    : !!storyFor(s);

/** Whether the form has been answered enough to press Generate. A persona with
 *  no clips is caught later, by the stage having nothing on it. */
export const setupReady = (s: Vids2Setup): boolean =>
  !!s.personaId && !!s.person.trim() && introReady(s);

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

/** The BOOMs every degen build gets, in play order — three with an intro, two
 *  without. They are the beats somebody watching would react on: the intro
 *  zooming in and out on their highlighted name (in the ChatGPT answer or the
 *  story), their page coming up, and the money going in. Nothing places them
 *  by hand — degen mode is a switch, not a job — and every one of them can
 *  still be taken off on the bar like any other, because they are ordinary
 *  BOOMs once they are down.
 *
 *  The middle one is its noise and nothing else (`picture: false`). The oh hell
 *  nah runs for several seconds, far longer than a BOOM is ever on screen, and
 *  it is a reaction TO what is on the screen — their page coming up — so it
 *  plays out in full over that page instead of covering it. The two fahhs are
 *  the whole thing, hit and all. Every bang plays its own length wherever it
 *  is laid, and two that run into each other simply both play. */
export const degenBooms = (b: Vids2Beats): DegenBoom[] => [
  ...(b.introPick == null ? [] : [
    { slot: 'bottomA', at: b.introPick, sound: 'fahh', picture: true, on: 'the zoom on their name' } as const,
  ]),
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
      const r = await fetch(withBase('/api/ai/talents'));
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
}

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
  const r = await renderTradeVideo(assets, {
    direction: o.direction,
    signal: o.signal,
    onProgress: (done, total) => o.onProgress?.({ stage: 'render', frac: done / total }),
    onPlanned: (p) => o.onPlanned?.(meta(p), assets.person),
  });
  const row = makeLocalClip(r.blob, { ...meta(r), poster: await tradePoster(assets, o.direction, r.beats) });
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
