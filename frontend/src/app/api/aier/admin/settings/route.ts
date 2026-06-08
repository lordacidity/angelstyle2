import { saveSettings, publicState } from '@/lib/aier/store.js';

// GET /api/aier/admin/settings
export async function GET() {
  return Response.json(await publicState());
}

// PUT /api/aier/admin/settings (partial update of allowed fields)
export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));
  const allowed = ['klingModel', 'defaultDuration', 'cfgScale', 'promptTemplate', 'negativePrompt'];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) if (k in (body || {})) patch[k] = body[k];
  if ('defaultDuration' in patch) {
    const d = Math.round(Number(patch.defaultDuration));
    patch.defaultDuration = Math.min(15, Math.max(3, d || 5));
  }
  if ('cfgScale' in patch) patch.cfgScale = Math.min(1, Math.max(0, Number(patch.cfgScale) || 0.5));
  await saveSettings(patch);
  return Response.json(await publicState());
}
