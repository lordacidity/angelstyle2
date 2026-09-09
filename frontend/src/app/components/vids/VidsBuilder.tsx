'use client';

// VidsBuilder — the stacked-sequence preview + slot rack. Six slots (Start,
// Top A/B, Bottom A/B, End) each hold one clip from the library; buildPlan()
// turns the picks into a timeline, the canvas previews it live from hidden
// <video> elements, and Export renders the identical timeline to an MP4 via
// lib/vidsCompose (WebCodecs in the browser — no server). The file either
// downloads or goes straight to Phonedeck's Incoming list, as a Media export
// does, to be pushed to the phones from the Phonedeck panel.
//
// The rack is four cards, not six: Persona (which fills Start, Top A and Top B
// in one go) plus Bottom A, Bottom B and End. Clicking a card opens a picker
// showing exactly what that folder holds, so choosing footage never means
// crossing to the library pane. Either way every slot ends up an ordinary pick,
// so a persona's clips drag, zoom and trim on the stage like any other.
//
// Random, top right beside Reset, runs the whole errand in one go: a persona
// from the Persona folder, a Bottom A and a Bottom B that the Link page says
// go together (any two, while nothing has been linked yet), an End, a song, a
// look for the captions, and then the captions themselves — the same call the
// Write button makes, made once the clips it picked have loaded. Roll again as often as you like; only a stage that was
// built by hand is asked about first. The same links narrow Bottom B's picker
// to what follows the Bottom A on the stage.
//
// On the stage: click a section to select the clip playing there — a popup
// with its settings opens next to it — drag it to move, pull a corner to zoom
// (aspect locked), arrow keys nudge (Shift = 10px), Space plays/pauses. The
// timeline rows scrub on click/drag; right-click a segment to trim that clip.
// Bars (middle / top+bottom) shrink the sections and every clip re-fits to
// them; drag/zoom tweaks are relative, so they survive.
//
// Two ways to work, switched top right of the page:
//   Advanced  everything above — the rack, three rails, a stage you can drag.
//             The third rail, far right, is where a build leaves: the post
//             caption for Instagram — the person being traded, the position
//             and the case for it, read off the screen recordings' context
//             (VidsExportRail) — the Phonedeck list, and the export buttons.
//   Simple    two choices and nothing else: a persona, and a vid (the Bottom
//             A). Bottom B comes off the Link page, End fills itself, and the
//             song, the room tone, the bars and the captions are all what they
//             would have been in Advanced anyway — you just don't see them.
//             Play it, then download it or push it to Phonedeck. Nothing there
//             can be edited, and nothing needs to be: switching to Advanced
//             opens that same build with every control on it, so a vid that
//             wants a nudge is one click from getting one.
//
// Every export is written down under a short code (lib/vidsRecipe → the
// recipes API): a three-word title from the model, plus the persona, every
// slot's clip and settings, bars, sound, output size and captions. The code
// goes after the title in the file name, and typing it into the box at the top
// left of the stage puts that build straight back.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, KeyboardEvent, PointerEvent, ReactNode, SyntheticEvent } from 'react';
import type { VidLink, VidPersona, VidRecipe, VidRow } from '@/lib/vids-types';
import { PERSONA_PARTS, isPhoto, parseRecipeCode } from '@/lib/vids-types';
import {
  DEFAULT_BARS, DEFAULT_SPEED, DEFAULT_TRANSFORM, DEFAULT_TRIM, FOLDER_SLOTS, MAX_SPEED, MIN_SPEED,
  MIN_TRIM_LENGTH, PERSONA_DRAG_MIME, PERSONA_PART_SLOT, PERSONA_SLOTS, PHOTO_LENGTH, SLOTS, SLOT_META,
  SPEED_PRESETS,
  VID_DRAG_MIME, buildPlan, centredOffset, clampSpeed, drawInRegion, fittedRect, freshPick, isDefaultSpeed,
  isDefaultTransform, isTrimmed, placedRect, regionRect, smoothScaling, timelineLength, trimmedRange,
  type Align, type BarsLayout, type Fit, type Picks, type Plan, type PlanItem, type Rect,
  type Region, type SlotId, type SlotMeta, type SlotPick, type Transform, type Trim,
} from '@/lib/vidsPlan';
import { VidsClipPicker, VidsPersonaPicker } from './VidsPicker';
import { composeSequence } from '@/lib/vidsCompose';
import {
  CAPTION_STYLES, DEFAULT_CAPTION_STYLE, EMPTY_LINES, ONE_LINE_DEFAULT, buildCaptions, capLine, captionAt,
  captionStyle, captionWindows, drawCaption, layoutCaption, preloadCaptionEmoji, seamNeedsMerge, wantedCount,
  type CaptionLines, type CaptionPos, type CaptionRef, type CaptionWindow,
} from '@/lib/vidsCaptions';
import { VidsCaptionsRail } from './VidsCaptionsRail';
import { emojiByUnified } from '@/lib/emoji';
import { pinnedUnifieds, useEmojiPrefs } from '@/lib/emoji-prefs-store';
import { VidsRecall } from './VidsRecall';
import { VidsPhonedeck } from './VidsPhonedeck';
import { VidsExportRail } from './VidsExportRail';
import { createRecipe, deleteRecipe, getRecipe, writeCaptions } from '@/lib/vids-client';
import { picksFromSpec, specFromBuild } from '@/lib/vidsRecipe';
import {
  DEFAULT_CLIP_LEVEL, DEFAULT_MUSIC, DEFAULT_ROOM_TONE, MAX_CLIP_LEVEL, MAX_MUSIC_LEVEL,
  MAX_ROOM_LEVEL, MIN_CLIP_LEVEL, MIN_MUSIC_LEVEL, MIN_ROOM_LEVEL, ROOM_TONE_URL, clampClipLevel,
  clampMusicLevel, clampRoomLevel, decodeAudio, listMusic, musicGain, roomToneGain,
  type Music, type MusicTrack, type RoomTone,
} from '@/lib/vidsAudio';
import { PHONEDECK_URL, safeExportName } from '@/lib/canvasVideoExport';
import { fmtTime } from '@/lib/utils';
import { BTN_TEXT } from '@/lib/ui-constants';
import { CloseIcon, DownloadIcon, SpinnerIcon, UploadIcon, VideoIcon } from '@/lib/icons';

const OUTPUT_PRESETS = [
  { id: '9:16', label: '9:16 · 1080 × 1920', w: 1080, h: 1920 },
  { id: '1:1',  label: '1:1 · 1080 × 1080',  w: 1080, h: 1080 },
  { id: '4:5',  label: '4:5 · 1080 × 1350',  w: 1080, h: 1350 },
  { id: '16:9', label: '16:9 · 1920 × 1080', w: 1920, h: 1080 },
] as const;
type PresetId = (typeof OUTPUT_PRESETS)[number]['id'];

const STAGE_PAD = 32;  // px of breathing room around the stage
const MIN_RECT = 24;   // output px — a clip can't be zoomed smaller than this
/** Slack around a caption's own box, so a short line is still easy to grab. */
const CAPTION_GRAB = 14;
/** How close to the edge a caption may be dragged, as a share of the frame. */
const CAPTION_EDGE = 0.02;
/** How long Random waits for a clip that has said neither "loaded" nor
 *  "failed" before writing the captions from the library's own figures. */
const ROLL_WAIT_MS = 8000;

const pickRandom = <T,>(xs: readonly T[]): T | undefined =>
  (xs.length ? xs[Math.floor(Math.random() * xs.length)] : undefined);

type Corner = 'nw' | 'ne' | 'sw' | 'se';
const CORNERS: readonly Corner[] = ['nw', 'ne', 'sw', 'se'];
const CURSOR: Record<Corner, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' };

// Timeline swatch per slot (bottom-row clips warm, top-row cool).
const SLOT_COLOR: Record<SlotId, string> = {
  start: 'bg-sky-300',
  topA: 'bg-emerald-300',
  topB: 'bg-emerald-500',
  bottomA: 'bg-amber-300',
  bottomB: 'bg-amber-500',
  end: 'bg-rose-400',
};
const ALIGNS: readonly Align[] = ['start', 'center', 'end'];
const ALIGN_LABEL: Record<Align, string> = { start: 'Start', center: 'Mid', end: 'End' };
const FITS: readonly Fit[] = ['height', 'width'];
const FIT_LABEL: Record<Fit, string> = { height: 'Height', width: 'Width' };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const inRect = (p: { x: number; y: number }, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 });
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

/** Drop a finished file in Phonedeck's Incoming list — from the browser
 *  straight to the local server, the way a Media export goes (a Next route
 *  would run on Vercel and never reach this PC). Resolves to the name the file
 *  was stored under, which can differ from the one sent: Phonedeck adds " (1)"
 *  when a name is already taken. */
async function sendToPhonedeck(blob: Blob, name: string): Promise<string> {
  const form = new FormData();
  form.append('files', blob, name);
  const resp = await fetch(`${PHONEDECK_URL}/api/upload`, { method: 'POST', body: form });
  if (!resp.ok) throw new Error(await resp.text().catch(() => `Phonedeck answered ${resp.status}`));
  const result = await resp.json().catch(() => null) as { files?: Array<{ name: string }> } | null;
  return result?.files?.[0]?.name ?? name;
}

// ── Small bits ────────────────────────────────────────────────────────────────

function Section({ title, children, collapsible = false, defaultOpen = true, summary }: {
  title: string;
  children: ReactNode;
  collapsible?: boolean;
  /** Only consulted when collapsible — a section that can't fold is always open. */
  defaultOpen?: boolean;
  /** What the section says about itself while it is folded away, so closing it
   *  doesn't hide the fact that something in it is switched on. */
  summary?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const shown = !collapsible || open;
  return (
    <div className="border-b border-zinc-800 px-3 py-3">
      {collapsible ? (
        <button
          onClick={() => setOpen((o) => !o)}
          title={shown ? `Fold ${title} away` : `Open ${title}`}
          className={`flex w-full items-center gap-1.5 text-left text-zinc-500 transition-colors hover:text-zinc-300 ${shown ? 'mb-2' : ''}`}
        >
          <span className={`text-[7px] leading-none transition-transform ${shown ? 'rotate-90' : ''}`}>▶</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider">{title}</span>
          {!shown && summary != null && (
            <span className="ml-auto truncate text-[9px] normal-case tracking-normal text-zinc-600">{summary}</span>
          )}
        </button>
      ) : (
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{title}</p>
      )}
      {shown && children}
    </div>
  );
}

function Chip({ on, disabled, onClick, title, children }: { on?: boolean; disabled?: boolean; onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={disabled}
      title={title}
      className={`rounded border px-1.5 py-0.5 text-[9px] transition-colors disabled:opacity-30 ${
        on ? 'border-zinc-300 bg-zinc-200 text-black' : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

function Segmented<T extends string>({ value, options, labels, title, onChange }: {
  value: T; options: readonly T[]; labels: Record<T, string>; title?: string; onChange: (v: T) => void;
}) {
  return (
    <span className="flex overflow-hidden rounded border border-zinc-700" title={title}>
      {options.map((o) => (
        <button
          key={o}
          onClick={(e) => { e.stopPropagation(); onChange(o); }}
          className={`px-1.5 py-0.5 text-[9px] ${value === o ? 'bg-zinc-200 text-black' : 'text-zinc-400 hover:text-white'}`}
        >
          {labels[o]}
        </button>
      ))}
    </span>
  );
}

function BarControl({ label, hint, on, size, max, onToggle, onSize }: {
  label: string; hint: string; on: boolean; size: number; max: number;
  onToggle: (on: boolean) => void; onSize: (px: number) => void;
}) {
  const shown = Math.min(size, max);
  return (
    <div className="mb-2">
      <label className="flex cursor-pointer items-center gap-2 text-[11px] text-zinc-300">
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} />
        <span>{label}</span>
        <span className="truncate text-[9px] text-zinc-600">{hint}</span>
      </label>
      {on && (
        <div className="mt-1 flex items-center gap-2 pl-5">
          <input
            type="range"
            min={2}
            max={max}
            step={2}
            value={shown}
            onChange={(e) => onSize(Number(e.target.value))}
            className="h-1.5 flex-1"
            style={{ '--fill': `${(shown / max) * 100}%` } as CSSProperties}
          />
          <span className="w-12 text-right font-mono text-[10px] text-zinc-400">{shown} px</span>
        </div>
      )}
    </div>
  );
}

// ── Clip settings (the popup on the stage) ────────────────────────────────────

type PickPatch = Partial<Omit<SlotPick, 'video'>>;

function ClipSettings({ pick, onChange, onTrim, onCentre }: {
  pick: SlotPick;
  onChange: (patch: PickPatch) => void;
  onTrim?: () => void;
  /** Drop the clip dead centre in its section on one axis. */
  onCentre?: (axis: 'x' | 'y') => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        <Segmented
          value={pick.fit}
          options={FITS}
          labels={FIT_LABEL}
          title="Height: the clip's top and bottom land exactly on the section edges / bars (sides crop or go black). Width: it spans side to side (top/bottom crop or go black)."
          onChange={(fit) => onChange({ fit })}
        />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <Segmented
          value={pick.align}
          options={ALIGNS}
          labels={ALIGN_LABEL}
          title="Which side stays visible when the clip is cropped / where it sits when there's black"
          onChange={(align) => onChange({ align })}
        />
        {onCentre && (
          <>
            <Chip onClick={() => onCentre('x')} title="Centre it left-to-right in this section">Center</Chip>
            <Chip onClick={() => onCentre('y')} title="Centre it top-to-bottom in this section">Middle</Chip>
          </>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {onTrim && (
          <Chip
            on={isTrimmed(pick.trim) || !isDefaultSpeed(pick.speed)}
            onClick={onTrim}
            title="Set in / out points and playback speed"
          >
            Trim &amp; speed…
          </Chip>
        )}
        <span className="ml-auto flex items-center gap-1">
          <Chip
            disabled={isDefaultTransform(pick.transform)}
            onClick={() => onChange({ transform: { ...DEFAULT_TRANSFORM } })}
            title="Undo the drag / zoom and go back to the auto-fit"
          >
            Reset position
          </Chip>
        </span>
      </div>
    </>
  );
}

// ── Slot card ─────────────────────────────────────────────────────────────────

interface SlotCardProps {
  meta: SlotMeta;
  pick: SlotPick | undefined;
  duration: number | null;
  error: string | null;
  selected: boolean;
  /** Open this slot's picker — the card's own click does it too. */
  onChoose: () => void;
  onClear: () => void;
  onDropVideoId: (id: string) => void;
  /** Something off about the pick that isn't a load failure — a Bottom B that
   *  the Link page doesn't pair with the Bottom A on the stage. */
  warn?: string | null;
}

function SlotCard({ meta, pick, duration, error, selected, onChoose, onClear, onDropVideoId, warn }: SlotCardProps) {
  const [over, setOver] = useState(false);
  const accepts = (e: DragEvent) => Array.from(e.dataTransfer.types).includes(VID_DRAG_MIME);

  return (
    <div
      data-vids-slot={meta.id}
      title={`Click to choose a clip from the ${meta.folder} folder`}
      onClick={onChoose}
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData(VID_DRAG_MIME);
        if (!id) return;
        e.preventDefault();
        onDropVideoId(id);
      }}
      className={`mb-2 cursor-pointer rounded-md border p-2 transition-colors ${
        over ? 'border-emerald-500 bg-emerald-950/30'
          : selected ? 'border-white/70 bg-zinc-900'
          : 'border-zinc-800 hover:border-zinc-600'
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-sm ${SLOT_COLOR[meta.id]}`} />
        <p className="text-[11px] font-semibold text-zinc-200">{meta.label}</p>
        <p className="min-w-0 flex-1 truncate text-[9px] text-zinc-600">{meta.hint}</p>
      </div>

      {pick ? (
        <>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-9 w-9 shrink-0 overflow-hidden rounded bg-black">
              {pick.video.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={pick.video.thumbUrl} alt="" className="h-full w-full object-cover" draggable={false} />
              ) : (
                <span className="flex h-full items-center justify-center text-zinc-700"><VideoIcon size={14} /></span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] text-zinc-200" title={pick.video.name}>{pick.video.name}</p>
              <p className="truncate text-[10px] text-zinc-500">
                {error ? 'failed to load' : duration != null ? fmtTime(duration) : 'loading…'}
                {!isDefaultTransform(pick.transform) ? ` · ${Math.round(pick.transform.zoom * 100)}% · moved` : ''}
                {isTrimmed(pick.trim) ? ' · trimmed' : ''}
                {!isDefaultSpeed(pick.speed) ? ` · ${pick.speed}×` : ''}
              </p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              title="Clear this slot"
              className="text-zinc-500 hover:text-red-400"
            >
              <CloseIcon size={13} />
            </button>
          </div>
          {error && <p className="mt-1 text-[10px] text-red-400">{error}</p>}
          {!error && warn && <p className="mt-1 text-[10px] text-amber-400">{warn}</p>}
        </>
      ) : (
        <p className="mt-1.5 rounded border border-dashed border-zinc-800 px-2 py-2 text-center text-[10px] text-zinc-400">
          Click to choose from “{meta.folder}” — or drop a clip here.
        </p>
      )}
    </div>
  );
}

// ── Simple mode's two cards ───────────────────────────────────────────────────

/** One of the two choices Simple offers. A picture, what is in it, and a click
 *  to change it — no clear, no drop target, no settings. Everything you might
 *  otherwise want to do to it lives in Advanced. */
function SimpleCard({ label, hint, name, thumbUrl, missing, disabled, onChoose }: {
  label: string;
  hint: string;
  /** What is in the slot, or null while nothing is. */
  name: string | null;
  thumbUrl: string | null;
  /** What the card says instead of a name while it is empty. */
  missing: string;
  disabled?: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      onClick={onChoose}
      disabled={disabled}
      title={`Click to choose ${label.toLowerCase()}`}
      className={`mb-2 flex w-full items-center gap-2.5 rounded-md border p-2.5 text-left transition-colors ${
        name ? 'border-zinc-800' : 'border-dashed border-zinc-700'
      } hover:border-zinc-500 disabled:cursor-default disabled:border-zinc-900 disabled:opacity-50`}
    >
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-black">
        {thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbUrl} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <span className="flex h-full items-center justify-center text-zinc-700"><VideoIcon size={16} /></span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
        <p className={`truncate text-[12px] ${name ? 'text-zinc-100' : 'text-zinc-400'}`} title={name ?? undefined}>
          {name ?? missing}
        </p>
        <p className="truncate text-[9px] text-zinc-600">{hint}</p>
      </div>
      <span className="shrink-0 text-[10px] text-zinc-500">{name ? 'Change' : 'Choose'}</span>
    </button>
  );
}

// ── Persona rack (Start + Top A + Top B, chosen as one) ─────────────────────

interface PersonaRackProps {
  personas: VidPersona[];
  appliedPersonaId: string | null;
  picks: Picks;
  durations: Record<string, number>;
  errors: Record<string, string>;
  selectedSlot: SlotId | null;
  /** Open the persona picker. */
  onChoose: () => void;
  onUse: (p: VidPersona) => void;
  onClear: () => void;
  onSelectSlot: (slot: SlotId) => void;
  onClearSlot: (slot: SlotId) => void;
  /** Dragging a single clip onto one row still overrides just that part. */
  onDropVideoId: (slot: SlotId, id: string) => void;
}

function PersonaRack({
  personas, appliedPersonaId, picks, durations, errors, selectedSlot,
  onChoose, onUse, onClear, onSelectSlot, onClearSlot, onDropVideoId,
}: PersonaRackProps) {
  const [over, setOver] = useState(false);
  const applied = personas.find((p) => p.id === appliedPersonaId) ?? null;
  const anyFilled = PERSONA_SLOTS.some((id) => picks[id]);

  const acceptPersona = (e: DragEvent) => Array.from(e.dataTransfer.types).includes(PERSONA_DRAG_MIME);
  const acceptVid = (e: DragEvent) => Array.from(e.dataTransfer.types).includes(VID_DRAG_MIME);

  return (
    <div
      data-vids-persona-rack
      title="Click to choose a persona"
      onClick={onChoose}
      onDragOver={(e) => {
        if (!acceptPersona(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData(PERSONA_DRAG_MIME);
        const p = personas.find((x) => x.id === id);
        if (!p) return;
        e.preventDefault();
        onUse(p);
      }}
      className={`cursor-pointer rounded-md border p-2 transition-colors ${
        over ? 'border-emerald-500 bg-emerald-950/30' : 'border-zinc-800 hover:border-zinc-600'
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span className="h-2 w-2 shrink-0 rounded-sm bg-sky-300" />
        <p className="text-[11px] font-semibold text-zinc-200">Persona</p>
        <p className="min-w-0 flex-1 truncate text-[9px] text-zinc-600">
          {applied ? applied.name : 'fills Start, Top A and Top B'}
        </p>
        {anyFilled && (
          <button
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            title="Clear Start, Top A and Top B"
            className="text-zinc-500 hover:text-red-400"
          >
            <CloseIcon size={13} />
          </button>
        )}
      </div>

      {anyFilled ? (
        <div className="mt-1.5 space-y-1">
          {PERSONA_SLOTS.map((id) => {
            const pick = picks[id];
            const meta = SLOT_META[id];
            const err = pick ? errors[pick.video.id] : null;
            const len = pick ? timelineLength(pick.trim, durations[pick.video.id] ?? pick.video.duration, pick.speed) : null;
            return (
              <div
                key={id}
                onClick={(e) => { e.stopPropagation(); onSelectSlot(id); }}
                onDragOver={(e) => {
                  if (!acceptVid(e)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = 'copy';
                }}
                onDrop={(e) => {
                  const vid = e.dataTransfer.getData(VID_DRAG_MIME);
                  if (!vid) return;
                  e.preventDefault();
                  e.stopPropagation();
                  onDropVideoId(id, vid);
                }}
                title={pick ? `${meta.label} — ${pick.video.name}` : `${meta.label} — this persona has no clip for it`}
                className={`group flex cursor-pointer items-center gap-1.5 rounded border px-1.5 py-1 ${
                  selectedSlot === id ? 'border-white/70 bg-zinc-900' : 'border-transparent hover:bg-zinc-900'
                }`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-sm ${SLOT_COLOR[id]}`} />
                <span className="w-10 shrink-0 text-[10px] text-zinc-400">{meta.label}</span>
                <span className={`min-w-0 flex-1 truncate text-[10px] ${pick ? 'text-zinc-300' : 'text-zinc-600'}`}>
                  {pick ? pick.video.name : 'missing'}
                </span>
                <span className="shrink-0 font-mono text-[9px] text-zinc-600">
                  {err ? 'failed' : len != null ? fmtTime(len) : pick ? '…' : ''}
                </span>
                {pick && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onClearSlot(id); }}
                    title={`Clear ${meta.label}`}
                    className="hidden shrink-0 text-zinc-500 hover:text-red-400 group-hover:block"
                  >
                    <CloseIcon size={11} />
                  </button>
                )}
              </div>
            );
          })}
          <div className="flex items-center gap-1 pt-0.5">
            <p className="min-w-0 flex-1 truncate text-[9px] text-zinc-600">click a row to adjust it on the preview</p>
            <Chip onClick={onChoose} title="Pick a different persona">Change</Chip>
          </div>
        </div>
      ) : (
        <p className="mt-1.5 rounded border border-dashed border-zinc-800 px-2 py-2 text-center text-[10px] text-zinc-400">
          Click to choose a persona — or drag one over from the Persona folder.
        </p>
      )}
    </div>
  );
}

// ── Trim popup (right-click a timeline segment) ────────────────────────────────

function TrimPopup({ slot, pick, full, x, y, onChange, onSpeed, onPreview, onClose }: {
  slot: SlotId;
  pick: SlotPick;
  full: number | null;
  x: number;
  y: number;
  onChange: (trim: Trim) => void;
  onSpeed: (speed: number) => void;
  /** Scrub the preview to the in / out point of the given trim. */
  onPreview: (kind: 'in' | 'out', trim: Trim) => void;
  onClose: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'in' | 'out' | null>(null);
  const total = full ?? 0;
  const { start, end } = trimmedRange(pick.trim, total);
  const W = 320;

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const apply = (next: { start?: number; end?: number }, kind: 'in' | 'out') => {
    if (!total) return;
    let s = next.start ?? start;
    let e = next.end ?? end;
    if (kind === 'in') { s = clamp(s, 0, total - MIN_TRIM_LENGTH); e = clamp(e, s + MIN_TRIM_LENGTH, total); }
    else { e = clamp(e, MIN_TRIM_LENGTH, total); s = clamp(s, 0, e - MIN_TRIM_LENGTH); }
    const trim: Trim = {
      start: Math.round(s * 100) / 100,
      end: e >= total - 0.005 ? null : Math.round(e * 100) / 100,
    };
    onChange(trim);
    onPreview(kind, trim);
  };

  const timeAt = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || !total) return 0;
    return clamp((clientX - r.left) / r.width, 0, 1) * total;
  };
  const onTrackDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !total) return;
    e.preventDefault();
    const t = timeAt(e.clientX);
    const grabbed = (e.target as HTMLElement).dataset?.trim as 'in' | 'out' | undefined;
    const handle = grabbed ?? (Math.abs(t - start) <= Math.abs(t - end) ? 'in' : 'out');
    dragging.current = handle;
    e.currentTarget.setPointerCapture(e.pointerId);
    apply(handle === 'in' ? { start: t } : { end: t }, handle);
  };
  const onTrackMove = (e: PointerEvent<HTMLDivElement>) => {
    const h = dragging.current;
    if (!h) return;
    const t = timeAt(e.clientX);
    apply(h === 'in' ? { start: t } : { end: t }, h);
  };
  const onTrackUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };

  const left = clamp(x, 8, Math.max(8, window.innerWidth - W - 8));
  const top = clamp(y, 8, Math.max(8, window.innerHeight - 200));
  const pct = (v: number) => (total ? (v / total) * 100 : 0);
  const inputCls = 'w-16 rounded border border-zinc-700 bg-black px-1 py-0.5 font-mono text-[10px] text-zinc-200 outline-none focus:border-zinc-500';

  return (
    <>
      <div className="fixed inset-0 z-40" onPointerDown={onClose} />
      <div
        className="fixed z-50 rounded-md border border-zinc-700 bg-zinc-950/95 p-3 shadow-2xl backdrop-blur"
        style={{ left, top, width: W }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-sm ${SLOT_COLOR[slot]}`} />
          <span className="text-[11px] font-semibold text-zinc-200">Trim &amp; speed · {SLOT_META[slot].label}</span>
          <span className="min-w-0 flex-1 truncate text-[10px] text-zinc-500" title={pick.video.name}>{pick.video.name}</span>
          <button onClick={onClose} title="Close" className="text-zinc-500 hover:text-white"><CloseIcon size={12} /></button>
        </div>

        {total ? (
          <>
            <div
              ref={trackRef}
              className="relative mt-2 h-8 cursor-col-resize touch-none select-none overflow-hidden rounded bg-zinc-900"
              title="Drag the handles — or click near one — to set the in / out points"
              onPointerDown={onTrackDown}
              onPointerMove={onTrackMove}
              onPointerUp={onTrackUp}
              onPointerCancel={onTrackUp}
            >
              <div className="absolute inset-y-0 bg-zinc-700/70" style={{ left: `${pct(start)}%`, width: `${pct(end - start)}%` }} />
              <div data-trim="in" className="absolute inset-y-0 w-2 -translate-x-1/2 cursor-ew-resize rounded-sm bg-white" style={{ left: `${pct(start)}%` }} />
              <div data-trim="out" className="absolute inset-y-0 w-2 -translate-x-1/2 cursor-ew-resize rounded-sm bg-white" style={{ left: `${pct(end)}%` }} />
            </div>
            <div className="mt-2 flex items-end gap-3 text-[10px] text-zinc-400">
              <label className="flex flex-col gap-0.5">
                In
                <input type="number" min={0} max={total} step={0.05} value={Number(start.toFixed(2))} className={inputCls}
                  onChange={(e) => apply({ start: Number(e.target.value) }, 'in')} />
              </label>
              <label className="flex flex-col gap-0.5">
                Out
                <input type="number" min={0} max={total} step={0.05} value={Number(end.toFixed(2))} className={inputCls}
                  onChange={(e) => apply({ end: Number(e.target.value) }, 'out')} />
              </label>
              <div className="ml-auto text-right">
                <div>keeps <span className="font-mono text-zinc-200">{(end - start).toFixed(2)}s</span></div>
                <div className="text-zinc-600">of {total.toFixed(2)}s</div>
              </div>
            </div>

            {/* Speed — shortens the slot's window rather than the kept range */}
            <div className="mt-2 border-t border-zinc-800 pt-2">
              <div className="flex items-center gap-2 text-[10px] text-zinc-400">
                <span>Speed</span>
                <input
                  type="range"
                  min={MIN_SPEED}
                  max={MAX_SPEED}
                  step={0.05}
                  value={pick.speed}
                  onChange={(e) => onSpeed(Number(e.target.value))}
                  className="h-1.5 flex-1"
                  style={{ '--fill': `${((pick.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED)) * 100}%` } as CSSProperties}
                />
                <span className="w-10 text-right font-mono text-zinc-200">{pick.speed.toFixed(2)}×</span>
              </div>
              <div className="mt-1.5 flex items-center gap-1">
                {SPEED_PRESETS.map((v) => (
                  <Chip key={v} on={Math.abs(pick.speed - v) < 1e-6} onClick={() => onSpeed(v)}>{v}×</Chip>
                ))}
                <span className="ml-auto text-[10px] text-zinc-500">
                  plays in <span className="font-mono text-zinc-200">{((end - start) / pick.speed).toFixed(2)}s</span>
                </span>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-1">
              <Chip onClick={() => onPreview('in', pick.trim)} title="Scrub the preview to the in point">Show in</Chip>
              <Chip onClick={() => onPreview('out', pick.trim)} title="Scrub the preview to the out point">Show out</Chip>
              <span className="ml-auto flex items-center gap-1">
                <Chip
                  disabled={!isTrimmed(pick.trim) && isDefaultSpeed(pick.speed)}
                  onClick={() => { onChange(DEFAULT_TRIM); onSpeed(DEFAULT_SPEED); onPreview('in', DEFAULT_TRIM); }}
                >
                  Reset
                </Chip>
                <Chip on onClick={onClose}>Done</Chip>
              </span>
            </div>
          </>
        ) : (
          <p className="mt-2 text-[10px] text-zinc-500">Still reading the clip’s length…</p>
        )}
      </div>
    </>
  );
}

/** One continuous layer under the stage — room tone, or the song. Each is its
 *  own looping source rather than anything to do with the clips: both run the
 *  length of the timeline, so seeking around inside one shouldn't restart it.
 *  Both are the layers lib/vidsCompose lays into the file, so what you hear
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
  /** Seconds into the sample to open at. Left out, it opens at a random point —
   *  what a bed wants; a song passes 0 and starts where it starts. */
  from?: number,
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
      src.start(now, from ?? Math.random() * buf.buffer.duration);
      nodeRef.current = { src, gain: g, ctx };
    })();
    return () => { alive = false; stop(); };
  }, [playing, url, from, arm, openCtx, stop]);

  return { arm, error };
}

// ── Builder ───────────────────────────────────────────────────────────────────

interface DragState {
  slot: SlotId;
  mode: 'move' | 'resize';
  corner: Corner | null;
  startX: number;
  startY: number;
  start: Transform;
  base: Rect;   // auto-fit rect the transform is relative to
  rect: Rect;   // placed rect when the drag began
}

interface Props {
  picks: Picks;
  onPicksChange: (updater: (prev: Picks) => Picks) => void;
  onAssign: (slot: SlotId, video: VidRow) => void;
  selectedSlot: SlotId | null;
  onSelectSlot: (slot: SlotId | null) => void;
  /** Look a library clip up by id (for drops onto a slot). */
  resolveVideo: (id: string) => VidRow | undefined;
  /** The clips filed under a slot's folder — what its picker offers. */
  clipsForSlot: (slot: SlotId) => VidRow[];
  personas: VidPersona[];
  /** Which Bottom Bs follow on from which Bottom A — the Link page's pairs. */
  links: VidLink[];
  /** The persona filling Start / Top A / Top B, if the three still match one. */
  appliedPersonaId: string | null;
  onUsePersona: (p: VidPersona) => void;
  onClearPersona: () => void;
  active: boolean;
  /** The library has arrived. Until it has, a code has nothing to resolve
   *  its clips against, and would come back with every slot empty. */
  libraryLoaded: boolean;
  /** Simple mode: a persona, a vid, and the finished video. The rails, the
   *  rack, the code box, Random and every handle on the stage are Advanced's
   *  — what they set is still set, it just isn't shown or asked about. */
  simple: boolean;
}

export function VidsBuilder({
  picks, onPicksChange, onAssign, selectedSlot, onSelectSlot, resolveVideo, clipsForSlot,
  personas, links, appliedPersonaId, onUsePersona, onClearPersona, active, libraryLoaded,
  simple,
}: Props) {
  const [presetId, setPresetId] = useState<PresetId>('9:16');
  const preset = OUTPUT_PRESETS.find((p) => p.id === presetId) ?? OUTPUT_PRESETS[0];
  const outW = preset.w;
  const outH = preset.h;

  const [bars, setBars] = useState<BarsLayout>(DEFAULT_BARS);
  // Room tone rides under every build unless it is turned off here; clipLevel is
  // how loud what the clips carry sits against it. Music is nothing until a
  // track is chosen, and then it is a third layer beside the other two.
  const [roomTone, setRoomTone] = useState<RoomTone>(DEFAULT_ROOM_TONE);
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
  // Likewise the captions' look: rolled once when the pane first opens, then
  // only by Random, Reset, or a code bringing its own back.
  const styleChosenRef = useRef(false);
  // Browser-measured clip lengths + load failures, keyed by video id so a
  // re-picked slot never carries a stale value.
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  // The frame being swept on the timeline, if the pointer is over it: sweeping
  // shows that frame on the stage without a click, and letting go of the
  // timeline drops the picture back to the playhead.
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  // The frame the paused stage is currently showing — the playhead, or wherever
  // the pointer is hovering the timeline. Kept so a redraw that isn't about time
  // (a caption edit) can repaint exactly the frame you are looking at.
  const shownRef = useRef(0);
  const [avail, setAvail] = useState({ w: 0, h: 0 });
  const [exporting, setExporting] = useState<{ frac: number; label: string } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  // Where the last push ended up: in Phonedeck's Incoming list (ok, under the
  // name it was stored as), or in Downloads because the local server wasn't
  // there to take it.
  const [sentNote, setSentNote] = useState<{ ok: boolean; text: string; name?: string } | null>(null);
  // The code the last export was written down under (and whether it failed to
  // be), and — separately — a build brought back by its code, with whatever
  // about it didn't come back exactly.
  const [lastRecipe, setLastRecipe] = useState<VidRecipe | null>(null);
  // Which export the code on show belongs to. The record is written down as
  // the render starts and shown straight away, so a run that then fails has to
  // be able to disown a record still on its way back.
  const exportRun = useRef(0);
  const [recipeError, setRecipeError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [recall, setRecall] = useState<{ busy: boolean; loaded: VidRecipe | null; problems: string[]; error: string | null }>({
    busy: false, loaded: null, problems: [], error: null,
  });
  const [trimPopup, setTrimPopup] = useState<{ slot: SlotId; x: number; y: number } | null>(null);
  // Which rack card has its chooser open: the persona one, or a folder slot's.
  // `all` is Bottom B's "Choose from any": the whole folder, links set aside,
  // for this one opening.
  const [picker, setPicker] = useState<{ kind: 'persona' } | { kind: 'clip'; slot: SlotId; all?: boolean } | null>(null);
  // The words are waiting on the clips: `pendingWrite` holds the ids still to
  // report a length, and whether a roll is what put them there — a roll says so
  // on the Random button, a Bottom B chosen by hand just writes when it is
  // ready. `rolledRef` is the picks the last roll put down, so rolling again
  // over exactly those asks nothing — only a stage built by hand is asked about.
  const [rolling, setRolling] = useState(false);
  const pendingWrite = useRef<{ ids: Set<string>; roll: boolean } | null>(null);
  const rolledRef = useRef<Picks | null>(null);

  const stageWrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Text metrics for the caption box — see capHandle.
  const measureRef = useRef<CanvasRenderingContext2D | null>(null);
  const videoEls = useRef(new Map<SlotId, HTMLVideoElement>());
  // A photo slot has no <video> to seek — just the still, sampled straight into
  // the frame like any other picture.
  const imgEls = useRef(new Map<SlotId, HTMLImageElement>());
  // The last frame each slot was showing before we seeked it. A seek empties the
  // element for a moment, and the stage clears to black every frame, so without
  // this a looping Top A flashes black at every join.
  const lastFrames = useRef(new Map<SlotId, HTMLCanvasElement>());
  const clockRef = useRef<{ startedAt: number; offset: number } | null>(null);
  const activeRef = useRef(new Set<SlotId>());
  const timeRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const timelineDrag = useRef(false);

  // Display scale: output px → screen px.
  const k = useMemo(() => {
    if (!avail.w || !avail.h) return 0;
    return Math.max(0, Math.min((avail.w - STAGE_PAD) / outW, (avail.h - STAGE_PAD) / outH));
  }, [avail, outW, outH]);
  const dispW = Math.round(outW * k);
  const dispH = Math.round(outH * k);

  const plan = useMemo(() => buildPlan(picks, durations, bars), [picks, durations, bars]);
  const total = plan.total;

  // ── Captions ──
  // Written by the model, kept here as plain lines so they can be edited by
  // hand afterwards, and timed against the real plan: Top A rides exactly
  // across Bottom A then Bottom B, so a line laid inside one of those spans is
  // over that clip by construction. End gets one pay-off line over the
  // winnings; Top B shares that window and carries nothing of its own.
  const [lines, setLines] = useState<CaptionLines>(EMPTY_LINES);
  const [styleId, setStyleId] = useState<string>(DEFAULT_CAPTION_STYLE);
  const [writing, setWriting] = useState(false);
  const [captionError, setCaptionError] = useState<string | null>(null);
  // How to steer the next run. Kept between rewrites on purpose — you land on a
  // note like "shorter" and want it to hold while you try the rest again.
  const [notes, setNotes] = useState('');
  // Two or three emoji across the whole set, where one actually lands. On by
  // default: these are captions for short vertical video, and a bare set reads
  // flat next to everything else on the feed.
  const [emojis, setEmojis] = useState(true);
  // Which emoji the writer may use: the ones pinned in the sidebar's Emojis
  // drawer — the set already chosen to reach for — handed over as their
  // characters. They are drawn from the app's Apple images on the stage and in
  // the file (lib/vidsCaptions), so what is picked from here is what goes out.
  const { prefs: emojiPrefs } = useEmojiPrefs();
  const emojiPalette = useMemo(
    () => pinnedUnifieds(emojiPrefs).map((u) => emojiByUnified(u)?.char).filter((c): c is string => !!c),
    [emojiPrefs],
  );
  const windows = useMemo(() => captionWindows(plan), [plan]);
  const caption = useMemo(() => buildCaptions(windows, lines), [windows, lines]);
  const captions = caption.all;
  const capStyle = useMemo(() => captionStyle(styleId), [styleId]);
  const canCaption = !!windows.start || !!windows.bottomA || !!windows.bottomB || !!windows.end;
  const hasLines = !!(
    lines.start.text.trim() || lines.bottomA.length || lines.bottomB.length
    || lines.payoff.text.trim() || lines.end.text.trim()
  );

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
    setWriting(true);
    setCaptionError(null);
    try {
      const draft = await writeCaptions({
        personaName: persona?.name ?? '',
        personaContext: persona?.context || picks.start?.video.context || '',
        wantStart: !!windows.start,
        notes: notes.trim(),
        bottomA: clipBrief(windows.bottomA, picks.bottomA?.video.context),
        bottomB: clipBrief(windows.bottomB, picks.bottomB?.video.context),
        wantEnd: !!windows.end,
        endContext: picks.end?.video.context ?? '',
        emojis,
        emojiPalette,
        // The one place two marks share a line, and only when the timeline
        // says neither side has room for its own.
        mergeSeam: seamNeedsMerge(windows),
      });
      // A rewrite keeps whatever was set to one line, and wherever a line was
      // dragged to, matched up by position — both are about the shape and place
      // of the caption slot rather than its wording. A line that wasn't there
      // before starts on its section's default.
      setLines((prev) => ({
        start: { ...capLine(draft.start, prev.start.oneLine), pos: prev.start.pos },
        bottomA: draft.bottomA.map((t, i) => ({
          ...capLine(t, prev.bottomA[i]?.oneLine ?? ONE_LINE_DEFAULT.bottomA),
          pos: prev.bottomA[i]?.pos,
        })),
        bottomB: draft.bottomB.map((t, i) => ({
          ...capLine(t, prev.bottomB[i]?.oneLine ?? ONE_LINE_DEFAULT.bottomB),
          pos: prev.bottomB[i]?.pos,
        })),
        payoff: { ...capLine(draft.payoff, prev.payoff.oneLine), pos: prev.payoff.pos },
        end: { ...capLine(draft.end, prev.end.oneLine), pos: prev.end.pos },
      }));
    } catch (e) {
      setCaptionError(e instanceof Error ? e.message : String(e));
    } finally {
      setWriting(false);
    }
  };
  const filled = SLOTS.filter((s) => picks[s.id]);
  const broken = plan.items.filter((i) => errors[i.video.id]);

  // Random's second half. A rolled build is captioned the way a hand-built
  // one is — off the clips as the browser measured them — so the words wait
  // until every clip the roll picked has loaded or failed. One that says
  // neither within ROLL_WAIT_MS is written around from the library's own
  // figures rather than leaving the stage half done. The ref keeps the effect
  // on the current writeLines without re-subscribing it every render.
  const writeLinesRef = useRef(writeLines);
  useEffect(() => { writeLinesRef.current = writeLines; });
  useEffect(() => {
    const pending = pendingWrite.current;
    if (!pending) return;
    const finish = () => {
      pendingWrite.current = null;
      setRolling(false);
      void writeLinesRef.current();
    };
    const heard = Array.from(pending.ids).every((id) => id in durations || id in errors);
    if (heard) { finish(); return; }
    const t = window.setTimeout(() => { if (pendingWrite.current === pending) finish(); }, ROLL_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [picks, durations, errors]);

  // Latest plan + geometry for the rAF loop, without re-subscribing it per frame.
  const liveRef = useRef({ plan, k, dispW, dispH, outW, outH, captions, capStyle });
  useEffect(() => {
    liveRef.current = { plan, k, dispW, dispH, outW, outH, captions, capStyle };
  }, [plan, k, dispW, dispH, outW, outH, captions, capStyle]);

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
  useEffect(() => {
    for (const s of SLOTS) {
      const v = videoEls.current.get(s.id);
      if (!v) continue;
      v.muted = picks[s.id]?.muted ?? true;
      v.volume = clampClipLevel(clipLevel);
    }
  }, [picks, clipLevel]);

  // ── Geometry helpers (source dims come from the live <video>) ──
  const sourceDims = useCallback((slot: SlotId) => {
    const v = videoEls.current.get(slot);
    if (v) return v.videoWidth ? { w: v.videoWidth, h: v.videoHeight } : null;
    const img = imgEls.current.get(slot);
    return img && img.naturalWidth ? { w: img.naturalWidth, h: img.naturalHeight } : null;
  }, []);

  /** What to sample a slot from right now: its <video> when it has a frame to
   *  give, the still for a photo slot, or the frame kept from just before a seek
   *  while the element has nothing — see lastFrames. */
  const frameSource = useCallback((slot: SlotId): { el: CanvasImageSource; w: number; h: number } | null => {
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

  /** Keep the frame a slot is showing, just before something seeks it. One copy
   *  per seek rather than per frame, which is what makes the fallback free. */
  const stashFrame = useCallback((slot: SlotId, v: HTMLVideoElement) => {
    if (v.readyState < 2 || !v.videoWidth) return;
    let c = lastFrames.current.get(slot);
    if (!c) { c = document.createElement('canvas'); lastFrames.current.set(slot, c); }
    if (c.width !== v.videoWidth || c.height !== v.videoHeight) {
      c.width = v.videoWidth;
      c.height = v.videoHeight;
    }
    c.getContext('2d')?.drawImage(v, 0, 0);
  }, []);
  const geometry = useCallback((item: PlanItem) => {
    const d = sourceDims(item.slot);
    if (!d) return null;
    const region = regionRect(item.region, outW, outH, bars);
    return {
      region,
      base: fittedRect(d.w, d.h, region, item.fit, item.align),
      rect: placedRect(d.w, d.h, region, item.fit, item.align, item.transform),
    };
  }, [sourceDims, outW, outH, bars]);

  // ── Drawing ──
  const draw = useCallback((t: number) => {
    const { plan, k, dispW, dispH, outW, outH, captions, capStyle } = liveRef.current;
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
    for (const item of activeAt(plan, t)) {
      const src = frameSource(item.slot);
      if (!src) continue;
      drawInRegion(ctx, src.el, src.w, src.h, regionRect(item.region, outW, outH, plan.bars), item.fit, item.align, item.transform);
    }
    // Last, so it sits over every region — the same call the exporter makes.
    const cap = captionAt(captions, t);
    if (cap) drawCaption(ctx, cap, outW, outH, capStyle, plan.bars);
  }, [frameSource]);

  // Point every slot's <video> at the right local time for `t`: entering slots
  // seek, leaving slots pause. `force` re-seeks the already-active ones too
  // (scrubbing / plan edits); the play loop leaves them running.
  const syncElements = useCallback((t: number, play: boolean, force: boolean) => {
    const { plan } = liveRef.current;
    // Every seek goes through here so the frame on screen is kept first.
    const seekTo = (slot: SlotId, el: HTMLVideoElement, to: number) => {
      stashFrame(slot, el);
      el.currentTime = to;
    };
    const tt = Math.min(t, Math.max(0, plan.total - 1e-3));
    const nowActive = new Set<SlotId>();
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
  }, [stashFrame]);

  // Plan / geometry changed while paused → re-sync the elements and redraw.
  // A sweep of the timeline comes through here too: the frame under the pointer
  // is the one on screen, so you can look forward or back without clicking, and
  // the picture drops back to the playhead the moment the pointer leaves.
  useEffect(() => {
    if (playing) return;
    const t = Math.min(timeRef.current, total);
    timeRef.current = t;
    const at = hoverTime === null ? t : Math.min(hoverTime, total);
    shownRef.current = at;
    syncElements(at, false, true);
    draw(at);
  }, [plan, total, k, playing, hoverTime, syncElements, draw]);

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
        // Arrive with something under it: a song nobody chose is easier to swap
        // than one nobody thought to add.
        if (!musicChosenRef.current) {
          const t = pickRandom(ts);
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

  const roomBed = useBed(openCtx, roomTone.on ? ROOM_TONE_URL : null, roomToneGain(roomTone), playing);
  // From the top, like the export: a song should start where it starts.
  const musicBed = useBed(openCtx, music.url, musicGain(music), playing, 0);
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
    setHoverTime(null);
    // Decoded here, inside the click, so the browser counts it as a gesture.
    // Each is a no-op when its layer is off.
    void roomBed.arm();
    void musicBed.arm();
    setPlaying(true);
  };

  // `keepPlaying` is explicit because callers often pause() in the same handler,
  // and the `playing` closure value would still be stale.
  const seek = (t: number, keepPlaying: boolean) => {
    timeRef.current = t;
    setTime(t);
    if (keepPlaying) {
      clockRef.current = { startedAt: performance.now(), offset: t };
      syncElements(t, true, true);
    } else {
      syncElements(t, false, true);
      draw(t);
    }
  };

  // Leaving the tab pauses; nothing should keep playing off-screen.
  useEffect(() => { if (!active) pause(); }, [active, pause]);

  // ── Slot lifecycle ──
  const handleMeta = (videoId: string) => (e: SyntheticEvent<HTMLVideoElement>) => {
    const d = Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0;
    setDurations((prev) => (prev[videoId] === d ? prev : { ...prev, [videoId]: d }));
  };

  /** How long this pick runs on the timeline. A photo has no length of its own
   *  and nothing to trim — it is held for PHOTO_LENGTH, or for as long as the
   *  window it is fitted to (End against Top B). */
  const slotLength = (pick: SlotPick): number | null => (isPhoto(pick.video)
    ? PHOTO_LENGTH
    : timelineLength(pick.trim, durations[pick.video.id] ?? pick.video.duration, pick.speed));

  const setPick = (slot: SlotId, patch: PickPatch) =>
    onPicksChange((prev) => (prev[slot] ? { ...prev, [slot]: { ...prev[slot], ...patch } } : prev));

  const setTransform = (slot: SlotId, transform: Transform) => setPick(slot, { transform });

  // Centre the clip in its section on one axis, keeping the zoom and the other
  // axis. Needs the live source dimensions, so it runs off the plan item.
  const centreSlot = (slot: SlotId, axis: 'x' | 'y') => {
    const item = plan.items.find((i) => i.slot === slot);
    const dims = sourceDims(slot);
    if (!item || !dims) return;
    const region = regionRect(item.region, outW, outH, bars);
    const offset = centredOffset(dims.w, dims.h, region, item.fit, item.align, axis);
    const t = item.transform;
    setTransform(slot, axis === 'x' ? { ...t, dx: offset } : { ...t, dy: offset });
  };

  const clearSlot = (slot: SlotId) =>
    onPicksChange((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });

  // Picking a slot in the rail also scrubs the preview to where that clip is on
  // screen, so it can be dragged / zoomed straight away.
  const selectFromRail = (slot: SlotId) => {
    onSelectSlot(slot);
    const item = plan.items.find((i) => i.slot === slot);
    if (!item) return;
    const t = timeRef.current;
    if (t >= item.start && t < item.end) return;
    if (playing) pause();
    seek(Math.min(item.start + 0.1, Math.max(item.start, item.end - 0.05)), false);
  };

  // ── Stage interaction ──
  // What the picture is showing: the playhead, or the frame being swept on the
  // timeline. Playing wins over a sweep — nothing yanks the picture out from
  // under a build that is running. Everything laid over the stage reads from
  // this, so the handles are always on the frame you can see.
  const shown = playing || hoverTime === null ? time : Math.min(hoverTime, total);
  const visibleItems = activeAt(plan, shown);
  const selItem = selectedSlot ? visibleItems.find((i) => i.slot === selectedSlot) ?? null : null;
  const selGeo = selItem ? geometry(selItem) : null;

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
        case 'payoff': return { ...prev, payoff: { ...prev.payoff, pos } };
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

  const onStagePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !k) return;
    const corner = ((e.target as HTMLElement).dataset?.handle ?? null) as Corner | null;
    const items = activeAt(plan, timeRef.current);
    let target: PlanItem | null = null;
    if (corner && selectedSlot) {
      target = items.find((i) => i.slot === selectedSlot) ?? null;
    } else {
      // Clicking anywhere inside a section selects the clip playing there —
      // even the black around a letterboxed clip, so a small clip is easy to grab.
      const r = stageRef.current?.getBoundingClientRect();
      if (!r) return;
      const p = { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
      for (let i = items.length - 1; i >= 0; i--) {
        if (inRect(p, regionRect(items[i].region, outW, outH, bars))) { target = items[i]; break; }
      }
      onSelectSlot(target?.slot ?? null);
      if (!target) return;
    }
    const geo = target ? geometry(target) : null;
    if (!target || !geo) return;
    dragRef.current = {
      slot: target.slot, mode: corner ? 'resize' : 'move', corner,
      startX: e.clientX, startY: e.clientY, start: target.transform, base: geo.base, rect: geo.rect,
    };
    stageRef.current?.setPointerCapture(e.pointerId);
    stageRef.current?.focus();
    e.preventDefault();
  };

  const onStagePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!k) return;
    const cd = capDragRef.current;
    if (cd) {
      // Derived from where the drag started, so nothing drifts over a long one.
      const dx = (e.clientX - cd.startX) / k / outW;
      const dy = (e.clientY - cd.startY) / k / outH;
      setLinePos(cd.ref, {
        x: clamp(cd.from.x + dx, CAPTION_EDGE, 1 - CAPTION_EDGE),
        y: clamp(cd.from.y + dy, CAPTION_EDGE, 1 - CAPTION_EDGE),
      });
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    // Always derive from the drag's starting geometry — no per-move drift.
    const dx = (e.clientX - d.startX) / k;
    const dy = (e.clientY - d.startY) / k;
    if (d.mode === 'move') {
      setTransform(d.slot, { ...d.start, dx: d.start.dx + dx, dy: d.start.dy + dy });
      return;
    }
    // Zoom about the corner opposite the one being dragged; whichever axis the
    // pointer moved further along (relative to the box) drives the scale.
    const r = d.rect;
    const c = d.corner ?? 'se';
    const sx = c.includes('e') ? 1 : -1;
    const sy = c.includes('s') ? 1 : -1;
    const fx = (r.w + sx * dx) / r.w;
    const fy = (r.h + sy * dy) / r.h;
    let f = Math.abs(fx - 1) >= Math.abs(fy - 1) ? fx : fy;
    f = Math.max(f, MIN_RECT / Math.min(r.w, r.h));
    const ax = sx === 1 ? r.x : r.x + r.w;
    const ay = sy === 1 ? r.y : r.y + r.h;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const ncx = ax + (cx - ax) * f;
    const ncy = ay + (cy - ay) * f;
    setTransform(d.slot, {
      zoom: d.start.zoom * f,
      dx: ncx - (d.base.x + d.base.w / 2),
      dy: ncy - (d.base.y + d.base.h / 2),
    });
  };

  const onStagePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current && !capDragRef.current) return;
    dragRef.current = null;
    capDragRef.current = null;
    try { stageRef.current?.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };

  const onStageKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === ' ') {
      e.preventDefault();
      if (playing) pause(); else play();
      return;
    }
    if (!selItem) return;
    const step = e.shiftKey ? 10 : 1;
    const nudge = (dx: number, dy: number) => {
      e.preventDefault();
      const t = selItem.transform;
      setTransform(selItem.slot, { ...t, dx: t.dx + dx, dy: t.dy + dy });
    };
    switch (e.key) {
      case 'ArrowLeft': nudge(-step, 0); break;
      case 'ArrowRight': nudge(step, 0); break;
      case 'ArrowUp': nudge(0, -step); break;
      case 'ArrowDown': nudge(0, step); break;
    }
  };

  // ── Trim popup ──
  const openTrim = (slot: SlotId, x: number, y: number) => {
    // A photo has no in and out point, and no rate to play at.
    const pick = picks[slot];
    if (pick && isPhoto(pick.video)) { onSelectSlot(slot); return; }
    onSelectSlot(slot);
    setTrimPopup({ slot, x, y });
    const item = plan.items.find((i) => i.slot === slot);
    if (item) { if (playing) pause(); seek(item.start, false); }
  };
  // Scrub to a trim's in / out point so the frame being cut is on screen.
  const previewTrim = (slot: SlotId, kind: 'in' | 'out', trim: Trim) => {
    const item = plan.items.find((i) => i.slot === slot);
    const pick = picks[slot];
    if (!item || !pick) return;
    const full = durations[pick.video.id] ?? pick.video.duration ?? item.sourceDuration;
    const len = timelineLength(trim, full, pick.speed) ?? item.duration;
    if (playing) pause();
    seek(kind === 'in' ? item.start : Math.max(item.start, item.start + len - 0.05), false);
  };

  // ── Timeline scrubbing (click / drag on the rows; a segment click also selects its clip) ──
  // Skipping does not stop the build: land on the new spot and carry on from
  // there, so jumping forward to check a later beat doesn't cost a second click.
  const timelineSeek = (e: PointerEvent<HTMLDivElement>) => {
    if (!total) return 0;
    const r = e.currentTarget.getBoundingClientRect();
    const t = clamp((e.clientX - r.left) / r.width, 0, 1) * total;
    seek(t, playing);
    return t;
  };
  const onTimelinePointerDown = (e: PointerEvent<HTMLDivElement>, region: Region) => {
    if (e.button !== 0 || !total) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    timelineDrag.current = true;
    const t = timelineSeek(e);
    // Pressing commits: the playhead is the picture again, not the sweep.
    setHoverTime(null);
    const hit = plan.items.find((i) => i.region === region && t >= i.start && t < i.end);
    if (hit) onSelectSlot(hit.slot);
  };
  // Moving over the rows without pressing is the preview: the stage shows the
  // frame under the pointer, so a look ahead or back costs no click and loses
  // no place — the playhead has not moved.
  const onTimelinePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!total) return;
    if (timelineDrag.current) { timelineSeek(e); return; }
    if (playing) return;
    const r = e.currentTarget.getBoundingClientRect();
    setHoverTime(clamp((e.clientX - r.left) / r.width, 0, 1) * total);
  };
  const onTimelinePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!timelineDrag.current) return;
    timelineDrag.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };

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
    picks, persona: appliedPersona, bars, roomTone, music, clipLevel, preset: presetId, lines, styleId,
    notes, emojis,
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
    if (!picks.bottomA) return '';
    const say = (label: string, context: string | undefined, marks: readonly { text: string }[] = []) => {
      const said = (context ?? '').trim();
      const beats = marks.map((m) => m.text.trim()).filter(Boolean);
      if (!said && !beats.length) return '';
      return `${label}: ${said || '(no context given)'}${beats.length ? `. Moments, in order: ${beats.join('; ')}` : ''}`;
    };
    return [
      say('Screen recording 1', picks.bottomA.video.context, picks.bottomA.video.marks),
      say('Screen recording 2, on pauv.com', picks.bottomB?.video.context, picks.bottomB?.video.marks),
      say('Ending, him showing what the trade made', picks.end?.video.context),
    ].filter(Boolean).join('\n');
  }, [picks]);

  const runExport = async (kind: 'download' | 'phone') => {
    if (!plan.items.length || broken.length || exporting) return;
    pause();
    setExportError(null);
    setSentNote(null);
    setRecipeError(null);
    setLastRecipe(null);
    setCopied(false);
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
        // No fps: the export runs at the rate of the fastest clip in the build,
        // so 60fps footage stays 60fps instead of being halved on the way out.
        width: outW,
        height: outH,
        plan,
        captions,
        captionStyle: capStyle,
        roomTone,
        music,
        clipLevel,
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
      if (kind === 'download') {
        downloadBlob(blob, name);
      } else {
        // Into Phonedeck's Incoming list — where a Media export lands — to be
        // pushed to the phones from the list under these buttons. If the local
        // server isn't up, the render is not thrown away: it goes to Downloads
        // instead, and the note says so.
        setExporting({ frac: 1, label: 'Sending to Phonedeck…' });
        try {
          const stored = await sendToPhonedeck(blob, name);
          setSentNote({ ok: true, name: stored, text: `In Phonedeck Incoming: ${stored} — pick the phones and push.` });
        } catch (e) {
          console.warn('[vids] phonedeck upload failed, falling back to browser download:', e);
          downloadBlob(blob, name);
          setSentNote({ ok: false, text: 'Phonedeck isn\'t reachable — saved to Downloads instead. Start the local server (Launch server, on the Media page) and push again.' });
        }
      }
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

  // ── Bring a build back ──
  // Everything the record holds goes back where it was: the slots through the
  // section (which owns the picks), the rest here. Nothing is asked of the
  // model — the words are the ones that were exported.
  const loadRecipe = async (raw: string) => {
    const code = parseRecipeCode(raw);
    if (!code) {
      setRecall((r) => ({ ...r, error: 'A code is six letters and numbers, like K7Q4M2 — it sits after the title of every exported video.' }));
      return;
    }
    if (!libraryLoaded) {
      setRecall((r) => ({ ...r, error: 'The library is still loading — give it a moment and try again.' }));
      return;
    }
    if (filled.length && !window.confirm(`Replace what is on the stage with build ${code}?`)) return;
    setRecall((r) => ({ ...r, busy: true, error: null }));
    try {
      const recipe = await getRecipe(code);
      const { picks: restored, problems } = picksFromSpec(recipe.build, resolveVideo, personas);
      const b = recipe.build;
      pause();
      onSelectSlot(null);
      setTrimPopup(null);
      setPicker(null);
      onPicksChange(() => restored);
      setBars({ ...b.bars });
      setRoomTone({ on: b.roomTone.on, level: clampRoomLevel(b.roomTone.level) });
      // A record written before music was a layer has none, which is what it
      // was exported with.
      musicChosenRef.current = true;
      setMusic(b.music
        ? { url: b.music.url ?? null, label: b.music.label ?? '', level: clampMusicLevel(b.music.level) }
        : DEFAULT_MUSIC);
      setClipLevel(clampClipLevel(b.clipLevel));
      setPresetId(OUTPUT_PRESETS.some((p) => p.id === b.preset) ? (b.preset as PresetId) : OUTPUT_PRESETS[0].id);
      // Over the empty set, so a build written down before End had its
      // pay-off line comes back with that line blank rather than missing.
      setLines({ ...EMPTY_LINES, ...structuredClone(b.captions.lines) });
      // Through captionStyle(), so a build written down with a look that has
      // since been retired comes back on one that exists.
      styleChosenRef.current = true;
      setStyleId(captionStyle(b.captions.styleId).id);
      setNotes(b.captions.notes);
      setEmojis(b.captions.emojis);
      setCaptionError(null);
      timeRef.current = 0;
      setTime(0);
      setRecall({ busy: false, loaded: recipe, problems, error: null });
    } catch (e) {
      setRecall((r) => ({ ...r, busy: false, error: e instanceof Error ? e.message : String(e) }));
    }
  };

  // ── Links ──
  // The Bottom A → Bottom B pairs ticked on the Link page, narrowed to clips
  // still filed where the builder looks for them — a pair with a side that has
  // been moved or deleted is no pair.
  const linkedPairs = useMemo(() => {
    const as = new Map(clipsForSlot('bottomA').map((v) => [v.id, v]));
    const bs = new Map(clipsForSlot('bottomB').map((v) => [v.id, v]));
    const out: { a: VidRow; b: VidRow }[] = [];
    for (const l of links) {
      const a = as.get(l.bottomAId);
      const b = bs.get(l.bottomBId);
      if (a && b) out.push({ a, b });
    }
    return out;
  }, [links, clipsForSlot]);

  // What Bottom B's picker offers while a Bottom A is on the stage: the clips
  // linked to it. Null when no Bottom A is on, or it has no links — the picker
  // then shows the whole folder, as it always did. "Choose from any" in the
  // picker sets it aside for that one opening.
  const bottomAId = picks.bottomA?.video.id ?? null;
  const linkedBottomBs = useMemo(() => {
    if (!bottomAId) return null;
    const pool = linkedPairs.filter((p) => p.a.id === bottomAId).map((p) => p.b);
    return pool.length ? pool : null;
  }, [linkedPairs, bottomAId]);

  /** How many Bottom Bs each Bottom A leads on to. The picker carries it in
   *  the corner of every tile, so a Bottom A with nothing linked to it yet —
   *  the one whose Bottom B would come from the whole folder, and which Random
   *  passes over — shows before you choose it rather than after. */
  const bottomALinks = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of clipsForSlot('bottomA')) counts.set(v.id, 0);
    for (const p of linkedPairs) counts.set(p.a.id, (counts.get(p.a.id) ?? 0) + 1);
    return counts;
  }, [clipsForSlot, linkedPairs]);

  /** A fresh End, and not the one already on when there is another to be had —
   *  the same idea as rollMusic, for the slot that picks itself. */
  const rollEnd = (): SlotPick | null => {
    const clips = clipsForSlot('end');
    const pool = clips.filter((v) => v.id !== picks.end?.video.id);
    const video = pickRandom(pool.length ? pool : clips);
    return video ? freshPick('end', video) : null;
  };

  /** Choosing a clip for a slot. Bottom B is the last thing a build waits on —
   *  the persona comes as a bundle and End picks itself — so choosing one starts
   *  the captions writing on their own, as soon as the clips have reported their
   *  lengths (the same wait a roll makes). Rewriting by hand from the rail is
   *  unchanged, and a Bottom B swapped later simply writes again.
   *
   *  A Bottom A that the Link page pairs with exactly one Bottom B brings that
   *  Bottom B with it — there is nothing to pick between — and that counts as
   *  choosing it: the captions start the same way. Bottom A stays the selected
   *  slot; the stage just fills in behind it. Two or more linked, or none, and
   *  Bottom B is left for you to pick from its (narrowed) picker. */
  const chooseClip = (slot: SlotId, video: VidRow) => {
    onAssign(slot, video);
    let follower: VidRow | null = null;
    if (slot === 'bottomA') {
      const mine = linkedPairs.filter((p) => p.a.id === video.id).map((p) => p.b);
      if (mine.length === 1 && picks.bottomB?.video.id !== mine[0].id) {
        const b = mine[0];
        follower = b;
        onPicksChange((prev) => ({ ...prev, bottomB: freshPick('bottomB', b, prev.bottomB) }));
      }
    }
    const bottomB = slot === 'bottomB' ? video : follower;
    if (!bottomB || writing || exporting || recall.busy) return;
    const ids = new Set<string>();
    for (const s of SLOTS) {
      const p = s.id === 'bottomB' ? { video: bottomB } : s.id === slot ? { video } : picks[s.id];
      if (p && !isPhoto(p.video)) ids.add(p.video.id);
    }
    if (ids.size) pendingWrite.current = { ids, roll: false };
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
   *  length (or failed), then write them — the same wait a roll makes. Simple
   *  says so on its own card while it happens, which is what `rolling` is for
   *  here: there is no Random button in Simple for it to spin. */
  const queueWrite = (ids: Set<string>) => {
    if (!ids.size || writing || exporting || recall.busy) return;
    pendingWrite.current = { ids, roll: true };
    setRolling(true);
  };

  /** Simple's vid. It goes to Bottom A, and everything that follows from it is
   *  filled in without asking: a Bottom B the Link page pairs with it — any of
   *  them, at random, since Simple has nobody to choose between them — or any
   *  Bottom B at all while nothing is linked yet; an End, if the stage somehow
   *  hasn't got one; then the captions, once the clips have loaded. */
  const chooseSimpleVid = (video: VidRow) => {
    const next: Picks = { ...picks, bottomA: freshPick('bottomA', video, picks.bottomA) };
    const linked = linkedPairs.filter((p) => p.a.id === video.id).map((p) => p.b);
    const b = pickRandom(linked.length ? linked : clipsForSlot('bottomB'));
    if (b) next.bottomB = freshPick('bottomB', b, picks.bottomB);
    else delete next.bottomB;
    if (!next.end) {
      const end = rollEnd();
      if (end) next.end = end;
    }
    pause();
    onSelectSlot(null);
    setPicker(null);
    // The words were written about the vid that was there — they go with it.
    setLines(EMPTY_LINES);
    setCaptionError(null);
    timeRef.current = 0;
    setTime(0);
    onPicksChange(() => next);
    queueWrite(clipIds(next));
  };

  /** Simple's persona. The hook is the persona's line, so choosing one over a
   *  vid that is already on the stage has the captions written again around
   *  them. With no vid yet there is nothing to write about — choosing one
   *  will do it. */
  const chooseSimplePersona = (persona: VidPersona) => {
    onUsePersona(persona);
    setPicker(null);
    if (!picks.bottomA) return;
    const next: Picks = { ...picks };
    for (const part of PERSONA_PARTS) {
      const id = persona[part];
      const video = id ? resolveVideo(id) : undefined;
      const slot = PERSONA_PART_SLOT[part];
      if (video) next[slot] = freshPick(slot, video, picks[slot]);
      else delete next[slot];
    }
    setLines(EMPTY_LINES);
    setCaptionError(null);
    queueWrite(clipIds(next));
  };

  // Coming over to Simple puts down whatever Advanced had open — a selected
  // clip, its settings popup, a trim — since none of it can be reached from
  // there to be closed by hand.
  useEffect(() => {
    if (!simple) return;
    onSelectSlot(null);
    setTrimPopup(null);
    setPicker(null);
  }, [simple, onSelectSlot]);

  /** Back to an empty stage: every slot cleared and the words written for those
   *  clips gone with them, since a caption is about the clip it was written over.
   *  It lands where a build starts rather than on nothing at all: a fresh End,
   *  a fresh song and a fresh look for the captions, the three the builder
   *  picks for itself anyway. How the video is set up — the bars, the size,
   *  the room tone — is left alone: those are how you work, not what you
   *  picked. Nothing leaves the library; this clears the stage, it doesn't
   *  delete footage. */
  const resetBuild = () => {
    pause();
    onSelectSlot(null);
    setTrimPopup(null);
    setPicker(null);
    const end = rollEnd();
    onPicksChange(() => (end ? { end } : {}));
    rollMusic();
    rollStyle();
    setLines(EMPTY_LINES);
    setCaptionError(null);
    setRecall({ busy: false, loaded: null, problems: [], error: null });
    timeRef.current = 0;
    setTime(0);
  };

  // End is the one slot nobody really chooses: every build finishes on him
  // showing what he made, and which of those it is hardly matters. So it fills
  // itself from the End folder the moment the library arrives — the card still
  // opens the picker to change it, and a stage cleared on purpose stays clear,
  // since this only ever fills a slot that has never been filled.
  const endFilled = useRef(false);
  useEffect(() => {
    if (!libraryLoaded || endFilled.current) return;
    if (picks.end) { endFilled.current = true; return; }
    const video = pickRandom(clipsForSlot('end'));
    if (!video) return;
    endFilled.current = true;
    onPicksChange((prev) => (prev.end ? prev : { ...prev, end: freshPick('end', video, prev.end) }));
  }, [libraryLoaded, picks.end, clipsForSlot, onPicksChange]);

  // Whether Random has anything to draw from at all.
  const rollable = useMemo(
    () => personas.length > 0 || FOLDER_SLOTS.some((slot) => clipsForSlot(slot).length > 0),
    [personas, clipsForSlot],
  );

  /** A song off the shelf, and not the one already on when there is another to
   *  be had. Random uses it; so do Reset and the list the first time it arrives. */
  const rollMusic = () => {
    const pool = tracks.filter((t) => t.url !== music.url);
    const t = pickRandom(pool.length ? pool : tracks);
    if (!t) return;
    musicChosenRef.current = true;
    setMusic((m) => ({ ...m, url: t.url, label: t.label }));
  };

  /** A look for the captions off the shelf, and not the one already on when
   *  there is another to be had — the song's rule, for the song's reason: a
   *  look nobody chose is easier to swap than one nobody thought to try.
   *  Random and Reset use it; the pane rolls one itself the first time it
   *  opens (below). */
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

  /** A whole build at random: one persona (a complete one when there is one,
   *  else whichever partial one), a clip each for Bottom A, Bottom B and End,
   *  and then the captions, once the clips have loaded — see the effect above.
   *  A slot with nothing to draw from is left empty, as it would be by hand. */
  const randomBuild = () => {
    if (!libraryLoaded || !rollable || rolling || writing || exporting || recall.busy) return;
    // End alone is what a reset leaves behind — nobody chose it, so there is
    // nothing there to lose and nothing to ask about.
    if (filled.some((s) => s.id !== 'end') && picks !== rolledRef.current
      && !window.confirm('Replace what is on the stage with a random build? The clips themselves stay in the library.')) return;
    const has = (p: VidPersona, part: (typeof PERSONA_PARTS)[number]) => {
      const id = p[part];
      return !!id && !!resolveVideo(id);
    };
    const whole = personas.filter((p) => PERSONA_PARTS.every((part) => has(p, part)));
    const partial = personas.filter((p) => PERSONA_PARTS.some((part) => has(p, part)));
    const persona = pickRandom(whole.length ? whole : partial);
    const next: Picks = {};
    if (persona) {
      for (const part of PERSONA_PARTS) {
        const id = persona[part];
        const video = id ? resolveVideo(id) : undefined;
        const slot = PERSONA_PART_SLOT[part];
        if (video) next[slot] = freshPick(slot, video, picks[slot]);
      }
    }
    // The bottom pair comes off the Link page once anything has been linked:
    // one Bottom A among those with links, then one of the Bottom Bs ticked
    // for it — never two clips that merely share a folder. Each Bottom A gets
    // an even chance whether it leads on to one clip or five. With nothing
    // linked yet the two slots roll on their own, as End always does.
    const pair = (() => {
      if (!linkedPairs.length) return null;
      const aId = pickRandom(Array.from(new Set(linkedPairs.map((p) => p.a.id))));
      return pickRandom(linkedPairs.filter((p) => p.a.id === aId)) ?? null;
    })();
    if (pair) {
      next.bottomA = freshPick('bottomA', pair.a, picks.bottomA);
      next.bottomB = freshPick('bottomB', pair.b, picks.bottomB);
    }
    for (const slot of FOLDER_SLOTS) {
      if (next[slot]) continue;
      const video = pickRandom(clipsForSlot(slot));
      if (video) next[slot] = freshPick(slot, video, picks[slot]);
    }
    pause();
    onSelectSlot(null);
    setTrimPopup(null);
    setPicker(null);
    setLines(EMPTY_LINES);
    setCaptionError(null);
    rollMusic();
    rollStyle();
    setRecall({ busy: false, loaded: null, problems: [], error: null });
    timeRef.current = 0;
    setTime(0);
    rolledRef.current = next;
    onPicksChange(() => next);
    const ids = new Set<string>();
    for (const s of SLOTS) { const p = next[s.id]; if (p && !isPhoto(p.video)) ids.add(p.video.id); }
    if (ids.size) {
      pendingWrite.current = { ids, roll: true };
      setRolling(true);
    }
  };

  // ── Render ──
  const rows: { label: string; region: Region }[] = [
    { label: 'Full', region: 'full' },
    { label: 'Top', region: 'top' },
    { label: 'Bottom', region: 'bottom' },
  ];
  const describe = (i: PlanItem) =>
    `${fmtTime(i.start)}–${fmtTime(i.end)}  ${SLOT_META[i.slot].label}`
    + `${i.region === 'full' ? '' : ` (${i.region})`}${i.loop ? ' · loops' : ''}`;
  const px = (v: number) => v * k;

  // What Simple has room to say. Advanced says all of this in five places at
  // once — the rack, the rails, the Random button, the timeline — and Simple
  // has one line for it.
  const simpleBusy = rolling || writing;
  const simpleStatus = (() => {
    if (simpleBusy) return 'Putting it together — the rest of the clips, the sound and the captions.';
    if (!appliedPersonaId) {
      return picks.bottomA
        ? 'Now choose a persona.'
        : 'Choose a persona and a vid — everything else fills itself in.';
    }
    if (!picks.bottomA) return 'Now choose a vid.';
    if (broken.length) return 'One of these clips would not load — choose another vid.';
    return `Ready${total ? ` · ${fmtTime(total)}` : ''} — play it, then push it to the phones or download it.`;
  })();

  // The finish line, built here — where everything it reads from lives — and
  // rendered at the foot of the export rail, or of Simple's own. `phonedeck`
  // is the Phonedeck list, or where it goes: Simple keeps it here under the
  // buttons, Advanced puts it in the export rail with a column's height to
  // itself and passes nothing.
  const recentFile = sentNote?.ok ? sentNote.name ?? null : null;
  const renderExport = (phonedeck: ReactNode) => (
    <>
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
        <div className="flex flex-col gap-1.5">
          <button
            data-vids-export="phone"
            onClick={() => void runExport('phone')}
            disabled={!plan.items.length || broken.length > 0}
            title="Render the MP4 and drop it in Phonedeck's Incoming list below — then pick the phones and push, the same as a Media export"
            className={`${BTN_TEXT} justify-center border-zinc-600 bg-white text-black hover:bg-zinc-200`}
          >
            <UploadIcon size={13} /> Push to Phonedeck
          </button>
          <button
            data-vids-export="download"
            onClick={() => void runExport('download')}
            disabled={!plan.items.length || broken.length > 0}
            title="Render the MP4 and save it to this PC"
            className={`${BTN_TEXT} justify-center border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500`}
          >
            <DownloadIcon size={13} /> Download MP4
          </button>
          <p className="text-[10px] text-zinc-600">
            {outW}×{outH} · H.264 + AAC · frame rate follows the clips{total ? ` · ${fmtTime(total)}` : ''}
          </p>
        </div>
      )}
      {exportError && <p className="mt-2 text-[11px] text-red-400">{exportError}</p>}
      {sentNote && <p className={`mt-2 text-[11px] ${sentNote.ok ? 'text-emerald-400' : 'text-amber-300'}`}>{sentNote.text}</p>}
      {phonedeck}
      {recipeError && <p className="mt-2 text-[11px] text-amber-300">{recipeError}</p>}
      {lastRecipe && (
        <div data-vids-recipe={lastRecipe.code} className="mt-2 rounded-md border border-zinc-800 bg-zinc-900/60 p-2">
          <p className="truncate text-[11px] font-medium text-zinc-100" title={lastRecipe.name}>{lastRecipe.title}</p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="font-mono text-[13px] tracking-widest text-emerald-300">{lastRecipe.code}</span>
            <Chip
              onClick={() => {
                navigator.clipboard?.writeText(lastRecipe.code).then(() => setCopied(true)).catch(() => { /* no clipboard here */ });
              }}
              title="Copy the code"
            >
              {copied ? 'Copied' : 'Copy'}
            </Chip>
          </div>
          <p className="mt-1 text-[9px] leading-relaxed text-zinc-600">
            Written down with everything this build used. Type the code into the box at the top left of the stage
            to bring it back exactly.
          </p>
        </div>
      )}
    </>
  );

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
              ref={(el) => { if (el) imgEls.current.set(s.id, el); else imgEls.current.delete(s.id); }}
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
            ref={(el) => {
              if (el) videoEls.current.set(s.id, el);
              else { videoEls.current.delete(s.id); lastFrames.current.delete(s.id); }
            }}
            src={p.video.url}
            crossOrigin="anonymous"
            playsInline
            preload="auto"
            muted={p.muted}
            onLoadedMetadata={handleMeta(p.video.id)}
            onLoadedData={() => draw(timeRef.current)}
            onSeeked={() => draw(timeRef.current)}
            onError={() => setErrors((prev) => ({ ...prev, [p.video.id]: 'Could not load this clip (unsupported codec or network error).' }))}
            className="pointer-events-none absolute h-px w-px opacity-0"
            aria-hidden
          />
        );
      })}

      {/* Stage + transport */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={stageWrapRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          {/* The code box and the Random / Reset buttons are Advanced's: Simple
              has two cards and a finished video, so there is nothing on the
              stage to clear and nothing to bring back by hand. */}
          {!simple && (
            <>
              <VidsRecall
                disabled={!libraryLoaded}
                busy={recall.busy}
                loaded={recall.loaded}
                problems={recall.problems}
                error={recall.error}
                onLoad={(raw) => void loadRecipe(raw)}
              />

              <div className="absolute right-3 top-3 z-30 flex items-center gap-1.5">
                <button
                  onClick={randomBuild}
                  disabled={!libraryLoaded || !rollable || rolling || writing || !!exporting || recall.busy}
                  title={rollable
                    ? (linkedPairs.length
                      ? 'Fill every slot at random — a persona, a Bottom A with one of the Bottom Bs linked to it, and End — and write the captions for them'
                      : 'Fill every slot at random — a persona, Bottom A, Bottom B and End — and write the captions for them. Link Bottom As to Bottom Bs on Edit & file → Link and it will only pick pairs')
                    : 'Nothing to draw from yet — file a persona and some bottom clips first'}
                  className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-950/80 px-2 py-1 text-[10px] text-zinc-400 backdrop-blur transition-colors hover:border-zinc-500 hover:text-white disabled:cursor-default disabled:border-zinc-800 disabled:text-zinc-700 disabled:hover:border-zinc-800 disabled:hover:text-zinc-700"
                >
                  {(rolling || writing) && <SpinnerIcon size={10} className="animate-spin" />}
                  {rolling ? 'Loading…' : writing ? 'Writing…' : 'Random'}
                </button>
                <button
                  onClick={resetBuild}
                  disabled={!filled.length && !hasLines}
                  title="Clear every clip on the stage and the captions written for them, and start again on a fresh End and a fresh song — the library is untouched"
                  className="rounded border border-zinc-700 bg-zinc-950/80 px-2 py-1 text-[10px] text-zinc-400 backdrop-blur transition-colors hover:border-zinc-500 hover:text-white disabled:cursor-default disabled:border-zinc-800 disabled:text-zinc-700 disabled:hover:border-zinc-800 disabled:hover:text-zinc-700"
                >
                  Reset
                </button>
              </div>
            </>
          )}
          {filled.length === 0 ? (
            <div className="max-w-sm text-center text-zinc-500">
              <VideoIcon size={28} className="mx-auto mb-3 text-zinc-700" />
              <p className="text-sm text-zinc-400">
                {simple ? 'Choose a persona and a vid on the right' : 'Choose a persona, then fill the bottom'}
              </p>
            </div>
          ) : k > 0 && (
            /* In Simple the stage is a screen, not a workbench: nothing is
               picked, dragged, zoomed or nudged on it. */
            <div
              ref={stageRef}
              data-vids-stage
              tabIndex={simple ? -1 : 0}
              className={`relative select-none touch-none bg-black outline-none ring-1 ring-zinc-800 ${
                simple ? '' : `focus:ring-zinc-600 ${visibleItems.length ? 'cursor-move' : ''}`
              }`}
              style={{ width: dispW, height: dispH }}
              onPointerDown={simple ? undefined : onStagePointerDown}
              onPointerMove={simple ? undefined : onStagePointerMove}
              onPointerUp={simple ? undefined : onStagePointerUp}
              onPointerCancel={simple ? undefined : onStagePointerUp}
              onKeyDown={simple ? undefined : onStageKeyDown}
            >
              <canvas ref={canvasRef} data-vids-canvas className="block" style={{ width: dispW, height: dispH }} />

              {/* The caption on screen, as something you can take hold of. It
                  covers exactly the words the canvas painted, sits above every
                  clip, and shows its edges when you are on it — nothing here is
                  drawn into the video. Simple's captions are the video's,
                  not something to move. */}
              {!simple && capHandle && (
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

              {/* Faint outline of every section on screen (bars show up as the
                  gaps). Advanced only: they are there to be dragged against. */}
              {!simple && visibleItems.map((i) => {
                const r = regionRect(i.region, outW, outH, bars);
                return (
                  <div
                    key={i.slot}
                    className={`pointer-events-none absolute border ${i.slot === selectedSlot ? 'border-white/40' : 'border-white/10'}`}
                    style={{ left: px(r.x), top: px(r.y), width: px(r.w), height: px(r.h) }}
                  />
                );
              })}

              {/* Selected clip: its visible box + corner zoom handles (kept inside the stage) */}
              {selGeo && (() => {
                const { rect, region } = selGeo;
                const ix = Math.max(rect.x, region.x);
                const iy = Math.max(rect.y, region.y);
                const ix2 = Math.min(rect.x + rect.w, region.x + region.w);
                const iy2 = Math.min(rect.y + rect.h, region.y + region.h);
                return (
                  <>
                    {ix2 > ix && iy2 > iy && (
                      <div
                        className="pointer-events-none absolute border border-white"
                        style={{ left: px(ix), top: px(iy), width: px(ix2 - ix), height: px(iy2 - iy) }}
                      />
                    )}
                    {CORNERS.map((c) => {
                      const x = clamp(c.includes('w') ? rect.x : rect.x + rect.w, 0, outW);
                      const y = clamp(c.includes('n') ? rect.y : rect.y + rect.h, 0, outH);
                      return (
                        <div
                          key={c}
                          data-handle={c}
                          title="Drag to zoom"
                          className="absolute z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-zinc-900 bg-white"
                          style={{ left: px(x), top: px(y), cursor: CURSOR[c] }}
                        />
                      );
                    })}
                  </>
                );
              })()}

              {/* Settings popup, anchored under (or over) the selected clip */}
              {selItem && selGeo && picks[selItem.slot] && (() => {
                const pick = picks[selItem.slot];
                if (!pick) return null;
                const { rect, region } = selGeo;
                const ix = Math.max(rect.x, region.x);
                const iy = Math.max(rect.y, region.y);
                const iy2 = Math.min(rect.y + rect.h, region.y + region.h);
                const POP_W = 276;
                const POP_H = 146;
                const left = clamp(px(ix), 8, Math.max(8, dispW - POP_W - 8));
                const below = px(iy2) + 10;
                const top = below + POP_H <= dispH - 8 ? below : Math.max(8, px(iy) - POP_H - 10);
                return (
                  <div
                    className="absolute z-20 cursor-default rounded-md border border-zinc-700 bg-zinc-950/95 p-2 shadow-xl backdrop-blur"
                    style={{ left, top, width: POP_W }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-sm ${SLOT_COLOR[selItem.slot]}`} />
                      <span className="text-[11px] font-semibold text-zinc-200">{SLOT_META[selItem.slot].label}</span>
                      <span className="min-w-0 flex-1 truncate text-[10px] text-zinc-500" title={pick.video.name}>{pick.video.name}</span>
                      <span className="font-mono text-[10px] text-zinc-500">{Math.round(pick.transform.zoom * 100)}%</span>
                      <button onClick={() => onSelectSlot(null)} title="Close" className="text-zinc-500 hover:text-white"><CloseIcon size={12} /></button>
                    </div>
                    <ClipSettings
                      pick={pick}
                      onChange={(patch) => setPick(selItem.slot, patch)}
                      onCentre={(axis) => centreSlot(selItem.slot, axis)}
                      onTrim={() => {
                        const r = stageRef.current?.getBoundingClientRect();
                        openTrim(selItem.slot, (r?.left ?? 0) + left, (r?.top ?? 0) + top + POP_H + 8);
                      }}
                    />
                    <div className="mt-1.5 flex items-center justify-between text-[9px] text-zinc-600">
                      <span>drag to move · corners zoom · arrows nudge</span>
                      <button onClick={() => { clearSlot(selItem.slot); onSelectSlot(null); }} className="text-zinc-500 hover:text-red-400">Clear slot</button>
                    </div>
                  </div>
                );
              })()}

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
          <span data-vids-time className="w-10 text-right font-mono text-[11px] text-zinc-400">{fmtTime(time)}</span>
          <input
            data-vids-scrub
            type="range"
            min={0}
            max={total || 0}
            step={0.01}
            value={Math.min(time, total || 0)}
            disabled={!plan.items.length}
            onChange={(e) => seek(Number(e.target.value), playing)}
            className="h-1.5 flex-1"
            style={{ '--fill': `${total ? (Math.min(time, total) / total) * 100 : 0}%` } as CSSProperties}
          />
          <span className="w-10 font-mono text-[11px] text-zinc-500">{fmtTime(total)}</span>
        </div>
      </div>

      {/* Simple's rail: the two choices, a line on how it is getting on, and the
          two ways out. Everything else about the build — the bars, the sound,
          the size, the captions — sits wherever Advanced left it, which is
          where a Vid wants it anyway. */}
      {simple && (
        <aside className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-l border-zinc-800 p-3">
          <SimpleCard
            label="Persona"
            hint="who fronts it — Start, Top A and Top B"
            name={appliedPersona?.name ?? null}
            thumbUrl={picks.start?.video.thumbUrl ?? picks.topA?.video.thumbUrl ?? null}
            missing="No persona yet"
            disabled={!libraryLoaded || !personas.length}
            onChoose={() => setPicker({ kind: 'persona' })}
          />
          <SimpleCard
            label="Vid"
            hint="the recording the video is about"
            name={picks.bottomA?.video.name ?? null}
            thumbUrl={picks.bottomA?.video.thumbUrl ?? null}
            missing="No vid yet"
            disabled={!libraryLoaded}
            onChoose={() => setPicker({ kind: 'clip', slot: 'bottomA' })}
          />

          <div className="mb-3 mt-1 flex items-start gap-1.5 text-[10px] text-zinc-500">
            {simpleBusy && <SpinnerIcon size={10} className="mt-px shrink-0 animate-spin" />}
            <p className="min-w-0 flex-1">{simpleStatus}</p>
          </div>
          {captionError && <p className="mb-2 text-[10px] text-red-400">{captionError}</p>}

          {/* Phonedeck, small, under the buttons: the phones and what is in
              Incoming, with the file just sent on top. Where a push finishes. */}
          {renderExport(<VidsPhonedeck recent={recentFile} />)}
        </aside>
      )}

      {/* Advanced: the rack and the settings in one rail, the words in the
          next, and in the last the post caption, the Phonedeck list and the
          finish line. */}
      {!simple && (
        <>
        <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-zinc-800">
          <Section title="Build">
            <PersonaRack
              personas={personas}
              appliedPersonaId={appliedPersonaId}
              picks={picks}
              durations={durations}
              errors={errors}
              selectedSlot={selectedSlot}
              onChoose={() => setPicker({ kind: 'persona' })}
              onUse={onUsePersona}
              onClear={onClearPersona}
              onSelectSlot={selectFromRail}
              onClearSlot={clearSlot}
              onDropVideoId={(slot, id) => { const v = resolveVideo(id); if (v) chooseClip(slot, v); }}
            />
            <div className="h-2" />
            {FOLDER_SLOTS.map((id) => {
              const meta = SLOT_META[id];
              const p = picks[id];
              // A Bottom B the Link page doesn't pair with the Bottom A on the
              // stage is still allowed — it is only said so, since the whole
              // point of the links is that the two line up.
              const unlinked = id === 'bottomB' && !!p && !!linkedBottomBs
                && !linkedBottomBs.some((v) => v.id === p.video.id);
              return (
                <SlotCard
                  key={id}
                  meta={meta}
                  pick={p}
                  duration={p ? slotLength(p) : null}
                  error={p ? (errors[p.video.id] ?? null) : null}
                  warn={unlinked ? `Not linked to “${picks.bottomA?.video.name}” — click to pick one that is` : null}
                  selected={selectedSlot === id}
                  onChoose={() => setPicker({ kind: 'clip', slot: id })}
                  onClear={() => clearSlot(id)}
                  onDropVideoId={(vid) => { const v = resolveVideo(vid); if (v) chooseClip(id, v); }}
                />
              );
            })}
          </Section>

          <Section
            title="Bars"
            collapsible
            defaultOpen={false}
            summary={
              bars.middle || bars.outer
                ? [bars.middle && 'middle', bars.outer && 'top & bottom'].filter(Boolean).join(' · ')
                : 'off'
            }
          >
            <BarControl
              label="Middle bar"
              hint="between the top and bottom halves"
              on={bars.middle}
              size={bars.middleSize}
              max={Math.floor(outH / 3)}
              onToggle={(on) => setBars((b) => ({ ...b, middle: on }))}
              onSize={(n) => setBars((b) => ({ ...b, middleSize: n }))}
            />
            <BarControl
              label="Top & bottom bars"
              hint="across the whole frame, every phase"
              on={bars.outer}
              size={bars.outerSize}
              max={Math.floor(outH / 4)}
              onToggle={(on) => setBars((b) => ({ ...b, outer: on }))}
              onSize={(n) => setBars((b) => ({ ...b, outerSize: n }))}
            />
          </Section>

          <Section title="Sound">
            <div className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-[11px] text-zinc-300">Music</span>
              <select
                value={music.url ?? ''}
                onChange={(e) => {
                  const url = e.target.value || null;
                  musicChosenRef.current = true;
                  setMusic((m) => ({ ...m, url, label: tracks.find((t) => t.url === url)?.label ?? '' }));
                }}
                title="A song under the whole video, from the audio library"
                className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-200"
              >
                <option value="">None</option>
                {/* A build brought back by its code may name a track that has since
                    been deleted. It stays selected and says so, rather than
                    quietly turning into "None" while the record still says music. */}
                {music.url && !tracks.some((t) => t.url === music.url) && (
                  <option value={music.url}>{music.label || music.url.split('/').pop()} — missing</option>
                )}
                {tracks.map((t) => <option key={t.url} value={t.url}>{t.label}</option>)}
              </select>
            </div>
            {music.url && (
              <div className="mt-1 flex items-center gap-2 pl-12">
                <input
                  type="range"
                  min={MIN_MUSIC_LEVEL}
                  max={MAX_MUSIC_LEVEL}
                  step={0.05}
                  value={music.level}
                  onChange={(e) => setMusic((m) => ({ ...m, level: clampMusicLevel(Number(e.target.value)) }))}
                  className="h-1.5 flex-1"
                  style={{ '--fill': `${(music.level / MAX_MUSIC_LEVEL) * 100}%` } as CSSProperties}
                />
                <span className="w-12 text-right font-mono text-[10px] text-zinc-400">
                  {Math.round(music.level * 100)}%
                </span>
              </div>
            )}
            {!tracks.length && (
              <p className="mt-1 pl-12 text-[9px] text-zinc-600">
                {tracksError ? `Couldn't list the audio library: ${tracksError}` : 'No tracks in the audio library yet.'}
              </p>
            )}
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px] text-zinc-300">
              <input
                type="checkbox"
                checked={roomTone.on}
                onChange={(e) => setRoomTone((r) => ({ ...r, on: e.target.checked }))}
              />
              <span>Room tone</span>
              <span className="truncate text-[9px] text-zinc-600">under the whole video</span>
            </label>
            {roomTone.on && (
              <div className="mt-1 flex items-center gap-2 pl-5">
                <input
                  type="range"
                  min={MIN_ROOM_LEVEL}
                  max={MAX_ROOM_LEVEL}
                  step={0.05}
                  value={roomTone.level}
                  onChange={(e) => setRoomTone((r) => ({ ...r, level: clampRoomLevel(Number(e.target.value)) }))}
                  className="h-1.5 flex-1"
                  style={{ '--fill': `${(roomTone.level / MAX_ROOM_LEVEL) * 100}%` } as CSSProperties}
                />
                <span className="w-12 text-right font-mono text-[10px] text-zinc-400">
                  {Math.round(roomTone.level * 100)}%
                </span>
              </div>
            )}
            <div className="mt-2 flex items-center gap-2">
              <span className="w-10 shrink-0 text-[11px] text-zinc-300">Clips</span>
              <input
                type="range"
                min={MIN_CLIP_LEVEL}
                max={MAX_CLIP_LEVEL}
                step={0.05}
                value={clipLevel}
                onChange={(e) => setClipLevel(clampClipLevel(Number(e.target.value)))}
                className="h-1.5 flex-1"
                style={{ '--fill': `${(clipLevel / MAX_CLIP_LEVEL) * 100}%` } as CSSProperties}
              />
              <span className="w-12 text-right font-mono text-[10px] text-zinc-400">
                {Math.round(clipLevel * 100)}%
              </span>
            </div>
            {soundError && (
              <p className="mt-2 text-[9px] text-red-400">Sound didn&rsquo;t load: {soundError}</p>
            )}
          </Section>

          <Section title="Timeline">
            {plan.items.length === 0 ? (
              <p className="text-[10px] text-zinc-600">Fill a slot to see the sequence.</p>
            ) : (
              <>
                <div className="space-y-1">
                  {rows.map((row) => (
                    <div key={row.region} className="flex items-center gap-1.5">
                      <span className="w-10 text-[9px] text-zinc-600">{row.label}</span>
                      <div
                        className="relative h-4 flex-1 cursor-col-resize touch-none overflow-hidden rounded bg-zinc-900"
                        title="Sweep to look — click or drag to scrub there"
                        onPointerDown={(e) => onTimelinePointerDown(e, row.region)}
                        onPointerMove={onTimelinePointerMove}
                        onPointerUp={onTimelinePointerUp}
                        onPointerCancel={onTimelinePointerUp}
                        onPointerLeave={() => setHoverTime(null)}
                      >
                        {plan.items.filter((i) => i.region === row.region).map((i) => (
                          <div
                            key={i.slot}
                            title={`${describe(i)} — right-click to trim`}
                            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openTrim(i.slot, e.clientX, e.clientY); }}
                            className={`absolute inset-y-0 flex items-center overflow-hidden px-1 text-[9px] text-black/80 ${SLOT_COLOR[i.slot]}`}
                            style={{ left: `${(i.start / total) * 100}%`, width: `${((i.end - i.start) / total) * 100}%` }}
                          >
                            <span className="truncate">{SLOT_META[i.slot].label}</span>
                          </div>
                        ))}
                        <div className="pointer-events-none absolute inset-y-0 w-px bg-white" style={{ left: `${(Math.min(time, total) / total) * 100}%` }} />
                        {/* Where the sweep is looking — dimmer, because the playhead has not moved. */}
                        {hoverTime !== null && !playing && (
                          <div
                            className="pointer-events-none absolute inset-y-0 w-px bg-white/40"
                            style={{ left: `${(Math.min(hoverTime, total) / total) * 100}%` }}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <ul className="mt-2 space-y-0.5 font-mono text-[10px] text-zinc-500">
                  {plan.items.map((i) => <li key={i.slot}>{describe(i)}</li>)}
                </ul>
              </>
            )}
          </Section>

          <Section title="Output">
            <select
              value={presetId}
              onChange={(e) => setPresetId(e.target.value as PresetId)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-200"
            >
              {OUTPUT_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </Section>
        </aside>

        <VidsCaptionsRail
          canCaption={canCaption}
          lines={lines}
          setLines={setLines}
          laid={caption}
          windows={windows}
          hasLines={hasLines}
          writing={writing}
          error={captionError}
          onWrite={() => void writeLines()}
          onClear={() => { setLines(EMPTY_LINES); setCaptionError(null); }}
          notes={notes}
          setNotes={setNotes}
          emojis={emojis}
          setEmojis={setEmojis}
          styleId={styleId}
          setStyleId={setStyleId}
          onResetPos={(ref) => setLinePos(ref, undefined)}
        />

        <VidsExportRail
          brief={postBrief}
          recent={recentFile}
          // The code the export just minted, so the caption ends on it as the
          // file name does.
          code={lastRecipe?.code ?? null}
          exportPanel={renderExport(null)}
        />
        </>
      )}

      {picker?.kind === 'persona' && (
        <VidsPersonaPicker
          personas={personas}
          resolveVideo={resolveVideo}
          currentId={appliedPersonaId}
          onChoose={simple ? chooseSimplePersona : onUsePersona}
          onClose={() => setPicker(null)}
        />
      )}

      {picker?.kind === 'clip' && (() => {
        const slot = picker.slot;
        const meta = SLOT_META[slot];
        // Bottom B is narrowed to what the Link page pairs with the Bottom A
        // on the stage, until "Choose from any" opens it up. A Bottom A with
        // nothing linked yet gets the whole folder, and the subtitle says so.
        const narrowed = slot === 'bottomB' && !picker.all ? linkedBottomBs : null;
        const aName = picks.bottomA?.video.name;
        const subtitle = narrowed
          ? `the ${narrowed.length} linked to “${aName}” on Edit & file → Link`
          : slot === 'bottomB' && aName
            ? (picker.all && linkedBottomBs
              ? `from the whole ${meta.folder} folder — the ones linked to “${aName}” are tagged`
              : `from the ${meta.folder} folder — nothing is linked to “${aName}” yet, so all of it`)
            : undefined;
        return (
          <VidsClipPicker
            // Simple never says "Bottom A": there is one vid to choose and
            // that is what it is called there.
            title={simple ? 'a vid' : meta.label}
            folder={meta.folder}
            clips={narrowed ?? clipsForSlot(slot)}
            subtitle={subtitle}
            linkedIds={slot === 'bottomB' && linkedBottomBs ? new Set(linkedBottomBs.map((v) => v.id)) : undefined}
            linkCounts={slot === 'bottomA' ? bottomALinks : undefined}
            onShowAll={narrowed ? () => setPicker({ kind: 'clip', slot, all: true }) : undefined}
            currentId={picks[slot]?.video.id ?? null}
            onChoose={(v) => (simple ? chooseSimpleVid(v) : chooseClip(slot, v))}
            onClose={() => setPicker(null)}
          />
        );
      })()}

      {trimPopup && (() => {
        const pick = picks[trimPopup.slot];
        if (!pick) return null;
        return (
          <TrimPopup
            slot={trimPopup.slot}
            pick={pick}
            full={durations[pick.video.id] ?? pick.video.duration}
            x={trimPopup.x}
            y={trimPopup.y}
            onChange={(trim) => setPick(trimPopup.slot, { trim })}
            onSpeed={(speed) => setPick(trimPopup.slot, { speed: clampSpeed(speed) })}
            onPreview={(kind, trim) => previewTrim(trimPopup.slot, kind, trim)}
            onClose={() => setTrimPopup(null)}
          />
        );
      })()}
    </div>
  );
}
