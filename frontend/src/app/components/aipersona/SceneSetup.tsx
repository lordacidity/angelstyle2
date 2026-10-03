'use client';

// A new scene, before Go. The panel on the left takes a name, a video (trimmed
// and sped up there), and the prompt the image model will be given; the
// personas are on the right, and any of them can be left out of this scene.
//
// Go uploads the video, has the server cut it and pull its first frame, and
// starts a character first frame for every persona still in. Nothing is spent
// before Go.

import { useEffect, useRef, useState } from 'react';
import { SpinnerIcon, UploadIcon } from '@/lib/icons';
import { createScene, uploadFile } from '@/lib/aipersona/client';
import {
  DEFAULT_FRAME_PROMPT, MAX_CLIP_SECONDS, MAX_NAME_CHARS, MAX_PROMPT_CHARS, MIN_CLIP_SECONDS, clipSeconds,
  type Persona, type Scene,
} from '@/lib/aipersona/types';
import { ClipTrimmer, type Trim } from './ClipTrimmer';
import { DropZone, FIELD, LABEL, PRIMARY, Split, errorText } from './aipersona-ui';

const UNTRIMMED: Trim = { start: 0, end: 0, speed: 1 };

export function SceneSetup({ personas, onBack, onCreated }: {
  personas: Persona[];
  onBack: () => void;
  onCreated: (scene: Scene) => void;
}) {
  const [name, setName] = useState('');
  const [video, setVideo] = useState<{ file: File; url: string } | null>(null);
  const [duration, setDuration] = useState(0);
  const [trim, setTrim] = useState<Trim>(UNTRIMMED);
  const [prompt, setPrompt] = useState(DEFAULT_FRAME_PROMPT);
  /** Personas left out of this scene. */
  const [out, setOut] = useState<ReadonlySet<string>>(new Set());
  const [phase, setPhase] = useState<'uploading' | 'cutting' | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  // A Go that fails after the upload keeps what it uploaded, so the next Go
  // with the same file doesn't send it again.
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

  function toggle(id: string) {
    setOut((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  const chosen = personas.filter((p) => !out.has(p.id));
  const seconds = clipSeconds(trim.start, trim.end, trim.speed);
  const cutOk = duration > 0 && seconds >= MIN_CLIP_SECONDS && seconds <= MAX_CLIP_SECONDS;
  const busy = phase !== null;
  const ready = !!name.trim() && !!video && cutOk && !!prompt.trim() && chosen.length > 0 && !busy;

  async function go() {
    if (!ready || !video) return;
    setError('');
    try {
      setPhase('uploading');
      setProgress(0);
      if (uploaded.current?.file !== video.file) {
        uploaded.current = { file: video.file, path: await uploadFile('source', video.file, setProgress) };
      }
      setPhase('cutting');
      const scene = await createScene({
        name: name.trim(),
        sourcePath: uploaded.current.path,
        start: trim.start,
        end: trim.end,
        speed: trim.speed,
        prompt: prompt.trim(),
        personaIds: chosen.map((p) => p.id),
      });
      uploaded.current = null;
      onCreated(scene);
    } catch (err) {
      setError(errorText(err));
      setPhase(null);
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
          autoFocus
          className={`${FIELD} h-9 normal-case tracking-normal`}
        />
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
        <span className="flex items-center justify-between">
          First-frame prompt
          {prompt !== DEFAULT_FRAME_PROMPT && !busy && (
            <button type="button" onClick={() => setPrompt(DEFAULT_FRAME_PROMPT)} className="normal-case tracking-normal text-zinc-500 transition-colors hover:text-white">
              back to the default
            </button>
          )}
        </span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value.slice(0, MAX_PROMPT_CHARS))}
          disabled={busy}
          className={`${FIELD} min-h-[150px] resize-y py-2.5 normal-case leading-relaxed tracking-normal`}
        />
        <span className="normal-case tracking-normal text-zinc-600">
          #image1 is the first frame of the video, #image2 the character&apos;s photo.
        </span>
      </label>
    </div>
  );

  const footer = (
    <div className="grid gap-2.5">
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button type="button" onClick={go} disabled={!ready} className={PRIMARY}>
        {busy && <SpinnerIcon size={13} className="animate-spin" />}
        {phase === 'uploading' ? `Uploading the video… ${Math.round(progress * 100)}%`
          : phase === 'cutting' ? 'Cutting the clip and its first frame…'
          : 'Go'}
      </button>
      <p className="text-[11px] text-zinc-600">
        {busy
          ? 'The clip is cut at full quality, which can take a minute. The first frames start as soon as it is done.'
          : `Go makes a character first frame for ${chosen.length === 1 ? 'the 1 character' : `each of the ${chosen.length} characters`} on the right.`}
      </p>
    </div>
  );

  return (
    <Split title="New scene" backLabel="Characters" onBack={onBack} side={side} footer={footer}>
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold">Characters in this scene</h2>
        <span className="text-xs tabular-nums text-zinc-500">{chosen.length} of {personas.length} · click one to leave it out</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
        {personas.map((p) => {
          const left = out.has(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => toggle(p.id)}
              disabled={busy}
              aria-pressed={!left}
              title={left ? 'Left out of this scene — click to put back' : 'Click to leave out of this scene'}
              className={`group overflow-hidden rounded-lg border text-left transition-colors disabled:cursor-default ${
                left ? 'border-zinc-900' : 'border-zinc-700 hover:border-zinc-500'
              }`}
            >
              <div className="relative aspect-[3/4] bg-zinc-950">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.photoUrl} alt="" className={`h-full w-full object-cover transition-opacity ${left ? 'opacity-20' : ''}`} />
                {left && <span className="absolute inset-0 grid place-items-center text-[11px] uppercase tracking-wide text-zinc-400">left out</span>}
              </div>
              <div className={`truncate px-3 py-2 text-sm ${left ? 'text-zinc-600' : 'text-white'}`}>{p.name}</div>
            </button>
          );
        })}
      </div>
    </Split>
  );
}
