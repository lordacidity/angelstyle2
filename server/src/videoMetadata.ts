// Strips the metadata out of a video file, in place, without touching the
// picture or the sound: every video that leaves the Studio — to Phonedeck, to
// Hyper Attention, or saved to a disk or a phone — goes through this first.
//
// Nothing is re-encoded and nothing moves. Whatever carries metadata is
// overwritten where it sits (a box is turned into an empty `free` box of the
// same size, a string is blanked, a date is zeroed), so every offset in the
// file stays good and the frames come out bit for bit the same.
//
// MP4 / MOV:
//   - `udta` and `meta` boxes (title, comment, encoder, location, the iTunes
//     and QuickTime tags), `uuid` boxes (XMP, C2PA / Content Credentials)
//   - creation and modification dates (movie, tracks, media)
//   - handler names ("VideoHandler", "Core Media Video", the muxer's name),
//     and the encoder's name and vendor in the sample descriptions
//   - whatever is sitting in `free` / `skip` padding
//   - tracks that are neither picture nor sound (timecode, the location and
//     other timed-metadata tracks a phone writes, text): the track is dropped
//     and its data blanked
//   - the settings string x264 / x265 write into the stream itself, and the
//     "Lavc…" name ffmpeg's AAC encoder writes into the first audio frame
// WebM / Matroska:
//   - muxing and writing app, title, file names, the date, track names, and
//     the Tags, Attachments and Chapters elements
//
// Anything that is not one of those containers is left exactly as it is, so it
// is safe to call on whatever is going out. Dependency-free and the same in the
// browser and in Node — server/src/videoMetadata.ts is a copy of this file for
// the Phonedeck server, which can't import from here. Change both.

export interface ScrubReport {
  /** What the file was read as; null when it is not a video this handles. */
  kind: 'mp4' | 'webm' | null;
  /** How many things were blanked. 0 means it was already clean. */
  changed: number;
}

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u64 = (b: Uint8Array, o: number) => u32(b, o) * 2 ** 32 + u32(b, o + 4);
const tag = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** Overwrite [from, to) with `value`. Answers 1 if that changed anything. */
function blank(b: Uint8Array, from: number, to: number, value = 0): number {
  const end = Math.min(to, b.length);
  let dirty = false;
  for (let i = from; i < end; i++) if (b[i] !== value) { dirty = true; break; }
  if (dirty) b.fill(value, from, end);
  return dirty ? 1 : 0;
}

// ── MP4 / MOV ─────────────────────────────────────────────────────────────────

interface Box { type: string; start: number; body: number; end: number }

function* boxes(b: Uint8Array, from: number, to: number): Generator<Box> {
  let o = from;
  while (o + 8 <= to) {
    let size = u32(b, o);
    let head = 8;
    if (size === 1) {
      if (o + 16 > to) return;
      size = u64(b, o + 8);
      head = 16;
    } else if (size === 0) {
      size = to - o;
    }
    if (size < head || o + size > to) return;
    yield { type: tag(b, o + 4), start: o, body: o + head, end: o + size };
    o += size;
  }
}

const find = (b: Uint8Array, parent: Box, type: string): Box | undefined => {
  for (const c of boxes(b, parent.body, parent.end)) if (c.type === type) return c;
  return undefined;
};

/** Turn a box into an empty `free` box of the same size. */
function toFree(b: Uint8Array, box: Box): number {
  const was = box.type !== 'free' ? 1 : 0;
  b[box.start + 4] = 0x66; b[box.start + 5] = 0x72; b[box.start + 6] = 0x65; b[box.start + 7] = 0x65;
  return blank(b, box.body, box.end) | was;
}

/** Boxes that hold nothing but metadata, wherever they are found. */
const METADATA_BOXES = new Set(['udta', 'meta', 'uuid', 'XMP_', 'cprt', 'pnot', 'PICT']);
const PADDING_BOXES = new Set(['free', 'skip', 'wide']);
/** The tracks a video is made of. Every other kind is data about it. */
const KEPT_HANDLERS = new Set(['vide', 'soun', 'auxv', 'pict']);
/** Still pictures use the same boxes, and there `meta` is the picture. */
const STILL_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'avif', 'avis', 'jxl ']);

/** The creation and modification dates at the front of mvhd, tkhd and mdhd. */
function blankDates(b: Uint8Array, box: Box): number {
  const wide = b[box.body] === 1;
  return blank(b, box.body + 4, Math.min(box.end, box.body + 4 + (wide ? 16 : 8)));
}

/** A handler's name: everything after its type and the reserved words. */
const blankHandlerName = (b: Uint8Array, box: Box) => (box.body + 24 < box.end ? blank(b, box.body + 24, box.end) : 0);

/** Where a dropped track's samples sit, so they can be blanked too. Null when
 *  its tables can't be read — the track is still dropped. */
function sampleRanges(b: Uint8Array, stbl: Box): [number, number][] | null {
  const stsz = find(b, stbl, 'stsz');
  const stsc = find(b, stbl, 'stsc');
  const stco = find(b, stbl, 'stco');
  const co64 = find(b, stbl, 'co64');
  const offsets = stco ?? co64;
  if (!stsz || !stsc || !offsets) return null;

  const fixed = u32(b, stsz.body + 4);
  const samples = u32(b, stsz.body + 8);
  if (!fixed && stsz.body + 12 + samples * 4 > stsz.end) return null;
  const runs = u32(b, stsc.body + 4);
  if (stsc.body + 8 + runs * 12 > stsc.end) return null;
  const chunks = u32(b, offsets.body + 4);
  const step = co64 ? 8 : 4;
  if (offsets.body + 8 + chunks * step > offsets.end) return null;

  const ranges: [number, number][] = [];
  let sample = 0;
  let run = 0;
  for (let chunk = 1; chunk <= chunks && sample < samples; chunk++) {
    while (run + 1 < runs && u32(b, stsc.body + 8 + (run + 1) * 12) <= chunk) run++;
    const perChunk = u32(b, stsc.body + 8 + run * 12 + 4);
    let size = 0;
    for (let i = 0; i < perChunk && sample < samples; i++, sample++) size += fixed || u32(b, stsz.body + 12 + sample * 4);
    const at = co64 ? u64(b, offsets.body + 8 + (chunk - 1) * 8) : u32(b, offsets.body + 8 + (chunk - 1) * 4);
    ranges.push([at, at + size]);
  }
  return ranges;
}

function scrubTrack(b: Uint8Array, trak: Box, mdats: Box[], fragmented: boolean): number {
  const mdia = find(b, trak, 'mdia');
  const hdlr = mdia && find(b, mdia, 'hdlr');
  const handler = hdlr && hdlr.body + 12 <= hdlr.end ? tag(b, hdlr.body + 8) : '';
  const minf = mdia && find(b, mdia, 'minf');
  const stbl = minf && find(b, minf, 'stbl');

  // Not picture and not sound: the track goes, and what it pointed at is
  // blanked — but only bytes that are inside the file's media data, so a
  // table that reads wrongly can't reach anything else. (A fragmented file
  // keeps its samples elsewhere; there the track is left alone.)
  if (handler && !KEPT_HANDLERS.has(handler) && !fragmented) {
    let n = 0;
    for (const [from, to] of (stbl && sampleRanges(b, stbl)) || []) {
      if (mdats.some((m) => from >= m.body && to <= m.end)) n |= blank(b, from, to);
    }
    return n | toFree(b, trak);
  }

  let n = 0;
  for (const c of boxes(b, trak.body, trak.end)) {
    if (c.type === 'tkhd') n += blankDates(b, c);
    else if (METADATA_BOXES.has(c.type)) n += toFree(b, c);
    else if (PADDING_BOXES.has(c.type)) n += blank(b, c.body, c.end);
  }
  if (!mdia) return n;
  for (const c of boxes(b, mdia.body, mdia.end)) {
    if (c.type === 'mdhd') n += blankDates(b, c);
    else if (c.type === 'hdlr') n += blankHandlerName(b, c);
    else if (METADATA_BOXES.has(c.type)) n += toFree(b, c);
  }
  // QuickTime's second handler, the data handler, carries a name as well.
  const dhlr = minf && find(b, minf, 'hdlr');
  if (dhlr) n += blankHandlerName(b, dhlr);

  const stsd = stbl && find(b, stbl, 'stsd');
  if (stsd) {
    for (const entry of boxes(b, stsd.body + 8, stsd.end)) {
      // The vendor code (QuickTime; reserved, so already zero, in an MP4).
      if (entry.start + 24 <= entry.end) n += blank(b, entry.start + 20, entry.start + 24);
      // The encoder's name: 32 bytes, in a picture's description only.
      if (handler === 'vide' && entry.start + 86 <= entry.end) n += blank(b, entry.start + 50, entry.start + 82);
    }
  }
  return n;
}

// x264 and x265 write their version and every setting they ran with into the
// stream, as an SEI message that opens with one of these two ids.
const ENCODER_SEI: number[][] = [
  [0xdc, 0x45, 0xe9, 0xbd, 0xe6, 0xd9, 0x48, 0xb7, 0x96, 0x2c, 0xd8, 0x20, 0xd9, 0x23, 0xee, 0xef],
  [0x2c, 0xa2, 0xde, 0x09, 0xb5, 0x17, 0x47, 0xdb, 0xbb, 0x55, 0xa4, 0xfe, 0x7f, 0xc2, 0xfc, 0x4e],
];

/** Blank those messages. Each is kept as a message of the same length, so the
 *  stream around it still reads; only what it said is gone. */
function scrubEncoderSei(b: Uint8Array, from: number, to: number): number {
  let n = 0;
  for (const id of ENCODER_SEI) {
    for (let p = b.indexOf(id[0], from); p !== -1 && p + 16 <= to; p = b.indexOf(id[0], p + 1)) {
      let match = true;
      for (let i = 1; i < 16; i++) if (b[p + i] !== id[i]) { match = false; break; }
      if (!match || p < from + 3) continue;
      // Before the id: the message's type (5, "user data") and its length,
      // written as a run of 255s and a last byte.
      if (b[p - 1] === 0xff) continue;
      let size = b[p - 1];
      let q = p - 2;
      while (q > from && b[q] === 0xff) { size += 255; q--; }
      if (b[q] !== 5 || size < 16 || size > 16_384) continue;
      n += blank(b, p, Math.min(p + size, to), 0x20);
    }
  }
  return n;
}

/** ffmpeg's own AAC encoder signs the first audio frame with its library
 *  version ("Lavc60.31.102"), as filler the decoder skips. Zeroed, it is
 *  still filler. */
function scrubLavcIdent(b: Uint8Array, from: number, to: number): number {
  let n = 0;
  for (let p = b.indexOf(0x4c, from); p !== -1 && p + 6 <= to; p = b.indexOf(0x4c, p + 1)) {
    if (b[p + 1] !== 0x61 || b[p + 2] !== 0x76 || b[p + 3] !== 0x63) continue;
    let e = p + 4;
    while (e < to && e < p + 24 && ((b[e] >= 0x30 && b[e] <= 0x39) || b[e] === 0x2e)) e++;
    // "Lavc" and then a version: digits with at least one dot in them.
    if (e - p < 7 || !b.subarray(p + 4, e).includes(0x2e)) continue;
    n += blank(b, p, e);
  }
  return n;
}

function scrubMp4(b: Uint8Array): number {
  const top = [...boxes(b, 0, b.length)];
  const ftyp = top.find((x) => x.type === 'ftyp');
  if (ftyp && ftyp.body + 4 <= ftyp.end && STILL_BRANDS.has(tag(b, ftyp.body))) return -1;
  const moov = top.find((x) => x.type === 'moov');
  if (!moov) return -1;
  const mdats = top.filter((x) => x.type === 'mdat');
  const fragmented = !!find(b, moov, 'mvex') || top.some((x) => x.type === 'moof');

  let n = 0;
  for (const box of top) {
    if (METADATA_BOXES.has(box.type)) n += toFree(b, box);
    else if (PADDING_BOXES.has(box.type)) n += blank(b, box.body, box.end);
    else if (box.type === 'mdat') n += scrubLavcIdent(b, box.body, box.end);
  }
  // Anywhere: x264 puts it in the first frame, x265 beside the parameter
  // sets in the track's description.
  n += scrubEncoderSei(b, 0, b.length);
  for (const c of boxes(b, moov.body, moov.end)) {
    if (c.type === 'mvhd') n += blankDates(b, c);
    else if (c.type === 'trak') n += scrubTrack(b, c, mdats, fragmented);
    else if (METADATA_BOXES.has(c.type)) n += toFree(b, c);
    else if (PADDING_BOXES.has(c.type)) n += blank(b, c.body, c.end);
  }
  return n;
}

// ── WebM / Matroska ───────────────────────────────────────────────────────────

interface Element { id: number; start: number; data: number; end: number; unknown: boolean }

function* elements(b: Uint8Array, from: number, to: number): Generator<Element> {
  let o = from;
  while (o + 2 <= to) {
    const idLen = Math.clz32(b[o]) - 23;
    if (idLen < 1 || idLen > 4 || o + idLen >= to) return;
    let id = 0;
    for (let i = 0; i < idLen; i++) id = id * 256 + b[o + i];
    const s = o + idLen;
    const sizeLen = Math.clz32(b[s]) - 23;
    if (sizeLen < 1 || sizeLen > 8 || s + sizeLen > to) return;
    let size = b[s] & (0xff >> sizeLen);
    let unknown = size === (0xff >> sizeLen);
    for (let i = 1; i < sizeLen; i++) {
      if (b[s + i] !== 0xff) unknown = false;
      size = size * 256 + b[s + i];
    }
    const data = s + sizeLen;
    const end = unknown ? to : data + size;
    if (end > to) return;
    yield { id, start: o, data, end, unknown };
    if (unknown) return;
    o = end;
  }
}

/** Turn an element into an empty Void element of the same size. */
function toVoid(b: Uint8Array, el: Element): number {
  const total = el.end - el.start;
  if (el.unknown || total < 2) return 0;
  if (total - 2 <= 126) {
    b[el.start] = 0xec;
    b[el.start + 1] = 0x80 | (total - 2);
    b.fill(0, el.start + 2, el.end);
  } else {
    b[el.start] = 0xec;
    b[el.start + 1] = 0x01;
    let left = total - 9;
    for (let i = 8; i >= 2; i--) { b[el.start + i] = left % 256; left = Math.floor(left / 256); }
    b.fill(0, el.start + 9, el.end);
  }
  return 1;
}

const EBML = 0x1a45dfa3, SEGMENT = 0x18538067, INFO = 0x1549a966, TRACKS = 0x1654ae6b, TRACK_ENTRY = 0xae, CLUSTER = 0x1f43b675;
/** Whole elements that are metadata: Tags, Attachments, Chapters. */
const WEBM_DROP = new Set([0x1254c367, 0x1941a469, 0x1043a770]);
/** In Info: the date, the title and the file names go… */
const INFO_DROP = new Set([0x4461, 0x7ba9, 0x7384, 0x3c83ab, 0x3e83bb]);
/** …and the muxing and writing app, which a file must have, are blanked. */
const INFO_BLANK = new Set([0x4d80, 0x5741]);
/** In a track: its name and its codec's display name. */
const TRACK_DROP = new Set([0x536e, 0x258688]);

function scrubWebm(b: Uint8Array): number {
  let n = 0;
  for (const top of elements(b, 0, b.length)) {
    if (top.id !== SEGMENT) continue;
    for (const el of elements(b, top.data, top.end)) {
      if (el.id === CLUSTER && el.unknown) break;
      if (WEBM_DROP.has(el.id)) n += toVoid(b, el);
      else if (el.id === INFO) {
        for (const c of elements(b, el.data, el.end)) {
          if (INFO_DROP.has(c.id)) n += toVoid(b, c);
          else if (INFO_BLANK.has(c.id)) n += blank(b, c.data, c.end, 0x20);
        }
      } else if (el.id === TRACKS) {
        for (const track of elements(b, el.data, el.end)) {
          if (track.id !== TRACK_ENTRY) continue;
          for (const c of elements(b, track.data, track.end)) if (TRACK_DROP.has(c.id)) n += toVoid(b, c);
        }
      }
    }
  }
  return n;
}

// ── What the rest of the app calls ────────────────────────────────────────────

/** Strip the metadata from a whole video file held in memory, in place. */
export function scrubVideoBytes(bytes: Uint8Array): ScrubReport {
  if (bytes.length < 16) return { kind: null, changed: 0 };
  if (u32(bytes, 0) === EBML) return { kind: 'webm', changed: scrubWebm(bytes) };
  const first = tag(bytes, 4);
  if (['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'styp'].includes(first)) {
    const changed = scrubMp4(bytes);
    return changed < 0 ? { kind: null, changed: 0 } : { kind: 'mp4', changed };
  }
  return { kind: null, changed: 0 };
}

/** The same video with its metadata stripped — for a blob on its way out of
 *  the browser. Anything that is not a video this handles (a picture, a zip)
 *  comes back as it was given, and so does a video that can't be read: a file
 *  that still carries its metadata goes out rather than nothing going. */
export async function stripVideoMetadata<T extends Blob>(blob: T): Promise<T> {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const report = scrubVideoBytes(bytes);
    if (!report.kind || !report.changed) return blob;
    const named = blob as Blob as { name?: unknown };
    if (typeof File !== 'undefined' && blob instanceof File && typeof named.name === 'string') {
      return new File([bytes], named.name, { type: blob.type }) as Blob as T;
    }
    return new Blob([bytes], { type: blob.type }) as T;
  } catch (err) {
    console.warn('[video metadata] could not strip this file, sending it as it is:', err);
    return blob;
  }
}
