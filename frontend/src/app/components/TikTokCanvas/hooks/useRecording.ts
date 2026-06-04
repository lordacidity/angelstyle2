'use client';

import { useState, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';

// @ts-ignore
import MP4Box from 'mp4box';

import {
  CANVAS_W, CANVAS_H, BASE_HEADER_HEIGHT, CAPTION_TOP_PADDING, CAPTION_LINE_HEIGHT,
  HEADER_PADDING_X,
} from '../constants';
import { drawHeaderOnContext } from '../drawing/drawHeader';
import { drawMarketRow } from '../drawing/drawMarketRow';
import { countCaptionLines, countSonotradeCaptionLines, CAPTION_EMOJI_SIZE } from '../drawing/countCaptionLines';
import { wrapRichText, drawRichLine, preloadEmojiImages } from '@/lib/emoji';
import type { Box, MarketData } from '../types';

export interface UseRecordingConfig {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  brand: string;
  rowNumber: number;
  videoId?: string;
  boxRef: MutableRefObject<Box>;
  videoOffsetRef: MutableRefObject<{ x: number; y: number }>;
  videoScaleRef: MutableRefObject<number>;
  trimStartRef: MutableRefObject<number>;
  trimEndRef: MutableRefObject<number>;
  includeEditRef: MutableRefObject<boolean>;
  logoImgRef: MutableRefObject<HTMLImageElement | null>;
  verifiedImgRef: MutableRefObject<HTMLImageElement | null>;
  overlayCaption: string;
  overlayLogoSrc: string;
  overlayDisplayName: string;
  overlayHandle: string;
  overlayVerified: boolean;
  marketData?: MarketData | null;
  marketAvatarImgRef?: MutableRefObject<HTMLImageElement | null>;
  marketAvatarUrlRef?: MutableRefObject<string | null>;
}

export function useRecording(config: UseRecordingConfig) {
  const [isRecording, setIsRecording] = useState(false);
  const [recProgress, setRecProgress] = useState(0);
  const [recStatus, setRecStatus] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);

  async function startRecording(): Promise<void> {
    const {
      canvasRef, videoRef, brand, rowNumber, videoId,
      boxRef, videoOffsetRef, videoScaleRef,
      trimStartRef, trimEndRef, includeEditRef,
      logoImgRef, verifiedImgRef,
      overlayCaption, overlayLogoSrc, overlayDisplayName, overlayHandle, overlayVerified,
      marketData, marketAvatarImgRef, marketAvatarUrlRef,
    } = config;

    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || isRecording) throw new Error('Cannot start recording');

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const signal = abortController.signal;

    setIsRecording(true);
    setRecProgress(0);
    setRecStatus('Initializing...');

    // Ensure Apple emoji images are decoded before any frame is drawn, so a
    // caption with emoji never exports with a missing/native glyph.
    if (overlayCaption) await preloadEmojiImages();

    const isClean = brand === 'clean';

    try {
      const mediabunny = await import('mediabunny');
      const {
        Output, Mp4OutputFormat, BufferTarget, VideoSample, VideoSampleSource,
        EncodedAudioPacketSource, EncodedVideoPacketSource, EncodedPacketSink, EncodedPacket,
        Input, BlobSource, ALL_FORMATS, QUALITY_HIGH,
      } = mediabunny;

      const EXPORT_FPS = 30;
      const EXPORT_FRAME_DURATION = 1 / EXPORT_FPS;

      const headerDrawOpts = {
        overlayCaption, overlayLogoSrc, overlayDisplayName, overlayHandle, overlayVerified,
        logoImgRef, verifiedImgRef,
      };

      async function mergeWithEdit(mainBuffer: ArrayBuffer, mainDuration: number): Promise<ArrayBuffer> {
        setRecStatus('Appending edit clip...');

        const editResp = await fetch('/edit.mp4');
        if (!editResp.ok) throw new Error(`Failed to fetch edit.mp4: ${editResp.status}`);
        const editArrayBuffer = await editResp.arrayBuffer();

        const mkMain = () => new Input({ source: new BlobSource(new Blob([mainBuffer], { type: 'video/mp4' })), formats: ALL_FORMATS });
        const mkEdit = () => new Input({ source: new BlobSource(new Blob([editArrayBuffer], { type: 'video/mp4' })), formats: ALL_FORMATS });

        const mainVideoTrack = await mkMain().getPrimaryVideoTrack();
        const editVideoTrack = await mkEdit().getPrimaryVideoTrack();
        if (!mainVideoTrack || !editVideoTrack) throw new Error('Missing video track for merge');

        const mainVideoConfig = await mainVideoTrack.getDecoderConfig();
        const editVideoConfig = await editVideoTrack.getDecoderConfig();

        const mainVPackets: any[] = [];
        for await (const p of new EncodedPacketSink(mainVideoTrack).packets()) mainVPackets.push(p);
        const editVPackets: any[] = [];
        for await (const p of new EncodedPacketSink(editVideoTrack).packets()) editVPackets.push(p);
        if (editVPackets.length > 0) {
          const firstTs = editVPackets[0].timestamp;
          for (const p of editVPackets) p.timestamp = p.timestamp - firstTs + mainDuration;
        }

        const MERGED_SR = 44100;
        const AFRAME = 1024;
        const allAudioPackets: any[] = [];
        let sharedAudioConfig: any = null;
        setRecStatus('Mixing audio...');
        try {
          if (typeof AudioEncoder === 'undefined' || typeof OfflineAudioContext === 'undefined')
            throw new Error('Web Audio API not supported');

          const tempCtx = new AudioContext({ sampleRate: MERGED_SR });
          let mainAudioBuffer: AudioBuffer;
          try { mainAudioBuffer = await tempCtx.decodeAudioData(mainBuffer.slice(0)); }
          catch { mainAudioBuffer = tempCtx.createBuffer(2, Math.ceil(mainDuration * MERGED_SR), MERGED_SR); }
          const editAudioBuffer = await tempCtx.decodeAudioData(editArrayBuffer.slice(0));
          await tempCtx.close();

          const totalSamples = Math.ceil((mainDuration + editAudioBuffer.duration) * MERGED_SR);
          const mixCh = 2;
          const offCtx = new OfflineAudioContext(mixCh, totalSamples, MERGED_SR);
          const ms = offCtx.createBufferSource(); ms.buffer = mainAudioBuffer; ms.connect(offCtx.destination); ms.start(0);
          const es = offCtx.createBufferSource(); es.buffer = editAudioBuffer; es.connect(offCtx.destination); es.start(mainDuration);
          const mixed = await offCtx.startRendering();

          const mixLen = mixed.length;
          const chunks: EncodedAudioChunk[] = [];
          let encCfg: AudioDecoderConfig | null = null;
          let encErr: Error | null = null;
          const enc = new AudioEncoder({
            output: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => {
              chunks.push(chunk);
              if (meta?.decoderConfig && !encCfg) encCfg = meta.decoderConfig;
            },
            error: (e: Error) => { encErr = e; },
          });
          enc.configure({ codec: 'mp4a.40.2', sampleRate: MERGED_SR, numberOfChannels: mixCh, bitrate: 128_000 });

          const chData = Array.from({ length: mixCh }, (_, c) => mixed.getChannelData(c));
          let tMicros = 0;
          for (let offset = 0; offset < mixLen; offset += AFRAME) {
            const fc = Math.min(AFRAME, mixLen - offset);
            const planar = new Float32Array(fc * mixCh);
            for (let c = 0; c < mixCh; c++) {
              const src = chData[c];
              for (let i = 0; i < fc; i++) planar[c * fc + i] = src[offset + i] ?? 0;
            }
            const ad = new AudioData({ format: 'f32-planar', sampleRate: MERGED_SR, numberOfFrames: fc, numberOfChannels: mixCh, timestamp: tMicros, data: planar });
            enc.encode(ad);
            ad.close();
            tMicros += Math.round((fc / MERGED_SR) * 1_000_000);
          }
          await enc.flush();
          enc.close();
          if (encErr) throw encErr;

          if (chunks.length > 0) {
            if (!encCfg) {
              const sfIdx = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350].indexOf(MERGED_SR);
              const si = sfIdx >= 0 ? sfIdx : 4;
              encCfg = { codec: 'mp4a.40.2', sampleRate: MERGED_SR, numberOfChannels: mixCh, description: new Uint8Array([(2 << 3) | (si >> 1), ((si & 1) << 7) | (mixCh << 3)]) };
            }
            sharedAudioConfig = encCfg;
            for (const chunk of chunks) allAudioPackets.push(EncodedPacket.fromEncodedChunk(chunk));
          }
        } catch (audioErr) {
          console.error('[mergeWithEdit] audio mix/encode failed:', audioErr);
        }

        const mergeOut = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
        const mergeVSrc = new EncodedVideoPacketSource('avc');
        mergeOut.addVideoTrack(mergeVSrc);
        let mergeASrc: any = null;
        if (allAudioPackets.length > 0) {
          mergeASrc = new EncodedAudioPacketSource('aac');
          mergeOut.addAudioTrack(mergeASrc);
        }
        await mergeOut.start();
        for (let i = 0; i < mainVPackets.length; i++) await mergeVSrc.add(mainVPackets[i], i === 0 && mainVideoConfig ? { decoderConfig: mainVideoConfig } : undefined);
        for (let i = 0; i < editVPackets.length; i++) await mergeVSrc.add(editVPackets[i], i === 0 && editVideoConfig ? { decoderConfig: editVideoConfig } : undefined);
        if (mergeASrc) {
          for (let i = 0; i < allAudioPackets.length; i++) await mergeASrc.add(allAudioPackets[i], i === 0 ? { decoderConfig: sharedAudioConfig } : undefined);
        }
        setRecStatus('Finalizing merged video...');
        await mergeOut.finalize();
        const merged = mergeOut.target.buffer;
        if (!merged) throw new Error('No buffer from merge output');
        return merged;
      }

      // ── Fetch + demux source video ────────────────────────────────────────────
      const videoSrcUrl = video.src || video.currentSrc;
      const videoUrl = videoSrcUrl.includes('/api/proxy')
        ? videoSrcUrl
        : `/api/proxy?url=${encodeURIComponent(videoSrcUrl)}&stream=1`;

      console.log('[EXPORT] === Starting export ===');
      console.log('[EXPORT] video.src:', videoSrcUrl);
      console.log('[EXPORT] fetching via:', videoUrl);

      setRecStatus('Downloading video file...');
      let arrayBuffer: ArrayBuffer;
      try {
        const response = await fetch(videoUrl);
        console.log('[EXPORT] response status:', response.status, 'content-type:', response.headers.get('content-type'), 'content-length:', response.headers.get('content-length'));
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        arrayBuffer = await response.arrayBuffer();
        console.log('[EXPORT] downloaded bytes:', arrayBuffer.byteLength);
      } catch (fetchError) {
        console.error('[EXPORT] ❌ Download failed:', fetchError);
        throw new Error(`Failed to download video: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}`);
      }

      setRecStatus('Parsing video file...');
      console.log('[EXPORT] parsing with MP4Box...');

      // @ts-ignore
      const MP4BoxFile = MP4Box.createFile();
      let videoSamples: Array<{ data: Uint8Array; timestamp: number; duration: number; isKeyframe: boolean }> = [];
      let audioSamples: Array<{ data: Uint8Array; timestamp: number; duration: number }> = [];
      let videoTrackId: number | null = null;
      let audioTrackId: number | null = null;
      let videoTimescale = 90000;
      let audioTimescale = 44100;

      MP4BoxFile.onReady = (info: any) => {
        console.log('[EXPORT] MP4Box onReady, tracks:', info.tracks?.map((t: any) => ({ id: t.id, type: t.type, codec: t.codec, timescale: t.timescale, duration: t.duration, w: t.video?.width, h: t.video?.height })));
        for (const track of info.tracks || []) {
          if (track.type === 'video' && !videoTrackId) { videoTrackId = track.id; videoTimescale = track.timescale || 90000; }
          if (track.type === 'audio' && !audioTrackId) { audioTrackId = track.id; audioTimescale = track.timescale || 44100; }
        }
        console.log('[EXPORT] selected videoTrackId:', videoTrackId, 'audioTrackId:', audioTrackId);
        if (videoTrackId) MP4BoxFile.setExtractionOptions(videoTrackId, null, { nbSamples: Infinity });
        if (audioTrackId) MP4BoxFile.setExtractionOptions(audioTrackId, null, { nbSamples: Infinity });
        MP4BoxFile.start();
      };

      MP4BoxFile.onSamples = (id: number, _user: any, samples: any[]) => {
        if (id === videoTrackId) {
          for (const s of samples) videoSamples.push({ data: new Uint8Array(s.data), timestamp: s.cts / videoTimescale, duration: s.duration / videoTimescale, isKeyframe: s.is_sync });
        }
        if (id === audioTrackId) {
          for (const s of samples) audioSamples.push({ data: new Uint8Array(s.data), timestamp: s.cts / audioTimescale, duration: s.duration / audioTimescale });
        }
      };

      // @ts-ignore
      MP4BoxFile.onError = (e: any) => console.error('[EXPORT] ❌ MP4Box error:', e);

      const copy = arrayBuffer.slice(0);
      // @ts-ignore
      copy.fileStart = 0;
      // @ts-ignore
      MP4BoxFile.appendBuffer(copy);
      // @ts-ignore
      MP4BoxFile.flush();

      await new Promise<void>((resolve, reject) => {
        const t = Date.now();
        const id = setInterval(() => {
          if (videoSamples.length > 0) { clearInterval(id); resolve(); }
          else if (Date.now() - t > 10000) { clearInterval(id); reject(new Error('Timeout extracting video samples')); }
        }, 100);
      });

      console.log('[EXPORT] extracted samples — video:', videoSamples.length, 'audio:', audioSamples.length);
      console.log('[EXPORT] videoTimescale:', videoTimescale, 'audioTimescale:', audioTimescale);
      if (videoSamples.length === 0) throw new Error('No video samples found');

      const lastSample = videoSamples[videoSamples.length - 1];
      const fullDuration = lastSample.timestamp + lastSample.duration;
      const clipStart = trimStartRef.current;
      const clipEnd = trimEndRef.current > 0 && trimEndRef.current <= fullDuration ? trimEndRef.current : fullDuration;
      const clipDuration = Math.max(0.1, clipEnd - clipStart);
      const totalFrames = Math.floor(clipDuration * EXPORT_FPS);

      // Progress is reported from the decode + encode loops, which run once per
      // sample / frame — thousands of times for a long clip. Pushing every value
      // into React state floods it faster than it can render and trips React's
      // "Maximum update depth exceeded" guard. Publish only when the bar would
      // visibly move (≥1%), so the total number of state updates stays ~constant
      // (~70) regardless of clip length. Endpoints (0.95, 1) are set directly.
      let lastReportedProgress = 0;
      const reportProgress = (p: number) => {
        if (p - lastReportedProgress >= 0.01) {
          lastReportedProgress = p;
          setRecProgress(p);
        }
      };

      console.log('[EXPORT] fullDuration:', fullDuration, 'clipStart:', clipStart, 'clipEnd:', clipEnd, 'clipDuration:', clipDuration, 'totalFrames:', totalFrames);

      // ── Extract AVC decoder description from MP4Box ──────────────────────────
      let description: Uint8Array | undefined;
      // @ts-ignore
      if (typeof MP4BoxFile.getSampleDescription === 'function') {
        // @ts-ignore
        const descs = MP4BoxFile.getSampleDescription(videoTrackId);
        // @ts-ignore
        if (descs?.[0]) description = descs[0].avcC?.config || descs[0].avcC;
      }
      if (!description) {
        try {
          // @ts-ignore
          const stsd = MP4BoxFile.getTrackById(videoTrackId)?.mdia?.minf?.stbl?.stsd;
          const entry = stsd?.entries?.[0];
          if (entry?.avcC?.config?.length > 0) description = new Uint8Array(entry.avcC.config);
          else if (typeof entry?.avcC?.subarray === 'function') description = entry.avcC.subarray();
          else if (typeof entry?.avcC?.start !== 'undefined' && entry?.avcC?.size) description = new Uint8Array(arrayBuffer, entry.avcC.start + 8, entry.avcC.size - 8);
        } catch (descErr) { console.warn('[EXPORT] description extraction fallback failed:', descErr); }
      }
      const hexDesc = description ? Array.from(description.slice(0, Math.min(32, description.length))).map(b => b.toString(16).padStart(2, '0')).join(' ') : '<none>';
      console.log('[EXPORT] decoder config — codec: avc1.64001F, description length:', description?.byteLength ?? 0, 'first bytes:', hexDesc);
      if (!description) console.warn('[EXPORT] ⚠️ no AVC description extracted — decoder will likely fail');

      // ── Set up output container + audio BEFORE decoding so we can stream ─────
      setRecStatus('Preparing audio...');

      const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
      const videoSource = new VideoSampleSource({ codec: 'avc', bitrate: QUALITY_HIGH });
      output.addVideoTrack(videoSource);

      let audioSource: any = null;
      let audioPackets: any[] = [];
      let audioDecoderConfigForExport: any = null;

      if (audioSamples.length > 0) {
        try {
          const input = new Input({ source: new BlobSource(new Blob([arrayBuffer], { type: 'video/mp4' })), formats: ALL_FORMATS });
          const audioTrack = await input.getPrimaryAudioTrack();
          if (audioTrack) {
            audioDecoderConfigForExport = await audioTrack.getDecoderConfig();
            audioSource = new EncodedAudioPacketSource('aac');
            output.addAudioTrack(audioSource);
            const sink = new EncodedPacketSink(audioTrack);
            for await (const packet of sink.packets()) audioPackets.push(packet);
            const firstTs = audioPackets[0]?.timestamp || 0;
            for (const p of audioPackets) p.timestamp -= firstTs;
            audioPackets = audioPackets.filter((p: any) => p.timestamp >= clipStart && p.timestamp < clipEnd);
            if (audioPackets.length > 0) {
              const firstTrim = audioPackets[0].timestamp;
              for (const p of audioPackets) p.timestamp -= firstTrim;
            }
          }
        } catch (e) { console.error('[audio setup]', e); }
      }

      // Ensure logo is loaded with crossOrigin=anonymous — the preview canvas may have
      // cached it without CORS, which would taint the OffscreenCanvas and fail VideoSample.
      if (overlayLogoSrc && (!logoImgRef.current?.crossOrigin)) {
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => { logoImgRef.current = img; resolve(); };
          img.onerror = () => resolve();
          img.src = overlayLogoSrc;
        });
      }

      // Pre-load market avatar with CORS so it doesn't taint the OffscreenCanvas.
      if (marketData?.photo_url && marketAvatarImgRef) {
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => { marketAvatarImgRef.current = img; resolve(); };
          img.onerror = () => resolve();
          img.src = marketData.photo_url!;
        });
      }

      await output.start();

      // ── Streaming decode + render ────────────────────────────────────────────
      // The previous design queued ALL chunks then awaited flush(), which
      // deadlocks: the decoder's GPU frame pool fills up after a handful of
      // outputs, and frames never get closed until flush returns. Now we
      // consume + close frames as they arrive so the pool stays drained.
      setRecStatus('Encoding...');
      console.log('[EXPORT] === Streaming decode + render ===');

      const frameQueue: Array<{ frame: VideoFrame; ts: number }> = [];
      let decoderError: Error | null = null;
      let producerDone = false;
      // Set once the render loop exits (trimmed clip fully drawn). The producer
      // watches this so it can stop decoding the unneeded tail instead of
      // deadlocking on backpressure with no consumer left to drain the queue.
      let consumerDone = false;
      let outputCount = 0;
      let consumerWaiter: (() => void) | null = null;
      let producerWaiter: (() => void) | null = null;
      const wakeConsumer = () => { const r = consumerWaiter; consumerWaiter = null; r?.(); };
      const wakeProducer = () => { const r = producerWaiter; producerWaiter = null; r?.(); };

      const decoder = new VideoDecoder({
        output: (frame: VideoFrame) => {
          frameQueue.push({ frame, ts: frame.timestamp / 1_000_000 });
          outputCount++;
          if (outputCount === 1 || outputCount % 60 === 0) {
            console.log('[EXPORT] decoded #', outputCount, 'ts:', (frame.timestamp / 1_000_000).toFixed(3), 'queue:', frameQueue.length);
          }
          wakeConsumer();
        },
        error: (e: Error) => {
          decoderError = e;
          console.error('[EXPORT] ❌ VideoDecoder error:', e, 'name:', (e as any)?.name, 'message:', e?.message);
          wakeConsumer();
          wakeProducer();
        },
      });

      // @ts-ignore
      decoder.configure({ codec: 'avc1.64001F', codedWidth: 1080, codedHeight: 1920, description });

      // Cap how many decoded frames sit in memory before the producer waits.
      // Empirically Chromium's H.264 decoder needs ~4-8 frames in flight for
      // reorder buffer; 12 leaves headroom without blowing GPU memory.
      const MAX_BUFFERED = 12;

      const producer = (async () => {
        try {
          for (let i = 0; i < videoSamples.length; i++) {
            if (signal.aborted) throw new Error('Cancelled');
            if (decoderError) throw decoderError;
            // Consumer finished the trimmed clip — samples past clipEnd are
            // unneeded. Stop now; continuing would fill frameQueue to
            // MAX_BUFFERED and park on producerWaiter forever (no consumer left
            // to wake us). This is what made end-trimmed exports hang.
            if (consumerDone) return;
            while (frameQueue.length >= MAX_BUFFERED) {
              if (consumerDone) return;
              await new Promise<void>((r) => { producerWaiter = r; });
              if (signal.aborted) throw new Error('Cancelled');
              if (decoderError) throw decoderError;
            }
            const s = videoSamples[i];
            decoder.decode(new EncodedVideoChunk({
              type: s.isKeyframe ? 'key' : 'delta',
              timestamp: s.timestamp * 1_000_000,
              data: s.data,
            }));
            reportProgress(0.05 + (i / videoSamples.length) * 0.1);
          }
          console.log('[EXPORT] all samples submitted, flushing...');
          await decoder.flush();
          console.log('[EXPORT] flush done, total decoded:', outputCount);
        } finally {
          producerDone = true;
          wakeConsumer();
        }
      })();
      // Surface producer failure to the consumer loop.
      producer.catch((e) => {
        if (!decoderError) decoderError = e instanceof Error ? e : new Error(String(e));
        producerDone = true;
        wakeConsumer();
      });

      const offscreen = new OffscreenCanvas(CANVAS_W, CANVAS_H);
      const offCtx = offscreen.getContext('2d')!;
      let currentFrame: { frame: VideoFrame; ts: number } | null = null;

      // ── Pre-bake static overlays into a sprite ──────────────────────────────
      // Caption (clean) and header + market row (sonotrade) don't change frame
      // to frame — they depend on the cropBox, brand, and inputs that are all
      // frozen for the duration of the recording. Painting them once into a
      // transparent overlay canvas and drawImage()-ing that single sprite per
      // frame skips all the per-frame text shaping, emoji loads, avatar draws,
      // and sparkline geometry that used to run on every iteration.
      const overlaySprite = new OffscreenCanvas(CANVAS_W, CANVAS_H);
      const spriteCtx = overlaySprite.getContext('2d')!;
      const cropBoxFrozen = boxRef.current;
      if (isClean) {
        if (overlayCaption) {
          const CLEAN_EXPORT_FONT = `400 44px Chirp, "Twitter Chirp", -apple-system, BlinkMacSystemFont, sans-serif`;
          const CLEAN_EXPORT_EMOJI = 44;
          const padX = HEADER_PADDING_X + 43;
          const maxWidth = CANVAS_W - padX * 2;
          const captionLines = countCaptionLines(spriteCtx as any, overlayCaption, CLEAN_EXPORT_FONT, maxWidth, CLEAN_EXPORT_EMOJI);
          const CAPTION_BOTTOM_OFFSET = 18;
          const CLEAN_PAD_TOP = 44;
          const CLEAN_PAD_BOT = 40;
          const captionAreaH = CLEAN_PAD_TOP + (captionLines * CAPTION_LINE_HEIGHT) + CLEAN_PAD_BOT - CAPTION_BOTTOM_OFFSET;
          const captionAreaY = Math.max(0, cropBoxFrozen.y - captionAreaH + 4);

          spriteCtx.font = CLEAN_EXPORT_FONT;
          spriteCtx.fillStyle = '#000';
          let cy = captionAreaY + CLEAN_PAD_TOP + CAPTION_LINE_HEIGHT - 10;
          for (const line of wrapRichText(spriteCtx as any, overlayCaption, maxWidth, CLEAN_EXPORT_EMOJI)) {
            drawRichLine(spriteCtx as any, line, padX, cy, CLEAN_EXPORT_EMOJI);
            cy += CAPTION_LINE_HEIGHT;
          }
        }
      } else {
        const captionLines = overlayCaption ? countSonotradeCaptionLines(spriteCtx as any, overlayCaption) : 0;
        const headerHeight = overlayCaption
          ? BASE_HEADER_HEIGHT + CAPTION_TOP_PADDING + (captionLines * CAPTION_LINE_HEIGHT) - 18
          : BASE_HEADER_HEIGHT;
        const headerY = Math.max(0, cropBoxFrozen.y - headerHeight + 4);
        // @ts-ignore
        drawHeaderOnContext({ ctx: spriteCtx as any, cx: 0, cy: headerY, cw: CANVAS_W, ...headerDrawOpts });
        if (marketData && marketAvatarImgRef && marketAvatarUrlRef) {
          drawMarketRow({
            ctx: spriteCtx as any,
            cx: 0,
            videoBottomY: cropBoxFrozen.y + cropBoxFrozen.h,
            cw: CANVAS_W,
            name: marketData.name,
            subtitle: marketData.industry ?? marketData.subcategory ?? '—',
            photo_url: marketData.photo_url,
            priceUsd: marketData.price.usd,
            lifetimeChangePct: marketData.price.lifetimeChangePct,
            sparkline: marketData.sparkline,
            size: marketData.size ?? 'large',
            avatarImgRef: marketAvatarImgRef,
            lastPhotoUrlRef: marketAvatarUrlRef,
          });
        }
      }

      // Advance `currentFrame` to the latest decoded frame with ts <= targetTs,
      // closing earlier frames as we step past them. Waits for the producer if
      // nothing's available yet.
      const advanceTo = async (targetTs: number): Promise<void> => {
        while (true) {
          if (decoderError) throw decoderError;
          if (signal.aborted) throw new Error('Cancelled');

          while (frameQueue.length > 0 && frameQueue[0].ts <= targetTs) {
            if (currentFrame) currentFrame.frame.close();
            currentFrame = frameQueue.shift()!;
            wakeProducer();
          }

          // Queue head (if any) has ts > targetTs — we're settled.
          if (frameQueue.length > 0) {
            // First-frame edge case: no current frame because the first decoded
            // frame's ts is already past targetTs. Adopt it anyway.
            if (!currentFrame) {
              currentFrame = frameQueue.shift()!;
              wakeProducer();
            }
            return;
          }

          // Queue empty + producer done → no more frames coming.
          if (producerDone) return;

          // Wait for the next decoded frame.
          await new Promise<void>((r) => { consumerWaiter = r; });
        }
      };

      try {
        for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
          if (signal.aborted) throw new Error('Cancelled');

          const targetTs = frameIdx * EXPORT_FRAME_DURATION + clipStart;
          await advanceTo(targetTs);
          if (!currentFrame) {
            console.warn('[EXPORT] no frame available at idx', frameIdx, '— stopping render early');
            break;
          }

          // Per-frame work is now just: bg fill + video drawImage + sprite
          // drawImage. All text shaping, emoji loads, avatar draws, sparkline
          // geometry, etc. were pre-baked into overlaySprite once above.
          offCtx.fillStyle = isClean ? '#fff' : '#000';
          offCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);

          const cropBox = boxRef.current;
          const { x: ox, y: oy } = videoOffsetRef.current;
          const vw = video?.videoWidth || 1080;
          const vh = video?.videoHeight || 1920;
          // Cover-fill the crop box (matches the on-screen draw loop).
          const cover = Math.max(cropBox.w / vw, cropBox.h / vh) * videoScaleRef.current;
          const drawW = vw * cover;
          const drawH = vh * cover;
          const dx = cropBox.x + (cropBox.w - drawW) / 2 + ox;
          const dy = cropBox.y + (cropBox.h - drawH) / 2 + oy;

          offCtx.save();
          offCtx.beginPath();
          offCtx.rect(cropBox.x, cropBox.y, cropBox.w, cropBox.h);
          offCtx.clip();
          offCtx.drawImage(currentFrame.frame, dx, dy, drawW, drawH);
          offCtx.restore();

          // Composite the pre-baked overlay (caption for clean, header + market
          // row for sonotrade) on top of the video. Drawing this AFTER the video
          // preserves the original z-order — e.g. the header's 4 px overlap onto
          // the cropBox stays painted over the video, matching the old per-frame
          // ordering bit-for-bit.
          offCtx.drawImage(overlaySprite, 0, 0);

          const sample = new VideoSample(offscreen, { timestamp: targetTs, duration: EXPORT_FRAME_DURATION });
          await videoSource.add(sample);
          sample.close();
          reportProgress(0.15 + (frameIdx / totalFrames) * 0.7);
        }
      } finally {
        // Tell the producer to stop decoding the (now unneeded) tail, then wake
        // it so it observes the flag and returns — otherwise `await producer`
        // below deadlocks whenever clipEnd < fullDuration (i.e. the end was
        // trimmed off).
        consumerDone = true;
        if (currentFrame) { currentFrame.frame.close(); currentFrame = null; }
        while (frameQueue.length > 0) frameQueue.shift()!.frame.close();
        wakeProducer(); // wake it so it observes consumerDone and returns
      }

      // Wait for producer (decode + flush) to complete before closing decoder.
      try { await producer; } catch { /* already surfaced via decoderError */ }
      if (decoderError) throw decoderError;
      try { decoder.close(); } catch { /* may already be closed */ }

      if (audioSource && audioPackets.length > 0) {
        setRecStatus('Adding audio...');
        for (let i = 0; i < audioPackets.length; i++) {
          await audioSource.add(audioPackets[i], i === 0 ? { decoderConfig: audioDecoderConfigForExport } : undefined);
        }
      }

      setRecStatus('Finalizing...');
      setRecProgress(0.95);
      await output.finalize();

      let buffer = output.target.buffer;
      if (!buffer) throw new Error('No buffer received from output');
      if (includeEditRef.current) buffer = await mergeWithEdit(buffer, clipDuration);

      const blob = new Blob([buffer], { type: 'video/mp4' });

      // Filename = short, readable version of the on-card caption (word-boundary
      // truncated). Falls back to the old row/id naming when there's no caption.
      const captionBase = (overlayCaption || '').replace(/\s+/g, ' ').trim();
      let nameBase = captionBase;
      if (nameBase.length > 60) {
        const cut = nameBase.slice(0, 60);
        const lastSpace = cut.lastIndexOf(' ');
        nameBase = (lastSpace > 30 ? cut.slice(0, lastSpace) : cut).trim();
      }
      if (!nameBase) nameBase = `row-${String(rowNumber + 1).padStart(2, '0')}-${videoId ?? 'export'}`;

      // Save straight to ~/Downloads/copyright free images/MM-DD-YYYY/ via the
      // local Studio server. Fall back to a normal browser download if that
      // fails, so an export is never lost.
      try {
        const resp = await fetch(`/api/export/save?name=${encodeURIComponent(nameBase)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'video/mp4' },
          body: blob,
        });
        if (!resp.ok) throw new Error(await resp.text());
        const data = await resp.json() as { filename?: string };
        const fname = data.filename ?? nameBase + '.mp4';
        setRecStatus(`In Phonedeck Incoming: ${fname}`);
        setTimeout(() => setRecStatus(''), 5000);
      } catch (saveErr) {
        console.warn('[EXPORT] save-to-folder failed, falling back to browser download:', saveErr);
        const url = URL.createObjectURL(blob);
        Object.assign(document.createElement('a'), { href: url, download: `${nameBase}.mp4` }).click();
        URL.revokeObjectURL(url);
      }
      setRecProgress(1);

    } catch (error) {
      if (error instanceof Error && error.message !== 'Cancelled') {
        console.error('[EXPORT] ❌ EXPORT FAILED:', error);
        console.error('[EXPORT] stack:', error.stack);
        setRecStatus(`Error: ${error.message}`);
        setTimeout(() => setRecStatus(''), 8000);
        throw error;
      }
    } finally {
      setIsRecording(false);
      setRecProgress(0);
      setRecStatus('');
      const v = config.videoRef.current;
      if (v) { v.muted = true; v.pause(); v.currentTime = 0; v.loop = true; v.playbackRate = 1.0; }
      abortControllerRef.current = null;
    }
  }

  function cancelRecording() {
    abortControllerRef.current?.abort();
    setIsRecording(false);
    setRecProgress(0);
    setRecStatus('');
    const v = config.videoRef.current;
    if (v) { v.muted = true; v.pause(); v.currentTime = 0; v.playbackRate = 1.0; v.loop = true; }
  }

  return { isRecording, recProgress, recStatus, startRecording, cancelRecording };
}
