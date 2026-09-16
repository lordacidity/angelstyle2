// Regenerates the full Apple-emoji set used by the @-picker, the emoji manager,
// and the canvas caption renderer.
//
// Source of truth: the `emoji-datasource-apple` package (devDependency). This
// script reads its emoji.json, keeps every base emoji that ships an Apple PNG
// (skin-tone variants are intentionally skipped — the combinatorial explosion
// isn't useful in a caption picker), copies each 64px Apple glyph into
// /public/emoji, and writes the compact data file the app imports.
//
// Run with:  node scripts/gen-emoji.mjs
// Safe to re-run — it only copies PNGs that aren't already there.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(__dirname, '..');
const pkgDir = path.join(frontend, 'node_modules', 'emoji-datasource-apple');
const srcImgDir = path.join(pkgDir, 'img', 'apple', '64');
const outImgDir = path.join(frontend, 'public', 'emoji');
const outDataFile = path.join(frontend, 'src', 'lib', 'emoji-data.json');

const data = JSON.parse(fs.readFileSync(path.join(pkgDir, 'emoji.json'), 'utf8'));

function titleCase(s) {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// Turn the codepoint string ("1f1e6-1f1f7") into the literal char we insert.
function toChar(unified) {
  return unified.split('-').map((h) => String.fromCodePoint(parseInt(h, 16))).join('');
}

// Tiny stopword list so search terms aren't polluted by glue words pulled out of
// long short_names ("rolling on the floor laughing" -> "on"/"the").
const STOP = new Set(['the', 'on', 'in', 'of', 'a', 'an', 'and', 'with', 'to', 'for', 'at', 'by', 'or']);

// Search terms for the picker: the short_names (e.g. "joy", "rofl") plus the
// individual words inside them, so "rolling_on_the_floor_laughing" is reachable
// by "rolling" / "floor" / "laughing" too.
function keywordsFor(e) {
  const set = new Set();
  for (const sn of e.short_names ?? []) {
    const clean = sn.replace(/_/g, ' ').trim();
    if (clean) set.add(clean);
    for (const w of clean.split(' ')) if (w.length > 1 && !STOP.has(w)) set.add(w);
  }
  if (e.category) set.add(e.category.toLowerCase());
  return [...set];
}

fs.mkdirSync(outImgDir, { recursive: true });

const entries = data
  // Drop the "Component" category — bare skin-tone / hair modifiers that are
  // meaningless on their own in a caption.
  .filter((e) => e.has_img_apple && e.category !== 'Component')
  .sort((a, b) => a.sort_order - b.sort_order)
  .map((e) => {
    const unified = e.image.replace(/\.png$/i, ''); // authoritative PNG basename
    // Copy the Apple glyph into /public/emoji if it isn't there yet.
    const src = path.join(srcImgDir, e.image);
    const dst = path.join(outImgDir, e.image);
    if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst);
    return {
      char: toChar(e.unified),
      unified,
      name: titleCase(e.name),
      keywords: keywordsFor(e),
      category: e.category ?? 'Other',
    };
  });

fs.writeFileSync(outDataFile, JSON.stringify(entries));

// Quick report.
const copied = fs.readdirSync(outImgDir).length;
console.log(`emoji entries written: ${entries.length}`);
console.log(`/public/emoji PNGs now:  ${copied}`);
console.log(`data file: ${path.relative(frontend, outDataFile)} (${(fs.statSync(outDataFile).size / 1024).toFixed(0)} KB)`);

// Silence unused import lint in case of future use.
void pathToFileURL;
