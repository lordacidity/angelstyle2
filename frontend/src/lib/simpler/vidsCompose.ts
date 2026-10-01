'use client';

// Client-side renderer for the Vids builder. Walks the plan frame by frame:
// every slot on screen at that instant is decoded (WebCodecs via mediabunny),
// drawn into its region with the same drawPlanItem() the live preview uses,
// and the composite is encoded to H.264. Audio from every un-muted slot is
// mixed on an OfflineAudioContext at the slot's timeline offset and encoded to
// AAC. Runs entirely in the browser — no server ffmpeg, so Vercel and
// localhost behave identically (same reasoning as canvasVideoExport.ts).
//
// A slot's `speed` shows up twice: clip time advances that much faster per
// output frame, and its audio is time-stretched by the same factor. Stretching
// leaves the pitch where it was, which the live preview matches by leaving
// preservesPitch on — what you hear while scrubbing is what lands in the file.
//
// Sound comes from three places and none is the footage: the keyboard a clip
// is carrying (a slot is only ever un-muted for that), room tone, and the song
// the build chose — the last two laid once under the whole finished timeline.

import type * as MB from 'mediabunny';
import { isPhoto } from '@/lib/vids-types';
import { withBase } from '@/lib/clipping';
import { localClipBlob } from '@/lib/simpler/vidsLocal';
import { cachedClipBlob, isCacheableClipUrl } from '@/lib/vids-clip-cache';
import {
  drawPlanItem, isBoomItem, smoothScaling, videoBitrate,
  type Plan, type PlanItem,
} from '@/lib/simpler/vidsPlan';
import {
  captionAt, captionStyle, drawCaption, preloadCaptionEmoji, DEFAULT_CAPTION_STYLE, type Caption, type CaptionStyle,
} from '@/lib/simpler/vidsCaptions';
import { drawVeil, type Veil } from '@/lib/simpler/vidsVeil';
import {
  DEFAULT_BOOM_LEVEL, DEFAULT_CLIP_LEVEL, DEFAULT_MUSIC, DEFAULT_ROOM_TONE, MUSIC_FADE, ROOM_TONE_URL,
  boomGain, clampClipLevel, decodeAudio, musicGain, roomToneGain, scheduleLoop, scheduleOnce,
  stretchToRate, type Music, type RoomTone,
} from '@/lib/simpler/vidsAudio';

export interface ComposeOptions {
  width: number;
  height: number;
  /** The file's frame rate. Left out, it follows the fastest clip in the
   *  build (24–60); the builder pins it, since a phone wants no more than 30. */
  fps?: number;
  plan: Plan;
  /** On-screen words, already timed against `plan`. Drawn over the composite
   *  with the same call the live preview uses, so the file matches the stage. */
  captions?: Caption[];
  /** Which of the four looks those captions are drawn in. */
  captionStyle?: CaptionStyle;
  /** The room under the whole export. Defaults to on — a build with nothing
   *  under it sounds like a file rather than a room. */
  roomTone?: RoomTone;
  /** The song under the whole export, if the build chose one. Laid the same way
   *  the room is: one pass from its beginning, looped if the build outlasts it. */
  music?: Music;
  /** How loud the clips sit against it. 1 is as recorded. */
  clipLevel?: number;
  /** How loud the BOOMs land. Their own level — see boomGain. */
  boomLevel?: number;
  /** The faint tint and grain over every frame, last of all — the same call
   *  the stage makes (lib/simpler/vidsVeil). Left out, none. */
  veil?: Veil | null;
  onProgress?: (frac: number, label: string) => void;
  signal?: AbortSignal;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Part {
  item: PlanItem;
  /** Null for a still — there is no container to read, decode or close. */
  input: MB.Input | null;
  first: number;   // first output frame this slot is on screen
  last: number;    // exclusive
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Null for a still: nothing advances, so there is nothing to pull from. */
  gen: AsyncGenerator<MB.VideoSample | null, void, unknown> | null;
  hasFrame: boolean;
  /** The decoded frame on screen, held as it came off the decoder and drawn
   *  straight into the composite — for a clip filed the right way up. One
   *  that carries a rotation goes through `canvas` instead, where drawWithFit
   *  turns it; the composite's own draw would not. Closed when the next
   *  frame replaces it or the window ends. */
  frame: MB.VideoSample | null;
  /** The next frame, asked for before the encoder is waited on for this one,
   *  so the decoder works while the encoder does — see the frame loop. */
  ahead: Promise<IteratorResult<MB.VideoSample | null, void>> | null;
}

/** Let a canvas's bitmap go now rather than when the collector gets to it.
 *  An export makes several the size of a clip and one the size of the frame;
 *  a page that keeps rendering holds them all until collection, and a browser
 *  short of canvas memory answers by drawing the next ones in software. */
const freeCanvas = (c: HTMLCanvasElement) => { c.width = 0; c.height = 0; };

/** A photo, decoded once. It goes into the frame loop as a part that never
 *  advances: every output frame in its window samples the same picture, which
 *  is what a freeze frame is here — see PHOTO_LENGTH in vidsPlan. */
function loadStill(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = withBase(url);
  });
}

export async function composeSequence(opts: ComposeOptions): Promise<Blob> {
  const {
    Input, UrlSource, BlobSource, ALL_FORMATS, VideoSampleSink, AudioSampleSink,
    Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource,
    canEncodeVideo, canEncodeAudio,
  } = await import('mediabunny');

  const { width, height, plan, signal } = opts;
  const captions = opts.captions ?? [];
  const capStyle = opts.captionStyle ?? captionStyle(DEFAULT_CAPTION_STYLE);
  const report = opts.onProgress ?? (() => {});
  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  };

  if (!plan.items.length || plan.total <= 0) throw new Error('Nothing to render — fill at least one slot.');
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('This browser has no WebCodecs support — export from Chrome or Edge.');
  }
  if (!(await canEncodeVideo('avc', { width, height }))) {
    throw new Error(`This browser can't encode H.264 at ${width}×${height}.`);
  }

  const parts: Part[] = [];
  const inputs: MB.Input[] = [];
  /** Every canvas made here, freed on the way out — see freeCanvas. */
  const canvases: HTMLCanvasElement[] = [];

  try {
    report(0, 'Opening clips…');
    // Open and measure everything first, because the footage has a say in how
    // the file is written: one written at a fixed bitrate throws away detail
    // the sources were carrying, and — when the caller leaves the rate open —
    // a build of 60fps clips laid onto a fixed 30 throws half the motion away.
    const opened: { item: PlanItem; input: MB.Input; track: MB.InputVideoTrack }[] = [];
    // Stills are opened separately below: they carry none of the figures the
    // file is written from, and there is nothing to decode over time.
    const stills = plan.items.filter((i) => isPhoto(i.video));
    let srcFps = 0;
    let srcBpp = 0;
    for (const item of plan.items) {
      if (isPhoto(item.video)) continue;
      // A BOOM laid for its noise alone has no picture to decode — it is on the
      // timeline to carry the bang, which is scheduled off plan.items below
      // rather than off what got opened here. See BoomInsert.picture.
      if (item.picture === false) continue;
      // A clip that lives in this tab (the Bottom card's recording) is read
      // from its bytes. A library clip's bytes come off this machine once they
      // have been fetched once (lib/vids-clip-cache) — the same bytes the
      // bucket would serve, so the same file comes out — and only a clip the
      // cache can't take is fetched from the bucket in ranges.
      const url = withBase(item.video.url);
      const local = localClipBlob(item.video)
        ?? (isCacheableClipUrl(url) ? await cachedClipBlob(url).catch(() => null) : null);
      const input = new Input({
        source: local ? new BlobSource(local) : new UrlSource(url),
        formats: ALL_FORMATS,
      });
      inputs.push(input);
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error(`${item.video.name}: no video track.`);
      if (!(await track.canDecode())) {
        throw new Error(`${item.video.name}: this browser can't decode its codec (${track.codec ?? 'unknown'}).`);
      }
      const stats = await track.computePacketStats(240).catch(() => null);
      const rate = stats?.averagePacketRate ?? 0;
      if (Number.isFinite(rate) && rate > srcFps) srcFps = rate;
      // Per pixel per frame, so a 4K clip's generous bitrate isn't read as a
      // demand on a 1080 output — it is the density that carries across.
      const area = Math.max(1, track.displayWidth * track.displayHeight);
      const bits = stats?.averageBitrate ?? 0;
      if (Number.isFinite(bits) && rate > 0) srcBpp = Math.max(srcBpp, bits / (area * rate));
      opened.push({ item, input, track });
    }

    // Round to whole frames and stay inside what a phone will happily play.
    const fps = opts.fps ?? (srcFps > 0 ? clamp(Math.round(srcFps), 24, 60) : 30);
    const frameCount = Math.max(1, Math.round(plan.total * fps));
    /** The output frames [first, last) this slot is on screen for. */
    const onScreen = (item: PlanItem) => ({
      first: Math.max(0, Math.ceil(item.start * fps - 1e-6)),
      last: Math.min(frameCount, Math.ceil(item.end * fps - 1e-6)),
    });

    for (const item of stills) {
      const img = await loadStill(item.video.url).catch(() => {
        throw new Error(`${item.video.name}: this photo couldn't be loaded.`);
      });
      const canvas = document.createElement('canvas');
      canvases.push(canvas);
      canvas.width = Math.max(1, img.naturalWidth);
      canvas.height = Math.max(1, img.naturalHeight);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D unavailable');
      smoothScaling(ctx);
      ctx.drawImage(img, 0, 0);
      const { first, last } = onScreen(item);
      parts.push({ item, input: null, first, last, canvas, ctx, gen: null, hasFrame: true, frame: null, ahead: null });
    }

    for (const { item, input, track } of opened) {
      // Output frames [first, last) show this slot; each maps to a clip time
      // from the in point — `speed` clip seconds per timeline second — clamped
      // so a clip shorter than its window holds its last kept frame.
      const { first, last } = onScreen(item);
      const hold = Math.max(0, item.sourceLength - 0.001);
      // samplesAtTimestamps wants each run ascending, and a looping slot jumps
      // back to its in point every time it comes round — so the window is cut
      // into one run per pass and the sink is asked for them in turn. A slot
      // that holds its last frame is a single run, exactly as before.
      const runs: number[][] = [];
      let run: number[] = [];
      for (let f = first; f < last; f++) {
        const into = (f / fps - item.start) * item.speed;
        const ts = item.loop
          ? item.trimStart + (into % item.sourceLength)
          : item.trimStart + Math.min(into, hold);
        if (run.length && ts < run[run.length - 1]) { runs.push(run); run = []; }
        run.push(ts);
      }
      if (run.length) runs.push(run);
      // Decoded into a full-frame canvas of its own; the composite samples the
      // fitted region out of that. Keeping the last frame there is what makes
      // the hold-last-frame behaviour free.
      const canvas = document.createElement('canvas');
      canvases.push(canvas);
      canvas.width = track.displayWidth;
      canvas.height = track.displayHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D unavailable');
      smoothScaling(ctx);
      const sink = new VideoSampleSink(track);
      parts.push({
        item, input, first, last, canvas, ctx, hasFrame: false, frame: null, ahead: null,
        gen: (async function* () {
          for (const r of runs) yield* sink.samplesAtTimestamps(r.values());
        })(),
      });
    }

    // Back into plan order: stills were opened first, and the frame loop paints
    // the parts in the order it holds them.
    parts.sort((a, b) => plan.items.indexOf(a.item) - plan.items.indexOf(b.item));

    // ── Audio ──────────────────────────────────────────────────────────────
    // Three layers on one offline mix, built before output.start() because
    // tracks must be registered first: whatever the un-muted slots are carrying
    // (which is only ever the keyboard — see SlotPick.muted), room tone, and the
    // song. The last two run the length of the timeline rather than being laid
    // per clip; that is the point of both, and it is what stops the joins
    // between clips reading as joins.
    const room = opts.roomTone ?? DEFAULT_ROOM_TONE;
    const roomGain = roomToneGain(room);
    const wantRoom = room.on && roomGain > 0 && plan.total > 0;
    const music = opts.music ?? DEFAULT_MUSIC;
    const musicLevel = musicGain(music);
    const wantMusic = !!music.url && musicLevel > 0 && plan.total > 0;
    const clipGain = clampClipLevel(opts.clipLevel ?? DEFAULT_CLIP_LEVEL);
    let mixed: AudioBuffer | null = null;
    // A still has no sound to be un-muted, so it is never part of the mix.
    const audible = clipGain > 0 ? parts.filter((p) => p.input && !p.item.muted) : [];
    const wantBangs = plan.items.some((i) => isBoomItem(i) && i.sound)
      && boomGain(opts.boomLevel ?? DEFAULT_BOOM_LEVEL) > 0;
    const wantAudio = (audible.length > 0 || wantRoom || wantMusic || wantBangs)
      && typeof OfflineAudioContext !== 'undefined' && (await canEncodeAudio('aac'));

    if (wantAudio) {
      const SR = 48_000;
      const octx = new OfflineAudioContext(2, Math.max(1, Math.ceil(plan.total * SR)), SR);
      let scheduled = 0;

      if (audible.length) report(0.02, 'Mixing audio…');
      for (const p of audible) {
        if (!p.input) continue;
        const at = await p.input.getPrimaryAudioTrack();
        if (!at || !(await at.canDecode())) continue;
        // `span` is timeline seconds; the source range that fills it is that
        // much longer when sped up, and the node plays it back at the same rate.
        const span = p.item.end - p.item.start;
        const rate = p.item.speed;
        // A looping slot fetches one pass of its sound; the pass is then laid
        // down again at every join, so what you hear comes round with what you
        // see instead of running out under a picture that keeps going.
        const sourceSpan = p.item.loop ? Math.min(p.item.sourceLength, span * rate) : span * rate;
        const inPoint = p.item.trimStart;
        const pieces: AudioBuffer[] = [];
        let firstTs: number | null = null;
        for await (const s of new AudioSampleSink(at).samples(inPoint, inPoint + sourceSpan)) {
          throwIfAborted();
          if (firstTs === null) firstTs = s.timestamp;
          pieces.push(s.toAudioBuffer());
          s.close();
        }
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
        const g = octx.createGain();
        g.gain.value = clipGain;
        g.connect(octx.destination);
        // `lead` > 0: the audio starts a little after the in point; < 0: the first
        // sample straddles it, so skip into the buffer instead. It is measured in
        // clip seconds, so dividing by the rate turns it into timeline seconds.
        // start()'s offset and duration stay in buffer seconds.
        const lead = (firstTs ?? inPoint) - inPoint;
        // One source per pass, at the same joins the picture goes round on. The
        // mix is only as long as the timeline, so the last pass is cut off there.
        const passSpan = sourceSpan / rate;
        const passes = p.item.loop && passSpan > 0 ? Math.ceil(span / passSpan) : 1;
        // Speed is baked into the buffer rather than played as a rate, so it
        // never moves the pitch. What comes back already runs at timeline
        // speed, which is why offset and duration are divided by the rate here
        // and the node itself is left alone.
        const play = stretchToRate(octx, buf, rate);
        for (let i = 0; i < passes; i++) {
          const src = octx.createBufferSource();
          src.buffer = play;
          src.connect(g);
          src.start(p.item.start + i * passSpan + Math.max(0, lead) / rate, Math.max(0, -lead) / rate, sourceSpan / rate);
        }
        scheduled++;
      }

      if (wantRoom) {
        report(0.03, 'Laying in the room…');
        const sample = await decodeAudio(octx, ROOM_TONE_URL);
        throwIfAborted();
        scheduleLoop(octx, sample, { start: 0, end: plan.total }, roomGain);
        scheduled++;
      }

      if (wantMusic && music.url) {
        report(0.04, 'Laying in the music…');
        // From the top, and fading rather than switching on and being cut off.
        // A track shorter than the build comes round again; the fade is long
        // enough that the seam reads as the song rather than as a join.
        const sample = await decodeAudio(octx, music.url);
        throwIfAborted();
        scheduleLoop(octx, sample, { start: 0, end: plan.total }, musicLevel, { from: 0, fade: MUSIC_FADE });
        scheduled++;
      }

      // The BOOMs. One hit each, at the moment its picture starts, at the
      // sound’s own speed: the picture is sped up to land in BOOM_LENGTH and
      // the bang is not, so an effect is heard the length it was made. Cut at
      // the last frame rather than allowed to ring past it, since nothing is
      // left to hear it over. Decoded once per sound however many BOOMs share
      // it — loadAudioBytes caches the fetch, and the buffers are cheap.
      const boomLevel = boomGain(opts.boomLevel ?? DEFAULT_BOOM_LEVEL);
      const bangs = boomLevel > 0
        ? plan.items.filter((i) => isBoomItem(i) && i.sound)
        : [];
      if (bangs.length) {
        report(0.045, 'Laying in the BOOMs…');
        const samples = new Map<string, AudioBuffer>();
        for (const item of bangs) {
          const url = item.sound!.url;
          throwIfAborted();
          let sample = samples.get(url);
          if (!sample) {
            // A sound that will not load must not take the whole export with
            // it: the BOOM is still on the picture either way.
            sample = await decodeAudio(octx, url).catch(() => undefined);
            if (!sample) continue;
            samples.set(url, sample);
          }
          scheduleOnce(octx, sample, item.start, boomLevel, plan.total);
          scheduled++;
        }
      }

      if (scheduled) mixed = await octx.startRendering();
    }

    // ── Video ────────────────────────────────────────────────────────────────
    const canvas = document.createElement('canvas');
    canvases.push(canvas);
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
      // The densest source, read at the output's own size, so a build made of
      // generously encoded footage is written generously rather than squeezed
      // down to a floor that was only ever meant to be a floor.
      bitrate: videoBitrate(width, height, fps, srcBpp * width * height * fps),
    });
    output.addVideoTrack(videoSource, { frameRate: fps });
    let audioSource: MB.AudioBufferSource | null = null;
    if (mixed) {
      audioSource = new AudioBufferSource({ codec: 'aac', bitrate: 192_000 });
      output.addAudioTrack(audioSource);
    }

    // Every emoji in the captions is painted from its Apple image; fetched now
    // so no frame goes out with the OS glyph in its place.
    await preloadCaptionEmoji(captions);

    // ── The overlays, painted once ──────────────────────────────────────────
    // The words and the veil go on through the same calls the stage makes,
    // but not onto every frame: each is painted into a transparent layer the
    // size of the frame — the caption again whenever the caption changes, the
    // veil once — and the layer is stamped over the picture. Everything either
    // call does is source-over, so a stamped layer is the same picture as
    // drawing straight onto the frame. What it is not is the same cost: a
    // caption carries a blurred shadow, and that blur on the output canvas,
    // with the veil's pattern fill laid after it, stalled the canvas pipeline
    // on every frame. Measured on a 26-second build (782 frames) in Chrome on
    // a desktop with a hardware encoder: the frame loop ran 85s with both
    // drawn live and 25s with both stamped (2026-10-01).
    const layer = () => {
      const c = document.createElement('canvas');
      canvases.push(c);
      c.width = width;
      c.height = height;
      const lctx = c.getContext('2d');
      if (!lctx) throw new Error('Canvas 2D unavailable');
      return { canvas: c, ctx: lctx };
    };
    const veilLayer = opts.veil ? layer() : null;
    if (veilLayer) drawVeil(veilLayer.ctx, width, height, opts.veil ?? null);
    const capLayer = captions.length ? layer() : null;
    let capShown: Caption | null = null;
    const captionLayer = (cap: Caption): HTMLCanvasElement | null => {
      if (!capLayer) return null;
      if (cap !== capShown) {
        capLayer.ctx.clearRect(0, 0, width, height);
        drawCaption(capLayer.ctx, cap, width, height, capStyle, plan.bars);
        capShown = cap;
      }
      return capLayer.canvas;
    };

    await output.start();
    try {
      const wants = (p: Part, f: number) => !!p.gen && f >= p.first && f < p.last;
      for (let f = 0; f < frameCount; f++) {
        throwIfAborted();
        for (const p of parts) {
          if (!wants(p, f)) {
            // Off screen now: the frame it was holding is done with.
            if (p.frame && f >= p.last) { p.frame.close(); p.frame = null; }
            continue;
          }
          // samplesAtTimestamps clones when one decoded frame serves several
          // output frames, so every yielded sample is ours to close.
          const { value: sample } = await (p.ahead ?? p.gen!.next());
          p.ahead = null;
          if (sample) {
            if (sample.rotation === 0) {
              // Kept as decoded and drawn from directly — no copy through the
              // part's canvas. A window holding its last frame keeps this one.
              p.frame?.close();
              p.frame = sample;
            } else {
              // Wiped before the frame goes on: drawWithFit composites rather
              // than replaces, so a clip with nothing behind its picture (the
              // BOOM) would drag every frame it had already shown along with
              // it. Only when there is a new frame — a window holding its
              // last one has nothing to redraw, and that hold is what keeps
              // it free.
              p.ctx.clearRect(0, 0, p.canvas.width, p.canvas.height);
              sample.drawWithFit(p.ctx, { fit: 'fill' });
              sample.close();
            }
            p.hasFrame = true;
          }
        }
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        const paint = (p: Part) => {
          if (f < p.first || f >= p.last || !p.hasFrame) return;
          if (p.frame) {
            drawPlanItem(ctx, p.frame.toCanvasImageSource(), p.frame.displayWidth, p.frame.displayHeight, p.item, width, height, plan.bars);
          } else {
            drawPlanItem(ctx, p.canvas, p.canvas.width, p.canvas.height, p.item, width, height, plan.bars);
          }
        };
        for (const p of parts) if (!isBoomItem(p.item)) paint(p);
        const cap = captionAt(captions, f / fps);
        const words = cap ? captionLayer(cap) : null;
        if (words) ctx.drawImage(words, 0, 0);
        // Over the words as well as the pictures — see isBoomItem.
        for (const p of parts) if (isBoomItem(p.item)) paint(p);
        // And the veil over the lot, as the stage lays it.
        if (veilLayer) ctx.drawImage(veilLayer.canvas, 0, 0);
        // The next frame's decoding is set going before this frame's encoding
        // is waited on, so the two overlap rather than take turns. The
        // generator is never asked twice at once: what is asked for here is
        // taken, above, before anything else is.
        for (const p of parts) if (wants(p, f + 1)) p.ahead = p.gen!.next();
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
    // A frame asked for ahead and never taken, and the one each part was
    // holding, are closed; then any decoder pumps still running (e.g. after a
    // cancel) are stopped, the inputs' file handles / caches freed, and every
    // canvas let go.
    for (const p of parts) {
      if (p.ahead) await p.ahead.then((r) => r.value?.close(), () => { /* already failed */ });
      p.ahead = null;
      p.frame?.close();
      p.frame = null;
    }
    await Promise.allSettled(parts.map((p) => p.gen?.return()));
    for (const input of inputs) input.dispose();
    for (const c of canvases) freeCanvas(c);
  }
}
