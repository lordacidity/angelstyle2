'use client';

// useVidsLibrary — all the data plumbing for the Vids section: the folder tree,
// the video rows, which folder is open, and in-flight uploads. Thin optimistic
// wrapper over lib/vids-client (/api/vids/*); every action updates local state
// first and surfaces a failure through `error` rather than throwing into the UI.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as client from '@/lib/vids-client';
import type { PersonaParts } from '@/lib/vids-client';
import type { VidContextPatch, VidFolder, VidMark, VidPersona, VidRow } from '@/lib/vids-types';

export interface UploadItem {
  id: string;
  name: string;
  progress: number;   // 0..1
  error: string | null;
  done: boolean;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Video files by mime OR extension — Windows reports some .mov/.mkv drops with
// an empty type, so don't trust `type` alone.
export function isVideoFile(f: File): boolean {
  return f.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv)$/i.test(f.name);
}

// Stills, filed alongside the footage: End takes a photo as happily as a clip
// and holds it as a freeze frame (see isPhoto / PHOTO_LENGTH).
export function isPhotoFile(f: File): boolean {
  return f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(f.name);
}

export const isMediaFile = (f: File): boolean => isVideoFile(f) || isPhotoFile(f);

/** What to say when a drop had nothing usable in it. */
export const MEDIA_ONLY = 'Only videos (mp4, mov, webm) and photos (jpg, png, webp) can be added.';

export function useVidsLibrary(active: boolean) {
  const [folders, setFolders] = useState<VidFolder[]>([]);
  const [videos, setVideos] = useState<VidRow[]>([]);
  const [personas, setPersonas] = useState<VidPersona[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const loadedRef = useRef(false);
  const foldersRef = useRef<VidFolder[]>([]);
  useEffect(() => { foldersRef.current = folders; }, [folders]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const lib = await client.listLibrary();
      setFolders(lib.folders);
      setVideos(lib.videos);
      setPersonas(lib.personas ?? []);
      setError(null);
      loadedRef.current = true;
      setLoaded(true);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // First load when the section is shown.
  useEffect(() => {
    if (active && !loadedRef.current) void refresh();
  }, [active, refresh]);

  // ── Folders ─────────────────────────────────────────────────────────────────

  const createFolder = useCallback(async (name: string, parentId: string | null) => {
    const clean = name.trim();
    if (!clean) return null;
    try {
      const f = await client.createFolder(clean, parentId);
      setFolders((prev) => [...prev, f].sort((a, b) => a.name.localeCompare(b.name)));
      return f;
    } catch (e) {
      setError(msg(e));
      return null;
    }
  }, []);

  // Make sure the four fixed top-level folders exist. The server does the
  // get-or-create under a lock, so two tabs opening at once still end up with
  // one folder each rather than a duplicate set; we merge whatever comes back
  // by id, which is a no-op when the folder was already known.
  const ensureFolders = useCallback(async (names: string[]) => {
    for (const name of names) {
      if (foldersRef.current.some((f) => !f.parentId && f.name.trim().toLowerCase() === name.trim().toLowerCase())) {
        continue;
      }
      try {
        const f = await client.ensureFolder(name);
        setFolders((prev) => (prev.some((x) => x.id === f.id)
          ? prev
          : [...prev, f].sort((a, b) => a.name.localeCompare(b.name))));
      } catch (e) {
        setError(msg(e));
      }
    }
  }, []);

  const renameFolder = useCallback(async (id: string, name: string) => {
    const clean = name.trim();
    if (!clean) return;
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name: clean } : f)));
    try {
      await client.renameFolder(id, clean);
    } catch (e) {
      setError(msg(e));
      void refresh();
    }
  }, [refresh]);

  const deleteFolder = useCallback(async (id: string) => {
    // Everything under this folder goes too (cascade); the videos inside every
    // one of them drop back to the root (FK SET NULL). Mirror that locally.
    const doomed = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of folders) {
        if (f.parentId && doomed.has(f.parentId) && !doomed.has(f.id)) { doomed.add(f.id); grew = true; }
      }
    }
    const target = folders.find((f) => f.id === id);
    setFolders((prev) => prev.filter((f) => !doomed.has(f.id)));
    setVideos((prev) => prev.map((v) => (v.folderId && doomed.has(v.folderId) ? { ...v, folderId: null } : v)));
    setSelectedFolderId((cur) => (cur && doomed.has(cur) ? (target?.parentId ?? null) : cur));
    try {
      await client.deleteFolder(id);
    } catch (e) {
      setError(msg(e));
      void refresh();
    }
  }, [folders, refresh]);

  // ── Personas ────────────────────────────────────────────────────────────────
  // A persona bundles the three clips that always travel together (Start, Top A,
  // Top B). Deleting one drops the bundle only — its clips stay in the Persona
  // folder as unassigned footage, matching how folder deletes behave.

  const personaSorted = (list: VidPersona[]) => [...list].sort((a, b) => a.name.localeCompare(b.name));

  const createPersona = useCallback(async (name: string, parts: PersonaParts = {}) => {
    const clean = name.trim();
    if (!clean) return null;
    try {
      const p = await client.createPersona(clean, parts);
      setPersonas((prev) => personaSorted([...prev, p]));
      return p;
    } catch (e) {
      setError(msg(e));
      return null;
    }
  }, []);

  const updatePersona = useCallback(async (id: string, patch: PersonaParts & VidContextPatch & { name?: string }) => {
    const clean = patch.name === undefined ? undefined : patch.name.trim();
    if (clean !== undefined && !clean) return;
    const next = { ...patch, ...(clean === undefined ? {} : { name: clean }) };
    setPersonas((prev) => personaSorted(prev.map((p) => (p.id === id ? { ...p, ...next } : p))));
    try {
      await client.updatePersona(id, next);
    } catch (e) {
      setError(msg(e));
      void refresh();
    }
  }, [refresh]);

  const deletePersona = useCallback(async (id: string) => {
    setPersonas((prev) => prev.filter((p) => p.id !== id));
    try {
      await client.deletePersona(id);
    } catch (e) {
      setError(msg(e));
      void refresh();
    }
  }, [refresh]);

  // ── Videos ──────────────────────────────────────────────────────────────────

  const moveVideo = useCallback(async (id: string, folderId: string | null) => {
    let prevFolder: string | null | undefined;
    setVideos((prev) => prev.map((v) => {
      if (v.id !== id) return v;
      prevFolder = v.folderId;
      return { ...v, folderId };
    }));
    if (prevFolder === folderId) return;
    try {
      await client.moveVideo(id, folderId);
    } catch (e) {
      setError(msg(e));
      void refresh();
    }
  }, [refresh]);

  const renameVideo = useCallback(async (id: string, name: string) => {
    const clean = name.trim();
    if (!clean) return;
    setVideos((prev) => prev.map((v) => (v.id === id ? { ...v, name: clean } : v)));
    try {
      await client.renameVideo(id, clean);
    } catch (e) {
      setError(msg(e));
      void refresh();
    }
  }, [refresh]);

  // What a clip is showing, in your words. Optimistic like every other patch —
  // the field you are typing in must not wait on a round trip.
  //
  // Only the context: naming a clip is its own thing, asked for plainly when the
  // clip is filed and changed in the editor, so saying more about what a clip
  // shows never quietly renames it. A persona's context doesn't come through
  // here either — it lives on the persona itself.
  const setVideoContext = useCallback(async (id: string, patch: VidContextPatch) => {
    setVideos((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
    try {
      await client.setVideoContext(id, patch);
    } catch (e) {
      setError(msg(e));
      void refresh();
    }
  }, [refresh]);

  // The clip's context stretch by stretch. Replaces the whole list — the editor
  // always holds the authoritative set for the clip it has open.
  const setVideoMarks = useCallback(async (id: string, marks: VidMark[]) => {
    setVideos((prev) => prev.map((v) => (v.id === id ? { ...v, marks } : v)));
    try {
      await client.setVideoMarks(id, marks);
    } catch (e) {
      setError(msg(e));
      void refresh();
    }
  }, [refresh]);

  const deleteVideo = useCallback(async (row: VidRow) => {
    setVideos((prev) => prev.filter((v) => v.id !== row.id));
    // The FK is ON DELETE SET NULL, so any persona using this clip keeps its
    // name and loses just that part. Mirror it rather than waiting for a reload.
    setPersonas((prev) => prev.map((p) => ({
      ...p,
      startId: p.startId === row.id ? null : p.startId,
      topAId: p.topAId === row.id ? null : p.topAId,
      topBId: p.topBId === row.id ? null : p.topBId,
    })));
    try {
      await client.deleteVideo(row.id);
    } catch (e) {
      setError(msg(e));
      void refresh();
    }
  }, [refresh]);

  // ── Uploads ─────────────────────────────────────────────────────────────────

  const uploadOne = useCallback(async (blob: Blob, name: string, folderId: string | null): Promise<VidRow | null> => {
    const id = crypto.randomUUID();
    setUploads((u) => [...u, { id, name, progress: 0, error: null, done: false }]);
    const patch = (p: Partial<UploadItem>) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...p } : x)));
    try {
      const row = await client.uploadVideo(blob, {
        name,
        folderId,
        onProgress: (progress) => patch({ progress }),
      });
      setVideos((v) => [row, ...v]);
      patch({ progress: 1, done: true });
      // Finished rows linger briefly so the bar visibly completes, then clear.
      setTimeout(() => setUploads((u) => u.filter((x) => x.id !== id)), 2500);
      return row;
    } catch (e) {
      patch({ error: msg(e) });
      return null;
    }
  }, []);

  // Sequential on purpose — parallel multi-GB uploads just fight for bandwidth
  // and make every progress bar crawl.
  const uploadFiles = useCallback(async (files: FileList | File[], folderId: string | null) => {
    const list = Array.from(files).filter(isMediaFile);
    if (list.length === 0) { setError(MEDIA_ONLY); return; }
    for (const file of list) await uploadOne(file, file.name, folderId);
  }, [uploadOne]);

  const uploadBlob = useCallback(
    (blob: Blob, name: string, folderId: string | null) => uploadOne(blob, name, folderId),
    [uploadOne],
  );

  // Save edited footage over the clip it came from. The row keeps its id, so the
  // folder it is filed in and any persona part pointing at it are unaffected —
  // an edit changes the clip, it doesn't make a second one. Rides the same
  // progress list as a fresh upload.
  const replaceVideo = useCallback(
    async (id: string, blob: Blob, name?: string, hasSfx?: boolean, marks?: VidMark[]): Promise<VidRow | null> => {
      const jobId = crypto.randomUUID();
      const label = name ?? videos.find((v) => v.id === id)?.name ?? 'clip';
      setUploads((u) => [...u, { id: jobId, name: label, progress: 0, error: null, done: false }]);
      const patch = (p: Partial<UploadItem>) => setUploads((u) => u.map((x) => (x.id === jobId ? { ...x, ...p } : x)));
      try {
        const row = await client.replaceVideo(id, blob, {
          name, hasSfx, marks, onProgress: (progress) => patch({ progress }),
        });
        setVideos((prev) => prev.map((v) => (v.id === row.id ? row : v)));
        patch({ progress: 1, done: true });
        setTimeout(() => setUploads((u) => u.filter((x) => x.id !== jobId)), 2500);
        return row;
      } catch (e) {
        patch({ error: msg(e) });
        return null;
      }
    },
    [videos],
  );

  const dismissUpload = useCallback((id: string) => {
    setUploads((u) => u.filter((x) => x.id !== id));
  }, []);

  return {
    folders, videos, personas, selectedFolderId, setSelectedFolderId,
    loading, loaded, error, setError, uploads, dismissUpload, refresh,
    createFolder, ensureFolders, renameFolder, deleteFolder,
    createPersona, updatePersona, deletePersona,
    moveVideo, renameVideo, deleteVideo, setVideoContext, setVideoMarks,
    uploadFiles, uploadBlob, replaceVideo,
  };
}

export type VidsLib = ReturnType<typeof useVidsLibrary>;
