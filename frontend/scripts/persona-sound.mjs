// Puts the voice back into the persona clips — or takes it out again.
//
// Every persona clip was saved out of Prep with the footage's own sound
// dropped (VidEdit.muted), so the file in the library has no audio track at
// all; the recording it was cut from is kept beside it (VidRow.sourcePath) and
// does. This renders each clip again from that recording with the very edit
// the row holds — the same trim, cuts and speed, so the marks still land —
// keeping the audio this time, and swaps the new file in over the old one the
// way the editor's Save does (sign → PUT → PATCH { media }), so the row keeps
// its id and every persona part pointing at it. The row's hasSfx says the
// clip carries sound, which is what makes a build play it (SlotPick.muted).
//
// Run with the dev server up (it is the API; the gate is fail-open locally):
//   node scripts/persona-sound.mjs                 every persona, sound on
//   node scripts/persona-sound.mjs --persona Park  one persona (name, any case)
//   node scripts/persona-sound.mjs --off           the reverse: silent again
//   node scripts/persona-sound.mjs --dry           say what would be done
//   node scripts/persona-sound.mjs --api http://localhost:3002
//
// Skipped, and said so: a clip with no kept recording (its file is the
// recording, and if that has no sound there is nothing to add), one whose
// recording has no audio track, one carrying keyboard stretches (Prep's own
// renderer lays those; this one doesn't), and one already the way it is
// being asked for.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FFMPEG = require('ffmpeg-static');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const API = (opt('--api') ?? 'http://localhost:3002').replace(/\/$/, '');
const DRY = flag('--dry');
const WANT_SOUND = !flag('--off');
const ONLY = opt('--persona')?.toLowerCase() ?? null;

const PARTS = ['startId', 'topAId', 'topBId'];
/** The renderer's own numbers (lib/simpler/vidsPlan videoBitrate). */
const TARGET_BPP = 0.16;
const REENCODE_HEADROOM = 1.25;
const MAX_BITRATE = 40_000_000;
const THUMB_MAX_W = 480;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-sound-'));
const log = (...a) => console.log(...a);

async function api(p, init = {}) {
  const r = await fetch(`${API}/api/vids${p}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${p}: ${body.error ?? r.status}`);
  return body;
}

function run(bin, argv, { quiet = true } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) { resolve({ out, err }); return; }
      const e = new Error(`${path.basename(bin)} exited ${code}${quiet ? '' : `\n${err}`}\n${err.split('\n').slice(-6).join('\n')}`);
      // The whole of it, for probe: `-i` alone exits 1 on purpose.
      e.stderr = err;
      reject(e);
    });
  });
}

/** What ffmpeg says about a file: streams, length, size, frame rate, bitrate. */
async function probe(file) {
  // -i alone exits 1 ("no output"); the stream lines are on stderr either way.
  const { err } = await run(FFMPEG, ['-hide_banner', '-i', file]).catch((e) => ({ err: String(e.stderr ?? e.message) }));
  const video = /Stream #\d+:\d+.*?: Video: .*?, (\d{2,5})x(\d{2,5})(?:[, ].*?)?(?:, ([\d.]+) fps)?/.exec(err);
  const audio = /Stream #\d+:\d+.*?: Audio:/.test(err);
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(err);
  const br = /bitrate: (\d+) kb\/s/.exec(err);
  return {
    hasAudio: audio,
    width: video ? Number(video[1]) : null,
    height: video ? Number(video[2]) : null,
    fps: video && video[3] ? Number(video[3]) : 30,
    duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null,
    bitrate: br ? Number(br[1]) * 1000 : 0,
  };
}

async function download(url, to) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  fs.writeFileSync(to, Buffer.from(await r.arrayBuffer()));
}

/** The kept pieces of the recording, in source seconds: the trim less the
 *  cuts, the way Prep's keptSegments works them out. */
function segments(edit, full) {
  const start = Math.max(0, Math.min(edit.trim.start ?? 0, full));
  const end = Math.max(start, Math.min(edit.trim.end ?? full, full));
  const cuts = [...(edit.cuts ?? [])]
    .map((c) => ({ start: Math.max(start, c.start), end: Math.min(end, c.end) }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start);
  const out = [];
  let at = start;
  for (const c of cuts) {
    if (c.start > at) out.push({ start: at, end: c.start });
    at = Math.max(at, c.end);
  }
  if (end > at) out.push({ start: at, end });
  return out.filter((s) => s.end - s.start > 0.01);
}

/** atempo only takes 0.5–2 per pass; chain it for anything outside. */
function atempoChain(speed) {
  const parts = [];
  let s = speed;
  while (s > 2) { parts.push('atempo=2'); s /= 2; }
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  parts.push(`atempo=${s.toFixed(5)}`);
  return parts.join(',');
}

/** The clip again, from its recording, with the sound in or out. */
async function render(source, edit, meta, withSound, out) {
  const segs = segments(edit, meta.duration);
  if (!segs.length) throw new Error('the edit keeps nothing');
  const speed = edit.speed && edit.speed > 0 ? edit.speed : 1;
  const filters = [];
  const vLabels = [];
  const aLabels = [];
  segs.forEach((s, i) => {
    filters.push(`[0:v]trim=start=${s.start.toFixed(4)}:end=${s.end.toFixed(4)},setpts=PTS-STARTPTS[v${i}]`);
    vLabels.push(`[v${i}]`);
    if (withSound) {
      filters.push(`[0:a]atrim=start=${s.start.toFixed(4)}:end=${s.end.toFixed(4)},asetpts=PTS-STARTPTS[a${i}]`);
      aLabels.push(`[a${i}]`);
    }
  });
  filters.push(`${vLabels.join('')}concat=n=${segs.length}:v=1:a=0[vc]`);
  const vTail = speed !== 1 ? `[vc]setpts=PTS/${speed.toFixed(5)}[vout]` : '[vc]null[vout]';
  filters.push(vTail);
  if (withSound) {
    filters.push(`${aLabels.join('')}concat=n=${segs.length}:v=0:a=1[ac]`);
    filters.push(speed !== 1 ? `[ac]${atempoChain(speed)}[aout]` : '[ac]anull[aout]');
  }
  const bitrate = Math.round(Math.min(
    Math.max(meta.width * meta.height * meta.fps * TARGET_BPP, meta.bitrate) * REENCODE_HEADROOM,
    MAX_BITRATE,
  ));
  const argv = [
    '-hide_banner', '-y', '-i', source,
    '-filter_complex', filters.join(';'),
    '-map', '[vout]', ...(withSound ? ['-map', '[aout]'] : ['-an']),
    '-c:v', 'libx264', '-preset', 'medium', '-b:v', String(bitrate), '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    ...(withSound ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'] : []),
    out,
  ];
  await run(FFMPEG, argv);
  const kept = segs.reduce((n, s) => n + (s.end - s.start), 0) / speed;
  return { kept };
}

/** A still off the first frame, the size the editor's probe makes. */
async function thumb(video, width, out) {
  const w = Math.min(THUMB_MAX_W, width);
  await run(FFMPEG, ['-hide_banner', '-y', '-i', video, '-frames:v', '1', '-vf', `scale=${w}:-2`, '-q:v', '4', out]);
}

async function put(url, file, type) {
  const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': type }, body: fs.readFileSync(file) });
  if (!r.ok) throw new Error(`PUT ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function main() {
  const lib = await api('');
  const videos = new Map(lib.videos.map((v) => [v.id, v]));
  const personas = lib.personas.filter((p) => !ONLY || p.name.toLowerCase() === ONLY);
  if (!personas.length) throw new Error(ONLY ? `no persona called "${ONLY}"` : 'no personas');
  log(`${WANT_SOUND ? 'Sound on' : 'Sound off'} for ${personas.length} persona(s)${DRY ? ' — dry run' : ''}\n`);

  let done = 0, skipped = 0, failed = 0;
  for (const p of personas) {
    for (const part of PARTS) {
      const v = p[part] ? videos.get(p[part]) : null;
      const tag = `${p.name} / ${part.replace('Id', '')}`;
      if (!v) { log(`- ${tag}: no clip`); skipped++; continue; }
      const edit = v.edit;
      if (!v.sourcePath || !v.sourceUrl || !edit) { log(`- ${tag}: never through Prep — its file is the recording, nothing to render from`); skipped++; continue; }
      if (edit.sfx?.length) { log(`- ${tag}: carries keyboard stretches, which this doesn't lay — open it in Prep instead`); skipped++; continue; }
      const already = WANT_SOUND ? (edit.muted === false && v.hasSfx) : (edit.muted !== false && !v.hasSfx);
      if (already) { log(`- ${tag}: already ${WANT_SOUND ? 'has its sound' : 'silent'}`); skipped++; continue; }

      try {
        const src = path.join(tmpDir, `${v.id}-src${path.extname(v.sourcePath) || '.mov'}`);
        process.stdout.write(`- ${tag}: recording… `);
        await download(v.sourceUrl, src);
        const meta = await probe(src);
        if (!meta.duration || !meta.width) throw new Error('could not read the recording');
        if (WANT_SOUND && !meta.hasAudio) { log('the recording has no audio track — skipped'); skipped++; continue; }
        if (DRY) { log(`would render ${segments(edit, meta.duration).length} piece(s) at ${edit.speed}× ${WANT_SOUND ? 'with' : 'without'} sound`); done++; continue; }

        process.stdout.write('rendering… ');
        const out = path.join(tmpDir, `${v.id}.mp4`);
        const { kept } = await render(src, edit, meta, WANT_SOUND, out);
        const outMeta = await probe(out);
        if (WANT_SOUND && !outMeta.hasAudio) throw new Error('the render came out silent');
        const jpg = path.join(tmpDir, `${v.id}.jpg`);
        let hasThumb = true;
        try { await thumb(out, outMeta.width ?? meta.width, jpg); } catch { hasThumb = false; }

        process.stdout.write('uploading… ');
        const name = `${v.name.replace(/\.[^.]+$/, '')}.mp4`;
        const sign = await api('/videos/sign', { method: 'POST', body: JSON.stringify({ id: v.id, name, mime: 'video/mp4', withThumb: hasThumb }) });
        await put(sign.video.url, out, 'video/mp4');
        let thumbPath = null;
        if (hasThumb && sign.thumb) {
          try { await put(sign.thumb.url, jpg, 'image/jpeg'); thumbPath = sign.thumb.path; } catch { thumbPath = null; }
        }
        await api(`/videos/${v.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            media: {
              storagePath: sign.video.path,
              thumbPath,
              mimeType: 'video/mp4',
              sizeBytes: fs.statSync(out).size,
              duration: outMeta.duration ?? kept,
              width: outMeta.width ?? meta.width,
              height: outMeta.height ?? meta.height,
              hasSfx: WANT_SOUND,
              edit: { ...edit, muted: !WANT_SOUND },
            },
          }),
        });
        log(`done (${(outMeta.duration ?? kept).toFixed(1)}s${WANT_SOUND ? ', with sound' : ', silent'})`);
        done++;
        for (const f of [src, out, jpg]) fs.rmSync(f, { force: true });
      } catch (e) {
        log(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
        failed++;
      }
    }
  }
  log(`\n${done} ${DRY ? 'would be ' : ''}done, ${skipped} skipped, ${failed} failed.`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
