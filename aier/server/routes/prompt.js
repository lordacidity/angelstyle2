import { Router } from 'express';
import { getProject, getSettings } from '../lib/store.js';
import { resolveStoragePath } from '../lib/paths.js';
import { draftPrompt } from '../lib/gemini.js';

const router = Router();

// POST /api/prompt { projectId } -> { prompt }
// Gemini reads the Admin instruction (settings.promptTemplate) + the freeze frame
// and drafts the final Kling prompt, which the user can edit before generating.
router.post('/', async (req, res) => {
  try {
    const { projectId } = req.body || {};
    const project = getProject(projectId);
    if (!project.framePath) {
      return res.status(400).json({ error: 'Pick a freeze frame first.' });
    }
    const settings = getSettings();

    // Show Gemini the same reference photos that become @Element1, so it can
    // describe #Element1 accurately instead of drafting the prompt blind.
    const refPaths = (settings.refs || []).map(resolveStoragePath).filter(Boolean);

    const prompt = await draftPrompt({
      framePath: project.framePath,
      refPaths,
      template: settings.promptTemplate,
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      apiKey: process.env.GEMINI_API_KEY,
    });

    res.json({ prompt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
