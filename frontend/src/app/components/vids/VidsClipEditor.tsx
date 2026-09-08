'use client';

// VidsClipEditor — the middle + right of the Prep page: one clip open, with
// everything you can do to it before it goes in a folder.
//
//   Middle   the picture, transport, and a timeline of the SOURCE clip. Grey
//            ends are what the trim has taken off; red blocks are cuts — chunks
//            removed from the middle. Sweeping the track scrubs the picture
//            itself, so you find a moment by looking at it rather than by
//            guessing; the playhead stays put and the picture returns to it when
//            the pointer leaves. Drag across the track to select a range, then
//            Cut it. The playhead skips cuts while it plays, so the preview
//            shows exactly the clip you are about to save.
//            Select a range and press C to cut it, Q to lay the keyboard sound
//            over it — the typing loops under that stretch and you hear it as
//            the preview runs through — or G to say what is happening in it.
//            A G mark is what the caption writer times against: the line it
//            writes for a mark lands over exactly that stretch of the build.
//            A legend under the picture spells the keys out in bold, so which
//            does what is read rather than remembered. Beside Play, a button
//            runs the clip again from its first kept frame. Ctrl+Z puts back
//            the last change; Start over, at the top of the right column, puts
//            back every change since the clip opened or was last saved.
//   Right    speed, the in / out points, the list of cuts, the stretches
//            carrying keys, the context this footage carries, and Save. The
//            clip's own audio is never an option: Vids are silent apart from
//            the keyboard you put on them.
//
// Save renders the edit in the browser (lib/vidsEdit) and puts the result back
// over the clip it came from: the row keeps its id, so the folder it is filed in
// and any persona part pointing at it come through untouched. Editing a clip
// changes that clip — it never leaves a second copy behind to tidy up.
//
// mode="trim" strips all of that back to the in / out points and Save, which is
// the whole job for the three clips of a persona: they are one performance
// carrying one context, so there is nothing to cut, score, mark or speed up.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { VidContext, VidContextPatch, VidMark, VidRow } from '@/lib/vids-types';
import { MAX_MARK_TEXT } from '@/lib/vids-types';
import {
  AUTO_CUT_COUNT, AUTO_CUT_MAX, AUTO_CUT_MIN, DEFAULT_EDIT, MAX_SFX_GAIN, MIN_PIECE, MIN_SFX_GAIN,
  autoCuts, clampSfxGain, isEdited, keptAt, keptLength, keptSegments, nextKept, normaliseRanges,
  renderEditedClip, segmentAt, sfxSpans, type ClipEdit, type Cut, type Segment,
} from '@/lib/vidsEdit';
import { DEFAULT_SPEED, MAX_SPEED, MIN_SPEED, SPEED_PRESETS, clampSpeed, trimmedRange } from '@/lib/vidsPlan';
import { decodeAudio, SFX_URL } from '@/lib/vidsAudio';
import { safeExportName } from '@/lib/canvasVideoExport';
import { CONTEXT_PLACEHOLDER } from './VidsContext';
import { CloseIcon, DownloadIcon, SpinnerIcon, UploadIcon } from '@/lib/icons';

const FPS = 30;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** m:ss.t — an editor needs the tenths that fmtTime() rounds away. */
function fmtT(s: number): string {
  const safe = Math.max(0, s);
  const m = Math.floor(safe / 60);
  const sec = safe - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, '0')}`;
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Marks live in clip seconds, so an edit moves them: cuts pull everything after
 *  them earlier, the trim re-bases the start, and speed compresses the lot. Map
 *  each one through the very edit being rendered. A mark the edit removed —
 *  wholly inside a cut, or outside the trim — collapses to nothing and is
 *  dropped rather than left pointing at footage that no longer exists. */
function retimeMarks(marks: readonly VidMark[], segs: readonly Segment[], speed: number): VidMark[] {
  const out: VidMark[] = [];
  for (const m of marks) {
    const start = keptAt(segs, m.start) / speed;
    const end = keptAt(segs, m.end) / speed;
    if (end - start < 0.05) continue;
    out.push({ start, end, text: m.text });
  }
  return out;
}

// ── Small bits ────────────────────────────────────────────────────────────────

function Panel({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border-b border-zinc-800 px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <p className="flex-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{title}</p>
        {right}
      </div>
      {children}
    </div>
  );
}

function Chip({ on, disabled, onClick, title, children }: {
  on?: boolean; disabled?: boolean; onClick: () => void; title?: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded border px-1.5 py-0.5 text-[10px] transition-colors disabled:opacity-30 ${
        on ? 'border-zinc-300 bg-zinc-200 text-black' : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

function PlayIcon({ playing }: { playing: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      {playing
        ? <><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>
        : <path d="M8 5.5v13l11-6.5z" />}
    </svg>
  );
}

/** A bar and a play triangle: from the top. */
function RestartIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="4.5" y="5" width="2.5" height="14" rx="1" />
      <path d="M10 5.5v13l10-6.5z" />
    </svg>
  );
}

/** An arrow back round on itself: every change, put back. */
function StartOverIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <polyline points="3 3 3 9 9 9" />
    </svg>
  );
}

// The key legend under the picture: the key in bold, in the colour of what it
// does on the track (emerald in / out, rose cuts, amber keys, violet marks),
// then the word.
const KEY_TONE = {
  emerald: 'border-emerald-700 text-emerald-300',
  rose: 'border-rose-700 text-rose-300',
  amber: 'border-amber-700 text-amber-300',
  violet: 'border-violet-700 text-violet-300',
  zinc: 'border-zinc-600 text-zinc-200',
} as const;

// ── Undo ──
/** How many changes Ctrl+Z can walk back through. */
const UNDO_DEPTH = 100;
/** A handle or slider still moving this soon after its last move is the same
 *  change, and one step to undo. */
const UNDO_MERGE_MS = 700;
type Snapshot = { edit: ClipEdit; marks: VidMark[] };

/** Which part of the edit a change touched, for folding a drag into one undo
 *  step: a moving handle or slider changes just its own field, over and over. */
function changedField(a: ClipEdit, b: ClipEdit): 'trim' | 'speed' | 'sfxGain' | 'other' {
  const keys = (Object.keys(b) as (keyof ClipEdit)[]).filter((k) => a[k] !== b[k]);
  if (keys.length !== 1) return 'other';
  const k = keys[0];
  return k === 'trim' || k === 'speed' || k === 'sfxGain' ? k : 'other';
}

function sameMarks(a: VidMark[], b: VidMark[]): boolean {
  return a.length === b.length
    && a.every((m, i) => m.start === b[i].start && m.end === b[i].end && m.text === b[i].text);
}

function KeyHint({ k, tone, children }: { k: string; tone: keyof typeof KEY_TONE; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className={`rounded border bg-zinc-950 px-1.5 py-0.5 font-mono text-[12px] font-bold leading-none ${KEY_TONE[tone]}`}>{k}</kbd>
      <span className="text-[11px] text-zinc-300">{children}</span>
    </span>
  );
}

function ScissorsIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" /><line x1="14.47" y1="14.48" x2="20" y2="20" /><line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  );
}

function KeysIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
    </svg>
  );
}

/** Whose context the panel is editing: the open clip's own, or that of the
 *  persona it is a part of — a persona's three clips are one performance and
 *  share one context. */
export interface ContextOwner {
  id: string;
  kind: 'clip' | 'persona';
  name: string;
  value: VidContext;
}

// What this footage is showing, in your words, plus light / dark / n/a. It
// belongs to the clip rather than to the edit being rendered, so there is no
// Save here: typing commits on a pause and on blur, a config click at once.
function ContextPanel({ owner, onChange }: {
  owner: ContextOwner;
  onChange: (patch: VidContextPatch) => void;
}) {
  const [text, setText] = useState(owner.value.context);
  const stored = owner.value.context;

  // A different clip (or persona) means a different context — drop the draft.
  // Keyed on the id alone: a save elsewhere must not yank the field you are in.
  useEffect(() => {
    setText(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner.id]);

  const commit = useRef(onChange);
  commit.current = onChange;
  useEffect(() => {
    if (text.trim() === stored) return;
    const t = setTimeout(() => commit.current({ context: text.trim() }), 700);
    return () => clearTimeout(t);
  }, [text, stored]);

  return (
    <Panel
      title={owner.kind === 'persona' ? 'Context · persona' : 'Context'}
      right={owner.kind === 'persona'
        ? <span className="max-w-[110px] truncate text-[9px] text-zinc-500" title={owner.name}>{owner.name}</span>
        : undefined}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { if (text.trim() !== stored) onChange({ context: text.trim() }); }}
        rows={3}
        placeholder={CONTEXT_PLACEHOLDER}
        className="w-full resize-none rounded border border-zinc-800 bg-black px-2 py-1.5 text-[11px] leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500"
      />
      {owner.kind === 'persona' && (
        <p className="mt-1 text-[9px] leading-relaxed text-zinc-600">
          Shared by this persona’s three clips.
        </p>
      )}
    </Panel>
  );
}

/** The G popup: one line about the stretch you selected. Enter saves, Escape
 *  drops it. Deliberately bare — this gets used a dozen times per clip. */
function MarkDialog({ span, initial, onSave, onClose }: {
  span: { start: number; end: number };
  /** The existing words when an already-placed mark was clicked; empty for a new
   *  one. Either way this is the field's starting value, so re-opening a mark
   *  edits it rather than starting again. */
  initial: string;
  onSave: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-[340px] rounded-lg border border-zinc-700 bg-zinc-950 p-3 shadow-2xl">
        <div className="mb-1.5 flex items-baseline gap-2">
          <p className="text-[11px] font-semibold text-zinc-100">
            {initial ? 'Edit this mark' : 'What happens here?'}
          </p>
          <span className="font-mono text-[10px] text-violet-300">{fmtT(span.start)}–{fmtT(span.end)}</span>
        </div>
        <input
          autoFocus
          value={text}
          maxLength={MAX_MARK_TEXT}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onSave(text); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
          }}
          placeholder="searching ronaldo on pauv"
          className="w-full rounded border border-zinc-700 bg-black px-2 py-1.5 text-[11px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-500"
        />
        <p className="mt-1.5 text-[9px] text-zinc-600">
          Enter saves · Esc cancels{initial ? ' · clear the box to remove the mark' : ''}
        </p>
      </div>
    </div>
  );
}

function MarkIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 5h16M4 12h10M4 19h7" />
    </svg>
  );
}

// ── Editor ────────────────────────────────────────────────────────────────────

interface Props {
  /** The clip. One an intake run holds locally — not uploaded yet — carries
   *  the file it plays from, so a render reads the disk. */
  video: (VidRow & { file?: Blob }) | null;
  /** Save the rendered MP4 over the clip it was rendered from — `videoId`, not
   *  whatever is open by the time it lands, because a save outlives the panel
   *  that started it. `hasSfx` says whether the file came out with the keyboard
   *  on it, which is what lets the builder hear it. Rejects with a readable
   *  message. */
  /** `blob` null means nothing about the footage changed — save the name and
   *  leave the file alone. */
  onSave: (blob: Blob | null, name: string, hasSfx: boolean, marks: VidMark[], videoId: string) => Promise<void>;
  /** Prep page is on screen — the preview pauses whenever it isn't. */
  active: boolean;
  onClose: () => void;
  /** Whose context the Context panel edits — this clip, or the persona it is a
   *  part of. Null while nothing is open. */
  contextOwner: ContextOwner | null;
  onContextChange: (patch: VidContextPatch) => void;
  /** Replace this clip's per-stretch marks. */
  onMarksChange: (marks: VidMark[]) => void;
  /** How much of the editor is on offer.
   *
   *  'trim'  in / out points and Save, nothing else — no cuts, no keyboard, no
   *          marks, no speed, no context panel. Start and Top B are one
   *          performance carrying one context, and scoring one of them would
   *          break it.
   *  'cut'   trimming plus Cut and Auto cut. Top A rides the whole bottom
   *          sequence and loops to fill it, so jump cuts in it are the thing
   *          that stops the top half sitting still.
   *  'full'  the lot (default).
   */
  mode?: 'full' | 'cut' | 'trim';
  /** The rate the clip opens at, 1x unless something outside says otherwise:
   *  the intake opens a bottom clip at INTAKE_SPEED, since a screen recording
   *  always wants that nudge and this is the one pass where it can be given.
   *  The save bakes it into the footage, so this is only ever the *opening*
   *  rate — what Start over goes back to, and what counts as untouched. A clip
   *  opened again later comes in at 1x like everything else, which is what
   *  stops a re-edit speeding up what is already sped up. */
  startSpeed?: number;
  /** What Save says, when something outside is driving the run. */
  saveLabel?: string;
  /** What the progress bar says while the save goes up — the intake run's
   *  first save of a clip is not over any original. */
  savingLabel?: string;
}

export function VidsClipEditor({
  video, onSave, active, onClose, contextOwner, onContextChange, onMarksChange,
  mode = 'full', startSpeed = DEFAULT_SPEED, saveLabel, savingLabel,
}: Props) {
  const trimOnly = mode === 'trim';
  /** Cut and Auto cut are on. */
  const canCut = mode !== 'trim';
  /** Keyboard, marks, speed and the context panel as well. */
  const fullKit = mode === 'full';
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const [edit, setEdit] = useState<ClipEdit>({ ...DEFAULT_EDIT, cuts: [], sfx: [] });
  // The rate this clip opened at, or the one the last save left it at. Every
  // question of the form "has anything been touched since?" is asked against
  // it rather than against 1x, so a bottom clip that opens at INTAKE_SPEED
  // reads as untouched until you actually change something — and Start over
  // puts it back there. A save bakes the speed in, so the baseline after one
  // is 1x again.
  const [baseSpeed, setBaseSpeed] = useState(DEFAULT_SPEED);
  // Read in the open effect below, which runs off the clip's id alone — the
  // ref is what makes sure it is this render's value and not an older one.
  const startSpeedRef = useRef(startSpeed);
  startSpeedRef.current = startSpeed;
  const [duration, setDuration] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState<Cut | null>(null);
  // The G popup's pending mark: the stretch it covers plus whatever has been
  // typed so far. Editing an existing mark re-opens it with its own text.
  const [markDraft, setMarkDraft] = useState<{ start: number; end: number; text: string } | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<{ frac: number; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // The marks as the clip opened, or as the last save left them — what Start
  // over puts back, since marks save themselves as they are made.
  const [marksAtOpen, setMarksAtOpen] = useState<VidMark[]>([]);
  const abortRef = useRef<{ ctrl: AbortController; kind: 'save' | 'download' } | null>(null);
  // Ctrl+Z's record (see the Undo section below). A clip opening or a save
  // empties it: there is nothing before that to go back to.
  const undoRef = useRef<Snapshot[]>([]);
  const lastSeenRef = useRef<ClipEdit | null>(null);
  const lastPushRef = useRef<{ at: number; field: string } | null>(null);
  /** The next change to the edit is an undo or a fresh baseline, not one to record. */
  const skipRecordRef = useRef(false);

  const range = useMemo(() => trimmedRange(edit.trim, duration), [edit.trim, duration]);
  const segs = useMemo(() => keptSegments(edit, duration), [edit, duration]);
  const cuts = useMemo(() => normaliseRanges(edit.cuts, range), [edit.cuts, range]);
  const sfx = useMemo(() => normaliseRanges(edit.sfx, range), [edit.sfx, range]);
  const speed = clampSpeed(edit.speed);

  // Opening a different clip resets everything, including whatever was
  // half-rendered. Keyed on the id, not the row: the library hands out fresh row
  // objects on every refresh and an edit in progress must survive those.
  // ── Keyboard preview ──
  // The picture stays muted, so the only thing the editor ever plays is the
  // typing. One looping source is started when the playhead runs into a stretch
  // marked for keys and stopped on the way out, which is exactly what the
  // renderer bakes — you can hear the placement without saving first.
  const audioRef = useRef<AudioContext | null>(null);
  const sampleRef = useRef<AudioBuffer | null>(null);
  const burstRef = useRef<{ src: AudioBufferSourceNode; gain: GainNode } | null>(null);

  const stopKeys = useCallback(() => {
    const burst = burstRef.current;
    const ctx = audioRef.current;
    burstRef.current = null;
    if (!burst || !ctx) return;
    // Ramp down rather than cutting the node dead, which would click.
    const now = ctx.currentTime;
    try {
      burst.gain.gain.cancelScheduledValues(now);
      burst.gain.gain.setValueAtTime(burst.gain.gain.value, now);
      burst.gain.gain.linearRampToValueAtTime(0, now + 0.02);
      burst.src.stop(now + 0.04);
    } catch { /* already stopped */ }
  }, []);

  const startKeys = useCallback(() => {
    const ctx = audioRef.current;
    const sample = sampleRef.current;
    if (!ctx || !sample || burstRef.current) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = sample;
    src.loop = true;
    const gain = ctx.createGain();
    src.connect(gain).connect(ctx.destination);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(clampSfxGain(edit.sfxGain), now + 0.02);
    // A random point in the sample, same as the renderer, so the preview isn't
    // the one part of the process that always starts on the same keystroke.
    src.start(now, Math.random() * sample.duration);
    burstRef.current = { src, gain };
  }, [edit.sfxGain]);

  /** Get the sample ready to play. Called from the transport and from placing a
   *  stretch — both a click or a key press, which is the gesture a browser wants
   *  before it will let a page make sound. */
  const armKeys = useCallback(async () => {
    if (!audioRef.current) {
      const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      audioRef.current = new Ctor();
    }
    const ctx = audioRef.current;
    if (ctx.state === 'suspended') await ctx.resume().catch(() => { /* stays silent */ });
    if (sampleRef.current) return;
    try {
      sampleRef.current = await decodeAudio(ctx, SFX_URL);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Dragging the volume while it plays should move what you hear, not wait for
  // the next stretch.
  useEffect(() => {
    const burst = burstRef.current;
    const ctx = audioRef.current;
    if (burst && ctx) burst.gain.gain.setTargetAtTime(clampSfxGain(edit.sfxGain), ctx.currentTime, 0.01);
  }, [edit.sfxGain]);

  useEffect(() => () => {
    stopKeys();
    void audioRef.current?.close().catch(() => { /* already gone */ });
  }, [stopKeys]);

  const videoId = video?.id ?? null;
  // Which clip is on screen right now, readable from a save that started under a
  // different one — that save must not write its outcome over this clip's state.
  const liveIdRef = useRef<string | null>(null);
  liveIdRef.current = videoId;
  const startName = video?.name ?? '';
  const startDuration = video?.duration ?? 0;
  // A clip that already carries the keyboard opens un-muted, so re-editing it
  // carries that sound through instead of rendering it away. Footage that was
  // never through Prep opens muted, as everything in this section does.
  const startHasSfx = video?.hasSfx ?? false;
  /** Whether saving would change the footage at all. Nothing trimmed, cut, sped
   *  or newly keyed, and the clip's own sound still where it opened, means the
   *  renderer would write back exactly what is already in the bucket — so a save
   *  from here is a rename and nothing more. */
  const untouched = !isEdited(edit, duration) && edit.muted === !startHasSfx;
  useEffect(() => {
    // A download belongs to this panel and goes with it; a save belongs to the
    // clip it is writing to and is left alone to finish. Cancelling a save is
    // something you do on purpose, with the button on the progress bar.
    if (abortRef.current?.kind === 'download') abortRef.current.ctrl.abort();
    undoRef.current = [];
    lastPushRef.current = null;
    skipRecordRef.current = true;
    const opensAt = clampSpeed(startSpeedRef.current);
    setEdit({ ...DEFAULT_EDIT, cuts: [], sfx: [], muted: !startHasSfx, speed: opensAt });
    setBaseSpeed(opensAt);
    setMarksAtOpen(video?.marks ?? []);
    setDuration(startDuration);
    setPlayhead(0);
    setPlaying(false);
    setSelection(null);
    setMarkDraft(null);
    stopKeys();
    setHover(null);
    setError(null);
    setNote(null);
    setBusy(null);
    setName(startName.replace(/\.[^.]+$/, ''));
    // startName / startDuration are just this clip's opening values — a rename or
    // a re-measure later must not wipe the edit being worked on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  useEffect(() => () => { if (abortRef.current?.kind === 'download') abortRef.current.ctrl.abort(); }, []);

  // Keep the element in step with the settings. preservesPitch off so what you
  // hear while scrubbing is what the renderer bakes in (it resamples too).
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.playbackRate = speed;
    el.defaultPlaybackRate = speed;
    type PitchEl = HTMLVideoElement & { preservesPitch?: boolean; mozPreservesPitch?: boolean };
    const p = el as PitchEl;
    p.preservesPitch = false;
    p.mozPreservesPitch = false;
  }, [speed, video]);

  // The element plays exactly what the render will carry out of the source: for
  // raw footage that is nothing, and for a clip already carrying the keyboard it
  // is that keyboard. Stretches marked in this session are layered on top by the
  // preview below, the same way the renderer layers them.
  useEffect(() => {
    const el = videoRef.current;
    if (el) el.muted = edit.muted;
  }, [video, edit.muted]);

  const pause = useCallback(() => {
    videoRef.current?.pause();
    setPlaying(false);
    stopKeys();
  }, [stopKeys]);

  useEffect(() => { if (!active) pause(); }, [active, pause]);

  const seek = useCallback((t: number) => {
    setPlayhead(clamp(t, 0, duration || 0));
  }, [duration]);

  // ── What the picture shows ──
  // Sweeping the timeline scrubs the preview itself: while the pointer is over
  // the track the frame under it is on screen, and the moment the pointer leaves
  // the picture drops back to the playhead. Playing wins over both — a sweep
  // never yanks the picture out from under a clip that is running.
  //
  // Only one seek is ever in flight; the newest wanted time is re-applied when
  // that one lands, so dragging across a long clip stays smooth instead of
  // queueing a seek per mouse move.
  const [hover, setHover] = useState<number | null>(null);
  const wantRef = useRef<number | null>(null);
  const shown = hover ?? playhead;

  useEffect(() => {
    if (playing) return;
    const el = videoRef.current;
    if (!el) return;
    wantRef.current = shown;
    if (!el.seeking) el.currentTime = shown;
  }, [shown, playing]);

  const onSeeked = () => {
    const el = videoRef.current;
    const want = wantRef.current;
    if (playing || !el || want === null) return;
    if (Math.abs(el.currentTime - want) > 0.05) el.currentTime = want;
  };

  /** Playing jumps over cut ranges and stops at the out point, so the preview
   *  runs the same footage the renderer will. */
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = videoRef.current;
      if (!el) return;
      const t = el.currentTime;
      const nxt = t >= range.end - 1e-3 ? null : nextKept(segs, t);
      if (nxt === null) {
        // Off the end — rewind to the in point and hold there.
        el.pause();
        setPlaying(false);
        stopKeys();
        const back = segs[0]?.start ?? range.start;
        el.currentTime = back;
        setPlayhead(back);
        return;
      }
      // Both of these no-op when the sound is already in the right state, so
      // asking every frame is how the typing follows the playhead in and out.
      if (segmentAt(sfx, t)) startKeys();
      else stopKeys();
      if (nxt > t + 0.02) {
        el.currentTime = nxt;
        setPlayhead(nxt);
        return;
      }
      setPlayhead(t);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, segs, range.end, range.start, sfx, startKeys, stopKeys]);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el || !segs.length) return;
    if (playing) { pause(); return; }
    if (sfx.length) void armKeys();
    // Restarting from the end (or from inside a cut) drops onto the next kept frame.
    const from = nextKept(segs, el.currentTime);
    if (from === null || el.currentTime >= range.end - 1e-3) {
      el.currentTime = segs[0].start;
      setPlayhead(segs[0].start);
    } else if (from > el.currentTime) {
      el.currentTime = from;
      setPlayhead(from);
    }
    void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, [playing, pause, segs, range.end, sfx.length, armKeys]);

  /** From the top: the first kept frame, playing — whatever was on screen. A
   *  clip already running just carries on from there. */
  const playFromStart = useCallback(() => {
    const el = videoRef.current;
    if (!el || !segs.length) return;
    el.currentTime = segs[0].start;
    setPlayhead(segs[0].start);
    if (playing) return;
    if (sfx.length) void armKeys();
    void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, [playing, segs, sfx.length, armKeys]);

  // ── Edits ──
  const patch = useCallback((p: Partial<ClipEdit>) => {
    setEdit((prev) => ({ ...prev, ...p }));
    setNote(null);
  }, []);

  const setIn = useCallback((t: number) => {
    setEdit((prev) => {
      const end = prev.trim.end ?? duration;
      return { ...prev, trim: { ...prev.trim, start: clamp(t, 0, Math.max(0, end - MIN_PIECE)) } };
    });
  }, [duration]);

  const setOut = useCallback((t: number) => {
    setEdit((prev) => {
      const at = clamp(t, prev.trim.start + MIN_PIECE, duration);
      return { ...prev, trim: { ...prev.trim, end: at >= duration - 1e-3 ? null : at } };
    });
  }, [duration]);

  const cutSelection = useCallback(() => {
    if (!selection || selection.end - selection.start < MIN_PIECE) return;
    setEdit((prev) => ({ ...prev, cuts: [...prev.cuts, { ...selection }] }));
    setSelection(null);
    setNote(null);
  }, [selection]);

  /** Lay the keyboard over the selection. The stretch is kept in source seconds
   *  like a cut, so trimming or cutting around it moves the sound with the
   *  frames it was put under. */
  const keysSelection = useCallback(() => {
    if (!selection || selection.end - selection.start < MIN_PIECE) return;
    setEdit((prev) => ({ ...prev, sfx: [...prev.sfx, { ...selection }] }));
    setSelection(null);
    setNote(null);
    void armKeys();
  }, [selection, armKeys]);

  // Marks are the clip's own, not the edit's — they describe the footage rather
  // than what this session is doing to it, so they save the moment you press
  // Enter instead of waiting for a render.
  const marks = useMemo(() => video?.marks ?? [], [video]);

  // ── Undo ──
  // Ctrl+Z puts back the last change — a cut, a stretch of keys, a mark, a
  // trim, the speed. Changes to the edit are caught here as they land rather
  // than at each button, so none is missed, and a drag or a slider counts as
  // one step instead of a hundred. The marks save themselves, so they are
  // recorded where they change (changeMarks) instead.
  const pushUndo = useCallback((snap: Snapshot) => {
    undoRef.current.push(snap);
    if (undoRef.current.length > UNDO_DEPTH) undoRef.current.shift();
  }, []);

  useEffect(() => {
    const prev = lastSeenRef.current;
    lastSeenRef.current = edit;
    if (!prev || prev === edit) return;
    if (skipRecordRef.current) {
      skipRecordRef.current = false;
      lastPushRef.current = null;
      return;
    }
    const field = changedField(prev, edit);
    const now = performance.now();
    const last = lastPushRef.current;
    lastPushRef.current = { at: now, field };
    // The same handle or slider, still moving: the step already on record is
    // the one to go back to.
    if (last && field !== 'other' && last.field === field && now - last.at < UNDO_MERGE_MS) return;
    pushUndo({ edit: prev, marks });
  }, [edit, marks, pushUndo]);

  /** Every change to the marks goes through here, so Ctrl+Z has it. */
  const changeMarks = useCallback((next: VidMark[]) => {
    pushUndo({ edit, marks });
    lastPushRef.current = null;
    onMarksChange(next);
  }, [edit, marks, onMarksChange, pushUndo]);

  const undo = useCallback(() => {
    const snap = undoRef.current.pop();
    if (!snap) return;
    if (snap.edit !== edit) {
      skipRecordRef.current = true;
      setEdit(snap.edit);
    }
    if (!sameMarks(snap.marks, marks)) onMarksChange(snap.marks);
    setSelection(null);
    setMarkDraft(null);
    setNote(null);
    lastPushRef.current = null;
  }, [edit, marks, onMarksChange]);

  /** Everything since the clip opened or was last saved, put back in one go —
   *  the trim, cuts, keys, speed and marks. One Ctrl+Z brings it all back. */
  // Against the speed it opened at, not against 1x: a clip the intake opened
  // at INTAKE_SPEED has had nothing done to it yet.
  const dirty = isEdited(edit, duration, baseSpeed) || edit.muted !== !startHasSfx
    || !sameMarks(marks, marksAtOpen);
  const startOver = useCallback(() => {
    pushUndo({ edit, marks });
    lastPushRef.current = null;
    skipRecordRef.current = true;
    setEdit({ ...DEFAULT_EDIT, cuts: [], sfx: [], muted: !startHasSfx, speed: baseSpeed });
    if (!sameMarks(marks, marksAtOpen)) onMarksChange(marksAtOpen);
    setSelection(null);
    setMarkDraft(null);
    stopKeys();
    setNote(null);
  }, [baseSpeed, edit, marks, marksAtOpen, onMarksChange, pushUndo, startHasSfx, stopKeys]);

  const markSelection = useCallback(() => {
    if (!selection || selection.end - selection.start < MIN_PIECE) return;
    setMarkDraft({ start: selection.start, end: selection.end, text: '' });
  }, [selection]);

  const saveMark = useCallback((text: string) => {
    const draft = markDraft;
    setMarkDraft(null);
    if (!draft) return;
    const clean = text.trim();
    // Re-marking the same stretch with nothing takes the mark off it.
    const rest = marks.filter((m) => !(Math.abs(m.start - draft.start) < 1e-6 && Math.abs(m.end - draft.end) < 1e-6));
    const next = clean ? [...rest, { start: draft.start, end: draft.end, text: clean }] : rest;
    changeMarks(next.sort((a, b) => a.start - b.start));
    setSelection(null);
  }, [markDraft, marks, changeMarks]);

  const removeMark = useCallback((i: number) => {
    changeMarks(marks.filter((_, n) => n !== i));
  }, [marks, changeMarks]);

  const removeSfx = useCallback((i: number) => {
    setEdit((prev) => {
      const list = normaliseRanges(prev.sfx, trimmedRange(prev.trim, duration));
      return { ...prev, sfx: list.filter((_, n) => n !== i) };
    });
  }, [duration]);

  // Auto cut: a handful of very short pieces taken out across whatever is still
  // kept, so the clip never sits still. Re-running adds another pass.
  const autoCut = useCallback(() => {
    const made = autoCuts(edit, duration);
    if (!made.length) {
      setError('Not enough left to auto cut — this clip is too short.');
      return;
    }
    setError(null);
    setNote(null);
    setEdit((prev) => ({ ...prev, cuts: [...prev.cuts, ...made] }));
    setSelection(null);
  }, [edit, duration]);

  const restoreCut = useCallback((i: number) => {
    setEdit((prev) => {
      const list = normaliseRanges(prev.cuts, trimmedRange(prev.trim, duration));
      return { ...prev, cuts: list.filter((_, n) => n !== i) };
    });
  }, [duration]);

  // ── Timeline pointer handling ──
  // One track does everything: drag the end handles to trim, drag across the
  // body to select a range to cut, click anywhere to scrub there.
  const drag = useRef<{ mode: 'in' | 'out' | 'sel'; anchor: number; moved: boolean } | null>(null);

  const timeAt = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el || !duration) return 0;
    const r = el.getBoundingClientRect();
    return clamp(((clientX - r.left) / Math.max(1, r.width)) * duration, 0, duration);
  }, [duration]);

  const onTrackDown = (mode: 'in' | 'out' | 'sel') => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    e.preventDefault();
    e.stopPropagation();
    const t = timeAt(e.clientX);
    drag.current = { mode, anchor: t, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (mode === 'sel') {
      pause();
      setSelection(null);
      seek(t);
    }
  };

  const trackHover = (clientX: number) => {
    if (!duration) return;
    setHover(timeAt(clientX));
  };

  const onTrackMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    trackHover(e.clientX);
    const d = drag.current;
    if (!d) return;
    const t = timeAt(e.clientX);
    if (Math.abs(t - d.anchor) > 0.02) d.moved = true;
    if (d.mode === 'in') setIn(t);
    else if (d.mode === 'out') setOut(t);
    else if (d.moved) {
      const lo = Math.min(d.anchor, t);
      const hi = Math.max(d.anchor, t);
      setSelection({ start: clamp(lo, range.start, range.end), end: clamp(hi, range.start, range.end) });
    }
  };

  const onTrackUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); } catch { /* already gone */ }
    if (d?.mode === 'sel' && !d.moved) setSelection(null);
  };

  // Keyboard: the shortcuts an editor is expected to have.
  useEffect(() => {
    if (!active || !video) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); return; }
      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'i' || e.key === 'I') setIn(shown);
      else if (e.key === 'o' || e.key === 'O') setOut(shown);
      // C and X both cut what's selected; Q puts the keyboard over it. Guarded
      // on the modifiers so Ctrl/⌘-C is still a copy.
      else if (e.key === 'x' || e.key === 'X' || e.key === 'c' || e.key === 'C'
               || e.key === 'Delete' || e.key === 'Backspace') {
        if (selection && canCut && !e.ctrlKey && !e.metaKey) { e.preventDefault(); cutSelection(); }
      } else if (e.key === 'q' || e.key === 'Q') {
        if (selection && fullKit && !e.ctrlKey && !e.metaKey) { e.preventDefault(); keysSelection(); }
      } else if (e.key === 'g' || e.key === 'G') {
        if (selection && fullKit && !e.ctrlKey && !e.metaKey) { e.preventDefault(); markSelection(); }
      } else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(playhead - (e.shiftKey ? 1 : 1 / FPS)); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seek(playhead + (e.shiftKey ? 1 : 1 / FPS)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, video, togglePlay, setIn, setOut, selection, cutSelection, keysSelection, markSelection,
      seek, playhead, shown, canCut, fullKit, undo]);

  // ── Save / download ──
  // Rendering takes a while, and a save runs against the row it was rendered
  // from — so opening another clip (the three parts of a persona sit side by
  // side, and moving between them mid-save is the obvious thing to do) leaves it
  // running instead of quietly throwing the work away. Nothing it does afterwards
  // touches the panel unless that clip is still the one on screen.
  const run = async (kind: 'save' | 'download') => {
    if (!video || busy || !segs.length) return;
    const myId = video.id;
    const mine = () => liveIdRef.current === myId;
    pause();
    setError(null);
    setNote(null);
    const rowName = name.trim() || video.name;

    // Renaming is not editing. Nothing cut, trimmed, sped or un-muted means the
    // renderer would hand back the footage it was given — so the row just takes
    // the new name, and the clip is not re-encoded, re-uploaded, or made to lose
    // a generation for the sake of a word.
    if (kind === 'save' && untouched) {
      setBusy({ frac: 1, label: 'Renaming…' });
      try {
        await onSave(null, rowName, startHasSfx, marks, myId);
        if (!mine()) return;
        // Saved as it stands: the marks as they are now are what Start over
        // goes back to, and there is nothing before this to undo to.
        undoRef.current = [];
        lastPushRef.current = null;
        setMarksAtOpen(marks);
        setNote(`Renamed to “${rowName}”. The footage is untouched.`);
      } catch (e) {
        if (mine()) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mine()) setBusy(null);
      }
      return;
    }

    const ctrl = new AbortController();
    abortRef.current = { ctrl, kind };
    setBusy({ frac: 0, label: 'Starting…' });
    try {
      const blob = await renderEditedClip({
        // No fps: the clip is written back at its own frame rate. Pinning it to
        // 30 resampled 60 and 24fps footage onto a grid it was never shot on,
        // every single save, and the judder that leaves never comes back out.
        url: video.url,
        file: video.file,
        edit,
        duration,
        onProgress: (frac, label) => { if (mine()) setBusy({ frac, label }); },
        signal: ctrl.signal,
      });
      const file = `${safeExportName(name) || 'clip'}.mp4`;
      if (kind === 'download') {
        downloadBlob(blob, file);
        setNote(`Downloaded "${file}".`);
      } else {
        if (mine()) setBusy({ frac: 1, label: savingLabel ?? 'Saving over the original…' });
        // What actually reached the file, not what was marked: a stretch the
        // cuts swallowed leaves no sound behind and no reason to un-mute. Sound
        // carried in from the clip's own track counts too.
        const hadKeys = !edit.muted || sfxSpans(edit, duration).length > 0;
        // The marks describe the footage, and the footage just changed — carry
        // them onto the rendered timeline so they still point at the right
        // moments in the clip that comes back.
        const carried = retimeMarks(marks, segs, speed);
        await onSave(blob, rowName, hadKeys, carried, myId);
        if (!mine()) return;
        // The edit is in the file now — start clean against the new footage,
        // with nothing to undo back past this point.
        undoRef.current = [];
        lastPushRef.current = null;
        skipRecordRef.current = true;
        setEdit({ ...DEFAULT_EDIT, cuts: [], sfx: [], muted: !hadKeys });
        // The speed went into the file — from here it is footage, not an edit.
        setBaseSpeed(DEFAULT_SPEED);
        setMarksAtOpen(carried);
        setSelection(null);
        setPlayhead(0);
        setNote(`Saved. “${rowName}” is the clip now — wherever it was filed, it stays.`);
      }
    } catch (e) {
      if (mine() && !(e instanceof DOMException && e.name === 'AbortError')) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (mine()) setBusy(null);
      if (abortRef.current?.ctrl === ctrl) abortRef.current = null;
    }
  };

  // ── Render ──
  // Nothing open is the intake stage's business, not the editor's — the page
  // never mounts this without a clip.
  if (!video) return null;

  const pct = (t: number) => (duration ? clamp((t / duration) * 100, 0, 100) : 0);
  // A hovered moment that no kept segment holds is one the edit throws away —
  // worth saying, since the strip still shows the frame that lives there.
  const hoverCut = hover !== null && !segmentAt(segs, hover);
  const hasRange = !!selection && selection.end - selection.start >= MIN_PIECE;
  const removed = Math.max(0, (range.end - range.start) - keptLength(segs));
  // The keys themselves are spelled out in the legend under the picture.
  const scrubHint = trimOnly
    ? 'hover the bar to scrub — trimming is all this clip needs'
    : fullKit
      ? 'hover the bar to scrub · drag to select a stretch'
      : 'hover the bar to scrub · drag to select a stretch — Top A loops under the whole bottom, so cut it';

  return (
    <div className="flex min-h-0 flex-1">
      {/* Stage */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-zinc-200" title={video.name}>{video.name}</span>
          <span className="shrink-0 text-[10px] text-zinc-500">
            {fmtT(duration)}{video.width && video.height ? ` · ${video.width}×${video.height}` : ''}
          </span>
          <button onClick={onClose} title="Close the editor" className="shrink-0 text-zinc-500 hover:text-white">
            <CloseIcon size={13} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center bg-black p-3">
          <video
            ref={videoRef}
            src={video.url}
            poster={video.thumbUrl ?? undefined}
            crossOrigin="anonymous"
            playsInline
            preload="auto"
            onClick={togglePlay}
            onLoadedMetadata={(e) => {
              const el = e.currentTarget;
              if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration);
            }}
            onSeeked={onSeeked}
            onEnded={() => setPlaying(false)}
            className="max-h-full max-w-full cursor-pointer"
          />
        </div>

        {/* The keys, spelled out under the picture — only the ones this mode
            has. I and O work on the frame on screen; C, Q and G on a stretch
            selected on the bar. */}
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-zinc-800 px-3 py-1.5">
          <KeyHint k="I" tone="emerald">Set in</KeyHint>
          <KeyHint k="O" tone="emerald">Set out</KeyHint>
          {canCut && (
            <>
              <span className="h-3 w-px bg-zinc-800" />
              <span className="text-[10px] text-zinc-500">select a stretch, then</span>
              <KeyHint k="C" tone="rose">Cut it</KeyHint>
              {fullKit && <KeyHint k="Q" tone="amber">Keys over it</KeyHint>}
              {fullKit && <KeyHint k="G" tone="violet">Mark what happens</KeyHint>}
            </>
          )}
          <span className="h-3 w-px bg-zinc-800" />
          <KeyHint k="Ctrl Z" tone="zinc">Undo</KeyHint>
        </div>

        {/* Transport */}
        <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 px-3 py-2">
          <button
            onClick={togglePlay}
            title="Play / pause (Space)"
            className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-200 text-black hover:bg-white"
          >
            <PlayIcon playing={playing} />
          </button>
          <button
            onClick={playFromStart}
            disabled={!segs.length}
            title="Play from the start"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-700 text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white disabled:opacity-30"
          >
            <RestartIcon />
          </button>
          <span className={`font-mono text-[10px] ${hover === null ? 'text-zinc-400' : hoverCut ? 'text-rose-400' : 'text-sky-300'}`}>
            {fmtT(shown)}
          </span>
          <span className="font-mono text-[10px] text-zinc-600">/ {fmtT(duration)}</span>

          <span className="mx-1 h-4 w-px bg-zinc-800" />
          <Chip onClick={() => setIn(shown)} title="Trim the start to the frame on screen (I)">Set in</Chip>
          <Chip onClick={() => setOut(shown)} title="Trim the end to the frame on screen (O)">Set out</Chip>
          {trimOnly && (
            <Chip
              onClick={() => patch({ trim: { start: 0, end: null } })}
              disabled={range.start === 0 && edit.trim.end === null}
              title="Put both ends back"
            >
              Reset trim
            </Chip>
          )}
          {canCut && (
            <button
              onClick={cutSelection}
              disabled={!hasRange}
              title="Remove the selected range (C or X)"
              className="flex items-center gap-1 rounded border border-rose-800 px-1.5 py-0.5 text-[10px] text-rose-300 transition-colors hover:border-rose-600 hover:text-rose-200 disabled:opacity-30"
            >
              <ScissorsIcon /> Cut{hasRange ? ` ${(selection.end - selection.start).toFixed(1)}s` : ''}
            </button>
          )}
          {fullKit && (
          <>
          <button
            onClick={keysSelection}
            disabled={!hasRange}
            title="Play the keyboard sound over the selected range (Q)"
            className="flex items-center gap-1 rounded border border-amber-800 px-1.5 py-0.5 text-[10px] text-amber-300 transition-colors hover:border-amber-600 hover:text-amber-200 disabled:opacity-30"
          >
            <KeysIcon /> Keys{hasRange ? ` ${(selection.end - selection.start).toFixed(1)}s` : ''}
          </button>
          <button
            onClick={markSelection}
            disabled={!hasRange}
            title="Say what happens in the selected range (G) — the caption writer times a line to it"
            className="flex items-center gap-1 rounded border border-violet-800 px-1.5 py-0.5 text-[10px] text-violet-300 transition-colors hover:border-violet-600 hover:text-violet-200 disabled:opacity-30"
          >
            <MarkIcon /> Mark{hasRange ? ` ${(selection.end - selection.start).toFixed(1)}s` : ''}
          </button>
          </>
          )}
          {canCut && (
          <>
          <button
            onClick={autoCut}
            title={`Take ${AUTO_CUT_COUNT[0]}–${AUTO_CUT_COUNT[AUTO_CUT_COUNT.length - 1]} short pieces (${AUTO_CUT_MIN}–${AUTO_CUT_MAX}s) out across the clip, spaced apart`}
            className="flex items-center gap-1 rounded border border-rose-800 px-1.5 py-0.5 text-[10px] text-rose-300 transition-colors hover:border-rose-600 hover:text-rose-200"
          >
            <ScissorsIcon /> Auto cut
          </button>
          <Chip
            disabled={cuts.length === 0}
            onClick={() => patch({ cuts: [] })}
            title="Put every cut piece back — the trim and speed are left alone"
          >
            Clear cuts{cuts.length ? ` (${cuts.length})` : ''}
          </Chip>
          {selection && (
            <Chip onClick={() => setSelection(null)} title="Drop the selection">Clear</Chip>
          )}
          </>
          )}

          <span className="flex-1" />
          <span className="text-[10px] text-zinc-500">{scrubHint}</span>
        </div>

        {/* Timeline */}
        <div className="shrink-0 border-t border-zinc-800 px-3 pb-3 pt-2">
          <div onPointerLeave={() => setHover(null)}>
            <div
              ref={trackRef}
              onPointerDown={onTrackDown('sel')}
              onPointerMove={onTrackMove}
              onPointerUp={onTrackUp}
              onPointerCancel={onTrackUp}
              className="relative h-14 w-full cursor-text touch-none select-none overflow-hidden rounded-md border border-zinc-800 bg-zinc-900"
            >
              {/* Kept body */}
              <div
                className="absolute inset-y-0 bg-zinc-700/60"
                style={{ left: `${pct(range.start)}%`, width: `${pct(range.end) - pct(range.start)}%` }}
              />
              {/* Trimmed-off ends */}
              <div className="absolute inset-y-0 left-0 bg-black/60" style={{ width: `${pct(range.start)}%` }} />
              <div className="absolute inset-y-0 right-0 bg-black/60" style={{ width: `${100 - pct(range.end)}%` }} />

              {/* Keys — a tint over the stretch and a solid lane along the
                  bottom. Only the lane takes clicks, so a stretch already
                  carrying sound can still be dragged across to select. */}
              {sfx.map((k, i) => (
                <Fragment key={`sfx-${k.start}-${k.end}`}>
                  <div
                    className="pointer-events-none absolute inset-y-0 bg-amber-400/10"
                    style={{ left: `${pct(k.start)}%`, width: `${Math.max(0.3, pct(k.end) - pct(k.start))}%` }}
                  />
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => removeSfx(i)}
                    title={`Keys ${fmtT(k.start)}–${fmtT(k.end)} — click to take the sound off`}
                    className="absolute bottom-0 z-10 h-1.5 rounded-sm bg-amber-400/80 hover:bg-amber-300"
                    style={{ left: `${pct(k.start)}%`, width: `${Math.max(0.3, pct(k.end) - pct(k.start))}%` }}
                  />
                </Fragment>
              ))}

              {/* Marks — a lane along the top, so they never fight the keys lane
                  at the bottom or the cut blocks in the middle. Click one to
                  edit its words; it re-opens the same popup. */}
              {marks.map((m, i) => (
                <button
                  key={`mark-${m.start}-${m.end}-${i}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setMarkDraft({ start: m.start, end: m.end, text: m.text })}
                  title={`${fmtT(m.start)}–${fmtT(m.end)} · ${m.text} — click to edit these words`}
                  className="absolute top-0 z-10 h-2.5 cursor-pointer rounded-sm bg-violet-400/80 hover:bg-violet-200"
                  style={{ left: `${pct(m.start)}%`, width: `${Math.max(0.5, pct(m.end) - pct(m.start))}%` }}
                />
              ))}

              {/* Cuts */}
              {cuts.map((c, i) => (
                <button
                  key={`${c.start}-${c.end}-${i}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => restoreCut(i)}
                  title={`Cut ${fmtT(c.start)}–${fmtT(c.end)} — click to put it back`}
                  className="group absolute inset-y-0 flex items-center justify-center border-x border-rose-500/70 bg-rose-900/60 hover:bg-rose-800/70"
                  style={{ left: `${pct(c.start)}%`, width: `${Math.max(0.4, pct(c.end) - pct(c.start))}%` }}
                >
                  <span className="pointer-events-none text-rose-200 opacity-70 group-hover:opacity-100"><ScissorsIcon size={11} /></span>
                </button>
              ))}

              {/* Selection */}
              {selection && (
                <div
                  className="pointer-events-none absolute inset-y-0 border-x border-sky-400 bg-sky-400/25"
                  style={{ left: `${pct(selection.start)}%`, width: `${Math.max(0.2, pct(selection.end) - pct(selection.start))}%` }}
                />
              )}

              {/* Trim handles */}
              <div
                onPointerDown={onTrackDown('in')}
                onPointerMove={onTrackMove}
                onPointerUp={onTrackUp}
                title="Drag to trim the start"
                className="absolute inset-y-0 z-10 -ml-1.5 w-3 cursor-ew-resize touch-none"
                style={{ left: `${pct(range.start)}%` }}
              >
                <div className="mx-auto h-full w-1 rounded bg-emerald-400" />
              </div>
              <div
                onPointerDown={onTrackDown('out')}
                onPointerMove={onTrackMove}
                onPointerUp={onTrackUp}
                title="Drag to trim the end"
                className="absolute inset-y-0 z-10 -ml-1.5 w-3 cursor-ew-resize touch-none"
                style={{ left: `${pct(range.end)}%` }}
              >
                <div className="mx-auto h-full w-1 rounded bg-emerald-400" />
              </div>

              {/* Playhead */}
              <div className="pointer-events-none absolute inset-y-0 z-20 w-px bg-white" style={{ left: `${pct(playhead)}%` }}>
                <span className="absolute -left-1 top-0 h-1.5 w-2.5 rounded-sm bg-white" />
              </div>

              {/* Where the pointer is — the frame on the stage right now */}
              {hover !== null && (
                <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-white/40" style={{ left: `${pct(hover)}%` }} />
              )}
            </div>
          </div>

          <div className="mt-1 flex items-center gap-3 text-[9px] text-zinc-600">
            <span>0:00.0</span>
            <span className="flex-1" />
            <span className="text-emerald-400">in {fmtT(range.start)}</span>
            <span className="text-emerald-400">out {fmtT(range.end)}</span>
            {removed > 0.05 && <span className="text-rose-400">cut {removed.toFixed(1)}s</span>}
            <span className="flex-1" />
            <span>{fmtT(duration)}</span>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex w-[260px] shrink-0 flex-col overflow-y-auto border-l border-zinc-800">
        {/* Start over — every change since the clip opened or was last saved,
            put back in one go. Ctrl+Z is the one-at-a-time version. */}
        <div className="border-b border-zinc-800 px-3 py-2">
          <button
            onClick={startOver}
            disabled={!dirty}
            title="Put the trim, cuts, keys, marks and speed back to how this clip was when it opened, or when it was last saved. Ctrl+Z puts back one change at a time."
            className="flex w-full items-center justify-center gap-1.5 rounded border border-zinc-700 px-2 py-1.5 text-[11px] text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white disabled:cursor-default disabled:opacity-30"
          >
            <StartOverIcon /> Start over
          </button>
        </div>

        {fullKit && (
          <Panel
            title="Speed"
            right={<span className="font-mono text-[10px] text-zinc-400">{speed.toFixed(2)}×</span>}
          >
            <input
              type="range"
              min={MIN_SPEED}
              max={MAX_SPEED}
              step={0.05}
              value={speed}
              onChange={(e) => patch({ speed: clampSpeed(Number(e.target.value)) })}
              className="w-full accent-white"
            />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {SPEED_PRESETS.map((s) => (
                <Chip key={s} on={Math.abs(speed - s) < 1e-6} onClick={() => patch({ speed: s })}>{s}×</Chip>
              ))}
            </div>
          </Panel>
        )}

        <Panel
          title="Trim"
          right={
            <button
              onClick={() => patch({ trim: { start: 0, end: null } })}
              className="text-[9px] text-zinc-500 hover:text-white"
            >
              Reset
            </button>
          }
        >
          <div className="flex items-center gap-1">
            <Chip onClick={() => setIn(playhead)} title="I">In @ playhead</Chip>
            <Chip onClick={() => setOut(playhead)} title="O">Out @ playhead</Chip>
          </div>
          <p className="mt-1.5 font-mono text-[10px] text-zinc-400">{fmtT(range.start)} → {fmtT(range.end)}</p>
        </Panel>

        {canCut && (
        <Panel
          title={`Cuts${cuts.length ? ` (${cuts.length})` : ''}`}
          right={cuts.length ? (
            <button onClick={() => patch({ cuts: [] })} className="text-[9px] text-zinc-500 hover:text-white">Clear</button>
          ) : undefined}
        >
          {cuts.length > 0 && (
            <div className="space-y-1">
              {cuts.map((c, i) => (
                <div key={`${c.start}-${c.end}`} className="flex items-center gap-2 rounded border border-zinc-800 px-1.5 py-1">
                  <span className="flex-1 font-mono text-[10px] text-zinc-300">{fmtT(c.start)}–{fmtT(c.end)}</span>
                  <span className="text-[9px] text-zinc-600">−{(c.end - c.start).toFixed(1)}s</span>
                  <button onClick={() => restoreCut(i)} title="Put this piece back" className="text-zinc-500 hover:text-white">
                    <CloseIcon size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Panel>
        )}

        {fullKit && (
        <>
        <Panel
          title={`Keys${sfx.length ? ` (${sfx.length})` : ''}`}
          right={sfx.length ? (
            <button onClick={() => patch({ sfx: [] })} className="text-[9px] text-zinc-500 hover:text-white">Clear</button>
          ) : undefined}
        >
          {sfx.length > 0 && (
            <>
              <div className="space-y-1">
                {sfx.map((k, i) => (
                  <div key={`${k.start}-${k.end}`} className="flex items-center gap-2 rounded border border-zinc-800 px-1.5 py-1">
                    <span className="flex-1 font-mono text-[10px] text-amber-200/90">{fmtT(k.start)}–{fmtT(k.end)}</span>
                    <span className="text-[9px] text-zinc-600">{(k.end - k.start).toFixed(1)}s</span>
                    <button onClick={() => removeSfx(i)} title="Take the sound off this stretch" className="text-zinc-500 hover:text-white">
                      <CloseIcon size={10} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[9px] uppercase tracking-wider text-zinc-500">Vol</span>
                <input
                  type="range"
                  min={MIN_SFX_GAIN}
                  max={MAX_SFX_GAIN}
                  step={0.05}
                  value={clampSfxGain(edit.sfxGain)}
                  onChange={(e) => patch({ sfxGain: clampSfxGain(Number(e.target.value)) })}
                  className="flex-1 accent-amber-400"
                />
                <span className="w-6 text-right font-mono text-[10px] text-zinc-400">
                  {Math.round(clampSfxGain(edit.sfxGain) * 100)}
                </span>
              </div>
            </>
          )}
        </Panel>

        <Panel
          title={`Marks${marks.length ? ` (${marks.length})` : ''}`}
          right={marks.length ? (
            <button onClick={() => changeMarks([])} className="text-[9px] text-zinc-500 hover:text-white">Clear</button>
          ) : undefined}
        >
          {marks.length === 0 ? (
            <p className="text-[9px] leading-relaxed text-zinc-600">
              Select a stretch and press G to say what happens in it. The caption writer puts a line
              over each mark.
            </p>
          ) : (
            <div className="space-y-1">
              {marks.map((m, i) => (
                <div key={`${m.start}-${m.end}-${i}`} className="flex items-start gap-1.5 rounded border border-zinc-800 px-1.5 py-1">
                  <span className="shrink-0 pt-px font-mono text-[9px] text-violet-300/90">{fmtT(m.start)}</span>
                  <button
                    onClick={() => setMarkDraft({ start: m.start, end: m.end, text: m.text })}
                    title="Click to edit these words"
                    className="min-w-0 flex-1 text-left text-[10px] leading-snug text-zinc-300 hover:text-white hover:underline"
                  >
                    {m.text}
                  </button>
                  <button onClick={() => removeMark(i)} title="Take this mark off" className="shrink-0 text-zinc-500 hover:text-white">
                    <CloseIcon size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {contextOwner && <ContextPanel owner={contextOwner} onChange={onContextChange} />}
        </>
        )}

        <div className="mt-auto border-t border-zinc-800 px-3 py-2.5">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Save</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Clip name"
            className="mb-1.5 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-zinc-500"
          />
          {busy ? (
            <div>
              <div className="flex items-center gap-2 text-[10px] text-zinc-300">
                <SpinnerIcon size={11} className="animate-spin" />
                <span className="flex-1 truncate">{busy.label}</span>
                <span className="font-mono text-zinc-500">{Math.round(busy.frac * 100)}%</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full bg-white transition-[width]" style={{ width: `${busy.frac * 100}%` }} />
              </div>
              <button
                onClick={() => abortRef.current?.ctrl.abort()}
                className="mt-1.5 w-full rounded border border-zinc-700 py-1 text-[10px] text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex gap-1.5">
              <button
                onClick={() => void run('save')}
                disabled={!segs.length}
                className="flex flex-1 items-center justify-center gap-1 rounded bg-white py-1.5 text-[11px] font-medium text-black hover:bg-zinc-200 disabled:opacity-30"
              >
                <UploadIcon size={12} /> {saveLabel ?? (untouched ? 'Save the name' : 'Save over original')}
              </button>
              <button
                onClick={() => void run('download')}
                disabled={!segs.length}
                title="Download the edited clip"
                className="flex items-center justify-center rounded border border-zinc-700 px-2 text-zinc-300 hover:border-zinc-500 hover:text-white disabled:opacity-30"
              >
                <DownloadIcon size={12} />
              </button>
            </div>
          )}

          {error && <p className="mt-1.5 break-words text-[10px] text-red-400">{error}</p>}
          {note && <p className="mt-1.5 text-[10px] text-emerald-400">{note}</p>}
        </div>
      </div>

      {markDraft && (
        <MarkDialog
          key={`${markDraft.start}-${markDraft.end}`}
          span={markDraft}
          initial={markDraft.text}
          onSave={saveMark}
          onClose={() => setMarkDraft(null)}
        />
      )}
    </div>
  );
}
