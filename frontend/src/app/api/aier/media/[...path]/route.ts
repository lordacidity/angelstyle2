import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { STORAGE } from '@/lib/aier/paths.js';

// Serves runtime media (source videos, frames, kling clips, exports, refs, audio) from the
// Aier storage dir — the Next equivalent of the old Express `express.static('/media')`.
// Supports HTTP range requests so the <video> player can seek.

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg',
};

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params;
  const rel = (parts || []).map((p) => decodeURIComponent(p)).join('/');
  const root = path.resolve(STORAGE);
  const abs = path.resolve(root, rel);
  // Path-traversal guard: never serve anything outside STORAGE.
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    return new Response('Forbidden', { status: 403 });
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  if (!stat.isFile()) return new Response('Not found', { status: 404 });

  const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
  const size = stat.size;
  const range = req.headers.get('range');

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    if (!Number.isFinite(start) || start < 0) start = 0;
    if (!Number.isFinite(end) || end >= size) end = size - 1;
    if (start > end) {
      return new Response('Range Not Satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    const body = Readable.toWeb(fs.createReadStream(abs, { start, end })) as unknown as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      },
    });
  }

  const body = Readable.toWeb(fs.createReadStream(abs)) as unknown as ReadableStream;
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    },
  });
}
