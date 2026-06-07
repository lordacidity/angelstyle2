import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectDir, toMediaUrl } from '@/lib/aier/paths.js';
import { probe, FFMPEG_DIR, ytdlp } from '@/lib/aier/exec.js';
import { createJob, runJob, saveProject } from '@/lib/aier/store.js';

const VIDEO_EXTS = ['.mp4', '.mkv', '.webm', '.mov', '.m4v'];

function findSource(dir: string) {
  const files = fs.readdirSync(dir).filter((f: string) => f.startsWith('source.'));
  files.sort((a: string, b: string) => (a.endsWith('.mp4') ? -1 : 1));
  const hit = files.find((f: string) => VIDEO_EXTS.includes(path.extname(f).toLowerCase()));
  return hit ? path.join(dir, hit) : null;
}

// POST /api/aier/youtube/download { url } -> { projectId, jobId }
export async function POST(req: Request) {
  const { url } = await req.json().catch(() => ({}));
  if (!url || !/^https?:\/\//i.test(url)) {
    return Response.json({ error: 'A valid YouTube URL is required.' }, { status: 400 });
  }
  const projectId = randomUUID();
  const dir = projectDir(projectId);
  const jobId = createJob('download');

  runJob(jobId, async (update: (patch: Record<string, unknown>) => void) => {
    update({ logLine: 'Fetching video info…', progress: 5 });
    let meta: Record<string, unknown> = {};
    try {
      const { stdout } = await ytdlp([url, '--dump-single-json', '--no-playlist', '--no-warnings', '--skip-download']);
      meta = JSON.parse(stdout);
    } catch {
      update({ logLine: 'Could not read metadata, downloading anyway…' });
    }

    update({ logLine: `Downloading "${meta.title || url}" in 1080p…`, progress: 20 });
    await ytdlp([
      url,
      '-o', path.join(dir, 'source.%(ext)s'),
      '-f', 'bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b',
      '--merge-output-format', 'mp4',
      '--ffmpeg-location', FFMPEG_DIR,
      '--no-playlist',
      '--no-warnings',
      '--retries', '3',
    ], (pct: number, line: string) => update({ progress: 20 + Math.round(pct * 0.6), logLine: line }));

    const sourcePath = findSource(dir);
    if (!sourcePath) throw new Error('Download finished but no video file was found.');

    update({ logLine: 'Reading video properties…', progress: 90 });
    const info = await probe(sourcePath);

    const project = saveProject(projectId, {
      url,
      title: meta.title || 'Untitled',
      thumbnail: meta.thumbnail || null,
      sourcePath,
      sourceUrl: toMediaUrl(sourcePath),
      duration: info.duration,
      width: info.width,
      height: info.height,
      fps: info.fps,
    });

    update({ logLine: 'Done.', progress: 100 });
    return {
      projectId,
      sourceUrl: project.sourceUrl,
      title: project.title,
      duration: project.duration,
      width: project.width,
      height: project.height,
      fps: project.fps,
    };
  });

  return Response.json({ projectId, jobId });
}
