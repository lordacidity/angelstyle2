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
import { countCaptionLines, countSonotradeCaptionLines } from '../drawing/countCaptionLines';
import type { Box } from '../types';

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

      setRecStatus('Downloading video file...');
      let arrayBuffer: ArrayBuffer;
      try {
        const response = await fetch(videoUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        arrayBuffer = await response.arrayBuffer();
      } catch (fetchError) {
        throw new Error(`Failed to download video: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}`);
      }

      setRecStatus('Parsing video file...');

      // @ts-ignore
      const MP4BoxFile = MP4Box.createFile();
      let videoSamples: Array<{ data: Uint8Array; timestamp: number; duration: number; isKeyframe: boolean }> = [];
      let audioSamples: Array<{ data: Uint8Array; timestamp: number; duration: number }> = [];
      let videoTrackId: number | null = null;
      let audioTrackId: number | null = null;
      let videoTimescale = 90000;
      let audioTimescale = 44100;

      MP4BoxFile.onReady = (info: any) => {
        for (const track of info.tracks || []) {
          if (track.type === 'video' && !videoTrackId) { videoTrackId = track.id; videoTimescale = track.timescale || 90000; }
          if (track.type === 'audio' && !audioTrackId) { audioTrackId = track.id; audioTimescale = track.timescale || 44100; }
        }
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
      MP4BoxFile.onError = (e: any) => console.error('[MP4Box error]', e);

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

      if (videoSamples.length === 0) throw new Error('No video samples found');

      const lastSample = videoSamples[videoSamples.length - 1];
      const fullDuration = lastSample.timestamp + lastSample.duration;
      const clipStart = trimStartRef.current;
      const clipEnd = trimEndRef.current > 0 && trimEndRef.current <= fullDuration ? trimEndRef.current : fullDuration;
      const clipDuration = Math.max(0.1, clipEnd - clipStart);
      const totalFrames = Math.floor(clipDuration * EXPORT_FPS);

      setRecStatus('Decoding video...');

      const decodedFrames: Array<{ frame: VideoFrame; timestamp: number }> = [];
      const decoder = new VideoDecoder({
        output: (frame: VideoFrame) => { decodedFrames.push({ frame, timestamp: frame.timestamp / 1_000_000 }); },
        error: (e: Error) => console.error('[VideoDecoder]', e),
      });

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
        } catch { /* ignore */ }
      }

      // @ts-ignore
      decoder.configure({ codec: 'avc1.64001F', codedWidth: 1080, codedHeight: 1920, description });

      for (let i = 0; i < videoSamples.length; i++) {
        if (signal.aborted) {
          decoder.close();
          for (const { frame } of decodedFrames) frame.close();
          throw new Error('Cancelled');
        }
        const s = videoSamples[i];
        await decoder.decode(new EncodedVideoChunk({ type: s.isKeyframe ? 'key' : 'delta', timestamp: s.timestamp * 1_000_000, data: s.data }));
        setRecProgress(0.1 + (i / videoSamples.length) * 0.3);
      }
      await decoder.flush();
      decoder.close();

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

      setRecStatus('Rendering frames...');
      await output.start();

      const offscreen = new OffscreenCanvas(CANVAS_W, CANVAS_H);
      const offCtx = offscreen.getContext('2d')!;

      for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
        if (signal.aborted) {
          for (const { frame } of decodedFrames) frame.close();
          await output.finalize();
          throw new Error('Cancelled');
        }

        const targetTs = frameIdx * EXPORT_FRAME_DURATION + clipStart;
        let sourceFrame = decodedFrames[0];
        for (const f of decodedFrames) {
          if (f.timestamp <= targetTs) sourceFrame = f;
          else break;
        }

        if (isClean) {
          // ── Caption template: white bg, caption above, video in crop box ──
          offCtx.fillStyle = '#fff';
          offCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);

          const cropBox = boxRef.current;
          const { x: ox, y: oy } = videoOffsetRef.current;

          if (overlayCaption) {
            const captionLines = countCaptionLines(offCtx as any, overlayCaption);
            const CAPTION_BOTTOM_OFFSET = 18;
            const CLEAN_PAD_TOP = 44;
            const CLEAN_PAD_BOT = 40;
            const captionAreaH = CLEAN_PAD_TOP + (captionLines * CAPTION_LINE_HEIGHT) + CLEAN_PAD_BOT - CAPTION_BOTTOM_OFFSET;
            const captionAreaY = Math.max(0, cropBox.y - captionAreaH + 4);

            offCtx.font = `400 44px Chirp, "Twitter Chirp", -apple-system, BlinkMacSystemFont, sans-serif`;
            offCtx.fillStyle = '#000';
            const padX = HEADER_PADDING_X + 43;
            const maxWidth = CANVAS_W - padX * 2;
            let cy = captionAreaY + CLEAN_PAD_TOP + CAPTION_LINE_HEIGHT - 10;

            for (const userLine of overlayCaption.split('\n')) {
              if (!userLine) { cy += CAPTION_LINE_HEIGHT; continue; }
              let line = '';
              for (const word of userLine.split(' ')) {
                const test = line + word + ' ';
                if (offCtx.measureText(test).width > maxWidth && line) {
                  offCtx.fillText(line.trimEnd(), padX, cy);
                  line = word + ' '; cy += CAPTION_LINE_HEIGHT;
                } else { line = test; }
              }
              offCtx.fillText(line.trimEnd(), padX, cy);
              cy += CAPTION_LINE_HEIGHT;
            }
          }

          const vw = video?.videoWidth || 1080;
          const vh = video?.videoHeight || 1920;
          const scale = (CANVAS_W / vw) * videoScaleRef.current;
          const dx = (CANVAS_W - vw * scale) / 2 + ox;
          const dy = (CANVAS_H - vh * scale) / 2 + oy;

          offCtx.save();
          offCtx.beginPath();
          offCtx.rect(cropBox.x, cropBox.y, cropBox.w, cropBox.h);
          offCtx.clip();
          offCtx.drawImage(sourceFrame.frame, dx, dy, vw * scale, vh * scale);
          offCtx.restore();

        } else {
          // ── Twitter template: black bg, X header, video below ──
          offCtx.fillStyle = '#000';
          offCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);

          const cropBox = boxRef.current;
          const { x: ox, y: oy } = videoOffsetRef.current;
          const vw = video?.videoWidth || 1080;
          const vh = video?.videoHeight || 1920;
          const scale = Math.min(1000 / vw, CANVAS_H / vh) * videoScaleRef.current;
          const dx = (CANVAS_W - vw * scale) / 2 + ox;
          const dy = (CANVAS_H - vh * scale) / 2 + oy;

          offCtx.save();
          offCtx.beginPath();
          offCtx.rect(cropBox.x, cropBox.y, cropBox.w, cropBox.h);
          offCtx.clip();
          offCtx.drawImage(sourceFrame.frame, dx, dy, vw * scale, vh * scale);
          offCtx.restore();

          const captionLines = overlayCaption ? countSonotradeCaptionLines(offCtx as any, overlayCaption) : 0;
          const headerHeight = overlayCaption
            ? BASE_HEADER_HEIGHT + CAPTION_TOP_PADDING + (captionLines * CAPTION_LINE_HEIGHT) - 18
            : BASE_HEADER_HEIGHT;
          const headerY = Math.max(0, cropBox.y - headerHeight + 4);

          // @ts-ignore
          drawHeaderOnContext({ ctx: offCtx as any, cx: 0, cy: headerY, cw: CANVAS_W, ...headerDrawOpts });
        }

        const sample = new VideoSample(offscreen, { timestamp: targetTs, duration: EXPORT_FRAME_DURATION });
        await videoSource.add(sample);
        sample.close();
        setRecProgress(0.4 + (frameIdx / totalFrames) * 0.4);
      }

      for (const { frame } of decodedFrames) frame.close();

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
      const url = URL.createObjectURL(blob);
      const filename = `row-${String(rowNumber + 1).padStart(2, '0')}-${videoId ?? 'export'}.mp4`;
      Object.assign(document.createElement('a'), { href: url, download: filename }).click();
      URL.revokeObjectURL(url);
      setRecProgress(1);

    } catch (error) {
      if (error instanceof Error && error.message !== 'Cancelled') {
        console.error('[startRecording] Export failed:', error);
        setRecStatus(`Error: ${error.message}`);
        setTimeout(() => setRecStatus(''), 3000);
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
