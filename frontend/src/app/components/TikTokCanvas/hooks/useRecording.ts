'use client';

import { useState, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';

import {
  CANVAS_W, CANVAS_H, BASE_HEADER_HEIGHT, CAPTION_TOP_PADDING, CAPTION_LINE_HEIGHT,
  HEADER_PADDING_X,
} from '../constants';
import { drawHeaderOnContext } from '../drawing/drawHeader';
import { drawMarketRow } from '../drawing/drawMarketRow';
import { drawRotatingCTA } from '../drawing/drawRotatingCTA';
import { countCaptionLines, countPauvCaptionLines, CAPTION_EMOJI_SIZE } from '../drawing/countCaptionLines';
import { wrapRichText, drawRichLine, preloadEmojiImagesForText } from '@/lib/emoji';
import type { Box, MarketData } from '../types';

// Phonedeck server runs on the user's OWN machine (default localhost:8080).
// The export upload must therefore go DIRECTLY from the browser — the same
// browser-direct pattern every other Phonedeck call uses (see PhonedeckApp).
// Routing it through a same-origin Next.js route breaks on Vercel, where
// "localhost" is Vercel's server, not the user's PC. Override the host with
// NEXT_PUBLIC_PHONEDECK_URL if Phonedeck runs on a peer machine.
const PHONEDECK_URL = process.env.NEXT_PUBLIC_PHONEDECK_URL ?? 'http://localhost:8080';

// Strip characters multer/Windows can't put in a filename. Mirrors the old
// /api/export/save route's safeName so exported names stay identical.
function safeExportName(raw: string): string {
  const cleaned = raw
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 70)
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned || 'export';
}

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
  marketDataAlt?: MarketData | null;
  marketAvatarImgRef?: MutableRefObject<HTMLImageElement | null>;
  marketAvatarUrlRef?: MutableRefObject<string | null>;
  marketAvatarImgRef2?: MutableRefObject<HTMLImageElement | null>;
  marketAvatarUrlRef2?: MutableRefObject<string | null>;
  pauvLogoImgRef?: MutableRefObject<HTMLImageElement | null>;
}

export function useRecording(config: UseRecordingConfig) {
  const [isRecording, setIsRecording] = useState(false);
  const [recProgress, setRecProgress] = useState(0);
  const [recStatus, setRecStatus] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);

  // Always-current snapshot of config. startRecording reads from this ref so
  // that a stale imperative handle (one render behind due to useImperativeHandle
  // commit timing) still captures the latest marketData/caption/etc.
  const configRef = useRef(config);
  configRef.current = config;

  async function startRecording(): Promise<string | undefined> {
    // Set to the upload filename once the render lands in Phonedeck's Incoming
    // folder. Returned to the caller so the Studio can later mark the source
    // board row Posted when *this* file is pushed to a phone (export itself no
    // longer marks anything).
    let uploadedName: string | undefined;
    const {
      canvasRef, videoRef, brand, rowNumber, videoId,
      boxRef, videoOffsetRef, videoScaleRef,
      trimStartRef, trimEndRef, includeEditRef,
      logoImgRef, verifiedImgRef,
      overlayCaption, overlayLogoSrc, overlayDisplayName, overlayHandle, overlayVerified,
      marketData, marketDataAlt, marketAvatarImgRef, marketAvatarUrlRef,
      marketAvatarImgRef2, marketAvatarUrlRef2, pauvLogoImgRef,
    } = configRef.current;

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
    if (overlayCaption) await preloadEmojiImagesForText(overlayCaption);

    const isClean = brand === 'clean';

    try {
      const mediabunny = await import('mediabunny');
      const {
        Output, Mp4OutputFormat, BufferTarget, VideoSample, VideoSampleSource,
        EncodedAudioPacketSource, EncodedVideoPacketSource, EncodedPacketSink, EncodedPacket,
        Input, BlobSource, ALL_FORMATS, QUALITY_VERY_HIGH,
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

      // Transcode arbitrary source audio (Opus / MP3 / AC-3 / PCM / …) to AAC for
      // the MP4 output. Dropped local files frequently aren't AAC, and AAC is the
      // only audio the MP4 muxer takes verbatim — without this they export silent,
      // or the codec mismatch trips output.finalize() and the export never
      // completes. Decodes via Web Audio (container-agnostic) then re-encodes with
      // AudioEncoder, mirroring mergeWithEdit. Returns trimmed, 0-based AAC packets.
      async function transcodeAudioToAac(
        srcBuffer: ArrayBuffer, clipStartSec: number, clipEndSec: number,
      ): Promise<{ packets: any[]; config: any } | null> {
        if (typeof AudioEncoder === 'undefined' || typeof AudioContext === 'undefined') return null;
        const SR = 44100, AFRAME = 1024;
        const tmp = new AudioContext({ sampleRate: SR });
        let decoded: AudioBuffer;
        try { decoded = await tmp.decodeAudioData(srcBuffer.slice(0)); }
        catch (e) { await tmp.close(); console.warn('[audio transcode] decode failed:', e); return null; }
        await tmp.close();

        const ch = Math.min(2, decoded.numberOfChannels) || 1;
        const startF = Math.max(0, Math.floor(clipStartSec * SR));
        const endF = Math.min(decoded.length, Math.ceil(clipEndSec * SR));
        if (endF - startF <= 0) return null;

        const chunks: EncodedAudioChunk[] = [];
        let cfg: AudioDecoderConfig | null = null;
        let err: Error | null = null;
        const enc = new AudioEncoder({
          output: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => {
            chunks.push(chunk);
            if (meta?.decoderConfig && !cfg) cfg = meta.decoderConfig;
          },
          error: (e: Error) => { err = e; },
        });
        enc.configure({ codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: ch, bitrate: 128_000 });

        const chData = Array.from({ length: ch }, (_, c) => decoded.getChannelData(Math.min(c, decoded.numberOfChannels - 1)));
        let tMicros = 0;
        for (let off = startF; off < endF; off += AFRAME) {
          const fc = Math.min(AFRAME, endF - off);
          const planar = new Float32Array(fc * ch);
          for (let c = 0; c < ch; c++) { const s = chData[c]; for (let i = 0; i < fc; i++) planar[c * fc + i] = s[off + i] ?? 0; }
          const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: fc, numberOfChannels: ch, timestamp: tMicros, data: planar });
          enc.encode(ad); ad.close();
          tMicros += Math.round((fc / SR) * 1_000_000);
        }
        await enc.flush(); enc.close();
        if (err) { console.warn('[audio transcode] encode failed:', err); return null; }
        if (chunks.length === 0) return null;
        if (!cfg) {
          const sfIdx = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350].indexOf(SR);
          const si = sfIdx >= 0 ? sfIdx : 4;
          cfg = { codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: ch, description: new Uint8Array([(2 << 3) | (si >> 1), ((si & 1) << 7) | (ch << 3)]) };
        }
        return { packets: chunks.map((c) => EncodedPacket.fromEncodedChunk(c)), config: cfg };
      }

      // ── Fetch + demux source video ────────────────────────────────────────────
      const videoSrcUrl = video.src || video.currentSrc;
      // Local uploads are blob: URLs that only exist in the browser — fetch them
      // directly. Remote videos go through the proxy (unless already proxied).
      const videoUrl = (videoSrcUrl.startsWith('blob:') || videoSrcUrl.includes('/api/proxy'))
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
      console.log('[EXPORT] parsing with mediabunny...');

      // Demux the source with mediabunny, which understands every container we
      // might be handed (mp4, mov, webm, mkv, …). The old path ran samples through
      // MP4Box, which only parses ISOBMFF — so a dropped .webm/.mkv (or a
      // fragmented file) produced "Box of type '' has a size …" garbage and zero
      // samples, and the export silently failed. One Input drives both the decoder
      // config and the encoded video packets.
      const demuxInput = new Input({ source: new BlobSource(new Blob([arrayBuffer], { type: 'video/mp4' })), formats: ALL_FORMATS });
      const primaryVideoTrack = await demuxInput.getPrimaryVideoTrack();
      if (!primaryVideoTrack) throw new Error('No video track found in source');

      let videoDecoderConfig: any = null;
      try { videoDecoderConfig = await primaryVideoTrack.getDecoderConfig(); }
      catch (cfgErr) { console.warn('[EXPORT] mediabunny video config failed:', cfgErr); }
      if (!videoDecoderConfig) throw new Error('Could not read the video codec — the file may be unsupported or corrupted');

      // Packets arrive in DECODE order (required for the VideoDecoder); each
      // carries its presentation timestamp. Keep arrival order for the decoder,
      // but derive the clip duration from the max presentation end so B-frame
      // reordering doesn't truncate it.
      const videoSamples: Array<{ data: Uint8Array; timestamp: number; duration: number; isKeyframe: boolean }> = [];
      let maxTs = 0, maxEnd = 0;
      for await (const p of new EncodedPacketSink(primaryVideoTrack).packets()) {
        const dur = p.duration || 0;
        videoSamples.push({ data: p.data, timestamp: p.timestamp, duration: dur, isKeyframe: p.type === 'key' });
        if (p.timestamp > maxTs) maxTs = p.timestamp;
        if (p.timestamp + dur > maxEnd) maxEnd = p.timestamp + dur;
      }
      console.log('[EXPORT] extracted video samples:', videoSamples.length);
      if (videoSamples.length === 0) throw new Error('No video samples found');

      const descBufEarly = videoDecoderConfig.description;
      const dbgDescEarly = descBufEarly instanceof Uint8Array ? descBufEarly : descBufEarly ? new Uint8Array(descBufEarly) : undefined;
      const hexDescEarly = dbgDescEarly ? Array.from(dbgDescEarly.slice(0, Math.min(32, dbgDescEarly.length))).map((b: number) => b.toString(16).padStart(2, '0')).join(' ') : '<none>';
      console.log('[EXPORT] decoder config — codec:', videoDecoderConfig.codec, `${videoDecoderConfig.codedWidth}×${videoDecoderConfig.codedHeight}`, 'description length:', dbgDescEarly?.byteLength ?? 0, 'first bytes:', hexDescEarly);

      const fullDuration = maxEnd > maxTs ? maxEnd : maxTs + EXPORT_FRAME_DURATION;
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

      // ── Set up output container + audio BEFORE decoding so we can stream ─────
      setRecStatus('Preparing audio...');

      const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
      // QUALITY_VERY_HIGH ≈ 12 Mbps at 1080×1920 (double QUALITY_HIGH's ~6 Mbps) —
      // keeps text edges, the favicon and fine video detail crisp instead of
      // smearing them into compression mush.
      const videoSource = new VideoSampleSource({ codec: 'avc', bitrate: QUALITY_VERY_HIGH });
      output.addVideoTrack(videoSource);

      let audioSource: any = null;
      let audioPackets: any[] = [];
      let audioDecoderConfigForExport: any = null;

      // Decide audio inclusion + path from the real demuxed audio track. AAC
      // sources copy through verbatim; anything else (Opus / MP3 / AC-3 / PCM —
      // all common in dropped local files) is transcoded to AAC so it isn't
      // dropped silently or rejected by the MP4 muxer at finalize.
      try {
        const input = new Input({ source: new BlobSource(new Blob([arrayBuffer], { type: 'video/mp4' })), formats: ALL_FORMATS });
        const audioTrack = await input.getPrimaryAudioTrack();
        if (audioTrack && audioTrack.codec === 'aac') {
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
        } else if (audioTrack) {
          console.log('[EXPORT] non-AAC source audio (' + audioTrack.codec + ') — transcoding to AAC');
          const t = await transcodeAudioToAac(arrayBuffer, clipStart, clipEnd);
          if (t) {
            audioPackets = t.packets;
            audioDecoderConfigForExport = t.config;
            audioSource = new EncodedAudioPacketSource('aac');
            output.addAudioTrack(audioSource);
          }
        }
      } catch (e) { console.error('[audio setup]', e); }

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

      // Second CTA person's avatar (rotation only) — same CORS pre-load.
      if (marketDataAlt?.photo_url && marketAvatarImgRef2) {
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => { marketAvatarImgRef2.current = img; resolve(); };
          img.onerror = () => resolve();
          img.src = marketDataAlt.photo_url!;
        });
      }

      // Pre-load Pauv logo for the "link in bio" line.
      if (pauvLogoImgRef) {
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => { pauvLogoImgRef.current = img; resolve(); };
          img.onerror = () => resolve();
          img.src = '/pauvlogo.png';
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
      decoder.configure(videoDecoderConfig);

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
      // High-quality resampling for the per-frame video cover-fill and any scaled
      // overlay — the default 'low' softens edges on the export.
      offCtx.imageSmoothingEnabled = true;
      offCtx.imageSmoothingQuality = 'high';
      let currentFrame: { frame: VideoFrame; ts: number } | null = null;

      // ── Pre-bake static overlays into a sprite ──────────────────────────────
      // Caption (clean) and header + market row (pauv) don't change frame
      // to frame — they depend on the cropBox, brand, and inputs that are all
      // frozen for the duration of the recording. Painting them once into a
      // transparent overlay canvas and drawImage()-ing that single sprite per
      // frame skips all the per-frame text shaping, emoji loads, avatar draws,
      // and sparkline geometry that used to run on every iteration.
      const overlaySprite = new OffscreenCanvas(CANVAS_W, CANVAS_H);
      const spriteCtx = overlaySprite.getContext('2d')!;
      // High-quality resampling for the baked overlay — favicon avatar, market
      // photo and sparkline are all scaled down into this sprite.
      spriteCtx.imageSmoothingEnabled = true;
      spriteCtx.imageSmoothingQuality = 'high';
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
        const captionLines = overlayCaption ? countPauvCaptionLines(spriteCtx as any, overlayCaption) : 0;
        const headerHeight = overlayCaption
          ? BASE_HEADER_HEIGHT + CAPTION_TOP_PADDING + (captionLines * CAPTION_LINE_HEIGHT) - 18
          : BASE_HEADER_HEIGHT;
        const headerY = Math.max(0, cropBoxFrozen.y - headerHeight + 4);
        // @ts-ignore
        drawHeaderOnContext({ ctx: spriteCtx as any, cx: 0, cy: headerY, cw: CANVAS_W, ...headerDrawOpts });
        // A single CTA is static, so bake it into the sprite (only the arrow
        // animates, drawn per-frame below). With a SECOND person the card
        // cube-rotates, so it can't be baked — drawn fresh each frame instead.
        if (marketData && !marketDataAlt && marketAvatarImgRef && marketAvatarUrlRef) {
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
            ctaCategory: marketData.ctaCategory,
            down: marketData.down,
            avatarImgRef: marketAvatarImgRef,
            lastPhotoUrlRef: marketAvatarUrlRef,
            pauvLogoImgRef,
            arrowOpacity: 0, // triangle animated per-frame below
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
          // `currentFrame` is reassigned inside the advanceTo() closure, so TS
          // drops its union narrowing here and collapses it to `never` at use
          // sites. Re-assert the real type (via `as`, which an annotation can't
          // do because assignment-narrowing would re-apply the `never`) so the
          // guard below narrows correctly.
          const cf = currentFrame as { frame: VideoFrame; ts: number } | null;
          if (!cf) {
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
          offCtx.drawImage(cf.frame, dx, dy, drawW, drawH);
          offCtx.restore();

          // Composite the pre-baked overlay (caption for clean, header + market
          // row for pauv) on top of the video. Drawing this AFTER the video
          // preserves the original z-order — e.g. the header's 4 px overlap onto
          // the cropBox stays painted over the video, matching the old per-frame
          // ordering bit-for-bit.
          offCtx.drawImage(overlaySprite, 0, 0);

          // Per-frame CTA animation.
          if (!isClean && marketData) {
            const pulse = 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(2 * Math.PI * targetTs * 0.75));
            if (marketDataAlt && marketAvatarImgRef && marketAvatarUrlRef && marketAvatarImgRef2 && marketAvatarUrlRef2) {
              // Two people — cube-rotate the whole card per-frame (nothing baked).
              drawRotatingCTA({
                ctx: offCtx as any,
                cx: 0, cw: CANVAS_W,
                videoBottomY: cropBoxFrozen.y + cropBoxFrozen.h,
                t: targetTs, arrowOpacity: pulse,
                primary: marketData, alt: marketDataAlt,
                primaryRefs: { img: marketAvatarImgRef, url: marketAvatarUrlRef },
                altRefs: { img: marketAvatarImgRef2, url: marketAvatarUrlRef2 },
                pauvLogoImgRef,
              });
            } else if (marketAvatarImgRef && marketAvatarUrlRef) {
              // Single CTA — card is baked; just pulse the arrow triangle.
              drawMarketRow({
                ctx: offCtx as any,
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
                ctaCategory: marketData.ctaCategory,
                down: marketData.down,
                avatarImgRef: marketAvatarImgRef,
                lastPhotoUrlRef: marketAvatarUrlRef,
                triangleOnly: true,
                arrowOpacity: pulse,
              });
            }
          }

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
        const cfDone = currentFrame as { frame: VideoFrame; ts: number } | null;
        if (cfDone) { cfDone.frame.close(); currentFrame = null; }
        while (frameQueue.length > 0) frameQueue.shift()!.frame.close();
        wakeProducer(); // wake it so it observes consumerDone and returns
      }

      // Wait for producer (decode + flush) to complete before closing decoder.
      try { await producer; } catch { /* already surfaced via decoderError */ }
      if (decoderError) throw decoderError;
      try { decoder.close(); } catch { /* may already be closed */ }

      if (audioSource && audioPackets.length > 0) {
        setRecStatus('Adding audio...');
        // Don't let a late audio failure abort the whole export — a muted video is
        // a far better outcome than a render that "never finishes".
        try {
          for (let i = 0; i < audioPackets.length; i++) {
            await audioSource.add(audioPackets[i], i === 0 ? { decoderConfig: audioDecoderConfigForExport } : undefined);
          }
        } catch (audioAddErr) {
          console.error('[EXPORT] audio add failed — exporting without audio:', audioAddErr);
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

      // Send straight to the local Phonedeck server's Incoming folder. This
      // POSTs from the BROWSER directly to localhost:8080 (multer field name
      // "files", same as PhonedeckApp.uploadOne) — NOT through a Next.js route,
      // which would run on Vercel and never reach the user's PC. Fall back to a
      // normal browser download if Phonedeck isn't running, so a render is
      // never lost.
      const filename = `${safeExportName(nameBase)}.mp4`;
      try {
        const form = new FormData();
        form.append('files', blob, filename);
        const resp = await fetch(`${PHONEDECK_URL}/api/upload`, { method: 'POST', body: form });
        if (!resp.ok) throw new Error(await resp.text());
        // Phonedeck renames on filename collision (appends " (1)" etc.), so the
        // file landing on disk may NOT match the name we sent. Read the actual
        // stored name back from the response and report THAT to the caller, so
        // downstream trace (boardOrigins → pushOrigins → markPosted) keys on the
        // real filename and a later push reliably auto-marks the source row.
        const result = await resp.json().catch(() => null) as { files?: Array<{ name: string }> } | null;
        uploadedName = result?.files?.[0]?.name ?? filename;
        setRecStatus(`In Phonedeck Incoming: ${uploadedName}`);
        setTimeout(() => setRecStatus(''), 5000);
      } catch (saveErr) {
        console.warn('[EXPORT] phonedeck upload failed, falling back to browser download:', saveErr);
        setRecStatus('Phonedeck not reachable — saved to Downloads instead');
        setTimeout(() => setRecStatus(''), 6000);
        const url = URL.createObjectURL(blob);
        Object.assign(document.createElement('a'), { href: url, download: filename }).click();
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
    return uploadedName;
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
