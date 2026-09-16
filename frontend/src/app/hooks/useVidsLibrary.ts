'use client';

// useVidsLibrary — all the data plumbing for the Vids section: the folder tree,
// the video rows, which folder is open, and in-flight uploads. Thin optimistic
// wrapper over lib/vids-client (/api/vids/*); every action updates local state
// first and surfaces a failure through `error` rather than throwing into the UI.
//
// The library is shared, so it is read again each time the section is shown and
// each time the Build page is opened (refreshWhenIdle) — but never over the top
// of our own writes still on their way: a read that lands while an upload or a
// save is in flight would be the library as it stood before it, and would wipe
// the row that write is about to make. So every write is counted in and out
// (tracked), a read asked for mid-write waits for the last of them, and a read
// that a write finished underneath is thrown away and taken again.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as client from '@/lib/vids-client';
import type { PersonaParts, PersonaUpdate } from '@/lib/vids-client';
import { PERSONA_PARTS, PERSONA_PART_LABEL } from '@/lib/vids-types';
import type {
  ClipableKind, VidClipableFlag, VidContextPatch, VidEdit, VidFolder, VidLink, VidMark, VidPersona, VidRow,
} from '@/lib/vids-types';

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

/** What a clip can be filed with beyond its name and folder — see
 *  CreateVideoInput. */
export interface UploadExtras {
  context?: string;
  marks?: VidMark[];
  hasSfx?: boolean;
  /** A render's recording and the edit that made it — see CreateVideoInput. */
  source?: Blob;
  sourceName?: string;
  edit?: VidEdit | null;
}

export function useVidsLibrary(active: boolean) {
  const [folders, setFolders] = useState<VidFolder[]>([]);
  const [videos, setVideos] = useState<VidRow[]>([]);
  const [personas, setPersonas] = useState<VidPersona[]>([]);
  // Which Bottom Bs follow on from which Bottom A — see VidLink.
  const [links, setLinkRows] = useState<VidLink[]>([]);
  // The songs and caption looks on offer to the clippers — see VidClipableFlag.
  // (A persona's or clip's flag rides on its own row.)
  const [clipable, setClipableRows] = useState<VidClipableFlag[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const loadedRef = useRef(false);
  const foldersRef = useRef<VidFolder[]>([]);
  useEffect(() => { foldersRef.current = folders; }, [folders]);
  // Read from inside callbacks that would otherwise close over a render-old copy.
  const videosRef = useRef<VidRow[]>([]);
  useEffect(() => { videosRef.current = videos; }, [videos]);
  const personasRef = useRef<VidPersona[]>([]);
  useEffect(() => { personasRef.current = personas; }, [personas]);

  // Writes on their way to the server, and how many have finished — what keeps
  // a read from landing on top of one (see the header).
  const inFlightRef = useRef(0);
  const settledRef = useRef(0);
  const wantRefreshRef = useRef(false);
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // A write that finishes while the read is out makes the read stale the
      // moment it lands — the server may have answered before it took. Read
      // again, until one comes back with nothing having changed under it.
      let applied = false;
      for (let pass = 0; pass < 4 && !applied; pass++) {
        const settledAt = settledRef.current;
        const lib = await client.listLibrary();
        if (settledRef.current !== settledAt) continue;
        setFolders(lib.folders);
        setVideos(lib.videos);
        setPersonas(lib.personas ?? []);
        setLinkRows(lib.links ?? []);
        setClipableRows(lib.clipable ?? []);
        applied = true;
      }
      if (!applied) wantRefreshRef.current = true;
      setError(null);
      loadedRef.current = true;
      setLoaded(true);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
  }, []);
  refreshRef.current = refresh;

  /** Every write to the server goes through here, so a read knows to wait. */
  const tracked = useCallback(async <T,>(p: Promise<T>): Promise<T> => {
    inFlightRef.current++;
    try {
      return await p;
    } finally {
      inFlightRef.current--;
      settledRef.current++;
      if (inFlightRef.current === 0 && wantRefreshRef.current) {
        wantRefreshRef.current = false;
        void refreshRef.current();
      }
    }
  }, []);

  /** Read the library again — now, or as soon as the last of our own writes
   *  has landed, so nothing of ours is read back before it is there. */
  const refreshWhenIdle = useCallback(() => {
    if (inFlightRef.current > 0) { wantRefreshRef.current = true; return; }
    void refresh();
  }, [refresh]);

  // First load when the section is shown; every showing after that reads it
  // again, since someone else may have filed footage in the meantime.
  useEffect(() => {
    if (!active) return;
    if (loadedRef.current) refreshWhenIdle();
    else void refresh();
  }, [active, refresh, refreshWhenIdle]);

  // ── Folders ─────────────────────────────────────────────────────────────────

  const createFolder = useCallback(async (name: string, parentId: string | null) => {
    const clean = name.trim();
    if (!clean) return null;
    try {
      const f = await tracked(client.createFolder(clean, parentId));
      setFolders((prev) => [...prev, f].sort((a, b) => a.name.localeCompare(b.name)));
      return f;
    } catch (e) {
      setError(msg(e));
      return null;
    }
  }, [tracked]);

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
        const f = await tracked(client.ensureFolder(name));
        setFolders((prev) => (prev.some((x) => x.id === f.id)
          ? prev
          : [...prev, f].sort((a, b) => a.name.localeCompare(b.name))));
      } catch (e) {
        setError(msg(e));
      }
    }
  }, [tracked]);

  const renameFolder = useCallback(async (id: string, name: string) => {
    const clean = name.trim();
    if (!clean) return;
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name: clean } : f)));
    try {
      await tracked(client.renameFolder(id, clean));
    } catch (e) {
      setError(msg(e));
      void refresh();
    }
  }, [refresh, tracked]);

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
      await tracked(client.deleteFolder(id));
    } catch (e) {
      setError(msg(e));
      void refresh();
    }
  }, [folders, refresh, tracked]);

  // ── Personas ────────────────────────────────────────────────────────────────
  // A persona bundles the three clips that always travel together (Start, Top A,
  // Top B). Deleting one drops the bundle only — its clips stay in the Persona
  // folder as unassigned footage, matching how folder deletes behave.

  const personaSorted = (list: VidPersona[]) => [...list].sort((a, b) => a.name.localeCompare(b.name));

  const createPersona = useCallback(async (name: string, parts: PersonaParts = {}) => {
    const clean = name.trim();
    if (!clean) return null;
    try {
      const p = await tracked(client.createPersona(clean, parts));
      setPersonas((prev) => personaSorted([...prev, p]));
      return p;
    } catch (e) {
      setError(msg(e));
      return null;
    }
  }, [tracked]);

  // A rename carries the persona's clips with it, where they are still called
  // what they were called when they were filed ("Aiden — Start"): a persona
  // renamed anywhere — the Clippers page, the right-click popup — is renamed
  // everywhere, its three parts included. A part someone has named by hand is
  // left as it is.
  const updatePersona = useCallback(async (id: string, patch: PersonaUpdate) => {
    const clean = patch.name === undefined ? undefined : patch.name.trim();
    if (clean !== undefined && !clean) return;
    const next = { ...patch, ...(clean === undefined ? {} : { name: clean }) };
    const before = personasRef.current.find((p) => p.id === id);
    const parts: { id: string; name: string }[] = [];
    if (clean !== undefined && before && before.name !== clean) {
      for (const part of PERSONA_PARTS) {
        const v = videosRef.current.find((x) => x.id === before[part]);
        if (v && v.name === `${before.name} — ${PERSONA_PART_LABEL[part]}`) {
          parts.push({ id: v.id, name: `${clean} — ${PERSONA_PART_LABEL[part]}` });
        }
      }
    }
    setPersonas((prev) => personaSorted(prev.map((p) => (p.id === id ? { ...p, ...next } : p))));
    if (parts.length) {
      setVideos((prev) => prev.map((v) => {
        const r = parts.find((x) => x.id === v.id);
        return r ? { ...v, name: r.name } : v;
      }));
    }
    try {
      await tracked(client.updatePersona(id, next));
      await Promise.all(parts.map((r) => tracked(client.renameVideo(r.id, r.name))));
    } catch (e) {
      setError(msg(e));
      void refresh();
    }
  }, [refresh, tracked]);

  const deletePersona = useCallback(async (id: string) => {
    setPersonas((prev) => prev.filter((p) => p.id !== id));
    try {
      await tracked(client.deletePersona(id));
    } catch (e) {
      setError(msg(e));
      void refresh();
    }
  }, [refresh, tracked]);

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
      await tracked(client.moveVideo(id, folderId));
    } catch (e) {
      setError(msg(e));
      void refresh();
    }
  }, [refresh, tracked]);

  const renameVideo = useCallback(async (id: string, name: string) => {
    const clean = name.trim();
    if (!clean) return;
    setVideos((prev) => prev.map((v) => (v.id === id ? { ...v, name: clean } : v)));
    try {
      await tracked(client.renameVideo(id, clean));
    } catch (e) {
      setError(msg(e));
      void refresh();
    }
  }, [refresh, tracked]);

  // What a clip is showing, in your words — and its name, when the right-click
  // popup asks for both at once. Optimistic like every other patch: the field
  // you are typing in must not wait on a round trip. A blank name is dropped
  // rather than sent, since a clip can't be called nothing. A persona's context
  // doesn't come through here — it lives on the persona itself.
  const setVideoContext = useCallback(async (id: string, patch: VidContextPatch & { name?: string }) => {
    const { name, ...rest } = patch;
    const clean = name?.trim();
    const next: VidContextPatch & { name?: string } = clean ? { ...rest, name: clean } : rest;
    setVideos((prev) => prev.map((v) => (v.id === id ? { ...v, ...next } : v)));
    try {
      await tracked(client.setVideoContext(id, next));
    } catch (e) {
      setError(msg(e));
      void refresh();
    }
  }, [refresh, tracked]);

  // The clip's context stretch by stretch. Replaces the whole list — the editor
  // always holds the authoritative set for the clip it has open.
  const setVideoMarks = useCallback(async (id: string, marks: VidMark[]) => {
    setVideos((prev) => prev.map((v) => (v.id === id ? { ...v, marks } : v)));
    try {
      await tracked(client.setVideoMarks(id, marks));
    } catch (e) {
      setError(msg(e));
      void refresh();
    }
  }, [refresh, tracked]);

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
    // Its pairs go with it (CASCADE) — on either side.
    setLinkRows((prev) => prev.filter((l) => l.bottomAId !== row.id && l.bottomBId !== row.id));
    try {
      await tracked(client.deleteVideo(row.id));
    } catch (e) {
      setError(msg(e));
      void refresh();
    }
  }, [refresh, tracked]);

  // ── Clipable ────────────────────────────────────────────────────────────────
  // What the clippers get — see VidClipable. A persona's flag goes through
  // updatePersona like its name; a clip's and a song's or caption look's are
  // here. Optimistic like everything else: a switch must flip as it is pressed,
  // and comes back from the server if the write didn't take.

  const setVideoClipable = useCallback(async (id: string, on: boolean) => {
    setVideos((prev) => prev.map((v) => (v.id === id ? { ...v, clipable: on } : v)));
    try {
      await tracked(client.setVideoClipable(id, on));
    } catch (e) {
      setError(msg(e));
      void refresh();
    }
  }, [refresh, tracked]);

  const setClipable = useCallback(async (kind: ClipableKind, key: string, on: boolean) => {
    setClipableRows((prev) => {
      const rest = prev.filter((f) => !(f.kind === kind && f.key === key));
      return on ? [...rest, { kind, key }] : rest;
    });
    try {
      await tracked(client.setClipable(kind, key, on));
    } catch (e) {
      setError(msg(e));
      void refresh();
    }
  }, [refresh, tracked]);

  // ── Songs ───────────────────────────────────────────────────────────────────
  // The audio library isn't part of the library payload — each page lists it
  // for itself — so a rename hands back whether it took, and the page that
  // asked keeps its own list right.

  const renameTrack = useCallback(async (url: string, label: string): Promise<boolean> => {
    const clean = label.trim();
    if (!clean) return false;
    try {
      await tracked(client.renameTrack(url, clean));
      return true;
    } catch (e) {
      setError(msg(e));
      return false;
    }
  }, [tracked]);

  // ── Links ───────────────────────────────────────────────────────────────────
  // The Bottom Bs that follow on from one Bottom A, replaced as a whole set: the
  // Link page ticks and unticks tiles, and each tick sends the list as it now
  // stands. Optimistic like everything else here — a tick must not wait on a
  // round trip — and put back from the server if the write didn't take.

  const setLinks = useCallback(async (bottomAId: string, bottomBIds: string[]) => {
    const wanted = Array.from(new Set(bottomBIds)).filter((id) => id !== bottomAId);
    setLinkRows((prev) => [
      ...prev.filter((l) => l.bottomAId !== bottomAId),
      ...wanted.map((bottomBId) => ({ bottomAId, bottomBId })),
    ]);
    try {
      await tracked(client.setLinks(bottomAId, wanted));
    } catch (e) {
      setError(msg(e));
      void refresh();
    }
  }, [refresh, tracked]);

  // ── Uploads ─────────────────────────────────────────────────────────────────

  const uploadOne = useCallback(async (
    blob: Blob, name: string, folderId: string | null, extras: UploadExtras = {},
  ): Promise<VidRow | null> => {
    const id = crypto.randomUUID();
    setUploads((u) => [...u, { id, name, progress: 0, error: null, done: false }]);
    const patch = (p: Partial<UploadItem>) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...p } : x)));
    try {
      const row = await tracked(client.uploadVideo(blob, {
        name,
        folderId,
        ...extras,
        onProgress: (progress) => patch({ progress }),
      }));
      setVideos((v) => [row, ...v]);
      patch({ progress: 1, done: true });
      // Finished rows linger briefly so the bar visibly completes, then clear.
      setTimeout(() => setUploads((u) => u.filter((x) => x.id !== id)), 2500);
      return row;
    } catch (e) {
      patch({ error: msg(e) });
      return null;
    }
  }, [tracked]);

  // Sequential on purpose — parallel multi-GB uploads just fight for bandwidth
  // and make every progress bar crawl.
  const uploadFiles = useCallback(async (files: FileList | File[], folderId: string | null) => {
    const list = Array.from(files).filter(isMediaFile);
    if (list.length === 0) { setError(MEDIA_ONLY); return; }
    for (const file of list) await uploadOne(file, file.name, folderId);
  }, [uploadOne]);

  /** One clip up, with — when the intake run is the one saving it — what it
   *  shows, its marks and whether the keyboard is on it, all at once. */
  const uploadBlob = useCallback(
    (blob: Blob, name: string, folderId: string | null, extras?: UploadExtras) => uploadOne(blob, name, folderId, extras),
    [uploadOne],
  );

  // Save edited footage over the clip it came from. The row keeps its id, so the
  // folder it is filed in and any persona part pointing at it are unaffected —
  // an edit changes the clip, it doesn't make a second one. Rides the same
  // progress list as a fresh upload.
  const replaceVideo = useCallback(
    async (
      id: string, blob: Blob, name?: string, hasSfx?: boolean, marks?: VidMark[], edit?: VidEdit | null,
    ): Promise<VidRow | null> => {
      const jobId = crypto.randomUUID();
      const label = name ?? videos.find((v) => v.id === id)?.name ?? 'clip';
      setUploads((u) => [...u, { id: jobId, name: label, progress: 0, error: null, done: false }]);
      const patch = (p: Partial<UploadItem>) => setUploads((u) => u.map((x) => (x.id === jobId ? { ...x, ...p } : x)));
      try {
        const row = await tracked(client.replaceVideo(id, blob, {
          name, hasSfx, marks, edit, onProgress: (progress) => patch({ progress }),
        }));
        setVideos((prev) => prev.map((v) => (v.id === row.id ? row : v)));
        patch({ progress: 1, done: true });
        setTimeout(() => setUploads((u) => u.filter((x) => x.id !== jobId)), 2500);
        return row;
      } catch (e) {
        patch({ error: msg(e) });
        return null;
      }
    },
    [videos, tracked],
  );

  const dismissUpload = useCallback((id: string) => {
    setUploads((u) => u.filter((x) => x.id !== id));
  }, []);

  return {
    folders, videos, personas, links, clipable, selectedFolderId, setSelectedFolderId,
    loading, loaded, error, setError, uploads, dismissUpload, refresh, refreshWhenIdle,
    createFolder, ensureFolders, renameFolder, deleteFolder,
    createPersona, updatePersona, deletePersona,
    moveVideo, renameVideo, deleteVideo, setVideoContext, setVideoMarks,
    setLinks,
    setVideoClipable, setClipable, renameTrack,
    uploadFiles, uploadBlob, replaceVideo,
  };
}

export type VidsLib = ReturnType<typeof useVidsLibrary>;
