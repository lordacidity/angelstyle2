'use client';

// Vids 2 — a form, then a tuning page.
//
// Vids and Simpler both start on the builder: a stage with nothing on it, and
// cards to fill it from. Vids 2 starts on six questions instead, makes the
// whole video from the answers, and only then shows it — so the building is
// one press and everything after it is adjustment.
//
//   Form      one question at a time: who on Pauv, the mode (Serious, Middle
//             or Degen — not about the video so much as how it talks; Degen
//             turns the hook into a cry for help and lays three BOOMs over the
//             recordings), which way, light or dark, the persona, the
//             question. See Vids2Form.
//   Generate  the two screen recordings, both at once: ChatGPT looking them up
//             (Bottom A) and the Pauv trade (Bottom B). Neither needs anything
//             from the other, so neither waits for it. Both are rendered in
//             this tab, by the files that own them, and neither goes to the
//             library. Then the persona's three clips and an End off the
//             shelf, and the stage is a whole video.
//   Tune      Vids2Builder: the sound, the words, the BOOMs, the post caption
//             and Download. Change goes back to the form with the answers as
//             they were left.
//
// This section owns the two recordings' bytes: it made them, it lets them go
// when a second Generate replaces them, and again when the page is left.
// Nothing downstream releases a clip.
//
// It shares Simpler's build logic outright — lib/simpler/* plans, composes,
// captions and writes down every Vids 2 video, and the captions rail and post
// caption on the tuning page are Simpler's own components. That is the deal
// this section is built on: a change to how Simpler builds a video is a change
// to how Vids 2 builds one. What is Vids 2's alone is the form, the tuning
// page's shape, and lib/vids2 (the answers, the roster, and the trade
// recording as a Bottom B). See components/vids2/README.md.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVidsLibrary } from '@/app/hooks/useVidsLibrary';
import { Vids2Builder } from './Vids2Builder';
import { Vids2Form, type Vids2Job, type Vids2Leg } from './Vids2Form';
import {
  DEFAULT_TRIM, INTAKE_SPEED, LIBRARY_FOLDERS, PERSONA_PART_SLOT, SLOT_META,
  folderGroupIds, freshPick, type Picks, type SlotId,
} from '@/lib/simpler/vidsPlan';
import { PERSONA_PARTS, type VidPersona, type VidRow } from '@/lib/vids-types';
import { isLocalClip, makeLocalClip, releaseLocalClip } from '@/lib/simpler/vidsLocal';
import { makeChatGptClip } from '@/app/components/chatgpt/chatgpt-video';
import { bottomAContext, bottomAMarks, bottomAName } from '@/lib/simpler/vidsBottom';
import {
  loadSetup, makeTradeClip, saveSetup, setupReady,
  type Vids2Build, type Vids2Setup,
} from '@/lib/vids2/vids2Build';

const pickRandom = <T,>(xs: readonly T[]): T | undefined =>
  (xs.length ? xs[Math.floor(Math.random() * xs.length)] : undefined);

export function Vids2Section({ active }: { active: boolean }) {
  const lib = useVidsLibrary(active);
  const { loaded, loading, folders, videos, personas, ensureFolders } = lib;

  const [setup, setSetup] = useState<Vids2Setup>(loadSetup);
  const [picks, setPicks] = useState<Picks>({});
  const [build, setBuild] = useState<Vids2Build | null>(null);
  /** On the form rather than on the video. True until the first Generate, and
   *  again whenever Change is pressed — the build is kept behind it, so the
   *  way back is a button rather than another two minutes of rendering. */
  const [onForm, setOnForm] = useState(true);
  const [job, setJob] = useState<Vids2Job | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const jobRef = useRef<AbortController | null>(null);
  const ensuredRef = useRef(false);
  const buildNo = useRef(0);

  useEffect(() => { saveSetup(setup); }, [setup]);

  // The four library folders always exist at the top level. Vids 2 only reads
  // Persona and End (and Bottom B, for a BOOM filed by hand), but the library
  // is one library and it is the same four wherever they are made.
  useEffect(() => {
    if (!loaded || ensuredRef.current) return;
    ensuredRef.current = true;
    void ensureFolders([...LIBRARY_FOLDERS]);
  }, [loaded, ensureFolders]);

  // ── The two recordings' bytes ───────────────────────────────────────────────
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
    dropLocal(picksRef.current);
  }, []);

  // What the build actually uses. A pick stores the row it was made from, and a
  // library clip whose footage has been replaced keeps its id but arrives at a
  // new URL — so every slot is resolved against the library each render rather
  // than trusting that snapshot. A clip whose row has gone empties its slot;
  // new footage resets that slot's in / out points, since they pointed into
  // footage that no longer exists. The two recordings have no row to resolve
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

  /** Generate: both recordings, then the whole stage, then the tuning page.
   *
   *  The two are made at the same time. Neither needs anything from the other
   *  — the question goes to ChatGPT, the name goes to Pauv — and each spends a
   *  good part of its time waiting on something that is not the CPU (the model
   *  answering, the roster and the photos arriving), which is exactly the time
   *  the other one can be drawing frames in. They share the one thread, so the
   *  drawing itself still takes the drawing's time; what disappears is one
   *  wait sitting behind the other.
   *
   *  Nothing is put on the stage until both have come back, so a failure on
   *  either side leaves the form exactly as it was, with a reason on it,
   *  rather than half a video behind it. The first real failure aborts the
   *  pair, so the survivor stops rather than rendering for a build that will
   *  never be shown. */
  const generate = async () => {
    if (!setupReady(setup) || job) return;
    const persona = personas.find((p) => p.id === setup.personaId) ?? null;
    if (!persona) { setJobError('That persona is no longer in the library. Choose another.'); return; }
    const question = setup.question.trim();
    const { direction, theme, mode } = setup;

    jobRef.current?.abort();
    const ctrl = new AbortController();
    jobRef.current = ctrl;
    setJobError(null);
    setJob({
      chat: { label: 'Asking ChatGPT…', frac: null, done: false },
      trade: { label: 'Reading them off Pauv…', frac: null, done: false },
    });
    /** One of the two lines on the form, moved on its own. */
    const leg = (which: 'chat' | 'trade', next: Partial<Vids2Leg>) =>
      setJob((j) => (j ? { ...j, [which]: { ...j[which], ...next } } : j));
    /** A leg giving up because the other one already has. Not a failure, and
     *  not what the form should be told about. */
    const cancelled = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
    /** The first real failure takes the other one down with it. */
    const stopBoth = (e: unknown) => { if (!cancelled(e)) ctrl.abort(); throw e; };

    const chatP = makeChatGptClip({
      name: setup.person,
      direction,
      question,
      signal: ctrl.signal,
      onProgress: (p) => leg('chat', p.stage === 'ask'
        ? { label: 'Asking ChatGPT…', frac: null }
        : { label: 'Rendering the ChatGPT search', frac: p.frac }),
    }).then(
      (r) => { leg('chat', { label: 'ChatGPT search — done', frac: 1, done: true }); return r; },
      stopBoth,
    );
    const tradeP = makeTradeClip({
      name: setup.person,
      direction,
      theme,
      signal: ctrl.signal,
      onProgress: (p) => leg('trade', p.stage === 'load'
        ? { label: 'Reading them off Pauv…', frac: null }
        : { label: 'Rendering the Pauv trade', frac: p.frac }),
    }).then(
      (r) => { leg('trade', { label: 'Pauv trade — done', frac: 1, done: true }); return r; },
      stopBoth,
    );

    try {
      const [chatR, tradeR] = await Promise.allSettled([chatP, tradeP]);
      if (chatR.status !== 'fulfilled' || tradeR.status !== 'fulfilled') {
        // The trade makes its clip as it finishes, so a trade that landed
        // beside a ChatGPT that didn't is holding bytes nothing will show.
        if (tradeR.status === 'fulfilled') releaseLocalClip(tradeR.value.row);
        const failed = [chatR, tradeR].find(
          (r): r is PromiseRejectedResult => r.status === 'rejected' && !cancelled(r.reason),
        );
        // Nothing failed, so both were cancelled: the form says nothing.
        if (failed) throw failed.reason;
        return;
      }
      const chat = chatR.value;
      const trade = tradeR.value;

      // The name the answer led with ("Donald Trump" for "Trump") is what the
      // context says the answer was.
      const answer = chat.reply.picks[0]?.name.trim() || setup.person;
      const aRow = makeLocalClip(chat.blob, {
        name: bottomAName(setup.person, direction),
        context: bottomAContext(question, answer),
        marks: bottomAMarks(chat.beats, question, answer),
        duration: chat.seconds,
        width: chat.width,
        height: chat.height,
        // Its audio track is the keyboard under the typing and nothing else.
        hasSfx: true,
        poster: chat.poster,
      });

      const next: Picks = personaPicks(persona);
      next.bottomA = freshPick('bottomA', aRow);
      next.bottomB = {
        ...freshPick('bottomB', trade.row),
        // At the speed every filed Bottom B is rendered at (INTAKE_SPEED): a
        // screen recording of the site runs slow to watch back, and one made
        // here is the same recording as one made with a screen grabber.
        speed: INTAKE_SPEED,
        // Dead centre. The house nudges a Bottom B left (BOTTOM_B_LEFT)
        // because one filmed off a screen wants it; this one is the page
        // itself, drawn square on to fill the frame, and wants the middle.
        centred: true,
      };
      const end = pickRandom(clipsForSlot('end'));
      if (end) next.end = freshPick('end', end);

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
        question,
        mode,
        // The two renderers' own moments, in their own clip seconds. Degen
        // mode hangs its BOOMs on these; the tuning page is what works out
        // where each one falls on the finished timeline.
        beats: {
          chatPick: chat.beats.choosing.start,
          tradeOpen: trade.beats.analyzing.start,
          tradePlaced: trade.beats.confirming.start,
        },
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

      <div className="flex min-h-0 flex-1">
        {showForm && (
          <Vids2Form
            setup={setup}
            onChange={setSetup}
            personas={personas}
            resolveVideo={resolveVideo}
            libraryLoaded={loaded}
            job={job}
            jobError={jobError}
            onGenerate={() => void generate()}
            onCancel={cancel}
            hasBuild={!!build}
            onBack={() => setOnForm(false)}
          />
        )}

        {/* Hidden rather than unmounted while the form is up, the way
            StudioShell hides a section: the song, the words, the BOOMs and
            where each caption was dragged to are all the builder's own state,
            and pressing Change to re-read a question should not cost them.
            Inactive as well as hidden, so it stops playing and the space bar
            belongs to the form. */}
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
              onBackToForm={() => setOnForm(true)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
