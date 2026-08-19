'use client';

import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle, memo } from 'react';
import { canvasPropsEqual } from '@/lib/canvasMemo';
import { CANVAS_W, CANVAS_H, DISPLAY_SCALE, PPT_W, PPT_H, PPT_DISPLAY_SCALE } from './constants';
import type { ChartsImageCanvasProps, ChartsImageCanvasRef } from './types';
import { muxClientSide, safeExportName, PHONEDECK_URL } from '@/lib/canvasVideoExport';
import { drawChartImageFrame, MAX_CHART_STRENGTH, GROW_MS, HOLD_MS, PULSE_MS } from './render';

export type { ChartsImageCanvasRef, ChartsImageMarket, CanvasAspectRatio, ChartsImageStrength, ChartsImageNoise, ChartsImageSubMode } from './types';
export { MAX_CHART_STRENGTH };

// ── Component ─────────────────────────────────────────────────────────────────

const ChartsImageCanvasBase = forwardRef<ChartsImageCanvasRef, ChartsImageCanvasProps>(
  function ChartsImageCanvas({ market, overrideName = '', overrideIndustry = '', strength = 0, noise = 0, aspectRatio = 'portrait', subMode = 'image', speed = 1, audioUrl, onRecordingStateChange }, ref) {
    const cW     = aspectRatio === 'ppt' ? PPT_W     : CANVAS_W;
    const cH     = aspectRatio === 'ppt' ? PPT_H     : CANVAS_H;
    const dScale = aspectRatio === 'ppt' ? PPT_DISPLAY_SCALE : DISPLAY_SCALE;

    const canvasRef          = useRef<HTMLCanvasElement>(null);
    const rafRef             = useRef(0);
    const imgRef             = useRef<HTMLImageElement | null>(null);
    const pauvLogoRef        = useRef<HTMLImageElement | null>(null);
    const marketRef          = useRef(market);
    const overrideNameRef    = useRef(overrideName);
    const overrideIndustryRef = useRef(overrideIndustry);
    const strengthRef        = useRef(strength);
    const noiseRef           = useRef(noise);
    const dimensionsRef      = useRef({ cW, cH });

    // Video mode
    const subModeRef     = useRef(subMode);
    const speedRef       = useRef(Math.min(3, Math.max(1, speed || 1)));
    const audioUrlRef    = useRef<string | null>(audioUrl ?? null);
    const onRecStateRef  = useRef(onRecordingStateChange);
    const animStartRef   = useRef(0);   // ms timestamp the reveal clock started (0 = not started)
    const isRecordingRef = useRef(false);

    useEffect(() => { marketRef.current          = market;          }, [market]);
    useEffect(() => { overrideNameRef.current    = overrideName;    }, [overrideName]);
    useEffect(() => { overrideIndustryRef.current = overrideIndustry; }, [overrideIndustry]);
    useEffect(() => { strengthRef.current        = strength;        }, [strength]);
    useEffect(() => { noiseRef.current           = noise;           }, [noise]);
    useEffect(() => { dimensionsRef.current      = { cW, cH };     }, [cW, cH]);
    useEffect(() => { speedRef.current   = Math.min(3, Math.max(1, speed || 1)); }, [speed]);
    useEffect(() => { audioUrlRef.current = audioUrl ?? null; }, [audioUrl]);
    useEffect(() => { onRecStateRef.current = onRecordingStateChange; }, [onRecordingStateChange]);
    // Entering video mode (re)starts the reveal from t=0; image mode shows it full.
    useEffect(() => { subModeRef.current = subMode; animStartRef.current = 0; }, [subMode]);
    // Replay when fresh data / a different market arrives, so the preview plays in.
    useEffect(() => { animStartRef.current = 0; }, [market?.id, market?.sparkline?.length]);

    // ── Load pauv logo ──────────────────────────────────────────────────────
    useEffect(() => {
      const img   = new Image();
      img.onload  = () => { pauvLogoRef.current = img; };
      img.onerror = () => { pauvLogoRef.current = null; };
      img.src = '/pauvlogo.png';
    }, []);

    // ── Load avatar image via proxy ─────────────────────────────────────────
    useEffect(() => {
      const url = market?.photo_url;
      if (!url) { imgRef.current = null; return; }
      const img        = new Image();
      img.crossOrigin  = 'anonymous';
      img.onload  = () => { imgRef.current = img; };
      img.onerror = () => { imgRef.current = null; };
      img.src = `/api/charts/image-proxy?url=${encodeURIComponent(url)}`;
    }, [market?.photo_url]);

    // ── Draw loop ───────────────────────────────────────────────────────────
    const draw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) { rafRef.current = requestAnimationFrame(draw); return; }
      const ctx = canvas.getContext('2d');
      if (!ctx)  { rafRef.current = requestAnimationFrame(draw); return; }

      const { cW: w, cH: h } = dimensionsRef.current;
      const mk = marketRef.current;

      if (!mk) {
        ctx.fillStyle = '#0A0A0A';
        ctx.fillRect(0, 0, w, h);
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.font         = `300 28px -apple-system, sans-serif`;
        ctx.fillStyle    = '#27272a';
        ctx.fillText('Select a market to get started', w / 2, h / 2);
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      // Reveal fraction: in video mode the line draws in over GROW_MS/speed, then
      // holds at full. In image mode it's always full. The tip dot pulses (radar
      // ping) only in video mode; the still image keeps the frozen mid-pulse.
      let revealT = 1;
      let tipPulseT = -1;
      if (subModeRef.current === 'video') {
        const hasData = (mk.sparkline?.length ?? 0) > 0;
        if (hasData && animStartRef.current === 0) animStartRef.current = performance.now();
        revealT = animStartRef.current === 0
          ? 0
          : Math.min((performance.now() - animStartRef.current) / (GROW_MS / speedRef.current), 1);
        tipPulseT = (performance.now() % PULSE_MS) / PULSE_MS;
      }

      drawChartImageFrame(ctx, w, h, {
        market: mk,
        overrideName:     overrideNameRef.current,
        overrideIndustry: overrideIndustryRef.current,
        strength:         strengthRef.current,
        noise:            noiseRef.current,
        avatarImg:        imgRef.current,
        pauvLogo:         pauvLogoRef.current,
        revealT,
        tipPulseT,
      });
      rafRef.current = requestAnimationFrame(draw);
    }, []);

    useEffect(() => {
      let cancelled = false;
      Promise.all([
        document.fonts.load('600 48px "JetBrains Mono"'),
        document.fonts.load('500 22px "JetBrains Mono"'),
        document.fonts.load('400 22px "JetBrains Mono"'),
        document.fonts.load('400 36px "Inter"'),
        document.fonts.load('500 28px "Inter"'),
      ]).then(() => {
        if (!cancelled) rafRef.current = requestAnimationFrame(draw);
      });
      return () => {
        cancelled = true;
        cancelAnimationFrame(rafRef.current);
      };
    }, [draw]);

    // ── PNG export ──────────────────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      exportPng: () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx)  return;

        const { cW: w, cH: h } = dimensionsRef.current;
        const mk = marketRef.current;

        if (mk) {
          // Static full chart (revealT 1, frozen mid-pulse) — paints its own bg.
          drawChartImageFrame(ctx, w, h, {
            market: mk,
            overrideName:     overrideNameRef.current,
            overrideIndustry: overrideIndustryRef.current,
            strength:         strengthRef.current,
            noise:            noiseRef.current,
            avatarImg:        imgRef.current,
            pauvLogo:         pauvLogoRef.current,
          });
        } else {
          ctx.fillStyle = '#0A0A0A';
          ctx.fillRect(0, 0, w, h);
        }

        canvas.toBlob(blob => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const a   = document.createElement('a');
          a.href     = url;
          a.download = `${mk?.name ?? 'chart'}-sentiment.png`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        }, 'image/png');
      },

      // Restart the reveal animation from t=0 (preview replay button).
      replay: () => { animStartRef.current = 0; },

      // ── Video export ────────────────────────────────────────────────────────
      // Record the on-canvas reveal animation with MediaRecorder, then mux in the
      // chosen audio + rewrite a clean MP4 client-side (same approach as the
      // Charts artist feature, host-independent so it works on Vercel too).
      startVideoExport: async () => {
        const canvas = canvasRef.current;
        const mk = marketRef.current;
        if (!canvas || isRecordingRef.current || !mk) return;
        if ((mk.sparkline?.length ?? 0) === 0) return; // nothing to animate yet

        isRecordingRef.current = true;
        const notify = (isRecording: boolean, recProgress: number, recStatus: string) =>
          onRecStateRef.current?.({ isRecording, recProgress, recStatus });

        let framePump: ReturnType<typeof setInterval> | null = null;
        notify(true, 0, 'Starting…');

        try {
          // Restart the reveal from the beginning of the recording.
          animStartRef.current = 0;
          await new Promise<void>(r => setTimeout(r, 80)); // let one RAF tick restart the clock

          const mimeType =
            typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')
              ? 'video/mp4;codecs=avc1'
              : typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4')
                ? 'video/mp4'
                : 'video/webm;codecs=vp9';

          // captureStream(0) = a frame is emitted ONLY when we call requestFrame().
          // A fixed-rate capture silently stops emitting frames once the canvas
          // paints identical pixels — which happens the instant the chart settles
          // into its held final state — truncating the video. Pumping requestFrame
          // at 30 fps guarantees the full duration (incl. the hold) is captured.
          let stream = canvas.captureStream(0);
          let captureTrack = stream.getVideoTracks()[0] as any;
          if (typeof captureTrack?.requestFrame !== 'function') {
            stream = canvas.captureStream(30);
            captureTrack = null;
          }

          // Play the audio in the browser so the user hears it while recording,
          // but do NOT add it to the recorder stream (it's muxed in as AAC after).
          let audioEl: HTMLAudioElement | null = null;
          if (audioUrlRef.current) {
            try {
              audioEl = new Audio(audioUrlRef.current);
              audioEl.preload = 'auto';
              await new Promise<void>(res => {
                if (!audioEl || audioEl.readyState >= 3) { res(); return; }
                audioEl.oncanplay = () => res();
                setTimeout(res, 6000);
              });
            } catch { audioEl = null; }
          }

          const cycleMs  = GROW_MS / speedRef.current + HOLD_MS;
          const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
          const chunks: Blob[] = [];
          recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
          recorder.start(200);

          if (audioEl) { audioEl.currentTime = 0; audioEl.play().catch(() => {}); }

          const FRAME_INTERVAL_MS = 1000 / 30;
          if (typeof captureTrack?.requestFrame === 'function') {
            framePump = setInterval(() => {
              if (!document.hidden) { try { captureTrack.requestFrame(); } catch { /* track ended */ } }
            }, FRAME_INTERVAL_MS);
          }

          notify(true, 0.01, 'Recording…');

          // Pause recorder + audio + reveal clock while the tab is hidden so the
          // output has no frozen-frame gaps from background throttling.
          let hiddenAt = 0;
          let totalHiddenMs = 0;
          const onVisibility = () => {
            if (document.hidden) {
              hiddenAt = performance.now();
              recorder.pause();
              audioEl?.pause();
            } else {
              const gap = performance.now() - hiddenAt;
              totalHiddenMs += gap;
              if (animStartRef.current) animStartRef.current += gap;
              recorder.resume();
              if (audioEl && audioEl.paused) audioEl.play().catch(() => {});
            }
          };
          document.addEventListener('visibilitychange', onVisibility);

          const startMs = performance.now();
          await new Promise<void>(resolve => {
            const tick = () => {
              const elapsed = performance.now() - startMs - totalHiddenMs;
              const p = Math.min(elapsed / cycleMs, 1);
              notify(true, p, 'Recording…');
              if (p >= 1) resolve(); else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });

          document.removeEventListener('visibilitychange', onVisibility);
          if (framePump) { clearInterval(framePump); framePump = null; }
          audioEl?.pause();

          recorder.stop();
          await new Promise<void>(r => { recorder.onstop = () => r(); });

          notify(true, 0.98, 'Processing…');

          const videoBlob = new Blob(chunks, { type: mimeType });
          const filename  = `${safeExportName(mk.name || 'chart')}-sentiment.mp4`;

          let blob = videoBlob;
          let audioMixed = false;
          try {
            const res = await muxClientSide(videoBlob, audioUrlRef.current, s => notify(true, 0.98, s));
            blob = res.blob;
            audioMixed = res.hasAudio;
            if (audioUrlRef.current && !res.hasAudio) {
              notify(true, 0.98, '⚠ Audio encode failed — exporting silent');
              await new Promise<void>(r => setTimeout(r, 2000));
            }
          } catch (e) {
            console.error('[chartsimage export] client-side mux failed — exporting raw recording:', e);
            notify(true, 0.98, '⚠ Export processing failed — raw file');
            await new Promise<void>(r => setTimeout(r, 2000));
          }

          const audioTag = audioMixed ? ' 🔊' : ' (muted)';
          try {
            const form = new FormData();
            form.append('files', blob, filename);
            const resp = await fetch(`${PHONEDECK_URL}/api/upload`, { method: 'POST', body: form });
            if (!resp.ok) throw new Error(await resp.text());
            notify(true, 1, `In Phonedeck: ${filename}${audioTag}`);
            setTimeout(() => notify(false, 0, ''), 5000);
          } catch {
            const url = URL.createObjectURL(blob);
            Object.assign(document.createElement('a'), { href: url, download: filename }).click();
            URL.revokeObjectURL(url);
            notify(true, 1, `Saved to Downloads${audioTag}`);
            setTimeout(() => notify(false, 0, ''), 4000);
          }
        } catch (err) {
          notify(true, 0, `Error: ${err instanceof Error ? err.message : String(err)}`);
          setTimeout(() => notify(false, 0, ''), 5000);
        } finally {
          if (framePump) { clearInterval(framePump); framePump = null; }
          isRecordingRef.current = false;
        }
      },
    }), []);

    return (
      <canvas
        ref={canvasRef}
        width={cW}
        height={cH}
        style={{
          width:   cW * dScale,
          height:  cH * dScale,
          display: 'block',
        }}
      />
    );
  },
);

export const ChartsImageCanvas = memo(ChartsImageCanvasBase, canvasPropsEqual);
