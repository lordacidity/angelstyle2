import { spawn } from 'node:child_process';
import ffmpegPathImport from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import path from 'node:path';
import fs from 'node:fs';

// ffmpeg-static / ffprobe-static export the bundled binary path as a string. They're kept
// external (next.config serverExternalPackages) so the bundler doesn't mangle them.
export const FFMPEG = ffmpegPathImport;
export const FFPROBE = ffprobeStatic.path;
export const FFMPEG_DIR = typeof FFMPEG === 'string' ? path.dirname(FFMPEG) : '';

// Locate the yt-dlp binary youtube-dl-exec downloaded. Resolve it from node_modules directly
// rather than require.resolve(), which a bundler (Turbopack/webpack) rewrites to a numeric
// module id (breaking path.dirname). process.cwd() is the Next app root at build + runtime.
const YT_BIN = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
export const YT_DLP = (() => {
  const candidates = [
    path.join(process.cwd(), 'node_modules', 'youtube-dl-exec', 'bin', YT_BIN),
    path.join(process.cwd(), '..', 'node_modules', 'youtube-dl-exec', 'bin', YT_BIN),
  ];
  for (const cand of candidates) {
    try { if (fs.existsSync(cand)) return cand; } catch { /* ignore */ }
  }
  return YT_BIN; // fall back to PATH
})();

/**
 * Run a command, capturing stdout/stderr. Rejects on non-zero exit.
 * @param {string} cmd
 * @param {string[]} args
 * @param {(line:string)=>void} [onStderr] optional live stderr line callback
 */
export function run(cmd, args, onStderr) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      if (onStderr) s.split(/\r?\n/).forEach((l) => l && onStderr(l));
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(cmd)} exited ${code}\n${stderr.slice(-2000)}`));
    });
  });
}

export const ffmpeg = (args, onStderr) => run(FFMPEG, args, onStderr);

/**
 * Run yt-dlp directly (no shell), so URLs/format strings with <,>,%,*,[ ] and paths with
 * spaces are passed literally as argv. Reports download % via onProgress.
 * @param {string[]} args
 * @param {(pct:number, line:string)=>void} [onProgress]
 */
export function ytdlp(args, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn(YT_DLP, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const scan = (s) => {
      if (!onProgress) return;
      const m = s.match(/\[download\]\s+([\d.]+)%/);
      if (m) onProgress(parseFloat(m[1]), s.trim());
    };
    child.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      s.split(/[\r\n]+/).forEach(scan); // yt-dlp uses \r to redraw the progress line
    });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`yt-dlp exited ${code}\n${(stderr || stdout).slice(-1500)}`));
    });
  });
}

/** Probe a media file -> { duration, width, height, fps } */
export async function probe(file) {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,avg_frame_rate:format=duration',
    '-of', 'json',
    file,
  ]);
  const info = JSON.parse(stdout);
  const stream = info.streams?.[0] || {};
  const [num, den] = (stream.avg_frame_rate || '0/1').split('/').map(Number);
  return {
    duration: parseFloat(info.format?.duration) || 0,
    width: stream.width || 0,
    height: stream.height || 0,
    fps: den ? num / den : 0,
  };
}

/** True if the file has at least one audio stream. */
export async function hasAudioStream(file) {
  try {
    const { stdout } = await run(FFPROBE, [
      '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'json', file,
    ]);
    return ((JSON.parse(stdout).streams) || []).length > 0;
  } catch {
    return false;
  }
}
