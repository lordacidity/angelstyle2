import { Readable } from 'node:stream';
import ytdl from '@distube/ytdl-core';

// Dead-simple "paste a link → download the file" endpoint. Unlike the studio's
// /youtube/download pipeline (which writes to disk, runs background jobs, and serves media
// back — none of which survive Vercel's ephemeral, isolated serverless filesystem), this
// streams a YouTube video straight from YouTube THROUGH this function into the browser's
// download. No python (yt-dlp), no ffmpeg, no disk, no jobs — pure JS, so it works on Vercel.
//
// Trade-off: we grab a progressive (combined audio+video) stream, which YouTube caps around
// 720p. Higher resolutions are delivered as separate video/audio streams that need an ffmpeg
// merge — i.e. the heavy server-side path this endpoint deliberately avoids.

export const runtime = 'nodejs'; // ytdl-core needs Node APIs, not the Edge runtime
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // give long videos room (capped lower on Vercel Hobby)

function safeTitle(t: string): string {
  return (t || 'video').replace(/[^\w\s().-]/g, '').trim().slice(0, 80) || 'video';
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const url = params.get('url') || '';

  if (!ytdl.validateURL(url)) {
    return Response.json({ error: 'A valid YouTube URL is required.' }, { status: 400 });
  }

  let info: ytdl.videoInfo;
  try {
    info = await ytdl.getInfo(url);
  } catch (err) {
    // YouTube sometimes bot-blocks datacenter IPs (incl. Vercel) — surface the real reason.
    return Response.json(
      { error: `Couldn't read that video: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  const title = safeTitle(info.videoDetails.title);

  // probe mode: let the UI validate + show the title before kicking off the real download.
  if (params.get('probe')) {
    return Response.json({ title, lengthSeconds: Number(info.videoDetails.lengthSeconds) || null });
  }

  const nodeStream = ytdl.downloadFromInfo(info, { filter: 'audioandvideo', quality: 'highest' });
  // Without a handler, a mid-stream YouTube error emits 'error' on the Node stream and would
  // crash the function; swallow it — the browser just sees the download end early.
  nodeStream.on('error', () => {});

  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="${title}.mp4"`,
      'Cache-Control': 'no-store',
    },
  });
}
