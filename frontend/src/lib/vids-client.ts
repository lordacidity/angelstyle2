'use client';

// Browser side of the Vids library: thin fetch wrappers over /api/vids/* plus
// the upload flow. A clip never passes through our server — the route hands
// back signed bucket URLs and the browser PUTs straight to Supabase Storage
// (so Vercel's request-body cap is irrelevant and we get real progress).

import type {
  ClipableKind, CreateVideoInput, SignUploadResponse, VidClipablePatch, VidContextPatch, VidEdit, VidFolder, VidLink,
  VidMark, VidPersona, VidRow, VidTheme, VidThemePatch, CreateRecipeInput, VideoProbe, VidRecipe, VidsLibraryPayload,
} from '@/lib/vids-types';
import { withBase } from '@/lib/clipping';

/** The clip ids on a persona — all optional, so one part can be re-pointed alone. */
export interface PersonaParts {
  startId?: string | null;
  topAId?: string | null;
  topBId?: string | null;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(withBase(`/api/vids${path}`), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return body as T;
}

export const listLibrary = () => api<VidsLibraryPayload>('');

export const createFolder = (name: string, parentId: string | null) =>
  api<VidFolder>('/folders', { method: 'POST', body: JSON.stringify({ name, parentId }) });

/** Get-or-create the top-level folder of this name; safe to call concurrently. */
export const ensureFolder = (name: string) =>
  api<VidFolder>('/folders', { method: 'POST', body: JSON.stringify({ name, ensure: true }) });

export const renameFolder = (id: string, name: string) =>
  api<VidFolder>(`/folders/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });

export const deleteFolder = (id: string) =>
  api<{ ok: true }>(`/folders/${id}`, { method: 'DELETE' });

/** `degen` has no default: making a persona means saying whether it is. */
export const createPersona = (name: string, degen: boolean, parts: PersonaParts = {}) =>
  api<VidPersona>('/personas', { method: 'POST', body: JSON.stringify({ name, degen, ...parts }) });

/** Anything about a persona that can change on its own: a part, its name, its
 *  context, whether the clippers get it, whether it is degen. */
export type PersonaUpdate = PersonaParts & VidContextPatch & VidClipablePatch & { name?: string; degen?: boolean };

export const updatePersona = (id: string, patch: PersonaUpdate) =>
  api<VidPersona>(`/personas/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deletePersona = (id: string) =>
  api<{ ok: true }>(`/personas/${id}`, { method: 'DELETE' });

export const renameVideo = (id: string, name: string) =>
  api<VidRow>(`/videos/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });

/** Say what a clip is showing, and which way Pauv was on it. Carries a `name`
 *  alongside, because saying what a clip shows is what names it. */
export const setVideoContext = (id: string, patch: VidContextPatch & VidThemePatch & { name?: string }) =>
  api<VidRow>(`/videos/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

/** Replace a clip's per-stretch marks. */
export const setVideoMarks = (id: string, marks: VidMark[]) =>
  api<VidRow>(`/videos/${id}`, { method: 'PATCH', body: JSON.stringify({ marks }) });

export const moveVideo = (id: string, folderId: string | null) =>
  api<VidRow>(`/videos/${id}`, { method: 'PATCH', body: JSON.stringify({ folderId }) });

/** Put a clip on offer to the clippers, or take it off — see VidClipable. */
export const setVideoClipable = (id: string, clipable: boolean) =>
  api<VidRow>(`/videos/${id}`, { method: 'PATCH', body: JSON.stringify({ clipable }) });

/** The same for a song (keyed by its url) or a caption look (by its id) —
 *  the things with no row of their own. */
export const setClipable = (kind: ClipableKind, key: string, clipable: boolean) =>
  api<{ kind: ClipableKind; key: string; clipable: boolean }>('/clipable', {
    method: 'PUT', body: JSON.stringify({ kind, key, clipable }),
  });

/** Call a song something else, everywhere the audio library is listed. */
export const renameTrack = (url: string, label: string) =>
  api<{ url: string; label: string }>('/music', { method: 'PATCH', body: JSON.stringify({ url, label }) });

export const deleteVideo = (id: string) =>
  api<{ ok: true }>(`/videos/${id}`, { method: 'DELETE' });

// ── Links ─────────────────────────────────────────────────────────────────────

/** Replace the Bottom Bs that follow on from one Bottom A. Comes back with the
 *  pairs as the server now holds them for that Bottom A. */
export const setLinks = (bottomAId: string, bottomBIds: string[]) =>
  api<VidLink[]>(`/links/${bottomAId}`, { method: 'PUT', body: JSON.stringify({ bottomBIds }) });

// ── Captions ──────────────────────────────────────────────────────────────────

/** What a build needs written: the persona's bit for the hook, and for each
 *  screen-recording clip its overall context plus — when it has been marked up
 *  in the editor — what happens at each marked stretch, in order. `count` is how
 *  many lines that clip's window can carry (one per mark when it has them). */
export interface CaptionClip {
  context: string;
  /** The clip's marks in order, or empty for an unmarked clip. */
  marks: string[];
  count: number;
  /** Bottom A on Fast: the writer places `count` lines itself and says when
   *  each comes up. `length` is the clip's window in seconds; `spans` is each
   *  mark's stretch of it, in the order `marks` lists them. */
  placed?: { length: number; spans: { start: number; end: number }[] };
}

export interface CaptionRequest {
  personaContext: string;
  personaName: string;
  wantStart: boolean;
  /** Free-text steer for this run — "less funny", "shorter", "be more specific". */
  notes: string;
  bottomA: CaptionClip | null;
  bottomB: CaptionClip | null;
  /** Whether the build has an End clip — the winnings — to sign off over. */
  wantEnd: boolean;
  /** What that closing clip shows — one more place the closing word can come
   *  from. */
  endContext: string;
  /** Let a couple of emoji in, where one actually lands. */
  emojis: boolean;
  /** The emoji the writer picks from — the ones pinned in the app's Emojis
   *  drawer, as their characters. Empty means any standard emoji. */
  emojiPalette: string[];
  /** Bottom A's last moment and Bottom B's first are too brief for a line each
   *  (lib/vidsCaptions seamNeedsMerge), so the writer puts one line across
   *  both: A's last entry carries it, B's first is left ''. */
  mergeSeam: boolean;
  /** Bottom B is Vids 2's rendered trade: its chart and confirmation lines are
   *  fixed by the caller as well as its opener, so the writer is told to leave
   *  them and write the trade line with the amount in $. Left out means off. */
  renderedTrade?: boolean;
}

/** The written lines. A marked clip's array lines up with its marks by index;
 *  the only '' is Bottom B's first when the seam was merged into A's last.
 *  `end` is the one line over the closing clip: the comment line. */
export interface CaptionDraft {
  start: string;
  bottomA: string[];
  bottomB: string[];
  end: string;
  /** When Bottom A was placed: the second into its window each line goes up. */
  bottomAAt?: number[];
}

export const writeCaptions = (input: CaptionRequest, signal?: AbortSignal) =>
  api<CaptionDraft>('/captions', { method: 'POST', body: JSON.stringify(input), signal });

// ── The hook ──────────────────────────────────────────────────────────────────

/** Vids 2's modes, each with its own guide for the hook (api/vids/hook). */
export type HookMode = 'serious' | 'middle' | 'degen';

export interface HookRequest {
  mode: HookMode;
  /** Who the video trades on, as the Pauv roster spells them. */
  person: string;
  direction: TradePosition;
  /** What the persona is doing on camera — Middle's activity. */
  personaContext: string;
}

/** The Start caption alone, written to the mode's guide. */
export const writeHook = (input: HookRequest, signal?: AbortSignal) =>
  api<{ start: string }>('/hook', { method: 'POST', body: JSON.stringify(input), signal });

// ── The question ──────────────────────────────────────────────────────────────

/** Which of the two the Bottom card asked for: a question ChatGPT naming them
 *  makes a provocation, or one they would plainly come up in. */
export type QuestionKind = 'ragebait' | 'factual';

/** A question to ask the ChatGPT lookalike about this person, written by the
 *  model — one line, lower case, and never naming them. What the Bottom card's
 *  two buttons fill the box with. Which way the video trades is no part of it:
 *  the question is about the person, the direction is what the lookalike
 *  argues afterwards.
 *
 *  Only Simpler's Bottom card asks for one today; Vids writes its own. */
export const writeQuestion = (
  input: { person: string; kind: QuestionKind },
  signal?: AbortSignal,
) => api<{ question: string }>('/question', { method: 'POST', body: JSON.stringify(input), signal });

// ── Post caption ──────────────────────────────────────────────────────────────

/** Which way the video trades on the person: up, they are getting bigger;
 *  down, they should come down. */
export type TradePosition = 'up' | 'down';

/** What the post caption is written from: the screen recordings' context, for
 *  the route to read the person and the position off — or, once they are
 *  known, the person and position outright (a Regenerate with the name
 *  corrected or the position flipped). `person` wins when both are sent. */
export interface PostCaptionRequest {
  brief?: string;
  person?: string;
  position?: TradePosition | null;
  /** Vids 2's post-captions only: write a new pair rather than hand back one
   *  kept for this exact request today. */
  fresh?: boolean;
}

/** The caption, and the person and position it was written for. */
export interface PostCaptionDraft { caption: string; person: string; position: TradePosition }

export const writePostCaption = (input: PostCaptionRequest) =>
  api<PostCaptionDraft>('/post-caption', { method: 'POST', body: JSON.stringify(input) });

/** Vids 2's pair: an Instagram caption and a TikTok one, written from the
 *  person's news this week. */
export interface PostCaptionsDraft {
  ig: string;
  tiktok: string;
  person: string;
  position: TradePosition;
}

export const writePostCaptions = (input: PostCaptionRequest, signal?: AbortSignal) =>
  api<PostCaptionsDraft>('/post-captions', { method: 'POST', body: JSON.stringify(input), signal });

// ── Upload ────────────────────────────────────────────────────────────────────

// Read duration / dimensions and grab a poster frame, all in the browser via a
// throwaway <video>. Never rejects — anything the browser can't decode (HEVC
// .mov on some machines, say) just uploads without metadata / a thumbnail.
export function probeVideoFile(file: Blob): Promise<VideoProbe> {
  const empty: VideoProbe = { duration: null, width: null, height: null, thumb: null };
  if (typeof document === 'undefined') return Promise.resolve(empty);

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    let done = false;

    const finish = (p: VideoProbe) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(p);
    };
    const timer = setTimeout(() => finish(empty), 10_000);

    video.onerror = () => finish(empty);
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : null;
      const meta = { duration, width: video.videoWidth || null, height: video.videoHeight || null };
      video.onseeked = () => {
        try {
          const maxW = 480;
          const scale = Math.min(1, maxW / (video.videoWidth || maxW));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round((video.videoWidth || 1) * scale));
          c.height = Math.max(1, Math.round((video.videoHeight || 1) * scale));
          c.getContext('2d')?.drawImage(video, 0, 0, c.width, c.height);
          c.toBlob((thumb) => finish({ ...meta, thumb }), 'image/jpeg', 0.82);
        } catch {
          finish({ ...meta, thumb: null });
        }
      };
      // Dead centre of the clip: the opening frames are so often black, a
      // fade-in or a hand reaching for the camera that the middle is far more
      // likely to actually show what the clip is.
      video.currentTime = duration ? Math.max(0.05, duration / 2) : 0.1;
    };
    video.src = url;
  });
}

// A photo, measured the same way: dimensions and a poster, no duration. The
// poster is a downscale of the picture itself, so a still looks like every other
// card in the library. Never rejects, for the same reason as above.
export function probeImageFile(file: Blob): Promise<VideoProbe> {
  const empty: VideoProbe = { duration: null, width: null, height: null, thumb: null };
  if (typeof document === 'undefined') return Promise.resolve(empty);

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    let done = false;
    const finish = (p: VideoProbe) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(p);
    };
    const timer = setTimeout(() => finish(empty), 10_000);

    img.onerror = () => finish(empty);
    img.onload = () => {
      const meta = { duration: null, width: img.naturalWidth || null, height: img.naturalHeight || null };
      try {
        const maxW = 480;
        const scale = Math.min(1, maxW / (img.naturalWidth || maxW));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
        c.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
        c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((thumb) => finish({ ...meta, thumb }), 'image/jpeg', 0.82);
      } catch {
        finish({ ...meta, thumb: null });
      }
    };
    img.src = url;
  });
}

/** Whichever of the two this file is. A photo has no duration, which is exactly
 *  what tells the rest of the app to hold it rather than play it. */
const probeFile = (file: Blob): Promise<VideoProbe> =>
  (file.type.startsWith('image/') ? probeImageFile(file) : probeVideoFile(file));

// PUT to a signed bucket URL over XHR so we get upload progress (fetch has none).
function putWithProgress(url: string, body: Blob, contentType: string, onProgress?: (frac: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { resolve(); return; }
      let msg = `Upload failed (${xhr.status})`;
      try {
        const j = JSON.parse(xhr.responseText) as { message?: string; error?: string };
        msg = j.message || j.error || msg;
      } catch { /* not JSON */ }
      if (xhr.status === 413) msg = 'File is over the Supabase project\'s upload size limit (Storage → Settings).';
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    xhr.send(body);
  });
}

export interface UploadVideoOptions {
  name: string;
  folderId: string | null;
  /** Filed whole: what it shows, its marks, and whether the keyboard is on
   *  it. The intake run gives these, since it saves a clip only once they are
   *  all known — see CreateVideoInput. */
  context?: string;
  marks?: VidMark[];
  hasSfx?: boolean;
  /** Which way Pauv was, for a Bottom B — see VidTheme. */
  theme?: VidTheme | null;
  /** When the file going up is a render: the recording it was made from, and
   *  the edit that made it. Both go up with it, so the clip can be re-edited
   *  from the recording later — see VidEdit. */
  source?: Blob;
  sourceName?: string;
  edit?: VidEdit | null;
  onProgress?: (frac: number) => void;
}

/** Save edited bytes over an existing clip. The row keeps its id, so its folder
 *  and any persona part pointing at it come through untouched — only the footage
 *  (and its length, size, poster) changes. The old objects are dropped server
 *  side once the row is repointed. */
export async function replaceVideo(
  id: string,
  file: Blob,
  opts: {
    name?: string; hasSfx?: boolean; marks?: VidMark[];
    /** The edit these bytes were rendered with — kept on the row so the clip
     *  opens with it next time. The recording it was rendered from is kept
     *  server side (see replaceVideoMedia). */
    edit?: VidEdit | null;
    onProgress?: (frac: number) => void;
  },
): Promise<VidRow> {
  const probe = await probeVideoFile(file);
  const mime = file.type || 'video/mp4';
  const sign = await api<SignUploadResponse>('/videos/sign', {
    method: 'POST',
    body: JSON.stringify({ id, name: opts.name ?? 'clip.mp4', mime, withThumb: !!probe.thumb }),
  });

  await putWithProgress(sign.video.url, file, mime, opts.onProgress);

  let thumbPath: string | null = null;
  if (probe.thumb && sign.thumb) {
    try {
      await putWithProgress(sign.thumb.url, probe.thumb, 'image/jpeg');
      thumbPath = sign.thumb.path;
    } catch (e) {
      console.error('[vids] thumb upload failed:', e);
    }
  }

  return api<VidRow>(`/videos/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      ...(opts.name ? { name: opts.name } : {}),
      ...(opts.marks ? { marks: opts.marks } : {}),
      media: {
        storagePath: sign.video.path,
        thumbPath,
        mimeType: mime,
        sizeBytes: file.size,
        duration: probe.duration,
        width: probe.width,
        height: probe.height,
        hasSfx: !!opts.hasSfx,
        edit: opts.edit ?? null,
      },
    }),
  });
}

// Upload one clip: probe → sign → PUT video (+ poster, + the recording it was
// rendered from) → register the row.
export async function uploadVideo(file: Blob, opts: UploadVideoOptions): Promise<VidRow> {
  const probe = await probeFile(file);
  const mime = file.type || 'video/mp4';
  const source = opts.source ?? null;
  const sign = await api<SignUploadResponse>('/videos/sign', {
    method: 'POST',
    body: JSON.stringify({
      name: opts.name, mime, withThumb: !!probe.thumb,
      withSource: !!source, sourceName: opts.sourceName,
    }),
  });

  // One bar across both files, weighted by size — the recording is the bigger
  // of the two, so it is most of the wait.
  const total = file.size + (source?.size ?? 0);
  const part = (offset: number, size: number) => (frac: number) => {
    if (opts.onProgress && total > 0) opts.onProgress((offset + frac * size) / total);
  };
  await putWithProgress(sign.video.url, file, mime, part(0, file.size));

  let sourcePath: string | null = null;
  if (source && sign.source) {
    await putWithProgress(sign.source.url, source, source.type || 'video/mp4', part(file.size, source.size));
    sourcePath = sign.source.path;
  }

  let thumbPath: string | null = null;
  if (probe.thumb && sign.thumb) {
    try {
      await putWithProgress(sign.thumb.url, probe.thumb, 'image/jpeg');
      thumbPath = sign.thumb.path;
    } catch (e) {
      console.error('[vids] thumb upload failed:', e);
    }
  }

  const row: CreateVideoInput = {
    id: sign.id,
    folderId: opts.folderId,
    name: opts.name,
    storagePath: sign.video.path,
    thumbPath,
    mimeType: mime,
    sizeBytes: file.size,
    duration: probe.duration,
    width: probe.width,
    height: probe.height,
    // Left undefined when not given, which JSON drops — the row then takes
    // the defaults.
    context: opts.context,
    marks: opts.marks,
    hasSfx: opts.hasSfx,
    theme: opts.theme,
    ...(sourcePath ? { sourcePath, edit: opts.edit ?? null } : {}),
  };
  return api<VidRow>('/videos', { method: 'POST', body: JSON.stringify(row) });
}

// ── Recipes ───────────────────────────────────────────────────────────────────
// A finished build under its code — see VidBuildSpec / VidRecipe in vids-types.

/** Write a build down and get its code and title back. Called as an export starts. */
export const createRecipe = (input: CreateRecipeInput) =>
  api<VidRecipe>('/recipes', { method: 'POST', body: JSON.stringify(input) });

export const getRecipe = (code: string) =>
  api<VidRecipe>(`/recipes/${encodeURIComponent(code)}`);

/** Note which library row a saved build became. */
export const linkRecipeVideo = (code: string, videoId: string | null) =>
  api<VidRecipe>(`/recipes/${encodeURIComponent(code)}`, { method: 'PATCH', body: JSON.stringify({ videoId }) });

/** Drop a code whose export never became a file. */
export const deleteRecipe = (code: string) =>
  api<{ ok: true }>(`/recipes/${encodeURIComponent(code)}`, { method: 'DELETE' });
