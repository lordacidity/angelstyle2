'use client';

// Vids2Form — the cards, top to bottom, and one Generate button.
//
// The whole of the first page. Nothing is on the stage yet, so the page is
// the answers a video is made from, laid out as cards in the order they are
// asked:
//
//   1. Who        somebody on Pauv. Two ways in, as tabs on the card: a name
//                 (a search of the whole roster, opened on who is moving on
//                 Pauv, the suggested few starred in gold at the top), or
//                 the news — every fresh headline from the approved outlets
//                 that names somebody on Pauv, read as soon as the tab is
//                 opened. Picking a story answers Who AND the intro.
//   2. Intro      what opens the video: nothing, ChatGPT and a question, or
//                 a news story about them (searched for the moment News is
//                 pressed, or a pasted link).
//   3. Which way  up or down.
//   4. Look       Random, Light or Dark — which way Pauv comes up in the
//                 trade recording. Studio only (LOOK_ASKED).
//   5. Mode       Serious, Middle or Degen — how the video talks. Studio
//                 only (MODE_ASKED): the clipper page makes Middle videos
//                 (CLIPPER_MODE).
//   6. Persona    the three clips around the trade, as tiles.
//
// So the Studio's form is six cards and the clipper page's is four. The two
// that are not asked there are not blank answers: they are 'roll' and
// CLIPPER_MODE in the setup (lib/vids2/vids2Build), which is what the card
// would have said on its own.
//
// One card is open at a time and it is always the next thing to do. Cards
// above it are folded to their answer (press one to change it); cards below
// are dim until the form gets there. Pressing an answer IS the answer: a
// name, a story, Up, Dark, Degen, a persona tile — each moves the form on by
// itself. Only the two things that are typed (the ChatGPT question, a story
// found for somebody already chosen) wait for Continue, and a story picked
// off a list does not. Which way, Look and Mode have a default, but they are
// still asked once each; on a return visit every answer is already there,
// every card is folded, and Generate is lit.
//
// Generate is at the foot of the page, always in view — a row of its own
// under the cards rather than the end of them, so however far down the cards
// are scrolled, and whatever a phone's browser bars are doing, it is on the
// screen. Lit only when every card is answered. While it runs it is the
// progress bar.
//
// The order is what each recording waits on, soonest first: the intro
// recording needs Who and Intro, the trade recording Who, Which way and the
// Look. Each is started the moment its last answer lands (onHeadStart — the
// head start in Vids2Section), while the rest of the cards are still being
// answered, and a small pill on that card says how it is getting on. The
// trade sets off at Which way with the Look as it stands (rolled, to begin
// with) and only starts again if the Look card then says otherwise, so
// pressing Random costs nothing.
//
// Everything a card does with the network — the roster, the trending list,
// a story searched for or read off its outlet, a question written by the
// model — is unchanged from before this page was redrawn; only the page is.

import { useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { PERSONA_PARTS, type VidPersona, type VidRow } from '@/lib/vids-types';
import { writeQuestion, type QuestionKind } from '@/lib/vids-client';
import {
  INTROS_OFFERED, LOOK_ASKED, MODE_ASKED, VIDS2_LOOKS, VIDS2_MODES, introReady, loadRoster, lower, setupReady,
  storyFor, type Direction, type NewsRange, type RosterRow, type TrendWindow, type Vids2Intro,
  type Vids2Look, type Vids2Mode, type Vids2Setup,
} from '@/lib/vids2/vids2Build';
import {
  ago, drawNewsPage, errorText, hitFromStory, loadNewsCategories, loadTrending, matchesCategory,
  NEWS_RANGES, normalCategory, pastedLinkProblem, readCategory, readNewsStory, withHighlight,
  searchNews, sortTrending, TREND_SORTS, TREND_WINDOWS,
} from '@/lib/news/client';
import { OUTLET_IDS, OUTLETS, outletById } from '@/lib/news/outlets';
import type { NamedPerson, NewsCategory, NewsHit, OutletId, TrendingHit } from '@/lib/news/types';
import { SpinnerIcon, VideoIcon } from '@/lib/icons';

// ── Labels ──────────────────────────────────────────────────────────────────

const DIRECTIONS: readonly Direction[] = ['up', 'down'];
const DIRECTION_LABEL: Record<Direction, string> = { up: '📈 Up', down: '📉 Down' };
const DIRECTION_ON: Record<Direction, string> = {
  up: 'border-emerald-500 bg-emerald-500/15 text-emerald-300',
  down: 'border-red-500 bg-red-500/15 text-red-300',
};
const LOOK_LABEL: Record<Vids2Look, string> = { roll: '🎲 Random', light: '☀️ Light', dark: '🌙 Dark' };
const LOOK_ON: Record<Vids2Look, string> = {
  roll: 'border-zinc-300 bg-white/10 text-white',
  light: 'border-amber-200 bg-amber-100/15 text-amber-100',
  dark: 'border-indigo-400 bg-indigo-500/15 text-indigo-200',
};
const MODE_LABEL: Record<Vids2Mode, string> = { serious: '👔 Serious', middle: '😐 Middle', degen: '💀 Degen' };
const MODE_ON: Record<Vids2Mode, string> = {
  serious: 'border-sky-500 bg-sky-500/15 text-sky-200',
  middle: 'border-zinc-300 bg-white/10 text-white',
  degen: 'border-amber-500 bg-amber-500/15 text-amber-200',
};
const INTRO_LABEL: Record<Vids2Intro, string> = { none: '⏭️ No intro', chatgpt: '💬 ChatGPT', news: '📰 News' };
const INTRO_ON: Record<Vids2Intro, string> = {
  none: 'border-zinc-300 bg-white/10 text-white',
  chatgpt: 'border-emerald-500 bg-emerald-500/15 text-emerald-200',
  news: 'border-sky-500 bg-sky-500/15 text-sky-200',
};
/** The two ways the model will write the question — see api/vids/question. */
const QUESTION_KINDS: readonly QuestionKind[] = ['ragebait', 'factual'];
const QUESTION_LABEL: Record<QuestionKind, string> = { ragebait: '✨ Ragebait', factual: '✨ Factual' };
const QUESTION_HINT: Record<QuestionKind, string> = {
  ragebait: 'The extreme opposite of how they are actually rated, so ChatGPT naming them makes no sense at all',
  factual: 'A plain question they would genuinely come up in',
};
const WINDOW_LABEL: Record<TrendWindow, string> = { '1h': '1h', '6h': '6h', '24h': '24h', '7d': '1wk' };
const WINDOW_LONG: Record<TrendWindow, string> = { '1h': 'past hour', '6h': 'past 6 hours', '24h': 'past 24 hours', '7d': 'past week' };
const RANGE_LABEL: Record<NewsRange, string> = { '1d': 'Today', '7d': 'This week', '30d': 'This month', any: 'Any time' };
const SORT_LABEL = { hot: '🔥 Biggest', new: '🕒 Newest' } as const;

const mag = (v: number | null | undefined) => Math.abs(v ?? 0);
/** Who is moving on Pauv: today's change first, then the week's, then how
 *  many hold them — so the search opens on who is trending rather than on
 *  the As. */
function byTrending(a: RosterRow, b: RosterRow): number {
  return mag(b.price.change1dPct) - mag(a.price.change1dPct)
    || mag(b.price.change1wPct) - mag(a.price.change1wPct)
    || (b.price.holders ?? 0) - (a.price.holders ?? 0)
    || a.name.localeCompare(b.name);
}
/** Today's change as the row says it: +12.4%, −3.1%, or nothing to say. */
const changeText = (v: number | null | undefined): string | null =>
  (v == null ? null : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`);

/** How many of the roster the dropdown will draw at once. Everyone is in the
 *  list and everyone can be found by typing; this is only how many rows exist
 *  on the page before you have narrowed it down. */
const MAX_ROWS = 60;
/** How many of the trending list are shown. The route sends more than this,
 *  so hiding politics still leaves a full list. */
const TREND_ROWS = 20;
/** Under this many rows left after a category is typed, the form offers to ask
 *  Google for the category itself instead (lib/news/categories). */
const WIDEN_UNDER = 5;

// ── The steps ────────────────────────────────────────────────────────────────

type StepId = 'who' | 'intro' | 'direction' | 'look' | 'mode' | 'persona';
interface Step {
  id: StepId;
  label: string;
  /** Has an answer from the start (a default), but is still asked once: the
   *  card opens on the way down and one press answers it. */
  askOnce: boolean;
  /** Whether this build's form has the card at all. Look and Mode are the
   *  Studio's alone — see LOOK_ASKED and MODE_ASKED in lib/vids2. */
  asked: boolean;
}
const EVERY_STEP: readonly Step[] = [
  { id: 'who', label: 'Who', askOnce: false, asked: true },
  { id: 'intro', label: 'Intro', askOnce: false, asked: true },
  { id: 'direction', label: 'Which way', askOnce: true, asked: true },
  { id: 'look', label: 'Look', askOnce: true, asked: LOOK_ASKED },
  { id: 'mode', label: 'Mode', askOnce: true, asked: MODE_ASKED },
  { id: 'persona', label: 'Persona', askOnce: false, asked: true },
];
/** This build's cards, in order: six in the Studio, four on the clipper page. */
const STEPS: readonly Step[] = EVERY_STEP.filter((s) => s.asked);
const LAST = STEPS.length - 1;
/** Where a card sits on this build's form; -1 for one it hasn't got, which
 *  nothing then asks for. */
const at = (id: StepId) => STEPS.findIndex((s) => s.id === id);
const WHO = at('who'), INTRO = at('intro'), DIRECTION = at('direction'), LOOK = at('look'), MODE = at('mode'), PERSONA = at('persona');
/** The card the trade recording's head start shows its line on — the last
 *  of the answers it waits on. */
const TRADE_CARD: StepId = LOOK_ASKED ? 'look' : 'direction';

/** Somebody a chosen story names, and whether its headline is where. */
type StoryChoice = NamedPerson & { inHeadline: boolean };

/** A result as the answers keep it, for whichever of the story's people it is
 *  being used for: the headline names them or it doesn't, and the recording
 *  drags over that. Anything a trending row carried beyond a result is left. */
const hitFor = (h: NewsHit, p: StoryChoice): NewsHit => ({
  outlet: h.outlet, title: h.title, publishedAt: h.publishedAt, link: h.link, url: h.url,
  named: p.inHeadline, ...(p.inHeadline ? { namedAs: p.name } : {}),
});

/** One of the recordings, while it is being made. */
export interface Vids2Leg {
  label: string;
  /** 0..1 where there is a share to count, null while there is not — the model
   *  thinking, the roster loading and the photos arriving have no frames. */
  frac: number | null;
  done: boolean;
}

/** How the build is getting on. The recordings are made at once — neither
 *  needs anything from the other — so there is no step 1 and step 2, only two
 *  things running; one, with no intro. Null when nothing is being made. */
export interface Vids2Job { intro: Vids2Leg | null; trade: Vids2Leg }

/** The legs there are, in play order. */
export const jobLegs = (j: Vids2Job): Vids2Leg[] => [j.intro, j.trade].filter((l): l is Vids2Leg => !!l);

/** The legs as one share, for the bar: a finished leg counts whole, and one
 *  with nothing to count yet counts as nothing. */
export const jobProgress = (j: Vids2Job): number => {
  const legs = jobLegs(j);
  return legs.reduce((sum, leg) => sum + (leg.done ? 1 : leg.frac ?? 0), 0) / legs.length;
};

interface Props {
  setup: Vids2Setup;
  onChange: (next: Vids2Setup) => void;
  personas: VidPersona[];
  resolveVideo: (id: string) => VidRow | undefined;
  libraryLoaded: boolean;
  /** The few names starred in gold at the top of the search — set on Studio
   *  > Vids > Clippers. Empty is fine: the search is the whole roster either
   *  way, and these are a shortcut to it, never a limit on it. */
  suggested: readonly string[];
  job: Vids2Job | null;
  jobError: string | null;
  /** The recordings already being made, before Generate — the head start in
   *  Vids2Section. Null where nothing is going. */
  warm: { intro: Vids2Leg | null; trade: Vids2Leg | null };
  /** An answer has landed, so what it was the last of can start rendering:
   *  the intro once the intro is answered, the trade once which way is (and
   *  again if the Look card then changes the theme — the section keys each
   *  run on its answers, so the same answers twice is one run). The answers
   *  go with it as they are at that moment — the section's own copy is a
   *  render behind whatever has just been pressed. */
  onHeadStart: (what: 'intro' | 'trade', from: Vids2Setup) => void;
  onGenerate: () => void;
  onCancel: () => void;
}

// ── Bits of page ─────────────────────────────────────────────────────────────

/** Something a keyboard comes up for: a box you type in. A slider, a button
 *  or a select is not one. */
export function isTextBox(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea') return true;
  return tag === 'input' && !['range', 'checkbox', 'radio', 'button', 'submit', 'file', 'color'].includes((el as HTMLInputElement).type);
}

const PRIMARY = 'rounded-xl bg-white font-semibold text-black transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-white';
const INPUT = 'w-full rounded-xl border border-zinc-800 bg-black text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500 disabled:opacity-50';
const pill = (on: boolean) =>
  `h-7 shrink-0 rounded-md border px-2 text-[11px] font-semibold transition-colors disabled:opacity-40 ${
    on ? 'border-zinc-300 bg-white/10 text-white' : 'border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-white'
  }`;

/** Big answers side by side. Pressing one is the answer. `value` null lights
 *  none of them — a question that has a default but has not been asked yet. */
function Choice<T extends string>({ options, value, disabled, onPick, tall }: {
  options: readonly { value: T; label: string; on: string }[];
  value: T | null;
  disabled: boolean;
  onPick: (value: T) => void;
  tall?: boolean;
}) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onPick(o.value)}
          className={`${tall ? 'h-12 text-base' : 'h-11 text-sm'} rounded-xl border font-semibold transition-colors disabled:opacity-50 ${
            value === o.value ? o.on : 'border-zinc-800 bg-black text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function OutletTag({ id }: { id: OutletId }) {
  const o = outletById(id);
  return (
    <span className="mt-0.5 shrink-0 rounded px-1.5 py-px text-[10px] font-bold text-white" style={{ background: o.color }}>
      {o.short ?? o.name}
    </span>
  );
}

/** How a recording started ahead of Generate is getting on — on the card
 *  whose answer set it going. */
function LegPill({ leg }: { leg: Vids2Leg }) {
  return (
    <span
      title={leg.label}
      className={`flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${
        leg.done ? 'border-emerald-800 bg-emerald-950/40 text-emerald-300' : 'border-zinc-800 text-zinc-400'
      }`}
    >
      {leg.done ? '✓ Ready' : (
        <>
          <SpinnerIcon size={9} className="animate-spin" />
          {leg.frac != null ? `${Math.round(leg.frac * 100)}%` : ''}
        </>
      )}
    </span>
  );
}

/** A link pasted in instead of a story found: any article page on an approved
 *  outlet. What is wrong with it is said as it is typed (pastedLinkProblem). */
function PasteLink({ disabled, reading, onUse }: {
  disabled: boolean;
  /** The link being read right now, whoever asked. */
  reading: string | null;
  onUse: (url: string) => void;
}) {
  const [link, setLink] = useState('');
  const url = link.trim();
  const problem = url ? pastedLinkProblem(url) : null;
  const can = !!url && !problem && !disabled && reading === null;
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (can) onUse(url); } }}
          disabled={disabled}
          placeholder="🔗 Or paste an article link…"
          title={`Any article on ${OUTLETS.map((o) => o.name).join(', ')}`}
          spellCheck={false}
          autoComplete="off"
          className={`${INPUT} h-9 min-w-0 flex-1 px-3 text-[13px]`}
        />
        <button
          type="button"
          onClick={() => onUse(url)}
          disabled={!can}
          className={`${PRIMARY} h-9 shrink-0 px-3.5 text-[13px]`}
        >
          {reading !== null && reading === url ? 'Reading…' : 'Use'}
        </button>
      </div>
      {problem && <p className="mt-1 text-xs text-amber-300/90">{problem}</p>}
    </div>
  );
}

// ── The form ─────────────────────────────────────────────────────────────────

export function Vids2Form({
  setup, onChange, personas, resolveVideo, libraryLoaded, suggested, job, jobError, warm, onHeadStart,
  onGenerate, onCancel,
}: Props) {
  const busy = !!job;
  const who = setup.person.trim();
  const persona = personas.find((p) => p.id === setup.personaId) ?? null;
  /** The story chosen for THIS person — one chosen and then Who changed is
   *  about somebody else, and doesn't count (storyFor). */
  const story = storyFor(setup);

  // The answers as they stand now, for whatever lands after an await — a
  // story read off the outlet arrives seconds after it was asked for, and
  // must not put back an answer changed in between. Kept a step ahead of the
  // prop: `commit` writes it before React has re-rendered, so two changes in
  // one handler see each other.
  const setupRef = useRef(setup);
  useEffect(() => { setupRef.current = setup; });
  const commit = (next: Vids2Setup) => { setupRef.current = next; onChange(next); };
  const patch = (next: Partial<Vids2Setup>) => commit({ ...setupRef.current, ...next });

  // Which end the answers were reached from is still written down (flow) —
  // Generate checks it — but it is no longer a question. It is whichever way
  // Who was answered, and 'who' until it has been.
  useEffect(() => {
    if (setup.flow) return;
    patch({ flow: setup.intro === 'news' && storyFor(setup) ? 'news' : 'who' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup.flow]);

  // ── Which card is open ──────────────────────────────────────────────────────
  // `open` is the card being answered; null when every answer is in. `furthest`
  // is how far down the form has got: cards past it are dim. `touched` is which
  // of the ask-once questions have been pressed — they have a default, so
  // "answered" alone would skip them. A return visit with answers saved
  // (there is a person) counts everything as reached and pressed: the answers
  // are all there to be changed.
  const restored = !!setup.person.trim();
  const answeredIn = (id: StepId, s: Vids2Setup): boolean => {
    switch (id) {
      case 'who': return !!s.person.trim();
      case 'intro': return introReady(s);
      // Until the library is here, the saved id is taken at its word; once it
      // is, the persona has to actually be in it.
      case 'persona': return libraryLoaded ? personas.some((p) => p.id === s.personaId) : !!s.personaId;
      default: return true;
    }
  };
  const needsIn = (i: number, s: Vids2Setup, t: ReadonlySet<StepId>): boolean =>
    !answeredIn(STEPS[i].id, s) || (STEPS[i].askOnce && !t.has(STEPS[i].id));
  const firstNeeding = (after: number, s: Vids2Setup, t: ReadonlySet<StepId>): number | null => {
    const j = STEPS.findIndex((_, k) => k > after && needsIn(k, s, t));
    return j === -1 ? null : j;
  };

  const [touched, setTouched] = useState<Set<StepId>>(() => new Set(restored ? STEPS.map((s) => s.id) : []));
  const [furthest, setFurthest] = useState(() => (restored ? LAST : 0));
  const [open, setOpen] = useState<number | null>(() => firstNeeding(-1, setup, restored ? new Set(STEPS.map((s) => s.id)) : new Set()));
  const answered = (id: StepId) => answeredIn(id, setup);

  const touch = (id: StepId): Set<StepId> => {
    const t = new Set(touched);
    t.add(id);
    setTouched(t);
    return t;
  };
  /** An answer landed on card `from`: open the next card that still needs
   *  one, or none when every answer is in. `next` is the answers as they are
   *  with it — the prop is a render behind. */
  const advance = (from: number, next: Vids2Setup, t: ReadonlySet<StepId> = touched) => {
    const j = firstNeeding(from, next, t);
    setOpen(j);
    setFurthest((f) => Math.max(f, j ?? LAST));
  };
  /** Nothing open and something still unanswered — the library arrived
   *  without the saved persona, say — opens that card. */
  const stillNeeding = open === null ? firstNeeding(-1, setup, touched) : null;
  useEffect(() => {
    if (open === null && stillNeeding !== null) setOpen(stillNeeding);
  }, [open, stillNeeding]);
  /** A folded card pressed is opened; the open card pressed is folded, if it
   *  has an answer to fold to. */
  const toggle = (i: number) => {
    if (open === i) { if (answered(STEPS[i].id)) setOpen(null); return; }
    setOpen(i);
  };

  // The card that has just opened is brought into view — bar the first, which
  // is where the page opens anyway.
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  const firstScroll = useRef(true);
  useEffect(() => {
    if (firstScroll.current) { firstScroll.current = false; return; }
    if (open === null) return;
    const el = cardRefs.current[open];
    const id = window.requestAnimationFrame(() => el?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  // ── The roster ──────────────────────────────────────────────────────────────
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [rosterError, setRosterError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadRoster()
      .then((r) => { if (alive) { setRoster(r); setRosterError(null); } })
      .catch((e: unknown) => { if (alive) setRosterError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, []);
  /** The roster's spelling of somebody the news side named — the same table,
   *  but it is the roster's that the trade recording is matched against. */
  const rosterName = (p: NamedPerson) => roster.find((t) => t.ticker === p.ticker)?.name ?? p.name;

  // ── Who: by name ────────────────────────────────────────────────────────────
  /** Which tab of the Who card is up: a name, or the news. */
  const [source, setSource] = useState<'name' | 'trending'>('name');
  const [query, setQuery] = useState(setup.person);
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  // The box reading as whoever is chosen is not somebody narrowing the list
  // down, so pressing it shows everyone rather than just them.
  const needle = query.trim().toLowerCase();
  const ranked = useMemo(() => [...roster].sort(byTrending), [roster]);
  const matches = useMemo(() => {
    if (!needle || needle === setup.person.trim().toLowerCase()) return ranked;
    return ranked.filter((t) => t.name.toLowerCase().includes(needle));
  }, [ranked, needle, setup.person]);
  /** The suggested names first, gold and starred, then the rest of the
   *  matches — one list, so the arrow keys walk the whole of it. */
  const shown = useMemo(() => {
    const star = new Set(suggested.map((n) => n.toLowerCase()));
    const starred = matches.filter((t) => star.has(t.name.toLowerCase()));
    const rest = matches.filter((t) => !star.has(t.name.toLowerCase())).slice(0, MAX_ROWS);
    return [...starred.map((t) => ({ t, star: true })), ...rest.map((t) => ({ t, star: false }))];
  }, [matches, suggested]);
  useEffect(() => { setQuery(setup.person); }, [setup.person]);
  const closeList = () => { setListOpen(false); setQuery(setup.person); };

  /** The answer to Who, by name: picked out of the list, or pressed straight
   *  off the suggestions. Either is the answer, and the form moves on. */
  const chooseName = (name: string) => {
    const next: Vids2Setup = { ...setupRef.current, person: name, flow: 'who' };
    commit(next);
    setQuery(name);
    setListOpen(false);
    advance(WHO, next);
  };
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!listOpen) { setListOpen(true); setActive(0); return; }
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (shown.length ? (i + dir + shown.length) % shown.length : 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (listOpen && shown[active]) chooseName(shown[active].t.name);
      return;
    }
    if (e.key === 'Escape' && listOpen) { e.preventDefault(); closeList(); }
  };
  useEffect(() => {
    if (listOpen) listRef.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' });
  }, [active, listOpen]);

  // ── Intro: the question, written ────────────────────────────────────────────
  // Two buttons, one model call each, straight into the box: whichever comes
  // back is a draft like any other, to be used, edited, or thrown away by
  // pressing the other one, and it arrives lower case because that is how a
  // search bar is typed into.
  const [writingKind, setWritingKind] = useState<QuestionKind | null>(null);
  const [written, setWritten] = useState<{ kind: QuestionKind; text: string } | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const chosenKind = written && written.text === setup.question ? written.kind : null;
  const writeRef = useRef<AbortController | null>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => () => writeRef.current?.abort(), []);

  const suggest = async (kind: QuestionKind) => {
    if (!who || writingKind) return;
    writeRef.current?.abort();
    const ctrl = new AbortController();
    writeRef.current = ctrl;
    setWritingKind(kind);
    setWriteError(null);
    try {
      // Which way the video trades is deliberately not sent: the question is
      // about who they are, and nothing else.
      const { question } = await writeQuestion({ person: who, kind }, ctrl.signal);
      if (ctrl.signal.aborted) return;
      const text = lower(question);
      patch({ question: text });
      setWritten({ kind, text });
      questionRef.current?.focus();
    } catch (e) {
      if (ctrl.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      setWriteError(e instanceof Error ? e.message : String(e));
    } finally {
      if (writeRef.current === ctrl) { writeRef.current = null; setWritingKind(null); }
    }
  };

  /** The intro pressed. No intro is the whole answer; the other two open
   *  what they need underneath. A saved 'news' flow makes the intro News
   *  again on reload (loadSetup), so anything else puts the flow back. */
  const pickIntro = (intro: Vids2Intro) => {
    const next: Vids2Setup = { ...setupRef.current, intro, flow: intro === 'news' ? setupRef.current.flow ?? 'who' : 'who' };
    commit(next);
    if (intro === 'none') { onHeadStart('intro', next); advance(INTRO, next); }
  };
  /** Continue, on a typed question or a story already chosen: the intro is
   *  answered, its recording can start. */
  const continueIntro = () => {
    const next = setupRef.current;
    if (!introReady(next)) return;
    onHeadStart('intro', next);
    advance(INTRO, next);
  };

  // ── The news story ──────────────────────────────────────────────────────────
  // The News page's own errand, from lib/news/client: Google News for the
  // name, every approved outlet, as far back as the range says; pick a
  // result and the story is read off the outlet and checked — a story with
  // no headline, byline, date or paragraphs is refused with the reason — and
  // goes into the answers. What was found is this page's alone: Who changing
  // empties the list, since it was about somebody else.
  const [found, setFound] = useState<{ name: string; range: NewsRange; hits: NewsHit[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Every result, to start. A headline is not where a story has to say who
  // it is about; narrowing to the headline is a press away.
  const [nameInTitle, setNameInTitle] = useState(false);
  const searchRef = useRef<AbortController | null>(null);
  /** The result being read, by its url. */
  const [reading, setReading] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const readRef = useRef<AbortController | null>(null);
  useEffect(() => () => { searchRef.current?.abort(); readRef.current?.abort(); }, []);
  useEffect(() => { setFound(null); setSearchError(null); setReadError(null); }, [setup.person]);

  const searchStories = async (range: NewsRange = setupRef.current.newsRange) => {
    const name = setupRef.current.person.trim();
    if (!name) return;
    searchRef.current?.abort();
    const ctrl = new AbortController();
    searchRef.current = ctrl;
    setSearching(true);
    setSearchError(null);
    try {
      const { hits } = await searchNews(name, OUTLET_IDS, range, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setFound({ name, range, hits });
    } catch (e) {
      if (!ctrl.signal.aborted) setSearchError(errorText(e));
    } finally {
      if (searchRef.current === ctrl) { searchRef.current = null; setSearching(false); }
    }
  };
  // News pressed for somebody with no story yet: the search goes out by
  // itself rather than waiting to be asked for — there is nothing else to do
  // on the card until it is back.
  const introOpen = open === INTRO;
  useEffect(() => {
    if (!introOpen || setup.intro !== 'news' || !who || story || searching || searchError) return;
    if (found && found.name === who && found.range === setup.newsRange) return;
    void searchStories(setup.newsRange);
  }, [introOpen, setup.intro, setup.newsRange, who, story, searching, searchError, found]);

  /** Who the chosen story names, when the story is what chose the person.
   *  More than one and the form asks which. */
  const [storyPeople, setStoryPeople] = useState<StoryChoice[]>([]);
  /** The story named more than one person, and the form is asking which. */
  const [askPerson, setAskPerson] = useState<StoryChoice[] | null>(null);

  /** Read a story off its outlet and make it the answer. `link` is a search
   *  result's, a trending row's or one pasted in by hand — the key it is read
   *  under, for the spinner. With Who already answered (`byStory` false — a
   *  story searched for them, or a link pasted on the Intro card) the story is
   *  for them and has to say their name. From the news tab (`byStory` true)
   *  it is the other way round: the story says who — `from`'s headline names,
   *  then whoever else on Pauv the story itself turns out to name. */
  const readStory = async (link: string, o: { hit?: NewsHit; from?: TrendingHit; byStory: boolean }) => {
    readRef.current?.abort();
    const ctrl = new AbortController();
    readRef.current = ctrl;
    setReading(link);
    setReadError(null);
    try {
      // Who the page is for, when that is known before it is read: the person
      // answered, or the trending row's first. The answer then says how the
      // page spells them — the recording drags over that, so a Times page
      // that says "Kennedy" for RFK Jr. has a name on it to drag to.
      const forName = o.byStory ? (o.from?.people[0]?.name ?? '') : setupRef.current.person.trim();
      const { article, rail, people = [], highlight = null } = await readNewsStory(link, ctrl.signal, forName);
      if (ctrl.signal.aborted) return;
      if (!o.byStory) {
        const name = setupRef.current.person.trim();
        // The page has to say their name somewhere — the recording drags over
        // it, and a story that never says it, in full or as the press writes
        // it, has nothing to drag to.
        if (!highlight && !people.some((p) => p.name.trim().toLowerCase() === name.toLowerCase())) {
          throw new Error(`That story never says “${name}”, so there would be no name to drag over. Try another.`);
        }
        const hit = withHighlight(o.hit ?? hitFromStory(article, people, name), highlight);
        setStoryPeople([]);
        const chosen: Vids2Setup = { ...setupRef.current, story: { name, hit, article, rail } };
        commit(chosen);
        // Whatever else is still to answer, the intro is answered now.
        onHeadStart('intro', chosen);
        advance(INTRO, chosen);
        return;
      }
      const named: StoryChoice[] = (o.from?.people ?? []).map((p) => ({ ...p, inHeadline: true }));
      for (const p of people) if (!named.some((n) => n.ticker === p.ticker)) named.push(p);
      if (named.length === 0) {
        throw new Error('Nobody on Pauv is named in that story, so there is nobody to trade on. Try another.');
      }
      const person = rosterName(named[0]);
      const base = o.from ?? hitFromStory(article, people, named[0].name);
      setStoryPeople(named);
      // The page's own spelling of the first person wins over the row's
      // headline, which was the feed's and may not be the page's.
      const hit = withHighlight(hitFor(base, named[0]), highlight);
      const chosen: Vids2Setup = {
        ...setupRef.current,
        person,
        intro: 'news',
        flow: 'news',
        story: { name: person, hit, article, rail },
      };
      commit(chosen);
      // The story is who and the intro both, so the intro can go now.
      onHeadStart('intro', chosen);
      // Two people in it: which one is a press away before the form moves on.
      if (named.length > 1) setAskPerson(named);
      else advance(WHO, chosen);
    } catch (e) {
      if (!ctrl.signal.aborted) setReadError(errorText(e));
    } finally {
      if (readRef.current === ctrl) { readRef.current = null; setReading(null); }
    }
  };

  /** The same story, for somebody else it names. */
  const choosePerson = (p: StoryChoice): Vids2Setup => {
    const s = setupRef.current;
    const person = rosterName(p);
    if (!s.story || person.trim().toLowerCase() === s.person.trim().toLowerCase()) return s;
    const chosen: Vids2Setup = { ...s, person, story: { ...s.story, name: person, hit: hitFor(s.story.hit, p) } };
    commit(chosen);
    // The same story, somebody else in it: a different recording entirely.
    onHeadStart('intro', chosen);
    return chosen;
  };

  // ── Trending: the news tab of Who ───────────────────────────────────────────
  // Every fresh headline from the approved outlets that names somebody on
  // Pauv, each with the AI's read of how big it is (lib/news/trending). Read
  // the moment the tab is opened, again on Refresh, and again when the window
  // changes. The route sends more rows than are shown — the hottest, the
  // hottest politics, the newest — so the order and Hide politics are both
  // worked out here, and either way the list is full.
  const [trend, setTrend] = useState<{ window: TrendWindow; hits: TrendingHit[]; scanned: number; matched: number; ai: boolean; topic: string | null; asOf?: string | null; stale?: boolean } | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState<string | null>(null);
  const trendRef = useRef<AbortController | null>(null);
  useEffect(() => () => { trendRef.current?.abort(); trendRef.current = null; }, []);

  /** Reads the list. `topic` is only ever passed by Search wider: the ordinary
   *  read takes everything the outlets put out, and a typed category filters
   *  that here for nothing. */
  /** `fresh` is the ↻: the list is kept on the server and shared, so an
   *  ordinary read is whatever was read last (and how long ago is printed
   *  under the pills); ↻ reads the news again. */
  const refreshTrending = async (window: TrendWindow, topic = '', fresh = false) => {
    trendRef.current?.abort();
    const ctrl = new AbortController();
    trendRef.current = ctrl;
    setTrendLoading(true);
    setTrendError(null);
    try {
      const r = await loadTrending(window, topic, ctrl.signal, fresh);
      if (ctrl.signal.aborted) return;
      setTrend({ window, ...r });
    } catch (e) {
      if (!ctrl.signal.aborted) setTrendError(errorText(e));
    } finally {
      if (trendRef.current === ctrl) { trendRef.current = null; setTrendLoading(false); }
    }
  };
  const onTrending = open === WHO && source === 'trending';
  useEffect(() => {
    if (!onTrending || trend || trendLoading || trendError) return;
    void refreshTrending(setup.trendWindow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onTrending]);

  // A list handed over stale is being read again behind it (the server says
  // so: lib/news/trending-cache). Ask again every so often and put the new
  // one up when it lands — not while a story is being read off the list,
  // which would move under the press. Gives up after a couple of minutes:
  // the read failed, or somebody else's is taking its time.
  useEffect(() => {
    if (!onTrending || !trend?.stale) return;
    const { window: w, topic, asOf } = trend;
    const ctrl = new AbortController();
    let tries = 0;
    const timer = window.setInterval(() => {
      if (++tries > 8) { window.clearInterval(timer); return; }
      void loadTrending(w, topic ?? '', ctrl.signal).then((r) => {
        if (ctrl.signal.aborted || !r.asOf || r.asOf === asOf) return;
        if (readRef.current) return; // a story is being read — next time
        window.clearInterval(timer);
        setTrend({ window: w, ...r });
      }).catch(() => { /* next time */ });
    }, 15_000);
    return () => { window.clearInterval(timer); ctrl.abort(); };
  }, [onTrending, trend]);

  // The typed category filters here rather than at the route: every row
  // already carries the people it names with what each is known for, so
  // narrowing to "rap" is a pass over an array and costs nothing.
  const trendInCategory = useMemo(
    () => (trend ? trend.hits.filter((h) => matchesCategory(h.people, setup.trendCategory)) : []),
    [trend, setup.trendCategory],
  );
  const trendShown = useMemo(
    () => sortTrending(trendInCategory.filter((h) => !setup.hidePolitics || !h.politics), setup.trendSort).slice(0, TREND_ROWS),
    [trendInCategory, setup.hidePolitics, setup.trendSort],
  );
  /** Whether asking Google for the category itself is worth offering: a
   *  category is typed, this list wasn't already read for it, and filtering
   *  what we have left too little to choose from. */
  const canWiden = !!setup.trendCategory.trim()
    && readCategory(trend?.topic ?? '') !== readCategory(setup.trendCategory)
    && trendShown.length < WIDEN_UNDER;

  // What Pauv files people under, biggest first, for the box to suggest as you
  // type. Read once, beside the first list.
  const [categories, setCategories] = useState<NewsCategory[]>([]);
  const [catOpen, setCatOpen] = useState(false);
  useEffect(() => {
    if (!onTrending || categories.length) return;
    const ctrl = new AbortController();
    void loadNewsCategories(ctrl.signal).then((c) => { if (!ctrl.signal.aborted) setCategories(c); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onTrending]);
  const categorySuggestions = useMemo(() => {
    const raw = setup.trendCategory.trim();
    if (!raw) return categories;
    const want = normalCategory(raw);
    return categories.filter((c) => normalCategory(c.label).includes(want) || normalCategory(c.under).includes(want));
  }, [categories, setup.trendCategory]);

  // ── The story's page ────────────────────────────────────────────────────────
  // Drawn the way the News page draws it — grey where the photos will go,
  // since those are found by Generate — in a box to scroll. Only while the
  // Intro card is open: that is the only place it is shown.
  const [page, setPage] = useState<{ url: string; width: number; height: number } | null>(null);
  const [drawing, setDrawing] = useState(false);
  useEffect(() => {
    if (!story || !introOpen) { setPage(null); return; }
    let alive = true;
    setDrawing(true);
    drawNewsPage({ article: story.article, rail: story.rail, people: [], thumbSrcs: [] }, 0)
      .then(({ png }) => { if (alive) setPage({ url: URL.createObjectURL(png.blob), width: png.width, height: png.height }); })
      .catch(() => { /* the page is a preview; the story stands without it */ })
      .finally(() => { if (alive) setDrawing(false); });
    return () => { alive = false; };
  }, [story, introOpen]);
  useEffect(() => () => { if (page) URL.revokeObjectURL(page.url); }, [page]);

  // ── The other answers ───────────────────────────────────────────────────────
  const pickDirection = (direction: Direction) => {
    const next: Vids2Setup = { ...setupRef.current, direction };
    commit(next);
    // The trade recording was waiting on this: it sets off now, with the Look
    // as it stands — rolled, on a first pass — and starts again only if the
    // Look card then says otherwise.
    onHeadStart('trade', next);
    advance(DIRECTION, next, touch('direction'));
  };
  const pickLook = (look: Vids2Look) => {
    const next: Vids2Setup = { ...setupRef.current, look };
    commit(next);
    // The same answers as the run already going is that run; a different
    // theme is a different recording, and it starts over.
    onHeadStart('trade', next);
    advance(LOOK, next, touch('look'));
  };
  const pickMode = (mode: Vids2Mode) => {
    const next: Vids2Setup = { ...setupRef.current, mode };
    commit(next);
    advance(MODE, next, touch('mode'));
  };
  const pickPersona = (personaId: string) => {
    const next: Vids2Setup = { ...setupRef.current, personaId };
    commit(next);
    advance(PERSONA, next);
  };
  /** The personas Random can land on: those with all three clips in the
   *  library, so a random pick never leaves the stage short. */
  const wholePersonas = personas.filter((p) => PERSONA_PARTS.every((part) => {
    const id = p[part];
    return !!id && !!resolveVideo(id);
  }));
  /** One of them at random — never the one already chosen, when there is
   *  anyone else. */
  const randomPersona = () => {
    const others = wholePersonas.filter((p) => p.id !== setup.personaId);
    const from = others.length ? others : wholePersonas;
    if (from.length) pickPersona(from[Math.floor(Math.random() * from.length)].id);
  };

  const ready = setupReady(setup) && !busy;
  const missing = STEPS.find((s) => !answered(s.id)) ?? null;

  // ── What a folded card says ─────────────────────────────────────────────────
  const summary = (id: StepId): ReactNode => {
    switch (id) {
      case 'who': return who;
      case 'intro':
        return setup.intro === 'none' ? INTRO_LABEL.none
          : setup.intro === 'chatgpt' ? `💬 “${setup.question.trim()}”`
          : story ? `📰 ${outletById(story.article.outlet).short ?? outletById(story.article.outlet).name} · ${story.article.headline}` : '📰 News';
      case 'direction': return DIRECTION_LABEL[setup.direction];
      case 'look': return LOOK_LABEL[setup.look];
      case 'mode': return MODE_LABEL[setup.mode];
      case 'persona': {
        const thumb = resolveVideo(persona?.topAId ?? '')?.thumbUrl;
        return (
          <span className="flex min-w-0 items-center gap-2">
            {thumb && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumb} alt="" className="h-6 w-6 shrink-0 rounded-md object-cover" draggable={false} />
            )}
            <span className="truncate">{persona?.name ?? (libraryLoaded ? '' : '…')}</span>
          </span>
        );
      }
    }
  };

  // ── The cards' insides ──────────────────────────────────────────────────────

  const whoCard = (
    <>
      {/* Two ways in, as tabs. */}
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-black p-1">
        {([['name', '👤 By name'], ['trending', '🔥 In the news']] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => { setSource(k); setAskPerson(null); }}
            className={`h-8 rounded-md text-[13px] font-semibold transition-colors ${
              source === k ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {source === 'name' ? (
        <div className="mt-4">
          {/* The list opens as the box is pressed: the suggested names starred
              in gold at the top, then whoever is moving on Pauv. Not focused
              by itself — the card is the cue, not a blinking box. */}
          <div
            className="relative"
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) closeList(); }}
          >
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); setListOpen(true); }}
              onFocus={() => { setListOpen(true); setActive(0); }}
              onPointerDown={() => { setListOpen(true); setActive(0); }}
              onKeyDown={onSearchKey}
              placeholder={roster.length ? `🔍 Search ${roster.length.toLocaleString('en-US')} people…` : 'Loading the roster…'}
              spellCheck={false}
              autoComplete="off"
              className={`${INPUT} h-10 px-3.5 text-sm`}
            />
            {listOpen && (
              <div
                ref={listRef}
                className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950 py-1 shadow-2xl"
              >
                {shown.length === 0 ? (
                  <p className="px-3 py-2 text-[13px] text-zinc-500">
                    {roster.length ? `Nobody on Pauv called “${query.trim()}”` : 'Loading…'}
                  </p>
                ) : (
                  <>
                    {shown.map(({ t, star }, i) => {
                      const change = changeText(t.price.change1dPct);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          data-active={i === active || undefined}
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => setActive(i)}
                          onClick={() => chooseName(t.name)}
                          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] ${
                            star
                              ? i === active ? 'bg-amber-500/20 text-amber-100' : 'bg-amber-500/[0.07] text-amber-200'
                              : i === active ? 'bg-zinc-800 text-white' : 'text-zinc-300'
                          }`}
                        >
                          {star && <span className="shrink-0 text-amber-300">★</span>}
                          <span className={`min-w-0 flex-1 truncate ${star ? 'font-semibold' : ''}`}>{t.name}</span>
                          {change ? (
                            <span className={`shrink-0 font-mono text-[10px] ${(t.price.change1dPct ?? 0) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                              {change}
                            </span>
                          ) : (
                            <span className="shrink-0 font-mono text-[10px] text-zinc-500">{t.ticker}</span>
                          )}
                        </button>
                      );
                    })}
                    {matches.length > shown.length && (
                      <p className="px-3 py-1.5 text-xs text-zinc-600">
                        {(matches.length - shown.length).toLocaleString('en-US')} more — keep typing
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          {rosterError && <p className="mt-1.5 text-xs text-red-400">Couldn’t read the roster: {rosterError}</p>}
        </div>
      ) : askPerson ? (
        /* The story named more than one person on Pauv. */
        <div className="mt-4">
          <p className="text-[13px] text-zinc-400">Who is the video about?</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {askPerson.map((p) => (
              <button
                key={p.ticker}
                type="button"
                onClick={() => { const chosen = choosePerson(p); setAskPerson(null); advance(WHO, chosen); }}
                className="h-11 rounded-xl border border-zinc-700 bg-black px-3 text-sm font-semibold text-zinc-100 transition-colors hover:border-zinc-400"
              >
                {rosterName(p)}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setAskPerson(null)} className="mt-3 text-xs text-zinc-500 hover:text-white">
            ← Back to the list
          </button>
        </div>
      ) : (
        <div className="mt-4">
          {/* Wraps: on a phone the windows, the order and No politics are
              two rows, and the refresh keeps to the right of whichever
              row it lands on. */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1">
              {TREND_WINDOWS.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => { patch({ trendWindow: w }); void refreshTrending(w); }}
                  disabled={trendLoading}
                  title={`Stories from the ${WINDOW_LONG[w]}`}
                  className={pill(setup.trendWindow === w)}
                >
                  {WINDOW_LABEL[w]}
                </button>
              ))}
            </div>
            <span className="hidden w-px self-stretch bg-zinc-800 sm:block" />
            <div className="flex gap-1">
              {TREND_SORTS.map((s) => (
                <button key={s} type="button" onClick={() => patch({ trendSort: s })} className={pill(setup.trendSort === s)}>
                  {SORT_LABEL[s]}
                </button>
              ))}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={setup.hidePolitics}
              onClick={() => patch({ hidePolitics: !setup.hidePolitics })}
              title="Leave politics stories out"
              className={pill(setup.hidePolitics)}
            >
              {setup.hidePolitics ? '✓ ' : ''}No politics
            </button>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => void refreshTrending(setup.trendWindow, '', true)}
              disabled={trendLoading}
              title="Read the news again now — the list is otherwise shared and refreshed every so often"
              className={`${pill(false)} w-7 px-0`}
            >
              {trendLoading ? <SpinnerIcon size={11} className="mx-auto animate-spin" /> : '↻'}
            </button>
          </div>

          {/* Narrow the list to what somebody is known for. Typing filters
              what is already on the page; only Search wider asks Google. */}
          <div className="mt-2 flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <input
                value={setup.trendCategory}
                onChange={(e) => patch({ trendCategory: e.target.value.slice(0, 60) })}
                onFocus={() => setCatOpen(true)}
                onBlur={() => window.setTimeout(() => setCatOpen(false), 120)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.currentTarget.blur(); setCatOpen(false); }
                  if (e.key === 'Enter' && canWiden) { e.preventDefault(); void refreshTrending(setup.trendWindow, setup.trendCategory); }
                }}
                placeholder="Filter — rap, cycling, formula 1…"
                className={`${INPUT} h-8 px-3 pr-8 text-[13px]`}
              />
              {setup.trendCategory && (
                <button
                  type="button"
                  onClick={() => patch({ trendCategory: '' })}
                  title="Show every category again"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1 text-[13px] text-zinc-500 hover:text-white"
                >
                  ✕
                </button>
              )}
              {catOpen && categorySuggestions.length > 0 && (
                <div className="vids-scroll absolute left-0 right-0 top-9 z-20 max-h-[360px] overflow-y-auto overscroll-contain rounded-xl border border-zinc-700 bg-zinc-950 py-1 shadow-2xl">
                  {categorySuggestions.map((c) => (
                    <button
                      key={`${c.kind}:${c.label}`}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { patch({ trendCategory: c.label }); setCatOpen(false); }}
                      className="flex w-full items-baseline gap-2 px-3 py-1 text-left text-[13px] text-zinc-200 hover:bg-zinc-800"
                    >
                      <span className="truncate">{c.label}</span>
                      {c.kind === 'subcategory' && <span className="shrink-0 text-xs text-zinc-600">{c.under}</span>}
                      <span className="flex-1" />
                      <span className="shrink-0 font-mono text-xs text-zinc-500">{c.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {canWiden && (
              <button
                type="button"
                onClick={() => void refreshTrending(setup.trendWindow, setup.trendCategory)}
                disabled={trendLoading}
                title={`Ask Google for ${setup.trendCategory.trim()} stories`}
                className="h-8 shrink-0 rounded-md border border-sky-500/60 bg-sky-500/10 px-2.5 text-[11px] font-semibold text-sky-200 transition-colors hover:border-sky-400 hover:bg-sky-500/20 disabled:opacity-50"
              >
                🔎 Search wider
              </button>
            )}
          </div>

          {trendError && (
            <p className="mt-3 text-[13px] text-red-400">
              Couldn’t read the news: {trendError}{' '}
              <button type="button" onClick={() => void refreshTrending(setup.trendWindow)} className="underline hover:text-white">Try again</button>
            </p>
          )}
          {trendLoading && (
            <p className="mt-4 flex h-24 items-center justify-center gap-2 rounded-xl border border-zinc-800 text-[13px] text-zinc-500">
              <SpinnerIcon size={13} className="animate-spin" /> Reading the news…
            </p>
          )}
          {trend && !trendLoading && (
            <div className="mt-3">
              {trendShown.length === 0 ? (
                <p className="flex h-20 items-center justify-center rounded-xl border border-zinc-800 px-4 text-center text-[13px] text-zinc-500">
                  {trend.hits.length === 0 ? `Nobody on Pauv in the news in the ${WINDOW_LONG[trend.window]}. Try 1wk.`
                    : trendInCategory.length === 0 ? `Nothing for “${setup.trendCategory.trim()}”.${canWiden ? ' Search wider asks Google.' : ''}`
                    : 'All politics. Turn No politics off to see them.'}
                </p>
              ) : (
                <>
                  <p className="mb-1.5 text-[11px] text-zinc-500">
                    {trendShown.length} of {trend.matched.toLocaleString('en-US')} stories · {WINDOW_LONG[trend.window]}
                    {trend.asOf && ` · read ${ago(trend.asOf)}`}
                    {!trend.ai && ' · AI didn’t score all of these'}
                  </p>
                  <div className="vids-scroll max-h-[400px] space-y-1 overflow-y-auto pr-1">
                    {trendShown.map((h) => {
                      const chosen = story?.hit.url === h.url;
                      return (
                        <button
                          key={h.url}
                          type="button"
                          onClick={() => void readStory(h.url, { from: h, byStory: true })}
                          disabled={reading !== null}
                          className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors disabled:cursor-default ${
                            chosen ? 'border-zinc-400 bg-zinc-800' : 'border-zinc-800 bg-black hover:border-zinc-500'
                          }`}
                        >
                          <OutletTag id={h.outlet} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] leading-snug text-zinc-100">{h.title}</span>
                            <span className="mt-0.5 block text-[11px] text-zinc-500">
                              <span className="font-semibold text-zinc-300">{h.people.map((p) => p.name).join(' · ')}</span>
                              {h.why && <span className="text-zinc-400">{' · '}{h.why}</span>}
                              {' · '}{ago(h.publishedAt)}
                              {h.politics && ' · politics'}
                            </span>
                          </span>
                          <span className="flex shrink-0 flex-col items-end gap-1">
                            {h.heat != null && (
                              <span
                                title="How hard this headline would stop somebody scrolling, out of 100"
                                className={`rounded px-1.5 py-px font-mono text-[11px] font-bold ${
                                  h.heat >= 85 ? 'bg-red-500/20 text-red-300'
                                    : h.heat >= 70 ? 'bg-amber-500/15 text-amber-300'
                                    : 'bg-zinc-800 text-zinc-500'
                                }`}
                              >
                                {h.heat >= 85 ? '🔥 ' : ''}{h.heat}
                              </span>
                            )}
                            {reading === h.url ? (
                              <SpinnerIcon size={11} className="animate-spin text-zinc-400" />
                            ) : chosen ? (
                              <span className="text-xs text-emerald-400">✓</span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
          <PasteLink disabled={trendLoading} reading={reading} onUse={(url) => void readStory(url, { byStory: true })} />
          {readError && <p className="mt-2 text-[13px] text-red-400">{readError}</p>}
        </div>
      )}
    </>
  );

  /** The story, chosen: what it is, and Continue. Both flows show it on the
   *  Intro card. */
  const storyCard = story && (
    <div className="mt-3 overflow-hidden rounded-xl border border-zinc-600 bg-black">
      <div className="flex items-start gap-2 px-3 py-2.5">
        <OutletTag id={story.article.outlet} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-snug text-zinc-100">{story.article.headline}</p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {story.article.byline}
            {story.article.publishedAt ? ` · ${ago(story.article.publishedAt)}` : story.article.publishedDate ? ` · ${story.article.publishedDate}` : ''}
            {!story.hit.named && ' · name found in the text'}
          </p>
        </div>
        <button type="button" onClick={continueIntro} className={`${PRIMARY} h-9 shrink-0 px-3.5 text-[13px]`}>
          Continue →
        </button>
      </div>
      {storyPeople.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3 text-xs text-zinc-500">
          <span className="mr-0.5">Trading on</span>
          {storyPeople.map((p) => {
            const on = rosterName(p).trim().toLowerCase() === who.toLowerCase();
            return (
              <button key={p.ticker} type="button" onClick={() => choosePerson(p)} disabled={on} className={pill(on)}>
                {rosterName(p)}
              </button>
            );
          })}
        </div>
      )}
      {story.article.notes.length > 0 && (
        <ul className="space-y-0.5 px-3 pb-3 text-xs text-amber-300/90">
          {story.article.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
      <div className="vids-scroll max-h-48 overflow-y-auto border-t border-zinc-800 bg-zinc-900">
        {page ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={page.url} alt={story.article.headline} className="block w-full" width={page.width} height={page.height} />
        ) : (
          <p className="flex h-16 items-center justify-center text-xs text-zinc-500">{drawing ? 'Drawing the page…' : ''}</p>
        )}
      </div>
    </div>
  );

  const hitsShown = found && found.name === who ? (nameInTitle ? found.hits.filter((h) => h.named) : found.hits) : null;

  const introCard = (
    <>
      <Choice
        // Two on the clipper page, three in the Studio — see INTROS_OFFERED.
        options={INTROS_OFFERED.map((i) => ({ value: i, label: INTRO_LABEL[i], on: INTRO_ON[i] }))}
        value={setup.intro}
        disabled={false}
        onPick={pickIntro}
      />

      {setup.intro === 'chatgpt' && (
        <div className="mt-4">
          <textarea
            ref={questionRef}
            autoFocus
            value={setup.question}
            onChange={(e) => patch({ question: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); continueIntro(); }
            }}
            rows={3}
            placeholder="The question typed into ChatGPT — or have one written ↓"
            className={`${INPUT} resize-none px-3.5 py-2.5 text-sm`}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {QUESTION_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => void suggest(k)}
                disabled={!who || writingKind !== null}
                title={QUESTION_HINT[k]}
                className={`h-9 shrink-0 whitespace-nowrap rounded-lg border px-3 text-[13px] font-semibold transition-colors disabled:opacity-40 ${
                  chosenKind === k
                    ? k === 'ragebait' ? 'border-amber-500 bg-amber-500/15 text-amber-200' : 'border-zinc-300 bg-white/10 text-white'
                    : 'border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'
                }`}
              >
                {writingKind === k ? 'Writing…' : QUESTION_LABEL[k]}
              </button>
            ))}
            <button type="button" onClick={continueIntro} disabled={!setup.question.trim()} className={`${PRIMARY} ml-auto h-9 shrink-0 whitespace-nowrap px-4 text-[13px]`}>
              Continue →
            </button>
          </div>
          {writeError && <p className="mt-2 text-xs text-red-400">Couldn’t write one: {writeError}</p>}
        </div>
      )}

      {setup.intro === 'news' && (
        <div className="mt-4">
          {/* Wraps rather than running off the card on a phone; the headline
              toggle is a desktop nicety and stays off phones altogether. */}
          <div className="flex flex-wrap items-center gap-1">
            {NEWS_RANGES.map((r) => (
              <button key={r} type="button" onClick={() => patch({ newsRange: r })} disabled={searching} className={pill(setup.newsRange === r)}>
                {RANGE_LABEL[r]}
              </button>
            ))}
            <span className="flex-1" />
            {hitsShown && found && found.hits.length > 0 && (
              <button type="button" onClick={() => setNameInTitle((v) => !v)} className={`${pill(nameInTitle)} max-sm:hidden`}>
                {nameInTitle ? '✓ ' : ''}Name in headline
              </button>
            )}
          </div>

          {storyCard}

          {searching ? (
            <p className="mt-3 flex h-20 items-center justify-center gap-2 rounded-xl border border-zinc-800 text-[13px] text-zinc-500">
              <SpinnerIcon size={13} className="animate-spin" /> Searching for stories about {who}…
            </p>
          ) : searchError ? (
            <p className="mt-3 text-[13px] text-red-400">
              Couldn’t search: {searchError}{' '}
              <button type="button" onClick={() => { setSearchError(null); void searchStories(); }} className="underline hover:text-white">Try again</button>
            </p>
          ) : hitsShown ? (
            <div className="mt-3">
              {hitsShown.length === 0 ? (
                <p className="flex h-16 items-center justify-center rounded-xl border border-zinc-800 px-4 text-center text-[13px] text-zinc-500">
                  {found!.hits.length === 0 ? `No stories about ${who} ${RANGE_LABEL[found!.range].toLowerCase()}. Try a wider range.` : 'None with the name in the headline.'}
                </p>
              ) : (
                <div className="vids-scroll max-h-[300px] space-y-1 overflow-y-auto pr-1">
                  {hitsShown.map((h) => {
                    const chosen = story?.hit.url === h.url;
                    return (
                      <button
                        key={h.url}
                        type="button"
                        onClick={() => void readStory(h.url, { hit: h, byStory: false })}
                        disabled={reading !== null}
                        className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors disabled:cursor-default ${
                          chosen ? 'border-zinc-400 bg-zinc-800' : 'border-zinc-800 bg-black hover:border-zinc-500'
                        }`}
                      >
                        <OutletTag id={h.outlet} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] leading-snug text-zinc-100">{h.title}</span>
                          <span className="mt-0.5 block text-[11px] text-zinc-500">
                            {ago(h.publishedAt)}
                            {h.named && ' · name in the headline'}
                          </span>
                        </span>
                        {reading === h.url ? (
                          <SpinnerIcon size={11} className="mt-0.5 shrink-0 animate-spin text-zinc-400" />
                        ) : chosen ? (
                          <span className="shrink-0 text-xs text-emerald-400">✓</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : story ? (
            <button type="button" onClick={() => void searchStories()} className={`${pill(false)} mt-3`}>
              🔍 Find another story
            </button>
          ) : null}
          <PasteLink disabled={searching} reading={reading} onUse={(url) => void readStory(url, { byStory: false })} />
          {readError && <p className="mt-2 text-[13px] text-red-400">{readError}</p>}
        </div>
      )}
    </>
  );

  const personaCard = !libraryLoaded ? (
    <p className="flex h-24 items-center justify-center gap-2 text-[13px] text-zinc-500">
      <SpinnerIcon size={13} className="animate-spin" /> Loading the library…
    </p>
  ) : personas.length === 0 ? (
    <p className="flex h-24 items-center justify-center rounded-xl border border-dashed border-zinc-800 text-[13px] text-zinc-500">
      No personas in the library yet.
    </p>
  ) : (
    <div className="vids-scroll grid max-h-[420px] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-5">
      <button
        type="button"
        onClick={randomPersona}
        disabled={!wholePersonas.length}
        title={wholePersonas.length ? `One of ${wholePersonas.length} at random` : 'No persona has all three clips yet'}
        className="flex aspect-square flex-col items-center justify-center rounded-xl border border-dashed border-zinc-700 text-zinc-300 transition-colors hover:border-zinc-400 hover:text-white disabled:opacity-40 sm:aspect-[3/4]"
      >
        <span className="text-2xl">🎲</span>
        <span className="mt-1 text-xs font-semibold">Random</span>
      </button>
      {personas.map((p) => {
        const v = resolveVideo(p.topAId ?? '');
        const filled = PERSONA_PARTS.filter((k) => p[k]).length;
        const on = p.id === setup.personaId;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => pickPersona(p.id)}
            disabled={filled === 0}
            title={p.name}
            className={`relative overflow-hidden rounded-xl border bg-black text-left transition-colors disabled:opacity-40 ${
              on ? 'border-white ring-1 ring-white' : 'border-zinc-800 hover:border-zinc-500'
            }`}
          >
            {/* Square on a phone, with the name over the foot of the picture
                — three across, and a grid to scroll; portrait with the name
                under it from sm up. */}
            <span className="block aspect-square w-full overflow-hidden sm:aspect-[3/4]">
              {v?.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={v.thumbUrl} alt="" className="h-full w-full object-cover" draggable={false} />
              ) : (
                <span className="flex h-full items-center justify-center"><VideoIcon size={18} className="text-zinc-700" /></span>
              )}
            </span>
            <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/90 via-black/60 to-transparent px-1.5 pb-1.5 pt-5 text-[11px] font-semibold text-white sm:hidden">
              {p.name}
            </span>
            <span className="hidden truncate px-1.5 py-1 text-[11px] font-semibold text-zinc-200 sm:block">{p.name}</span>
            {filled !== 3 && (
              <span className="absolute right-1.5 top-1.5 rounded bg-black/80 px-1 text-[10px] font-bold text-amber-300">{filled}/3</span>
            )}
            {on && (
              <span className="absolute left-1.5 top-1.5 rounded-full bg-emerald-500 px-1.5 text-[10px] font-bold text-black">✓</span>
            )}
          </button>
        );
      })}
    </div>
  );

  const body = (i: number): ReactNode => {
    switch (STEPS[i].id) {
      case 'who': return whoCard;
      case 'intro': return introCard;
      case 'direction':
        return (
          <Choice
            tall
            options={DIRECTIONS.map((d) => ({ value: d, label: DIRECTION_LABEL[d], on: DIRECTION_ON[d] }))}
            value={touched.has('direction') ? setup.direction : null}
            disabled={false}
            onPick={pickDirection}
          />
        );
      case 'look':
        return (
          <Choice
            tall
            options={VIDS2_LOOKS.map((l) => ({ value: l, label: LOOK_LABEL[l], on: LOOK_ON[l] }))}
            value={touched.has('look') ? setup.look : null}
            disabled={false}
            onPick={pickLook}
          />
        );
      case 'mode':
        return (
          <Choice
            tall
            options={VIDS2_MODES.map((m) => ({ value: m, label: MODE_LABEL[m], on: MODE_ON[m] }))}
            value={touched.has('mode') ? setup.mode : null}
            disabled={false}
            onPick={pickMode}
          />
        );
      case 'persona': return personaCard;
    }
  };

  /** The head start's line, on the card whose answer set it going — for the
   *  trade, the last of the cards it waits on (TRADE_CARD). */
  const legOn = (id: StepId): Vids2Leg | null =>
    id === 'intro' ? warm.intro : id === TRADE_CARD ? warm.trade : null;

  const card = (i: number) => {
    const s = STEPS[i];
    const isOpen = open === i;
    const locked = i > furthest;
    const done = !isOpen && !locked && answered(s.id);
    const pending = !isOpen && !locked && !done;
    const leg = legOn(s.id);
    return (
      <section
        key={s.id}
        ref={(el) => { cardRefs.current[i] = el; }}
        // Opened, a card lands under the header strip on a phone rather
        // than behind it.
        className={`scroll-mt-16 rounded-2xl border transition-colors md:scroll-mt-6 ${
          isOpen ? 'border-zinc-500 bg-[#111]'
            : done ? 'border-zinc-800 bg-[#0c0c0c] hover:border-zinc-600'
            : pending ? 'border-amber-900/60 bg-[#0c0c0c] hover:border-amber-700'
            : 'border-zinc-900 opacity-40'
        }`}
      >
        <button
          type="button"
          disabled={locked}
          onClick={() => toggle(i)}
          className="flex w-full items-center gap-2.5 px-4 py-3 text-left disabled:cursor-default"
        >
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              done ? 'bg-emerald-500 text-black'
                : isOpen ? 'bg-white text-black'
                : pending ? 'border border-amber-500 text-amber-300'
                : 'border border-zinc-700 text-zinc-500'
            }`}
          >
            {done ? '✓' : i + 1}
          </span>
          <span className="shrink-0 text-sm font-semibold text-zinc-100">{s.label}</span>
          <span className="min-w-0 flex-1" />
          {leg && <LegPill leg={leg} />}
          {done && <span className="min-w-0 max-w-[60%] truncate text-sm text-zinc-300">{summary(s.id)}</span>}
          {done && <span className="shrink-0 text-[11px] text-zinc-500">Change</span>}
          {pending && <span className="shrink-0 text-[11px] font-semibold text-amber-300">Needs an answer</span>}
        </button>
        {isOpen && <div className="px-4 pb-4">{body(i)}</div>}
      </section>
    );
  };

  const pct = job ? Math.round(jobProgress(job) * 100) : 0;

  // ── Typing on a phone ───────────────────────────────────────────────────
  // The keyboard takes the bottom half of the screen, and a row pinned to the
  // foot of the page then sits right over whatever is being typed. So while
  // a box has the focus the Generate row steps aside on a phone, and comes
  // back the moment it is left. Focus bubbles, so the root hears every box.
  const [typing, setTyping] = useState(false);
  const onFocus = (e: FocusEvent) => { if (isTextBox(e.target)) setTyping(true); };
  const onBlur = (e: FocusEvent) => setTyping(isTextBox(e.relatedTarget));
  // A box taken off the page while it has the focus — the question box when
  // News is pressed, the search box when a name is picked and the card
  // folds — blurs without a word, so what has the focus is looked at again
  // after every render, and the row comes back when it is not a box.
  // After every render on purpose — a box can go on any of them — and it
  // settles: it only ever sets false, and only while true.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (typing && !isTextBox(document.activeElement)) setTyping(false); });

  return (
    // min-w-0: this is a flex item, and a flex item's least width is its
    // content's unless told otherwise — so a folded card's one-line answer,
    // which never wraps, was the least width of the whole form, and a long
    // ChatGPT question pushed the page out wide on a phone. Held to the
    // window, the line truncates the way it was meant to.
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" onFocus={onFocus} onBlur={onBlur}>
      {/* On a phone the two corner boxes the section floats over the form —
          the code box and Reset — sit on a solid strip, so the cards scroll
          under a header rather than through it. Wide, they are off in the
          corners with nothing under them. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-20 h-14 bg-black md:hidden" />
      {/* The cards, in a scroll of their own: Generate is under the scroll,
          not at the end of it. */}
      <div className="vids-scroll min-h-0 flex-1 overflow-y-auto">
        {/* Room at the top for the two corner boxes the section floats over
            the form — the code box at the left, Reset at the right — so the
            title starts under them at any width. */}
        <div className="mx-auto w-full max-w-2xl px-4 pb-6 pt-14 sm:px-6">
          <h1 className="text-2xl font-semibold text-white">Make a video</h1>
          <div className={`mt-5 flex flex-col gap-2.5 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
            {STEPS.map((_, i) => card(i))}
          </div>
        </div>
      </div>

      {/* Generate — the foot of the page, whatever is scrolled above it. Lit
          when every card is answered; the progress bar while it runs. Bigger
          on a phone, where it is pressed with a thumb, and padded clear of
          the home bar on one with a notch. */}
      <div className={`shrink-0 border-t border-zinc-900 bg-black pb-[env(safe-area-inset-bottom)] ${typing ? 'max-md:hidden' : ''}`}>
        <div className="mx-auto w-full max-w-2xl px-4 py-3 sm:px-6 sm:py-4">
          {job ? (
            <div className="rounded-2xl border border-zinc-800 bg-[#111] p-4">
              <div className="relative h-14 overflow-hidden rounded-xl bg-zinc-900 sm:h-12">
                <span className="absolute inset-y-0 left-0 bg-white/20 transition-[width]" style={{ width: `${pct}%` }} />
                <span className="relative flex h-full items-center justify-center gap-2 text-base font-semibold text-white">
                  <SpinnerIcon size={16} className="animate-spin" />
                  Making the video · {pct}%
                </span>
              </div>
              <div className="mt-3 space-y-1">
                {jobLegs(job).map((leg, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className={`w-3 shrink-0 text-center ${leg.done ? 'text-emerald-400' : 'text-zinc-600'}`}>{leg.done ? '✓' : '·'}</span>
                    <span className={`min-w-0 flex-1 truncate ${leg.done ? 'text-zinc-500' : 'text-zinc-300'}`}>{leg.label}</span>
                    {!leg.done && leg.frac != null && <span className="shrink-0 font-mono text-zinc-500">{Math.round(leg.frac * 100)}%</span>}
                  </div>
                ))}
              </div>
              <button type="button" onClick={onCancel} className="mt-3 text-xs text-zinc-500 hover:text-red-400">Cancel</button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onGenerate}
              disabled={!ready}
              title={ready ? 'Make the video' : missing ? `${missing.label} first` : undefined}
              className={`${PRIMARY} h-14 w-full text-lg sm:h-12 sm:text-base`}
            >
              Generate
            </button>
          )}
          {jobError && <p className="mt-2 text-[13px] text-red-400">{jobError}</p>}
        </div>
      </div>
    </div>
  );
}
