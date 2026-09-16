'use client';

// VidsIntake — the middle of the Edit & file page while no clip is open: the
// whole stage is a drop target, and a drop starts the short pipeline that walks
// footage from the desktop to a finished, filed clip.
//
//   one clip (or two, or four)   folder → name → context → edit → save
//   three at once                a persona: name it, give the bundle its one
//                                context, then trim each of the three and save
//
// Only that last step writes anything. Until a clip has been named, given its
// context and edited, it lives on your disk and nowhere else: the editor plays
// it from there, and Save is what uploads it — with the name, the context and
// the marks already on it. A clip skipped, or a run cancelled, was never saved.
// A photo has nothing to edit, so naming it is what files it.
//
// Three files is read as a persona because that is what a persona is: Start,
// Top A and Top B are shot together and always travel together, so they get one
// name and one context between them rather than three of each — and there is
// nothing to do to them but trim, since a persona carries no sound of its own.
//
// None of this replaces working piece by piece. Dropping onto a folder in the
// left pane still just files footage there, and clicking a clip still opens it
// in the editor on its own — the pipeline is the way in when you have footage in
// hand and want it carried all the way through.

import { useEffect, useMemo, useState } from 'react';
import type { DragEvent } from 'react';
import { PERSONA_PARTS, PERSONA_PART_LABEL, VID_THEMES, type VidContext, type VidTheme } from '@/lib/vids-types';
import type { VidRow } from '@/lib/vids-types';
import { VID_DRAG_MIME, slotForFolderName } from '@/lib/vidsPlan';
import { probeVideoFile } from '@/lib/vids-client';
import { CONTEXT_PLACEHOLDER } from './VidsContext';
import { ArrowRightIcon, CloseIcon, SpinnerIcon, UploadIcon, VideoIcon } from '@/lib/icons';
import { fmtBytes } from './VidPreview';

export const hasVid = (e: DragEvent) => Array.from(e.dataTransfer.types).includes(VID_DRAG_MIME);
export const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

/** A persona part being dragged into a new place in the order — the intake's
 *  own drag, so the stage's file and clip drops leave it alone. */
const PART_DRAG_MIME = 'application/x-pauv-persona-part';
const hasPart = (e: DragEvent) => Array.from(e.dataTransfer.types).includes(PART_DRAG_MIME);

/** Drop this many at once and it is taken to be a persona. */
export const PERSONA_DROP = PERSONA_PARTS.length;

export type IntakeMode = 'clips' | 'persona';

/** A row standing in for a dropped file until it is saved: the shape the
 *  editor takes, playing off the disk, with the file itself along for the
 *  render and the upload. */
export type LocalRow = VidRow & { file: File };

/** Where a run has got to.
 *    folder    clips only — which folder this footage is being filed in
 *    setup     persona only — its name and the one context the bundle shares
 *    context   clips only — what to call this clip and what it is showing,
              asked per clip. A name is required; the context can wait.
 *    edit      the editor has the clip; saving moves the run on
 *    done      every clip is saved; the banner says so until it is dismissed */
export type IntakeStep = 'folder' | 'setup' | 'context' | 'edit' | 'done';

export interface Intake {
  mode: IntakeMode;
  step: IntakeStep;
  /** The dropped files, in the order they will be edited. For a persona that
   *  order is Start, Top A, Top B. */
  files: File[];
  /** One row per file, standing in for it until it is saved: the editor opens
   *  these and plays them off the disk, and the name, context and marks are
   *  kept on them as they are given. Nothing goes up until Save. */
  local: LocalRow[];
  folderId: string | null;
  folderName: string;
  /** The saved rows, one slot per file, filled in as each save lands. A clip
   *  skipped or cancelled out of leaves its slot empty — it was never saved. */
  rows: (VidRow | null)[];
  /** Which file the run is on. */
  index: number;
  /** The persona, once it exists — it is made with its first saved part. */
  personaId: string | null;
  personaName: string;
  /** The context the persona's three clips share, given at setup and written
   *  to the persona when it is made. */
  personaContext: string;
  /** A save is going up from outside the editor — a photo being filed. */
  saving: boolean;
}

const STEPS: Record<IntakeMode, readonly string[]> = {
  clips: ['Folder', 'Name', 'Edit', 'Save'],
  persona: ['Persona', 'Trim', 'Save'],
};

/** Which of the labels above the run is standing on. */
function stepAt(intake: Intake): number {
  if (intake.mode === 'persona') return intake.step === 'setup' ? 0 : intake.step === 'edit' ? 1 : 2;
  if (intake.step === 'folder') return 0;
  if (intake.step === 'context') return 1;
  return intake.step === 'edit' ? 2 : 3;
}

/** What the clip at `index` is called in this run — its persona part, or its
 *  place in the drop. */
export function intakeLabel(intake: Intake, index = intake.index): string {
  if (intake.mode === 'persona') return PERSONA_PART_LABEL[PERSONA_PARTS[index]] ?? `Clip ${index + 1}`;
  return intake.files.length > 1 ? `Clip ${index + 1} of ${intake.files.length}` : 'This clip';
}

function StepDots({ intake }: { intake: Intake }) {
  const at = stepAt(intake);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {STEPS[intake.mode].map((label, i) => (
        <span
          key={label}
          className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
            i === at ? 'bg-zinc-200 text-black' : i < at ? 'text-emerald-400' : 'text-zinc-600'
          }`}
        >
          <span className="opacity-50">{i + 1}</span>{label}
        </span>
      ))}
    </div>
  );
}

/** The shell every step of the run is drawn in: how far along it is, what this
 *  step wants, and a way out that leaves whatever already uploaded alone. */
function Card({ intake, title, hint, onCancel, children }: {
  intake: Intake;
  title: string;
  hint: string;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  return (
    // m-auto rather than justify-center: a card taller than the stage has to
    // scroll from its own top rather than have it cut off.
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      <div className="m-auto w-full max-w-[440px] rounded-xl border border-zinc-800 bg-zinc-950 p-4 shadow-2xl">
        <div className="mb-3 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <StepDots intake={intake} />
            <p className="mt-1.5 truncate text-[13px] font-semibold text-zinc-100" title={title}>{title}</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500">{hint}</p>
          </div>
          <button
            onClick={onCancel}
            title="Stop here — anything already uploaded stays in the library"
            className="shrink-0 text-zinc-500 hover:text-white"
          >
            <CloseIcon size={13} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FileLine({ file, label }: { file: File; label?: string }) {
  return (
    <div className="flex items-center gap-2 rounded border border-zinc-800 bg-black px-2 py-1">
      {label && <span className="shrink-0 text-[10px] font-semibold text-zinc-200">{label}</span>}
      <span className="min-w-0 flex-1 truncate text-[10px] text-zinc-400" title={file.name}>{file.name}</span>
      <span className="shrink-0 font-mono text-[9px] text-zinc-600">{fmtBytes(file.size)}</span>
    </div>
  );
}

/** A folder this footage can be filed in. The Inbox is one of them: not deciding
 *  yet is a real answer, and the left pane is where you would decide later. */
export interface FolderChoice {
  id: string | null;
  name: string;
  hint: string;
}

interface StageProps {
  intake: Intake | null;
  choices: readonly FolderChoice[];
  /** Files arriving on the stage — a drop, or the file picker. */
  onFiles: (files: FileList | File[]) => void;
  /** A library clip was dragged onto the stage: open it in the editor. */
  onOpenClip: (id: string) => void;
  onChooseFolder: (choice: FolderChoice) => void;
  /** Persona setup is done: its name, the context all three share, and the order
   *  the three files play in. */
  onStartPersona: (name: string, context: VidContext, order: File[]) => void;
  /** Three files that aren't a persona after all — file them as ordinary clips. */
  onFileAsClips: () => void;
  /** Context for the clip the run is on — then straight into the editor. The
   *  theme is a Bottom B's alone (see VidTheme); null everywhere else. */
  onContext: (name: string, context: VidContext, theme: VidTheme | null) => void;
  onCancel: () => void;
  /** The run's clip is open in the editor and this stage is showing anyway
   *  (the Upload tab was opened over it) — go back to the editor. */
  onResume?: () => void;
}

export function VidsIntakeStage({
  intake, choices, onFiles, onOpenClip, onChooseFolder, onStartPersona, onFileAsClips, onContext, onCancel,
  onResume,
}: StageProps) {
  const [over, setOver] = useState(false);

  // A run in the middle of asking something must not be blown away by a stray
  // drop; once it has finished, dropping again starts the next one.
  const dropOpen = !intake || intake.step === 'done';

  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e) && !hasVid(e)) return;
    // Taken either way: a drop the browser is left to handle opens the file over
    // the page and everything on it is gone.
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    if (!dropOpen) return;
    const id = e.dataTransfer.getData(VID_DRAG_MIME);
    if (id) { onOpenClip(id); return; }
    if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onDragEnter={(e) => {
        if (!hasFiles(e) && !hasVid(e)) return;
        e.preventDefault();
        if (dropOpen) setOver(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e) && !hasVid(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = !dropOpen ? 'none' : hasVid(e) ? 'move' : 'copy';
        if (dropOpen) setOver(true);
      }}
      // Crossing a child fires a leave too, so only a pointer that has really
      // left the pane drops the highlight.
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
      onDrop={onDrop}
    >
      {!intake ? (
        <IdleStage over={over} onFiles={onFiles} />
      ) : intake.step === 'folder' ? (
        <FolderStep intake={intake} choices={choices} onChoose={onChooseFolder} onCancel={onCancel} />
      ) : intake.step === 'setup' ? (
        <PersonaStep intake={intake} onStart={onStartPersona} onFileAsClips={onFileAsClips} onCancel={onCancel} />
      ) : intake.step === 'context' ? (
        <ContextStep
          key={intake.index}
          intake={intake}
          onNext={onContext}
          onCancel={onCancel}
        />
      ) : intake.step === 'edit' ? (
        <WaitStep intake={intake} onCancel={onCancel} onResume={onResume} />
      ) : (
        <DoneStage intake={intake} over={over} onFiles={onFiles} onCancel={onCancel} />
      )}
    </div>
  );
}

/** Nothing open and nothing running: the stage is one big drop target. */
function IdleStage({ over, onFiles }: { over: boolean; onFiles: (files: FileList | File[]) => void }) {
  const [fileEl, setFileEl] = useState<HTMLInputElement | null>(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col p-6">
      <input
        ref={setFileEl}
        type="file"
        accept="video/*,.mov,.mkv"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <div
        onClick={() => fileEl?.click()}
        className={`flex min-h-0 flex-1 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-8 text-center transition-colors ${
          over ? 'border-emerald-500 bg-emerald-950/20' : 'border-zinc-800 hover:border-zinc-600 hover:bg-zinc-950/60'
        }`}
      >
        <UploadIcon size={30} className={over ? 'text-emerald-400' : 'text-zinc-600'} />
        <p className="mt-3 text-[14px] font-semibold text-zinc-100">{over ? 'Drop it' : 'Drop footage here'}</p>
        <p className="mt-1 max-w-[420px] text-[11px] leading-relaxed text-zinc-500">
          One clip and it walks you through: pick the folder, name it, say what it is showing, edit it, save.
          Nothing is uploaded until that last step.
        </p>
        <p className="mt-0.5 max-w-[420px] text-[11px] leading-relaxed text-zinc-500">
          Drop <span className="font-semibold text-zinc-300">three</span> and it is a persona — name it once,
          give the bundle one context, then trim Start, Top A and Top B in turn.
        </p>
        <p className="mt-4 text-[10px] text-zinc-600">or click to choose files — mp4, mov, webm, mkv</p>
        <p className="mt-6 max-w-[420px] border-t border-zinc-900 pt-4 text-[10px] leading-relaxed text-zinc-600">
          Rather work piece by piece? Drop straight onto a folder on the left to just file it, or click any clip
          there to open it here on its own.
        </p>
      </div>
    </div>
  );
}

function FolderStep({ intake, choices, onChoose, onCancel }: {
  intake: Intake;
  choices: readonly FolderChoice[];
  onChoose: (choice: FolderChoice) => void;
  onCancel: () => void;
}) {
  return (
    <Card
      intake={intake}
      title={intake.files.length > 1 ? `Where do these ${intake.files.length} go?` : 'Where does this go?'}
      hint="The folder decides which slot of a build can use it. Nothing is uploaded until you have named it, said what it shows and saved your edit."
      onCancel={onCancel}
    >
      <div className="mb-3 space-y-1">
        {intake.files.map((f, i) => <FileLine key={`${f.name}-${f.size}-${i}`} file={f} />)}
      </div>
      <div className="space-y-1">
        {choices.map((c) => (
          <button
            key={c.name}
            onClick={() => onChoose(c)}
            className="flex w-full items-center gap-2 rounded-md border border-zinc-800 px-2.5 py-2 text-left transition-colors hover:border-zinc-500 hover:bg-zinc-900"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-zinc-100">{c.name}</p>
              <p className="truncate text-[9px] text-zinc-500">{c.hint}</p>
            </div>
            <ArrowRightIcon size={12} className="shrink-0 text-zinc-600" />
          </button>
        ))}
      </div>
    </Card>
  );
}

/** The only things a persona is asked for: a name, and the context its three
 *  clips share. The parts are handed out in drop order, which is rarely the
 *  order they play in, so each is shown as a frame from the middle of its clip
 *  — three file names look alike; three frames don't — and dragging one onto
 *  another's place puts it there. */
function PersonaStep({ intake, onStart, onFileAsClips, onCancel }: {
  intake: Intake;
  onStart: (name: string, context: VidContext, order: File[]) => void;
  onFileAsClips: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [order, setOrder] = useState<File[]>(intake.files);
  /** Which part is being dragged, and which place it is held over. */
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  // A stable key per file across reorders — the same file dropped twice would
  // collide on its name and size.
  const ids = useMemo(() => new Map(intake.files.map((f, i) => [f, i])), [intake.files]);

  // A frame from the middle of each clip, read off the file in the browser the
  // same way the upload measures it. They come in one by one; the object URLs
  // are let go when the step is.
  const [thumbs, setThumbs] = useState<Map<File, string>>(new Map());
  useEffect(() => {
    let live = true;
    const made: string[] = [];
    for (const f of intake.files) {
      void probeVideoFile(f).then((p) => {
        if (!p.thumb) return;
        const url = URL.createObjectURL(p.thumb);
        if (!live) { URL.revokeObjectURL(url); return; }
        made.push(url);
        setThumbs((m) => new Map(m).set(f, url));
      });
    }
    return () => { live = false; made.forEach((u) => URL.revokeObjectURL(u)); };
  }, [intake.files]);

  /** Put the part at `from` into place `to`, sliding the others along. */
  const reorder = (from: number, to: number) => {
    if (from === to) return;
    setOrder((prev) => {
      const next = [...prev];
      const [f] = next.splice(from, 1);
      next.splice(to, 0, f);
      return next;
    });
  };

  const ready = !!name.trim();
  const start = () => { if (ready) onStart(name, { context: text.trim() }, order); };

  return (
    <Card
      intake={intake}
      title="Three clips — a persona"
      hint="Start, Top A and Top B are one performance, so they share a name and one context. All you do to them after this is trim."
      onCancel={onCancel}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') start(); }}
        placeholder="Persona name"
        className="mb-2.5 w-full rounded border border-zinc-700 bg-black px-2 py-1.5 text-[12px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-400"
      />

      <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
        Parts — drag them into the order they play
      </p>
      <div className="mb-3 grid grid-cols-3 gap-2">
        {order.map((f, i) => {
          const thumb = thumbs.get(f);
          const lifted = dragging === i;
          const target = over === i && dragging !== null && dragging !== i;
          return (
            <div
              key={ids.get(f) ?? i}
              draggable
              title="Drag it onto the place it should play in"
              onDragStart={(e) => {
                e.dataTransfer.setData(PART_DRAG_MIME, String(i));
                e.dataTransfer.effectAllowed = 'move';
                setDragging(i);
              }}
              onDragEnd={() => { setDragging(null); setOver(null); }}
              onDragEnter={(e) => {
                if (!hasPart(e)) return;
                e.preventDefault();
                e.stopPropagation();
                setOver(i);
              }}
              onDragOver={(e) => {
                if (!hasPart(e)) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
                if (over !== i) setOver(i);
              }}
              // Moving over the card's own children fires a leave too; only a
              // pointer that has really left it drops the highlight.
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === i ? null : o));
              }}
              onDrop={(e) => {
                if (!hasPart(e)) return;
                e.preventDefault();
                e.stopPropagation();
                const from = Number(e.dataTransfer.getData(PART_DRAG_MIME));
                if (Number.isInteger(from)) reorder(from, i);
                setDragging(null);
                setOver(null);
              }}
              className={`flex cursor-grab flex-col overflow-hidden rounded-md border bg-black transition-colors active:cursor-grabbing ${
                target ? 'border-emerald-500 bg-emerald-950/20'
                : lifted ? 'border-zinc-700 opacity-40'
                : 'border-zinc-800 hover:border-zinc-600'
              }`}
            >
              <div className="flex items-center justify-between px-1.5 py-1">
                <span className="text-[10px] font-semibold text-zinc-200">{PERSONA_PART_LABEL[PERSONA_PARTS[i]]}</span>
                <span className="font-mono text-[9px] text-zinc-600">{i + 1}</span>
              </div>
              <div className="relative aspect-[9/16] w-full bg-zinc-900">
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" draggable={false} className="pointer-events-none h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <SpinnerIcon size={12} className="animate-spin text-zinc-600" />
                  </div>
                )}
              </div>
              <div className="px-1.5 py-1">
                <p className="truncate text-[9px] text-zinc-400" title={f.name}>{f.name}</p>
                <p className="font-mono text-[8px] text-zinc-600">{fmtBytes(f.size)}</p>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Context — all three</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder={CONTEXT_PLACEHOLDER}
        className="w-full resize-none rounded border border-zinc-800 bg-black px-2 py-1.5 text-[11px] leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500"
      />

      <button
        onClick={start}
        disabled={!ready}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded bg-white py-1.5 text-[11px] font-medium text-black hover:bg-zinc-200 disabled:opacity-30"
      >
        <UploadIcon size={12} /> Start trimming
      </button>
      <p className="mt-1.5 text-center text-[9px] text-zinc-600">
        Each part is saved to the Persona folder as its trim is ·{' '}
        <button onClick={onFileAsClips} className="underline decoration-zinc-700 hover:text-zinc-300">
          not a persona — file them as clips
        </button>
      </p>
    </Card>
  );
}

/** Which way the trade in a clip went — the second half of its name here. */
type Direction = 'up' | 'down';
const DIRECTIONS: readonly Direction[] = ['up', 'down'];

/** The light/dark pick, remembered between runs: a session of filing is nearly
 *  always all one way, so the last answer is the next one's default. */
const THEME_KEY = 'vids-bottom-b-theme-v1';
const THEME_LABEL: Record<VidTheme, string> = { light: '☀ Light', dark: '🌙 Dark' };
const lastTheme = (): VidTheme => {
  try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
};

/** Two things about this clip, in this order: what to call it, and what it is
 *  showing. The name has one shape in this flow — who it is on, then which way
 *  he traded: "elon up", "trump down" — so every clip filed this way reads the
 *  same in the library and is found by the name and the direction alone. Both
 *  halves are required; a clip can be renamed to anything afterwards by
 *  right-clicking it. The context is the sentence the caption writer reads,
 *  and that one can stay empty.
 *
 *  A Bottom B is asked one thing more: which way Pauv was on the screen while
 *  it was recorded (see VidTheme). It is a fact about the footage rather than
 *  something to decide, so it always has an answer — the one you gave last —
 *  and changing it is one click. */
function ContextStep({ intake, onNext, onCancel }: {
  intake: Intake;
  onNext: (name: string, context: VidContext, theme: VidTheme | null) => void;
  onCancel: () => void;
}) {
  const [who, setWho] = useState('');
  const [direction, setDirection] = useState<Direction | null>(null);
  const [text, setText] = useState('');
  const bottomB = slotForFolderName(intake.folderName) === 'bottomB';
  const [theme, setTheme] = useState<VidTheme>(lastTheme);
  const file = intake.files[intake.index];
  // A photo has nothing to edit, so this step is the whole of filing it.
  const photo = !!file && file.type.startsWith('image/');
  const name = who.trim() && direction ? `${who.trim()} ${direction}` : '';
  const ready = !!name && !intake.saving;
  const next = () => {
    if (!ready) return;
    if (bottomB) { try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ } }
    onNext(name, { context: text.trim() }, bottomB ? theme : null);
  };

  return (
    <Card
      intake={intake}
      title={`Name ${file?.name ?? 'this clip'}`}
      hint={`${intakeLabel(intake)} · filed in ${intake.folderName}. Who it is on and which way he traded — that is its name — then what it is showing. The caption writer reads that one, so say it the way you would out loud.`}
      onCancel={onCancel}
    >
      <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Name — who, then which way</p>
      <div className="flex items-stretch gap-1.5">
        <input
          autoFocus
          value={who}
          onChange={(e) => setWho(e.target.value)}
          // The arrow keys pick the direction without leaving the field, so
          // "elon", ↑, Enter files a clip in three strokes.
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') { e.preventDefault(); setDirection('up'); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setDirection('down'); }
            else if (e.key === 'Enter') { e.preventDefault(); next(); }
          }}
          placeholder="elon"
          maxLength={80}
          className="min-w-0 flex-1 rounded border border-zinc-700 bg-black px-2 py-1.5 text-[11px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-400"
        />
        {DIRECTIONS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDirection(d)}
            title={d === 'up' ? 'He traded up — ↑ while typing does the same' : 'He traded down — ↓ while typing does the same'}
            className={`shrink-0 rounded border px-2.5 text-[11px] font-medium transition-colors ${
              direction === d
                ? d === 'up'
                  ? 'border-emerald-500 bg-emerald-500/20 text-emerald-200'
                  : 'border-rose-500 bg-rose-500/20 text-rose-200'
                : 'border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
            }`}
          >
            {d}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[9px] text-zinc-600">
        {name
          ? <>Filed as <span className="font-medium text-zinc-300">{name}</span></>
          : <>Type who it is on, then pick up or down — &quot;elon up&quot;, &quot;trump down&quot;.</>}
      </p>

      {bottomB && (
        <>
          <p className="mb-1 mt-2.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
            Which way was Pauv
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {VID_THEMES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                title={`Pauv was in ${t} mode in this recording`}
                className={`rounded border py-1.5 text-[11px] font-medium transition-colors ${
                  theme === t
                    ? t === 'light'
                      ? 'border-zinc-300 bg-zinc-200 text-black'
                      : 'border-sky-500 bg-sky-500/20 text-sky-200'
                    : 'border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
                }`}
              >
                {THEME_LABEL[t]}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[9px] text-zinc-600">Kept on the clip so you can see which you have.</p>
        </>
      )}

      <p className="mb-1 mt-2.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">What it shows</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); next(); } }}
        rows={3}
        placeholder={CONTEXT_PLACEHOLDER}
        className="w-full resize-none rounded border border-zinc-800 bg-black px-2 py-1.5 text-[11px] leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500"
      />

      <button
        onClick={next}
        disabled={!ready}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded bg-white py-1.5 text-[11px] font-medium text-black hover:bg-zinc-200 disabled:opacity-40"
      >
        {intake.saving
          ? <><SpinnerIcon size={12} className="animate-spin" /> Saving…</>
          : photo
            ? <><UploadIcon size={12} /> Save this photo</>
            : <>Edit this clip <ArrowRightIcon size={12} /></>}
      </button>
      <p className="mt-1.5 text-center text-[9px] text-zinc-600">
        {photo
          ? `Enter saves it to ${intake.folderName} · a name and a direction are all it needs`
          : 'Enter opens the editor · nothing is uploaded until you save the edit'}
      </p>
    </Card>
  );
}

/** The run is on a clip, and that clip is open on the Edit tab, playing straight
 *  off the disk — this only says so and points there. */
function WaitStep({ intake, onCancel, onResume }: { intake: Intake; onCancel: () => void; onResume?: () => void }) {
  return (
    <Card
      intake={intake}
      title={`${intakeLabel(intake)} is in the editor`}
      hint="It is open on the Edit tab, playing from your disk — finish it there and save. Saving is what files it."
      onCancel={onCancel}
    >
      {onResume && (
        <button
          onClick={onResume}
          className="flex w-full items-center justify-center gap-1.5 rounded bg-white py-1.5 text-[11px] font-medium text-black hover:bg-zinc-200"
        >
          Back to the editor <ArrowRightIcon size={12} />
        </button>
      )}
    </Card>
  );
}

function DoneStage({ intake, over, onFiles, onCancel }: {
  intake: Intake;
  over: boolean;
  onFiles: (files: FileList | File[]) => void;
  onCancel: () => void;
}) {
  const [fileEl, setFileEl] = useState<HTMLInputElement | null>(null);
  // What actually got saved: a skipped clip has no row, and was never uploaded.
  const total = intake.files.length;
  const saved = intake.rows.filter(Boolean).length;
  const skipped = total - saved;
  const clipsSaved = saved === total
    ? (total > 1 ? `All ${total} clips are` : 'That clip is')
    : `${saved} of ${total} clips are`;
  return (
    <div className="flex min-h-0 flex-1 flex-col p-6">
      <input
        ref={setFileEl}
        type="file"
        accept="video/*,.mov,.mkv"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <div
        onClick={() => fileEl?.click()}
        className={`flex min-h-0 flex-1 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-8 text-center transition-colors ${
          over ? 'border-emerald-500 bg-emerald-950/20' : 'border-zinc-800 hover:border-zinc-600'
        }`}
      >
        <VideoIcon size={26} className={saved ? 'text-emerald-500' : 'text-zinc-600'} />
        <p className="mt-3 max-w-[420px] text-[13px] font-semibold text-zinc-100">
          {intake.mode === 'persona'
            ? saved
              ? `"${intake.personaName}" is built — ${saved === total ? 'all three parts' : `${saved} of ${total} parts`} trimmed and saved.`
              : `"${intake.personaName}" was not made — none of its parts were saved.`
            : saved
              ? `${clipsSaved} saved in ${intake.folderName}.`
              : 'Nothing was saved.'}
          {skipped > 0 && saved > 0 && ` ${skipped} skipped and not saved.`}
        </p>
        <p className="mt-1 text-[11px] text-zinc-500">
          {intake.mode === 'persona' && saved
            ? 'Pick it on the Build page to stack a video.'
            : 'Drop more footage to run it again.'}
        </p>
        <button
          onClick={(e) => { e.stopPropagation(); onCancel(); }}
          className="mt-4 rounded border border-zinc-700 px-3 py-1 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-white"
        >
          Done
        </button>
      </div>
    </div>
  );
}

/** The strip above the editor while a run has a clip open: where you are, and
 *  the two ways on — pass on this one, or stop the run here. Saving is the third
 *  and the usual one, and it lives in the editor where it always did. */
export function VidsIntakeBanner({ intake, onSkip, onCancel }: {
  intake: Intake;
  onSkip: () => void;
  onCancel: () => void;
}) {
  const last = intake.index >= intake.files.length - 1;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5">
      <StepDots intake={intake} />
      <p className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">
        {intake.mode === 'persona' ? (
          <>
            <span className="font-semibold text-zinc-100">{intake.personaName}</span>
            {' · '}{intakeLabel(intake)} ({intake.index + 1} of {intake.files.length}) — trim it, then save.
          </>
        ) : (
          <>{intakeLabel(intake)} — going to {intake.folderName}. Cut it, lay the keys over it, then save — saving is what files it.</>
        )}
      </p>
      <button
        onClick={onSkip}
        title="Move on without saving this clip — it stays on your disk and nowhere else"
        className="shrink-0 rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-white"
      >
        {last ? 'Skip · finish' : 'Skip this one'}
      </button>
      <button
        onClick={onCancel}
        title="Stop the run — everything already saved stays"
        className="shrink-0 text-zinc-500 hover:text-white"
      >
        <CloseIcon size={12} />
      </button>
    </div>
  );
}
