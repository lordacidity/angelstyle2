'use client';

// A scene, after Go. The personas on the right each show what was made for
// them; the panel on the left moves the scene through its four stages:
//
//   frames  every persona's character first frame is made and looked over.
//           Any of them can be regenerated, with the prompt edited for just
//           that redo. When they are all right: Approved.
//   prompt  the Kling prompt is written. It starts as "A man [what he is
//           doing]" and Go stays off until the brackets have been replaced.
//   videos  Kling runs for every persona; same regenerate, same per-redo
//           prompt. When they are all right: Approve all.
//   done    the videos are saved to the personas.
//
// The scene lives on the server, and polling it is what moves the running jobs
// along — so this can be closed and reopened at any point without losing or
// re-paying for anything.

import { useEffect, useRef, useState } from 'react';
import { CloseIcon, DownloadIcon, SpinnerIcon } from '@/lib/icons';
import {
  approveScene, deleteScene, deleteTake, downloadUrl, fileSlug, getScene, redoFrame, redoVideo, setSceneStage, startVideos,
} from '@/lib/aipersona/client';
import {
  DEFAULT_MOTION_PROMPT, MAX_PROMPT_CHARS, hasBlank, type Scene, type SceneJob, type SceneStage, type SceneTake,
} from '@/lib/aipersona/types';
import { ConfirmButton, FIELD, GHOST, LABEL, PRIMARY, Split, errorText } from './aipersona-ui';

// fal reports nothing finer than a queue place, so there is no point asking faster.
const POLL_MS = 3000;

type Kind = 'frame' | 'video';
const KIND_AT: Record<SceneStage, Kind> = { frames: 'frame', prompt: 'frame', videos: 'video', done: 'video' };
const STEPS: [SceneStage, string][] = [['frames', 'First frames'], ['prompt', 'Prompt'], ['videos', 'Videos']];

function runningLabel(job: SceneJob, kind: Kind): string {
  if (job.queue != null) return `in queue #${job.queue}`;
  if (job.working) return kind === 'frame' ? 'drawing' : 'generating';
  return 'starting';
}

// ── One persona's card ───────────────────────────────────────────────────────

function TakeCard({ scene, take, kind, locked, canRemove, onRedo, onRemove }: {
  scene: Scene;
  take: SceneTake;
  kind: Kind;
  /** The scene is finished: nothing here can be redone. */
  locked: boolean;
  canRemove: boolean;
  onRedo: (take: SceneTake, prompt: string) => Promise<void>;
  onRemove: (take: SceneTake) => Promise<void>;
}) {
  const job = take[kind];
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const running = job.status === 'running';
  const done = job.status === 'done' && !!job.url;
  // What stands in while there is nothing of its own to show.
  const backdrop = kind === 'video' ? take.frame.url ?? take.photoUrl : take.photoUrl;
  const blank = kind === 'video' && hasBlank(prompt);
  // A frame is a PNG unless it had to be re-saved to fit Kling — see fitForKling.
  const extension = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(job.url ?? '')?.[1] ?? (kind === 'frame' ? 'png' : 'mp4');
  const fileName = `${fileSlug(scene.name)}-${fileSlug(take.personaName)}.${extension}`;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
      setOpen(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`overflow-hidden rounded-lg border bg-zinc-950 ${job.status === 'error' ? 'border-red-500/60' : running ? 'border-zinc-600' : 'border-zinc-800'}`}>
      <div className="relative bg-black" style={{ aspectRatio: `${scene.width || 9} / ${scene.height || 16}` }}>
        {done && kind === 'video' ? (
          <video src={job.url!} poster={take.frame.url ?? undefined} controls playsInline loop className="h-full w-full object-contain" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={done ? job.url! : backdrop} alt="" className={`h-full w-full ${done ? 'object-contain' : 'object-cover opacity-25'}`} />
        )}
        {running && (
          <div className="absolute inset-0 grid place-items-center px-4 text-center">
            <div className="grid justify-items-center gap-2">
              <SpinnerIcon size={20} className="animate-spin text-white" />
              <span className="text-[11px] uppercase tracking-wider text-zinc-300">{runningLabel(job, kind)}</span>
              {job.note && <span className="text-[11px] text-amber-400">Couldn&apos;t check on it just now: {job.note}</span>}
            </div>
          </div>
        )}
        {job.status === 'error' && (
          <div className="absolute inset-0 overflow-y-auto p-3">
            <p className="select-text break-words text-xs leading-relaxed text-red-400">{job.error || 'It failed, and fal did not say why.'}</p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-3 py-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={take.thumbUrl} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
        <span className="min-w-0 flex-1 truncate text-sm">{take.personaName}</span>
        {done && (
          <a href={downloadUrl(job.url!, fileName)} download={fileName} title="Download" className="text-zinc-500 transition-colors hover:text-white">
            <DownloadIcon size={14} />
          </a>
        )}
        {!locked && !running && (
          <button
            type="button"
            onClick={() => {
              setPrompt(job.prompt || (kind === 'frame' ? scene.framePrompt : scene.videoPrompt));
              setError('');
              setOpen((o) => !o);
            }}
            className="text-xs text-zinc-400 transition-colors hover:text-white"
          >
            {job.status === 'error' ? 'Try again' : 'Regenerate'}
          </button>
        )}
        {canRemove && (
          <ConfirmButton
            onConfirm={() => run(() => onRemove(take))}
            disabled={busy}
            armedLabel="Remove?"
            className="border border-transparent text-xs text-zinc-600 transition-colors hover:text-white"
          >
            <span title="Take this character out of the scene"><CloseIcon size={13} /></span>
          </ConfirmButton>
        )}
      </div>

      {open && !locked && !running && (
        <div className="grid gap-2 border-t border-zinc-900 px-3 py-3">
          <span className={LABEL}>Prompt for this redo only</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value.slice(0, MAX_PROMPT_CHARS))}
            disabled={busy}
            autoFocus
            className={`${FIELD} min-h-[110px] resize-y py-2 text-xs leading-relaxed`}
          />
          {blank && <p className="text-[11px] text-amber-400">Replace the brackets with what he is doing.</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => run(() => onRedo(take, prompt.trim()))} disabled={busy || !prompt.trim() || blank} className={`${PRIMARY} h-8 flex-1`}>
              {busy && <SpinnerIcon size={12} className="animate-spin" />}
              Regenerate
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={busy} className={`${GHOST} h-8`}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="border-t border-zinc-900 px-3 py-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}

// ── The scene ────────────────────────────────────────────────────────────────

/** How a scene stands, for its tab: still generating, waiting on you,
 *  approved, or stuck on an error. */
export type SceneTabState = 'working' | 'ready' | 'done' | 'error';

export function SceneReview({ sceneId, initial, onBack, onChanged, onStatus, onDiscarded }: {
  sceneId: string;
  /** The scene as Go just answered with it, when this is opened straight from Go. */
  initial: Scene | null;
  onBack: () => void;
  /** Something the front screen lists has changed. */
  onChanged: () => void;
  /** Its name and where it stands, whenever either changes — for its tab. */
  onStatus?: (title: string, state: SceneTabState) => void;
  /** It was deleted: close its tab. */
  onDiscarded?: () => void;
}) {
  const [scene, setScene] = useState<Scene | null>(initial);
  const [missing, setMissing] = useState('');
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [acting, setActing] = useState(false);
  const [motionPrompt, setMotionPrompt] = useState(DEFAULT_MOTION_PROMPT);
  const promptBox = useRef<HTMLTextAreaElement>(null);
  // Bumped by everything that changes the scene from here. A poll that was
  // already on its way when that happened is answering an older question, and
  // is dropped rather than allowed to put the old picture back.
  const epoch = useRef(0);

  const loaded = !!scene;
  const polling = scene
    ? scene.takes.some((t) => t.frame.status === 'running' || t.video.status === 'running')
    : !missing;

  useEffect(() => {
    if (!polling) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const asked = epoch.current;
      try {
        const next = await getScene(sceneId);
        if (!live) return;
        if (asked === epoch.current) setScene(next);
        setPollError('');
      } catch (err) {
        if (!live) return;
        if (loaded) setPollError(errorText(err));
        else { setMissing(errorText(err)); return; }
      }
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, loaded ? POLL_MS : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [polling, loaded, sceneId]);

  // Tell the tab where this scene stands.
  const tabTitle = scene?.name ?? 'Scene';
  const tabState: SceneTabState = !scene
    ? (missing ? 'error' : 'working')
    : scene.takes.some((t) => t.frame.status === 'running' || t.video.status === 'running') ? 'working'
    : scene.stage === 'done' ? 'done'
    : scene.takes.some((t) => t.frame.status === 'error' || t.video.status === 'error') ? 'error'
    : 'ready';
  useEffect(() => { onStatus?.(tabTitle, tabState); }, [onStatus, tabTitle, tabState]);

  // On reaching the prompt, put the cursor on the blank that has to be filled in.
  const stage = scene?.stage;
  useEffect(() => {
    const box = promptBox.current;
    if (stage !== 'prompt' || !box) return;
    const from = box.value.indexOf('[');
    const to = box.value.indexOf(']');
    box.focus();
    if (from >= 0 && to > from) box.setSelectionRange(from, to + 1);
  }, [stage]);

  if (!scene) {
    return (
      <Split title="Scene" backLabel="Characters" onBack={onBack} side={missing ? <p className="text-sm text-red-400">{missing}</p> : null}>
        {!missing && <div className="grid h-full place-items-center text-zinc-600"><SpinnerIcon size={22} className="animate-spin" /></div>}
      </Split>
    );
  }

  const kind = KIND_AT[scene.stage];
  const total = scene.takes.length;
  const count = (k: Kind, status: SceneJob['status']) => scene.takes.filter((t) => t[k].status === status).length;
  const framesDone = total > 0 && count('frame', 'done') === total;
  const videosDone = total > 0 && count('video', 'done') === total;
  const blank = hasBlank(motionPrompt);

  /** Run something that answers with the scene as it now stands. */
  async function act(run: () => Promise<Scene>, listed = false) {
    setActing(true);
    setError('');
    try {
      const next = await run();
      epoch.current++;
      setScene(next);
      if (listed) onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setActing(false);
    }
  }

  async function redo(take: SceneTake, prompt: string) {
    const next = await (kind === 'frame' ? redoFrame : redoVideo)(scene!.id, take.id, prompt);
    epoch.current++;
    setScene(next);
  }

  async function remove(take: SceneTake) {
    await deleteTake(take.id);
    epoch.current++;
    setScene((s) => s && { ...s, takes: s.takes.filter((t) => t.id !== take.id) });
    onChanged();
  }

  async function discard() {
    setActing(true);
    setError('');
    try {
      await deleteScene(scene!.id);
      onChanged();
      if (onDiscarded) onDiscarded(); else onBack();
    } catch (err) {
      setError(errorText(err));
      setActing(false);
    }
  }

  const progress = (k: Kind, noun: string) => {
    const failed = count(k, 'error');
    const running = count(k, 'running');
    return `${count(k, 'done')} of ${total} ${noun} ready${running ? ` · ${running} still going` : ''}${failed ? ` · ${failed} failed` : ''}`;
  };

  const side = (
    <div className="grid gap-5">
      <ol className="flex items-center gap-2 text-[11px] uppercase tracking-wide">
        {STEPS.map(([key, label], i) => {
          const here = scene.stage === key;
          const past = STEPS.findIndex(([k]) => k === scene.stage) > i || scene.stage === 'done';
          return (
            <li key={key} className={`flex items-center gap-2 ${here ? 'text-white' : past ? 'text-emerald-400' : 'text-zinc-600'}`}>
              {i > 0 && <span className="text-zinc-800">—</span>}
              {i + 1} {label}
            </li>
          );
        })}
      </ol>

      <div className="grid gap-1.5">
        <span className={LABEL}>The clip · {scene.duration.toFixed(1)}s</span>
        <video src={scene.clipUrl} poster={scene.frameUrl} controls playsInline className="max-h-[34vh] w-full rounded-md border border-zinc-800 bg-black object-contain" />
        <span className="text-[11px] text-zinc-600">It opens on the first frame — the picture every character is drawn into.</span>
      </div>

      {scene.stage === 'frames' && (
        <div className="grid gap-1.5">
          <span className={LABEL}>First-frame prompt</span>
          <p className="text-xs leading-relaxed text-zinc-400">{scene.framePrompt}</p>
        </div>
      )}

      {scene.stage === 'prompt' && (
        <label className={`grid gap-1.5 ${LABEL}`}>
          Video prompt
          <textarea
            ref={promptBox}
            value={motionPrompt}
            onChange={(e) => setMotionPrompt(e.target.value.slice(0, MAX_PROMPT_CHARS))}
            disabled={acting}
            className={`${FIELD} min-h-[110px] resize-y py-2.5 normal-case leading-relaxed tracking-normal`}
          />
          <span className={`normal-case tracking-normal ${blank ? 'text-amber-400' : 'text-zinc-600'}`}>
            {blank
              ? 'Replace the brackets with what he is doing — just a few words. Go stays off until they are gone.'
              : 'Kling moves each character first frame the way the clip moves.'}
          </span>
        </label>
      )}

      {scene.stage === 'videos' && (
        <div className="grid gap-1.5">
          <span className={LABEL}>Video prompt</span>
          <p className="text-xs leading-relaxed text-zinc-400">{scene.videoPrompt}</p>
        </div>
      )}

      {scene.stage === 'done' && (
        <p className="text-sm text-emerald-400">
          Approved. {total === 1 ? 'The video is' : `All ${total} videos are`} saved to {total === 1 ? 'the character' : 'the characters'}.
        </p>
      )}

      {scene.stage !== 'done' && (
        <ConfirmButton onConfirm={discard} disabled={acting} armedLabel="Click again to delete the scene" className="w-fit border border-transparent text-xs text-zinc-600 transition-colors hover:text-white">
          Delete this scene
        </ConfirmButton>
      )}
    </div>
  );

  const footer = (
    <div className="grid gap-2.5">
      {error && <p className="text-xs text-red-400">{error}</p>}
      {pollError && <p className="text-xs text-amber-400">Couldn&apos;t refresh just now: {pollError}</p>}

      {scene.stage === 'frames' && (
        <>
          <p className="text-xs tabular-nums text-zinc-500">{progress('frame', total === 1 ? 'first frame' : 'first frames')}</p>
          <button type="button" onClick={() => act(() => setSceneStage(scene.id, 'prompt'))} disabled={!framesDone || acting} className={PRIMARY}>
            Approved
          </button>
        </>
      )}

      {scene.stage === 'prompt' && (
        <>
          <button type="button" onClick={() => act(() => startVideos(scene.id, motionPrompt.trim()))} disabled={blank || !motionPrompt.trim() || !framesDone || acting} className={PRIMARY}>
            {acting && <SpinnerIcon size={13} className="animate-spin" />}
            Go
          </button>
          <button type="button" onClick={() => act(() => setSceneStage(scene.id, 'frames'))} disabled={acting} className="text-left text-[11px] text-zinc-500 transition-colors hover:text-white">
            ← back to the first frames
          </button>
        </>
      )}

      {scene.stage === 'videos' && (
        <>
          <p className="text-xs tabular-nums text-zinc-500">{progress('video', total === 1 ? 'video' : 'videos')}</p>
          <button type="button" onClick={() => act(() => approveScene(scene.id), true)} disabled={!videosDone || acting} className={PRIMARY}>
            {acting && <SpinnerIcon size={13} className="animate-spin" />}
            Approve all
          </button>
          <p className="text-[11px] text-zinc-600">Kling takes a few minutes a video. You can leave this screen — it keeps going.</p>
        </>
      )}

      {scene.stage === 'done' && (
        <button type="button" onClick={onBack} className={PRIMARY}>Back to the characters</button>
      )}
    </div>
  );

  return (
    <Split title={scene.name} backLabel="Characters" onBack={onBack} side={side} footer={footer}>
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold">{kind === 'frame' ? 'Character first frames' : 'Videos'}</h2>
        <span className="text-xs tabular-nums text-zinc-500">{total} {total === 1 ? 'character' : 'characters'}</span>
      </div>
      {total === 0 ? (
        <p className="text-sm text-zinc-500">Every character has been taken out of this scene.</p>
      ) : (
        <div className={`grid items-start gap-4 ${scene.width > scene.height ? 'grid-cols-[repeat(auto-fill,minmax(340px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(220px,1fr))]'}`}>
          {scene.takes.map((take) => (
            <TakeCard
              key={take.id}
              scene={scene}
              take={take}
              kind={kind}
              locked={scene.stage === 'done'}
              canRemove={scene.stage !== 'done' && total > 1}
              onRedo={redo}
              onRemove={remove}
            />
          ))}
        </div>
      )}
    </Split>
  );
}
