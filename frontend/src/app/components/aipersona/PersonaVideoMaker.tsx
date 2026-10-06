'use client';

// "Make persona video": turn a character's videos into a persona video in
// Vids, without leaving the character's page.
//
// The words (lib/vids-persona-folders has them in full): in Vids a persona is
// a person, and a persona video is one video of them — which the code still
// calls a VidPersona, and "the persona" in the notes below. It is three clips
// that travel together — Start, Top A and Top B. Here they are the start, the
// middle and the end:
//
//   pick   one of this character's videos for each. The same video can fill
//          two of them, or all three; it is edited separately each time.
//   edit   Edit walks the three in order, each open in Vids' own clip editor
//          (components/vids/VidsClipEditor) in the mode that offers the in and
//          out points, Cut and Auto cut and nothing else. Approving a part
//          moves straight on to the next: the part is rendered and saved to
//          Vids behind it, one at a time, and the strip at the top says how
//          each is getting on. Nothing is waited for until the last part is
//          approved, and then only for whatever is still going up.
//
// A video that has been edited here before — earlier in this run, for another
// part, or the last time a persona was made from it — asks first: use the
// previous edits and save, or edit it again. The edits are remembered per
// video in this browser (EDITS_KEY), along with the clip in Vids that edit was
// saved as. The same video with the same edit is the same footage, so a part
// that reuses one is not rendered or sent up again: the clip already in Vids
// is copied there (api/vids/videos/:id/copy), and only if it has since been
// deleted or re-edited is the part made afresh.
//
// The persona is made with the first part saved, in the folder under Vids'
// Persona folder that holds this character's personas (lib/vids-persona-
// folders) — made here if there isn't one — and on for the clippers unless the
// box says otherwise. Each part goes up the way Vids' own intake files one:
// the render, with the video it was cut from and the edit kept beside it, so
// the part can be opened in Vids later and edited again from the original.
//
// Two things Vids asks of a new persona are answered here rather than asked:
// it is made not degen (the 💀 on its row in Vids switches that), and with no
// context (right-click it in Vids to give it one).

import { useEffect, useRef, useState } from 'react';
import { SpinnerIcon } from '@/lib/icons';
import { copyVideo, createFolder, createPersona, deleteVideo, ensureFolder, listLibrary, updatePersona, uploadVideo } from '@/lib/vids-client';
import { PERSONA_FOLDER } from '@/lib/vidsPlan';
import { fromStoredEdit, renderEditedClip } from '@/lib/vidsEdit';
import { personaFolders } from '@/lib/vids-persona-folders';
import {
  PERSONA_PARTS, PERSONA_PART_LABEL, cleanEdit, type VidEdit, type VidFolder, type VidPersona, type VidRow,
} from '@/lib/vids-types';
import { MAX_NAME_CHARS, type Persona, type PersonaVideo } from '@/lib/aipersona/types';
import { VidsClipEditor, type ClipSaveJob } from '../vids/VidsClipEditor';
import { FIELD, GHOST, LABEL, PRIMARY, errorText } from './aipersona-ui';

/** The three parts, in the order they play: what they are called here, and
 *  where each sits in a build. PERSONA_PARTS has the same three in the same
 *  order under Vids' names. */
const PARTS = [
  { label: 'Start', hint: 'full screen, plays first' },
  { label: 'Middle', hint: 'top half, through the intro and the trade' },
  { label: 'End', hint: 'top half, over the ending' },
] as const;

type Picks = (PersonaVideo | null)[];

/** A part being edited: a row standing in for the clip it will become, the
 *  shape Vids' editor takes, playing off the bytes fetched for it. */
type LocalRow = VidRow & { file: File };

function localRow(file: File, name: string): LocalRow {
  return {
    file,
    id: `local:${crypto.randomUUID()}`,
    folderId: null,
    name,
    storagePath: '',
    thumbPath: null,
    mimeType: file.type || 'video/mp4',
    sizeBytes: file.size,
    duration: null,
    width: null,
    height: null,
    createdAt: new Date().toISOString(),
    url: URL.createObjectURL(file),
    thumbUrl: null,
    context: '',
    marks: [],
    // The video's own sound is kept: the editor opens a clip that says it has
    // sound un-muted, and saves it that way.
    hasSfx: true,
    sourcePath: null,
    sourceUrl: null,
    edit: null,
    clipable: false,
    theme: null,
  };
}

// ── The edits a video was last given ─────────────────────────────────────────

const EDITS_KEY = 'aipersona-part-edits-v1';
/** A video's last edit, the length of the video its times are on, and — once
 *  it has been saved — the clip in Vids that edit was rendered into. */
interface Remembered { edit: VidEdit; duration: number; clipId?: string }

/** The same video with the same edit renders to the same footage. */
const editKey = (videoId: string, edit: VidEdit | null) => videoId + '|' + JSON.stringify(edit);

function loadEdits(): Record<string, Remembered> {
  try {
    const raw = JSON.parse(localStorage.getItem(EDITS_KEY) ?? '{}') as Record<string, Partial<Remembered>>;
    const out: Record<string, Remembered> = {};
    for (const [id, r] of Object.entries(raw)) {
      const edit = cleanEdit(r?.edit);
      if (edit && typeof r?.duration === 'number' && r.duration > 0) out[id] = { edit, duration: r.duration, ...(typeof r.clipId === 'string' ? { clipId: r.clipId } : {}) };
    }
    return out;
  } catch {
    return {};
  }
}

function storeEdits(edits: Record<string, Remembered>) {
  try { localStorage.setItem(EDITS_KEY, JSON.stringify(edits)); } catch { /* remembered for this page only */ }
}

// ── A part on its way to Vids ─────────────────────────────────────────────────

/** waiting for the part before it, rendering, going up — or being copied from
 *  a clip already in Vids — there, or not. */
type Stage = 'waiting' | 'rendering' | 'uploading' | 'copying' | 'saved' | 'failed';
interface PartSave { stage: Stage; frac: number; error: string; job: ClipSaveJob }

const stageText = (s: PartSave) =>
  s.stage === 'saved' ? 'saved'
    : s.stage === 'failed' ? 'not saved'
    : s.stage === 'waiting' ? 'waiting'
    : s.stage === 'copying' ? 'copying'
    : `${s.stage === 'rendering' ? 'rendering' : 'saving'} ${Math.round(s.frac * 100)}%`;

/** The folder choice for one that does not exist yet, and for none. */
const NEW_FOLDER = '__new__';
const NO_FOLDER = '__none__';

function Poster({ video, className }: { video: PersonaVideo; className: string }) {
  return video.frameUrl
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={video.frameUrl} alt="" draggable={false} className={className} />
    : <video src={video.url} muted playsInline preload="metadata" className={className} />;
}

export function PersonaVideoMaker({ persona, onClose }: { persona: Persona; onClose: () => void }) {
  // A character with one video has only one way to fill the three.
  const [picks, setPicks] = useState<Picks>(() => PARTS.map(() => (persona.videos.length === 1 ? persona.videos[0] : null)));
  /** The part the next video pressed will fill. */
  const [at, setAt] = useState(0);
  /** The persona's name, once it has been typed; until then it follows the picks. */
  const [typed, setTyped] = useState<string | null>(null);
  /** Whether the clippers get it. On unless the box is cleared. */
  const [clipable, setClipable] = useState(true);
  /** The folders in Vids a persona can go in — one per person. Null while
   *  they are being read. */
  const [folders, setFolders] = useState<VidFolder[] | null>(null);
  /** The folder chosen by hand; until then, this character's own. */
  const [folderPicked, setFolderPicked] = useState<string | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);
  const [error, setError] = useState('');

  /** The three parts open for editing, once Edit has fetched them. */
  const [rows, setRows] = useState<LocalRow[] | null>(null);
  /** Which part the editor is on; past the last, they have all been approved. */
  const [index, setIndex] = useState(0);
  /** How each approved part's save is getting on. */
  const [saves, setSaves] = useState<(PartSave | null)[]>(() => PARTS.map(() => null));
  const [made, setMade] = useState<VidPersona | null>(null);
  /** The edit each video was last given, by the video's id. */
  const [edits, setEdits] = useState<Record<string, Remembered>>(loadEdits);
  /** The parts whose "use the previous edits?" has been answered with no. */
  const [asked, setAsked] = useState<ReadonlySet<number>>(new Set());

  // Read by the saves, which run one after another and outlive the render
  // that started them.
  const madeRef = useRef<VidPersona | null>(null);
  const clipFolderRef = useRef<string | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  /** What has been rendered in this run, by video and edit — the same two
   *  give the same bytes, so a part that reuses them is not rendered again. */
  const rendered = useRef(new Map<string, Blob>());
  /** The clip in Vids each video-and-edit has already been saved as, in this
   *  run or an earlier one: a part that reuses them is copied from it there,
   *  with nothing rendered or sent up. */
  const [clips] = useState(() => new Map(Object.entries(loadEdits()).flatMap(([id, r]) => (r.clipId ? [[editKey(id, r.edit), r.clipId] as const] : []))));

  // The parts play from object URLs, let go when the page is.
  const urls = useRef<string[]>([]);
  useEffect(() => () => { for (const u of urls.current) URL.revokeObjectURL(u); }, []);

  useEffect(() => {
    listLibrary().then(
      (lib) => setFolders(personaFolders(lib.folders)),
      () => setFolders([]),
    );
  }, []);

  /** This character's folder in Vids, if there is one by its name. */
  const own = folders?.find((f) => f.name.trim().toLowerCase() === persona.name.trim().toLowerCase()) ?? null;
  const folderChoice = folderPicked ?? (own ? own.id : NEW_FOLDER);
  const folderName = folderChoice === NEW_FOLDER ? persona.name
    : folderChoice === NO_FOLDER ? null
    : folders?.find((f) => f.id === folderChoice)?.name ?? null;

  // The folder says whose it is, so the name is just what he is doing.
  const name = typed ?? (picks[0]?.sceneName ?? '').slice(0, MAX_NAME_CHARS);
  const ready = picks.every(Boolean) && !!name.trim() && folders !== null;
  const busy = fetching !== null;

  function choose(video: PersonaVideo) {
    const next = picks.map((p, i) => (i === at ? video : p));
    setPicks(next);
    // On to the next part still empty, if there is one.
    const after = next.findIndex((p, i) => !p && i > at);
    const any = next.findIndex((p) => !p);
    setAt(after >= 0 ? after : any >= 0 ? any : at);
  }

  /** Fetch the picked videos and open the first in the editor. A video picked
   *  for more than one part is fetched once, but each part gets a File and a
   *  row of its own — they are edited, and saved, separately. */
  async function edit() {
    if (!ready || busy) return;
    setError('');
    try {
      const wanted = [...new Map(picks.map((p) => [p!.id, p!])).values()];
      const blobs = new Map<string, Blob>();
      for (const [i, video] of wanted.entries()) {
        setFetching(wanted.length > 1 ? `Getting the videos… ${i + 1} of ${wanted.length}` : 'Getting the video…');
        const res = await fetch(video.url);
        if (!res.ok) throw new Error(`"${video.sceneName}" could not be fetched (${res.status}).`);
        blobs.set(video.id, await res.blob());
      }
      const opened = picks.map((p, i) => {
        const blob = blobs.get(p!.id)!;
        const file = new File([blob], `${p!.sceneName}.mp4`, { type: blob.type || 'video/mp4' });
        return localRow(file, `${name.trim()} — ${PERSONA_PART_LABEL[PERSONA_PARTS[i]]}`);
      });
      urls.current.push(...opened.map((r) => r.url));
      setRows(opened);
      setIndex(0);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setFetching(null);
    }
  }

  const patchSave = (i: number, patch: Partial<PartSave>) =>
    setSaves((prev) => prev.map((s, n) => (n === i && s ? { ...s, ...patch } : s)));

  /** The folder the persona is made in: the one chosen, made now if it is the
   *  character's own and not there yet. */
  async function personaFolder(rootId: string): Promise<string | null> {
    if (folderChoice === NO_FOLDER) return null;
    if (folderChoice !== NEW_FOLDER) return folderChoice;
    return (await createFolder(persona.name.trim().slice(0, 120), rootId)).id;
  }

  /** Note the clip a video's edit was saved as, for the next part or the next
   *  run that uses the same edit. */
  function remember(videoId: string, key: string, clipId: string) {
    clips.set(key, clipId);
    setEdits((prev) => {
      const r = prev[videoId];
      if (!r || editKey(videoId, r.edit) !== key) return prev;
      const next = { ...prev, [videoId]: { ...r, clipId } };
      storeEdits(next);
      return next;
    });
  }

  /** Save one approved part: render its edit (unless this run already has),
   *  put it in Vids' Persona folder, and give it to the persona — which is
   *  made here if this is the first part to land. */
  async function save(i: number, job: ClipSaveJob, row: LocalRow, videoId: string) {
    try {
      const key = editKey(videoId, job.edit);
      const rootId = (clipFolderRef.current ??= (await ensureFolder(PERSONA_FOLDER)).id);
      // Made before with this very edit: take that clip rather than make it
      // again. One that has since been deleted from Vids is made afresh.
      let clip: VidRow | null = null;
      const have = job.render ? clips.get(key) : undefined;
      if (have) {
        patchSave(i, { stage: 'copying', frac: 0.5 });
        clip = await copyVideo(have, job.name, rootId).catch(() => null);
        // Edited again in Vids since: it is no longer this edit's footage.
        if (clip && JSON.stringify(clip.edit) !== JSON.stringify(cleanEdit(job.edit))) {
          await deleteVideo(clip.id).catch(() => {});
          clip = null;
        }
        if (!clip) clips.delete(key);
      }
      let blob: Blob | null = null;
      if (!clip && job.render) {
        blob = rendered.current.get(key) ?? null;
        if (!blob) {
          patchSave(i, { stage: 'rendering', frac: 0 });
          blob = await job.render((frac) => patchSave(i, { frac }));
          rendered.current.set(key, blob);
        }
      }
      if (!clip) {
        patchSave(i, { stage: 'uploading', frac: 0 });
        clip = await uploadVideo(blob ?? row.file, {
          name: job.name,
          folderId: rootId,
          marks: job.marks,
          hasSfx: job.hasSfx,
          ...(blob ? { source: row.file, sourceName: row.file.name, edit: job.edit } : {}),
          onProgress: (frac) => patchSave(i, { frac }),
        });
        if (blob) remember(videoId, key, clip.id);
      }
      const part = { [PERSONA_PARTS[i]]: clip.id };
      madeRef.current = madeRef.current
        ? await updatePersona(madeRef.current.id, part)
        // Not degen; whose it is and whether the clippers get it as chosen.
        : await createPersona(name.trim(), false, { ...part, folderId: await personaFolder(rootId), clipable });
      setMade(madeRef.current);
      patchSave(i, { stage: 'saved', frac: 1 });
    } catch (err) {
      patchSave(i, { stage: 'failed', error: errorText(err) });
    }
  }

  /** Put a part's save in line behind the ones before it. */
  function queue(i: number, job: ClipSaveJob) {
    const row = rows?.[i];
    const video = picks[i];
    if (!row || !video) return;
    setSaves((prev) => prev.map((s, n) => (n === i ? { stage: 'waiting', frac: 0, error: '', job } : s)));
    chain.current = chain.current.then(() => save(i, job, row, video.id));
  }

  /** A part is approved: its save goes behind, and the next part opens now. An
   *  edit that changed the footage is remembered for the video it was made on. */
  function approve(job: ClipSaveJob) {
    const i = rows?.findIndex((r) => r.id === job.videoId) ?? -1;
    const video = picks[i];
    if (i < 0 || !video) return;
    if (job.render && job.edit && job.duration > 0) {
      const key = editKey(video.id, job.edit);
      const clipId = clips.get(key);
      const next = { ...edits, [video.id]: { edit: job.edit, duration: job.duration, ...(clipId ? { clipId } : {}) } };
      setEdits(next);
      storeEdits(next);
    }
    queue(i, job);
    setIndex(i + 1);
  }

  /** "Use previous edits and save": the part takes the edit its video was
   *  given before, without the editor, and the run moves on. */
  function reusePrevious(i: number, prior: Remembered) {
    const row = rows?.[i];
    if (!row) return;
    const clipEdit = fromStoredEdit(prior.edit);
    approve({
      videoId: row.id,
      name: row.name,
      render: (onProgress, signal) => renderEditedClip({
        url: row.url, file: row.file, edit: clipEdit, duration: prior.duration, onProgress, signal,
      }),
      hasSfx: !prior.edit.muted || prior.edit.sfx.length > 0,
      marks: [],
      edit: prior.edit,
      duration: prior.duration,
    });
  }

  const editing = rows && index < rows.length ? rows[index] : null;
  const allApproved = !!rows && index >= rows.length;
  const done = allApproved && saves.every((s) => s?.stage === 'saved');
  const going = saves.some((s) => s && s.stage !== 'saved' && s.stage !== 'failed');
  /** The edit the video on screen was given before, until it is declined. */
  const prior = editing && !asked.has(index) ? edits[picks[index]?.id ?? ''] ?? null : null;

  /** Leave. Parts already approved are saved, or still on their way and will
   *  be; the rest were never anywhere but this page, so a run with any left
   *  asks first. */
  function leave() {
    const left = rows ? rows.length - index : 0;
    if (left > 0 && !window.confirm(
      index > 0
        ? `Stop here? ${left === 1 ? 'The last part has' : `${left} parts have`} not been approved. What you approved stays in Vids${going ? ' (and goes on saving)' : ''}.`
        : 'Stop here? Nothing has been approved yet, so nothing has been saved to Vids.',
    )) return;
    if (!left && going && !window.confirm('The parts are still saving. Leave anyway? They go on saving behind this page.')) return;
    onClose();
  }

  return (
    <div className="vids-scroll flex h-full flex-col bg-black text-white">
      <div className="flex shrink-0 items-center gap-5 border-b border-zinc-900 px-6 py-3">
        <div className="min-w-0">
          <button type="button" onClick={leave} className="text-xs text-zinc-500 transition-colors hover:text-white">← {persona.name}</button>
          <h1 className="truncate text-lg font-semibold">Make persona video</h1>
        </div>
        {rows && (
          <ol className="flex items-center gap-2 text-[11px] uppercase tracking-wide">
            {PARTS.map((part, i) => {
              const s = saves[i];
              const tone = i === index ? 'text-white'
                : !s ? 'text-zinc-600'
                : s.stage === 'saved' ? 'text-emerald-400'
                : s.stage === 'failed' ? 'text-red-400'
                : 'text-sky-300';
              return (
                <li key={part.label} className={`flex items-center gap-2 ${tone}`} title={s?.error || undefined}>
                  {i > 0 && <span className="text-zinc-800">—</span>}
                  {s?.stage === 'saved' ? '✓' : i + 1} {part.label}
                  {s && s.stage !== 'saved' && <span className="normal-case tracking-normal tabular-nums">· {stageText(s)}</span>}
                </li>
              );
            })}
          </ol>
        )}
        <span className="flex-1" />
        {rows && (
          <span className="max-w-[260px] truncate text-xs text-zinc-500" title={name.trim()}>
            {folderName ? `${folderName} · ` : ''}{made?.name ?? name.trim()}
          </span>
        )}
      </div>

      {editing ? (
        <div className="relative flex min-h-0 flex-1">
          <VidsClipEditor
            key={editing.id}
            video={editing}
            // Never called: every save here is handed over (onSaveLater).
            onSave={async () => {}}
            onSaveLater={approve}
            active={!prior}
            onClose={leave}
            contextOwner={null}
            onContextChange={() => {}}
            onMarksChange={() => {}}
            mode="cut"
            saveLabel={index >= rows!.length - 1 ? 'Approve · finish' : `Approve · on to the ${PARTS[index + 1].label.toLowerCase()}`}
            hint={`the ${PARTS[index].label.toLowerCase()} — hover the bar to scrub · drag the green ends to trim · drag across to select a stretch, then cut it`}
          />
          {prior && (
            <div className="absolute inset-0 z-20 grid place-items-center bg-black/75 p-6">
              <div className="grid w-full max-w-[420px] gap-3 rounded-lg border border-zinc-700 bg-zinc-950 p-5 shadow-2xl">
                <p className="text-sm font-semibold">You have edited “{picks[index]?.sceneName}” before</p>
                <p className="text-xs leading-relaxed text-zinc-400">
                  Use the same trim and cuts for the {PARTS[index].label.toLowerCase()}, and go straight on
                  {index >= rows!.length - 1 ? ' to finish' : ` to the ${PARTS[index + 1].label.toLowerCase()}`}?
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => reusePrevious(index, prior)} className={`${PRIMARY} flex-1`}>
                    Use previous edits and save
                  </button>
                  <button
                    type="button"
                    onClick={() => setAsked((prev) => new Set(prev).add(index))}
                    className={GHOST}
                  >
                    Edit it again
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : allApproved ? (
        <div className="grid min-h-0 flex-1 place-items-center px-6">
          <div className="grid w-full max-w-[460px] gap-3 text-center">
            {done ? (
              <>
                <p className="text-lg font-semibold text-emerald-400">
                  “{made?.name}” is {folderName ? `one of ${folderName}’s persona videos` : 'a persona video'} in Vids
                </p>
                <p className="text-sm leading-relaxed text-zinc-400">
                  Its start, middle and end are saved{made?.clipable ? ', and it is on for clipping — so it is there to pick in Vids 2 and on the clipper page' : '. It is off for the clippers — switch it on in Vids > Clippers'}.
                  To change a part later, open it in Vids.
                </p>
              </>
            ) : (
              <>
                <p className="text-lg font-semibold">{going ? 'Saving to Vids…' : 'Not everything was saved'}</p>
                <div className="grid gap-2 text-left">
                  {PARTS.map((part, i) => {
                    const s = saves[i];
                    if (!s) return null;
                    return (
                      <div key={part.label} className="rounded-md border border-zinc-800 px-3 py-2">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="flex-1 font-semibold">{part.label}</span>
                          <span className={`tabular-nums ${s.stage === 'saved' ? 'text-emerald-400' : s.stage === 'failed' ? 'text-red-400' : 'text-zinc-400'}`}>
                            {stageText(s)}
                          </span>
                          {s.stage === 'failed' && (
                            <button type="button" onClick={() => queue(i, s.job)} className="text-xs text-white underline decoration-zinc-600">
                              Try again
                            </button>
                          )}
                        </div>
                        {s.stage === 'failed' ? (
                          <p className="mt-1 text-[11px] text-red-400">{s.error}</p>
                        ) : s.stage !== 'saved' && (
                          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-800">
                            <div className="h-full bg-white transition-[width]" style={{ width: `${s.stage === 'waiting' ? 0 : Math.max(4, s.frac * 100)}%` }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            <button type="button" onClick={done ? onClose : leave} className={`${done ? PRIMARY : GHOST} mx-auto mt-2`}>
              Back to {persona.name}
            </button>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="grid gap-6">
            <p className="max-w-[620px] text-xs leading-relaxed text-zinc-500">
              Pick a video for the start, the middle and the end — the same one can fill more than one. Edit then takes them one at a time:
              trim it, cut it, approve it. Approving moves straight on to the next while that one saves to Vids behind it, and the three together are one persona video there.
            </p>

            <div className="grid max-w-[720px] grid-cols-3 gap-3">
              {PARTS.map((part, i) => {
                const pick = picks[i];
                const active = at === i;
                return (
                  <button
                    key={part.label}
                    type="button"
                    onClick={() => setAt(i)}
                    disabled={busy}
                    aria-pressed={active}
                    className={`overflow-hidden rounded-lg border text-left transition-colors ${
                      active ? 'border-emerald-400' : 'border-zinc-800 hover:border-zinc-600'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2 px-3 py-2">
                      <span className={`text-sm font-semibold ${active ? 'text-emerald-400' : 'text-white'}`}>{part.label}</span>
                      <span className="text-[10px] uppercase tracking-wide text-zinc-600">{PERSONA_PART_LABEL[PERSONA_PARTS[i]]} in Vids</span>
                    </div>
                    <div className="grid aspect-[9/16] place-items-center bg-zinc-950">
                      {pick
                        ? <Poster video={pick} className="h-full w-full object-cover" />
                        : <span className="px-3 text-center text-[11px] text-zinc-600">{active ? 'pick a video below' : 'empty'}</span>}
                    </div>
                    <div className="px-3 py-2">
                      <span className="block truncate text-xs text-zinc-300">{pick ? pick.sceneName : '—'}</span>
                      <span className="block text-[10px] text-zinc-600">{part.hint}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div>
              <h2 className="mb-3 text-[11px] uppercase tracking-wide text-zinc-500">
                {persona.name}&apos;s videos · press one to use it for the {PARTS[at].label.toLowerCase()}
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] items-start gap-3">
                {persona.videos.map((video) => {
                  const used = PARTS.filter((_, i) => picks[i]?.id === video.id).map((p) => p.label);
                  return (
                    <button
                      key={video.id}
                      type="button"
                      onClick={() => choose(video)}
                      disabled={busy}
                      className={`overflow-hidden rounded-lg border text-left transition-colors ${
                        used.length ? 'border-zinc-500' : 'border-zinc-800 hover:border-zinc-600'
                      }`}
                    >
                      <div className="relative aspect-[9/16] bg-zinc-950">
                        <Poster video={video} className="h-full w-full object-cover" />
                        {used.length > 0 && (
                          <span className="absolute left-1.5 top-1.5 rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold text-black">
                            {used.join(' · ')}
                          </span>
                        )}
                        {edits[video.id] && (
                          <span className="absolute right-1.5 top-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[10px] text-zinc-300" title="Edited before — its trim and cuts can be used again">
                            edited
                          </span>
                        )}
                      </div>
                      <span className="block truncate px-2.5 py-2 text-xs text-zinc-300">{video.sceneName}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid max-w-[720px] gap-2.5">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <label className={`grid gap-1.5 ${LABEL}`}>
                  Persona in Vids — whose video it is
                  <select
                    value={folderChoice}
                    onChange={(e) => setFolderPicked(e.target.value)}
                    disabled={busy || folders === null}
                    className={`${FIELD} h-9 normal-case tracking-normal`}
                  >
                    {!own && <option value={NEW_FOLDER}>New persona “{persona.name}”</option>}
                    {(folders ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    <option value={NO_FOLDER}>No persona</option>
                  </select>
                </label>
                <label className={`grid gap-1.5 ${LABEL}`}>
                  Video name — what he is doing
                  <input
                    value={name}
                    onChange={(e) => setTyped(e.target.value.slice(0, MAX_NAME_CHARS))}
                    disabled={busy}
                    className={`${FIELD} h-9 normal-case tracking-normal`}
                  />
                </label>
              </div>
              <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={clipable}
                  onChange={(e) => setClipable(e.target.checked)}
                  disabled={busy}
                  className="h-3.5 w-3.5 accent-emerald-500"
                />
                Available to the clippers
              </label>
              {error && <p className="text-xs text-red-400">{error}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={edit} disabled={!ready || busy} className={`${PRIMARY} flex-1`}>
                  {busy && <SpinnerIcon size={13} className="animate-spin" />}
                  {fetching ?? 'Edit'}
                </button>
                <button type="button" onClick={onClose} disabled={busy} className={GHOST}>Cancel</button>
              </div>
              <p className="text-[11px] text-zinc-600">
                {picks.every(Boolean)
                  ? 'Nothing is saved until a part is approved.'
                  : 'Fill the start, the middle and the end to go on.'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
