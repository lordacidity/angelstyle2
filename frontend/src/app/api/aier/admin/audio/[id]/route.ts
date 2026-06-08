import fs from 'node:fs';
import { getSettings, saveSettings, publicState } from '@/lib/aier/store.js';

// DELETE /api/aier/admin/audio/:id
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const settings = await getSettings();
  const clip = (settings.audio || []).find((a: { id: string; file?: string }) => a.id === id);
  if (clip?.file) { try { fs.unlinkSync(clip.file); } catch { /* already gone */ } }
  await saveSettings({ audio: (settings.audio || []).filter((a: { id: string }) => a.id !== id) });
  return Response.json(await publicState());
}
