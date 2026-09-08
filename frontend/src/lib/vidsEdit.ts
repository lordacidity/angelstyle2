'use client';

// Single-clip editing: the model behind the Vids "Prep" page, plus the renderer
// that bakes an edit into a new MP4.
//
// An edit never touches the uploaded footage. It is four things laid over the
// source clip:
//
//   trim    in / out points, so the head and tail come off.
//   cuts    ranges *inside* the trim that are removed — this is how you take a
//           chunk out of the middle. What's left is a list of kept segments
//           played back to back.
//   speed   playback rate, exactly as the builder means it: 2 plays twice as
//           fast and lands half as long.
//   muted   drop the clip's OWN audio. Vids are silent throughout — nothing in
//           the section offers a way to turn the footage's sound back on — so
//           this is always set. The mixing path below stays because it is what
//           honours it.
//   sfx     stretches the keyboard sound plays over, in source seconds. This is
//           the one thing that can put audio in a Vid: the sample is looped
//           across each stretch and mixed on its own, so a clip stays silent
//           apart from the typing you asked for.
//
// Everything below is in one of two clocks and it matters which:
//   SOURCE seconds  — a position in the original file. Trim and cuts live here.
//   OUTPUT seconds  — a position in the rendered clip. output = kept / speed,
//                     where `kept` is source seconds counted with the cuts
//                     already skipped.
// keptAt() and sourceAt() convert between them; every other helper is built on
// those two, so the preview scrubber and the encoder can never disagree.

import type * as MB from 'mediabunny';
import {
  clampSpeed, smoothScaling, trimmedRange, videoBitrate,
  DEFAULT_SPEED, DEFAULT_TRIM, type Trim,
} from '@/lib/vidsPlan';
import { decodeAudio, scheduleLoop, SFX_URL } from '@/lib/vidsAudio';
import type { VidEdit, VidMark } from '@/lib/vids-types';

/** A removed range, in source seconds. */
export interface Cut { start: number; end: number }
/** A kept piece of the source, in source seconds. */
export type Segment = Cut;

export interface ClipEdit {
  trim: Trim;
  cuts: Cut[];
  /** Where the keyboard sound plays, in source seconds. */
  sfx: Cut[];
  /** How loud it sits over the picture. */
  sfxGain: number;
  speed: number;
  muted: boolean;
}

export const MIN_SFX_GAIN = 0;
export const MAX_SFX_GAIN = 1.5;
export const DEFAULT_SFX_GAIN = 0.8;
export const clampSfxGain = (v: number): number =>
  Number.isFinite(v) ? clamp(v, MIN_SFX_GAIN, MAX_SFX_GAIN) : DEFAULT_SFX_GAIN;

export const DEFAULT_EDIT: ClipEdit = {
  trim: { ...DEFAULT_TRIM },
  cuts: [],
  sfx: [],
  sfxGain: DEFAULT_SFX_GAIN,
  speed: DEFAULT_SPEED,
  muted: true,
};

/** Shorter than this and a piece isn't worth keeping (or cutting). */
export const MIN_PIECE = 0.05;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Whether this edit would change the footage. `baseSpeed` is the rate the
 *  comparison is against: 1x by default — what the source is — but the editor
 *  also asks the question against the speed a clip opened at, to know whether
 *  anything has been touched since. */
export function isEdited(e: ClipEdit, duration: number, baseSpeed = DEFAULT_SPEED): boolean {
  const r = trimmedRange(e.trim, duration);
  return r.start > 0.001 || r.end < duration - 0.001 || e.cuts.length > 0
    || e.sfx.length > 0 || Math.abs(e.speed - baseSpeed) > 1e-6;
}

/** Whether two edits would render the same footage. Ranges are compared after
 *  normalising, so a cut dragged and put back exactly is not a change, and
 *  the gain only counts while there are keys for it to apply to. */
export function sameEdit(a: ClipEdit, b: ClipEdit, duration: number, eps = 1e-3): boolean {
  const full = Math.max(0, duration);
  const ra = trimmedRange(a.trim, full);
  const rb = trimmedRange(b.trim, full);
  const near = (x: number, y: number) => Math.abs(x - y) <= eps;
  const sameRanges = (x: readonly Cut[], y: readonly Cut[]) =>
    x.length === y.length && x.every((c, i) => near(c.start, y[i].start) && near(c.end, y[i].end));
  const sa = normaliseRanges(a.sfx, ra);
  const sb = normaliseRanges(b.sfx, rb);
  return near(ra.start, rb.start) && near(ra.end, rb.end)
    && sameRanges(normaliseRanges(a.cuts, ra), normaliseRanges(b.cuts, rb))
    && sameRanges(sa, sb)
    && Math.abs(clampSpeed(a.speed) - clampSpeed(b.speed)) < 1e-6
    && a.muted === b.muted
    && (sa.length === 0 || near(clampSfxGain(a.sfxGain), clampSfxGain(b.sfxGain)));
}

// ── The stored form ───────────────────────────────────────────────────────────
// A clip's row keeps the recording it was uploaded as and the edit its file was
// rendered with (vids-types VidEdit) — the same shape as ClipEdit, pinned down
// here at the boundary. Going out, the ranges are normalised against the trim
// so the row never holds a cut that hangs outside it.

export function toStoredEdit(e: ClipEdit, duration: number): VidEdit {
  const range = trimmedRange(e.trim, Math.max(0, duration));
  return {
    trim: { start: range.start, end: e.trim.end === null ? null : range.end },
    cuts: normaliseRanges(e.cuts, range),
    sfx: normaliseRanges(e.sfx, range),
    sfxGain: clampSfxGain(e.sfxGain),
    speed: clampSpeed(e.speed),
    muted: e.muted,
  };
}

export function fromStoredEdit(e: VidEdit): ClipEdit {
  return {
    trim: { ...e.trim },
    cuts: e.cuts.map((c) => ({ ...c })),
    sfx: e.sfx.map((c) => ({ ...c })),
    sfxGain: clampSfxGain(e.sfxGain),
    speed: clampSpeed(e.speed),
    muted: e.muted,
  };
}

// ── Marks across the two clocks ───────────────────────────────────────────────
// Marks are stored on the clip's RENDERED clock — the file the builder plays,
// which is what the captions are timed against. The editor works on the SOURCE
// clock. The edit the current render was made with is the bridge between them.

/** Rendered → source, through the edit that made the render. Before the
 *  footage has been measured there is nothing to map through, so the marks
 *  come back as they are. */
export function marksToSource(marks: readonly VidMark[], edit: ClipEdit, duration: number): VidMark[] {
  const segs = duration > 0 ? keptSegments(edit, duration) : [];
  if (!segs.length) return marks.map((m) => ({ ...m }));
  const speed = clampSpeed(edit.speed);
  return marks.map((m) => ({ ...m, start: sourceAt(segs, m.start * speed), end: sourceAt(segs, m.end * speed) }));
}

/** Source → rendered, through the edit being rendered. Cuts pull everything
 *  after them earlier, the trim re-bases the start, and speed compresses the
 *  lot. A mark the edit removed — wholly inside a cut, or outside the trim —
 *  collapses to nothing and is dropped rather than left pointing at footage
 *  that no longer exists. */
export function marksToRendered(marks: readonly VidMark[], edit: ClipEdit, duration: number): VidMark[] {
  const segs = duration > 0 ? keptSegments(edit, duration) : [];
  if (!segs.length) return marks.map((m) => ({ ...m }));
  const speed = clampSpeed(edit.speed);
  const out: VidMark[] = [];
  for (const m of marks) {
    const start = keptAt(segs, m.start) / speed;
    const end = keptAt(segs, m.end) / speed;
    if (end - start < 0.05) continue;
    out.push({ start, end, text: m.text });
  }
  return out;
}

/** Clamp ranges into the trim, drop slivers, sort, and merge anything touching.
 *  Cuts and sfx spans are both kept in this shape, so both go through here. */
export function normaliseRanges(ranges: readonly Cut[], range: { start: number; end: number }): Cut[] {
  const clean = ranges
    .map((c) => ({
      start: clamp(Math.min(c.start, c.end), range.start, range.end),
      end: clamp(Math.max(c.start, c.end), range.start, range.end),
    }))
    .filter((c) => c.end - c.start >= MIN_PIECE)
    .sort((a, b) => a.start - b.start);

  const merged: Cut[] = [];
  for (const c of clean) {
    const last = merged[merged.length - 1];
    if (last && c.start <= last.end + 1e-6) last.end = Math.max(last.end, c.end);
    else merged.push({ ...c });
  }
  return merged;
}

/** What survives the trim and the cuts, in order. */
export function keptSegments(edit: ClipEdit, duration: number): Segment[] {
  const range = trimmedRange(edit.trim, Math.max(0, duration));
  const cuts = normaliseRanges(edit.cuts, range);
  const segs: Segment[] = [];
  let t = range.start;
  for (const c of cuts) {
    if (c.start - t >= MIN_PIECE) segs.push({ start: t, end: c.start });
    t = Math.max(t, c.end);
  }
  if (range.end - t >= MIN_PIECE) segs.push({ start: t, end: range.end });
  return segs;
}

/** Source seconds kept, before speed. */
export function keptLength(segs: readonly Segment[]): number {
  return segs.reduce((n, s) => n + Math.max(0, s.end - s.start), 0);
}

/** How long the rendered clip runs. */
export function editedLength(edit: ClipEdit, duration: number): number {
  return keptLength(keptSegments(edit, duration)) / clampSpeed(edit.speed);
}

/** Kept position (source seconds with cuts skipped) → source second. */
export function sourceAt(segs: readonly Segment[], kept: number): number {
  let acc = 0;
  for (const s of segs) {
    const len = Math.max(0, s.end - s.start);
    if (kept < acc + len) return s.start + (kept - acc);
    acc += len;
  }
  const last = segs[segs.length - 1];
  return last ? last.end : 0;
}

/** Source second → kept position. A source time inside a cut reports the join. */
export function keptAt(segs: readonly Segment[], source: number): number {
  let acc = 0;
  for (const s of segs) {
    if (source < s.start) return acc;
    if (source <= s.end) return acc + (source - s.start);
    acc += Math.max(0, s.end - s.start);
  }
  return acc;
}

/** The kept segment holding this source time, or null when it lands in a cut. */
export function segmentAt(segs: readonly Segment[], source: number): Segment | null {
  return segs.find((s) => source >= s.start && source <= s.end) ?? null;
}

/** Playing forward from `source`, the next source time that is actually kept.
 *  Returns null once the playhead has run off the end of the last segment. */
export function nextKept(segs: readonly Segment[], source: number): number | null {
  for (const s of segs) {
    if (source < s.start) return s.start;
    if (source < s.end) return source;
  }
  return null;
}

// ── Auto cut ──────────────────────────────────────────────────────────────────
// The jump-cut pass: whip a handful of short pieces out of the clip so it
// never sits still. Short enough (0.4–0.6s) that nothing is really lost, and
// spread out rather than truly random — one per equal window of what is still
// kept, jittered inside its window, so two cuts can't land on top of each other
// and the clip doesn't stutter in one spot and run long everywhere else.

export const AUTO_CUT_MIN = 0.4;
export const AUTO_CUT_MAX = 0.6;
/** How many to make (inclusive) — one is chosen at random each time. */
export const AUTO_CUT_COUNT = [5, 6] as const;
/** Footage each cut needs around it, so the pieces between them stay watchable. */
const AUTO_CUT_BREATH = 0.35;
/** Fewer than this and it isn't a pass, it's a nick — say so instead. */
const AUTO_CUT_FLOOR = 3;

/** Fresh cuts for the footage a clip still keeps, in source seconds. Returns []
 *  when there isn't room — nothing to say, nothing removed. */
export function autoCuts(edit: ClipEdit, duration: number, rand: () => number = Math.random): Cut[] {
  const segs = keptSegments(edit, duration);
  const total = keptLength(segs);
  const want = AUTO_CUT_COUNT[Math.floor(rand() * AUTO_CUT_COUNT.length)] ?? AUTO_CUT_COUNT[0];
  // Each cut needs its own slice of the timeline plus breathing room either side.
  const per = AUTO_CUT_MAX + AUTO_CUT_BREATH * 2;
  const n = Math.min(want, Math.floor(total / per));
  if (n < AUTO_CUT_FLOOR) return [];

  const out: Cut[] = [];
  const window = total / n;
  for (let i = 0; i < n; i++) {
    const len = AUTO_CUT_MIN + rand() * (AUTO_CUT_MAX - AUTO_CUT_MIN);
    const lo = i * window + AUTO_CUT_BREATH;
    const hi = (i + 1) * window - AUTO_CUT_BREATH - len;
    if (hi <= lo) continue;
    const at = lo + rand() * (hi - lo);
    // Back to source seconds. A cut that would run over a join is clipped to the
    // piece it started in, so it never silently swallows footage on the far side.
    const from = sourceAt(segs, at);
    const seg = segmentAt(segs, from);
    const to = Math.min(sourceAt(segs, at + len), seg ? seg.end : from + len);
    if (to - from >= MIN_PIECE) out.push({ start: from, end: to });
  }
  return out;
}

// ── Keyboard sound ────────────────────────────────────────────────────────────
// One sample, looped across each stretch the edit marks. The stretches are held
// in SOURCE seconds like everything else the timeline draws, but the mixer wants
// them on the OUTPUT clock — so they go through the same kept/speed conversion
// the picture does, which is what keeps the typing under the frames it was put
// under however the cuts around it move.

/** SFX stretches on the output clock: cuts collapsed, speed applied. A stretch a
 *  cut swallowed whole collapses to nothing and drops out here; one that spans a
 *  cut plays straight through the join, which is the point — the typing runs on
 *  and the jump lands under it. */
export function sfxSpans(edit: ClipEdit, duration: number): Cut[] {
  const segs = keptSegments(edit, duration);
  const speed = clampSpeed(edit.speed);
  const out = keptLength(segs) / speed;
  const spans = normaliseRanges(edit.sfx, trimmedRange(edit.trim, Math.max(0, duration)))
    .map((s) => ({ start: keptAt(segs, s.start) / speed, end: keptAt(segs, s.end) / speed }));
  return normaliseRanges(spans, { start: 0, end: out });
}

// ── Render ────────────────────────────────────────────────────────────────────

export interface RenderOptions {
  /** Playback URL of the source clip. */
  url: string;
  /** The clip as a file on the disk, when it has not been uploaded yet — the
   *  intake run edits before it saves. Read directly, rather than through the
   *  blob: URL the preview plays, which is not a thing to make range requests
   *  of. */
  file?: Blob;
  edit: ClipEdit;
  /** Source length in seconds — the browser-measured one, not the stored guess. */
  duration: number;
  /** Frames per second to render at. Defaults to the source's own rate, which is
   *  what keeps repeated edits from resampling the timeline over and over. */
  fps?: number;
  onProgress?: (frac: number, label: string) => void;
  signal?: AbortSignal;
}

/** Encoders want even dimensions, and a browser that happily encodes 1080p can
 *  refuse 4K — so try the clip's own size first, then the same picture scaled to
 *  fit inside MAX_SIDE. */
const MAX_SIDE = 1920;
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Bake an edit into a new MP4, entirely in the browser (WebCodecs via
 *  mediabunny) — same reasoning as vidsCompose: no server ffmpeg, so localhost
 *  and Vercel behave identically. Kept segments are decoded in order and drawn
 *  back to back; audio is laid onto an OfflineAudioContext at the same joins and
 *  resampled by `speed`, matching what the preview plays. */
export async function renderEditedClip(opts: RenderOptions): Promise<Blob> {
  const {
    Input, UrlSource, BlobSource, ALL_FORMATS, VideoSampleSink, AudioSampleSink,
    Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource,
    canEncodeVideo, canEncodeAudio,
  } = await import('mediabunny');

  const { edit, duration, signal } = opts;
  const report = opts.onProgress ?? (() => {});
  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  };

  const segs = keptSegments(edit, duration);
  const speed = clampSpeed(edit.speed);
  const total = keptLength(segs) / speed;
  if (!segs.length || total <= 0) throw new Error('Nothing left to save — the whole clip is trimmed or cut away.');
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('This browser has no WebCodecs support — save from Chrome or Edge.');
  }

  const input = new Input({
    source: opts.file ? new BlobSource(opts.file) : new UrlSource(opts.url),
    formats: ALL_FORMATS,
  });
  let gen: AsyncGenerator<MB.VideoSample | null, void, unknown> | null = null;

  try {
    report(0, 'Opening the clip…');
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('This file has no video track.');
    if (!(await track.canDecode())) {
      throw new Error(`This browser can't decode this clip's codec (${track.codec ?? 'unknown'}).`);
    }

    // Re-encoding is where an edit costs picture quality, and these clips get
    // edited repeatedly — so take the source's own frame rate and bitrate rather
    // than a fixed 30fps at a fixed quality. Resampling 24 or 60fps footage onto
    // a 30fps grid every save is the visible half of that; encoding it thinner
    // than it arrived is the rest.
    const stats = await track.computePacketStats(240).catch(() => null);
    const srcFps = stats?.averagePacketRate ?? 0;
    const fps = opts.fps
      ?? (Number.isFinite(srcFps) && srcFps > 0 ? clamp(Math.round(srcFps), 1, 120) : 30);

    let width = even(track.displayWidth);
    let height = even(track.displayHeight);
    if (!(await canEncodeVideo('avc', { width, height }))) {
      const k = MAX_SIDE / Math.max(width, height);
      if (k < 1) {
        width = even(width * k);
        height = even(height * k);
      }
      if (!(await canEncodeVideo('avc', { width, height }))) {
        throw new Error(`This browser can't encode H.264 at ${width}×${height}.`);
      }
    }

    const frameCount = Math.max(1, Math.round(total * fps));
    // Output frame → source second: walk the kept segments at `speed`. Ascending
    // by construction, which is what samplesAtTimestamps needs. The very end is
    // pulled back a hair so the last frame lands inside the final segment rather
    // than on its out point (often the first frame of what was cut away).
    const lastKept = Math.max(0, keptLength(segs) - 1e-3);
    const stamps = function* () {
      for (let f = 0; f < frameCount; f++) yield sourceAt(segs, Math.min((f / fps) * speed, lastKept));
    };
    gen = new VideoSampleSink(track).samplesAtTimestamps(stamps());

    // ── Audio ────────────────────────────────────────────────────────────────
    // Two layers on one offline mix, built before output.start() because tracks
    // must be registered first: the clip's own sound — only when it isn't muted,
    // which in this section it always is — and the keyboard, looped across the
    // stretches the edit marks. Either layer alone is reason to write an audio
    // track; neither, and the file comes out silent the way Vids normally are.
    const keys = sfxSpans(edit, duration);
    let mixed: AudioBuffer | null = null;
    const wantAudio = (!edit.muted || keys.length > 0)
      && typeof OfflineAudioContext !== 'undefined' && (await canEncodeAudio('aac'));

    if (wantAudio) {
      const SR = 48_000;
      const octx = new OfflineAudioContext(2, Math.max(1, Math.ceil(total * SR)), SR);
      let scheduled = 0;

      if (!edit.muted) {
        report(0.02, 'Mixing audio…');
        const at = await input.getPrimaryAudioTrack();
        if (at && (await at.canDecode())) {
          const sink = new AudioSampleSink(at);
          let acc = 0;      // kept seconds already laid down
          for (const seg of segs) {
            const span = Math.max(0, seg.end - seg.start);
            const pieces: AudioBuffer[] = [];
            let firstTs: number | null = null;
            for await (const s of sink.samples(seg.start, seg.end)) {
              throwIfAborted();
              if (firstTs === null) firstTs = s.timestamp;
              pieces.push(s.toAudioBuffer());
              s.close();
            }
            acc += span;
            if (!pieces.length) continue;
            // One buffer at the clip's native rate; the offline graph resamples.
            const ch = Math.min(2, pieces[0].numberOfChannels) || 1;
            const length = pieces.reduce((n, b) => n + b.length, 0);
            const buf = octx.createBuffer(ch, length, pieces[0].sampleRate);
            let off = 0;
            for (const piece of pieces) {
              for (let c = 0; c < ch; c++) {
                buf.copyToChannel(piece.getChannelData(Math.min(c, piece.numberOfChannels - 1)), c, off);
              }
              off += piece.length;
            }
            const src = octx.createBufferSource();
            src.buffer = buf;
            src.connect(octx.destination);
            src.playbackRate.value = speed;
            // `lead` > 0: the decoded audio starts a little after the segment's
            // in point; < 0: the first sample straddles it, so skip into the
            // buffer instead. It is in source seconds, so /speed turns it into
            // output seconds. start()'s offset and duration stay in buffer
            // seconds.
            const lead = (firstTs ?? seg.start) - seg.start;
            const at0 = (acc - span) / speed;
            src.start(at0 + Math.max(0, lead) / speed, Math.max(0, -lead), span);
            scheduled++;
          }
        }
      }

      if (keys.length) {
        report(0.03, 'Laying in the keyboard…');
        const sample = await decodeAudio(octx, SFX_URL);
        throwIfAborted();
        const gain = clampSfxGain(edit.sfxGain);
        for (const span of keys) {
          scheduleLoop(octx, sample, span, gain);
          scheduled++;
        }
      }

      if (scheduled) mixed = await octx.startRendering();
    }

    // ── Video ────────────────────────────────────────────────────────────────
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    smoothScaling(ctx);

    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new BufferTarget(),
    });
    const videoSource = new CanvasSource(canvas, {
      codec: 'avc',
      bitrate: videoBitrate(width, height, fps, stats?.averageBitrate ?? 0),
    });
    output.addVideoTrack(videoSource, { frameRate: fps });
    let audioSource: MB.AudioBufferSource | null = null;
    if (mixed) {
      audioSource = new AudioBufferSource({ codec: 'aac', bitrate: 192_000 });
      output.addAudioTrack(audioSource);
    }

    await output.start();
    try {
      let painted = false;
      for (let f = 0; f < frameCount; f++) {
        throwIfAborted();
        // samplesAtTimestamps clones when one decoded frame serves several
        // output frames, so every yielded sample is ours to close. Nothing
        // yielded means the same frame stands — which is how a frame stretches
        // when the clip is slowed down.
        const { value: sample } = await gen.next();
        if (sample) {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, width, height);
          sample.drawWithFit(ctx, { fit: 'fill' });
          sample.close();
          painted = true;
        } else if (!painted) {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, width, height);
        }
        await videoSource.add(f / fps, 1 / fps);
        if (f % 5 === 0 || f === frameCount - 1) {
          report(0.05 + ((f + 1) / frameCount) * 0.9, `Rendering frame ${f + 1} / ${frameCount}`);
        }
      }
      videoSource.close();

      if (audioSource && mixed) {
        report(0.96, 'Encoding audio…');
        await audioSource.add(mixed);
        audioSource.close();
      }

      report(0.98, 'Finalizing…');
      await output.finalize();
    } catch (e) {
      if (output.state !== 'finalized' && output.state !== 'canceled') {
        await output.cancel().catch(() => {});
      }
      throw e;
    }

    const buf = output.target.buffer;
    if (!buf) throw new Error('Encoder produced no output.');
    report(1, 'Done');
    return new Blob([buf], { type: 'video/mp4' });
  } finally {
    // Stop the decoder pump (e.g. after a cancel), then free the input.
    if (gen) await gen.return().catch(() => {});
    input.dispose();
  }
}
