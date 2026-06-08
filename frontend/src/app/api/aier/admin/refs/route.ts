import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { REFS_DIR, toMediaUrl } from '@/lib/aier/paths.js';
import { getSettings, saveSettings, publicState } from '@/lib/aier/store.js';

// POST /api/aier/admin/refs (multipart: image, label) — refs[0] becomes @Element1 (frontal).
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get('image');
  if (!(file instanceof File)) return Response.json({ error: 'No image uploaded.' }, { status: 400 });
  const label = String(form.get('label') || '').trim();
  const ext = path.extname(file.name).toLowerCase() || '.png';
  const dest = path.join(REFS_DIR, `${randomUUID()}${ext}`);
  fs.writeFileSync(dest, Buffer.from(await file.arrayBuffer()));

  const settings = await getSettings();
  const ref = {
    id: randomUUID(),
    label: label || `Reference ${(settings.refs?.length || 0) + 1}`,
    file: dest,
    url: toMediaUrl(dest),
  };
  await saveSettings({ refs: [...(settings.refs || []), ref] });
  return Response.json(await publicState());
}
