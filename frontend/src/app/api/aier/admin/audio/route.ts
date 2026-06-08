import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AUDIO_DIR, toMediaUrl } from '@/lib/aier/paths.js';
import { probe } from '@/lib/aier/exec.js';
import { getSettings, saveSettings, publicState } from '@/lib/aier/store.js';

// POST /api/aier/admin/audio (multipart: audio, label) — music/sfx/voice for the editor.
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get('audio');
  if (!(file instanceof File)) return Response.json({ error: 'No audio uploaded.' }, { status: 400 });
  const label = String(form.get('label') || '').trim();
  const ext = path.extname(file.name).toLowerCase() || '.mp3';
  const dest = path.join(AUDIO_DIR, `${randomUUID()}${ext}`);
  fs.writeFileSync(dest, Buffer.from(await file.arrayBuffer()));

  let duration: number | null = null;
  try { duration = (await probe(dest)).duration || null; } catch { /* unknown */ }

  const settings = await getSettings();
  const clip = {
    id: randomUUID(),
    label: label || path.parse(file.name).name || `Audio ${(settings.audio?.length || 0) + 1}`,
    file: dest,
    url: toMediaUrl(dest),
    duration,
  };
  await saveSettings({ audio: [...(settings.audio || []), clip] });
  return Response.json(await publicState());
}
