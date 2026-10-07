// Makes the lighter copies of the persona clips that the clipper page is
// handed in place of the files themselves (lite_* in lib/vids-db).
//
// A clip in the top half of a build is shown 780px tall, and a landscape Start
// about 1350px wide; a good many persona clips are filed far bigger than that
// (2880x1800, 1936x1072 at 20-40Mbps), and a phone on the clipper page was
// fetching and decoding every pixel of them to throw most away. A copy is the
// same footage, sized to just over what the frame shows of it and encoded at
// a quality the eye can't tell from the file (CRF 16). The clip's own file is
// never touched, and the Studio never sees the copy.
//
// Only a clip that is oversized gets one:
//   Top A, Top B        taller than 920px            -> 800px tall
//   Start, landscape    wider than 1656px            -> 1440px wide
//   Start, upright      left alone: it fills the whole frame, so it is the
//                       size the frame shows already
// and only if the copy comes out meaningfully smaller than the file.
//
// Run with the dev server up (it is the API; the gate is fail-open locally):
//   node scripts/make-lite.mjs                 every persona on for the clippers
//   node scripts/make-lite.mjs --all           every persona, on or not
//   node scripts/make-lite.mjs --persona Park  one persona video (name, any case)
//   node scripts/make-lite.mjs --redo          make them again where there is one
//   node scripts/make-lite.mjs --remove        take the copies away again
//   node scripts/make-lite.mjs --dry           say what would be done
//   node scripts/make-lite.mjs --api http://localhost:3002

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const FFMPEG = require('ffmpeg-static');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const API = (opt('--api') ?? 'http://localhost:3002').replace(/\/$/, '');
const DRY = flag('--dry');
const ALL = flag('--all');
const REDO = flag('--redo');
const REMOVE = flag('--remove');
const ONLY = opt('--persona')?.toLowerCase() ?? null;

/** What the frame shows of each, with a little over (lib/simpler/vidsPlan:
 *  the top half is 780px tall; Start is fitted to 1080px at 1.25x). */
const TOP_HEIGHT = 800;
const START_WIDTH = 1440;
/** How far past that a clip has to be before a copy is worth making. */
const OVER = 1.15;
/** A copy that isn't at least this much smaller than the file is not kept. */
const WORTH_IT = 0.85;
const CRF = 16;

const PARTS = [['startId', 'start'], ['topAId', 'top'], ['topBId', 'top']];
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'make-lite-'));
const log = (...a) => console.log(...a);
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)}MB`;
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

async function api(p, init = {}) {
  const r = await fetch(`${API}/api/vids${p}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${p}: ${body.error ?? r.status}`);
  return body;
}

function run(bin, argv) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) { resolve(err); return; }
      const e = new Error(`${path.basename(bin)} exited ${code}\n${err.split('\n').slice(-6).join('\n')}`);
      e.stderr = err;
      reject(e);
    });
  });
}

/** What ffmpeg says about a file: its picture's size as stored, and whether
 *  it has sound. (-i alone exits 1; the stream lines are on stderr anyway.) */
async function probe(file) {
  const err = await run(FFMPEG, ['-hide_banner', '-i', file]).catch((e) => String(e.stderr ?? e.message));
  const video = /Stream #\d+:\d+.*?: Video: .*?, (\d{2,5})x(\d{2,5})/.exec(err);
  return {
    hasAudio: /Stream #\d+:\d+.*?: Audio:/.test(err),
    width: video ? Number(video[1]) : null,
    height: video ? Number(video[2]) : null,
  };
}

/** The size a clip's copy should be, or null when the clip is not oversized. */
function target(row, slot) {
  const { width: w, height: h } = row;
  if (!w || !h) return null;
  if (slot === 'top') {
    if (h <= TOP_HEIGHT * OVER) return null;
    return { width: even((w * TOP_HEIGHT) / h), height: TOP_HEIGHT };
  }
  // An upright Start has the whole frame: it is already the size it is shown.
  if (h > w) return null;
  if (w <= START_WIDTH * OVER) return null;
  return { width: START_WIDTH, height: even((h * START_WIDTH) / w) };
}

async function encode(src, out, size, hasAudio, copyAudio) {
  await run(FFMPEG, [
    '-hide_banner', '-nostdin', '-y', '-i', src,
    '-vf', `scale=${size.width}:${size.height}:flags=lanczos`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(CRF), '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    // A keyframe every couple of seconds, so a build that starts partway in
    // (a trim, a loop coming round) has one near.
    '-g', '60',
    ...(hasAudio ? (copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k']) : ['-an']),
    '-movflags', '+faststart', out,
  ]);
}

async function main() {
  const lib = await api('');
  const have = new Map((await api('/lite')).map((l) => [l.id, l]));
  const byId = new Map(lib.videos.map((v) => [v.id, v]));
  const folder = new Map(lib.folders.map((f) => [f.id, f.name]));

  // Every clip a persona video uses, once, as the biggest thing it is used
  // for: a clip that is somebody's Start and somebody else's Top A is sized
  // for the Start.
  const jobs = new Map();
  for (const p of lib.personas) {
    if (!ALL && !p.clipable) continue;
    if (ONLY && p.name.toLowerCase() !== ONLY) continue;
    for (const [part, slot] of PARTS) {
      const row = p[part] ? byId.get(p[part]) : null;
      if (!row || row.mimeType?.startsWith('image/')) continue;
      const prev = jobs.get(row.id);
      const who = `${folder.get(p.folderId) ?? '-'} / ${p.name}`;
      if (!prev || (slot === 'start' && prev.slot !== 'start')) jobs.set(row.id, { row, slot, who });
    }
  }

  if (REMOVE) {
    let n = 0;
    for (const { row, who } of jobs.values()) {
      if (!have.has(row.id)) continue;
      log(`${DRY ? 'would remove' : 'removing'}  ${who} — ${row.name}`);
      if (!DRY) await api(`/videos/${row.id}/lite`, { method: 'DELETE' });
      n++;
    }
    log(`\n${n} ${DRY ? 'to remove' : 'removed'}.`);
    return;
  }

  let made = 0, skipped = 0, failed = 0, before = 0, after = 0;
  for (const { row, slot, who } of jobs.values()) {
    const size = target(row, slot);
    const label = `${who} — ${row.name} (${slot === 'start' ? 'Start' : 'Top'}, ${row.width}x${row.height}, ${mb(row.sizeBytes)})`;
    if (!size) { skipped++; continue; }
    if (have.has(row.id) && !REDO) { log(`has one   ${label}`); skipped++; continue; }
    if (DRY) { log(`would do  ${label} -> ${size.width}x${size.height}`); made++; continue; }
    const src = path.join(tmpDir, `${row.id}.src`);
    const out = path.join(tmpDir, `${row.id}.mp4`);
    try {
      const r = await fetch(row.url);
      if (!r.ok) throw new Error(`download ${r.status}`);
      fs.writeFileSync(src, Buffer.from(await r.arrayBuffer()));
      const meta = await probe(src);
      // The sound as it is, where the container will take it; encoded again
      // only if it won't.
      await encode(src, out, size, meta.hasAudio, true).catch(() => encode(src, out, size, meta.hasAudio, false));
      const bytes = fs.statSync(out).size;
      const got = await probe(out);
      if (!got.width || !got.height) throw new Error('the copy has no picture');
      if (bytes > row.sizeBytes * WORTH_IT) {
        log(`no gain   ${label} -> ${mb(bytes)}`);
        skipped++;
        continue;
      }
      const sign = await api(`/videos/${row.id}/lite`, { method: 'POST' });
      const put = await fetch(sign.url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'x-upsert': 'false' }, body: fs.readFileSync(out) });
      if (!put.ok) throw new Error(`upload ${put.status}: ${(await put.text()).slice(0, 200)}`);
      await api(`/videos/${row.id}/lite`, {
        method: 'PUT',
        body: JSON.stringify({ path: sign.path, sizeBytes: bytes, width: got.width, height: got.height }),
      });
      log(`made      ${label} -> ${got.width}x${got.height}, ${mb(bytes)}`);
      made++;
      before += row.sizeBytes;
      after += bytes;
    } catch (e) {
      log(`FAILED    ${label}: ${e.message.split('\n')[0]}`);
      failed++;
    } finally {
      for (const f of [src, out]) fs.rmSync(f, { force: true });
    }
  }
  log(`\n${made} ${DRY ? 'to make' : 'made'}, ${skipped} left alone, ${failed} failed.${made && !DRY ? ` ${mb(before)} -> ${mb(after)}.` : ''}`);
}

main()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
