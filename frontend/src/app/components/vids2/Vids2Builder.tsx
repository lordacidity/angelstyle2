'use client';

// Vids2Builder — the tuning page: the video the form just made, playing, with
// the handful of things left to change about it.
//
// It is Simpler's builder with the deciding taken out. The form decided —
// persona, who, which way, light or dark, the intro (nothing, ChatGPT and a
// question, or a news story) — and Generate made the screen recordings before
// this page was ever on screen, so there are no choices here, only
// adjustments:
//
//   Sound     the song under the video, how loud the clips sit, how loud the
//             BOOMs land.
//   Captions  written by the model off the clips' context the moment the build
//             lands, editable by hand, and the look — and the size — they are
//             drawn in.
//   BOOMs     Insert boom arms one and the bar says where.
//   Caption   the post caption for Instagram, drafted on its own, with a Copy
//             button. Then Download MP4.
//
// The two clip cards Simpler has at the top of its sidebar are gone. In their
// place is a line saying what the form asked for and a way back to it: change
// an answer, press Generate again, and both recordings are made afresh.
//
// Everything else about a build still happens and none of it is anybody's to
// set. End fills itself from its folder, the frame is always 9:16, there are
// no bars, Bottom A is always on Fast, and every clip sits where its slot's
// auto-fit puts it. The stage is a screen, not a workbench: nothing on it can
// be selected, dragged, zoomed, trimmed or re-timed. The one exception is the
// caption — drag it and it stays where you put it.
//
// The two recordings under it live in this tab and nowhere else
// (lib/simpler/vidsLocal): Bottom A is the ChatGPT search
// (components/chatgpt/chatgpt-video), Bottom B the Pauv trade
// (components/trade/trade-video). Vids2Section made them and owns their bytes,
// so nothing here lets go of a clip.
//
// A BOOM adds no clip and moves nothing: it has nothing behind its picture, so
// the video goes on showing through it, and it is painted over the captions as
// well as the footage — it is on top of the finished video, not in it. Always
// BOOM_LENGTH long, whatever the clip's own length is. See BoomInsert in
// lib/simpler/vidsPlan.
//
// Every export is still written down under a short code (lib/simpler/vidsRecipe
// → the recipes API): a three-word title from the model, plus the persona,
// every slot's clip and settings, sound and captions. The code goes after the
// title in the file name and on the end of the post caption, so a video found
// later can be traced back to the build that made it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent, SyntheticEvent } from 'react';
import type { VidPersona, VidRecipe, VidRow } from '@/lib/vids-types';
import { isPhoto } from '@/lib/vids-types';
import {
  DEFAULT_BARS, DEFAULT_BOTTOM_A_PACE, SLOTS,
  buildPlan, boomIdOf, boomLayer, boomPlanItem, drawPlanItem, freshPick, isBoomItem, slotSpeed, smoothScaling,
  type BoomInsert, type LayerId, type Picks, type Plan, type PlanItem, type Rect, type SlotId,
} from '@/lib/simpler/vidsPlan';
// The house BOOM and the way a name is squeezed into a key, from Simpler's own
// Bottom logic. Nothing that reads a person off a filed clip is wanted here:
// Vids 2 knows who it is, because the form said so.
import { HOUSE_BOOM, boomFromBottomB, personKey } from '@/lib/simpler/vidsBottom';
import {
  bottomBFixed, bottomBTrade, degenBoomSound, degenBooms, NEWS_BOTTOM_A_LINES, type Vids2Build,
} from '@/lib/vids2/vids2Build';
import { composeSequence } from '@/lib/simpler/vidsCompose';
import {
  CAPTION_STYLES, DEFAULT_CAPTION_SCALE, DEFAULT_CAPTION_STYLE, EMPTY_LINES, FAST_BOTTOM_A_CAPTIONS,
  MIN_SHARE, ONE_LINE_DEFAULT,
  bareFixedLine, bottomBOpen, buildCaptions, capLine, captionAt,
  captionStyle, captionWindows, drawCaption, fixedLine, layoutCaption, preloadCaptionEmoji,
  scaleCaptionStyle, seamNeedsMerge, wantedCount,
  type CaptionLines, type CaptionPos, type CaptionRef, type CaptionWindow,
} from '@/lib/simpler/vidsCaptions';
import { VidsCaptionsRail } from '@/app/components/simpler/VidsCaptionsRail';
import { emojiByUnified } from '@/lib/emoji';
import { pinnedUnifieds, useEmojiPrefs } from '@/lib/emoji-prefs-store';
import { VidsPostCaption } from '@/app/components/simpler/VidsPostCaption';
import { createRecipe, deleteRecipe, writeCaptions, writeHook } from '@/lib/vids-client';
import { specFromBuild } from '@/lib/simpler/vidsRecipe';
import {
  DEFAULT_BOOM_LEVEL, DEFAULT_CLIP_LEVEL, DEFAULT_MUSIC, DEFAULT_ROOM_TONE,
  MAX_BOOM_LEVEL, MAX_CLIP_LEVEL, MAX_MUSIC_LEVEL, MIN_BOOM_LEVEL,
  MIN_CLIP_LEVEL, MIN_MUSIC_LEVEL, ROOM_TONE_URL, clampClipLevel,
  boomGain, clampBoomLevel, clampMusicLevel, decodeAudio, listBoomSounds, listMusic, musicGain, roomToneGain,
  type BoomSound, type Music, type MusicTrack,
} from '@/lib/simpler/vidsAudio';
import { fmtTime, safeExportName } from '@/lib/utils';
import { BTN_TEXT } from '@/lib/ui-constants';
import { DownloadIcon, SpinnerIcon, VideoIcon } from '@/lib/icons';

// The one size a vid is made at. There is no picker for it: every build goes
// out 9:16, and `PRESET_ID` is what the record is written down with.
const PRESET_ID = '9:16';
const OUT_W = 1080;
const OUT_H = 1920;
/** The one rate a vid goes out at. The clips can be anything — a 60fps
 *  persona, a 24fps recording — and the stage plays them as they are, but the
 *  file is written on this grid: the phone it ends up on wants no more, and a
 *  file that followed the fastest clip was twice the frames for nothing. */
const OUT_FPS = 30;
/** No bars, always — nothing here switches them on, but the plan still asks. */
const BARS = DEFAULT_BARS;
/** Bottom A is always sped up to fit its ten seconds. */
const PACE = DEFAULT_BOTTOM_A_PACE;

const STAGE_PAD = 32;  // px of breathing room around the stage
/** Slack around a caption's own box, so a short line is still easy to grab. */
const CAPTION_GRAB = 14;
/** How close to the edge a caption may be dragged, as a share of the frame. */
const CAPTION_EDGE = 0.02;
/** How long the captions wait on a clip that has said neither "loaded" nor
 *  "failed" before being written from the library's own figures. */
const ROLL_WAIT_MS = 8000;
/** How long the bar has to be still before the song and the room move to where
 *  it was left. Long enough that dragging doesn't chop the sound up, short
 *  enough that letting go and listening is one movement. */
const BED_SETTLE_MS = 140;

/** Whether the hook standing in `lines` is somebody's own: typed by hand
 *  (`touched`), and still there. Asked of the words as they are at the moment
 *  something is about to write over them — never of the words as they were
 *  when that writing was set off, which on a caption call is several seconds
 *  and a good deal of typing earlier. */
const hookIsTheirs = (touched: boolean, lines: CaptionLines): boolean =>
  touched && !!lines.start.text.trim();


/** The BOOM being placed, as against the ones already on the video. It is a
 *  layer like any other so that it can be drawn by the same call — but it is
 *  never in the plan, so nothing seeks it, nothing hears it and no export ever
 *  sees it. It is only there to answer "where would this land?". */
const BOOM_PREVIEW_ID = 'preview';
const BOOM_PREVIEW_LAYER = boomLayer(BOOM_PREVIEW_ID);

const pickRandom = <T,>(xs: readonly T[]): T | undefined =>
  (xs.length ? xs[Math.floor(Math.random() * xs.length)] : undefined);

/** The songs the randomizer may reach for. A degen build can roll any song;
 *  any other build never rolls one marked degen on the Music page. This is the
 *  roll only — picking a degen song from the list by hand is open to every
 *  build. */
const rollableMusic = (tracks: readonly MusicTrack[], degen: boolean): MusicTrack[] =>
  (degen ? [...tracks] : tracks.filter((t) => !t.degen));

/** Volume moves in twentieths — five points of the readout per notch, and
 *  never a value off that grid, whatever the level started as. */
const LEVEL_STEP = 0.05;
const snapLevel = (v: number) => Math.round(v / LEVEL_STEP) * LEVEL_STEP;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 });

/** Whether a key press belongs to whatever is focused rather than to the page:
 *  a box you can type in, or anything else the browser is letting you edit. A
 *  slider is not one — it has no use for the space bar, and the scrub bar is
 *  exactly the thing you are most likely to be holding when you want to stop
 *  the video. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  return tag === 'input' && (el as HTMLInputElement).type !== 'range';
}
const activeAt = (plan: Plan, t: number) => {
  const tt = Math.min(t, Math.max(0, plan.total - 1e-3));
  return plan.items.filter((i) => tt >= i.start && tt < i.end);
};

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

// ── The song ─────────────────────────────────────────────────────────────────

function PlayGlyph({ stop }: { stop?: boolean }) {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      {stop ? <rect x="6" y="6" width="12" height="12" rx="1.5" /> : <path d="M8 5v14l11-7z" />}
    </svg>
  );
}

/** The song, as a list you can listen to. A native <select> has nowhere to put
 *  a play button, and picking a track you have to render a whole video to hear
 *  is picking blind — so this is a button and a list, and every row plays its
 *  track from the top for as long as you leave it going.
 *
 *  The preview is its own <audio>, not the mixer's bed: it plays whether or not
 *  the stage is running, at the level the song is set to, and one preview stops
 *  the one before it. */
function MusicPicker({ tracks, music, level, onChoose }: {
  tracks: MusicTrack[];
  /** The chosen track's url, or null for no song. */
  music: string | null;
  /** What to play the preview at — the song's own level. */
  level: number;
  onChoose: (track: MusicTrack | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = useCallback(() => {
    const el = audioRef.current;
    audioRef.current = null;
    if (el) { el.pause(); el.removeAttribute('src'); el.load(); }
    setPreviewing(null);
  }, []);

  // Nothing should still be playing once this is gone.
  useEffect(() => stop, [stop]);

  /** Putting the list away stops whatever it was previewing — a preview you
   *  can't see is a preview you can't stop. Every way out goes through here. */
  const close = useCallback(() => { setOpen(false); stop(); }, [stop]);

  const preview = useCallback((track: MusicTrack) => {
    if (previewing === track.url) { stop(); return; }
    stop();
    const el = new Audio(track.url);
    el.preload = 'auto';
    el.volume = Math.min(1, Math.max(0, level));
    audioRef.current = el;
    setPreviewing(track.url);
    // From the top, and for as long as it is left playing — the same way the
    // song goes under the video. It stops when it is pressed again, when
    // another one is started, when the list is put away, or when the track
    // runs out.
    void el.play().catch(() => { if (audioRef.current === el) stop(); });
    el.onerror = () => { if (audioRef.current === el) stop(); };
    el.onended = () => { if (audioRef.current === el) stop(); };
  }, [previewing, level, stop]);

  const current = tracks.find((t) => t.url === music) ?? null;
  const rowCls = (on: boolean) =>
    `flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] transition-colors ${
      on ? 'bg-zinc-900 text-white' : 'text-zinc-300 hover:bg-zinc-900/60'
    }`;

  return (
    <div className="relative min-w-0 flex-1">
      <button
        onClick={() => (open ? close() : setOpen(true))}
        title="A song under the whole video, from the audio library"
        className="flex w-full items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-left transition-colors hover:border-zinc-500"
      >
        <span className={`min-w-0 flex-1 truncate text-[11px] ${current ? 'text-zinc-200' : 'text-zinc-500'}`}>
          {current?.label ?? 'None'}
        </span>
        <span className={`shrink-0 text-[7px] leading-none text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onPointerDown={close} />
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-950 shadow-xl">
            <button onClick={() => { onChoose(null); close(); }} className={rowCls(!music)}>
              <span className="w-[18px] shrink-0" />
              <span className="min-w-0 flex-1 truncate">None</span>
            </button>
            {tracks.map((t) => (
              <div key={t.url} className={rowCls(t.url === music)}>
                <button
                  onClick={(e) => { e.stopPropagation(); preview(t); }}
                  title={previewing === t.url ? 'Stop' : 'Play this one from the start'}
                  className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border transition-colors ${
                    previewing === t.url
                      ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                      : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white'
                  }`}
                >
                  <PlayGlyph stop={previewing === t.url} />
                </button>
                <button
                  onClick={() => { onChoose(t); close(); }}
                  className="min-w-0 flex-1 truncate text-left"
                >
                  {t.label}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** One continuous layer under the stage — room tone, or the song. Each is its
 *  own looping source rather than anything to do with the clips: both run the
 *  length of the timeline, so seeking around inside one shouldn't restart it.
 *  Both are the layers lib/simpler/vidsCompose lays into the file, so what you hear
 *  while the stage runs is what the export will carry.
 *
 *  A null `url` is the layer switched off. `arm` makes it ready to play and is
 *  called from the transport, which is a click — the gesture a browser wants
 *  before it will let a page make sound. `error` is what went wrong loading it,
 *  because a bed that silently fails to load is a bed you notice only by its
 *  absence, halfway through an export.
 */
function useBed(
  openCtx: () => Promise<AudioContext | null>,
  url: string | null,
  gain: number,
  playing: boolean,
  /** Where the stage is, in timeline seconds. Read at the moment the layer
   *  opens and never subscribed to, so the picture moving is not something
   *  the sound restarts for. */
  at: { current: number },
  /** Bumped when the playhead has been PUT somewhere rather than having got
   *  there by playing. A layer already running re-opens at the new place. */
  epoch: number,
): { arm: () => Promise<void>; error: string | null } {
  // Keyed by url so switching track drops the old sample rather than playing it.
  const bufRef = useRef<{ url: string; buffer: AudioBuffer } | null>(null);
  const nodeRef = useRef<{ src: AudioBufferSourceNode; gain: GainNode; ctx: AudioContext } | null>(null);
  const gainRef = useRef(gain);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    const node = nodeRef.current;
    nodeRef.current = null;
    if (!node) return;
    // Ramp down rather than cutting the node dead, which would click.
    const now = node.ctx.currentTime;
    try {
      node.gain.gain.cancelScheduledValues(now);
      node.gain.gain.setValueAtTime(node.gain.gain.value, now);
      node.gain.gain.linearRampToValueAtTime(0, now + 0.05);
      node.src.stop(now + 0.07);
    } catch { /* already stopped */ }
  }, []);

  const arm = useCallback(async () => {
    if (!url) return;
    const ctx = await openCtx();
    if (!ctx || bufRef.current?.url === url) return;
    try {
      bufRef.current = { url, buffer: await decodeAudio(ctx, url) };
      setError(null);
    } catch (e) {
      bufRef.current = null;
      console.error(`[vids] ${url} failed to load:`, e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [openCtx, url]);

  // Moving the level while it plays should move what you hear.
  useEffect(() => {
    gainRef.current = gain;
    const node = nodeRef.current;
    if (node) node.gain.gain.setTargetAtTime(gain, node.ctx.currentTime, 0.05);
  }, [gain]);

  useEffect(() => {
    if (!playing || !url) {
      stop();
      return;
    }
    let alive = true;
    void (async () => {
      await arm();
      const ctx = await openCtx();
      const buf = bufRef.current;
      if (!alive || !ctx || buf?.url !== url || nodeRef.current) return;
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = buf.buffer;
      src.loop = true;
      const g = ctx.createGain();
      src.connect(g).connect(ctx.destination);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(gainRef.current, now + 0.05);
      // Where the file would be at this second. The layer runs under the whole
      // timeline from its top, so at t seconds in it is t seconds into itself,
      // come round as often as it has had to. Which is what makes pressing
      // play half way through drop you half way into the song instead of
      // starting it again — and what makes what you hear at a given moment on
      // the stage the same thing the export puts there.
      const dur = buf.buffer.duration;
      src.start(now, dur > 0 ? Math.max(0, at.current) % dur : 0);
      nodeRef.current = { src, gain: g, ctx };
    })();
    return () => { alive = false; stop(); };
  }, [playing, url, epoch, at, arm, openCtx, stop]);

  return { arm, error };
}

// ── Builder ───────────────────────────────────────────────────────────────────

interface Props {
  picks: Picks;
  onPicksChange: (updater: (prev: Picks) => Picks) => void;
  /** The clips filed under a slot's folder — where End comes from, and the
   *  BOOM when one has been filed by hand. */
  clipsForSlot: (slot: SlotId) => VidRow[];
  personas: VidPersona[];
  /** The persona filling Start / Top A / Top B, if the three still match one. */
  appliedPersonaId: string | null;
  active: boolean;
  /** The library has arrived. */
  libraryLoaded: boolean;
  /** What the form asked for and Generate made. Its `id` goes up on every
   *  Generate, and that is what tells this page the clips under it are new. */
  build: Vids2Build;
  /** Back to the five answers, as they were left. */
  onBackToForm: () => void;
}

export function Vids2Builder({
  picks, onPicksChange, clipsForSlot,
  personas, appliedPersonaId, active, libraryLoaded, build, onBackToForm,
}: Props) {
  const outW = OUT_W;
  const outH = OUT_H;
  const bars = BARS;
  const bottomAPace = PACE;

  // Room tone rides under every build, at the level it has always been at —
  // there is nothing here to switch it off or move it. clipLevel is how loud
  // what the clips carry sits against it, and music is nothing until a track
  // is chosen, and then a third layer beside the other two.
  const roomTone = DEFAULT_ROOM_TONE;
  const [music, setMusic] = useState<Music>(DEFAULT_MUSIC);
  const [clipLevel, setClipLevel] = useState(DEFAULT_CLIP_LEVEL);
  // The songs there are to pick from — whatever is in the audio library, which
  // is the same one the charts and carousel pages save into, so a track saved
  // there shows up here.
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [tracksError, setTracksError] = useState<string | null>(null);
  // Whether the song is anybody's decision yet. A track picked by hand, "None",
  // a roll, or a build brought back by its code all count — after any of them
  // the list arriving (or arriving again) leaves the choice alone.
  const musicChosenRef = useRef(false);
  // Whether this build is in degen mode, for the roll the list makes when it
  // lands — which can be after the build it was asked for has changed.
  const degenRef = useRef(build.mode === 'degen');
  useEffect(() => { degenRef.current = build.mode === 'degen'; }, [build.mode]);
  // Likewise the captions' look: rolled once when the pane first opens, then
  // only by Reset or by picking one.
  const styleChosenRef = useRef(false);
  // Browser-measured clip lengths + load failures, keyed by video id so a
  // re-picked slot never carries a stale value.
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  // The frame the paused stage is currently showing. Kept so a redraw that
  // isn't about time (a caption edit) can repaint exactly the frame you are
  // looking at.
  const shownRef = useRef(0);
  const [avail, setAvail] = useState({ w: 0, h: 0 });
  const [exporting, setExporting] = useState<{ frac: number; label: string } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  // The code the last export was written down under. Nothing on the page
  // brings a build back by it any more — it is here because it goes in the
  // file name and on the end of the post caption.
  const [lastRecipe, setLastRecipe] = useState<VidRecipe | null>(null);
  // Which export the code on show belongs to. The record is written down as
  // the render starts and shown straight away, so a run that then fails has to
  // be able to disown a record still on its way back.
  const exportRun = useRef(0);
  const [recipeError, setRecipeError] = useState<string | null>(null);
  // The picks as they are now, for a job that lands its clips after the
  // stage has moved on (a persona chosen while the render ran).
  const picksRef = useRef(picks);
  useEffect(() => { picksRef.current = picks; }, [picks]);
  // The words are waiting on the clips: `pendingWrite` holds the ids still to
  // report a length, and `busy` is what the sidebar says while they do. The
  // captions are written off the clips as the browser measured them, so they
  // cannot go until every clip has reported in (or failed).
  const [busy, setBusy] = useState(false);
  const pendingWrite = useRef<{ ids: Set<string> } | null>(null);

  const stageWrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Text metrics for the caption box — see capHandle.
  const measureRef = useRef<CanvasRenderingContext2D | null>(null);
  const videoEls = useRef(new Map<LayerId, HTMLVideoElement>());
  /** One <audio> per BOOM that has a sound, by BOOM id. Kept apart from the
   *  pictures because a bang is not a layer: nothing is drawn from it, it is
   *  never seeked frame-accurately, and it plays at its own speed while the
   *  picture over it does not. */
  const boomAudioEls = useRef(new Map<string, HTMLAudioElement>());
  // A photo slot has no <video> to seek — just the still, sampled straight into
  // the frame like any other picture.
  const imgEls = useRef(new Map<LayerId, HTMLImageElement>());
  // The last frame each slot was showing before we seeked it. A seek empties the
  // element for a moment, and the stage clears to black every frame, so without
  // this a looping Top A flashes black at every join.
  const lastFrames = useRef(new Map<LayerId, HTMLCanvasElement>());
  const clockRef = useRef<{ startedAt: number; offset: number } | null>(null);
  const activeRef = useRef(new Set<LayerId>());
  const timeRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // Display scale: output px → screen px.
  const k = useMemo(() => {
    if (!avail.w || !avail.h) return 0;
    return Math.max(0, Math.min((avail.w - STAGE_PAD) / outW, (avail.h - STAGE_PAD) / outH));
  }, [avail, outW, outH]);
  const dispW = Math.round(outW * k);
  const dispH = Math.round(outH * k);

  // ── The BOOM ──
  // A clip laid over the top of the whole video, from the transport. It is no
  // part of the sequence — nothing waits for it, it fills no slot, it adds no
  // clip and it never makes the video any longer (buildPlan pulls it back to
  // end on the last frame). The clip itself has nothing behind its picture, so
  // what it covers goes on showing through it; what it does is go on top.
  // That is why it is kept here rather than in the picks.
  //
  // Insert arms one and the bar says where — press Insert, then press the bar
  // on the moment it should land. As many as you like, so Insert arms another
  // rather than moving the last; pressing the mark one left on the bar is what
  // takes it off again.
  const [booms, setBooms] = useState<BoomInsert[]>([]);
  /** The sound the next BOOM will be laid with. Each BOOM keeps whatever was
   *  chosen when it went down, so changing this is a choice about the next one
   *  rather than about the ones already on the video. */
  const [boomSound, setBoomSound] = useState<BoomSound | null>(null);
  const [boomSounds, setBoomSounds] = useState<BoomSound[]>([]);
  const [boomLevel, setBoomLevel] = useState(DEFAULT_BOOM_LEVEL);
  /** Kept so a BOOM already down is not re-sought every time the level moves
   *  — the elements read it, they do not depend on it. */
  const boomLevelRef = useRef(boomLevel);
  boomLevelRef.current = boomLevel;
  /** Armed and waiting for the bar to be pressed. While it is, the stage shows
   *  the BOOM landing wherever the playhead is — see the preview in draw(). */
  const [boomArming, setBoomArming] = useState(false);

  const plan = useMemo(
    () => buildPlan(picks, durations, bars, bottomAPace, booms),
    [picks, durations, bars, bottomAPace, booms],
  );
  const total = plan.total;
  /** The BOOMs as they actually landed — each pulled back from where it was
   *  pressed in if it was too near the end to fit. What the bar marks. */
  const boomItems = useMemo(() => plan.items.filter(isBoomItem), [plan]);

  // ── Captions ──
  // Written by the model, kept here as plain lines so they can be edited by
  // hand afterwards, and timed against the real plan: Top A rides exactly
  // across Bottom A then Bottom B, so a line laid inside one of those spans is
  // over that clip by construction. End gets one pay-off line over the
  // winnings; Top B shares that window and carries nothing of its own.
  const [lines, setLines] = useState<CaptionLines>(EMPTY_LINES);
  /** Somebody has typed the hook themselves — most likely while the bottom was
   *  still rendering, which is the whole point of the row being there before
   *  the rest of the words are. A hook with words in it that were typed is
   *  theirs: the writer is not asked for one, and clearing the words for a new
   *  bottom leaves it standing. Emptying the box hands it back, so there is no
   *  way to end up with no hook and nothing willing to write one.
   *
   *  A ref, not state: nothing on the page looks any different for it, and
   *  every place that asks is either inside a state updater or on the far side
   *  of an await — both places where a value read at render time is the value
   *  from before the typing rather than the one that matters. */
  const startTouched = useRef(false);
  /** The words for a new set of clips: everything goes, except a hook that was
   *  written by hand. */
  const clearLines = useCallback(
    () => setLines((prev) => (
      hookIsTheirs(startTouched.current, prev) ? { ...EMPTY_LINES, start: prev.start } : EMPTY_LINES
    )),
    [],
  );
  const [styleId, setStyleId] = useState<string>(DEFAULT_CAPTION_STYLE);
  /** How big the words are drawn, as a multiple of whatever the look asks for.
   *  Set by hand under the picker; a fresh look is never rolled with one, so
   *  this is the size somebody chose and Reset leaves it alone — the same way
   *  the sound levels are left. */
  const [capScale, setCapScale] = useState(DEFAULT_CAPTION_SCALE);
  const [writing, setWriting] = useState(false);
  const [captionError, setCaptionError] = useState<string | null>(null);
  // What the writer is steered with. Nothing here sets either any more — the
  // captions write themselves — but both still go to the route and into the
  // record, so a build says what it was written from.
  const notes = '';
  // Two or three emoji across the whole set, where one actually lands: these
  // are captions for short vertical video, and a bare set reads flat next to
  // everything else on the feed.
  const emojis = true;
  // Which emoji the writer may use: the ones pinned in the sidebar's Emojis
  // drawer — the set already chosen to reach for — handed over as their
  // characters. They are drawn from the app's Apple images on the stage and in
  // the file (lib/simpler/vidsCaptions), so what is picked from here is what goes out.
  const { prefs: emojiPrefs } = useEmojiPrefs();
  const emojiPalette = useMemo(
    () => pinnedUnifieds(emojiPrefs).map((u) => emojiByUnified(u)?.char).filter((c): c is string => !!c),
    [emojiPrefs],
  );
  const windows = useMemo(() => captionWindows(plan), [plan]);
  const caption = useMemo(() => buildCaptions(windows, lines), [windows, lines]);
  const captions = caption.all;
  const capStyle = useMemo(() => scaleCaptionStyle(captionStyle(styleId), capScale), [styleId, capScale]);
  const canCaption = !!windows.start || !!windows.bottomA || !!windows.bottomB || !!windows.end;
  const hasLines = !!(
    lines.start.text.trim() || lines.bottomA.length || lines.bottomB.length
    || lines.end.text.trim()
  );
  // Who the build trades on — what the fixed lines put in place of {name}
  // ("lock in ronaldo", "search ronaldo"). Lower-cased, since that is how the
  // written lines around them say a name. Simpler has to read this off the
  // Bottom B clip's file name; here the form said it outright, so it is simply
  // the answer, squeezed the same way.
  const capName = personKey(build.person);

  // What the writer is told about one screen recording: its overall context and,
  // when it has been marked up, the ordered steps — which is what makes the
  // captions land on the beat rather than merely inside the clip.
  const clipBrief = (w: CaptionWindow | null, context: string | undefined) => (w
    ? { context: context ?? '', marks: w.marks.map((m) => m.text), count: wantedCount(w) }
    : null);

  // The hook is the persona's bit, so it comes from the persona's context; a
  // build with no persona applied falls back to whatever the Start clip itself
  // says. The screen-recording lines come from each bottom clip's own context.
  const writeLines = async () => {
    if (!canCaption) return;
    const persona = personas.find((p) => p.id === appliedPersonaId) ?? null;
    // Bottom A on Fast carries FAST_BOTTOM_A_CAPTIONS lines, and the writer
    // says when each goes up as well as what it says: it is handed the clip's
    // moments on the sped-up window, and what comes back is put on the clip's
    // own clock, so a line stays on its moment whatever the pace does later.
    // Except a marked clip Fast has not had to speed up — one that already
    // fits, playing at its own speed, like the ChatGPT recording the Bottom
    // card makes, marked by the renderer beat by beat (search, wait, pick).
    // Its marks are exact and there is room for them, so it is captioned like
    // any marked clip: one line each, on the mark.
    const aWin = windows.bottomA;
    const aItem = plan.items.find((i) => i.slot === 'bottomA') ?? null;
    const aSped = !!aItem && !!picks.bottomA
      && aItem.speed > slotSpeed('bottomA', picks.bottomA.speed, aItem.sourceLength, 'normal') + 1e-6;
    // A news intro is always captioned on its marks: three lines, the first
    // two fixed outright (NEWS_BOTTOM_A_LINES), the pick rolled — never the
    // two placed lines Fast asks the writer for.
    const newsA = build.intro === 'news';
    const placeA = bottomAPace === 'fast' && !newsA && !!aWin && !!aItem
      && (aSped || !aWin.marks.length)
      && aWin.end - aWin.start >= FAST_BOTTOM_A_CAPTIONS * MIN_SHARE;
    const briefA = clipBrief(aWin, picks.bottomA?.video.context);
    const personaContext = persona?.context || picks.start?.video.context || '';
    // A hook somebody wrote themselves is not the model's to write. The rest
    // of the words still follow on from it, but nothing is asked for another.
    // Somebody who starts typing after this has gone out is covered too:
    // whatever comes back for the hook is dropped on arrival if the box has
    // words in it by then.
    const wantHook = !!windows.start && !hookIsTheirs(startTouched.current, lines);
    // The hook is written to the mode's own guide (api/vids/hook), off who,
    // which way and what the persona is doing — nothing on the screen
    // recordings — so it goes out beside the rest of the words rather than
    // inside them, and each lands as it comes back.
    setWriting(true);
    setCaptionError(null);
    const hook = wantHook
      ? writeHook({ mode: build.mode, person: build.person, direction: build.direction, personaContext })
        .then(({ start }) => setLines((prev) => (hookIsTheirs(startTouched.current, prev)
          ? prev
          : { ...prev, start: { ...capLine(start, prev.start.oneLine), pos: prev.start.pos } })))
      : null;
    const rest = (async () => {
      const draft = await writeCaptions({
        personaName: persona?.name ?? '',
        personaContext,
        wantStart: false,
        notes: notes.trim(),
        bottomA: placeA && briefA && aWin
          ? {
            ...briefA,
            count: FAST_BOTTOM_A_CAPTIONS,
            placed: {
              length: aWin.end - aWin.start,
              spans: aWin.marks.map((m) => ({ start: m.start - aWin.start, end: m.end - aWin.start })),
            },
          }
          : briefA,
        bottomB: clipBrief(windows.bottomB, picks.bottomB?.video.context),
        wantEnd: !!windows.end,
        endContext: picks.end?.video.context ?? '',
        emojis,
        emojiPalette,
        // The one place two marks share a line, and only when the timeline
        // says neither side has room for its own. Never across a placed
        // Bottom A: its two lines are the search and the pick.
        mergeSeam: !placeA && seamNeedsMerge(windows),
        // Bottom B is always the rendered trade here, so the writer is told its
        // chart and confirmation lines are fixed and its trade line carries $.
        renderedTrade: true,
      });
      const atA = placeA ? draft.bottomAAt : undefined;
      const toClip = (at: number) => (aItem ? Math.round((aItem.trimStart + at * aItem.speed) * 100) / 100 : at);
      // Two of Bottom A's lines are not the model's to write — the wait and the
      // pick — so whatever came back in those slots is dropped for one of the
      // fixed lines (lib/simpler/vidsCaptions). They are taken by mark, so they
      // only stand in on a clip marked the way the rendered ChatGPT recording
      // is: three beats, one line each, never the two placed lines Fast asks for.
      const fixedA = !placeA && draft.bottomA.length >= 3;
      /** What stands in for the writer's line at Bottom A's index, if
       *  anything: on a news intro the first two lines outright, then the
       *  rolled pick; on a ChatGPT one the rolled wait and pick. */
      const standInA = (i: number): string | null =>
        (newsA && NEWS_BOTTOM_A_LINES[i]) || (fixedA ? fixedLine('bottomA', i, capName) : null);
      const textA = draft.bottomA.map((t, i) => (fixedA && fixedLine('bottomA', i, capName)) || t);
      // Bottom B is the rendered trade, and three of its four lines are not the
      // model's either: the opener, the chart and the confirmation. The trade
      // between them is, held to having its amount in $ (lib/vids2
      // bottomBFixed, bottomBTrade). The chart and confirmation steer clear of
      // whatever Bottom A just said.
      const fixedB = draft.bottomB.length >= 4;
      const saidA = textA.map(bareFixedLine);
      const textB = draft.bottomB.map((t, i) => (i === 0 ? bottomBOpen(capName)
        : !fixedB ? t
        : bottomBFixed(i, saidA) ?? (i === 2 ? bottomBTrade(t, capName, build.direction) : t)));
      // A rewrite keeps whatever was set to one line, and wherever a line was
      // dragged to, matched up by position — both are about the shape and place
      // of the caption slot rather than its wording. A line that wasn't there
      // before starts on its section's default.
      setLines((prev) => ({
        // The hook is its own call's to write, whichever of the two lands
        // first; everything else is filled in around it.
        start: prev.start,
        bottomA: textA.map((t, i) => {
          const at = atA?.[i];
          return {
            ...capLine(standInA(i) || t,
              prev.bottomA[i]?.oneLine ?? ONE_LINE_DEFAULT.bottomA),
            pos: prev.bottomA[i]?.pos,
            ...(at != null && Number.isFinite(at) ? { at: toClip(at) } : {}),
          };
        }),
        bottomB: textB.map((t, i) => ({
          ...capLine(t, prev.bottomB[i]?.oneLine ?? ONE_LINE_DEFAULT.bottomB),
          pos: prev.bottomB[i]?.pos,
        })),
        end: { ...capLine(draft.end, prev.end.oneLine), pos: prev.end.pos },
      }));
    })();
    // One failing leaves whatever the other wrote standing.
    const failed = (await Promise.allSettled([rest, hook]))
      .flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));
    if (failed.length) setCaptionError(failed.map((e) => (e instanceof Error ? e.message : String(e))).join(' · '));
    setWriting(false);
  };
  const broken = plan.items.filter((i) => errors[i.video.id]);

  // The captions, once the clips are in. They are written off the clips as
  // the browser measured them, so the words wait until every clip just picked
  // has loaded or failed. One that says neither within ROLL_WAIT_MS is written
  // around from the library's own figures rather than leaving the stage half
  // done. The ref keeps the effect on the current writeLines without
  // re-subscribing it every render.
  const writeLinesRef = useRef(writeLines);
  useEffect(() => { writeLinesRef.current = writeLines; });
  useEffect(() => {
    const pending = pendingWrite.current;
    if (!pending) return;
    const finish = () => {
      pendingWrite.current = null;
      setBusy(false);
      void writeLinesRef.current();
    };
    const heard = Array.from(pending.ids).every((id) => id in durations || id in errors);
    if (heard) { finish(); return; }
    const t = window.setTimeout(() => { if (pendingWrite.current === pending) finish(); }, ROLL_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [picks, durations, errors]);

  // Latest plan + geometry for the rAF loop, without re-subscribing it per frame.
  const liveRef = useRef({ plan, k, dispW, dispH, outW, outH, captions, capStyle, durations });
  useEffect(() => {
    liveRef.current = { plan, k, dispW, dispH, outW, outH, captions, capStyle, durations };
  }, [plan, k, dispW, dispH, outW, outH, captions, capStyle, durations]);

  /** The clip a BOOM would be while one is being placed, or null when none is.
   *  A ref because draw() asks on every frame as the playhead moves, and the
   *  answer must not be a reason to rebuild the plan — see the preview in
   *  draw(). Filled in below, once there is a clip to fill it with. */
  const armingRef = useRef<VidRow | null>(null);

  // ── Measure the stage area ──
  useEffect(() => {
    const el = stageWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setAvail({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A slot plays exactly what it is carrying: nothing for raw footage, and the
  // keyboard for a clip Prep baked it into — that is all `muted` means here (see
  // SlotPick.muted). syncElements drives these elements with real play/pause, so
  // un-muting one is enough to hear it. React doesn't always reflect `muted`, so
  // set it on the elements as well as in the markup.
  // The BOOM is the one thing on the stage that is heard for itself, and it
  // sits at the same level the footage does.
  useEffect(() => {
    for (const s of SLOTS) {
      const v = videoEls.current.get(s.id);
      if (!v) continue;
      v.muted = picks[s.id]?.muted ?? true;
      v.volume = clampClipLevel(clipLevel);
    }
    // A BOOM’s picture is silent — what is heard is the sound chosen for it,
    // which is its own element (boomAudioEls) and its own level.
    for (const b of booms) {
      const v = videoEls.current.get(boomLayer(b.id));
      if (v) { v.muted = true; v.volume = 0; }
    }
    const prev = videoEls.current.get(BOOM_PREVIEW_LAYER);
    if (prev) { prev.muted = true; prev.volume = 0; }
  }, [picks, clipLevel, booms, boomArming]);

  // The bangs follow their own level, without the elements being re-sought:
  // moving a slider is not a seek.
  useEffect(() => {
    for (const el of boomAudioEls.current.values()) el.volume = boomGain(boomLevel);
  }, [boomLevel, booms]);

  /** What to sample a slot from right now: its <video> when it has a frame to
   *  give, the still for a photo slot, or the frame kept from just before a seek
   *  while the element has nothing — see lastFrames. */
  const frameSource = useCallback((slot: LayerId): { el: CanvasImageSource; w: number; h: number } | null => {
    const v = videoEls.current.get(slot);
    if (v) {
      const ready = v.readyState >= 2 && v.videoWidth > 0;
      if (ready && !v.seeking) return { el: v, w: v.videoWidth, h: v.videoHeight };
      const kept = lastFrames.current.get(slot);
      if (kept) return { el: kept, w: kept.width, h: kept.height };
      return ready ? { el: v, w: v.videoWidth, h: v.videoHeight } : null;
    }
    const img = imgEls.current.get(slot);
    return img?.complete && img.naturalWidth ? { el: img, w: img.naturalWidth, h: img.naturalHeight } : null;
  }, []);

  /** Where a slot was asked to go while it was already seeking somewhere else.
   *  Assigning currentTime again mid-seek cancels the one in flight, and an
   *  element whose seeks keep being cancelled — which is what dragging the bar
   *  does — never finishes one, so it never has a frame to give and its half of
   *  the picture goes black. So one seek runs at a time and the latest place
   *  asked for waits here for it to land. */
  const wantedSeek = useRef(new Map<LayerId, number>());

  /** One ref callback per layer, made once and reused.
   *
   *  An inline `ref={(el) => …}` is a different function on every render, and
   *  React answers a different ref function by detaching the old one — it
   *  calls it with null and the new one with the element, every render. The
   *  element comes straight back, so that part went unnoticed; the frame kept
   *  beside it did not. It was dropped on the way out and nothing put it back,
   *  and since dragging the bar re-renders on every pointer move, the frame
   *  that stands in while a clip seeks was being thrown away as fast as it was
   *  banked. That is the hole the picture kept falling into. Made once, these
   *  run when an element really does come or go: a clip replaced, or the stage
   *  emptied. */
  //  Each one is made the first time its layer is asked for and kept from then
  //  on, rather than made up front from a fixed list: there is no knowing how
  //  many BOOMs a build will carry, and they come and go as they are pressed
  //  in and taken off. What matters is only that a layer gets the same callback
  //  every render, which this still gives it.
  const layerRefs = useMemo(() => {
    const video = new Map<LayerId, (el: HTMLVideoElement | null) => void>();
    const image = new Map<LayerId, (el: HTMLImageElement | null) => void>();
    return {
      video: (slot: LayerId) => {
        let ref = video.get(slot);
        if (!ref) {
          ref = (el) => {
            if (el) { videoEls.current.set(slot, el); return; }
            videoEls.current.delete(slot);
            lastFrames.current.delete(slot);
            wantedSeek.current.delete(slot);
          };
          video.set(slot, ref);
        }
        return ref;
      },
      image: (slot: LayerId) => {
        let ref = image.get(slot);
        if (!ref) {
          ref = (el) => {
            if (el) imgEls.current.set(slot, el);
            else imgEls.current.delete(slot);
          };
          image.set(slot, ref);
        }
        return ref;
      },
    };
  }, []);

  /** Keep the frame a slot is showing, just before something seeks it. One copy
   *  per seek rather than per frame, which is what makes the fallback free. */
  const stashFrame = useCallback((slot: LayerId, v: HTMLVideoElement) => {
    if (v.readyState < 2 || !v.videoWidth) return;
    let c = lastFrames.current.get(slot);
    if (!c) { c = document.createElement('canvas'); lastFrames.current.set(slot, c); }
    if (c.width !== v.videoWidth || c.height !== v.videoHeight) {
      c.width = v.videoWidth;
      c.height = v.videoHeight;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    // Wiped before the frame goes on, not just when the canvas is resized: the
    // BOOM has nothing behind its picture, and a frame of it laid over the one
    // kept last time would keep that one showing through.
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(v, 0, 0);
  }, []);

  // ── Drawing ──
  const draw = useCallback((t: number) => {
    const { plan, k, dispW, dispH, outW, outH, captions, capStyle, durations } = liveRef.current;
    const armingBoom = armingRef.current;
    const canvas = canvasRef.current;
    if (!canvas || !k) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(dispW * dpr);
    const ph = Math.round(dispH * dpr);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    // Resizing a canvas resets its context, so this is re-asked every frame
    // rather than once — the stage is a downscale of the output frame, and it
    // should look like what the file will.
    smoothScaling(ctx);
    // Draw in output px; the transform maps to device px.
    ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, outW, outH);
    const paint = (item: PlanItem) => {
      const src = frameSource(item.slot);
      if (src) drawPlanItem(ctx, src.el, src.w, src.h, item, outW, outH, plan.bars);
    };
    const on = activeAt(plan, t);
    for (const item of on) if (!isBoomItem(item)) paint(item);
    // The words over every region — the same call the exporter makes.
    const cap = captionAt(captions, t);
    if (cap) drawCaption(ctx, cap, outW, outH, capStyle, plan.bars);
    // And the BOOMs over those: they are on top of the whole video, words and
    // all. In plan order, so two that overlap stack the way they were laid.
    // One laid for its noise alone has nothing to put on the frame.
    for (const item of on) if (isBoomItem(item) && item.picture !== false) paint(item);
    // While one is being placed, its first frame goes on wherever the playhead
    // is, so running along the bar shows it landing rather than only saying
    // where it would. Worked out by boomPlanItem, the very call that will place
    // it, so what is shown is where it goes — pull-back at the end and all.
    if (armingBoom) {
      const item = boomPlanItem({ id: BOOM_PREVIEW_ID, video: armingBoom, at: t, sound: null }, plan.total, durations);
      if (item) paint(item);
    }
  }, [frameSource]);

  // Point every slot's <video> at the right local time for `t`: entering slots
  // seek, leaving slots pause. `force` re-seeks the already-active ones too
  // (scrubbing / plan edits); the play loop leaves them running.
  const syncElements = useCallback((t: number, play: boolean, force: boolean) => {
    const { plan } = liveRef.current;
    // Every seek goes through here so the frame on screen is kept first, and
    // so that only one seek per element is ever in flight — see wantedSeek.
    const seekTo = (slot: LayerId, el: HTMLVideoElement, to: number) => {
      if (el.seeking) { wantedSeek.current.set(slot, to); return; }
      wantedSeek.current.delete(slot);
      stashFrame(slot, el);
      el.currentTime = to;
    };
    const tt = Math.min(t, Math.max(0, plan.total - 1e-3));
    const nowActive = new Set<LayerId>();
    for (const item of plan.items) {
      const v = videoEls.current.get(item.slot);
      if (!v || tt < item.start || tt >= item.end) continue;
      nowActive.add(item.slot);
      const wasActive = activeRef.current.has(item.slot);
      const endLocal = item.trimStart + item.sourceLength;
      const into = (tt - item.start) * item.speed;
      // A looping slot wraps back to its in point instead of stopping on the
      // last frame; everything else parks there for as long as its window runs.
      const local = item.loop
        ? item.trimStart + (into % item.sourceLength)
        : item.trimStart + Math.min(into, Math.max(0, item.sourceLength - 0.001));
      // Match the exporter: hold the pitch rather than resample, so a sped-up
      // slot sounds like itself here and in the file. Both are set every pass
      // because re-picking a slot hands us a fresh element.
      if (v.playbackRate !== item.speed) v.playbackRate = item.speed;
      v.preservesPitch = true;
      if ((!wasActive || force) && Math.abs(v.currentTime - local) > 0.05) seekTo(item.slot, v, local);
      if (play) {
        // Park on the out point: a trimmed clip must not run past it while its
        // window is still open (the window is longer only if it holds a frame).
        // A looping slot goes round instead — back to the in point, still running.
        if (!v.paused && v.currentTime >= endLocal - 0.02) {
          if (item.loop) seekTo(item.slot, v, item.trimStart);
          else {
            v.pause();
            if (Math.abs(v.currentTime - (endLocal - 0.001)) > 0.05) seekTo(item.slot, v, endLocal - 0.001);
          }
        } else if (v.paused && v.currentTime < endLocal - 0.05) {
          v.play().catch(() => {});
        }
      } else if (!v.paused) {
        v.pause();
      }
    }
    for (const slot of activeRef.current) {
      if (!nowActive.has(slot)) videoEls.current.get(slot)?.pause();
    }
    activeRef.current = nowActive;

    // The bangs. A one-shot at its own speed, so where it is up to is simply
    // how long the playhead has been past the moment it lands on — no rate to
    // divide by and no trim to add. It runs its own length, which may be
    // shorter or longer than the picture it came in with; past the end of it
    // there is nothing to play, and before the start there is nothing yet.
    for (const item of plan.items) {
      if (!isBoomItem(item)) continue;
      const el = boomAudioEls.current.get(boomIdOf(item.slot));
      if (!el) continue;
      el.volume = boomGain(boomLevelRef.current);
      const into = tt - item.start;
      // `duration` is NaN until the file has loaded; an unmeasured sound is
      // treated as still running rather than already over, so the first play
      // after a fresh load is not silently skipped.
      const len = Number.isFinite(el.duration) ? el.duration : Infinity;
      if (into < 0 || into >= len) {
        if (!el.paused) el.pause();
        continue;
      }
      if ((force || el.paused) && Math.abs(el.currentTime - into) > 0.05) {
        try { el.currentTime = into; } catch { /* not seekable yet */ }
      }
      if (play) { if (el.paused) void el.play().catch(() => {}); }
      else if (!el.paused) el.pause();
    }
  }, [stashFrame]);

  // Plan / geometry changed while paused → re-sync the elements and redraw.
  useEffect(() => {
    if (playing) return;
    const t = Math.min(timeRef.current, total);
    timeRef.current = t;
    shownRef.current = t;
    syncElements(t, false, true);
    draw(t);
  }, [plan, total, k, playing, syncElements, draw]);

  // Captions changed while paused — the words, the style, or one dragged to a
  // new spot. Nothing about the clips moved, so they are left running where they
  // are and the frame is simply painted again: you see the edit as you make it,
  // without pressing play to fetch it.
  useEffect(() => {
    if (playing) return;
    draw(shownRef.current);
  }, [captions, capStyle, playing, draw]);

  // The Apple images for whatever emoji the captions carry, fetched as soon as
  // the words change — and the frame painted again once they are in, so a line
  // that arrived with a new emoji shows the image rather than the OS glyph it
  // fell back to while the file was on its way.
  useEffect(() => {
    let live = true;
    void preloadCaptionEmoji(captions).then(() => { if (live && !playing) draw(shownRef.current); });
    return () => { live = false; };
  }, [captions, playing, draw]);

  // Render loop while playing; a wall clock drives the timeline.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const c = clockRef.current;
      const { plan } = liveRef.current;
      if (!c) return;
      let t = c.offset + (performance.now() - c.startedAt) / 1000;
      if (t >= plan.total) {
        t = plan.total;
        timeRef.current = t;
        syncElements(t, false, false);
        draw(t);
        setTime(t);
        setPlaying(false);
        return;
      }
      timeRef.current = t;
      syncElements(t, true, false);
      draw(t);
      setTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, syncElements, draw]);

  // The songs to choose from. Listed when the pane opens rather than on mount,
  // so a page that never reaches Vids never asks; a track saved from another
  // page turns up here the next time it is opened.
  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    listMusic(ctrl.signal)
      .then((ts) => {
        setTracks(ts);
        setTracksError(null);
        // A song renamed since it was chosen (on the Clippers page) is chosen
        // under its new name — that is the label the record is written with.
        setMusic((m) => {
          const t = m.url ? ts.find((x) => x.url === m.url) : undefined;
          return t && t.label !== m.label ? { ...m, label: t.label } : m;
        });
        // Arrive with something under it: a song nobody chose is easier to swap
        // than one nobody thought to add. Never a degen one outside degen mode.
        if (!musicChosenRef.current) {
          const t = pickRandom(rollableMusic(ts, degenRef.current));
          if (t) {
            musicChosenRef.current = true;
            setMusic((m) => ({ ...m, url: t.url, label: t.label }));
          }
        }
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setTracksError(e instanceof Error ? e.message : String(e));
      });
    return () => ctrl.abort();
  }, [active]);

  // The sounds a BOOM can make. Listed off the folder, so one dropped in is
  // there next time the page opens. The first is chosen to begin with: a BOOM
  // nobody picked a sound for should still land with one.
  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    listBoomSounds(ctrl.signal)
      .then((list) => {
        setBoomSounds(list);
        setBoomSound((cur) => {
          if (!cur) return list[0] ?? null;
          // The same file under a new name is still the one that was chosen.
          return list.find((x) => x.url === cur.url) ?? list[0] ?? null;
        });
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        // Not worth a banner: the BOOM still goes on the picture, silently.
        console.error('[vids] BOOM sounds unavailable:', e);
      });
    return () => ctrl.abort();
  }, [active]);

  // ── Sound preview ──
  // The same layers the export lays down, running while the stage runs, so what
  // you hear here is what the file will carry: room tone, and the song. One
  // AudioContext between them — a page gets few of them, and both beds want the
  // same click to open it.
  const audioRef = useRef<AudioContext | null>(null);
  const openCtx = useCallback(async (): Promise<AudioContext | null> => {
    // A context that has been closed can't be reopened, so it is replaced.
    if (audioRef.current?.state === 'closed') audioRef.current = null;
    if (!audioRef.current) {
      const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      audioRef.current = new Ctor();
    }
    const ctx = audioRef.current;
    // Suspended is the state a context is born in, and the one a browser puts it
    // back into when the tab goes away; resuming is free when it is already running.
    if (ctx.state === 'suspended') await ctx.resume().catch(() => { /* stays silent */ });
    return ctx;
  }, []);

  /** Bumped when the playhead has been put somewhere by hand: the song and the
   *  room re-open where the video now is, rather than playing on from where it
   *  was. A drag is given a moment to settle first — re-opening them on every
   *  frame of one would be a stutter, and nobody is listening to the song while
   *  the bar is moving. */
  const [bedEpoch, setBedEpoch] = useState(0);
  const bedSettle = useRef(0);
  const moveBeds = useCallback((wait = 0) => {
    window.clearTimeout(bedSettle.current);
    if (!wait) { setBedEpoch((n) => n + 1); return; }
    bedSettle.current = window.setTimeout(() => setBedEpoch((n) => n + 1), wait);
  }, []);
  useEffect(() => () => window.clearTimeout(bedSettle.current), []);

  // Both layers open however far into themselves the stage is — see useBed.
  const roomBed = useBed(openCtx, roomTone.on ? ROOM_TONE_URL : null, roomToneGain(roomTone), playing, timeRef, bedEpoch);
  const musicBed = useBed(openCtx, music.url, musicGain(music), playing, timeRef, bedEpoch);
  const soundError = roomBed.error ?? musicBed.error;

  useEffect(() => () => {
    void audioRef.current?.close().catch(() => { /* already gone */ });
    audioRef.current = null;
  }, []);

  // ── Transport ──
  const pause = useCallback(() => {
    setPlaying(false);
    syncElements(timeRef.current, false, false);
  }, [syncElements]);

  const play = () => {
    if (!plan.items.length) return;
    let t0 = timeRef.current;
    if (t0 >= total - 0.05) t0 = 0;
    timeRef.current = t0;
    clockRef.current = { startedAt: performance.now(), offset: t0 };
    syncElements(t0, true, true);
    setTime(t0);
    // Decoded here, inside the click, so the browser counts it as a gesture.
    // Each is a no-op when its layer is off.
    void roomBed.arm();
    void musicBed.arm();
    setPlaying(true);
  };

  /** Put the clips and the picture on `t` — the expensive half of a seek, kept
   *  apart from the state so the scrub bar can do it once a frame. */
  const showAt = useCallback((t: number, keepPlaying: boolean) => {
    if (keepPlaying) {
      clockRef.current = { startedAt: performance.now(), offset: t };
      syncElements(t, true, true);
    } else {
      syncElements(t, false, true);
      draw(t);
    }
  }, [syncElements, draw]);

  // `keepPlaying` is explicit because callers often pause() in the same handler,
  // and the `playing` closure value would still be stale.
  const seek = (t: number, keepPlaying: boolean) => {
    timeRef.current = t;
    setTime(t);
    showAt(t, keepPlaying);
    // The song and the room are where the video is, so a jump moves them too.
    if (keepPlaying) moveBeds();
  };

  /** Dragging the bar. A slider fires as often as the pointer moves, which on
   *  a fast mouse is several times a frame, and every one of those used to
   *  seek three video elements and redraw the stage. The readout and the thumb
   *  still follow the pointer exactly; the clips are put on the latest place
   *  asked for once per frame, which is as often as anything can be seen. */
  const scrubRaf = useRef(0);
  const scrubTo = useRef(0);
  const scrub = (t: number) => {
    timeRef.current = t;
    setTime(t);
    scrubTo.current = t;
    // The sound follows the bar once it has stopped moving. Before the early
    // return, so every move puts the wait back and it is the last place the
    // bar was left at that the song opens on.
    if (playing) moveBeds(BED_SETTLE_MS);
    if (scrubRaf.current) return;
    const keepPlaying = playing;
    scrubRaf.current = requestAnimationFrame(() => {
      scrubRaf.current = 0;
      showAt(scrubTo.current, keepPlaying);
    });
  };
  useEffect(() => () => { if (scrubRaf.current) cancelAnimationFrame(scrubRaf.current); }, []);

  /** Back to the top and away again — the button beside Play. Running, it
   *  jumps the playhead without stopping; paused, it starts it. */
  const restart = () => {
    if (!plan.items.length) return;
    if (playing) { seek(0, true); return; }
    timeRef.current = 0;
    setTime(0);
    play();
  };

  // Leaving the tab pauses; nothing should keep playing off-screen.
  useEffect(() => { if (!active) pause(); }, [active, pause]);

  // ── Slot lifecycle ──
  const handleMeta = (videoId: string) => (e: SyntheticEvent<HTMLVideoElement>) => {
    const d = Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0;
    setDurations((prev) => (prev[videoId] === d ? prev : { ...prev, [videoId]: d }));
  };

  /** A frame arrived — the clip loaded, or a seek landed on one. It is kept as
   *  this slot's fallback (so there is always something to show while the next
   *  seek runs, instead of a hole) and the picture is taken again. If the bar
   *  moved on while that seek was running, the element goes there now: one
   *  seek at a time, and always to the latest place asked for. */
  const handleFrame = (slot: LayerId) => (e: SyntheticEvent<HTMLVideoElement>) => {
    const el = e.currentTarget;
    stashFrame(slot, el);
    const want = wantedSeek.current.get(slot);
    wantedSeek.current.delete(slot);
    if (want != null && Math.abs(el.currentTime - want) > 0.05) el.currentTime = want;
    draw(timeRef.current);
  };

  // What the picture is showing — the playhead. Everything laid over the
  // stage reads from this, so the caption's box is always on the frame you can
  // see.
  const shown = time;

  // ── Moving a caption ──
  // A caption is painted onto the canvas, so that the stage and the exported
  // file are the same picture — which leaves nothing on the page to take hold
  // of. So the caption on screen also gets a box of its own laid over the
  // picture, measured from the very layout the painter uses, and that box is
  // what you drag. It sits above the clips, so a caption is always the thing you
  // get when you press on one.
  //
  // What moves is the written LINE, not this pass of the layout: the place
  // sticks to the words, so re-timing the build, rewriting its neighbours or
  // changing the style all leave it where you put it.
  const capDragRef = useRef<{ ref: CaptionRef; startX: number; startY: number; from: CaptionPos } | null>(null);

  const setLinePos = useCallback((ref: CaptionRef, pos: CaptionPos | undefined) => {
    setLines((prev) => {
      switch (ref.group) {
        case 'start': return { ...prev, start: { ...prev.start, pos } };
        case 'end': return { ...prev, end: { ...prev.end, pos } };
        case 'bottomA':
          return { ...prev, bottomA: prev.bottomA.map((l, i) => (i === ref.index ? { ...l, pos } : l)) };
        case 'bottomB':
          return { ...prev, bottomB: prev.bottomB.map((l, i) => (i === ref.index ? { ...l, pos } : l)) };
      }
    });
  }, []);

  /** The caption on screen right now: which line it came from, the box it fills
   *  in frame pixels, and where it is anchored. Measured off a canvas of its own
   *  — the preview one is mid-flight during playback, and text metrics don't
   *  depend on the canvas they are asked of. */
  const capHandle = useMemo(() => {
    const cap = captionAt(captions, shown);
    if (!cap) return null;
    if (!measureRef.current) measureRef.current = document.createElement('canvas').getContext('2d');
    const ctx = measureRef.current;
    if (!ctx) return null;
    const laid = layoutCaption(ctx, cap, outW, outH, capStyle, bars);
    if (!laid) return null;
    return {
      ref: cap.ref,
      moved: !!cap.pos,
      box: grow(laid.box, CAPTION_GRAB),
      // The middle of the block — where a drag picks the caption up from.
      from: { x: laid.x / outW, y: (laid.top + ((laid.lines.length - 1) * laid.step) / 2) / outH },
    };
  }, [captions, shown, outW, outH, capStyle, bars]);

  const startCaptionDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !k || !capHandle) return;
    // The clip behind it must not be picked up as well.
    e.stopPropagation();
    e.preventDefault();
    // It would otherwise run out from under the pointer mid-drag.
    pause();
    capDragRef.current = { ref: capHandle.ref, startX: e.clientX, startY: e.clientY, from: capHandle.from };
    stageRef.current?.setPointerCapture(e.pointerId);
    stageRef.current?.focus();
  };


  const onStagePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const cd = capDragRef.current;
    if (!cd || !k) return;
    // Derived from where the drag started, so nothing drifts over a long one.
    const dx = (e.clientX - cd.startX) / k / outW;
    const dy = (e.clientY - cd.startY) / k / outH;
    setLinePos(cd.ref, {
      x: clamp(cd.from.x + dx, CAPTION_EDGE, 1 - CAPTION_EDGE),
      y: clamp(cd.from.y + dy, CAPTION_EDGE, 1 - CAPTION_EDGE),
    });
  };

  const onStagePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!capDragRef.current) return;
    capDragRef.current = null;
    try { stageRef.current?.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };

  // Space plays and pauses, from anywhere on the page. The stage is the thing
  // on this page, and having to find the transport to stop a video — or to
  // click the stage first, which is what it used to take — is a step nobody
  // should have to take. A box you can type in keeps its spaces; every other
  // focus gives them up, so the key means one thing and never two at once (a
  // focused button would otherwise both press itself and toggle, which is to
  // say do nothing). Enter still presses a focused button.
  //
  // Held down, it toggles once rather than flapping, and a chooser on top of
  // the page keeps the keyboard to itself.
  const toggleRef = useRef(() => {});
  useEffect(() => { toggleRef.current = () => { if (playing) pause(); else play(); }; });
  useEffect(() => {
    if (!active) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      // An armed BOOM is the one thing on this page waiting on a press
      // somewhere else, so it is the one thing there is to back out of.
      if (e.key === 'Escape') { setBoomArming(false); return; }
      if (e.key !== ' ' || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      if (isTyping(e.target)) return;
      // Stop the page scrolling under it.
      e.preventDefault();
      toggleRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  // ── Export ──
  /** What an export is called when no code could be written for it. */
  const exportName = () => {
    const first = plan.items[0]?.video.name.replace(/\.[^.]+$/, '') ?? '';
    return `${safeExportName(first) || 'stack'}-stack.mp4`;
  };

  // What is on the stage, written down — the record a code brings back — and
  // the context the title is written from, which the record itself doesn't
  // carry. Both read the moment an export starts, before anything renders.
  const appliedPersona = personas.find((p) => p.id === appliedPersonaId) ?? null;
  const currentSpec = () => specFromBuild({
    picks, persona: appliedPersona, bars, bottomAPace, roomTone, music, clipLevel, boomLevel, preset: PRESET_ID,
    // Where each actually landed, not where it was pressed in — see boomItems.
    // One that found no room on the video is not in the record either.
    booms: booms.flatMap((b) => {
      const item = boomItems.find((i) => i.slot === boomLayer(b.id));
      return item ? [{ ...b, at: item.start }] : [];
    }),
    lines, styleId, captionScale: capScale, notes, emojis,
  });
  const currentBrief = () => ({
    personaContext: appliedPersona?.context || picks.start?.video.context || '',
    bottomAContext: picks.bottomA?.video.context ?? '',
    bottomBContext: picks.bottomB?.video.context ?? '',
    endContext: picks.end?.video.context ?? '',
  });

  // What the post caption is read from: the screen recordings and the ending
  // — what each shows and, where a clip was marked up, its moments in order.
  // Not the persona: the caption is about the person being traded, and he is
  // on the screen, not on camera. It is about which clips are on the stage
  // and nothing else — trimming, moving or re-captioning them leaves it alone
  // — so the caption is drafted again exactly when it would be about someone
  // else. Empty until there is a vid, since the vid is where the person is.
  const postBrief = useMemo(() => {
    // A build with no intro has the one recording, and it is still the vid.
    if (!picks.bottomA && !picks.bottomB) return '';
    const say = (label: string, context: string | undefined, marks: readonly { text: string }[] = []) => {
      const said = (context ?? '').trim();
      const beats = marks.map((m) => m.text.trim()).filter(Boolean);
      if (!said && !beats.length) return '';
      return `${label}: ${said || '(no context given)'}${beats.length ? `. Moments, in order: ${beats.join('; ')}` : ''}`;
    };
    return [
      picks.bottomA ? say('Screen recording 1', picks.bottomA.video.context, picks.bottomA.video.marks) : '',
      say(picks.bottomA ? 'Screen recording 2, on pauv.com' : 'Screen recording, on pauv.com',
        picks.bottomB?.video.context, picks.bottomB?.video.marks),
      say('Ending, him showing what the trade made', picks.end?.video.context),
    ].filter(Boolean).join('\n');
  }, [picks]);

  const runExport = async () => {
    if (!plan.items.length || broken.length || exporting) return;
    pause();
    setExportError(null);
    setRecipeError(null);
    setLastRecipe(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setExporting({ frac: 0, label: 'Starting…' });
    // Which export this is. A record that arrives after its own export has
    // failed belongs to nothing, so a late one is dropped rather than putting a
    // code on a video that never existed — see the catch.
    const run = ++exportRun.current;
    // The title and code are worked out while the frames render, so by the
    // time the file exists its name is waiting. The render is the long part.
    const recipeP = createRecipe({ build: currentSpec(), brief: currentBrief() });
    // The code goes up the moment it exists rather than when the render is
    // done: pressing the button is what writes the build down, and the caption
    // it belongs on is the thing being copied and pasted while the frames are
    // still going. Waiting for the file left it to be pasted from memory.
    recipeP
      .then((r) => { if (exportRun.current === run) setLastRecipe(r); })
      .catch(() => { /* handled where it is awaited */ });
    try {
      const blob = await composeSequence({
        // Held to the one size and rate a vid goes out at, whatever the clips
        // are — see OUT_FPS.
        width: outW,
        height: outH,
        fps: OUT_FPS,
        plan,
        captions,
        captionStyle: capStyle,
        roomTone,
        music,
        clipLevel,
        boomLevel,
        onProgress: (frac, label) => setExporting({ frac, label }),
        signal: ctrl.signal,
      });
      let recipe: VidRecipe | null = null;
      try {
        recipe = await recipeP;
      } catch (e) {
        // The file still goes out — under the old kind of name, and saying so.
        setRecipeError(`Exported, but no code could be saved for it: ${e instanceof Error ? e.message : String(e)}`);
      }
      const name = recipe ? `${recipe.name}.mp4` : exportName();
      downloadBlob(blob, name);
      // Already up since the record was written — set again only for the run
      // where it arrived after this point.
      if (recipe) setLastRecipe(recipe);
    } catch (e) {
      // No file came of it, so no code should answer to it: the record is
      // dropped, and the code comes back off the card and off the end of the
      // post caption. Bumping the run first sees off a record still in flight,
      // which would otherwise land a code on a video that never rendered.
      exportRun.current++;
      setLastRecipe(null);
      recipeP.then((r) => deleteRecipe(r.code)).catch(() => { /* never minted, or already gone */ });
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setExportError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setExporting(null);
      abortRef.current = null;
    }
  };

  // The house BOOM, unless one has been filed by hand among the Bottom B
  // recordings — that one wins (see lib/simpler/vidsBottom). Either way there is
  // always one, so the button is never waiting on a clip. The folder holds
  // nothing else Vids 2 reads: its Bottom B is rendered, not filed.
  const boomClip = useMemo(
    () => boomFromBottomB(clipsForSlot('bottomB')) ?? HOUSE_BOOM,
    [clipsForSlot],
  );

  // The stage shows the BOOM at the playhead for as long as one is being
  // placed. Set here rather than where boomArming is, because this is where
  // there is a clip to show — see the preview in draw().
  useEffect(() => {
    armingRef.current = boomArming ? boomClip : null;
    if (!playing) draw(timeRef.current);
  }, [boomArming, boomClip, playing, draw]);

  /** The button, which lays nothing down itself: it arms a BOOM for the bar to
   *  place, and pressing it again while armed thinks better of it. It never
   *  takes one off — pressing the mark a BOOM left on the bar does that — so
   *  there is nothing stopping a second, or a tenth. Nothing about the build
   *  changes either way: they go over the top of it. */
  const toggleBoom = () => {
    if (!plan.items.length) return;
    setBoomArming((armed) => !armed);
  };

  /** Where the bar was let go of while it was armed: that is the moment the
   *  BOOM lands on. Taken on release rather than on the first move, so running
   *  along the bar chooses the frame instead of dropping it where the drag
   *  started — and the playhead is already there, so what is on the stage is
   *  what it is going over. */
  const dropBoomAtPlayhead = () => {
    if (!boomArming) return;
    setBoomArming(false);
    if (!plan.items.length) return;
    // Its own name for its own layer and its own element — see BoomInsert.
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    setBooms((prev) => [...prev, { id, video: boomClip, at: timeRef.current, sound: boomSound }]);
  };

  const removeBoom = (layer: LayerId) => {
    setBooms((prev) => prev.filter((b) => boomLayer(b.id) !== layer));
  };

  /** The clips a set of picks would put on the stage — what the words wait on
   *  before they are written. A still never reports a length, so it is not
   *  something to wait for. */
  const clipIds = (from: Picks): Set<string> => {
    const ids = new Set<string>();
    for (const s of SLOTS) {
      const p = from[s.id];
      if (p && !isPhoto(p.video)) ids.add(p.video.id);
    }
    return ids;
  };

  /** Hold the captions back until every one of those clips has reported its
   *  length (or failed), then write them. The sidebar says so meanwhile. */
  const queueWrite = (ids: Set<string>) => {
    if (!ids.size || writing || exporting) return;
    pendingWrite.current = { ids };
    setBusy(true);
  };

  /** The build the form has just made. Both recordings are on the stage
   *  already — the section put them there, with the persona's three clips and
   *  an End beside them — so what is left is everything that is written about
   *  them: the words, and the song and the look they are said in.
   *
   *  It runs on the build's number rather than on the picks, so tuning the
   *  video afterwards never sets a rewrite off. Only Generate does. */
  const buildId = build.id;
  useEffect(() => {
    pause();
    // The words were written about whatever was there before — they go with it.
    clearLines();
    setCaptionError(null);
    // So do the BOOMs: they were pressed in against a video that is gone.
    setBooms([]);
    setBoomArming(false);
    timeRef.current = 0;
    setTime(0);
    // A song and a look off the shelf for each new video, the way Simpler's
    // Reset rolls them — neither is anybody's decision until somebody makes it
    // one, and a video that never rolled would be the same song every time.
    // With the audio library still on its way this does nothing and the list
    // picks one when it lands (below).
    rollMusic();
    rollStyle();
    queueWrite(clipIds(picksRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildId]);

  /** Degen mode's BOOMs, laid on for you — see degenBooms in lib/vids2: the
   *  intro getting to them, their page coming up, the money going in (two
   *  without an intro). Each moment is a second into its own recording, so it
   *  is put on the timeline through that slot's item — where the slot starts,
   *  where it was trimmed from, and how fast it plays — rather than guessed at.
   *
   *  Once they are down they are ordinary BOOMs: the bar marks them, pressing
   *  a mark takes that one off, and Insert adds a fourth. Which is why this is
   *  held by the build's number rather than by whether there are any BOOMs —
   *  taking all three off must not bring them straight back.
   *
   *  It waits for two things that arrive a beat after the clips do: the
   *  bottoms the build has on the plan, and the list of sounds. A sound the
   *  folder hasn't got leaves its BOOM silent rather than not laid. */
  const degenLaidFor = useRef(0);
  useEffect(() => {
    if (build.mode !== 'degen' || degenLaidFor.current === buildId) return;
    if (!boomSounds.length) return;
    const item = (slot: SlotId) => plan.items.find((i) => i.slot === slot) ?? null;
    const a = item('bottomA');
    const b = item('bottomB');
    if (!b || (build.beats.introPick != null && !a)) return;
    /** A clip second in one of the two recordings, as a second of the finished
     *  video. Outside that slot's window it is nowhere, and lays nothing. */
    const onTimeline = (slot: SlotId, clipSecond: number): number | null => {
      const it = slot === 'bottomA' ? a : b;
      if (!it || !(it.speed > 0)) return null;
      const t = it.start + (clipSecond - it.trimStart) / it.speed;
      return t >= it.start && t < it.end ? t : null;
    };
    const laid: BoomInsert[] = degenBooms(build.beats).flatMap((d, i) => {
      const at = onTimeline(d.slot, d.at);
      if (at == null) return [];
      return [{
        id: `degen-${buildId}-${i}`,
        video: boomClip,
        at,
        sound: degenBoomSound(boomSounds, d.sound),
        // Some of them are the noise and nothing else — see degenBooms.
        picture: d.picture,
      }];
    });
    degenLaidFor.current = buildId;
    if (laid.length) setBooms((prev) => [...prev, ...laid]);
  }, [buildId, build.mode, build.beats, boomSounds, boomClip, plan]);

  // End is the one slot nobody chooses: every build finishes on him showing
  // what he made, and which of those it is hardly matters. So it fills itself
  // from the End folder the moment the library arrives, and again whenever a
  // bottom is made — this only ever fills a slot that has never been filled.
  const endFilled = useRef(false);
  useEffect(() => {
    if (!libraryLoaded || endFilled.current) return;
    if (picks.end) { endFilled.current = true; return; }
    const video = pickRandom(clipsForSlot('end'));
    if (!video) return;
    endFilled.current = true;
    onPicksChange((prev) => (prev.end ? prev : { ...prev, end: freshPick('end', video, prev.end) }));
  }, [libraryLoaded, picks.end, clipsForSlot, onPicksChange]);

  /** A song off the shelf, and not the one already on when there is another to
   *  be had — off the degen shelf too only in degen mode (rollableMusic). Each
   *  new build uses it; the list rolls its own the first time it arrives. */
  const rollMusic = () => {
    // Still on its way: the list rolls one when it lands.
    if (!tracks.length) return;
    const rollable = rollableMusic(tracks, build.mode === 'degen');
    const pool = rollable.filter((t) => t.url !== music.url);
    const t = pickRandom(pool.length ? pool : rollable);
    musicChosenRef.current = true;
    // With every song marked degen and this build not in degen mode there is
    // nothing it may roll, and no music beats a degen song left over from the
    // build before.
    setMusic((m) => ({ ...m, url: t?.url ?? null, label: t?.label ?? '' }));
  };

  /** A look for the captions off the shelf, and not the one already on when
   *  there is another to be had — the song's rule, for the song's reason: a
   *  look nobody chose is easier to swap than one nobody thought to try.
   *  Reset uses it; the page rolls one itself the first time it opens
   *  (below). */
  const rollStyle = () => {
    const pool = CAPTION_STYLES.filter((s) => s.id !== styleId);
    const s = pickRandom(pool.length ? pool : CAPTION_STYLES);
    if (!s) return;
    styleChosenRef.current = true;
    setStyleId(s.id);
  };
  useEffect(() => {
    if (!active || styleChosenRef.current) return;
    const s = pickRandom(CAPTION_STYLES);
    if (!s) return;
    styleChosenRef.current = true;
    setStyleId(s.id);
  }, [active]);


  // ── Render ──

  // The one line the sidebar has for how the build is getting on. Everything
  // that used to say a piece of this — the rack, the timeline, the Random
  // button — is gone, so it says the lot.
  const working = busy || writing;
  /** There is always a build by the time this page is up — the form is what
   *  stands where an empty stage would. The trade is the one recording every
   *  build has; the intro is there or not, as the form said. */
  const started = !!picks.bottomA || !!picks.bottomB;
  /** The still beside the summary: the trade, which is the one of the two
   *  recordings with a face in it. */
  const buildThumb = picks.bottomB?.video.thumbUrl ?? picks.bottomA?.video.thumbUrl ?? null;
  const status = (() => {
    if (working) return 'Putting it together — the sound and the captions.';
    if (broken.length) return 'One of these clips would not load — press Change, then Generate again.';
    if (!appliedPersonaId) return 'The persona\u2019s clips aren\u2019t on the stage — press Change and pick one that has all three.';
    return `Ready${total ? ` · ${fmtTime(total)}` : ''} — play it, then download it.`;
  })();

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {/* Hidden decode elements — one per filled slot; the canvas samples from them. */}
      {SLOTS.map((s) => {
        const p = picks[s.id];
        if (!p) return null;
        // A photo is held rather than played: no seeking, no sound, no metadata
        // to wait on — the canvas just samples the same picture every frame.
        if (isPhoto(p.video)) {
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${s.id}:${p.video.id}`}
              ref={layerRefs.image(s.id)}
              src={p.video.url}
              crossOrigin="anonymous"
              alt=""
              onLoad={() => draw(timeRef.current)}
              onError={() => setErrors((prev) => ({ ...prev, [p.video.id]: 'Could not load this photo.' }))}
              className="pointer-events-none absolute h-px w-px opacity-0"
              aria-hidden
            />
          );
        }
        return (
          <video
            key={`${s.id}:${p.video.id}`}
            ref={layerRefs.video(s.id)}
            src={p.video.url}
            crossOrigin="anonymous"
            playsInline
            preload="auto"
            muted={p.muted}
            onLoadedMetadata={handleMeta(p.video.id)}
            onLoadedData={handleFrame(s.id)}
            onSeeked={handleFrame(s.id)}
            onError={() => setErrors((prev) => ({ ...prev, [p.video.id]: 'Could not load this clip (unsupported codec or network error).' }))}
            className="pointer-events-none absolute h-px w-px opacity-0"
            aria-hidden
          />
        );
      })}

      {/* One hidden element per BOOM on the video — the same kind a slot has,
          sampled onto the frame over everything else. Keyed on the BOOM rather
          than the clip, since several of them are usually the same clip and
          each has to be seekable on its own. Not muted: the noise, where there
          is one, is most of what a BOOM is. */}
      {booms.map((b) => (b.picture === false ? null : (
        <video
          key={boomLayer(b.id)}
          ref={layerRefs.video(boomLayer(b.id))}
          src={b.video.url}
          crossOrigin="anonymous"
          playsInline
          preload="auto"
          onLoadedMetadata={handleMeta(b.video.id)}
          onLoadedData={handleFrame(boomLayer(b.id))}
          onSeeked={handleFrame(boomLayer(b.id))}
          onError={() => setErrors((prev) => ({ ...prev, [b.video.id]: 'Could not load the BOOM.' }))}
          className="pointer-events-none absolute h-px w-px opacity-0"
          aria-hidden
        />
      )))}

      {/* And a bang per BOOM that has one. Not muxed into the clip: the sound
          is chosen per BOOM and the picture is one fixed file, so they are laid
          side by side — see the BOOM section in lib/simpler/vidsAudio. Left at its own
          rate while the picture over it is sped up to BOOM_LENGTH, so an effect
          is heard the length it was made. */}
      {booms.map((b) => (b.sound ? (
        <audio
          key={`bang:${b.id}`}
          ref={(el) => {
            if (el) boomAudioEls.current.set(b.id, el);
            else boomAudioEls.current.delete(b.id);
          }}
          src={b.sound.url}
          preload="auto"
          onLoadedMetadata={() => syncElements(timeRef.current, playing, true)}
          onError={() => setErrors((prev) => ({
            ...prev,
            [b.sound!.url]: `Could not load the BOOM sound (${b.sound!.label}).`,
          }))}
          className="pointer-events-none absolute h-px w-px opacity-0"
          aria-hidden
        />
      ) : null))}

      {/* And one for the BOOM being placed, which is never in the plan: it is
          left where it loads — on its first frame — and simply drawn at the
          playhead, so what you see while choosing is what will land. Silent:
          nothing is being played yet, only shown. */}
      {boomArming && (
        <video
          key={BOOM_PREVIEW_LAYER}
          ref={layerRefs.video(BOOM_PREVIEW_LAYER)}
          src={boomClip.url}
          crossOrigin="anonymous"
          playsInline
          muted
          preload="auto"
          onLoadedMetadata={handleMeta(boomClip.id)}
          onLoadedData={handleFrame(BOOM_PREVIEW_LAYER)}
          className="pointer-events-none absolute h-px w-px opacity-0"
          aria-hidden
        />
      )}

      {/* Stage + transport */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={stageWrapRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          {/* Before anything has been chosen the stage would be showing the
              End clip — the payout — which is nobody's decision and says
              nothing about the vid. A black screen instead. */}
          {!started ? (
            k > 0 && (
              <div
                className="flex select-none items-center justify-center bg-black ring-1 ring-zinc-800"
                style={{ width: dispW, height: dispH }}
              >
                <p className="px-6 text-center text-2xl font-black uppercase tracking-tight text-zinc-100">
                  Let&rsquo;s f&rsquo;ing cook
                </p>
              </div>
            )
          ) : k > 0 && (
            /* A screen, not a workbench: nothing on it is picked, dragged,
               zoomed or nudged. The caption is the one thing that moves.
               Space is caught for the whole page rather than here, so it
               works without the stage having been clicked first; the stage
               still takes focus, for the caption drag. */
            <div
              ref={stageRef}
              data-vids-stage
              tabIndex={0}
              className="relative select-none touch-none bg-black outline-none ring-1 ring-zinc-800"
              style={{ width: dispW, height: dispH }}
              onPointerMove={onStagePointerMove}
              onPointerUp={onStagePointerUp}
              onPointerCancel={onStagePointerUp}
            >
              <canvas ref={canvasRef} data-vids-canvas className="block" style={{ width: dispW, height: dispH }} />

              {/* The caption on screen, as something you can take hold of. It
                  covers exactly the words the canvas painted, sits above every
                  clip, and shows its edges when you are on it — nothing here is
                  drawn into the video. */}
              {capHandle && (
                <div
                  onPointerDown={startCaptionDrag}
                  title="Drag to move this caption — it stays where you put it"
                  className="group absolute z-10 cursor-move rounded ring-1 ring-transparent hover:bg-white/5 hover:ring-white/50"
                  style={{
                    left: capHandle.box.x * k,
                    top: capHandle.box.y * k,
                    width: Math.max(28, capHandle.box.w * k),
                    height: Math.max(20, capHandle.box.h * k),
                  }}
                >
                  <span className="pointer-events-none absolute -top-4 left-0 hidden whitespace-nowrap rounded bg-black/80 px-1 text-[9px] text-white group-hover:block">
                    {capHandle.moved ? 'moved · drag again' : 'drag to move'}
                  </span>
                </div>
              )}

              {broken.length > 0 && (
                <div className="absolute left-2 top-2 rounded border border-red-800 bg-red-950/90 px-2 py-1 text-[11px] text-red-300">
                  {broken.map((i) => i.video.name).join(', ')}: could not load
                </div>
              )}
            </div>
          )}
        </div>

        {/* Transport */}
        <div className="flex items-center gap-3 border-t border-zinc-800 px-4 py-2.5">
          <button
            data-vids-play
            onClick={playing ? pause : play}
            disabled={!plan.items.length}
            className={`${BTN_TEXT} w-16 justify-center border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500`}
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <button
            onClick={restart}
            disabled={!plan.items.length}
            title="Play it again from the start"
            className={`${BTN_TEXT} justify-center border-zinc-700 bg-zinc-900 px-2 text-zinc-200 hover:border-zinc-500`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <rect x="5" y="5" width="2.5" height="14" rx="1" />
              <path d="M20 5v14L9.5 12z" />
            </svg>
          </button>
          <span data-vids-time className="w-10 text-right font-mono text-[11px] text-zinc-400">{fmtTime(time)}</span>
          {/* The bar, with the BOOM marked on it — the bar places one, shows
              where it went and takes it off again, so the whole of it is here
              on the thing it is measured against. The mark is inset by the
              thumb's radius, which is how far in from either end the playhead
              itself can actually reach.

              Armed, the press that scrubs also drops: the release is read
              rather than the move, so a drag along the bar picks the frame. */}
          <div
            className={`relative flex min-w-0 flex-1 items-center rounded ${
              // An outline rather than a ring: it is drawn clear of the bar
              // without painting a band of some assumed colour behind itself.
              boomArming ? 'outline-1 outline-offset-4 outline-amber-500/70' : ''
            }`}
          >
            <input
              data-vids-scrub
              type="range"
              min={0}
              max={total || 0}
              step={0.01}
              value={Math.min(time, total || 0)}
              disabled={!plan.items.length}
              onChange={(e) => scrub(Number(e.target.value))}
              onPointerUp={dropBoomAtPlayhead}
              title={boomArming ? 'Press the moment the BOOM should land on' : undefined}
              className="w-full"
              style={{ '--fill': `${total ? (Math.min(time, total) / total) * 100 : 0}%` } as CSSProperties}
            />
            {total > 0 && boomItems.map((item) => (
              // A mark is the BOOM, so pressing the mark is how that one comes
              // off — the thing itself rather than a control somewhere else
              // that refers to it. The button is what it is grabbed by: a bar's
              // width of it, so it can actually be hit, around a mark left thin
              // enough to read as a moment.
              <button
                key={item.slot}
                onClick={() => removeBoom(item.slot)}
                title={item.picture === false
                  ? `${item.sound?.label ?? 'Sound'} at ${fmtTime(item.start)}, no picture — press to take it off`
                  : `BOOM at ${fmtTime(item.start)} — press to take it off`}
                className="group absolute top-1/2 flex h-6 w-3.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                style={{ left: `calc(7px + (100% - 14px) * ${item.start / total})` }}
              >
                {/* A mark half the height for a mark that is only a noise:
                    it is on the bar to be taken off, but nothing of it is on
                    the picture, and a full one would say otherwise. */}
                <span
                  className={`w-[3px] rounded-full bg-amber-400 transition-all group-hover:w-[5px] group-hover:bg-white ${
                    item.picture === false
                      ? 'h-[9px] opacity-60 group-hover:h-[13px] group-hover:opacity-100'
                      : 'h-[18px] group-hover:h-[22px]'
                  }`}
                />
              </button>
            ))}
          </div>
          <span className="w-10 font-mono text-[11px] text-zinc-500">{fmtTime(total)}</span>

          {/* The BOOM: press it, then press the bar on the moment it should
              land, and the clip plays there over the top of everything —
              nothing underneath is moved or replaced. Press it again, or press
              the mark it left on the bar, and it comes off. */}
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={toggleBoom}
              // Nothing to lay it over until there is a build: the stage is
              // still showing the black screen, and End fills itself. The BOOM
              // itself is never what it waits on — the house ships one.
              disabled={!started || !plan.items.length}
              title={boomArming
                ? 'Now press the bar on the moment it should land — Esc to leave it'
                : 'Lay a BOOM over the whole video: press here, then press the bar.'
                  + ' As many as you like; press a mark on the bar to take that one off'}
              className={`${BTN_TEXT} justify-center px-2 ${
                boomArming
                  ? 'border-amber-500 bg-amber-950/60 text-amber-200 hover:border-amber-400'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500'
              }`}
            >
              Insert boom
            </button>
            {/* What the next BOOM will sound like. Beside the button rather
                than in the sidebar because it is part of laying one down: you
                choose the bang, then choose the moment. A BOOM already on the
                video keeps the sound it was laid with — this is about the next
                one. */}
            <select
              value={boomSound?.url ?? ''}
              onChange={(e) => setBoomSound(boomSounds.find((x) => x.url === e.target.value) ?? null)}
              disabled={!started || !plan.items.length}
              title={boomSounds.length
                ? 'The sound the next BOOM makes — drop more into public/audio/booms'
                : 'Nothing in public/audio/booms yet'}
              className={`${BTN_TEXT} max-w-[7.5rem] cursor-pointer appearance-none truncate border-zinc-700 bg-zinc-900 px-2 text-zinc-300 hover:border-zinc-500`}
            >
              <option value="">Silent</option>
              {boomSounds.map((snd) => (
                <option key={snd.url} value={snd.url}>{snd.label}</option>
              ))}
            </select>
            {/* Where it went and how to be rid of it are both the mark on the
                bar, so nothing stands here saying so a second time. */}
            {boomArming && (
              <span className="whitespace-nowrap text-[10px] text-amber-400/90">Press the bar</span>
            )}
          </div>
        </div>
      </div>

      {/* The one sidebar: the two clip choices, the sound, the captions, the
          post caption and the way out. */}
      <aside className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-l border-zinc-800">
        <div className="border-b border-zinc-800 px-3 py-3">
          <div className="mb-2 flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-zinc-200">Tune it up</p>
            <button
              onClick={onBackToForm}
              disabled={!!exporting}
              title="Back to the five answers, as you left them. Change one and press Generate again — both recordings are made afresh."
              className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white disabled:border-zinc-900 disabled:text-zinc-700 disabled:hover:border-zinc-900 disabled:hover:text-zinc-700"
            >
              Change
            </button>
          </div>

          {/* What the form asked for, and what came of it. Not a control: the
              two cards that were here were the deciding, and the deciding is
              on the other page now. The still is the trade's — it is the one
              of the two recordings with a face in it. */}
          <div className="flex items-center gap-2.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded bg-black">
              {buildThumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={buildThumb} alt="" className="h-full w-full object-cover" draggable={false} />
              ) : (
                <VideoIcon size={15} className="text-zinc-700" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] text-zinc-100" title={build.person}>
                {build.person}
                <span className={`ml-1.5 ${build.direction === 'up' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {build.direction === 'up' ? '↑ up' : '↓ down'}
                </span>
              </p>
              <p className="truncate text-[10px] text-zinc-500">
                {appliedPersona?.name ?? 'no persona'} · {build.theme}
              </p>
              {/* The intro: the question ChatGPT was asked, the story that
                  was opened, or that there wasn't one. */}
              {build.intro === 'chatgpt' ? (
                <p className="truncate text-[9px] text-zinc-600" title={build.question}>&ldquo;{build.question}&rdquo;</p>
              ) : build.intro === 'news' && build.story ? (
                <p className="truncate text-[9px] text-zinc-600" title={`${build.story.outlet}: ${build.story.headline}`}>
                  {build.story.outlet}: {build.story.headline}
                </p>
              ) : (
                <p className="truncate text-[9px] text-zinc-600">no intro — straight to the trade</p>
              )}
            </div>
          </div>
          {/* What the renderers wanted known — a name that wasn't on the
              page, a photo that couldn't be found. */}
          {build.notes.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-[9px] leading-snug text-amber-300/90">
              {build.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}

          {/* One line for how it is getting on. Stands down when there is
              nothing to say. */}
          {status && (
            <div className="mt-2 flex items-start gap-1.5 text-[10px] text-zinc-500">
              {working && <SpinnerIcon size={10} className="mt-px shrink-0 animate-spin" />}
              <p className="min-w-0 flex-1">{status}</p>
            </div>
          )}
        </div>

        {/* Sound: the song and how loud it and the clips sit. Room tone rides
            under every build (DEFAULT_ROOM_TONE) with nothing to switch it. */}
        <div className="border-b border-zinc-800 px-3 py-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Sound</p>
          {/* The song and how loud it is are one thing in two rows, so the
              word for them sits against the pair rather than against the top
              of it: the label column is centred on the block beside it, which
              with a song chosen puts "Music" between the list and its volume,
              and with none puts it against the list on its own. */}
          <div className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-[11px] text-zinc-300">Music</span>
            <div className="flex min-w-0 flex-1 flex-col">
              <MusicPicker
                tracks={tracks}
                music={music.url}
                level={music.level}
                onChoose={(t) => {
                  musicChosenRef.current = true;
                  setMusic((m) => ({ ...m, url: t?.url ?? null, label: t?.label ?? '' }));
                }}
              />
              {music.url && (
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="range"
                    min={MIN_MUSIC_LEVEL}
                    max={MAX_MUSIC_LEVEL}
                    step={LEVEL_STEP}
                    value={music.level}
                    onChange={(e) => setMusic((m) => ({ ...m, level: clampMusicLevel(snapLevel(Number(e.target.value))) }))}
                    className="h-1.5 flex-1"
                    style={{ '--fill': `${(music.level / MAX_MUSIC_LEVEL) * 100}%` } as CSSProperties}
                  />
                  <span className="w-12 text-right font-mono text-[10px] text-zinc-400">
                    {Math.round(music.level * 100)}%
                  </span>
                </div>
              )}
              {!tracks.length && (
                <p className="mt-1 text-[9px] text-zinc-600">
                  {tracksError ? `Couldn't list the audio library: ${tracksError}` : 'No tracks in the audio library yet.'}
                </p>
              )}
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="w-10 shrink-0 text-[11px] text-zinc-300">Clips</span>
            <input
              type="range"
              min={MIN_CLIP_LEVEL}
              max={MAX_CLIP_LEVEL}
              step={LEVEL_STEP}
              value={clipLevel}
              onChange={(e) => setClipLevel(clampClipLevel(snapLevel(Number(e.target.value))))}
              className="h-1.5 flex-1"
              style={{ '--fill': `${(clipLevel / MAX_CLIP_LEVEL) * 100}%` } as CSSProperties}
            />
            <span className="w-12 text-right font-mono text-[10px] text-zinc-400">
              {Math.round(clipLevel * 100)}%
            </span>
          </div>
          {/* The BOOMs get a level of their own rather than riding the clips’:
              they are punctuation over the top of the video, not part of what
              it is carrying, and they are meant to land above it. Shown only
              once there is one to be loud — the row is about what is on the
              video, and until a BOOM is laid it would be about nothing. */}
          {booms.some((b) => b.sound) && (
            <div className="mt-2 flex items-center gap-2">
              <span className="w-10 shrink-0 text-[11px] text-zinc-300">BOOM</span>
              <input
                type="range"
                min={MIN_BOOM_LEVEL}
                max={MAX_BOOM_LEVEL}
                step={LEVEL_STEP}
                value={boomLevel}
                onChange={(e) => setBoomLevel(clampBoomLevel(snapLevel(Number(e.target.value))))}
                className="h-1.5 flex-1"
                style={{ '--fill': `${(boomLevel / MAX_BOOM_LEVEL) * 100}%` } as CSSProperties}
              />
              <span className="w-12 text-right font-mono text-[10px] text-zinc-400">
                {Math.round(boomLevel * 100)}%
              </span>
            </div>
          )}
          {soundError && (
            <p className="mt-2 text-[9px] text-red-400">Sound didn&rsquo;t load: {soundError}</p>
          )}
        </div>

        <VidsCaptionsRail
          canCaption={canCaption}
          lines={lines}
          setLines={setLines}
          laid={caption}
          windows={windows}
          hasLines={hasLines}
          writing={writing}
          error={captionError}
          styleId={styleId}
          setStyleId={setStyleId}
          size={capScale}
          setSize={setCapScale}
          // The same call the bottom landing makes, on demand: a fresh set
          // from the same clips when the first one isn't it.
          onRewrite={() => void writeLines()}
          canRewrite={canCaption && !working && !exporting}
          onResetPos={(ref) => setLinePos(ref, undefined)}
          onStartTyped={() => { startTouched.current = true; }}
        />

        <VidsPostCaption
          brief={postBrief}
          // The code the export just minted, so the caption ends on it as the
          // file name does.
          code={lastRecipe?.code ?? null}
        />

        {/* mt-auto puts it at the foot of a short sidebar; sticky keeps it
            there once the captions run past the bottom of the screen. The
            background is the page's own, because the sidebar doesn't paint one
            and a transparent sticky footer would have the rest scroll through
            it. */}
        <div className="sticky bottom-0 mt-auto border-t border-zinc-800 bg-[var(--background)] px-3 py-3">
          {exporting ? (
            <div>
              <div className="flex items-center gap-2 text-[11px] text-zinc-300">
                <SpinnerIcon size={12} className="animate-spin" />
                <span className="flex-1 truncate">{exporting.label}</span>
                <span className="font-mono text-zinc-500">{Math.round(exporting.frac * 100)}%</span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full bg-white transition-[width]" style={{ width: `${exporting.frac * 100}%` }} />
              </div>
              <button onClick={() => abortRef.current?.abort()} className="mt-2 text-[10px] text-zinc-500 hover:text-red-400">
                Cancel
              </button>
            </div>
          ) : (
            <>
              <button
                data-vids-export="download"
                onClick={() => void runExport()}
                disabled={!plan.items.length || broken.length > 0}
                title="Render the MP4 and save it to this PC"
                className={`${BTN_TEXT} w-full justify-center border-zinc-600 bg-white text-black hover:bg-zinc-200`}
              >
                <DownloadIcon size={13} /> Download MP4
              </button>
              <p className="mt-1.5 text-[10px] text-zinc-600">
                {outW}×{outH} · H.264 + AAC · {OUT_FPS} fps{total ? ` · ${fmtTime(total)}` : ''}
              </p>
            </>
          )}
          {exportError && <p className="mt-2 text-[11px] text-red-400">{exportError}</p>}
          {recipeError && <p className="mt-2 text-[11px] text-amber-300">{recipeError}</p>}
        </div>
      </aside>
    </div>
  );
}
