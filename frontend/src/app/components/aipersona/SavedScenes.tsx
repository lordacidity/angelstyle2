'use client';

// Scenes: the saved ones. Drop a video on the left, trim it and speed it up,
// give it a name and the sentence saying what is happening in it — the one the
// Kling prompt opens with, so it never has to be written again — and Save — it is cut and kept, and nothing is sent to fal.
// A saved scene is then there to be made for any character, from that
// character's page ("Make scenes").
//
// On the right they are sorted the way a character's videos are, by name: one
// with "trading" in its name is a Trading scene, one with "end" an End, and
// everything else a Hook. Renaming one moves it.

import { useEffect, useRef, useState } from 'react';
import { SpinnerIcon, UploadIcon } from '@/lib/icons';
import { createSaved, deleteSaved, updateSaved, uploadFile } from '@/lib/aipersona/client';
import {
  MAX_ACTION_CHARS, MAX_CLIP_SECONDS, MAX_NAME_CHARS, MIN_CLIP_SECONDS, SCENE_KINDS, clipSeconds, motionPrompt, sceneKind, type SavedScene,
} from '@/lib/aipersona/types';
import { ClipTrimmer, type Trim } from './ClipTrimmer';
import { NameInput } from './PersonaDetail';
import { ConfirmButton, DropZone, FIELD, LABEL, PRIMARY, Split, errorText } from './aipersona-ui';

const UNTRIMMED: Trim = { start: 0, end: 0, speed: 1 };

/** The sentence on a saved scene, rewritten by typing over it: Enter or
 *  leaving it saves, Escape puts it back. It may be emptied. */
function ActionInput({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (next: string) => void }) {
  const [text, setText] = useState(value);
  return (
    <textarea
      value={text}
      rows={2}
      onChange={(e) => setText(e.target.value.replace(/[[\]\n]/g, '').slice(0, MAX_ACTION_CHARS))}
      onBlur={() => { if (text.trim() !== value) onChange(text.trim()); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === 'Escape') setText(value);
      }}
      disabled={disabled}
      placeholder="What is happening — one sentence"
      title="The sentence the Kling prompt opens with"
      aria-label="What is happening"
      className={`-mx-1 mt-0.5 block w-[calc(100%+0.5rem)] resize-none rounded border bg-transparent px-1 text-[11px] leading-snug outline-none transition-colors placeholder:text-amber-400/80 hover:border-zinc-800 focus:border-zinc-600 ${value ? 'border-transparent text-zinc-400' : 'border-amber-400/30 text-zinc-300'}`}
    />
  );
}

/** One saved scene: its first frame, which plays the clip when pressed. */
function SavedCard({ scene, disabled, onRename, onAction, onDelete }: {
  scene: SavedScene; disabled: boolean; onRename: (next: string) => void; onAction: (next: string) => void; onDelete: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
      {playing ? (
        <video src={scene.clipUrl} controls playsInline loop autoPlay className="max-h-[60vh] w-full bg-black object-contain" />
      ) : (
        <button type="button" onClick={() => setPlaying(true)} title="Play" className="group relative block w-full bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={scene.thumbUrl}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            style={scene.width && scene.height ? { aspectRatio: `${scene.width} / ${scene.height}` } : undefined}
            className="w-full object-contain"
          />
          <span className="absolute inset-0 grid place-items-center opacity-70 transition-opacity group-hover:opacity-100">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white">
              <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor" aria-hidden><path d="M3 1l9 6-9 6z" /></svg>
            </span>
          </span>
        </button>
      )}
      <div className="px-2.5 py-2">
        <NameInput key={scene.name} value={scene.name} max={MAX_NAME_CHARS} disabled={disabled} onRename={onRename} />
        <ActionInput key={scene.action} value={scene.action} disabled={disabled} onChange={onAction} />
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[11px] tabular-nums text-zinc-500">{scene.duration.toFixed(1)}s</span>
          <ConfirmButton
            onConfirm={onDelete}
            disabled={disabled}
            armedLabel="Delete?"
            className="border border-transparent text-[11px] text-zinc-600 transition-colors hover:text-white"
          >
            Delete
          </ConfirmButton>
        </div>
      </div>
    </div>
  );
}

export function SavedScenes({ saved, onBack, onChanged }: {
  saved: SavedScene[];
  onBack: () => void;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  /** The sentence saying what is happening in it. */
  const [action, setAction] = useState('');
  const [video, setVideo] = useState<{ file: File; url: string } | null>(null);
  const [duration, setDuration] = useState(0);
  const [trim, setTrim] = useState<Trim>(UNTRIMMED);
  const [phase, setPhase] = useState<'uploading' | 'cutting' | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  /** A rename or a delete of one already saved is under way. */
  const [editing, setEditing] = useState(false);
  // A Save that fails after the upload keeps what it uploaded, so the next
  // Save with the same file doesn't send it again.
  const uploaded = useRef<{ file: File; path: string } | null>(null);

  const videoUrl = video?.url;
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);

  function pickVideo(file: File) {
    if (!file.type.startsWith('video/')) {
      setError(`A scene is cut from a video — "${file.name}" isn't one.`);
      return;
    }
    setError('');
    setDuration(0);
    setTrim(UNTRIMMED);
    setVideo({ file, url: URL.createObjectURL(file) });
  }

  const seconds = clipSeconds(trim.start, trim.end, trim.speed);
  const cutOk = duration > 0 && seconds >= MIN_CLIP_SECONDS && seconds <= MAX_CLIP_SECONDS;
  const busy = phase !== null;
  const ready = !!name.trim() && !!video && cutOk && !busy;

  async function save() {
    if (!ready || !video) return;
    setError('');
    try {
      setPhase('uploading');
      setProgress(0);
      if (uploaded.current?.file !== video.file) {
        uploaded.current = { file: video.file, path: await uploadFile('source', video.file, setProgress) };
      }
      setPhase('cutting');
      await createSaved({ name: name.trim(), action: action.trim(), sourcePath: uploaded.current.path, start: trim.start, end: trim.end, speed: trim.speed });
      uploaded.current = null;
      await onChanged();
      // Ready for the next one.
      setName('');
      setAction('');
      setVideo(null);
      setDuration(0);
      setTrim(UNTRIMMED);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPhase(null);
    }
  }

  async function edit(action: () => Promise<unknown>) {
    setEditing(true);
    setError('');
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setEditing(false);
    }
  }

  const side = (
    <div className="grid gap-5">
      <label className={`grid gap-1.5 ${LABEL}`}>
        Scene name
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_CHARS))}
          placeholder="Walking into the gym"
          disabled={busy}
          className={`${FIELD} h-9 normal-case tracking-normal`}
        />
        <span className="normal-case tracking-normal text-zinc-600">
          “Trading” in the name makes it a Trading scene, “End” an End. Anything else is a Hook.
          {name.trim() && <> This one: <span className="text-zinc-300">{SCENE_KINDS.find((k) => k.key === sceneKind(name))?.label}</span>.</>}
        </span>
      </label>

      <div className="grid gap-1.5">
        <div className={`flex items-center justify-between ${LABEL}`}>
          Video
          {video && !busy && (
            <DropZone accept="video/*" onFile={pickVideo} label="Use a different video" className="!border-0 !bg-transparent">
              <span className="normal-case tracking-normal text-zinc-500 transition-colors hover:text-white">use a different one</span>
            </DropZone>
          )}
        </div>
        {video ? (
          <ClipTrimmer
            key={video.url}
            url={video.url}
            duration={duration}
            trim={trim}
            onChange={setTrim}
            onLoaded={(d) => { setDuration(d); setTrim({ start: 0, end: d, speed: 1 }); }}
            onUnreadable={() => setError("The browser can't play that file, so it can't be trimmed here. An MP4 (H.264) will work.")}
            disabled={busy}
          />
        ) : (
          <DropZone accept="video/*" onFile={pickVideo} label="Drop a video" className="grid min-h-[180px] place-items-center rounded-md px-4 text-center">
            <div className="flex flex-col items-center gap-2 text-zinc-600">
              <UploadIcon size={20} />
              <span className="text-xs">Drop the video here, or click to pick one</span>
              <span className="text-[10px] text-zinc-700">trim it and speed it up after · {MIN_CLIP_SECONDS}–{MAX_CLIP_SECONDS}s once cut</span>
            </div>
          </DropZone>
        )}
      </div>

      <label className={`grid gap-1.5 ${LABEL}`}>
        What is happening
        <textarea
          value={action}
          onChange={(e) => setAction(e.target.value.replace(/[[\]\n]/g, '').slice(0, MAX_ACTION_CHARS))}
          placeholder="A man walks into the gym"
          disabled={busy}
          rows={2}
          className={`${FIELD} resize-none py-2 normal-case leading-relaxed tracking-normal`}
        />
        <span className="normal-case tracking-normal text-zinc-600">
          One sentence. It is what the video prompt opens with for every character made in this scene, so it is written once, here.
        </span>
        {action.trim() && (
          <span className="normal-case leading-relaxed tracking-normal text-zinc-500">
            <span className="text-zinc-300">{motionPrompt(action).slice(0, motionPrompt(action).indexOf('. Do not') + 1)}</span>
            {motionPrompt(action).slice(motionPrompt(action).indexOf('. Do not') + 1)}
          </span>
        )}
      </label>
    </div>
  );

  const footer = (
    <div className="grid gap-2.5">
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button type="button" onClick={save} disabled={!ready} className={PRIMARY}>
        {busy && <SpinnerIcon size={13} className="animate-spin" />}
        {phase === 'uploading' ? `Uploading the video… ${Math.round(progress * 100)}%`
          : phase === 'cutting' ? 'Cutting the clip and its first frame…'
          : 'Save scene'}
      </button>
      <p className="text-[11px] text-zinc-600">
        {busy
          ? 'The clip is cut at full quality, which can take a minute.'
          : 'Saving costs nothing: the video is cut and kept. Characters are put into it from their own page, with “Make scenes”.'}
      </p>
    </div>
  );

  return (
    <Split title="Scenes" backLabel="Characters" onBack={onBack} side={side} footer={footer}>
      {saved.length === 0 ? (
        <p className="max-w-[520px] text-sm leading-relaxed text-zinc-500">
          No scenes saved yet. Drop a video on the left, trim it, name it and save it — then open a character and press “Make scenes” to put that character into it.
        </p>
      ) : (
        SCENE_KINDS.map((kind) => {
          const scenes = saved.filter((s) => sceneKind(s.name) === kind.key);
          return (
            <section key={kind.key} className="mb-8">
              <h2 className="mb-3 text-sm font-semibold">
                {kind.label} <span className="ml-1 text-xs font-normal tabular-nums text-zinc-500">{scenes.length}</span>
              </h2>
              {scenes.length === 0 ? (
                <p className="text-xs text-zinc-600">
                  {kind.key === 'hook' ? 'None.' : `None — a scene with “${kind.key}” in its name is listed here.`}
                </p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] items-start gap-3">
                  {scenes.map((s) => (
                    <SavedCard
                      key={s.id}
                      scene={s}
                      disabled={editing}
                      onRename={(next) => void edit(() => updateSaved(s.id, { name: next }))}
                      onAction={(next) => void edit(() => updateSaved(s.id, { action: next }))}
                      onDelete={() => void edit(() => deleteSaved(s.id))}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}
    </Split>
  );
}
