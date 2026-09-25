'use client';

// Vids 2 — a form, then a tuning page.
//
// Vids and Simpler both start on the builder: a stage with nothing on it, and
// cards to fill it from. Vids 2 starts on five questions instead, makes the
// whole video from the answers, and only then shows it — so the building is
// one press and everything after it is adjustment.
//
//   Form      five cards, top to bottom, the open one always the next thing
//             to do: who on Pauv (by name, or off the trending list — a
//             story answers who and the intro both), the intro — nothing,
//             ChatGPT and a question, or a news story about them — which
//             way, the look (light, dark, or rolled), the mode (Serious,
//             Middle or Degen — not about the video so much as how it talks;
//             Degen turns the hook into a cry for help and lays BOOMs over
//             the recordings) and the persona. Pressing an answer moves the
//             form on. See Vids2Form. The look and the mode are the Studio's
//             questions alone: the clipper page rolls the one and is always
//             Middle for the other (LOOK_ASKED, MODE_ASKED and CLIPPER_MODE
//             in lib/vids2).
//   Generate  the screen recordings, all at once: the intro (Bottom A) —
//             ChatGPT looking them up, or the news story opened and read, or
//             nothing at all — and the Pauv trade (Bottom B), light or dark
//             as the Look card says, or rolled (themeFor). Neither needs
//             anything from the other, so neither waits for it. Both are
//             rendered in this tab, by the files that own them, and neither
//             goes to the library. Then the persona's three clips and an End
//             off the shelf, and the stage is a whole video. The captions and
//             the post captions are asked for while the frames are drawn — the
//             post captions and the hook the moment Generate is pressed — not
//             after (lib/vids2/vids2Words).
//   Tune      Vids2Builder: the sound, the words, the BOOMs, the post caption
//             and Download. Start over clears the answers and goes back to
//             the form.
//   Reset     top right on either page: Vids 2 as it opens. On the form it
//             is the Reset button this section draws; on the tuning page it
//             is the builder's own Start over, in the same corner. Both
//             clear every answer (the saved ones too), let the recordings
//             go, and mount the form fresh — the clipper page (app/clippers)
//             is this same section, so it has them as well.
//   Code      top left of the form only, and in the Studio only: the box a
//             downloaded video's code goes in (Vids2Recall). The record it
//             names fills the form again and Generate runs on it — the
//             recordings made afresh from the same answers, the words, the
//             look and the sound off the record (loadCode, and `restore` on
//             the build). A record short of an answer waits on the form
//             instead, and says what for. The clipper page has no box: a
//             clipper's video still gets its code, on the file name and the
//             caption, but bringing one back is the Studio's.
//
// This section owns the recordings' bytes: it made them, it lets them go
// when a second Generate replaces them, and again when the page is left.
// Nothing downstream releases a clip.
//
// It shares Simpler's build logic outright — lib/simpler/* plans, composes,
// captions and writes down every Vids 2 video, and the captions rail and post
// caption on the tuning page are Simpler's own components. That is the deal
// this section is built on: a change to how Simpler builds a video is a change
// to how Vids 2 builds one. What is Vids 2's alone is the form, the tuning
// page's shape, and lib/vids2 (the answers, the roster, the news story as a
// Bottom A and the trade recording as a Bottom B). See components/vids2/README.md.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVidsLibrary } from '@/app/hooks/useVidsLibrary';
import { CLIPPERS } from '@/lib/clipping';
import { CAPTION_STYLES } from '@/lib/simpler/vidsCaptions';
import { parseRecipeCode, suggestedFrom, type VidRecipe, type Vids2Answers } from '@/lib/vids-types';
import { Vids2Builder } from './Vids2Builder';
import { Vids2Form, type Vids2Job, type Vids2Leg } from './Vids2Form';
import { Vids2Recall } from './Vids2Recall';
import {
  DEFAULT_TRIM, INTAKE_SPEED, LIBRARY_FOLDERS, PERSONA_PART_SLOT, SLOT_META,
  buildPlan, folderGroupIds, freshPick, type Picks, type SlotId,
} from '@/lib/simpler/vidsPlan';
import { PERSONA_PARTS, isPhoto, type VidPersona, type VidRow } from '@/lib/vids-types';
import {
  isLocalClip, makeLocalClip, plannedClip, releaseLocalClip, type LocalClipMeta,
} from '@/lib/simpler/vidsLocal';
import { makeChatGptClip, type ClipPlan } from '@/app/components/chatgpt/chatgpt-video';
import type { Reply } from '@/app/components/chatgpt/reply';
import { bottomAContext, bottomAMarks, bottomAName } from '@/lib/simpler/vidsBottom';
import { isOutletId, outletById } from '@/lib/news/outlets';
import { getRecipe, writeHook, writePostCaptions } from '@/lib/vids-client';
import {
  EMPTY_SETUP, answersFromRecord, answersOf, bottomANewsName, loadSetup, makeNewsClip, makeTradeClip,
  readStoryAgain, sameVideo, saveSetup, setupFromAnswers, setupReady, storyFor, themeFor,
  type Direction, type Theme, type Vids2Build, type Vids2Setup, type Vids2Story,
} from '@/lib/vids2/vids2Build';
import {
  VIDS2_BARS, VIDS2_PACE, draftLines, personaContextOf, useEmojiPalette, type Vids2Early,
} from '@/lib/vids2/vids2Words';

const pickRandom = <T,>(xs: readonly T[]): T | undefined =>
  (xs.length ? xs[Math.floor(Math.random() * xs.length)] : undefined);

/** A promise and the means to settle it, for something that arrives by
 *  callback. Settling it a second time does nothing. */
function later<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** A call nobody may end up waiting on — its Generate failed, or the words it
 *  was for were typed by hand — marked as seen, so its failing isn't reported
 *  as unhandled. Whoever does wait on it still gets the failure. */
function quiet<T>(p: Promise<T>): Promise<T> {
  p.catch(() => { /* seen */ });
  return p;
}

/** The trade recording in its slot, the way every Vids 2 build has it. */
const tradePick = (row: VidRow) => ({
  ...freshPick('bottomB', row),
  // At the speed every filed Bottom B is rendered at (INTAKE_SPEED): a
  // screen recording of the site runs slow to watch back, and one made
  // here is the same recording as one made with a screen grabber.
  speed: INTAKE_SPEED,
  // Dead centre. The house nudges a Bottom B left (BOTTOM_B_LEFT)
  // because one filmed off a screen wants it; this one is the page
  // itself, drawn square on to fill the frame, and wants the middle.
  centred: true,
});

/** The intro, made: its clip for the stage, the first zoom pulse on their
 *  highlighted name (clip seconds, for degen mode's BOOM), and anything its
 *  renderer wanted said. */
interface IntroClip { row: VidRow; pick: number; notes: string[] }

/** A recording giving up because something else already has — not a failure,
 *  and not what anybody should be told about. */
const cancelled = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What the code box says — see loadCode. */
interface RecallState {
  busy: boolean;
  /** The record last brought back, and whatever about it did not come back whole. */
  loaded: VidRecipe | null;
  problems: string[];
  error: string | null;
}
const NO_RECALL: RecallState = { busy: false, loaded: null, problems: [], error: null };

/** An outlet's name for a record that names it — or the id as written, for
 *  one that has since left the approved list. */
const outletName = (id: string) => (isOutletId(id) ? outletById(id).name : id);

// ── The head start ──────────────────────────────────────────────────────────
// The two recordings are nearly the whole of what a Generate costs, and
// neither reads an answer the form asks late: the intro wants the intro, the
// trade wants who and which way. So each is started the moment its own
// answers are in — while the rest of the form is still being filled — and
// Generate takes what is already running rather than starting it. That is
// what the order of the questions is for (Vids2Form): answer the last one a
// minute later and there is nothing much left to wait for.
//
// A head start is a render and nothing else. Nothing goes on the stage, no
// words are written, no video is shown until Generate is pressed: it is the
// same recording a Generate would have made, made earlier.
//
// Each run is keyed by the answers it was started from (warmKey). Change one
// of them and the run is for a video nobody is making: it is dropped, its
// bytes let go, and the answer that replaced it starts its own once it
// settles. The one exception is which way a NEWS intro goes — those frames
// are the same either way and only the filed name carries it, so that run is
// kept and re-stamped rather than thrown away. A ChatGPT intro is not so
// lucky: the model is told which way before it writes a word, so flipping
// Which way after it has started does start it again.

/** One recording on its way, wherever it was started from. */
interface Run<T, L> {
  /** What it is being made for — see warmKey. */
  key: string;
  ctrl: AbortController;
  /** The clip as it will be filed, the moment the renderer has laid it out
   *  and before the frames — what the caption writer reads. */
  laid: Promise<L>;
  /** The recording itself. Marked as seen already (quiet): a head start
   *  nobody ever takes must not go off as an unhandled failure. */
  done: Promise<T>;
  /** What the line about it says right now. */
  leg: Vids2Leg;
  /** Where that line goes: the form's head-start row while it is only a head
   *  start, a running Generate's own progress once that has taken it. */
  sink: ((leg: Vids2Leg) => void) | null;
  /** What it left behind, once it has landed — so the bytes can be let go if
   *  the answers change before anybody takes it. */
  out: T | null;
  /** Why it stopped, if it did. A run that failed is never taken: Generate
   *  starts that recording again, and fails the way it always would have. */
  failed: string | null;
}
type IntroRun = Run<IntroClip, VidRow> & {
  /** Which way it was started for, and which outlet it is of — what a news
   *  run needs to be re-filed for the other way (stampName in generate).
   *  The outlet is null for ChatGPT, which is started again instead. */
  direction: Direction;
  outlet: string | null;
};
type TradeOut = Awaited<ReturnType<typeof makeTradeClip>>;
type TradeRun = Run<TradeOut, { row: VidRow; person: string }> & {
  /** Settled where the render starts rather than where Generate does, since
   *  by then the frames have already been drawn one way or the other: the
   *  Look card's answer, or — the card on Random, or not on the form at all
   *  — a roll made for this run (themeFor). */
  theme: Theme;
};

/** What each recording is being made for, as one string. Null when the
 *  answers it needs are not in, which is nothing to start. */
function warmKey(kind: 'intro' | 'trade', s: Vids2Setup): string | null {
  const person = s.person.trim().toLowerCase();
  if (!person) return null;
  // The look is in the trade's key: Light after Dark is a different
  // recording, and Random after either is a fresh roll. Random after Random
  // is the same key, so the run — and the roll it made — is kept.
  if (kind === 'trade') return `trade|${person}|${s.direction}|${s.look}`;
  if (s.intro === 'none') return null;
  if (s.intro === 'chatgpt') {
    const question = s.question.trim();
    return question ? `chatgpt|${person}|${s.direction}|${question}` : null;
  }
  const story = storyFor(s);
  // Which way is left out on purpose — see the note above.
  return story ? `news|${person}|${story.hit.url}` : null;
}

/** Start the intro recording — the call Generate would make, made here so
 *  that both callers make exactly the same one. */
function startIntroRun(key: string, spec: {
  person: string; direction: Direction; question: string; story: Vids2Story | null;
}): IntroRun {
  const ctrl = new AbortController();
  const laid = later<VidRow>();
  const run: IntroRun = {
    key,
    ctrl,
    laid: laid.promise,
    done: null as unknown as Promise<IntroClip>,
    leg: {
      label: spec.story ? 'Finding photos for the story…' : 'Asking ChatGPT…',
      frac: null,
      done: false,
    },
    sink: null,
    out: null,
    failed: null,
    direction: spec.direction,
    outlet: spec.story ? outletById(spec.story.article.outlet).name : null,
  };
  const note = (next: Partial<Vids2Leg>) => { run.leg = { ...run.leg, ...next }; run.sink?.(run.leg); };

  /** The ChatGPT recording as it is filed, bar its bytes and poster. */
  const chatMeta = (p: ClipPlan & { reply: Reply }): LocalClipMeta => {
    // The name the answer led with ("Donald Trump" for "Trump") is what the
    // context says the answer was.
    const answer = p.reply.picks[0]?.name.trim() || spec.person;
    return {
      name: bottomAName(spec.person, spec.direction),
      context: bottomAContext(spec.question, answer),
      marks: bottomAMarks(p.beats, spec.question, answer),
      duration: p.seconds,
      width: p.width,
      height: p.height,
      // Its audio track is the keyboard under the typing and nothing else.
      hasSfx: true,
    };
  };

  run.done = quiet(spec.story
    ? makeNewsClip({
      name: spec.person,
      direction: spec.direction,
      story: spec.story,
      signal: ctrl.signal,
      onProgress: (p) => note(p.stage === 'photos'
        ? { label: 'Finding photos for the story…', frac: null }
        : p.stage === 'layout'
          ? { label: 'Laying the pages out…', frac: null }
          : { label: 'Rendering the news story', frac: p.frac }),
      onPlanned: (meta) => laid.resolve(plannedClip(meta)),
    }).then((r) => {
      note({ label: 'News story — done', frac: 1, done: true });
      laid.resolve(r.row);
      return { row: r.row, pick: r.pulseAt, notes: r.notes };
    })
    : makeChatGptClip({
      name: spec.person,
      direction: spec.direction,
      question: spec.question,
      signal: ctrl.signal,
      onProgress: (p) => note(p.stage === 'ask'
        ? { label: 'Asking ChatGPT…', frac: null }
        : { label: 'Rendering the ChatGPT search', frac: p.frac }),
      onPlanned: (p) => laid.resolve(plannedClip(chatMeta(p))),
    }).then((chat) => {
      note({ label: 'ChatGPT search — done', frac: 1, done: true });
      const row = makeLocalClip(chat.blob, { ...chatMeta(chat), poster: chat.poster });
      laid.resolve(row);
      // Degen's first BOOM waits for the zoom on the name, not the drag.
      return { row, pick: chat.pulseAt, notes: [] };
    }));
  watchRun(run);
  return run;
}

/** Start the trade recording. As above: one call, two callers. */
function startTradeRun(key: string, spec: { person: string; direction: Direction; theme: Theme }): TradeRun {
  const ctrl = new AbortController();
  const laid = later<{ row: VidRow; person: string }>();
  const run: TradeRun = {
    key,
    ctrl,
    laid: laid.promise,
    done: null as unknown as Promise<TradeOut>,
    leg: { label: 'Reading them off Pauv…', frac: null, done: false },
    sink: null,
    out: null,
    failed: null,
    theme: spec.theme,
  };
  const note = (next: Partial<Vids2Leg>) => { run.leg = { ...run.leg, ...next }; run.sink?.(run.leg); };
  run.done = quiet(makeTradeClip({
    name: spec.person,
    direction: spec.direction,
    theme: spec.theme,
    signal: ctrl.signal,
    onProgress: (p) => note(p.stage === 'load'
      ? { label: 'Reading them off Pauv…', frac: null }
      : { label: 'Rendering the Pauv trade', frac: p.frac }),
    onPlanned: (meta, person) => laid.resolve({ row: plannedClip(meta), person: person.name }),
  }).then((r) => {
    note({ label: 'Pauv trade — done', frac: 1, done: true });
    laid.resolve({ row: r.row, person: r.person.name });
    return r;
  }));
  watchRun(run);
  return run;
}

/** Stop a run and let go of whatever it made. Safe whether it is still going,
 *  has already landed, or lands a moment after being told to stop. */
function stopRun(run: Run<{ row: VidRow }, unknown> | null): void {
  if (!run) return;
  run.sink = null;
  run.ctrl.abort();
  if (run.out) releaseLocalClip(run.out.row);
  // A render is a few frames past the abort at worst, and those frames still
  // make a clip — which nobody is going to show.
  else void run.done.then((out) => releaseLocalClip(out.row), () => { /* never landed */ });
}

/** What every run does with its own ending: hold on to what it made, so
 *  whoever is holding the run can let the bytes go, and say so on its line
 *  when it stopped for a reason. */
function watchRun<T extends { row: VidRow }, L>(run: Run<T, L>): void {
  run.done.then(
    (out) => { run.out = out; },
    (e) => {
      if (cancelled(e)) return;
      run.failed = msg(e);
      run.leg = { label: `Stopped — Generate will try again: ${run.failed}`, frac: null, done: false };
      run.sink?.(run.leg);
    },
  );
}

export function Vids2Section({ active }: { active: boolean }) {
  const lib = useVidsLibrary(active);
  const { loaded, loading, folders, videos, personas, ensureFolders } = lib;

  // The caption looks this build may draw in. The Studio has all of them; the
  // clipper page at pauv.io/clipping has the ones switched on for the clippers
  // (Studio > Vids > Clippers). The clips, personas and songs are narrowed
  // server side — a look has no row of its own, only a flag against an id named
  // in code, so it is narrowed here off the flags the library brings with it.
  //
  // With nothing switched on it is the default look alone rather than none: a
  // clipper with no look to draw in has no video either, and one house look is
  // a better answer to an empty list than a dead page.
  /** The five names Vids 2 puts up before a search — see the Clippers page.
   *  Same flags the looks come from, so they arrive with the library. */
  const suggested = useMemo(() => suggestedFrom(lib.clipable), [lib.clipable]);

  const looks = useMemo(() => {
    if (!CLIPPERS) return CAPTION_STYLES;
    const on = new Set(lib.clipable.filter((c) => c.kind === 'captionStyle').map((c) => c.key));
    const offered = CAPTION_STYLES.filter((s) => on.has(s.id));
    return offered.length ? offered : CAPTION_STYLES.slice(0, 1);
  }, [lib.clipable]);

  const [setup, setSetup] = useState<Vids2Setup>(loadSetup);
  const [picks, setPicks] = useState<Picks>({});
  const [build, setBuild] = useState<Vids2Build | null>(null);
  /** On the form rather than on the video. True until the first Generate, and
   *  again after Reset, which lets the video go as well (see `reset`). */
  const [onForm, setOnForm] = useState(true);
  /** Bumped by Reset: the form is keyed on it, so it mounts anew — its
   *  searches, its trending list, a typed question and a drawn page are its
   *  own state, and a reset that left them standing would not be one. */
  const [formKey, setFormKey] = useState(0);
  const [job, setJob] = useState<Vids2Job | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const jobRef = useRef<AbortController | null>(null);
  const ensuredRef = useRef(false);
  const buildNo = useRef(0);
  // For the captions Generate asks for while the recordings render.
  const emojiPalette = useEmojiPalette();

  // ── A code typed in ─────────────────────────────────────────────────────
  // See loadCode. `pending` is the record waiting for a Generate — taken by
  // the next one, whether loadCode pressed it or somebody did after answering
  // what the record was short of — and `recall` is what the box says.
  const [recall, setRecall] = useState<RecallState>(NO_RECALL);
  const pendingRef = useRef<{ recipe: VidRecipe; answers: Vids2Answers } | null>(null);
  const recallRef = useRef<AbortController | null>(null);

  useEffect(() => { saveSetup(setup); }, [setup]);

  // The four library folders always exist at the top level. Vids 2 only reads
  // Persona and End (and Bottom B, for a BOOM filed by hand), but the library
  // is one library and it is the same four wherever they are made.
  useEffect(() => {
    if (!loaded || ensuredRef.current) return;
    ensuredRef.current = true;
    void ensureFolders([...LIBRARY_FOLDERS]);
  }, [loaded, ensureFolders]);

  // ── The recordings' bytes ───────────────────────────────────────────────────
  // They live in this tab and nowhere else (lib/simpler/vidsLocal). Whoever
  // made them lets them go, which is here: when a second Generate replaces
  // them, and when the page is left.
  const picksRef = useRef(picks);
  useEffect(() => { picksRef.current = picks; }, [picks]);
  const dropLocal = (from: Picks) => {
    for (const p of [from.bottomA, from.bottomB]) {
      if (p && isLocalClip(p.video)) releaseLocalClip(p.video);
    }
  };
  useEffect(() => () => {
    jobRef.current?.abort();
    recallRef.current?.abort();
    dropLocal(picksRef.current);
    stopRun(warmRef.current.intro);
    stopRun(warmRef.current.trade);
  }, []);

  // What the build actually uses. A pick stores the row it was made from, and a
  // library clip whose footage has been replaced keeps its id but arrives at a
  // new URL — so every slot is resolved against the library each render rather
  // than trusting that snapshot. A clip whose row has gone empties its slot;
  // new footage resets that slot's in / out points, since they pointed into
  // footage that no longer exists. The recordings have no row to resolve
  // against and pass through as they are.
  const livePicks = useMemo(() => {
    let changed = false;
    const next: Picks = {};
    for (const slot of Object.keys(picks) as SlotId[]) {
      const pick = picks[slot];
      if (!pick) continue;
      if (isLocalClip(pick.video)) { next[slot] = pick; continue; }
      const cur = videos.find((v) => v.id === pick.video.id);
      if (!cur) { changed = true; continue; }
      const sameFootage = cur.url === pick.video.url;
      if (sameFootage && cur.name === pick.video.name && cur.duration === pick.video.duration) {
        next[slot] = pick;
        continue;
      }
      next[slot] = sameFootage
        ? { ...pick, video: cur }
        : { ...pick, video: cur, trim: { ...DEFAULT_TRIM } };
      changed = true;
    }
    return changed ? next : picks;
  }, [picks, videos]);

  // Which persona the three top slots currently hold. Derived rather than
  // stored, so a part swapped out from under it silently drops the badge
  // instead of claiming a persona that is no longer really in use.
  const appliedPersonaId = useMemo(() => {
    const found = personas.find((p) => {
      const parts = PERSONA_PARTS.filter((k) => p[k]);
      if (parts.length === 0) return false;
      return PERSONA_PARTS.every((k) => livePicks[PERSONA_PART_SLOT[k]]?.video.id === (p[k] ?? undefined));
    });
    return found?.id ?? null;
  }, [personas, livePicks]);

  const onPicksChange = useCallback((updater: (prev: Picks) => Picks) => setPicks(updater), []);
  const resolveVideo = useCallback((id: string) => videos.find((v) => v.id === id), [videos]);

  // Everything filed under a slot's folder, sub-folders included.
  const clipsForSlot = useCallback((slot: SlotId): VidRow[] => {
    const ids = folderGroupIds(folders, SLOT_META[slot].folder);
    return videos.filter((v) => v.folderId && ids.has(v.folderId));
  }, [folders, videos]);

  /** The persona's three clips, as far as the library has them. */
  const personaPicks = (persona: VidPersona): Picks => {
    const out: Picks = {};
    for (const part of PERSONA_PARTS) {
      const id = persona[part];
      const video = id ? videos.find((v) => v.id === id) : undefined;
      const slot = PERSONA_PART_SLOT[part];
      if (video) out[slot] = freshPick(slot, video);
    }
    return out;
  };

  const cancel = () => {
    jobRef.current?.abort();
    jobRef.current = null;
    setJob(null);
  };

  // ── The head start ────────────────────────────────────────────────────
  // The recordings already going before Generate was pressed — see the note
  // above startIntroRun. The runs themselves are a ref: they are not what the
  // page draws, and a render is not a reason to make one again. What the page
  // draws is `warm`, the line each of them is on, which the form shows so
  // that work being done in the background is work somebody can see.
  const warmRef = useRef<{ intro: IntroRun | null; trade: TradeRun | null }>({ intro: null, trade: null });
  const [warm, setWarm] = useState<{ intro: Vids2Leg | null; trade: Vids2Leg | null }>({ intro: null, trade: null });

  const dropWarm = (kind: 'intro' | 'trade') => {
    if (!warmRef.current[kind]) return;
    stopRun(warmRef.current[kind]);
    warmRef.current[kind] = null;
    setWarm((w) => (w[kind] ? { ...w, [kind]: null } : w));
  };

  /** Start one recording for these answers, unless one for exactly them is
   *  already going — or has already finished. */
  const startWarm = (kind: 'intro' | 'trade', s: Vids2Setup) => {
    const key = warmKey(kind, s);
    if (warmRef.current[kind]?.key === key) return;
    dropWarm(kind);
    if (!key) return;
    if (kind === 'intro') {
      const run = startIntroRun(key, {
        person: s.person,
        direction: s.direction,
        question: s.question.trim(),
        // A story kept from before is not the answer unless the intro IS the
        // story: what decides which recording this is, is the intro.
        story: s.intro === 'news' ? storyFor(s) : null,
      });
      run.sink = (leg) => setWarm((w) => ({ ...w, intro: leg }));
      warmRef.current.intro = run;
      setWarm((w) => ({ ...w, intro: run.leg }));
    } else {
      const run = startTradeRun(key, { person: s.person, direction: s.direction, theme: themeFor(s) });
      run.sink = (leg) => setWarm((w) => ({ ...w, trade: leg }));
      warmRef.current.trade = run;
      setWarm((w) => ({ ...w, trade: run.leg }));
    }
  };

  /** An answer has settled, so whatever it was the last of can start being
   *  rendered: the intro once the intro is answered, the trade once which way
   *  is. The form says when (Vids2Form onHeadStart) and hands the answers
   *  over as they are at that moment.
   *
   *  The other recording is looked at too, because a settled answer can be
   *  the undoing of one already going: the model is told which way before it
   *  writes a word of a ChatGPT intro, so pressing Which way at question 3
   *  starts the intro from question 2 again. Only here, where an answer has
   *  settled — a question being retyped drops its run and waits (the effect
   *  below), rather than starting a render on every letter. */
  const headStart = (kind: 'intro' | 'trade', s: Vids2Setup) => {
    // A Generate owns the renderers while it runs, and it has taken whatever
    // was going already.
    if (jobRef.current) return;
    startWarm(kind, s);
    const other = kind === 'intro' ? 'trade' : 'intro';
    // Only one that is already going: the other question has not been
    // answered yet if there is nothing running for it.
    if (warmRef.current[other]) startWarm(other, s);
  };

  /** The head start for these answers, handed over to a Generate: it is the
   *  caller's to finish and the caller's to let go. Null when there is none,
   *  when it was started for answers that have since changed, or when it
   *  stopped on a failure — in which case Generate makes that recording
   *  itself, and fails the way it would have anyway. */
  const takeWarm = (kind: 'intro' | 'trade', s: Vids2Setup): IntroRun | TradeRun | null => {
    const run = warmRef.current[kind];
    if (!run) return null;
    if (run.key !== warmKey(kind, s) || run.failed) { dropWarm(kind); return null; }
    warmRef.current[kind] = null;
    setWarm((w) => ({ ...w, [kind]: null }));
    return run;
  };

  // An answer changed under a head start: it is a recording for a video
  // nobody is making. Dropped rather than started again — what replaced it
  // starts its own when it settles, and a half-typed question is not an
  // answer that has settled.
  useEffect(() => {
    if (jobRef.current) return;
    if (warmRef.current.intro && warmRef.current.intro.key !== warmKey('intro', setup)) dropWarm('intro');
    if (warmRef.current.trade && warmRef.current.trade.key !== warmKey('trade', setup)) dropWarm('trade');
  }, [setup]);

  /** Reset, top right of either page: Vids 2 as it opens. The answers go
   *  back to empty (and are saved that way), the recordings are let go, and
   *  the build goes — which unmounts the tuning page and everything it was
   *  holding (the song, the words, the BOOMs) — so the form mounts fresh on
   *  its first card. */
  const reset = () => {
    cancel();
    dropWarm('intro');
    dropWarm('trade');
    dropLocal(picksRef.current);
    // A code on its way in, or waiting for Generate, goes with the answers
    // it was for.
    recallRef.current?.abort();
    recallRef.current = null;
    pendingRef.current = null;
    setRecall(NO_RECALL);
    setPicks({});
    setBuild(null);
    setSetup(EMPTY_SETUP);
    setJobError(null);
    setOnForm(true);
    setFormKey((k) => k + 1);
  };

  /** The form's Reset. A Generate under way is the one thing on the form
   *  worth asking about before it is thrown away; answers are a few presses
   *  to give again, so they go without a word. */
  const resetForm = () => {
    if (job && !window.confirm('Reset? The video being made is dropped, and every answer is cleared.')) return;
    reset();
  };

  /** A code typed into the box (Vids2Recall): the record it names, back on
   *  the form, and Generate pressed for it when nothing is missing.
   *
   *  What comes back is the answers — whole, on a record written since they
   *  were kept; most of them, read off the clip names, on one from before
   *  (answersFromRecord) — with the story read off its outlet again, since a
   *  record carries only its address, and the persona by its id, if the
   *  library still has it. The form is mounted afresh on them, folded, the
   *  way it opens on a return visit. Then, with every answer in, Generate,
   *  which takes the record as it goes (pendingRef) and hands it to the
   *  tuning page, so the words, the look and the sound are the record's
   *  rather than rolled and asked for. Short of an answer — the persona gone,
   *  the story unreadable, the question never written down — it stops on the
   *  form with the reason on the box, and the next Generate takes the record
   *  if the answers are still that video's (sameVideo). */
  const loadCode = async (raw: string) => {
    const code = parseRecipeCode(raw);
    if (!code) {
      setRecall((r) => ({
        ...r,
        error: 'A code is six letters and numbers, like K7Q4M2 — it sits after the title of every downloaded video, and on the end of its caption.',
      }));
      return;
    }
    if (!loaded) {
      setRecall((r) => ({ ...r, error: 'The library is still loading — give it a moment and try again.' }));
      return;
    }
    if (job && !window.confirm(`Drop the video being made and bring back ${code} instead?`)) return;
    cancel();
    recallRef.current?.abort();
    const ctrl = new AbortController();
    recallRef.current = ctrl;
    pendingRef.current = null;
    setRecall((r) => ({ ...r, busy: true, error: null }));
    try {
      const recipe = await getRecipe(code);
      if (ctrl.signal.aborted) return;
      const read = answersFromRecord(recipe.build);
      if (!read) {
        throw new Error(`${code} is a Vids build, not a Vids 2 one — only a video made here can be brought back here.`);
      }
      const { answers, problems } = read;
      const wanted = recipe.build.persona;
      const persona = wanted ? personas.find((p) => p.id === wanted.id) ?? null : null;
      if (!persona) {
        problems.push(wanted
          ? `Persona “${wanted.name}” is no longer in the library — choose another, then press Generate.`
          : 'No persona was written down with it — choose one, then press Generate.');
      }
      let story: Vids2Story | null = null;
      if (answers.intro === 'news' && answers.story) {
        try {
          story = await readStoryAgain(answers.person, answers.story.url, ctrl.signal);
        } catch (e) {
          if (cancelled(e)) return;
          problems.push(
            `The ${outletName(answers.story.outlet)} story “${answers.story.title}” can't be read any more (${msg(e)}) — find another, then press Generate.`,
          );
        }
      }
      if (ctrl.signal.aborted) return;
      const next = setupFromAnswers(setup, answers, persona?.id ?? null, story);
      setSetup(next);
      setJobError(null);
      // Mounted afresh on the answers: every card folded, and Generate lit
      // once nothing is missing — the way the form opens on a return visit.
      setFormKey((k) => k + 1);
      pendingRef.current = { recipe, answers };
      setRecall({ busy: false, loaded: recipe, problems, error: null });
      if (setupReady(next)) void generate(next);
    } catch (e) {
      if (cancelled(e)) return;
      setRecall((r) => ({ ...r, busy: false, error: msg(e) }));
    } finally {
      if (recallRef.current === ctrl) recallRef.current = null;
    }
  };

  /** Generate: the recordings, then the whole stage, then the tuning page.
   *
   *  The intro and the trade are made at the same time. Neither needs
   *  anything from the other — the question goes to ChatGPT, the story goes
   *  to Google and the outlet, the name goes to Pauv — and each spends a good
   *  part of its time waiting on something that is not the CPU (the model
   *  answering, the photos, the roster arriving), which is exactly the time
   *  the other one can be drawing frames in. They share the one thread, so
   *  the drawing itself still takes the drawing's time; what disappears is
   *  one wait sitting behind the other. With no intro there is only the
   *  trade, and nothing to wait beside.
   *
   *  Nothing is put on the stage until every recording has come back, so a
   *  failure on either side leaves the form exactly as it was, with a reason
   *  on it, rather than half a video behind it. The first real failure aborts
   *  the pair, so the survivor stops rather than rendering for a build that
   *  will never be shown.
   *
   *  The words don't wait for any of it (lib/vids2/vids2Words). The hook and
   *  the post captions are asked for the moment this is pressed — they are
   *  written off who, which way, the mode and the persona, and neither
   *  recording adds to that. The rest of the captions go the moment both
   *  recordings have laid themselves out, which each does before drawing its first frame
   *  (onPlanned): that is when their lengths and beats are known, and those
   *  are all the writers read off them. The frames are the long part, so the
   *  words are mostly back by the time the stage is, and the tuning page
   *  takes them (Vids2Early) rather than asking again. A failure or a cancel
   *  aborts them along with the recordings; one of them failing fails
   *  nothing but itself. */
  const generate = async (from: Vids2Setup) => {
    // The ref rather than the state: loadCode cancels a job and presses this
    // in the same breath, before the state has caught up.
    if (!setupReady(from) || jobRef.current) return;
    const persona = personas.find((p) => p.id === from.personaId) ?? null;
    if (!persona) { setJobError('That persona is no longer in the library. Choose another.'); return; }
    const { direction, mode, intro } = from;
    const question = intro === 'chatgpt' ? from.question.trim() : '';
    const story = intro === 'news' ? storyFor(from) : null;
    if (intro === 'news' && !story) { setJobError('Choose a story first.'); return; }
    const tradeKey = warmKey('trade', from);
    if (!tradeKey) return; // setupReady has already said there is a person
    // A record brought back by its code (loadCode), if these are still the
    // answers it was of (sameVideo): Pauv comes up the way it did, and the
    // tuning page puts its words, look and sound on rather than rolling and
    // asking. Taken once, by whichever Generate is next.
    const pending = pendingRef.current;
    pendingRef.current = null;
    const restore = pending && sameVideo(from, pending.answers) ? pending : null;

    // Each recording as it stands: the one already running for these answers,
    // taken over, or a new one started here the way it always was. Light or
    // dark is whatever the Look card says — and where it says Random, or
    // isn't on the form, whichever run draws the trade rolled it (themeFor),
    // here or a minute ago.
    const introRun = intro === 'none' ? null
      : (takeWarm('intro', from) as IntroRun | null) ?? startIntroRun(warmKey('intro', from) ?? '', {
        person: from.person, direction, question, story,
      });
    // A brought-back video has Pauv the way it came up the first time. In the
    // Studio the Look card was set to that way with the rest of the record's
    // answers, so the head start already drew it so; on the clipper page the
    // head start rolled, and is let go unless the roll happened to land on
    // it. The intro's frames are the same either way, and it is taken.
    if (restore && warmRef.current.trade && warmRef.current.trade.theme !== restore.answers.theme) dropWarm('trade');
    const tradeRun = (takeWarm('trade', from) as TradeRun | null) ?? startTradeRun(tradeKey, {
      person: from.person, direction, theme: restore?.answers.theme ?? themeFor(from),
    });
    const theme = tradeRun.theme;
    /** A news head start begun before Which way was asked carries the other
     *  way in its filed name, and nothing else: the frames are the same
     *  either way. So it is re-stamped rather than thrown away. Every other
     *  run was started for this direction and passes straight through. */
    const stamp = (row: VidRow): VidRow =>
      introRun?.outlet && introRun.direction !== direction
        ? { ...row, name: bottomANewsName(from.person, direction, introRun.outlet) }
        : row;

    const ctrl = new AbortController();
    jobRef.current = ctrl;
    setJobError(null);
    // Whatever each run has got to by now: one that has been going since the
    // form was halfway through says so, rather than starting its line again
    // at nothing.
    setJob({ intro: introRun?.leg ?? null, trade: tradeRun.leg });
    /** One of the lines on the form, moved on its own. */
    const leg = (which: 'intro' | 'trade', next: Partial<Vids2Leg>) =>
      setJob((j) => (j && j[which] ? { ...j, [which]: { ...j[which], ...next } } : j));
    // From here the runs report to the form's progress rather than to the
    // head-start row, which is gone the moment they were taken.
    if (introRun) introRun.sink = (l) => leg('intro', l);
    tradeRun.sink = (l) => leg('trade', l);
    // Cancel stops both renders wherever they were started from.
    ctrl.signal.addEventListener('abort', () => { introRun?.ctrl.abort(); tradeRun.ctrl.abort(); });
    /** The first real failure takes the other one down with it. */
    const stopBoth = (e: unknown) => { if (!cancelled(e)) ctrl.abort(); throw e; };

    // The rest of the stage — the persona's three clips and an End — settled
    // now rather than once the recordings are back: the words are written
    // against the whole video, and these are most of it.
    const base = personaPicks(persona);
    const end = pickRandom(clipsForSlot('end'));
    if (end) base.end = freshPick('end', end);
    const personaContext = personaContextOf(persona, base);

    // The hook and the post captions need nothing either recording has, so
    // they go now, and the whole render is theirs to come back in. A video
    // brought back has its hook on the record already; the post captions are
    // not on it, and are written fresh the way they always are.
    const hook: Vids2Early['hook'] = restore ? null : {
      person: from.person,
      start: quiet(writeHook({ mode, person: from.person, direction, personaContext }, ctrl.signal)
        .then((r) => r.start)),
    };
    // Who and which way told outright, so the route goes straight to the news
    // search without reading them off the recordings first; fresh, so a second
    // video on them today gets words of its own.
    const post: Vids2Early['post'] = {
      person: from.person,
      position: direction,
      draft: quiet(writePostCaptions({ person: from.person, position: direction, fresh: true }, ctrl.signal)),
    };

    // Each recording as the plan will see it, the moment it was laid out —
    // which for a head start was before Generate was pressed. Then the rest
    // of the captions, off the stage those recordings will make. Handed back
    // inside an object: a promise returned bare from .then would be waited
    // on, and the stage would wait for the words.
    const introLaid: Promise<VidRow | null> = introRun ? introRun.laid.then(stamp) : Promise.resolve(null);
    const linesP = quiet(Promise.all([introLaid, tradeRun.laid]).then(([introRow, trade]) => {
      const draft: Picks = { ...base, bottomB: tradePick(trade.row) };
      if (introRow) draft.bottomA = freshPick('bottomA', introRow);
      // The captions are timed against the clips' lengths, so they are only
      // drafted here when every length is known up front — the recordings'
      // always are, the library's nearly always. Otherwise the tuning page
      // waits for the browser to measure them, as it always has.
      const known = Object.values(draft).every((p) => !p || isPhoto(p.video) || (p.video.duration ?? 0) > 0);
      // A brought-back video's words are on the record: nothing is drafted.
      return {
        lines: known && !restore ? quiet(draftLines({
          plan: buildPlan(draft, {}, VIDS2_BARS, VIDS2_PACE),
          picks: draft,
          pace: VIDS2_PACE,
          intro,
          person: trade.person,
          direction,
          personaName: persona.name,
          personaContext,
          emojiPalette,
          signal: ctrl.signal,
        })) : null,
      };
    }));

    // The recordings themselves. A failure on either side stops the other:
    // the survivor would be rendering for a build that is never going to be
    // shown.
    const introP: Promise<IntroClip | null> = introRun ? introRun.done.catch(stopBoth) : Promise.resolve(null);
    const tradeP = tradeRun.done.catch(stopBoth);

    try {
      const [introR, tradeR] = await Promise.allSettled([introP, tradeP]);
      if (introR.status !== 'fulfilled' || tradeR.status !== 'fulfilled') {
        // Each makes its clip as it finishes, so one that landed beside one
        // that didn't is holding bytes nothing will show.
        if (tradeR.status === 'fulfilled') releaseLocalClip(tradeR.value.row);
        if (introR.status === 'fulfilled' && introR.value) releaseLocalClip(introR.value.row);
        const failed = [introR, tradeR].find(
          (r): r is PromiseRejectedResult => r.status === 'rejected' && !cancelled(r.reason),
        );
        // Nothing failed, so both were cancelled: the form says nothing.
        if (failed) throw failed.reason;
        return;
      }
      const introClip = introR.value;
      const trade = tradeR.value;

      const next: Picks = { ...base, bottomB: tradePick(trade.row) };
      if (introClip) next.bottomA = freshPick('bottomA', stamp(introClip.row));
      // Settled already — both recordings were laid out before their first
      // frame — and never a reason for Generate to fail.
      const { lines } = await linesP.catch(() => ({ lines: null }));

      // The video before this one goes now rather than at any point earlier:
      // until here, a failure still had the old one to fall back on.
      dropLocal(picksRef.current);
      setPicks(next);
      setBuild({
        id: ++buildNo.current,
        // Pauv's spelling of them, which is what the recording shows and what
        // the captions should say.
        person: trade.person.name,
        direction,
        theme,
        intro,
        question,
        story: story ? { outlet: outletById(story.article.outlet).name, headline: story.article.headline } : null,
        notes: introClip?.notes ?? [],
        mode,
        // The renderers' own moments, in their own clip seconds. Degen mode
        // hangs its BOOMs on these; the tuning page is what works out where
        // each one falls on the finished timeline.
        beats: {
          introPick: introClip?.pick ?? null,
          tradeOpen: trade.beats.analyzing.start,
          tradePlaced: trade.beats.confirming.start,
        },
        early: { hook, lines, post },
        // What the export writes down, so a code brings this video back —
        // and the record this one was brought back from, if it was.
        answers: answersOf(from, { person: trade.person.name, question, story, theme }),
        restore: restore?.recipe ?? null,
      });
      setOnForm(false);
    } catch (e) {
      if (!cancelled(e)) setJobError(e instanceof Error ? e.message : String(e));
    } finally {
      if (jobRef.current === ctrl) { jobRef.current = null; setJob(null); }
    }
  };

  const showForm = onForm || !build;

  return (
    <div className="vids2-root vids-scroll relative flex h-full flex-col text-white">
      {/* No page header: the form, and then the builder, fill the window. */}
      {loaded && loading && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2">
          <p className="rounded-md border border-zinc-800 bg-zinc-950/90 px-3 py-1.5 text-[10px] text-zinc-500 backdrop-blur">
            Refreshing the library…
          </p>
        </div>
      )}

      {/* Reset, top right, while the form is up. The tuning page has its own
          in the same corner (Vids2Builder's Start over), so this one steps
          aside for it rather than sitting on top of it. */}
      {showForm && (
        <button
          type="button"
          onClick={resetForm}
          title="Clear every answer and start again"
          className="absolute right-3 top-3 z-30 rounded-lg border border-zinc-700 bg-zinc-950/90 px-2.5 py-1 text-xs font-semibold text-zinc-300 backdrop-blur transition-colors hover:border-zinc-500 hover:text-white"
        >
          Reset
        </button>
      )}

      {/* The code box, top left, while the form is up: a downloaded video's
          code brings it back (loadCode). The tuning page has no use for it —
          it has a video on it — and Start over is the way back to here. Not
          on the clipper page: the box is the Studio's, and a build-time flag
          rather than a prop so the clipper bundle doesn't carry it. */}
      {showForm && !CLIPPERS && (
        <Vids2Recall
          disabled={!loaded}
          busy={recall.busy}
          loaded={recall.loaded}
          problems={recall.problems}
          error={recall.error}
          onLoad={(raw) => void loadCode(raw)}
        />
      )}

      <div className="flex min-h-0 flex-1">
        {showForm && (
          <Vids2Form
            key={formKey}
            setup={setup}
            onChange={setSetup}
            personas={personas}
            resolveVideo={resolveVideo}
            libraryLoaded={loaded}
            suggested={suggested}
            job={job}
            jobError={jobError}
            warm={warm}
            onHeadStart={headStart}
            onGenerate={() => void generate(setup)}
            onCancel={cancel}
          />
        )}

        {/* Hidden rather than unmounted while the form is up, the way
            StudioShell hides a section: the song, the words, the BOOMs and
            where each caption was dragged to are all the builder's own state.
            Inactive as well as hidden, so it stops playing and the space bar
            belongs to the form. Reset is what unmounts it, on purpose. */}
        {build && (
          <div
            className="flex min-h-0 min-w-0 flex-1"
            style={{ display: showForm ? 'none' : undefined }}
          >
            <Vids2Builder
              picks={livePicks}
              onPicksChange={onPicksChange}
              clipsForSlot={clipsForSlot}
              personas={personas}
              appliedPersonaId={appliedPersonaId}
              active={active && !showForm}
              libraryLoaded={loaded}
              build={build}
              onReset={reset}
              looks={looks}
            />
          </div>
        )}
      </div>
    </div>
  );
}
