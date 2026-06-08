import fs from 'node:fs';
import { STORAGE } from '@/lib/aier/paths.js';
import { getSettings, saveSettings, publicState } from '@/lib/aier/store.js';

// DELETE /api/aier/admin/refs/:id
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const settings = await getSettings();
  const ref = (settings.refs || []).find((r: { id: string; file?: string }) => r.id === id);
  // Only unlink files that live in storage — never the bundled default refs in public/.
  if (ref?.file && ref.file.startsWith(STORAGE)) { try { fs.unlinkSync(ref.file); } catch { /* already gone */ } }
  await saveSettings({ refs: (settings.refs || []).filter((r: { id: string }) => r.id !== id) });
  return Response.json(await publicState());
}
