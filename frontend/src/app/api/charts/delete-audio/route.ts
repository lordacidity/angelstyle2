import { NextRequest, NextResponse } from 'next/server';
import { unlink } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

export const runtime = 'nodejs';

export async function DELETE(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });

  // Only allow deleting custom tracks, not the preloaded ones
  const filename = path.basename(url);
  if (!filename.startsWith('track-custom-') || !filename.endsWith('.mp3')) {
    return NextResponse.json({ error: 'Cannot delete preloaded tracks' }, { status: 400 });
  }

  const audioDir = path.join(process.cwd(), 'public', 'audio');
  const mp3Path = path.join(audioDir, filename);
  const jsonPath = path.join(audioDir, filename.replace('.mp3', '.json'));

  if (!existsSync(mp3Path)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  await unlink(mp3Path).catch(() => {});
  await unlink(jsonPath).catch(() => {});

  return NextResponse.json({ ok: true });
}
