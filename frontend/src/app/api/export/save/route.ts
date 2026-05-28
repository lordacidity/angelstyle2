// Save an exported video straight to disk instead of going through the
// browser's download folder. Mirrors Phonedeck's image-download behaviour:
// files land in ~/Downloads/copyright free images/MM-DD-YYYY/. The Studio's
// Next.js server runs locally on the user's machine, so it can write there
// directly. Body = raw video bytes; ?name= = desired (pre-extension) filename.

import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const runtime = 'nodejs';

const BASE_DIR = path.join(os.homedir(), 'Downloads', 'copyright free images');

// Local-time date bucket (NOT UTC) so "today" matches the user's wall clock —
// must stay in lockstep with Phonedeck's todayFolderName().
function todayFolderName(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd}-${d.getFullYear()}`;
}

// Strip characters Windows forbids in filenames, collapse whitespace, cap
// length, and drop trailing dots/spaces (Windows silently removes them).
// Keeps it human-readable — spaces and hyphens are fine in filenames.
function safeName(raw: string): string {
  const cleaned = raw
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 70)
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned || 'export';
}

export async function POST(req: NextRequest) {
  try {
    const rawName = new URL(req.url).searchParams.get('name') ?? 'export';
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.byteLength === 0) {
      return NextResponse.json({ error: 'empty body' }, { status: 400 });
    }

    const dir = path.join(BASE_DIR, todayFolderName());
    fs.mkdirSync(dir, { recursive: true });

    // Avoid clobbering an earlier export with the same caption — append (N).
    const base = safeName(rawName);
    let filename = `${base}.mp4`;
    let target = path.join(dir, filename);
    let n = 1;
    while (fs.existsSync(target)) {
      filename = `${base} (${n}).mp4`;
      target = path.join(dir, filename);
      n++;
    }
    fs.writeFileSync(target, buf);
    return NextResponse.json({ ok: true, dir, filename });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
