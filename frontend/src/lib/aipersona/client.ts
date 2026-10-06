// The browser's side of /api/ai-persona/*. One function per thing the section
// can do; every one of them throws with the route's own words when it is told
// no.

import type {
  CreateSceneRequest, ErrorResponse, LibraryPayload, Persona, Scene, UploadRequest, UploadResponse,
} from './types';

async function ask<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/ai-persona${path}`, init);
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error((data as ErrorResponse)?.error || `${path} answered ${res.status}`);
  return data as T;
}

const send = (method: string, body?: unknown): RequestInit =>
  body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };

// PUT to a signed bucket URL over XHR, because fetch reports no upload progress
// and a scene's video is big enough to want some.
function put(url: string, file: File, onProgress?: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { resolve(); return; }
      let msg = `Upload failed (${xhr.status})`;
      try {
        // Supabase Storage answers 400 and keeps the real status in the body.
        const j = JSON.parse(xhr.responseText) as { message?: string; error?: string; statusCode?: string; code?: string };
        msg = j.statusCode === '413' || j.code === 'EntityTooLarge'
          ? "File is over the Supabase project's upload size limit (Storage → Settings)."
          : j.message || j.error || msg;
      } catch { /* not JSON */ }
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(file);
  });
}

/** Put a character photo, or the video a scene is cut from, in the bucket.
 *  Answers with the path the next request names it by. */
export async function uploadFile(kind: UploadRequest['kind'], file: File, onProgress?: (fraction: number) => void): Promise<string> {
  const { path, url } = await ask<UploadResponse>('/upload', send('POST', { kind, name: file.name, mime: file.type } satisfies UploadRequest));
  await put(url, file, onProgress);
  return path;
}

export const getLibrary = () => ask<LibraryPayload>('/personas');

export const createPersona = (name: string, photoPath: string) => ask<Persona>('/personas', send('POST', { name, photoPath }));
export const updatePersona = (id: string, patch: { name?: string; photoPath?: string }) =>
  ask<Persona>(`/personas/${id}`, send('PATCH', patch));
export const deletePersona = (id: string) => ask<{ ok: true }>(`/personas/${id}`, send('DELETE'));

export const createScene = (scene: CreateSceneRequest) => ask<Scene>('/scenes', send('POST', scene));
/** The poll — and what moves a scene's running jobs along. */
export const getScene = (id: string) => ask<Scene>(`/scenes/${id}`);
export const setSceneStage = (id: string, stage: 'prompt' | 'frames') => ask<Scene>(`/scenes/${id}`, send('PATCH', { stage }));
export const deleteScene = (id: string) => ask<{ ok: true }>(`/scenes/${id}`, send('DELETE'));

export const redoFrame = (id: string, takeId: string, prompt: string) =>
  ask<Scene>(`/scenes/${id}/frames`, send('POST', { takeId, prompt }));
export const startVideos = (id: string, prompt: string) => ask<Scene>(`/scenes/${id}/videos`, send('POST', { prompt }));
export const redoVideo = (id: string, takeId: string, prompt: string) =>
  ask<Scene>(`/scenes/${id}/videos`, send('POST', { takeId, prompt }));
export const approveScene = (id: string) => ask<Scene>(`/scenes/${id}/approve`, send('POST'));

/** Take a persona out of a scene, or delete a saved video — see the route. */
export const deleteTake = (id: string) => ask<{ ok: true }>(`/takes/${id}`, send('DELETE'));

/** The bucket is another origin, where <a download> is ignored; asked this
 *  way, it sends the file as an attachment under the given name instead. */
export const downloadUrl = (url: string, name: string) =>
  `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(name)}`;

/** A name a filesystem will take. */
export const fileSlug = (text: string) =>
  text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'character';

/** Make (or remake) a persona's round profile picture. Takes up to a minute. */
export const makeAvatar = (id: string) => ask<Persona>(`/personas/${id}/avatar`, send('POST'));
/** Every persona's name and profile picture. */
export const listAvatars = () => ask<{ name: string; avatarUrl: string }[]>('/avatars');
