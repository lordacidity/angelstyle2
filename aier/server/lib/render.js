// Render an EDL (see edl.js) to a single high-quality MP4 with native ffmpeg
// (up to 4K — resolution follows the source via targetDims in video.js).
//
// Two rails:
//   1) VIDEO — each video clip → a normalized, silent segment (identical encode params via
//      video.js), then concat-joined. Because every segment shares codec/fps/dims, the join
//      is a stream copy = seamless, frame-exact seams (same guarantee the old 2-part export had).
//   2) AUDIO — every audio item is trimmed, speed-shifted, gained and delayed to its start,
//      then mixed (amix) into one stereo track the exact length of the video.
// Finally the two rails are muxed. Intermediates are cleaned up; only final.mp4 remains.

import fs from 'node:fs';
import path from 'node:path';
import { ffmpeg, hasAudioStream } from './exec.js';
import { targetDims, vfFor, cropFilter, ENC, FPS } from './video.js';
import { toMediaUrl } from './paths.js';
import { normalizeEdl, resolveMediaPath, atempoChain } from './edl.js';

const toPosix = (p) => p.split(path.sep).join('/');

// ENC without the audio-only flags (each takes one value), for the silent video segments.
const AUDIO_FLAGS = new Set(['-c:a', '-b:a', '-ar', '-ac']);
const VIDEO_ENC = (() => {
  const out = [];
  for (let i = 0; i < ENC.length; i++) {
    if (AUDIO_FLAGS.has(ENC[i])) { i++; continue; }
    out.push(ENC[i]);
  }
  return out;
})();

export async function renderEdl({ project, edl: rawEdl, dir, update = () => {} }) {
  const edl = normalizeEdl(rawEdl);
  const { W, H } = targetDims(project || {}, edl.crop);
  const vf = vfFor(W, H);
  fs.mkdirSync(dir, { recursive: true });

  // ---- Video rail: render each clip to an identical-params segment, then concat ----
  const segPaths = [];
  for (let i = 0; i < edl.videoTrack.length; i++) {
    const c = edl.videoTrack[i];
    const src = resolveMediaPath(c.src);
    const cf = c.crop ? cropFilter(c.crop) : null;
    const chain = [
      `trim=${c.in.toFixed(6)}:${c.out.toFixed(6)}`,
      `setpts=(PTS-STARTPTS)/${c.speed}`,
      ...(cf ? [cf] : []),
      vf,
    ].join(',');
    const segPath = path.join(dir, `edl_seg${i}.mp4`);
    update({
      logLine: `Rendering clip ${i + 1}/${edl.videoTrack.length}…`,
      progress: 10 + Math.round((i / edl.videoTrack.length) * 45),
    });
    await ffmpeg(['-y', '-i', src, '-an', '-vf', chain, '-r', String(FPS), ...VIDEO_ENC, segPath],
      (l) => update({ logLine: l }));
    segPaths.push(segPath);
  }

  const listFile = path.join(dir, 'edl_concat.txt');
  fs.writeFileSync(listFile, segPaths.map((p) => `file '${toPosix(p)}'`).join('\n') + '\n');
  const videoRail = path.join(dir, 'edl_video.mp4');
  update({ logLine: 'Joining video track…', progress: 60 });
  await ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', videoRail]);

  // ---- Audio rail ----
  update({ logLine: 'Mixing audio…', progress: 75 });
  const audioRail = path.join(dir, 'edl_audio.m4a');
  await renderAudio(edl, audioRail, update);

  // ---- Mux ----
  update({ logLine: 'Muxing final video…', progress: 92 });
  const finalPath = path.join(dir, 'final.mp4');
  await ffmpeg(['-y', '-i', videoRail, '-i', audioRail,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'copy',
    '-movflags', '+faststart', '-shortest', finalPath]);

  for (const p of [...segPaths, listFile, videoRail, audioRail]) { try { fs.unlinkSync(p); } catch {} }

  return { finalPath, finalUrl: toMediaUrl(finalPath), width: W, height: H, duration: edl.duration };
}

// Place every audio item on the timeline and mix them into one stereo track of `edl.duration`.
async function renderAudio(edl, outPath, update) {
  const items = [];
  for (const a of edl.audioTracks) {
    const abs = resolveMediaPath(a.src);
    if (await hasAudioStream(abs)) items.push({ ...a, abs });
    else update({ logLine: `(skipping silent source ${path.basename(abs)})` });
  }

  // Nothing to mix → emit silence the length of the video so the file always has audio.
  if (!items.length) {
    await ffmpeg(['-y', '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-t', edl.duration.toFixed(6), '-c:a', 'aac', '-ar', '48000', '-ac', '2', outPath]);
    return;
  }

  const inputs = [];
  const filters = [];
  const labels = [];
  items.forEach((a, i) => {
    inputs.push('-i', a.abs);
    const ms = Math.round(a.start * 1000);
    const fns = [
      `atrim=${a.in.toFixed(6)}:${a.out.toFixed(6)}`,
      'asetpts=PTS-STARTPTS',
      ...atempoChain(a.speed),
      `volume=${a.gain.toFixed(4)}`,
      ...(ms > 0 ? [`adelay=${ms}|${ms}`] : []),
    ];
    filters.push(`[${i}:a]${fns.join(',')}[a${i}]`);
    labels.push(`[a${i}]`);
  });

  filters.push(labels.length === 1
    ? `${labels[0]}apad[mix]`
    : `${labels.join('')}amix=inputs=${labels.length}:normalize=0,apad[mix]`);

  await ffmpeg(['-y', ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', '[mix]', '-t', edl.duration.toFixed(6),
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', outPath],
    (l) => update({ logLine: l }));
}
