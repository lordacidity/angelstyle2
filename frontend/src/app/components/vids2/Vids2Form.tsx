'use client';

// Vids2Form — the answers a video is made from, and the Generate button. It is
// the whole of the first page: nothing is on the stage yet and there is nothing
// to tune, so there is nothing else to look at.
//
// One question at a time, in this order:
//
//   1. Who       anybody on Pauv, from the roster itself (/api/ai/talents)
//                rather than from what has been filmed: Vids 2 renders the
//                trade rather than taking one off a shelf, so there is nothing
//                to have filmed. Over a thousand of them, so the box searches
//                rather than scrolls, and says how many as it does.
//   2. Mode      Serious, Middle or Degen — how the video talks, not what is
//                in it (Vids2Mode in lib/vids2). Each writes the hook to its
//                own guide (api/vids/hook). Degen also lays three BOOMs on the
//                beats worth reacting to, and may roll a song marked degen on
//                the Music page. See degenBooms in lib/vids2 and rollableMusic
//                in Vids2Builder.
//   3. Which way up or down — which way the $10 goes.
//   4. Persona   the same chooser Simpler's Persona card opens
//                (components/simpler/VidsPicker) — one row per persona, its
//                three clips behind it.
//   5. Intro     what opens the video — the first screen recording, Bottom A
//                (Vids2Intro in lib/vids2). Three ways:
//                  No intro      nothing before the trade: the video goes
//                                straight to trading on them on Pauv.
//                  ChatGPT       the question typed into ChatGPT, as written —
//                                capitals and all. Write it, or have it
//                                written: Ragebait or Factual, the same two
//                                the Simpler Bottom card offers
//                                (api/vids/question). Those two come back
//                                lower case, the way a search bar is typed
//                                into; a question written by hand is left
//                                exactly as it is.
//                  News article  a real story about them, the way Studio >
//                                News finds one (lib/news/client): choose how
//                                far back to look — a week, to start — and
//                                Search for articles; the list opens on the
//                                headlines with the name in them, the rest a
//                                press away; pick one and it is read
//                                off the outlet and checked, and its page is
//                                drawn here, grey where the photos will go, to
//                                scroll through. Generate finds the photos and
//                                records it (makeNewsClip in lib/vids2).
//                                A link can be pasted instead of searched for:
//                                any article page on an approved outlet, read
//                                and checked the same way.
//
// That is the form started from Who. "Choose by news", top right of the first
// question, starts it from the other end (Vids2Flow in lib/vids2) — see who is
// trending and make the video straight from there:
//
//   1. News      the stories the approved outlets have put out in the past 24
//                hours (or 6, or 1) whose headlines name somebody on Pauv,
//                twenty of them, each with who, when, and its heat — the AI's
//                read of how hard the headline would stop somebody scrolling,
//                with the hook in a few words (lib/news/trending). Biggest
//                first, or Newest. Refresh reads them again; Hide politics
//                leaves those out. Pick one — or paste a link — and it is read
//                off the outlet, and that is Who and the intro both answered:
//                the person is whoever the headline names (a press away when
//                it names two), the intro is the story. Nothing from an
//                earlier visit is left standing on this question: the list is
//                about now, so the story kept from last time goes as the
//                first read goes out, and nothing chosen shows while one runs.
//   2. Which way, 3. Mode, 4. Persona — as above — and Generate is on Persona.
//
// "Choose by who" goes back. The answers are the same answers either way, so
// switching loses nothing.
//
// Light or dark is not a question: the Pauv page's theme is rolled on every
// Generate (rollTheme in lib/vids2).
//
// Nothing moves on by itself: pick an answer, then press Next. Back goes a step
// back, and the strip along the top holds every answer given so far — press
// one to go back to it. The page opens on the first question, or on the last
// when Change brought you back from a video, since then every answer is
// already there to be jumped to.
//
// Generate is on the last question. It hands the answers to the section, which
// renders the recordings — at the same time, neither waiting on the other —
// and takes over the page (Vids2Section). While that runs this stays up, with a
// line per recording where the button was, so a question can be re-read and
// the whole thing cancelled.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { PERSONA_PARTS, type VidPersona, type VidRow } from '@/lib/vids-types';
import { writeQuestion, type QuestionKind } from '@/lib/vids-client';
import { VidsPersonaPicker } from '@/app/components/simpler/VidsPicker';
import {
  VIDS2_INTROS, VIDS2_MODES, introReady, loadRoster, lower, setupReady, storyFor,
  type Direction, type NewsRange, type TradeTalent, type TrendWindow, type Vids2Flow, type Vids2Intro,
  type Vids2Mode, type Vids2Setup,
} from '@/lib/vids2/vids2Build';
import {
  ago, clock, drawNewsPage, errorText, hitFromStory, loadTrending, NEWS_RANGE_LABEL, NEWS_RANGES,
  pastedLinkProblem, readNewsStory, searchedForms, searchNews, sortTrending, TREND_SORT_LABEL, TREND_SORTS,
  TREND_WINDOW_LABEL, TREND_WINDOWS,
} from '@/lib/news/client';
import { OUTLET_IDS, OUTLETS, outletById } from '@/lib/news/outlets';
import type { NamedPerson, NewsHit, TrendingHit } from '@/lib/news/types';
import { BTN_TEXT } from '@/lib/ui-constants';
import { SpinnerIcon, VideoIcon } from '@/lib/icons';

const DIRECTIONS: readonly Direction[] = ['up', 'down'];
const DIRECTION_LABEL: Record<Direction, string> = { up: '📈 Up', down: '📉 Down' };
const MODE_LABEL: Record<Vids2Mode, string> = { serious: '👔 Serious', middle: '😐 Middle', degen: '💀 Degen' };
const MODE_ON: Record<Vids2Mode, string> = {
  serious: 'border-sky-500 bg-sky-500/15 text-sky-200',
  middle: 'border-zinc-300 bg-zinc-300/10 text-white',
  degen: 'border-amber-500 bg-amber-500/15 text-amber-200',
};
const INTRO_LABEL: Record<Vids2Intro, string> = { none: '⏭️ No intro', chatgpt: '💬 ChatGPT', news: '📰 News article' };
const INTRO_ON: Record<Vids2Intro, string> = {
  none: 'border-zinc-300 bg-zinc-300/10 text-white',
  chatgpt: 'border-emerald-500 bg-emerald-500/15 text-emerald-200',
  news: 'border-sky-500 bg-sky-500/15 text-sky-200',
};

/** The two ways the model will write the question — see api/vids/question. */
const QUESTION_KINDS: readonly QuestionKind[] = ['ragebait', 'factual'];
const QUESTION_LABEL: Record<QuestionKind, string> = { ragebait: 'Ragebait', factual: 'Factual' };
const QUESTION_HINT: Record<QuestionKind, string> = {
  ragebait: 'The extreme opposite of how they are actually rated, so ChatGPT naming them makes no sense at all',
  factual: 'A plain question they would genuinely come up in — nothing surprising about the answer',
};

/** How many of the roster the dropdown will draw at once. Everyone is in the
 *  list and everyone can be found by typing; this is only how many rows exist
 *  on the page before you have narrowed it down. */
const MAX_ROWS = 60;

/** How many of the trending list are shown. The route sends more than this,
 *  so hiding politics still leaves a full list. */
const TREND_ROWS = 20;

/** The questions there are, and the order each flow asks its own in. */
type StepId = 'who' | 'news' | 'mode' | 'direction' | 'persona' | 'intro';
interface Step { id: StepId; label: string; hint: string }
const STEP: Record<StepId, Step> = {
  who: { id: 'who', label: 'Who', hint: 'anybody on Pauv' },
  news: { id: 'news', label: 'News', hint: 'who is in the news right now' },
  mode: { id: 'mode', label: 'Mode', hint: 'how the video talks' },
  direction: { id: 'direction', label: 'Which way', hint: '$10 either way' },
  persona: { id: 'persona', label: 'Persona', hint: 'fills Start, Top A and Top B' },
  intro: { id: 'intro', label: 'Intro', hint: 'what opens the video, before the trade' },
};
const FLOW_STEPS: Record<Vids2Flow, readonly Step[]> = {
  who: [STEP.who, STEP.mode, STEP.direction, STEP.persona, STEP.intro],
  // The story is Who and the intro both, so it asks one fewer.
  news: [STEP.news, STEP.direction, STEP.mode, STEP.persona],
};
const NUMBER_WORD = ['No', 'One', 'Two', 'Three', 'Four', 'Five'];

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
  job: Vids2Job | null;
  jobError: string | null;
  onGenerate: () => void;
  onCancel: () => void;
  /** There is a video behind this form — Change was pressed on the tuning
   *  page rather than this being the first visit. */
  hasBuild: boolean;
  /** Back to that video, nothing regenerated. */
  onBack: () => void;
}

/** Big answers side by side — the shape of Mode, Which way and Intro. */
function Choice<T extends string | boolean>({ options, value, disabled, onPick }: {
  options: readonly { value: T; label: string; on: string }[];
  value: T;
  disabled: boolean;
  onPick: (value: T) => void;
}) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          disabled={disabled}
          onClick={() => onPick(o.value)}
          className={`h-12 rounded-md border text-[13px] font-semibold transition-colors disabled:opacity-50 ${
            value === o.value ? o.on : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A link pasted in instead of a story found: any article page on an approved
 *  outlet. What is wrong with it is said as it is typed (pastedLinkProblem) —
 *  the route makes the same check — and what comes of reading it is the
 *  caller's to show, beside every other story's. */
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
      <p className="mb-1 text-[10px] text-zinc-500">Or paste an article link from {OUTLETS.map((o) => o.name).join(', ')}:</p>
      <div className="flex items-center gap-2">
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (can) onUse(url); } }}
          disabled={disabled}
          placeholder="https://…"
          spellCheck={false}
          autoComplete="off"
          className="h-9 min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-[12px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => onUse(url)}
          disabled={!can}
          className="h-9 shrink-0 rounded-md border border-zinc-600 px-3 text-[12px] font-semibold text-zinc-200 transition-colors hover:border-zinc-400 hover:text-white disabled:opacity-40"
        >
          {reading !== null && reading === url ? 'Reading…' : 'Use this link'}
        </button>
      </div>
      {problem && <p className="mt-1 text-[9px] text-amber-300/90">{problem}</p>}
    </div>
  );
}

export function Vids2Form({
  setup, onChange, personas, resolveVideo, libraryLoaded, job, jobError, onGenerate, onCancel,
  hasBuild, onBack,
}: Props) {
  const [pickingPersona, setPickingPersona] = useState(false);
  const busy = !!job;
  const who = setup.person.trim();

  const persona = personas.find((p) => p.id === setup.personaId) ?? null;
  const personaThumb = resolveVideo(persona?.topAId ?? '')?.thumbUrl ?? null;
  /** The personas Randomize can land on: those with all three clips in the
   *  library, so a random pick never leaves the stage short. */
  const wholePersonas = personas.filter((p) => PERSONA_PARTS.every((part) => {
    const id = p[part];
    return !!id && !!resolveVideo(id);
  }));
  /** One of them at random — never the one already chosen, when there is
   *  anyone else. Nothing moves on: Next is still the way forward. */
  const randomPersona = () => {
    const others = wholePersonas.filter((p) => p.id !== setup.personaId);
    const from = others.length ? others : wholePersonas;
    if (from.length) onChange({ ...setup, personaId: from[Math.floor(Math.random() * from.length)].id });
  };
  /** The story chosen for THIS person — one chosen and then Who changed is
   *  about somebody else, and doesn't count (storyFor). */
  const story = storyFor(setup);

  // The answers as they stand now, for whatever lands after an await — a
  // story read off the outlet arrives seconds after it was asked for, and
  // must not put back an answer changed in between.
  const setupRef = useRef(setup);
  useEffect(() => { setupRef.current = setup; });
  const patch = (next: Partial<Vids2Setup>) => onChange({ ...setupRef.current, ...next });

  // ── Which question is up ────────────────────────────────────────────────────
  // `furthest` is how far the answers go: every step up to it has been reached
  // and can be jumped back to from the strip; the ones past it are still ahead.
  const steps = FLOW_STEPS[setup.flow];
  const last = steps.length - 1;
  const [step, setStep] = useState(hasBuild ? last : 0);
  const [furthest, setFurthest] = useState(hasBuild ? last : 0);
  const go = (i: number) => {
    const to = Math.max(0, Math.min(last, i));
    setStep(to);
    setFurthest((f) => Math.max(f, to));
  };
  const next = () => go(step + 1);
  const current = steps[Math.min(step, last)];

  /** The other end of the form. The answers are one set whichever flow asked
   *  for them, so nothing is lost — only the questions start over. A news-flow
   *  setup always has a news intro: the story is what opens the video. */
  const switchFlow = (flow: Vids2Flow) => {
    patch(flow === 'news' ? { flow, intro: 'news' } : { flow });
    setStep(0);
    setFurthest(0);
  };

  /** Whether a step has what it needs to be left forwards. The two-way ones
   *  always have an answer — the setup starts with one. */
  const answered = (id: StepId): boolean =>
    id === 'who' ? !!who
      : id === 'news' ? !!who && !!story
      : id === 'persona' ? !!persona
      : id === 'intro' ? introReady(setup)
      : true;

  /** What the strip says about an answer. */
  const summary = (id: StepId): string => {
    switch (id) {
      case 'who': return who || '—';
      case 'news': return story ? `${who} · ${story.article.headline}` : '—';
      case 'mode': return MODE_LABEL[setup.mode];
      case 'direction': return DIRECTION_LABEL[setup.direction];
      case 'persona': return persona?.name ?? '—';
      case 'intro':
        return setup.intro === 'none' ? 'No intro'
          : setup.intro === 'chatgpt' ? `ChatGPT · ${setup.question.trim() || '—'}`
          : `News · ${story?.article.headline ?? '—'}`;
    }
  };

  // ── The roster ──────────────────────────────────────────────────────────────
  const [roster, setRoster] = useState<TradeTalent[]>([]);
  const [rosterError, setRosterError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadRoster()
      .then((r) => { if (alive) { setRoster(r); setRosterError(null); } })
      .catch((e: unknown) => { if (alive) setRosterError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, []);

  // ── Who: a list of over a thousand, so it searches ──────────────────────────
  const [query, setQuery] = useState(setup.person);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  // The box reading as whoever is chosen is not somebody narrowing the list
  // down, so pressing it shows everyone rather than just them.
  const needle = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!needle || needle === setup.person.trim().toLowerCase()) return roster;
    return roster.filter((t) => t.name.toLowerCase().includes(needle));
  }, [roster, needle, setup.person]);
  const shown = matches.slice(0, MAX_ROWS);

  // Who can be answered from the news flow too, by picking a story.
  useEffect(() => { setQuery(setup.person); }, [setup.person]);

  const closeList = () => { setOpen(false); setQuery(setup.person); };
  const choose = (t: TradeTalent) => {
    onChange({ ...setup, person: t.name });
    setQuery(t.name);
    setOpen(false);
  };
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); setActive(0); return; }
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (shown.length ? (i + dir + shown.length) % shown.length : 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (open && shown[active]) choose(shown[active]);
      return;
    }
    if (e.key === 'Escape' && open) { e.preventDefault(); closeList(); }
  };
  useEffect(() => {
    if (open) listRef.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  // ── Having the question written ─────────────────────────────────────────────
  // Two buttons, one model call each, straight into the box: whichever comes
  // back is a draft like any other, to be used, edited, or thrown away by
  // pressing the other one, and it arrives lower case because that is how a
  // search bar is typed into. The one whose question is actually in the box is
  // the one that colours up, so it says what is there rather than what was
  // last clicked — and editing the case is editing it, so it stands down.
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

  // ── The news story ──────────────────────────────────────────────────────────
  // The News page's own errand, from lib/news/client: Google News for the
  // name, every approved outlet, as far back as the time frame says; pick a
  // result and the story is read off the outlet and checked — a story with
  // no headline, byline, date or paragraphs is refused with the reason — and
  // goes into the answers, so it is still there after Change. What was found
  // is this page's alone: Who changing empties the list, since it was about
  // somebody else.
  /** `as` is the name and the short forms it was searched by ("Vladimir
   *  Putin, Putin"), empty when there were none — see lib/news/name-forms. */
  const [found, setFound] = useState<{ name: string; range: NewsRange; hits: NewsHit[]; as: string } | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Headlines with the name in them, to start — the rest are a press away.
  const [nameInTitle, setNameInTitle] = useState(true);
  const searchRef = useRef<AbortController | null>(null);
  /** The result being read, by its url. */
  const [reading, setReading] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const readRef = useRef<AbortController | null>(null);
  useEffect(() => () => { searchRef.current?.abort(); readRef.current?.abort(); }, []);
  useEffect(() => { setFound(null); setSearchError(null); }, [setup.person]);

  const searchStories = async () => {
    if (!who || searching) return;
    searchRef.current?.abort();
    const ctrl = new AbortController();
    searchRef.current = ctrl;
    setSearching(true);
    setSearchError(null);
    try {
      const { hits, forms } = await searchNews(who, OUTLET_IDS, setup.newsRange, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setFound({ name: who, range: setup.newsRange, hits, as: searchedForms(who, forms) });
    } catch (e) {
      if (!ctrl.signal.aborted) setSearchError(errorText(e));
    } finally {
      if (searchRef.current === ctrl) { searchRef.current = null; setSearching(false); }
    }
  };

  /** Who the chosen story names, when the story is what chose the person —
   *  the news flow. More than one and the form offers the others. This page's
   *  alone, like the lists: a story brought back from last time has nobody to
   *  offer but whoever it was already for. */
  const [storyPeople, setStoryPeople] = useState<StoryChoice[]>([]);
  /** Something worth knowing about a story that was read all the same. */
  const [readNote, setReadNote] = useState<string | null>(null);
  /** The roster's spelling of somebody the news side named — the same table,
   *  but it is the roster's that the trade recording is matched against. */
  const rosterName = (p: NamedPerson) => roster.find((t) => t.ticker === p.ticker)?.name ?? p.name;

  /** Read a story off its outlet and make it the answer. `link` is a search
   *  result's, a trending row's or one pasted in by hand — the key it is read
   *  under, for the spinner. With Who already answered (`hit` from that
   *  person's search, or a pasted link) the story is for them. In the news
   *  flow it is the other way round: the story says who — `from`'s headline
   *  names, then whoever else on Pauv the story itself turns out to name. */
  const readStory = async (link: string, o: { hit?: NewsHit; from?: TrendingHit }) => {
    readRef.current?.abort();
    const ctrl = new AbortController();
    readRef.current = ctrl;
    setReading(link);
    setReadError(null);
    setReadNote(null);
    const byStory = setupRef.current.flow === 'news';
    try {
      const { article, rail, people = [] } = await readNewsStory(link, ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (!byStory) {
        const hit = o.hit ?? hitFromStory(article, people, who);
        if (!o.hit && !people.some((p) => p.name.trim().toLowerCase() === who.toLowerCase())) {
          setReadNote(`That story doesn’t say “${who}” in full anywhere, so the recording may have no name to drag over. It can still be used.`);
        }
        setStoryPeople([]);
        patch({ story: { name: who, hit, article, rail } });
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
      patch({ person, intro: 'news', story: { name: person, hit: hitFor(base, named[0]), article, rail } });
    } catch (e) {
      if (!ctrl.signal.aborted) setReadError(errorText(e));
    } finally {
      if (readRef.current === ctrl) { readRef.current = null; setReading(null); }
    }
  };
  const pickStory = (hit: NewsHit) => readStory(hit.url, { hit });

  /** The same story, for somebody else it names. */
  const choosePerson = (p: StoryChoice) => {
    const s = setupRef.current.story;
    if (!s) return;
    const person = rosterName(p);
    patch({ person, story: { ...s, name: person, hit: hitFor(s.hit, p) } });
  };

  // ── Trending: the news flow's first question ────────────────────────────────
  // Every fresh headline from the approved outlets that names somebody on
  // Pauv, each with the AI's read of how big it is (lib/news/trending). Read
  // when the question first comes up, again on Refresh, and again when the
  // window changes. The route sends more rows than are shown — the hottest,
  // the hottest politics, the newest — so the order and Hide politics are both
  // worked out here, and either way the list is full.
  //
  // The list is about now, so nothing from before is left standing beside it:
  // a story kept from an earlier visit is dropped as the first read goes out
  // (unless it is the story of the video behind this form — Change came from
  // that, and Back to the video still has to mean it), and whatever is chosen
  // is off the page while a read is running.
  const [trend, setTrend] = useState<{ window: TrendWindow; hits: TrendingHit[]; scanned: number; matched: number; ai: boolean } | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState<string | null>(null);
  const trendRef = useRef<AbortController | null>(null);
  useEffect(() => () => { trendRef.current?.abort(); trendRef.current = null; }, []);

  const refreshTrending = async (window: TrendWindow) => {
    trendRef.current?.abort();
    const ctrl = new AbortController();
    trendRef.current = ctrl;
    setTrendLoading(true);
    setTrendError(null);
    try {
      const r = await loadTrending(window, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setTrend({ window, ...r });
    } catch (e) {
      if (!ctrl.signal.aborted) setTrendError(errorText(e));
    } finally {
      if (trendRef.current === ctrl) { trendRef.current = null; setTrendLoading(false); }
    }
  };
  const onNews = current.id === 'news';
  useEffect(() => {
    if (!onNews || trend || trendRef.current || trendError) return;
    if (!hasBuild && setupRef.current.story) patch({ story: null });
    void refreshTrending(setup.trendWindow);
    // Only the question coming up with nothing read yet; Refresh is the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onNews]);

  const trendShown = useMemo(
    () => (trend
      ? sortTrending(trend.hits.filter((h) => !setup.hidePolitics || !h.politics), setup.trendSort).slice(0, TREND_ROWS)
      : []),
    [trend, setup.hidePolitics, setup.trendSort],
  );
  const trendHidden = trend && setup.hidePolitics ? trend.hits.filter((h) => h.politics).length : 0;
  /** Whether anything came back with a heat to sort on. */
  const trendRanked = !!trend && trend.hits.some((h) => h.heat != null);

  // The story's page, drawn the way the News page draws it — grey where the
  // photos will go, since those are found by Generate — in a box to scroll.
  // Drawn again whenever the story changes, and let go when it does.
  const [page, setPage] = useState<{ url: string; width: number; height: number } | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [drawError, setDrawError] = useState<string | null>(null);
  useEffect(() => {
    if (!story) { setPage(null); return; }
    let alive = true;
    setDrawing(true);
    setDrawError(null);
    drawNewsPage({ article: story.article, rail: story.rail, people: [], thumbSrcs: [] }, 0)
      .then(({ png }) => { if (alive) setPage({ url: URL.createObjectURL(png.blob), width: png.width, height: png.height }); })
      .catch((e: unknown) => { if (alive) setDrawError(errorText(e)); })
      .finally(() => { if (alive) setDrawing(false); });
    return () => { alive = false; };
  }, [story]);
  useEffect(() => () => { if (page) URL.revokeObjectURL(page.url); }, [page]);

  const hitsShown = found ? (nameInTitle ? found.hits.filter((h) => h.named) : found.hits) : [];

  const ready = setupReady(setup) && !busy;
  /** The first question still without an answer, for Generate to point at. */
  const missing = steps.find((s) => !answered(s.id)) ?? null;

  /** The story, chosen: what it is, who it is being used for when the story
   *  is what said so, and its page to scroll. Both flows show it. */
  const storyCard = story && (
    <div className="mt-3 overflow-hidden rounded-md border border-zinc-700">
      <div className="flex items-start gap-2 px-2.5 py-2">
        <span
          className="mt-px shrink-0 rounded px-1 py-px text-[8px] font-bold text-white"
          style={{ background: outletById(story.article.outlet).color }}
        >
          {outletById(story.article.outlet).name}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] leading-snug text-zinc-100">{story.article.headline}</p>
          <p className="mt-0.5 text-[9px] text-zinc-500">
            {story.article.byline}
            {story.article.publishedAt ? ` · ${ago(story.article.publishedAt)}` : story.article.publishedDate ? ` · ${story.article.publishedDate}` : ''}
            {' · '}{story.article.paragraphs.length} paragraphs
            {' · '}{story.hit.named ? 'name in the headline' : 'name not in the headline — the clip finds it in the story'}
          </p>
        </div>
      </div>
      {setup.flow === 'news' && (
        <div className="flex flex-wrap items-center gap-1 px-2.5 pb-2 text-[10px] text-zinc-500">
          <span className="mr-0.5">Trading on</span>
          {(storyPeople.length ? storyPeople : [null]).map((p) => {
            const on = !p || rosterName(p).trim().toLowerCase() === who.toLowerCase();
            return (
              <button
                key={p?.ticker ?? 'only'}
                type="button"
                onClick={() => p && choosePerson(p)}
                disabled={busy || !p || on}
                title={p && !on ? `Use this story for ${p.name} instead` : undefined}
                className={`rounded border px-1.5 py-0.5 font-semibold transition-colors disabled:cursor-default ${
                  on ? 'border-zinc-300 bg-zinc-300/10 text-white' : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white'
                }`}
              >
                {p ? p.name : who}
              </button>
            );
          })}
        </div>
      )}
      {(story.article.notes.length > 0 || readNote) && (
        <ul className="space-y-0.5 px-2.5 pb-2 text-[9px] text-amber-300/90">
          {story.article.notes.map((n) => <li key={n}>{n}</li>)}
          {readNote && <li>{readNote}</li>}
        </ul>
      )}
      <div className="max-h-[360px] overflow-y-auto border-t border-zinc-800 bg-zinc-900">
        {page ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={page.url} alt={story.article.headline} className="block w-full" width={page.width} height={page.height} />
        ) : (
          <p className="flex h-24 items-center justify-center text-[10px] text-zinc-500">
            {drawing ? 'Drawing the page…' : drawError ? `Couldn’t draw the page: ${drawError}` : ''}
          </p>
        )}
      </div>
      <p className="px-2.5 py-1.5 text-[9px] text-zinc-600">
        Grey where the photos go — free ones of {who || 'them'} and the side column&apos;s are found when you
        press Generate.
      </p>
    </div>
  );

  return (
    <div className="vids-scroll flex min-h-0 flex-1 justify-center overflow-y-auto px-6 py-10">
      <div className="w-full max-w-xl">
        <div className="flex items-center gap-2">
          <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-zinc-100">Make one</h1>
          {/* Only ever there when there is something to go back to: Change was
              pressed, the video is still up, and leaving the answers alone
              should cost nothing. */}
          {hasBuild && !busy && (
            <button
              onClick={onBack}
              title="Back to the video you already have — nothing is made again"
              className="shrink-0 rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white"
            >
              Back to the video
            </button>
          )}
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          {setup.flow === 'news' ? (
            <>
              {NUMBER_WORD[steps.length]} questions, one at a time, then Generate — starting from the news. Pick a
              story going out right now that names somebody on Pauv: it opens the video, they are who it trades on,
              and both recordings are made for this video. It lands on the tuning page with the words already written.
            </>
          ) : (
            <>
              {NUMBER_WORD[steps.length]} questions, one at a time, then Generate. The intro you choose — ChatGPT
              looking them up, a news story about them, or nothing — and the trade on Pauv are both recorded for this
              video, and it lands on the tuning page with the words already written.
            </>
          )}
        </p>

        {/* Every answer so far. The one being asked is lit; one already reached
            takes you back to it; one still ahead can't be pressed yet. */}
        <div className="mt-6 grid gap-1" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
          {steps.map((s, i) => {
            const here = i === step;
            const reached = i <= furthest;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => go(i)}
                disabled={!reached || busy}
                title={reached ? `${s.label}: ${summary(s.id)}` : s.label}
                className={`min-w-0 rounded-md border px-1.5 py-1 text-left transition-colors disabled:cursor-default ${
                  here ? 'border-zinc-400 bg-zinc-800'
                    : reached ? 'border-zinc-800 hover:border-zinc-600'
                    : 'border-zinc-900 opacity-40'
                }`}
              >
                <span className={`block truncate text-[9px] font-semibold uppercase tracking-wider ${here ? 'text-zinc-200' : 'text-zinc-500'}`}>
                  {i + 1} · {s.label}
                </span>
                <span className={`block truncate text-[10px] ${reached ? 'text-zinc-300' : 'text-zinc-700'}`}>
                  {reached ? summary(s.id) : ' '}
                </span>
              </button>
            );
          })}
        </div>

        {/* The question that is up. */}
        <div key={current.id} className="mt-6 rounded-lg border border-zinc-800 p-4">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Step {step + 1} of {steps.length}
              </p>
              <p className="mb-3 mt-0.5 text-[14px] font-semibold text-zinc-100">
                {current.label}
                <span className="ml-2 text-[11px] font-normal text-zinc-500">{current.hint}</span>
              </p>
            </div>
            {/* The other end of the form, on the first question only: that is
                the question it swaps. */}
            {step === 0 && (
              <button
                type="button"
                onClick={() => switchFlow(setup.flow === 'news' ? 'who' : 'news')}
                disabled={busy}
                title={setup.flow === 'news'
                  ? 'Start from the person instead: choose who, then what opens the video'
                  : 'Start from the news instead: see who is trending right now and make the video from the story'}
                className="shrink-0 rounded-md border border-sky-500/60 bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold text-sky-200 transition-colors hover:border-sky-400 hover:bg-sky-500/20 disabled:opacity-50"
              >
                {setup.flow === 'news' ? '👤 Choose by who' : '📰 Choose by news'}
              </button>
            )}
          </div>

          {current.id === 'news' && (
            <>
              <div className="flex items-center gap-2">
                <select
                  value={setup.trendWindow}
                  onChange={(e) => {
                    const trendWindow = e.target.value as TrendWindow;
                    onChange({ ...setup, trendWindow });
                    void refreshTrending(trendWindow);
                  }}
                  disabled={busy}
                  title="How fresh the stories have to be"
                  className="h-10 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-[12px] text-zinc-100 outline-none focus:border-zinc-500 disabled:opacity-50"
                >
                  {TREND_WINDOWS.map((w) => <option key={w} value={w}>Name in headline · {TREND_WINDOW_LABEL[w].toLowerCase()}</option>)}
                </select>
                <button
                  type="button"
                  role="switch"
                  aria-checked={setup.hidePolitics}
                  onClick={() => onChange({ ...setup, hidePolitics: !setup.hidePolitics })}
                  disabled={busy}
                  title="Leave out politics stories: a politician in the headline, the outlet’s politics desk, or a story the AI reads as politics"
                  className={`h-10 shrink-0 rounded-md border px-2.5 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                    setup.hidePolitics ? 'border-zinc-300 bg-zinc-300/10 text-white' : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white'
                  }`}
                >
                  {setup.hidePolitics ? '✓ ' : ''}Hide politics
                </button>
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={() => void refreshTrending(setup.trendWindow)}
                  disabled={trendLoading || busy}
                  className="flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-zinc-600 bg-zinc-100 px-4 text-[12px] font-semibold text-black transition-colors hover:bg-white disabled:opacity-40"
                >
                  {trendLoading && <SpinnerIcon size={11} className="animate-spin" />}
                  {trendLoading ? 'Reading the news…' : 'Refresh'}
                </button>
              </div>
              {trendError && <p className="mt-1 text-[9px] text-red-400">Couldn’t read the news: {trendError}</p>}
              {trendLoading && (
                <p className="mt-2 text-[10px] text-zinc-500">
                  Reading every fresh headline for anybody on Pauv, then having the AI rank them by how big they
                  are — fifteen seconds or so.
                </p>
              )}

              {/* What was read last time is not what is being read now: gone
                  while a read is running, rather than sitting there looking
                  current. */}
              {trend && !trendLoading && (
                <div className="mt-2">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 text-[10px] text-zinc-500">
                      {trend.hits.length === 0
                        ? `Nobody on Pauv in a headline in the ${TREND_WINDOW_LABEL[trend.window].toLowerCase()} — ${trend.scanned.toLocaleString('en-US')} read. Try a wider window.`
                        : trendShown.length === 0
                          ? `All ${trend.hits.length} are politics. Turn off Hide politics to see them.`
                          : `${setup.trendSort === 'hot' ? (trendRanked ? 'The biggest' : 'The most written-about') : 'The newest'} ${trendShown.length} of ${trend.matched.toLocaleString('en-US')} stories naming somebody on Pauv · ${TREND_WINDOW_LABEL[trend.window].toLowerCase()} · ${trend.scanned.toLocaleString('en-US')} headlines read${trendHidden ? ` · ${trendHidden} politics hidden` : ''}`}
                    </p>
                    {trend.hits.length > 0 && (
                      <div className="flex shrink-0 gap-1">
                        {TREND_SORTS.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => onChange({ ...setup, trendSort: s })}
                            disabled={busy}
                            title={s === 'hot'
                              ? 'The AI’s read of each headline: how big, shocking or talked-about it is — what would stop somebody scrolling'
                              : 'By when each story went out'}
                            className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold transition-colors disabled:opacity-50 ${
                              setup.trendSort === s ? 'border-zinc-300 bg-zinc-300/10 text-white' : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white'
                            }`}
                          >
                            {TREND_SORT_LABEL[s]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {!trend.ai && trend.hits.length > 0 && (
                    <p className="mt-0.5 text-[9px] text-amber-300/90">
                      {trendRanked
                        ? 'The AI didn’t get through all of these: the ones with no score sit at the bottom of Biggest, and a name on one of them may be somebody else’s.'
                        : 'The AI couldn’t read these, so Biggest goes by how many headlines name them, a name may be somebody else’s, and politics goes by the person and the link alone.'}
                    </p>
                  )}
                  {trendShown.length > 0 && (
                    <div className="mt-1.5 max-h-[340px] space-y-1 overflow-y-auto pr-0.5">
                      {trendShown.map((h) => {
                        const o = outletById(h.outlet);
                        const chosen = story?.hit.url === h.url;
                        return (
                          <button
                            key={h.url}
                            type="button"
                            onClick={() => void readStory(h.url, { from: h })}
                            disabled={busy || reading !== null}
                            className={`flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left transition-colors disabled:cursor-default ${
                              chosen ? 'border-zinc-400 bg-zinc-800' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'
                            }`}
                          >
                            <span className="mt-px shrink-0 rounded px-1 py-px text-[8px] font-bold text-white" style={{ background: o.color }}>
                              {o.name}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[11px] leading-snug text-zinc-100">{h.title}</span>
                              <span className="block text-[9px] text-zinc-500">
                                <span className="font-semibold text-zinc-300">{h.people.map((p) => p.name).join(' · ')}</span>
                                {h.why && <span className="text-zinc-400">{' · '}{h.why}</span>}
                                {' · '}{clock(h.publishedAt)}{' · '}{ago(h.publishedAt)}
                                {h.buzz > 1 && ` · in ${h.buzz} headlines`}
                                {h.url.includes('nytimes.com/athletic/') && ' · The Athletic'}
                                {h.politics && ' · politics'}
                              </span>
                            </span>
                            <span className="flex shrink-0 flex-col items-end gap-0.5">
                              {h.heat != null && (
                                <span
                                  title="How hard the AI thinks this headline would stop somebody scrolling, out of 100"
                                  className={`rounded px-1 py-px font-mono text-[9px] font-bold ${
                                    h.heat >= 85 ? 'bg-red-500/20 text-red-300'
                                      : h.heat >= 70 ? 'bg-amber-500/15 text-amber-300'
                                      : 'bg-zinc-800 text-zinc-500'
                                  }`}
                                >
                                  {h.heat >= 85 ? '🔥 ' : ''}{h.heat}
                                </span>
                              )}
                              {reading === h.url ? (
                                <SpinnerIcon size={10} className="animate-spin text-zinc-400" />
                              ) : chosen ? (
                                <span className="text-[10px] text-emerald-400">✓</span>
                              ) : null}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <PasteLink disabled={busy} reading={reading} onUse={(url) => void readStory(url, {})} />
              {readError && <p className="mt-1.5 text-[9px] text-red-400">That one can’t be used: {readError}</p>}
              {/* Only ever the story chosen from what is on the page now: not
                  while the list is being read again, and not the last one
                  while the next is being read off its outlet. */}
              {reading !== null ? (
                <p className="mt-3 flex h-16 items-center justify-center gap-2 rounded-md border border-zinc-800 text-[10px] text-zinc-500">
                  <SpinnerIcon size={11} className="animate-spin" />
                  Reading the story off the outlet…
                </p>
              ) : !trendLoading ? storyCard : null}
            </>
          )}

          {current.id === 'who' && (
            <>
              <div
                className="relative"
                onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) closeList(); }}
              >
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
                  onFocus={() => { setOpen(true); setActive(0); }}
                  onPointerDown={() => { setOpen(true); setActive(0); }}
                  onKeyDown={onSearchKey}
                  disabled={busy}
                  placeholder={roster.length ? `Search ${roster.length.toLocaleString('en-US')} people…` : 'Loading the roster…'}
                  spellCheck={false}
                  autoComplete="off"
                  className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500 disabled:opacity-50"
                />
                {open && !busy && (
                  <div
                    ref={listRef}
                    className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 py-0.5 shadow-xl"
                  >
                    {shown.length === 0 ? (
                      <p className="px-2 py-2 text-[11px] text-zinc-500">
                        {roster.length ? `Nobody on Pauv called “${query.trim()}”` : 'The roster hasn’t arrived yet.'}
                      </p>
                    ) : (
                      <>
                        {shown.map((t, i) => (
                          <button
                            key={t.id}
                            type="button"
                            data-active={i === active || undefined}
                            onMouseDown={(e) => e.preventDefault()}
                            onMouseEnter={() => setActive(i)}
                            onClick={() => choose(t)}
                            className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] ${
                              i === active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300'
                            }`}
                          >
                            <span className="min-w-0 flex-1 truncate">{t.name}</span>
                            <span className="shrink-0 font-mono text-[9px] text-zinc-500">{t.ticker}</span>
                          </button>
                        ))}
                        {matches.length > shown.length && (
                          <p className="px-2 py-1.5 text-[9px] text-zinc-600">
                            {(matches.length - shown.length).toLocaleString('en-US')} more — keep typing
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
              {rosterError && <p className="mt-1 text-[9px] text-red-400">Couldn’t read the roster: {rosterError}</p>}
            </>
          )}

          {current.id === 'mode' && (
            <>
              <Choice
                options={VIDS2_MODES.map((m) => ({ value: m, label: MODE_LABEL[m], on: MODE_ON[m] }))}
                value={setup.mode}
                disabled={busy}
                onPick={(mode) => onChange({ ...setup, mode })}
              />
              {/* Degen says outright what it will do, because what it does is
                  not subtle and nobody should have to press it to find out. */}
              {setup.mode === 'degen' ? (
                <p className="mt-2.5 text-[10px] leading-relaxed text-zinc-500">
                  Degen: the hook stops bragging and starts begging — &ldquo;homeless man trades on{' '}
                  {who.toLowerCase() || 'them'} (i need serious help)&rdquo; — and BOOMs lay
                  themselves: <span className="text-zinc-400">fahh</span> when the intro zooms in and out on their
                  name,{' '}
                  <span className="text-zinc-400">oh hell nah</span> when their page opens,{' '}
                  <span className="text-zinc-400">fahh</span> again when the trade goes in. Take any of them off on the
                  bar afterwards. The random song can be a degen one too. Nothing else about the video changes.
                </p>
              ) : setup.mode === 'serious' ? (
                <p className="mt-2.5 text-[10px] leading-relaxed text-zinc-500">
                  Serious: the hook says it dead straight — &ldquo;trading on{' '}
                  {setup.person.trim().toLowerCase() || 'them'} all season to quit the 9 to 5&rdquo; — the trade, now
                  and then a reason for it, and what the money is for. Nothing else about the video changes.
                </p>
              ) : (
                <p className="mt-2.5 text-[10px] leading-relaxed text-zinc-500">
                  Middle: the hook uses two of three — a money analogy, what the persona is doing, the trade —
                  &ldquo;making a surgeon&rsquo;s salary from the hot tub&rdquo;, &ldquo;shorting{' '}
                  {setup.person.trim().toLowerCase() || 'them'} mid haircut&rdquo; — or the clock, the money against
                  how little time it took: &ldquo;making rent in the time it takes to lose an argument&rdquo;. Nothing
                  else about the video changes.
                </p>
              )}
              <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
                In every mode, one hook in five is a twist instead: a mystery — &ldquo;shorting the goat&rdquo; — a
                me if — &ldquo;me if shorting drake at a funeral was legal&rdquo; — or, going up, hype:
                &ldquo;{setup.person.trim().toLowerCase() || 'messi'} to the stratosphere&rdquo;.
              </p>
            </>
          )}

          {current.id === 'direction' && (
            <Choice
              options={DIRECTIONS.map((d) => ({
                value: d,
                label: DIRECTION_LABEL[d],
                on: d === 'up'
                  ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
                  : 'border-red-500 bg-red-500/15 text-red-300',
              }))}
              value={setup.direction}
              disabled={busy}
              onPick={(direction) => onChange({ ...setup, direction })}
            />
          )}

          {current.id === 'persona' && (
            <>
            <button
              type="button"
              onClick={randomPersona}
              disabled={!libraryLoaded || !wholePersonas.length || busy}
              title={wholePersonas.length
                ? `One of the ${wholePersonas.length} personas with all three clips, at random`
                : 'No persona has all three clips in the library yet'}
              className="mb-2 rounded-md border border-zinc-700 px-3 py-1.5 text-[12px] font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white disabled:cursor-default disabled:opacity-40"
            >
              🎲 Randomize
            </button>
            <button
              onClick={() => setPickingPersona(true)}
              disabled={!libraryLoaded || !personas.length || busy}
              title={personas.length ? 'Choose the persona' : 'No personas in the library yet'}
              className={`flex w-full items-center gap-2.5 rounded-md border p-2 text-left transition-colors disabled:cursor-default disabled:opacity-50 ${
                persona ? 'border-zinc-700' : 'border-dashed border-zinc-700'
              } hover:border-zinc-500`}
            >
              <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-black">
                {personaThumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={personaThumb} alt="" className="h-full w-full object-cover" draggable={false} />
                ) : (
                  <VideoIcon size={15} className="text-zinc-700" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px]">
                <span className={persona ? 'text-zinc-100' : 'text-zinc-500'}>
                  {persona?.name ?? (libraryLoaded ? 'Choose a persona' : 'Loading the library…')}
                </span>
              </span>
              <span className="shrink-0 text-[10px] text-zinc-500">{persona ? 'Change' : 'Choose'}</span>
            </button>
            </>
          )}

          {current.id === 'intro' && (
            <>
              <Choice
                options={VIDS2_INTROS.map((i) => ({ value: i, label: INTRO_LABEL[i], on: INTRO_ON[i] }))}
                value={setup.intro}
                disabled={busy}
                onPick={(intro) => onChange({ ...setup, intro })}
              />

              {setup.intro === 'none' && (
                <p className="mt-2.5 text-[10px] leading-relaxed text-zinc-500">
                  No intro: nothing before the trade. The video opens straight onto Pauv — searching{' '}
                  {who || 'them'}, their chart, the $10 going {setup.direction} — with the persona over it, then the
                  ending.
                </p>
              )}

              {setup.intro === 'chatgpt' && (
                <div className="mt-3">
                  <textarea
                    ref={questionRef}
                    autoFocus
                    value={setup.question}
                    onChange={(e) => onChange({ ...setup, question: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (ready) onGenerate(); }
                    }}
                    disabled={busy}
                    rows={3}
                    placeholder="e.g. who is the most overrated musician of all time?"
                    className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-[13px] text-zinc-100 outline-none focus:border-zinc-500 disabled:opacity-50"
                  />
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 text-[10px] text-zinc-500">Typed into ChatGPT, as written. Generate question:</span>
                    {QUESTION_KINDS.map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => void suggest(k)}
                        disabled={!who || writingKind !== null || busy}
                        title={who ? QUESTION_HINT[k] : 'Choose who first'}
                        className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] transition-colors disabled:cursor-not-allowed disabled:border-zinc-900 disabled:text-zinc-700 disabled:hover:border-zinc-900 disabled:hover:text-zinc-700 ${
                          chosenKind === k
                            ? k === 'ragebait'
                              ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                              : 'border-zinc-300 bg-zinc-300/10 text-white'
                            : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white'
                        }`}
                      >
                        {writingKind === k ? 'Writing…' : QUESTION_LABEL[k]}
                      </button>
                    ))}
                  </div>
                  {writeError && <p className="mt-1 text-[9px] text-red-400">Couldn’t write one: {writeError}</p>}
                </div>
              )}

              {setup.intro === 'news' && (
                <div className="mt-3">
                  <p className="mb-2 text-[10px] leading-relaxed text-zinc-500">
                    A real story about {who || 'them'} from an approved outlet, off Google News — searched by the whole
                    name and by what headlines call them for short, where that can only mean them. Pick one: it is read
                    from the outlet and checked, and its page is drawn below to look over. Generate finds its photos and
                    records it — Google, the click, the page loading, their name dragged over.
                  </p>
                  <div className="flex items-center gap-2">
                    <select
                      value={setup.newsRange}
                      onChange={(e) => onChange({ ...setup, newsRange: e.target.value as NewsRange })}
                      disabled={busy}
                      title="How far back to look"
                      className="h-10 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-[12px] text-zinc-100 outline-none focus:border-zinc-500 disabled:opacity-50"
                    >
                      {NEWS_RANGES.map((r) => <option key={r} value={r}>{NEWS_RANGE_LABEL[r]}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => void searchStories()}
                      disabled={!who || searching || busy}
                      title={who ? undefined : 'Choose who first'}
                      className="h-10 min-w-0 flex-1 truncate rounded-md border border-zinc-600 bg-zinc-100 px-4 text-[12px] font-semibold text-black transition-colors hover:bg-white disabled:opacity-40"
                    >
                      {searching ? 'Searching…' : `Search for articles${who ? ` about ${who}` : ''}`}
                    </button>
                  </div>
                  {searchError && <p className="mt-1 text-[9px] text-red-400">Couldn’t search: {searchError}</p>}

                  {found && (
                    <div className="mt-2">
                      <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                        <span className="min-w-0 flex-1 truncate">
                          {found.hits.length === 0
                            ? 'No stories from the approved outlets. Try a wider time frame.'
                            : hitsShown.length === 0
                              ? `None of the ${found.hits.length} headlines have “${found.name}”${found.as ? ' or a short form of it' : ''} in them.`
                              : `${hitsShown.length} ${hitsShown.length === 1 ? 'story' : 'stories'} about ${found.name} · ${NEWS_RANGE_LABEL[found.range].toLowerCase()}`}
                        </span>
                        {found.hits.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setNameInTitle((v) => !v)}
                            className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] transition-colors ${
                              nameInTitle ? 'border-zinc-300 bg-zinc-300/10 text-white' : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white'
                            }`}
                          >
                            Name in title only
                          </button>
                        )}
                      </div>
                      {found.as && <p className="mt-0.5 text-[9px] text-zinc-600">Searched as {found.as}</p>}
                      {hitsShown.length > 0 && (
                        <div className="mt-1.5 max-h-56 space-y-1 overflow-y-auto pr-0.5">
                          {hitsShown.map((h) => {
                            const o = outletById(h.outlet);
                            const chosen = story?.hit.url === h.url;
                            return (
                              <button
                                key={h.url}
                                type="button"
                                onClick={() => void pickStory(h)}
                                disabled={busy || reading !== null}
                                className={`flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left transition-colors disabled:cursor-default ${
                                  chosen ? 'border-zinc-400 bg-zinc-800' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'
                                }`}
                              >
                                <span className="mt-px shrink-0 rounded px-1 py-px text-[8px] font-bold text-white" style={{ background: o.color }}>
                                  {o.name}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-[11px] leading-snug text-zinc-100">{h.title}</span>
                                  <span className="block text-[9px] text-zinc-500">
                                    {ago(h.publishedAt)}
                                    {h.url.includes('nytimes.com/athletic/') && ' · The Athletic'}
                                    {h.named && (h.namedAs && h.namedAs.toLowerCase() !== found.name.toLowerCase()
                                      ? ` · “${h.namedAs}” in the title`
                                      : ' · name in the title')}
                                  </span>
                                </span>
                                {reading === h.url ? (
                                  <SpinnerIcon size={10} className="mt-0.5 shrink-0 animate-spin text-zinc-400" />
                                ) : chosen ? (
                                  <span className="shrink-0 text-[10px] text-emerald-400">✓</span>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                  <PasteLink disabled={busy || !who} reading={reading} onUse={(url) => void readStory(url, {})} />
                  {!who && <p className="mt-1 text-[9px] text-zinc-600">Choose who first.</p>}
                  {readError && <p className="mt-1.5 text-[9px] text-red-400">That one can’t be used: {readError}</p>}

                  {story ? storyCard : setup.story && !found ? (
                    <p className="mt-2 text-[10px] text-zinc-500">
                      The story chosen before was about {setup.story.name}. Search again for {who || 'them'}.
                    </p>
                  ) : null}
                </div>
              )}
            </>
          )}

          {/* Back and Next — the only way on: picking an answer stays put until
              Next is pressed. The last question has Generate instead, below. */}
          {!busy && (
            <div className="mt-5 flex items-center gap-3">
              {step > 0 && (
                <button
                  type="button"
                  onClick={() => go(step - 1)}
                  className="h-11 min-w-[110px] rounded-md border border-zinc-700 px-5 text-[14px] font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
                >
                  ← Back
                </button>
              )}
              <span className="flex-1" />
              {step < last && (
                <button
                  type="button"
                  onClick={next}
                  disabled={!answered(current.id)}
                  title={answered(current.id) ? undefined
                    : current.id === 'who' ? 'Choose who first'
                    : current.id === 'news' ? 'Choose a story first'
                    : 'Choose a persona first'}
                  className="h-11 min-w-[140px] rounded-md bg-white px-6 text-[14px] font-semibold text-black transition-colors hover:bg-zinc-200 disabled:opacity-30"
                >
                  Next →
                </button>
              )}
            </div>
          )}
        </div>

        {/* Generate, and what it is doing — on the last question only (the
            intro, or the persona when the form started from the news). The
            button becomes the progress: it is the only thing on the page that
            is running, and a bar somewhere else would only be somewhere else. */}
        {step >= last && (
          <div className="mt-6 border-t border-zinc-800 pt-4">
            {job ? (
              <div>
                <div className="flex items-center gap-2 text-[11px] text-zinc-300">
                  <SpinnerIcon size={12} className="animate-spin" />
                  <span className="flex-1 truncate">{job.intro ? 'Making both recordings' : 'Making the trade recording'}</span>
                  <span className="font-mono text-zinc-500">{Math.round(jobProgress(job) * 100)}%</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full bg-white transition-[width]" style={{ width: `${jobProgress(job) * 100}%` }} />
                </div>
                {/* A line each: both are running, and this says which of the two
                    the wait is actually on. */}
                <div className="mt-2 space-y-1">
                  {jobLegs(job).map((leg, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px]">
                      <span className={`w-2 shrink-0 ${leg.done ? 'text-emerald-400' : 'text-zinc-600'}`}>
                        {leg.done ? '✓' : '·'}
                      </span>
                      <span className={`min-w-0 flex-1 truncate ${leg.done ? 'text-zinc-600' : 'text-zinc-400'}`}>
                        {leg.label}
                      </span>
                      {!leg.done && leg.frac != null && (
                        <span className="shrink-0 font-mono text-zinc-600">{Math.round(leg.frac * 100)}%</span>
                      )}
                    </div>
                  ))}
                </div>
                <button onClick={onCancel} className="mt-2 text-[10px] text-zinc-500 hover:text-red-400">Cancel</button>
              </div>
            ) : (
              <>
                <button
                  onClick={onGenerate}
                  disabled={!ready}
                  title={ready
                    ? (hasBuild
                      ? 'Make the recordings again and replace the video you have'
                      : 'Make the recordings and open the tuning page')
                    : missing ? `${missing.label} still needs an answer` : undefined}
                  className={`${BTN_TEXT} w-full justify-center border-zinc-600 bg-white py-2 text-black hover:bg-zinc-200`}
                >
                  Generate
                </button>
                <p className="mt-1.5 text-[10px] text-zinc-600">
                  {missing && missing.id !== 'intro' ? (
                    <>
                      <button onClick={() => go(steps.indexOf(missing))} className="text-zinc-400 underline decoration-zinc-700 hover:text-white">
                        {missing.label}
                      </button>{' '}
                      still needs an answer.{' '}
                    </>
                  ) : missing ? (
                    <>{setup.intro === 'chatgpt' ? 'Write the question first.' : 'Choose a story first.'}{' '}</>
                  ) : null}
                  {setup.intro === 'none'
                    ? 'Half a minute or so: Pauv loads, then the trade renders.'
                    : setup.intro === 'chatgpt'
                      ? 'A minute or so: ChatGPT answers while Pauv loads, and both recordings render together.'
                      : 'A minute or so: the story’s photos are found while Pauv loads, and both recordings render together.'}
                  {hasBuild && ' The video you have now goes when this one lands.'}
                </p>
              </>
            )}
            {jobError && <p className="mt-2 text-[11px] text-red-400">{jobError}</p>}
          </div>
        )}
      </div>

      {pickingPersona && (
        <VidsPersonaPicker
          personas={personas}
          resolveVideo={resolveVideo}
          currentId={setup.personaId}
          onChoose={(p) => onChange({ ...setup, personaId: p.id })}
          onClose={() => setPickingPersona(false)}
        />
      )}
    </div>
  );
}
