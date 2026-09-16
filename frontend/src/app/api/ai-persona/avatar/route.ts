// /api/ai-persona/avatar — the portrait, made to say it.
//
//   POST { imageUrl, audioUrl } -> { requestId }   queues Kling AI Avatar
//   GET  ?requestId=…           -> where that job got to, and the mp4 at the end
//
// Queued rather than awaited: a finished video is often minutes away, so the
// section polls the GET and a slow queue can never hang a request. It also means
// a job outlives a page reload — the request id is all you need to pick it back
// up.
//
// No prompt is sent. See submitAvatar() for why.
//
// Behind the site gate like every /api/* route.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { avatarResult, avatarStatus, submitAvatar } from '@/lib/aipersona/fal';
import type { AvatarResponse, AvatarStatusResponse } from '@/lib/aipersona/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Both URLs come straight back from our own two routes, so they are fal's. */
const falUrl = z.string().url().refine(u => {
  try {
    return /(^|\.)fal\.(media|ai|run)$/.test(new URL(u).hostname);
  } catch {
    return false;
  }
}, 'expected a fal.media URL');

const Body = z.object({ imageUrl: falUrl, audioUrl: falUrl });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Need the uploaded photo URL and the generated audio URL.' }, { status: 400 });
  }

  try {
    const requestId = await submitAvatar(parsed.data.imageUrl, parsed.data.audioUrl);
    return NextResponse.json({ requestId } satisfies AvatarResponse);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  const requestId = req.nextUrl.searchParams.get('requestId');
  if (!requestId) return NextResponse.json({ error: 'requestId is required.' }, { status: 400 });

  try {
    const s = await avatarStatus(requestId);
    const body: AvatarStatusResponse = { status: s.status };
    if (s.status === 'IN_QUEUE') body.queuePosition = s.queue_position;
    // fal repeats the whole log from the start on every poll, so the card can
    // just replace what it is holding rather than append.
    if (s.status !== 'IN_QUEUE') body.logs = (s.logs || []).map(l => l.message).filter(Boolean);

    if (s.status === 'COMPLETED') {
      // A job that failed also reads COMPLETED; result() is where the reason
      // surfaces, so it is the same call either way.
      const { videoUrl, duration } = await avatarResult(requestId);
      body.videoUrl = videoUrl;
      body.duration = duration;
    }
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
