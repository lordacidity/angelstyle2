'use client';

// A clip that exists in this tab and nowhere else: the ChatGPT recording the
// Bottom card renders (components/chatgpt/chatgpt-video). It used to go up to
// the library the moment it was rendered, which left one throwaway clip in
// Supabase for every video ever made. Now the bytes stay here, in memory and
// behind a blob: URL, shaped like a library row so the stage, the plan, the
// captions and the exporter take it like any other clip — and they go the
// moment the clip is replaced, the build is reset or the page is left.
// Nothing about it reaches the server: the record an export writes down
// carries its name and nothing else, because there is no row to point at.

import type { VidMark, VidRow, VidTheme } from '@/lib/vids-types';

/** The bytes behind every local row still alive, by the row's id. */
const clips = new Map<string, { blob: Blob; urls: string[] }>();

export interface LocalClipMeta {
  name: string;
  context: string;
  marks: VidMark[];
  /** Seconds. Known from the render, so nothing has to be probed. */
  duration: number;
  width: number;
  height: number;
  /** Whether its audio track is the keyboard — what lets the builder play it. */
  hasSfx: boolean;
  /** A frame out of the middle, for the card. */
  poster?: Blob | null;
  /** Which way Pauv was, for a clip that IS a Pauv recording — what the frame
   *  puts behind a Bottom B (vidsPlan itemBacking). Vids 2 renders its Bottom B
   *  here rather than filing one, so it is the only caller that sets it; the
   *  ChatGPT recording is not a Pauv page and leaves it null. */
  theme?: VidTheme | null;
}

/** Take the bytes in and hand back the row the rest of the section reads. */
export function makeLocalClip(blob: Blob, meta: LocalClipMeta): VidRow {
  // A real UUID, because the record an export writes down checks every clip
  // id is one (api/vids/recipes/spec). It answers to no row: a build brought
  // back by its code finds this slot's clip gone from the library, which is
  // the truth of it.
  const id = crypto.randomUUID();
  const url = URL.createObjectURL(blob);
  const thumbUrl = meta.poster ? URL.createObjectURL(meta.poster) : null;
  clips.set(id, { blob, urls: thumbUrl ? [url, thumbUrl] : [url] });
  return {
    id,
    folderId: null,
    name: meta.name,
    storagePath: '',
    thumbPath: null,
    mimeType: blob.type || 'video/mp4',
    sizeBytes: blob.size,
    duration: meta.duration,
    width: meta.width,
    height: meta.height,
    createdAt: new Date().toISOString(),
    url,
    thumbUrl,
    context: meta.context,
    marks: meta.marks,
    hasSfx: meta.hasSfx,
    sourcePath: null,
    sourceUrl: null,
    edit: null,
    clipable: false,
    theme: meta.theme ?? null,
  };
}

/** Whether this row is one of ours rather than the library's. */
export const isLocalClip = (v: Pick<VidRow, 'id'>): boolean => clips.has(v.id);

/** The bytes behind a local row — what the exporter reads, rather than
 *  fetching the blob: URL in ranges. Null for a library clip. */
export const localClipBlob = (v: Pick<VidRow, 'id'>): Blob | null => clips.get(v.id)?.blob ?? null;

/** Let the bytes go: its URLs stop working and the memory comes back. Safe to
 *  call twice, and on a library row, where it does nothing. */
export function releaseLocalClip(v: Pick<VidRow, 'id'>): void {
  const held = clips.get(v.id);
  if (!held) return;
  clips.delete(v.id);
  for (const u of held.urls) URL.revokeObjectURL(u);
}
