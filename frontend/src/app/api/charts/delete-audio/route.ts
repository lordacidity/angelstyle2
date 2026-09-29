// DELETE /api/charts/delete-audio?url=… — take an added song out of the
// library. One in the Vids bucket goes from there; one in public/audio can only
// go on localhost, since a deployment can't write to its own files.
import { NextRequest, NextResponse } from 'next/server';
import { unlink } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { AUDIO_DIR } from '@/lib/audio-library';
import { deleteCloudTrack, errMessage } from '@/lib/vids-db';

export const runtime = 'nodejs';

export async function DELETE(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });

  // Only allow deleting custom tracks, not the preloaded ones
  const filename = path.basename(url);
  if (!filename.startsWith('track-custom-') || !filename.endsWith('.mp3')) {
    return NextResponse.json({ error: 'Cannot delete preloaded tracks' }, { status: 400 });
  }

  try {
    if (await deleteCloudTrack(filename)) return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[delete-audio]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }

  const mp3Path = path.join(AUDIO_DIR, filename);
  const jsonPath = path.join(AUDIO_DIR, filename.replace('.mp3', '.json'));

  if (!existsSync(mp3Path)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  try {
    await unlink(mp3Path);
  } catch (err) {
    console.error('[delete-audio]', err);
    return NextResponse.json({ error: "This song ships with the app and can't be deleted here." }, { status: 400 });
  }
  await unlink(jsonPath).catch(() => {});

  return NextResponse.json({ ok: true });
}
