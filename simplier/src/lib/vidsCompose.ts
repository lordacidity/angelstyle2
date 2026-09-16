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
import { localClipBlob } from '@/lib/vidsLocal';
import {
  drawPlanItem, isBoomItem, smoothScaling, videoBitrate,
  type Plan, type PlanItem,
} from '@/lib/vidsPlan';
import {
  captionAt, captionStyle, drawCaption, preloadCaptionEmoji, DEFAULT_CAPTION_STYLE, type Caption, type CaptionStyle,
} from '@/lib/vidsCaptions';
import {
  DEFAULT_BOOM_LEVEL, DEFAULT_CLIP_LEVEL, DEFAULT_MUSIC, DEFAULT_ROOM_TONE, MUSIC_FADE, ROOM_TONE_URL,
  boomGain, clampClipLevel, decodeAudio, musicGain, roomToneGain, scheduleLoop, scheduleOnce,
  stretchToRate, type Music, type RoomTone,
} from '@/lib/vidsAudio';

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
}

/** A photo, decoded once. It goes into the frame loop as a part that never
 *  advances: every output frame in its window samples the same picture, which
 *  is what a freeze frame is here — see PHOTO_LENGTH in vidsPlan. */
function loadStill(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = url;
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
      // A clip that lives in this tab (the Bottom card's recording) is read
      // from its bytes; everything else is fetched from the bucket in ranges.
      const local = localClipBlob(item.video);
      const input = new Input({
        source: local ? new BlobSource(local) : new UrlSource(item.video.url),
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
      canvas.width = Math.max(1, img.naturalWidth);
      canvas.height = Math.max(1, img.naturalHeight);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D unavailable');
      smoothScaling(ctx);
      ctx.drawImage(img, 0, 0);
      const { first, last } = onScreen(item);
      parts.push({ item, input: null, first, last, canvas, ctx, gen: null, hasFrame: true });
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
      canvas.width = track.displayWidth;
      canvas.height = track.displayHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D unavailable');
      smoothScaling(ctx);
      const sink = new VideoSampleSink(track);
      parts.push({
        item, input, first, last, canvas, ctx, hasFrame: false,
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
    await output.start();
    try {
      for (let f = 0; f < frameCount; f++) {
        throwIfAborted();
        for (const p of parts) {
          if (!p.gen || f < p.first || f >= p.last) continue;
          // samplesAtTimestamps clones when one decoded frame serves several
          // output frames, so every yielded sample is ours to close.
          const { value: sample } = await p.gen.next();
          if (sample) {
            // Wiped before the frame goes on: drawWithFit composites rather
            // than replaces, so a clip with nothing behind its picture (the
            // BOOM) would drag every frame it had already shown along with it.
            // Only when there is a new frame — a window holding its last one
            // has nothing to redraw, and that hold is what keeps it free.
            p.ctx.clearRect(0, 0, p.canvas.width, p.canvas.height);
            sample.drawWithFit(p.ctx, { fit: 'fill' });
            sample.close();
            p.hasFrame = true;
          }
        }
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        const paint = (p: Part) => {
          if (f < p.first || f >= p.last || !p.hasFrame) return;
          drawPlanItem(ctx, p.canvas, p.canvas.width, p.canvas.height, p.item, width, height, plan.bars);
        };
        for (const p of parts) if (!isBoomItem(p.item)) paint(p);
        const cap = captionAt(captions, f / fps);
        if (cap) drawCaption(ctx, cap, width, height, capStyle, plan.bars);
        // Over the words as well as the pictures — see isBoomItem.
        for (const p of parts) if (isBoomItem(p.item)) paint(p);
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
    // Stop any decoder pumps still running (e.g. after a cancel), then free the
    // inputs' file handles / caches.
    await Promise.allSettled(parts.map((p) => p.gen?.return()));
    for (const input of inputs) input.dispose();
  }
}
