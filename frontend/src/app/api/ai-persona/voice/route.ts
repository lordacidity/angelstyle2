// POST /api/ai-persona/voice — the voice Kling animates the portrait to.
//
// Two ways in, one answer out ({ audioUrl }):
//   JSON { script }          ElevenLabs v3 on fal reads it as Liam, every other
//                            input left at fal's default
//   multipart, field `voice` a recording made elsewhere, put on fal storage as
//                            it is — no ElevenLabs call at all
// The audio stays on fal storage; that URL is what Kling is handed next, and
// what the card plays back.
//
// A separate route from the video on purpose — the voice takes seconds and the
// video takes minutes, and keeping them apart means a video can be retried
// against audio that already exists without paying for the reading again.
//
// Behind the site gate like every /api/* route.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { speak, upload } from '@/lib/aipersona/fal';
import {
  MAX_SCRIPT_CHARS, MAX_VOICE_BYTES, VOICE, VOICE_EXTENSIONS, isVoiceFile, type VoiceResponse,
} from '@/lib/aipersona/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const Body = z.object({
  script: z.string().trim().min(1).max(MAX_SCRIPT_CHARS),
});

export async function POST(req: NextRequest) {
  if (req.headers.get('content-type')?.startsWith('multipart/form-data')) return uploaded(req);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Give me a script of 1 to ${MAX_SCRIPT_CHARS} characters.` },
      { status: 400 },
    );
  }

  try {
    const { audioUrl, ms } = await speak(parsed.data.script);
    return NextResponse.json({ audioUrl, voice: VOICE, ms } satisfies VoiceResponse);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

async function uploaded(req: NextRequest) {
  let voice: unknown;
  try {
    voice = (await req.formData()).get('voice');
  } catch {
    return NextResponse.json({ error: 'Expected a multipart form with a recording.' }, { status: 400 });
  }

  if (!(voice instanceof File) || voice.size === 0) {
    return NextResponse.json({ error: 'No recording in the request.' }, { status: 400 });
  }
  if (!isVoiceFile(voice)) {
    return NextResponse.json(
      { error: `Kling reads ${VOICE_EXTENSIONS.join(', ').toUpperCase()} — "${voice.name}" isn't one of those.` },
      { status: 400 },
    );
  }
  if (voice.size > MAX_VOICE_BYTES) {
    return NextResponse.json(
      { error: `That recording is ${(voice.size / 1024 / 1024).toFixed(1)}MB; the limit is ${(MAX_VOICE_BYTES / 1024 / 1024).toFixed(1)}MB.` },
      { status: 413 },
    );
  }

  const t0 = Date.now();
  try {
    const audioUrl = await upload(voice, 'voice upload');
    return NextResponse.json({ audioUrl, voice: 'your recording', ms: Date.now() - t0 } satisfies VoiceResponse);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
