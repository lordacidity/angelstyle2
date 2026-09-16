'use client';

// AI Persona (Studio > AI Persona) — a photo and a script in, that face saying it out.
//
// Three steps, one button:
//
//   1  the portrait goes up to fal storage, and the script comes along with it
//   2  ElevenLabs v3 reads the script as Liam — every other setting left at its
//      default — and hands back an mp3. Or, with Upload a voice, a recording
//      made elsewhere goes up to fal storage as it is and ElevenLabs is skipped
//   3  Kling AI Avatar is given the photo and that voice and NO PROMPT at all, so
//      the reading is the only thing driving the performance
//
// Step 3 is queued at fal and polled, because a finished video is often minutes
// away. The section stays mounted across tab switches (StudioShell), so a video
// still lands if you wander off to another tool while it renders.
//
// Kling is charged by the second of finished video, and it matches the video to
// the length of the mp3 — so the script length is the bill. The cards show the
// running estimate before the job is queued, and the real figure once the mp3
// has been measured.

import { useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { DownloadIcon, SpinnerIcon, UploadIcon } from '@/lib/icons';
import { MUFFLER_MAX_STRENGTH, muffle, toWav } from '@/lib/audioMuffler';
import {
  AVATAR_MODEL, AVATAR_USD_PER_SEC, CHARS_PER_SEC, FINISH_DEFAULT, MAX_PHOTO_BYTES, MAX_SCRIPT_CHARS,
  MAX_VOICE_BYTES, MUFFLED_UPLOAD_RATE, PHOTO_TYPES, TTS_MODEL, VOICE, VOICE_EXTENSIONS, isVoiceFile,
  type AvatarResponse, type AvatarStatusResponse, type ErrorResponse, type PhotoResponse, type VoiceResponse,
} from '@/lib/aipersona/types';

// fal is asked where the job has got to on this beat. Kling reports nothing
// finer-grained than a queue place and its own log lines, so there is no point
// asking faster.
const POLL_MS = 3000;

type Status = 'waiting' | 'ready' | 'running' | 'done' | 'error';
interface StepState { status: Status; label?: string; error?: string }
type StepKey = 'input' | 'voice' | 'video' | 'finish';
type Steps = Record<StepKey, StepState>;

const STEP_ORDER: StepKey[] = ['input', 'voice', 'video', 'finish'];
const LABELS: Record<Status, string> = {
  waiting: 'waiting', ready: 'ready', running: 'working', done: 'done', error: 'failed',
};
const IDLE: Steps = {
  input: { status: 'ready' }, voice: { status: 'waiting' },
  video: { status: 'waiting' }, finish: { status: 'waiting' },
};

/** The treated render, as a blob URL the browser can play and save, and what
 *  was switched on to make it. */
interface Finished { url: string; bytes: number; seed: number; ms: number; muffler: number | null; video: number | null }

/** The Finish card's two halves. Each is switched and strengthened on its own,
 *  so either can be rough while the other stays clean. */
interface FinishHalf { on: boolean; strength: number }

/** The muffler renders at the rate the Audio Editor tuned it at, so the saved
 *  mix sounds the way it did there. */
const MUFFLE_RATE = 48000;

// ── Bits ─────────────────────────────────────────────────────────────────────

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block whitespace-nowrap rounded border border-zinc-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
      {children}
    </span>
  );
}

// Same card the Pricer's pipeline uses, so the two sections read alike.
function StepCard({ n, title, sub, state, final, children }: {
  n: number; title: string; sub?: string; state: StepState; final?: boolean; children?: ReactNode;
}) {
  const s = state.status;
  const border =
    s === 'waiting' ? 'border-zinc-900 opacity-50'
    : s === 'running' ? 'border-zinc-300'
    : s === 'error' ? 'border-red-500'
    : final && s === 'done' ? 'border-emerald-500'
    : 'border-zinc-700';
  const num =
    s === 'running' ? 'border-white bg-white text-black'
    : s === 'done' ? 'border-emerald-400 bg-emerald-400 text-black'
    : s === 'error' ? 'border-red-500 bg-red-500 text-white'
    : 'border-zinc-700 text-white';
  const status =
    s === 'running' ? 'text-white'
    : s === 'done' ? 'text-emerald-400'
    : s === 'error' ? 'text-red-400'
    : 'text-zinc-500';
  return (
    <section className={`rounded-lg border bg-zinc-950 px-5 py-4 transition-colors ${border}`}>
      <div className="flex items-center gap-3">
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded border text-[13px] font-bold tabular-nums ${num}`}>{n}</span>
        <h2 className="min-w-0 flex-1 text-[15px] font-semibold text-white">
          {title}
          {sub && <span className="ml-2 text-xs font-normal text-zinc-500">{sub}</span>}
        </h2>
        <span className={`flex shrink-0 items-center gap-2 text-[11px] uppercase tracking-wider ${status}`}>
          {s === 'running' && <span className="h-2.5 w-2.5 animate-pulse bg-white" />}
          {state.label ?? LABELS[s]}
        </span>
      </div>
      {state.error && <p className="mt-3 text-sm text-red-400">{state.error}</p>}
      {children && <div className="mt-3.5">{children}</div>}
    </section>
  );
}

function SaveLink({ href, name, children }: { href: string; name: string; children: ReactNode }) {
  return (
    <a
      href={href}
      download={name}
      className="flex h-8 items-center gap-1.5 rounded-md border border-zinc-800 px-3 text-xs text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white"
    >
      <DownloadIcon size={13} />
      {children}
    </a>
  );
}

/** fal.media is another origin, where <a download> is ignored — anything still
 *  sitting there is saved through our own route instead. A blob URL is already
 *  ours, so it is linked to directly. */
const falHref = (url: string, name: string) =>
  `/api/ai-persona/file?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`;

const usd = (n: number) => `$${n.toFixed(2)}`;
const secs = (n: number) => `${n.toFixed(1)}s`;
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** First few words of the script, for the downloaded filenames. */
function slugOf(script: string): string {
  const s = script.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.split('-').filter(Boolean).slice(0, 5).join('-') || 'take';
}

/** Kling's soundtrack in audio muffler mode, as a mono WAV ready to upload. The
 *  render is read through our own file route, and its audio decoded straight
 *  out of the mp4. */
async function muffledTrack(videoUrl: string, strength: number): Promise<Blob> {
  const res = await fetch(falHref(videoUrl, 'render.mp4'));
  if (!res.ok) throw new Error(`Couldn't fetch the render to muffle its audio (${res.status}).`);
  let voice: AudioBuffer;
  try {
    voice = await new OfflineAudioContext(1, 1, MUFFLE_RATE).decodeAudioData(await res.arrayBuffer());
  } catch {
    throw new Error("The browser couldn't read the render's audio to muffle it.");
  }
  const muffled = await muffle(voice, strength);
  const down = new OfflineAudioContext(1, Math.max(1, Math.ceil(muffled.duration * MUFFLED_UPLOAD_RATE)), MUFFLED_UPLOAD_RATE);
  const src = down.createBufferSource();
  src.buffer = muffled;
  src.connect(down.destination);
  src.start(0);
  return toWav(await down.startRendering());
}

/** An on/off switch, in this section's green. */
function Switch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-zinc-800'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${on ? 'left-[18px] bg-black' : 'left-0.5 bg-zinc-500'}`} />
    </button>
  );
}

/** One half of the Finish card: a switch, what it does, and its strength.
 *  Moving the slider switches it on. `saved`, when given, is the strength the
 *  half was tuned at, with a way back to it once it has been moved. */
function FinishRow({ title, note, half, onChange, max, saved }: {
  title: string; note: string; half: FinishHalf; onChange: (h: FinishHalf) => void; max: number; saved?: number;
}) {
  return (
    <div className={`grid content-start gap-2 rounded-md border px-4 py-3 transition-colors ${half.on ? 'border-zinc-700' : 'border-zinc-900'}`}>
      <div className="flex items-center gap-3">
        <Switch on={half.on} onChange={on => onChange({ ...half, on })} label={title} />
        <span className={`flex-1 text-sm font-medium ${half.on ? 'text-white' : 'text-zinc-500'}`}>{title}</span>
        {saved !== undefined && half.strength !== saved && (
          <button
            type="button"
            onClick={() => onChange({ ...half, strength: saved })}
            className="text-[11px] text-zinc-500 transition-colors hover:text-white"
          >
            back to {saved}
          </button>
        )}
      </div>
      <p className="text-[11px] leading-relaxed text-zinc-600">{note}</p>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={half.strength}
          onChange={e => onChange({ on: true, strength: Number(e.target.value) })}
          className={`w-full cursor-pointer accent-emerald-500 ${half.on ? '' : 'opacity-40'}`}
        />
        <span className="w-8 text-right text-xs tabular-nums text-zinc-300">{half.strength}</span>
      </div>
    </div>
  );
}

async function ask<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error((data as ErrorResponse)?.error || `${url} answered ${res.status}`);
  return data as T;
}

// ── The section ──────────────────────────────────────────────────────────────

export function AiPersonaSection() {
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [script, setScript] = useState('');
  // Where the voice comes from: ElevenLabs reading the script, or a recording
  // uploaded as it is. A recording is measured as soon as it is picked, so the
  // cost is real before anything is sent.
  const [voiceSource, setVoiceSource] = useState<'script' | 'upload'>('script');
  const [recording, setRecording] = useState<{ file: File; url: string; seconds: number | null } | null>(null);
  const [recordingError, setRecordingError] = useState('');
  const [recordingDragging, setRecordingDragging] = useState(false);
  const recordingRef = useRef<HTMLInputElement>(null);

  const [steps, setSteps] = useState<Steps>(IDLE);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const [audio, setAudio] = useState<{ url: string; seconds: number | null; ext: string } | null>(null);
  const [video, setVideo] = useState<{ url: string; seconds: number } | null>(null);
  const [requestId, setRequestId] = useState('');
  const [queuePos, setQueuePos] = useState<number | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  // Muffler on at 100 is audio muffler mode exactly as it was saved.
  const [muffler, setMuffler] = useState<FinishHalf>({ on: true, strength: 100 });
  const [picture, setPicture] = useState<FinishHalf>({ on: true, strength: FINISH_DEFAULT });
  const finishRef = useRef({ muffler, picture });
  useEffect(() => { finishRef.current = { muffler, picture }; }, [muffler, picture]);
  const [finished, setFinished] = useState<Finished | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  // Every run gets a number. Anything that lands from an older one — a poll, an
  // audio duration — is dropped, so Start over and a second Generate can't be
  // overwritten by what the last run was still waiting on.
  const runRef = useRef(0);
  const startedAt = useRef(0);

  // The object URL for the preview is released as soon as another photo replaces
  // it, and on unmount. Same for the finished render, which is a blob.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => () => { if (finished) URL.revokeObjectURL(finished.url); }, [finished]);
  const recordingUrl = recording?.url;
  useEffect(() => () => { if (recordingUrl) URL.revokeObjectURL(recordingUrl); }, [recordingUrl]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 100);
    return () => clearInterval(t);
  }, [running]);

  const scriptLen = script.trim().length;
  const uploadingVoice = voiceSource === 'upload';
  // Until the mp3 exists the length is a guess from the script; after that it is
  // measured. A recording is measured when it is picked. Either way it is what
  // Kling will charge for.
  const seconds = audio?.seconds
    ?? (uploadingVoice ? recording?.seconds ?? 0 : scriptLen ? scriptLen / CHARS_PER_SEC : 0);
  const cost = seconds * AVATAR_USD_PER_SEC;
  const hasVoice = uploadingVoice ? !!recording : scriptLen > 0;
  const canStart = !!photo && hasVoice && !running;

  function chooseRecording(file: File | null | undefined) {
    if (!file) return;
    if (!isVoiceFile(file)) {
      setRecordingError(`Kling reads ${VOICE_EXTENSIONS.join(', ').toUpperCase()} — "${file.name}" isn't one of those.`);
      return;
    }
    if (file.size > MAX_VOICE_BYTES) {
      setRecordingError(`That recording is ${(file.size / 1024 / 1024).toFixed(1)}MB; the limit is ${(MAX_VOICE_BYTES / 1024 / 1024).toFixed(1)}MB.`);
      return;
    }
    setRecordingError('');
    const url = URL.createObjectURL(file);
    setRecording({ file, url, seconds: null });
    const el = new Audio();
    el.preload = 'metadata';
    el.addEventListener('loadedmetadata', () => {
      if (!Number.isFinite(el.duration)) return;
      setRecording(r => (r && r.url === url ? { ...r, seconds: el.duration } : r));
    });
    el.src = url;
  }

  function choosePhoto(file: File | null | undefined) {
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) {
      setPhotoError(`Kling reads JPEG, PNG, WebP, GIF or AVIF — that one is ${file.type || 'of no stated type'}.`);
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError(`That photo is ${(file.size / 1024 / 1024).toFixed(1)}MB; the limit is ${MAX_PHOTO_BYTES / 1024 / 1024}MB.`);
      return;
    }
    setPhotoError('');
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    choosePhoto(e.dataTransfer.files?.[0]);
  }

  /** Put the error on whichever step was in the middle of it. */
  function markFailed(message: string) {
    setSteps(prev => {
      const next = { ...prev };
      for (const k of STEP_ORDER) {
        if (next[k].status === 'running') { next[k] = { status: 'error', error: message }; break; }
      }
      return next;
    });
  }

  /** How long the mp3 actually runs — the browser reads it off the file. */
  function measure(url: string, run: number) {
    const el = new Audio();
    el.preload = 'metadata';
    el.addEventListener('loadedmetadata', () => {
      if (runRef.current !== run || !Number.isFinite(el.duration)) return;
      setAudio(a => (a && a.url === url ? { ...a, seconds: el.duration } : a));
    });
    el.src = url;
  }

  /** Ask fal where the queued video has got to, until it is there. Answers with
   *  the mp4's URL, or null if this run was abandoned. Throws with Kling's own
   *  reason if the job fails. */
  async function poll(id: string, run: number): Promise<string | null> {
    for (;;) {
      if (runRef.current !== run) return null;
      const s = await ask<AvatarStatusResponse>(`/api/ai-persona/avatar?requestId=${encodeURIComponent(id)}`);
      if (runRef.current !== run) return null;

      setQueuePos(s.status === 'IN_QUEUE' ? s.queuePosition ?? null : null);
      if (s.logs?.length) setLogs(s.logs);

      if (s.status === 'COMPLETED' && s.videoUrl) {
        setVideo({ url: s.videoUrl, seconds: s.duration ?? 0 });
        setSteps(prev => ({ ...prev, video: { status: 'done' } }));
        return s.videoUrl;
      }
      setSteps(prev => ({
        ...prev,
        video: {
          status: 'running',
          label: s.status === 'IN_QUEUE'
            ? `in queue${s.queuePosition != null ? ` #${s.queuePosition}` : ''}`
            : 'rendering',
        },
      }));
      await sleep(POLL_MS);
    }
  }

  /** The last step, in two halves that are each optional: the browser muffles
   *  the audio (audio muffler mode), and ffmpeg roughs up the picture and puts
   *  the two back together. Costs nothing to run again, so both are knobs, and
   *  every run draws a fresh grain seed. Reads the switches as they are when it
   *  starts — after a render that took minutes, not when Make was pressed. */
  async function finishPass(url: string, run: number) {
    const { muffler: m, picture: p } = finishRef.current;
    const body = new FormData();
    body.append('videoUrl', url);
    if (p.on) body.append('videoStrength', String(p.strength));
    if (m.on) {
      setSteps(prev => ({ ...prev, finish: { status: 'running', label: 'muffling the audio' } }));
      body.append('audio', await muffledTrack(url, m.strength), 'muffled.wav');
      if (runRef.current !== run) return;
    }
    setSteps(prev => ({ ...prev, finish: { status: 'running', label: p.on ? 'roughing up the picture' : 'putting it together' } }));
    const res = await fetch('/api/ai-persona/finish', { method: 'POST', body });
    if (!res.ok) {
      const data: unknown = await res.json().catch(() => null);
      throw new Error((data as ErrorResponse)?.error || `the finish pass answered ${res.status}`);
    }
    const blob = await res.blob();
    if (runRef.current !== run) return;
    setFinished({
      url: URL.createObjectURL(blob),
      bytes: blob.size,
      seed: Number(res.headers.get('X-Persona-Seed') || 0),
      ms: Number(res.headers.get('X-Persona-Ms') || 0),
      muffler: m.on ? m.strength : null,
      video: p.on ? p.strength : null,
    });
    setSteps(prev => ({ ...prev, finish: { status: 'done' } }));
  }

  /** Run the pass over the same render again — changed switches or strengths,
   *  or just different grain. Nothing goes back to fal. */
  async function redoFinish() {
    if (!video || running) return;
    const run = ++runRef.current;
    startedAt.current = Date.now();
    setElapsed(0);
    setRunning(true);
    try {
      await finishPass(video.url, run);
    } catch (err) {
      if (runRef.current === run) markFailed(err instanceof Error ? err.message : String(err));
    } finally {
      if (runRef.current === run) setRunning(false);
    }
  }

  async function start(e: FormEvent) {
    e.preventDefault();
    if (!photo || !hasVoice || running) return;
    const voiceFile = uploadingVoice ? recording?.file ?? null : null;

    const run = ++runRef.current;
    const live = () => runRef.current === run;
    startedAt.current = Date.now();
    setElapsed(0);
    setRunning(true);
    setAudio(null);
    setVideo(null);
    setFinished(null);
    setRequestId('');
    setQueuePos(null);
    setLogs([]);
    setSteps({ ...IDLE, input: { status: 'running', label: 'uploading photo' } });

    try {
      // 1 — the portrait goes to fal storage, where Kling can read it.
      const body = new FormData();
      body.append('photo', photo);
      const { imageUrl } = await ask<PhotoResponse>('/api/ai-persona/photo', { method: 'POST', body });
      if (!live()) return;
      setSteps(prev => ({
        ...prev,
        input: { status: 'done' },
        voice: { status: 'running', label: voiceFile ? 'uploading your voice' : `reading as ${VOICE}` },
      }));

      // 2 — the voice. ElevenLabs reads the script, seconds usually — or the
      // recording goes up to fal as it is, and ElevenLabs is never called.
      let voiceInit: RequestInit;
      if (voiceFile) {
        const form = new FormData();
        form.append('voice', voiceFile);
        voiceInit = { method: 'POST', body: form };
      } else {
        voiceInit = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ script: script.trim() }) };
      }
      const voice = await ask<VoiceResponse>('/api/ai-persona/voice', voiceInit);
      if (!live()) return;
      setAudio({ url: voice.audioUrl, seconds: null, ext: voiceFile ? voiceFile.name.split('.').pop()!.toLowerCase() : 'mp3' });
      measure(voice.audioUrl, run);
      setSteps(prev => ({ ...prev, voice: { status: 'done' }, video: { status: 'running', label: 'queueing' } }));

      // 3 — Kling, queued, then polled until the mp4 is there.
      const { requestId: id } = await ask<AvatarResponse>('/api/ai-persona/avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, audioUrl: voice.audioUrl }),
      });
      if (!live()) return;
      setRequestId(id);
      const url = await poll(id, run);

      // 4 — and finally the finish pass, locally, so it stops looking generated.
      if (url && live()) await finishPass(url, run);
    } catch (err) {
      if (live()) markFailed(err instanceof Error ? err.message : String(err));
    } finally {
      if (live()) setRunning(false);
    }
  }

  /** Clear the run but keep the photo and the script — the usual next move is
   *  another take of the same thing. */
  function reset() {
    runRef.current++;
    setRunning(false);
    setSteps(IDLE);
    setAudio(null);
    setVideo(null);
    setFinished(null);
    setRequestId('');
    setQueuePos(null);
    setLogs([]);
    setElapsed(0);
  }

  const slug = uploadingVoice && recording ? slugOf(recording.file.name.replace(/\.[^.]+$/, '')) : slugOf(script);

  return (
    <div className="flex h-screen flex-col bg-black text-white">
      <div className="shrink-0 border-b border-zinc-900 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">AI Persona</h1>
            <p className="text-xs text-zinc-500">
              Upload a photo and a script — or your own recording. ElevenLabs reads a script as {VOICE}, Kling makes that face say it — no prompt, just the voice — then a finish pass roughs it up so it stops reading as AI.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Chip>{TTS_MODEL.replace('fal-ai/', '')} · {VOICE}</Chip>
            <Chip>{AVATAR_MODEL.replace('fal-ai/', '')}</Chip>
            <Chip>{usd(AVATAR_USD_PER_SEC)} / second of video</Chip>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-[960px] flex-col gap-4">

          <StepCard n={1} title="Photo & voice" state={steps.input}>
            <form onSubmit={start} className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
                {/* The face. Click or drop a file on it. */}
                <div
                  onDragOver={e => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  onClick={() => fileRef.current?.click()}
                  className={`grid aspect-square cursor-pointer place-items-center overflow-hidden rounded-md border border-dashed bg-zinc-950 transition-colors ${
                    dragging ? 'border-zinc-400 bg-zinc-900' : 'border-zinc-800 hover:border-zinc-600'
                  }`}
                >
                  {preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center gap-2 px-4 text-center text-zinc-600">
                      <UploadIcon size={20} />
                      <span className="text-xs">Drop a portrait, or click to pick one</span>
                      <span className="text-[10px] text-zinc-700">JPEG · PNG · WebP · up to {MAX_PHOTO_BYTES / 1024 / 1024}MB</span>
                    </div>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept={PHOTO_TYPES.join(',')}
                  className="hidden"
                  onChange={e => { choosePhoto(e.target.files?.[0]); e.target.value = ''; }}
                />

                <div className="grid content-start gap-2">
                  {/* Where the voice comes from. Switching keeps both the script and the recording. */}
                  <div className="flex w-fit rounded-md border border-zinc-800 p-0.5 text-xs">
                    {([['script', `Script → ElevenLabs`], ['upload', 'Upload a voice']] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setVoiceSource(value)}
                        disabled={running}
                        className={`rounded px-2.5 py-1 transition-colors disabled:cursor-not-allowed ${
                          voiceSource === value ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {!uploadingVoice ? (
                    <label className="grid gap-1.5 text-[11px] uppercase tracking-wide text-zinc-500">
                      Script — what they say, word for word
                      <textarea
                        value={script}
                        onChange={e => setScript(e.target.value.slice(0, MAX_SCRIPT_CHARS))}
                        placeholder="Everyone told me to wait my turn. So I stopped asking for one."
                        className="min-h-[150px] w-full resize-y rounded-md border border-zinc-800 bg-zinc-950 p-3 text-[15px] normal-case leading-relaxed tracking-normal text-zinc-100 placeholder-zinc-600 outline-none transition-colors focus:border-zinc-500"
                      />
                      <span className="flex flex-wrap items-center gap-2 normal-case tracking-normal text-zinc-600">
                        <span className="tabular-nums">{script.length} / {MAX_SCRIPT_CHARS}</span>
                        {scriptLen > 0 && (
                          <span className="tabular-nums">
                            · {audio?.seconds ? 'runs' : 'about'} {secs(seconds)} of video · {audio?.seconds ? '' : 'about '}{usd(cost)} of Kling
                          </span>
                        )}
                      </span>
                    </label>
                  ) : (
                    <div className="grid gap-1.5 text-[11px] uppercase tracking-wide text-zinc-500">
                      Voice — your recording, used as it is
                      <div
                        onDragOver={e => { e.preventDefault(); setRecordingDragging(true); }}
                        onDragLeave={() => setRecordingDragging(false)}
                        onDrop={e => { e.preventDefault(); setRecordingDragging(false); chooseRecording(e.dataTransfer.files?.[0]); }}
                        onClick={() => recordingRef.current?.click()}
                        className={`grid min-h-[110px] cursor-pointer place-items-center rounded-md border border-dashed bg-zinc-950 px-4 text-center normal-case tracking-normal transition-colors ${
                          recordingDragging ? 'border-zinc-400 bg-zinc-900' : 'border-zinc-800 hover:border-zinc-600'
                        }`}
                      >
                        {recording ? (
                          <div className="grid gap-1">
                            <span className="text-sm text-zinc-200">{recording.file.name}</span>
                            <span className="text-[11px] text-zinc-600">drop or click to pick another</span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-2 text-zinc-600">
                            <UploadIcon size={20} />
                            <span className="text-xs">Drop a recording, or click to pick one</span>
                            <span className="text-[10px] text-zinc-700">
                              {VOICE_EXTENSIONS.join(' · ').toUpperCase()} · up to {(MAX_VOICE_BYTES / 1024 / 1024).toFixed(1)}MB
                            </span>
                          </div>
                        )}
                      </div>
                      <input
                        ref={recordingRef}
                        type="file"
                        accept={VOICE_EXTENSIONS.map(x => `.${x}`).join(',')}
                        className="hidden"
                        onChange={e => { chooseRecording(e.target.files?.[0]); e.target.value = ''; }}
                      />
                      {recording && <audio src={recording.url} controls className="h-9 w-full" />}
                      <span className={`flex flex-wrap items-center gap-2 normal-case tracking-normal ${recordingError ? 'text-red-400' : 'text-zinc-600'}`}>
                        {recordingError || (recording
                          ? <span className="tabular-nums">
                              {(recording.file.size / 1024 / 1024).toFixed(1)}MB
                              {recording.seconds ? ` · runs ${secs(recording.seconds)} of video · ${usd(cost)} of Kling` : ' · measuring…'}
                            </span>
                          : 'Kling times the video to the recording, so its length is the bill.')}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {(photoError || photo) && (
                <p className={`text-xs ${photoError ? 'text-red-400' : 'text-zinc-500'}`}>
                  {photoError || `${photo?.name} · ${((photo?.size ?? 0) / 1024 / 1024).toFixed(1)}MB`}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="submit"
                  disabled={!canStart}
                  className="flex h-9 items-center gap-2 rounded-md bg-emerald-500 px-4 text-xs font-semibold text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  {running && <SpinnerIcon size={13} className="animate-spin" />}
                  {running ? 'Working…' : 'Make the video'}
                </button>
                {(running || video || steps.voice.status !== 'waiting') && (
                  <button
                    type="button"
                    onClick={reset}
                    className="h-9 rounded-md border border-zinc-800 px-3 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:text-white"
                  >
                    {running ? 'Stop watching' : 'Start over'}
                  </button>
                )}
                {(running || video) && <span className="text-xs tabular-nums text-zinc-500">{elapsed.toFixed(0)}s</span>}
              </div>
            </form>
          </StepCard>

          <StepCard
            n={2}
            title="Voice"
            sub={uploadingVoice ? 'your recording · uploaded as it is, no ElevenLabs' : `ElevenLabs v3 · ${VOICE} · everything else default`}
            state={steps.voice}
          >
            {audio && (
              <div className="flex flex-wrap items-center gap-3">
                <audio src={audio.url} controls className="h-9 min-w-[280px] flex-1" />
                <span className="text-xs tabular-nums text-zinc-500">
                  {audio.seconds ? secs(audio.seconds) : 'measuring…'}
                </span>
                <SaveLink href={falHref(audio.url, `${slug}.${audio.ext}`)} name={`${slug}.${audio.ext}`}>{audio.ext}</SaveLink>
              </div>
            )}
          </StepCard>

          <StepCard
            n={3}
            title="Render"
            sub="Kling AI Avatar v2 standard · photo + voice, no prompt · untouched"
            state={steps.video}
          >
            {steps.video.status === 'running' && (
              <div className="grid gap-2 text-xs text-zinc-500">
                <p>
                  {queuePos != null
                    ? `Waiting at fal, #${queuePos} in the queue.`
                    : 'Kling is rendering. This usually takes a few minutes — you can leave the tab, it keeps going.'}
                  {audio?.seconds ? ` ${secs(audio.seconds)} of video, about ${usd(cost)}.` : ''}
                </p>
                {requestId && <p className="font-mono text-[11px] text-zinc-700">req {requestId}</p>}
                {logs.length > 0 && (
                  <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-zinc-900 bg-black p-2.5 font-mono text-[11px] leading-relaxed text-zinc-500">
                    {logs.join('\n')}
                  </pre>
                )}
              </div>
            )}

            {video && (
              <div className="grid gap-3">
                <video
                  src={video.url}
                  controls
                  playsInline
                  className="max-h-[60vh] w-full rounded-md border border-zinc-800 bg-black object-contain"
                />
                <div className="flex flex-wrap items-center gap-3">
                  <SaveLink href={falHref(video.url, `${slug}-raw.mp4`)} name={`${slug}-raw.mp4`}>raw mp4</SaveLink>
                  <span className="text-xs tabular-nums text-zinc-500">
                    {secs(video.seconds)} · {usd(video.seconds * AVATAR_USD_PER_SEC)}
                  </span>
                </div>
              </div>
            )}
          </StepCard>

          <StepCard
            n={4}
            title="Finish"
            sub="muffled audio and a rougher picture, each on its own — no fal"
            state={steps.finish}
            final
          >
            <div className="grid gap-4">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <FinishRow
                  title="Muffler"
                  note="Audio muffler mode. 100 is the saved mix; up or down moves all ten effects together. Off keeps Kling's audio clean."
                  half={muffler}
                  onChange={setMuffler}
                  max={MUFFLER_MAX_STRENGTH}
                  saved={100}
                />
                <FinishRow
                  title="Video"
                  note="Softness, grain, an exposure wobble and heavier compression on the picture. Off keeps Kling's picture clean."
                  half={picture}
                  onChange={setPicture}
                  max={100}
                />
              </div>
              <p className="text-[11px] text-zinc-600">The voice Kling lip-syncs to is never touched; this is only on the way out.</p>

              {steps.finish.status === 'running' && (
                <p className="text-xs text-zinc-500">Going over the render — a few seconds.</p>
              )}

              {finished && (
                <div className="grid gap-3">
                  <video
                    src={finished.url}
                    controls
                    playsInline
                    className="max-h-[60vh] w-full rounded-md border border-zinc-800 bg-black object-contain"
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <SaveLink href={finished.url} name={`${slug}.mp4`}>finished mp4</SaveLink>
                    <span className="text-xs tabular-nums text-zinc-500">
                      {mb(finished.bytes)} · muffler {finished.muffler ?? 'off'} · video {finished.video ?? 'off'}
                      {finished.video !== null && ` · seed ${finished.seed}`} · {(finished.ms / 1000).toFixed(1)}s in ffmpeg
                    </span>
                  </div>
                </div>
              )}

              {video && (
                <div>
                  <button
                    type="button"
                    onClick={redoFinish}
                    disabled={running}
                    className="h-9 rounded-md border border-zinc-700 px-3 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    {finished ? 'Run the pass again' : 'Run the pass'}
                  </button>
                  <p className="mt-1.5 text-[11px] text-zinc-600">
                    Same render, new grain — nothing goes back to fal, so this is free. Change the switches or strengths first to change what it does.
                  </p>
                </div>
              )}
            </div>
          </StepCard>

        </div>
      </div>
    </div>
  );
}
