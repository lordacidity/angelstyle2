'use client';

// VidsIntake — the middle of the Edit & file page while no clip is open: the
// whole stage is a drop target, and a drop starts the short pipeline that walks
// footage from the desktop to a finished, filed clip.
//
//   one clip (or two, or four)   folder → context → edit → save
//   three at once                a persona: name it, give the bundle its one
//                                context, then trim each of the three and save
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

import { useState } from 'react';
import type { DragEvent } from 'react';
import { PERSONA_PARTS, PERSONA_PART_LABEL, type VidContext } from '@/lib/vids-types';
import type { VidRow } from '@/lib/vids-types';
import { VID_DRAG_MIME } from '@/lib/vidsPlan';
import { CONTEXT_PLACEHOLDER } from './VidsContext';
import { ArrowRightIcon, CloseIcon, SpinnerIcon, UploadIcon, VideoIcon } from '@/lib/icons';
import { fmtBytes } from './VidPreview';

export const hasVid = (e: DragEvent) => Array.from(e.dataTransfer.types).includes(VID_DRAG_MIME);
export const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

/** Drop this many at once and it is taken to be a persona. */
export const PERSONA_DROP = PERSONA_PARTS.length;

export type IntakeMode = 'clips' | 'persona';

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
  folderId: string | null;
  folderName: string;
  /** One slot per file, filled as each upload lands — editing the first can
   *  start while the ones behind it are still going up. */
  rows: (VidRow | null)[];
  /** Which file the run is on. */
  index: number;
  personaId: string | null;
  personaName: string;
  /** An upload is still running somewhere in this run. */
  busy: boolean;
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
  /** Context for the clip the run is on — then straight into the editor. */
  onContext: (name: string, context: VidContext) => void;
  onCancel: () => void;
}

export function VidsIntakeStage({
  intake, choices, onFiles, onOpenClip, onChooseFolder, onStartPersona, onFileAsClips, onContext, onCancel,
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
        <WaitStep intake={intake} onCancel={onCancel} />
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
          One clip and it walks you through: pick the folder, say what it is showing, edit it, save.
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
      hint="The folder decides which slot of a build can use it. Uploading starts the moment you pick."
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
 *  order they play in — hence the arrows. */
function PersonaStep({ intake, onStart, onFileAsClips, onCancel }: {
  intake: Intake;
  onStart: (name: string, context: VidContext, order: File[]) => void;
  onFileAsClips: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [order, setOrder] = useState<File[]>(intake.files);

  const move = (i: number, by: number) => {
    const to = i + by;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    [next[i], next[to]] = [next[to], next[i]];
    setOrder(next);
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

      <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Parts — in the order they play</p>
      <div className="mb-3 space-y-1">
        {order.map((f, i) => (
          <div key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <FileLine file={f} label={PERSONA_PART_LABEL[PERSONA_PARTS[i]]} />
            </div>
            <div className="flex shrink-0 flex-col">
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                title="Move it earlier"
                className="px-1 text-[8px] leading-none text-zinc-500 hover:text-white disabled:opacity-20"
              >
                ▲
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === order.length - 1}
                title="Move it later"
                className="px-1 text-[8px] leading-none text-zinc-500 hover:text-white disabled:opacity-20"
              >
                ▼
              </button>
            </div>
          </div>
        ))}
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
        <UploadIcon size={12} /> Upload the three and start trimming
      </button>
      <p className="mt-1.5 text-center text-[9px] text-zinc-600">
        They go in the Persona folder ·{' '}
        <button onClick={onFileAsClips} className="underline decoration-zinc-700 hover:text-zinc-300">
          not a persona — file them as clips
        </button>
      </p>
    </Card>
  );
}

/** Two things about this clip, in this order: what to call it, and what it is
 *  showing. The name is what you go looking for it by, so it is asked for
 *  plainly and required; the context is the sentence the caption writer reads,
 *  and that one can stay empty. */
function ContextStep({ intake, onNext, onCancel }: {
  intake: Intake;
  onNext: (name: string, context: VidContext) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const row = intake.rows[intake.index];
  const file = intake.files[intake.index];
  const ready = !!row && !!name.trim();
  const next = () => { if (ready) onNext(name.trim(), { context: text.trim() }); };

  return (
    <Card
      intake={intake}
      title={`Name ${file?.name ?? 'this clip'}`}
      hint={`${intakeLabel(intake)} · filed in ${intake.folderName}. A short name to find it by, then what it is showing — the caption writer reads that one, so say it the way you would out loud.`}
      onCancel={onCancel}
    >
      <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Name</p>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); next(); } }}
        placeholder="ronaldo search"
        maxLength={80}
        className="w-full rounded border border-zinc-700 bg-black px-2 py-1.5 text-[11px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-400"
      />

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
        {row
          ? <>Edit this clip <ArrowRightIcon size={12} /></>
          : <><SpinnerIcon size={12} className="animate-spin" /> Uploading…</>}
      </button>
      <p className="mt-1.5 text-center text-[9px] text-zinc-600">
        {row
          ? 'Enter opens the editor · a name is all it needs'
          : intake.busy
            ? 'You can write while it uploads'
            : 'That upload stopped — the reason is in the list on the left. Close this and drop it again.'}
      </p>
    </Card>
  );
}

/** The run is on a clip whose upload hasn't landed yet — the editor opens the
 *  moment it does. */
function WaitStep({ intake, onCancel }: { intake: Intake; onCancel: () => void }) {
  const file = intake.files[intake.index];
  return (
    <Card
      intake={intake}
      title={intake.busy ? `Uploading ${intakeLabel(intake)}` : `${intakeLabel(intake)} didn't upload`}
      hint={intake.busy
        ? 'The editor opens as soon as this one is up — the bar on the left has the detail.'
        : 'The reason is in the upload list on the left. Close this and drop it again.'}
      onCancel={onCancel}
    >
      <div className="flex items-center gap-2 text-[11px] text-zinc-300">
        {intake.busy && <SpinnerIcon size={13} className="animate-spin" />}
        <span className="min-w-0 flex-1 truncate">{file?.name}</span>
      </div>
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
        <VideoIcon size={26} className="text-emerald-500" />
        <p className="mt-3 max-w-[420px] text-[13px] font-semibold text-zinc-100">
          {intake.mode === 'persona'
            ? `"${intake.personaName}" is built — all three clips trimmed and saved.`
            : `${intake.files.length > 1 ? `All ${intake.files.length} clips are` : 'That clip is'} saved in ${intake.folderName}.`}
        </p>
        <p className="mt-1 text-[11px] text-zinc-500">
          {intake.mode === 'persona'
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
          <>{intakeLabel(intake)} — filed in {intake.folderName}. Cut it, lay the keys over it, then save.</>
        )}
      </p>
      {intake.busy && (
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-zinc-500">
          <SpinnerIcon size={10} className="animate-spin" /> uploading the rest
        </span>
      )}
      <button
        onClick={onSkip}
        title="Leave this clip as it is and move on"
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
