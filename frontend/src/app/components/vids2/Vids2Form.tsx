'use client';

// Vids2Form — the five answers a video is made from, and the Generate button.
// It is the whole of the first page: nothing is on the stage yet and there is
// nothing to tune, so there is nothing else to look at.
//
//   1. Persona   the same chooser Simpler's Persona card opens
//                (components/simpler/VidsPicker) — one row per persona, its
//                three clips behind it.
//   2. Who       anybody on Pauv, from the roster itself (/api/ai/talents)
//                rather than from what has been filmed: Vids 2 renders the
//                trade rather than taking one off a shelf, so there is nothing
//                to have filmed. Over a thousand of them, so the box searches
//                rather than scrolls, and says how many as it does.
//   3. Which way up or down — which way the $10 goes.
//   4. Look      light or dark. It is the Pauv page's theme, and only that:
//                the ChatGPT recording is dark whatever this says.
//   5. Question  what gets typed into ChatGPT, as written — capitals and all.
//                Write it, or have it written: Ragebait or Factual, the same
//                two the Simpler Bottom card offers (api/vids/question). Those
//                two come back lower case, the way a search bar is typed into;
//                a question written by hand is left exactly as it is.
//
// Under the five, a switch rather than a question: DEGEN MODE. It changes how
// the video talks, not what is in it — the hook is written to beg instead of
// brag, and three BOOMs lay themselves on the beats worth reacting to. See
// degenBooms in lib/vids2, and DEGEN_HOOK in api/vids/captions.
//
// Generate hands the five to the section, which renders both recordings — at
// the same time, neither waiting on the other — and takes over the page
// (Vids2Section). While that runs this stays up, with a line per recording
// where the button was, so a question can be re-read and the whole thing
// cancelled.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { VidPersona, VidRow } from '@/lib/vids-types';
import { writeQuestion, type QuestionKind } from '@/lib/vids-client';
import { VidsPersonaPicker } from '@/app/components/simpler/VidsPicker';
import {
  loadRoster, lower, setupReady,
  type Direction, type Theme, type TradeTalent, type Vids2Setup,
} from '@/lib/vids2/vids2Build';
import { BTN_TEXT } from '@/lib/ui-constants';
import { SpinnerIcon, VideoIcon } from '@/lib/icons';

const DIRECTIONS: readonly Direction[] = ['up', 'down'];
const DIRECTION_LABEL: Record<Direction, string> = { up: '📈 Up', down: '📉 Down' };
const THEMES: readonly Theme[] = ['light', 'dark'];
const THEME_LABEL: Record<Theme, string> = { light: '☀️ Light', dark: '🌙 Dark' };

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

/** One of the two recordings, while it is being made. */
export interface Vids2Leg {
  label: string;
  /** 0..1 where there is a share to count, null while there is not — the model
   *  thinking and the roster loading have no frames. */
  frac: number | null;
  done: boolean;
}

/** How the build is getting on. The two recordings are made at once — neither
 *  needs anything from the other — so there is no step 1 and step 2, only two
 *  things running. Null when nothing is being made. */
export interface Vids2Job { chat: Vids2Leg; trade: Vids2Leg }

/** The pair as one share, for the bar: a finished leg counts whole, and one
 *  with nothing to count yet counts as nothing. */
export const jobProgress = (j: Vids2Job): number =>
  [j.chat, j.trade].reduce((sum, leg) => sum + (leg.done ? 1 : leg.frac ?? 0), 0) / 2;

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

/** A numbered row: the count, what it asks for, and the control. */
function Row({ n, label, hint, children }: {
  n: number;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-700 text-[10px] font-semibold text-zinc-400">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="mb-1.5 text-[11px] font-semibold text-zinc-200">
          {label}
          {hint && <span className="ml-2 font-normal text-[10px] text-zinc-500">{hint}</span>}
        </p>
        {children}
      </div>
    </div>
  );
}

export function Vids2Form({
  setup, onChange, personas, resolveVideo, libraryLoaded, job, jobError, onGenerate, onCancel,
  hasBuild, onBack,
}: Props) {
  const [pickingPersona, setPickingPersona] = useState(false);
  const busy = !!job;

  const persona = personas.find((p) => p.id === setup.personaId) ?? null;
  const personaThumb = resolveVideo(persona?.topAId ?? '')?.thumbUrl ?? null;

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
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (shown.length ? (i + step + shown.length) % shown.length : 0));
      return;
    }
    if (e.key === 'Enter' && open) {
      e.preventDefault();
      if (shown[active]) choose(shown[active]);
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
    const who = setup.person.trim();
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
      onChange({ ...setup, question: text });
      setWritten({ kind, text });
      questionRef.current?.focus();
    } catch (e) {
      if (ctrl.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      setWriteError(e instanceof Error ? e.message : String(e));
    } finally {
      if (writeRef.current === ctrl) { writeRef.current = null; setWritingKind(null); }
    }
  };

  const ready = setupReady(setup) && !busy;

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
          Five answers, then Generate. Both screen recordings are made for this video — ChatGPT looking them up, then
          the trade on Pauv — and it lands on the tuning page with the words already written.
        </p>

        <div className="mt-7 space-y-6">
          <Row n={1} label="Persona" hint="fills Start, Top A and Top B">
            <button
              onClick={() => setPickingPersona(true)}
              disabled={!libraryLoaded || !personas.length || busy}
              title={personas.length ? 'Choose the persona' : 'No personas in the library yet'}
              className={`flex w-full items-center gap-2.5 rounded-md border p-2 text-left transition-colors disabled:cursor-default disabled:opacity-50 ${
                persona ? 'border-zinc-700' : 'border-dashed border-zinc-700'
              } hover:border-zinc-500`}
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded bg-black">
                {personaThumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={personaThumb} alt="" className="h-full w-full object-cover" draggable={false} />
                ) : (
                  <VideoIcon size={15} className="text-zinc-700" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px]">
                <span className={persona ? 'text-zinc-100' : 'text-zinc-500'}>
                  {persona?.name ?? (libraryLoaded ? 'Choose a persona' : 'Loading the library…')}
                </span>
              </span>
              <span className="shrink-0 text-[10px] text-zinc-500">Change</span>
            </button>
          </Row>

          <Row n={2} label="Who" hint="anybody on Pauv">
            <div
              className="relative"
              onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) closeList(); }}
            >
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
                onFocus={() => { setOpen(true); setActive(0); }}
                onPointerDown={() => { setOpen(true); setActive(0); }}
                onKeyDown={onSearchKey}
                disabled={busy}
                placeholder={roster.length ? `Search ${roster.length.toLocaleString('en-US')} people…` : 'Loading the roster…'}
                spellCheck={false}
                autoComplete="off"
                className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 text-[12px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500 disabled:opacity-50"
              />
              {open && !busy && (
                <div
                  ref={listRef}
                  className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 py-0.5 shadow-xl"
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
          </Row>

          <Row n={3} label="Which way" hint="$10 either way">
            <div className="grid grid-cols-2 gap-2">
              {DIRECTIONS.map((d) => {
                const on = setup.direction === d;
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={busy}
                    onClick={() => onChange({ ...setup, direction: d })}
                    className={`h-10 rounded-md border text-[12px] font-semibold transition-colors disabled:opacity-50 ${
                      on
                        ? d === 'up'
                          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
                          : 'border-red-500 bg-red-500/15 text-red-300'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {DIRECTION_LABEL[d]}
                  </button>
                );
              })}
            </div>
          </Row>

          <Row n={4} label="Look" hint="the Pauv page in the trade recording">
            <div className="grid grid-cols-2 gap-2">
              {THEMES.map((t) => {
                const on = setup.theme === t;
                return (
                  <button
                    key={t}
                    type="button"
                    disabled={busy}
                    onClick={() => onChange({ ...setup, theme: t })}
                    className={`h-10 rounded-md border text-[12px] font-semibold transition-colors disabled:opacity-50 ${
                      on
                        ? 'border-zinc-300 bg-zinc-300/10 text-white'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {THEME_LABEL[t]}
                  </button>
                );
              })}
            </div>
          </Row>

          <Row n={5} label="The question" hint="typed into ChatGPT">
            <textarea
              ref={questionRef}
              value={setup.question}
              onChange={(e) => onChange({ ...setup, question: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (ready) onGenerate(); }
              }}
              disabled={busy}
              rows={2}
              placeholder="e.g. who is the most overrated musician of all time?"
              className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[12px] text-zinc-100 outline-none focus:border-zinc-500 disabled:opacity-50"
            />
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="min-w-0 flex-1 text-[10px] text-zinc-500">Generate question</span>
              {QUESTION_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => void suggest(k)}
                  disabled={!setup.person.trim() || writingKind !== null || busy}
                  title={setup.person.trim() ? QUESTION_HINT[k] : 'Choose who first'}
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
          </Row>
        </div>

        {/* Degen mode. Not a sixth question: the five above say what the video
            IS, and this says how it talks. It sits apart from them and says
            outright what it will do, because what it does is not subtle and
            nobody should have to press it to find out. */}
        <div
          className={`mt-7 rounded-md border p-3 transition-colors ${
            setup.degen ? 'border-amber-600 bg-amber-950/20' : 'border-zinc-800'
          }`}
        >
          <button
            type="button"
            role="switch"
            aria-checked={setup.degen}
            disabled={busy}
            onClick={() => onChange({ ...setup, degen: !setup.degen })}
            className="flex w-full items-start gap-3 text-left disabled:opacity-50"
          >
            <span
              className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${
                setup.degen ? 'bg-amber-500' : 'bg-zinc-700'
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                  setup.degen ? 'left-[18px]' : 'left-0.5'
                }`}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={`block text-[12px] font-semibold ${setup.degen ? 'text-amber-200' : 'text-zinc-300'}`}
              >
                Degen mode{setup.degen ? ' 💀' : ''}
              </span>
              <span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-500">
                The hook stops bragging and starts begging — &ldquo;homeless man trades on{' '}
                {setup.person.trim().toLowerCase() || 'them'} (i need serious help)&rdquo; — and three BOOMs lay
                themselves: <span className="text-zinc-400">fahh</span> when ChatGPT names them,{' '}
                <span className="text-zinc-400">oh hell nah</span> when their page opens,{' '}
                <span className="text-zinc-400">fahh</span> again when the trade goes in. Take any of them off on the
                bar afterwards. Nothing else about the video changes.
              </span>
            </span>
          </button>
        </div>

        {/* Generate, and what it is doing. The button becomes the progress: it
            is the only thing on the page that is running, and a bar somewhere
            else would only be somewhere else. */}
        <div className="mt-8 border-t border-zinc-800 pt-4">
          {job ? (
            <div>
              <div className="flex items-center gap-2 text-[11px] text-zinc-300">
                <SpinnerIcon size={12} className="animate-spin" />
                <span className="flex-1 truncate">Making both recordings</span>
                <span className="font-mono text-zinc-500">{Math.round(jobProgress(job) * 100)}%</span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full bg-white transition-[width]" style={{ width: `${jobProgress(job) * 100}%` }} />
              </div>
              {/* A line each: both are running, and this says which of the two
                  the wait is actually on. */}
              <div className="mt-2 space-y-1">
                {([['chat', job.chat], ['trade', job.trade]] as const).map(([key, leg]) => (
                  <div key={key} className="flex items-center gap-1.5 text-[10px]">
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
                    ? 'Make both recordings again and replace the video you have'
                    : 'Make both recordings and open the tuning page')
                  : 'Answer all five first'}
                className={`${BTN_TEXT} w-full justify-center border-zinc-600 bg-white py-2 text-black hover:bg-zinc-200`}
              >
                Generate
              </button>
              <p className="mt-1.5 text-[10px] text-zinc-600">
                A minute or so: ChatGPT answers while Pauv loads, and both recordings render together.
                {hasBuild && ' The video you have now goes when this one lands.'}
              </p>
            </>
          )}
          {jobError && <p className="mt-2 text-[11px] text-red-400">{jobError}</p>}
        </div>
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
