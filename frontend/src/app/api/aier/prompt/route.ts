import { getProject, getSettings } from '@/lib/aier/store.js';
import { resolveStoragePath } from '@/lib/aier/paths.js';
import { draftPrompt } from '@/lib/aier/gemini.js';

// Gemini reads the Admin instruction (settings.promptTemplate) + the freeze frame and drafts
// the final Kling prompt, which the user can edit before generating.
export async function POST(req: Request) {
  try {
    const { projectId } = await req.json().catch(() => ({}));
    const project = getProject(projectId);
    if (!project.framePath) {
      return Response.json({ error: 'Pick a freeze frame first.' }, { status: 400 });
    }
    const settings = getSettings();
    // Show Gemini the same reference photos that become @Element1.
    const refPaths = (settings.refs || []).map(resolveStoragePath).filter(Boolean);
    const prompt = await draftPrompt({
      framePath: project.framePath,
      refPaths,
      template: settings.promptTemplate,
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      apiKey: process.env.GEMINI_API_KEY || '',
    });
    return Response.json({ prompt });
  } catch (err: unknown) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
