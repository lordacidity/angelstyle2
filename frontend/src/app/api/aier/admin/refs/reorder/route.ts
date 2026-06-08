import { getSettings, saveSettings, publicState } from '@/lib/aier/store.js';

// POST /api/aier/admin/refs/reorder { ids: [...] } (first = frontal "@Element1")
export async function POST(req: Request) {
  const { ids } = await req.json().catch(() => ({}));
  const settings = await getSettings();
  const byId = new Map((settings.refs || []).map((r: { id: string }) => [r.id, r]));
  const reordered = (ids || []).map((id: string) => byId.get(id)).filter(Boolean);
  // Append any not mentioned, to avoid data loss.
  for (const r of settings.refs || []) if (!ids?.includes(r.id)) reordered.push(r);
  await saveSettings({ refs: reordered });
  return Response.json(await publicState());
}
