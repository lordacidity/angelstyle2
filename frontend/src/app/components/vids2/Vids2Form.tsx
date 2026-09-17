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
//   4. Look      light or dark. It is the Pauv page's theme, and only that:
//                the ChatGPT recording is dark whatever this says.
//   5. Persona   the same chooser Simpler's Persona card opens
//                (components/simpler/VidsPicker) — one row per persona, its
//                three clips behind it.
//   6. Intro     what opens the video — the first screen recording, Bottom A
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
import type { VidPersona, VidRow } from '@/lib/vids-types';
import { writeQuestion, type QuestionKind } from '@/lib/vids-client';
import { VidsPersonaPicker } from '@/app/components/simpler/VidsPicker';
import {
  VIDS2_INTROS, VIDS2_MODES, introReady, loadRoster, lower, setupReady, storyFor,
  type Direction, type NewsRange, type Theme, type TradeTalent, type Vids2Intro, type Vids2Mode, type Vids2Setup,
} from '@/lib/vids2/vids2Build';
import { ago, drawNewsPage, errorText, NEWS_RANGE_LABEL, NEWS_RANGES, readNewsStory, searchNews } from '@/lib/news/client';
import { OUTLET_IDS, outletById } from '@/lib/news/outlets';
import type { NewsHit } from '@/lib/news/types';
import { BTN_TEXT } from '@/lib/ui-constants';
import { SpinnerIcon, VideoIcon } from '@/lib/icons';

const DIRECTIONS: readonly Direction[] = ['up', 'down'];
const DIRECTION_LABEL: Record<Direction, string> = { up: '📈 Up', down: '📉 Down' };
const THEMES: readonly Theme[] = ['light', 'dark'];
const THEME_LABEL: Record<Theme, string> = { light: '☀️ Light', dark: '🌙 Dark' };
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

/** The questions, in the order they are asked. */
type StepId = 'who' | 'mode' | 'direction' | 'theme' | 'persona' | 'intro';
const STEPS: readonly { id: StepId; label: string; hint: string }[] = [
  { id: 'who', label: 'Who', hint: 'anybody on Pauv' },
  { id: 'mode', label: 'Mode', hint: 'how the video talks' },
  { id: 'direction', label: 'Which way', hint: '$10 either way' },
  { id: 'theme', label: 'Look', hint: 'the Pauv page in the trade recording' },
  { id: 'persona', label: 'Persona', hint: 'fills Start, Top A and Top B' },
  { id: 'intro', label: 'Intro', hint: 'what opens the video, before the trade' },
];
const LAST = STEPS.length - 1;

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

/** Big answers side by side — the shape of Mode, Which way, Look and Intro. */
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

export function Vids2Form({
  setup, onChange, personas, resolveVideo, libraryLoaded, job, jobError, onGenerate, onCancel,
  hasBuild, onBack,
}: Props) {
  const [pickingPersona, setPickingPersona] = useState(false);
  const busy = !!job;
  const who = setup.person.trim();

  const persona = personas.find((p) => p.id === setup.personaId) ?? null;
  const personaThumb = resolveVideo(persona?.topAId ?? '')?.thumbUrl ?? null;
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
  const [step, setStep] = useState(hasBuild ? LAST : 0);
  const [furthest, setFurthest] = useState(hasBuild ? LAST : 0);
  const go = (i: number) => {
    const to = Math.max(0, Math.min(LAST, i));
    setStep(to);
    setFurthest((f) => Math.max(f, to));
  };
  const next = () => go(step + 1);
  const current = STEPS[step];

  /** Whether a step has what it needs to be left forwards. The two-way ones
   *  always have an answer — the setup starts with one. */
  const answered = (id: StepId): boolean =>
    id === 'who' ? !!who
      : id === 'persona' ? !!persona
      : id === 'intro' ? introReady(setup)
      : true;

  /** What the strip says about an answer. */
  const summary = (id: StepId): string => {
    switch (id) {
      case 'who': return who || '—';
      case 'mode': return MODE_LABEL[setup.mode];
      case 'direction': return DIRECTION_LABEL[setup.direction];
      case 'theme': return THEME_LABEL[setup.theme];
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
  const [found, setFound] = useState<{ name: string; range: NewsRange; hits: NewsHit[] } | null>(null);
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
      const hits = await searchNews(who, OUTLET_IDS, setup.newsRange, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setFound({ name: who, range: setup.newsRange, hits });
    } catch (e) {
      if (!ctrl.signal.aborted) setSearchError(errorText(e));
    } finally {
      if (searchRef.current === ctrl) { searchRef.current = null; setSearching(false); }
    }
  };

  const pickStory = async (hit: NewsHit) => {
    readRef.current?.abort();
    const ctrl = new AbortController();
    readRef.current = ctrl;
    setReading(hit.url);
    setReadError(null);
    try {
      const { article, rail } = await readNewsStory(hit.url, ctrl.signal);
      if (ctrl.signal.aborted) return;
      patch({ story: { name: who, hit, article, rail } });
    } catch (e) {
      if (!ctrl.signal.aborted) setReadError(errorText(e));
    } finally {
      if (readRef.current === ctrl) { readRef.current = null; setReading(null); }
    }
  };

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
  const missing = STEPS.find((s) => !answered(s.id)) ?? null;

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
          Six questions, one at a time, then Generate. The intro you choose — ChatGPT looking them up, a news story
          about them, or nothing — and the trade on Pauv are both recorded for this video, and it lands on the tuning
          page with the words already written.
        </p>

        {/* Every answer so far. The one being asked is lit; one already reached
            takes you back to it; one still ahead can't be pressed yet. */}
        <div className="mt-6 grid grid-cols-6 gap-1">
          {STEPS.map((s, i) => {
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
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Step {step + 1} of {STEPS.length}
          </p>
          <p className="mb-3 mt-0.5 text-[14px] font-semibold text-zinc-100">
            {current.label}
            <span className="ml-2 text-[11px] font-normal text-zinc-500">{current.hint}</span>
          </p>

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
                  themselves: <span className="text-zinc-400">fahh</span> when the intro gets to them,{' '}
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
                  {setup.person.trim().toLowerCase() || 'them'} mid haircut&rdquo;. Nothing else about the video changes.
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

          {current.id === 'theme' && (
            <Choice
              options={THEMES.map((t) => ({ value: t, label: THEME_LABEL[t], on: 'border-zinc-300 bg-zinc-300/10 text-white' }))}
              value={setup.theme}
              disabled={busy}
              onPick={(theme) => onChange({ ...setup, theme })}
            />
          )}

          {current.id === 'persona' && (
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
                    A real story about {who || 'them'} from an approved outlet, off Google News. Pick one: it is read
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
                              ? `None of the ${found.hits.length} headlines have “${found.name}” in them.`
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
                                    {h.named && ' · name in the title'}
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
                  {readError && <p className="mt-1.5 text-[9px] text-red-400">That one can’t be used: {readError}</p>}

                  {/* The story, chosen: what it is, and its page to scroll. */}
                  {story ? (
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
                      {story.article.notes.length > 0 && (
                        <ul className="space-y-0.5 px-2.5 pb-2 text-[9px] text-amber-300/90">
                          {story.article.notes.map((n) => <li key={n}>{n}</li>)}
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
                  ) : setup.story && !found ? (
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
              {step < LAST && (
                <button
                  type="button"
                  onClick={next}
                  disabled={!answered(current.id)}
                  title={answered(current.id) ? undefined : current.id === 'who' ? 'Choose who first' : 'Choose a persona first'}
                  className="h-11 min-w-[140px] rounded-md bg-white px-6 text-[14px] font-semibold text-black transition-colors hover:bg-zinc-200 disabled:opacity-30"
                >
                  Next →
                </button>
              )}
            </div>
          )}
        </div>

        {/* Generate, and what it is doing — on the last question only. The
            button becomes the progress: it is the only thing on the page that
            is running, and a bar somewhere else would only be somewhere else. */}
        {current.id === 'intro' && (
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
                      <button onClick={() => go(STEPS.indexOf(missing))} className="text-zinc-400 underline decoration-zinc-700 hover:text-white">
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
