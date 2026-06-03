'use client';

import { useRef, useEffect, useState, useCallback, Fragment, memo } from 'react';
import type { RecordingState } from './TikTokCanvas/types';
import { fmtTime } from '@/lib/utils';

export interface VideoCanvasRef {
  play: () => void;
  pause: () => void;
  seekTo: (t: number) => void;
  setTrimRange: (start: number, end: number) => void;
  resetTrim: () => void;
  resetBox: () => void;
  centerBox: () => void;
  // Only the TikTok video canvas supports a tunable top anchor; carousel doesn't.
  setBlockTopPct?: (pct: number) => void;
  getVideoElement: () => HTMLVideoElement | null;
  getTrimState: () => { trimStart: number; trimEnd: number; duration: number; blockTopPct?: number };
  startDownload: () => Promise<void>;
  cancelExport: () => void;
}

const FRAME_COUNT = 24;
const STRIP_H     = 52;

// fi/li locked at creation, displayOffset only affects visual position
interface Segment {
  id: string;
  start: number;
  end: number;
  fi: number;
  li: number;
  displayOffset: number;
}

function mkSeg(start: number, end: number, duration: number, prefix = 'seg'): Segment {
  return {
    id: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    start, end,
    fi: Math.floor((start / duration) * FRAME_COUNT),
    li: Math.ceil((end / duration) * FRAME_COUNT),
    displayOffset: 0,
  };
}

// ── Module-level components ───────────────────────────────────────────────────

const PlayheadHandle = memo(function PlayheadHandle({ left, onDown, onMove }: {
  left: number;
  onDown: (e: React.PointerEvent) => void;
  onMove: (e: React.PointerEvent) => void;
}) {
  return (
    <div className="absolute inset-y-0 -translate-x-1/2 cursor-col-resize z-30"
      style={{ left: `${left}%`, width: 20 }}
      onPointerDown={onDown} onPointerMove={onMove}>
      <div className="w-[2px] bg-white/90 h-full mx-auto shadow relative">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0 h-0"
          style={{ borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '7px solid rgba(255,255,255,0.9)' }} />
      </div>
    </div>
  );
});

const SegTrimStart = memo(function SegTrimStart({ segId, left, onDown, onMove }: {
  segId: string; left: number;
  onDown: (e: React.PointerEvent) => void;
  onMove: (e: React.PointerEvent) => void;
}) {
  return (
    <div data-seg-id={segId}
      className="absolute inset-y-0 w-5 -translate-x-1/2 flex items-stretch cursor-ew-resize z-40"
      style={{ left: `${left}%` }}
      onPointerDown={onDown} onPointerMove={onMove}>
      <div className="w-[3px] bg-white mx-auto relative">
        <div className="absolute top-0 left-0 w-2.5 h-2.5 bg-white rounded-br" />
        <div className="absolute bottom-0 left-0 w-2.5 h-2.5 bg-white rounded-tr" />
      </div>
    </div>
  );
});

const SegTrimEnd = memo(function SegTrimEnd({ segId, left, onDown, onMove }: {
  segId: string; left: number;
  onDown: (e: React.PointerEvent) => void;
  onMove: (e: React.PointerEvent) => void;
}) {
  return (
    <div data-seg-id={segId}
      className="absolute inset-y-0 w-5 -translate-x-1/2 flex items-stretch cursor-ew-resize z-40"
      style={{ left: `${left}%` }}
      onPointerDown={onDown} onPointerMove={onMove}>
      <div className="w-[3px] bg-white mx-auto relative">
        <div className="absolute top-0 right-0 w-2.5 h-2.5 bg-white rounded-bl" />
        <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-white rounded-tl" />
      </div>
    </div>
  );
});

const SegmentBody = memo(function SegmentBody({ segId, leftPct, widthPct, segFrames, isSelected, onDown, onMove }: {
  segId: string; leftPct: number; widthPct: number; segFrames: string[];
  isSelected: boolean;
  onDown: (e: React.PointerEvent) => void;
  onMove: (e: React.PointerEvent) => void;
}) {
  return (
    <div data-seg-id={segId}
      className="absolute top-0 bottom-0 overflow-hidden cursor-grab active:cursor-grabbing z-10"
      style={{ left: `${leftPct}%`, width: `${Math.max(0, widthPct)}%` }}
      onPointerDown={onDown} onPointerMove={onMove}>
      <div className="absolute inset-0 flex bg-zinc-800">
        {segFrames.length > 0
          ? segFrames.map((src, i) => (
              <div key={i} className="flex-1 h-full overflow-hidden">
                {src
                  ? <img src={src} alt="" className="w-full h-full object-cover block" draggable={false} />
                  : <div className="w-full h-full bg-zinc-700 animate-pulse" />}
              </div>
            ))
          : Array.from({ length: Math.max(1, Math.round(widthPct / 5)) }).map((_, i) => (
              <div key={i} className="flex-1 h-full bg-zinc-800 border-r border-zinc-700/30" />
            ))}
      </div>
      <div className={`absolute inset-0 ring-inset pointer-events-none transition-all ${
        isSelected ? 'ring-2 ring-white/90' : 'ring-1 ring-white/20'
      }`} />
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────

interface VideoControlsBarProps {
  entryId:        string | null;
  activeRef:      VideoCanvasRef | null;
  recordingState: RecordingState | null;
  videoSrc:       string | null;
  onDownloadAll:  () => void;
}

export function VideoControlsBar({ entryId, activeRef, recordingState, videoSrc }: VideoControlsBarProps) {
  // Once Export is pressed for this entry, the full timeline collapses to a slim
  // status bar (export progress + Download All). Reset whenever the selected
  // entry changes so each video starts in the full editor again.
  const [isPlaying,    setIsPlaying]    = useState(false);
  const [currentTime,  setCurrentTime]  = useState(0);
  const [duration,     setDuration]     = useState(0);
  const [segments,     setSegments]     = useState<Segment[]>([]);
  const [frames,       setFrames]       = useState<string[]>([]);
  const [timelineZoom, setTimelineZoom] = useState(1.0);
  const [selection,    setSelection]    = useState<string | null>(null);
  // Vertical anchor of the block top, shown as a whole-number percentage.
  const [topPct,       setTopPct]       = useState(15);

  const trimStartRef    = useRef(0);
  const trimEndRef      = useRef(0);
  const durRef          = useRef(0);
  const timelineZoomRef = useRef(1.0);
  const segmentsRef     = useRef<Segment[]>([]);
  const dragSegRef      = useRef<{
    segId: string;
    mode: 'body' | 'trimStart' | 'trimEnd';
    origVisualStart: number;  // for body drag: visual start at pointer-down
    anchorTime: number;       // pointer-down time position
  } | null>(null);

  const filmstripRef = useRef<HTMLDivElement>(null);
  const activeRefRef = useRef(activeRef);

  // Keep activeRefRef current every render so callbacks always see the latest ref
  // without causing effects to re-fire on every identity change.
  activeRefRef.current = activeRef;

  useEffect(() => { timelineZoomRef.current = timelineZoom; }, [timelineZoom]);
  useEffect(() => { segmentsRef.current     = segments;     }, [segments]);

  // hasRef is true/false — only flips when the ref appears or disappears,
  // not when the underlying handle object is recreated by useImperativeHandle.
  const hasRef = !!activeRef;

  // ── Entry change ──────────────────────────────────────────────────────────
  // Depends on entryId (new video selected) and hasRef (ref first became available).
  // Does NOT depend on activeRef identity so zoom/caption/settings changes in the
  // canvas don't re-trigger this and wipe the thumbnail strip.
  useEffect(() => {
    const ref = activeRefRef.current;
    if (!ref) return;
    const state = ref.getTrimState();
    setTopPct(Math.round((state.blockTopPct ?? 0.15) * 100));
    setFrames([]); setTimelineZoom(1.0); timelineZoomRef.current = 1.0;
    setSelection(null);
    setSegments([]); segmentsRef.current = [];
    setDuration(0); setCurrentTime(0); setIsPlaying(false);

    const v = ref.getVideoElement();
    const d = (v && v.duration && isFinite(v.duration)) ? v.duration
            : state.duration > 0 ? state.duration : 0;

    if (d > 0) {
      durRef.current = d;
      trimStartRef.current = 0; trimEndRef.current = d;
      setDuration(d);
      const s = [mkSeg(0, d, d)];
      setSegments(s); segmentsRef.current = s;
    }
    if (v) { setIsPlaying(!v.paused); setCurrentTime(v.currentTime); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, hasRef]);

  // ── Live video events ─────────────────────────────────────────────────────
  // Same reasoning: attach once per entry, not on every ref identity change.
  useEffect(() => {
    const ref = activeRefRef.current;
    if (!ref) return;
    const v = ref.getVideoElement();
    if (!v) return;
    const onPlay  = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTime  = () => {
      const ct = v.currentTime;
      setCurrentTime(ct);
      if (!v.paused) {
        const sorted = [...segmentsRef.current].sort((a, b) => a.start - b.start);
        if (sorted.length > 0) {
          const inSeg = sorted.some(s => ct >= s.start - 0.02 && ct < s.end);
          if (!inSeg) {
            const next = sorted.find(s => s.start > ct);
            if (next) v.currentTime = next.start;
            else if (ct < sorted[0].start) v.currentTime = sorted[0].start;
          }
        }
      }
    };
    const onDur = () => {
      if (!v.duration || !isFinite(v.duration)) return;
      const d = v.duration;
      durRef.current = d; trimEndRef.current = d;
      setDuration(d);
      const segs = segmentsRef.current;
      if (segs.length === 0) {
        const s = [mkSeg(0, d, d)];
        setSegments(s); segmentsRef.current = s;
      } else if (segs.length === 1 && segs[0].start === 0) {
        const s = [{ ...segs[0], end: d, li: FRAME_COUNT }];
        setSegments(s); segmentsRef.current = s;
      }
    };
    v.addEventListener('play', onPlay); v.addEventListener('pause', onPause);
    v.addEventListener('timeupdate', onTime); v.addEventListener('durationchange', onDur);
    // If duration already loaded before we attached the listener, fire now
    if (v.readyState >= 1 && v.duration && isFinite(v.duration)) onDur();
    return () => {
      v.removeEventListener('play', onPlay); v.removeEventListener('pause', onPause);
      v.removeEventListener('timeupdate', onTime); v.removeEventListener('durationchange', onDur);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, hasRef]);

  // ── Frame extraction ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!videoSrc || duration <= 0) return;
    const src: string = videoSrc;
    setFrames([]); let cancelled = false;
    let blobUrl = '';
    const vid = document.createElement('video');
    vid.muted = true; vid.preload = 'auto'; vid.playsInline = true;
    const off = document.createElement('canvas'); off.height = STRIP_H;
    const results: string[] = new Array(FRAME_COUNT).fill('');

    async function extract() {
      try {
        const resp = await fetch(src);
        if (cancelled) return;
        blobUrl = URL.createObjectURL(await resp.blob());
        vid.src = blobUrl;
      } catch {
        vid.crossOrigin = 'anonymous';
        vid.src = src;
      }
      await new Promise<void>((res, rej) => {
        const onErr = () => rej(new Error('load failed'));
        if (vid.readyState >= 1) { vid.removeEventListener('error', onErr); res(); return; }
        vid.addEventListener('loadedmetadata', () => { vid.removeEventListener('error', onErr); res(); }, { once: true });
        vid.addEventListener('error', onErr, { once: true });
      }).catch(() => null);
      if (cancelled || !vid.videoWidth) return;
      off.width = Math.round(STRIP_H * (vid.videoWidth / vid.videoHeight));
      const ctx = off.getContext('2d')!;
      for (let i = 0; i < FRAME_COUNT; i++) {
        if (cancelled) break;
        const t = (i / (FRAME_COUNT - 1)) * duration;
        await new Promise<void>(res => {
          const onS = () => {
            vid.removeEventListener('seeked', onS);
            try { ctx.drawImage(vid, 0, 0, off.width, STRIP_H); results[i] = off.toDataURL('image/jpeg', 0.65); }
            catch { /* tainted */ }
            if (!cancelled && (i % 4 === 3 || i === FRAME_COUNT - 1)) setFrames([...results]);
            res();
          };
          vid.addEventListener('seeked', onS);
          vid.currentTime = t;
        });
      }
      if (!cancelled) { vid.src = ''; if (blobUrl) URL.revokeObjectURL(blobUrl); }
    }
    extract().catch(() => null);
    return () => { cancelled = true; vid.src = ''; if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [entryId, videoSrc, duration]);

  // ── Drag helpers ──────────────────────────────────────────────────────────
  const pctFrom = useCallback((ref: React.RefObject<HTMLDivElement | null>, clientX: number) => {
    const el = ref.current; if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width / timelineZoomRef.current));
  }, []);

  // Background click seeks and deselects
  const onVideoPointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelection(null);
    activeRefRef.current?.seekTo(pctFrom(filmstripRef, e.clientX) * durRef.current);
  }, [pctFrom]);
  const onVideoPointerMove = useCallback((e: React.PointerEvent) => {
    if (e.buttons === 0) return;
    activeRefRef.current?.seekTo(pctFrom(filmstripRef, e.clientX) * durRef.current);
  }, [pctFrom]);

  // Body drag: only moves displayOffset — source start/end/fi/li never change
  const onSegBodyDown = useCallback((e: React.PointerEvent) => {
    const segId = (e.currentTarget as HTMLElement).dataset.segId ?? '';
    const seg = segmentsRef.current.find(s => s.id === segId); if (!seg) return;
    e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    setSelection(segId);
    dragSegRef.current = {
      segId, mode: 'body',
      origVisualStart: seg.start + seg.displayOffset,
      anchorTime: pctFrom(filmstripRef, e.clientX) * durRef.current,
    };
  }, [pctFrom]);

  const onSegTrimStartDown = useCallback((e: React.PointerEvent) => {
    const segId = (e.currentTarget as HTMLElement).dataset.segId ?? '';
    const seg = segmentsRef.current.find(s => s.id === segId); if (!seg) return;
    e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    dragSegRef.current = { segId, mode: 'trimStart', origVisualStart: 0, anchorTime: 0 };
  }, []);

  const onSegTrimEndDown = useCallback((e: React.PointerEvent) => {
    const segId = (e.currentTarget as HTMLElement).dataset.segId ?? '';
    const seg = segmentsRef.current.find(s => s.id === segId); if (!seg) return;
    e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    dragSegRef.current = { segId, mode: 'trimEnd', origVisualStart: 0, anchorTime: 0 };
  }, []);

  const onSegMove = useCallback((e: React.PointerEvent) => {
    if (e.buttons === 0 || !dragSegRef.current) return;
    e.stopPropagation();
    const { segId, mode, origVisualStart, anchorTime } = dragSegRef.current;
    const segs = segmentsRef.current;
    const idx = segs.findIndex(s => s.id === segId); if (idx < 0) return;
    const seg = segs[idx];
    const t = pctFrom(filmstripRef, e.clientX) * durRef.current;
    let newSeg = { ...seg };

    if (mode === 'body') {
      // Pure visual shift — source start/end/fi/li untouched
      const dur = seg.end - seg.start;
      let newVS = origVisualStart + (t - anchorTime);
      newVS = Math.max(0, Math.min(durRef.current - dur, newVS));

      // Prevent overlap with other segments
      const prevVS = seg.start + seg.displayOffset;
      const others = segs
        .filter(s => s.id !== segId)
        .map(s => ({ vs: s.start + s.displayOffset, ve: s.end + s.displayOffset }))
        .sort((a, b) => a.vs - b.vs);

      for (const other of others) {
        if (newVS < other.ve && newVS + dur > other.vs) {
          // Moving right → snap left edge to other's left edge
          // Moving left  → snap right edge to other's right edge
          newVS = newVS >= prevVS ? other.vs - dur : other.ve;
          newVS = Math.max(0, Math.min(durRef.current - dur, newVS));
        }
      }

      newSeg = { ...seg, displayOffset: newVS - seg.start };
      const newSegs = segs.map(s => s.id === segId ? newSeg : s);
      setSegments(newSegs); segmentsRef.current = newSegs;
      return; // no trim range change
    }

    // Trim: visual time → source time (subtract displayOffset)
    const sourceT = t - seg.displayOffset;
    const prev = idx > 0 ? segs[idx - 1] : null;
    const next = idx < segs.length - 1 ? segs[idx + 1] : null;

    if (mode === 'trimStart') {
      const minT = prev ? prev.end : 0;
      newSeg = { ...seg, start: Math.max(minT, Math.min(sourceT, seg.end - 0.1)) };
      activeRefRef.current?.seekTo(newSeg.start);
    } else {
      const maxT = next ? next.start : durRef.current;
      newSeg = { ...seg, end: Math.max(seg.start + 0.1, Math.min(sourceT, maxT)) };
    }

    const newSegs = segs.map(s => s.id === segId ? newSeg : s);
    setSegments(newSegs); segmentsRef.current = newSegs;
    const sorted = [...newSegs].sort((a, b) => a.start - b.start);
    trimStartRef.current = sorted[0].start; trimEndRef.current = sorted[sorted.length - 1].end;
    activeRefRef.current?.setTrimRange(trimStartRef.current, trimEndRef.current);
  }, [pctFrom]);

  // Playhead drag
  const onPlayheadDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    activeRefRef.current?.seekTo(pctFrom(filmstripRef, e.clientX) * durRef.current);
  }, [pctFrom]);
  const onPlayheadMove = useCallback((e: React.PointerEvent) => {
    if (e.buttons === 0) return; e.stopPropagation();
    activeRefRef.current?.seekTo(pctFrom(filmstripRef, e.clientX) * durRef.current);
  }, [pctFrom]);

  // ── Guard ─────────────────────────────────────────────────────────────────
  if (!activeRef || duration <= 0) return null;

  const isRecording = recordingState?.isRecording ?? false;
  const recProgress = recordingState?.recProgress ?? 0;
  const recStatus   = recordingState?.recStatus   ?? '';

  const sortedSegs = [...segments].sort((a, b) => a.start - b.start);
  const trimStart  = sortedSegs[0]?.start ?? 0;
  const trimEnd    = sortedSegs[sortedSegs.length - 1]?.end ?? duration;
  const tunnelW    = (1 - timelineZoom) * 100;
  const curPct     = Math.min((currentTime / duration) * timelineZoom * 100, timelineZoom * 100);

  function cutAtPlayhead() {
    const v = activeRefRef.current?.getVideoElement();
    const t = v ? v.currentTime : currentTime;
    const segs = segmentsRef.current;
    const idx = segs.findIndex(s => t > s.start + 0.05 && t < s.end - 0.05);
    if (idx < 0) return;
    const seg = segs[idx];
    const d = durRef.current;
    const newSegs: Segment[] = [
      ...segs.slice(0, idx),
      { id: `${seg.id}a`, start: seg.start, end: t,       fi: seg.fi,                            li: Math.ceil((t / d) * FRAME_COUNT),  displayOffset: 0 },
      { id: `${seg.id}b`, start: t,         end: seg.end, fi: Math.floor((t / d) * FRAME_COUNT), li: seg.li,                            displayOffset: 0 },
      ...segs.slice(idx + 1),
    ];
    setSegments(newSegs); segmentsRef.current = newSegs;
  }

  function removeSegment(segId: string) {
    const segs = segmentsRef.current;
    if (segs.length <= 1) return;
    const newSegs = segs.filter(s => s.id !== segId);
    if (newSegs.length === 0) return;
    const sorted = [...newSegs].sort((a, b) => a.start - b.start);
    setSegments(newSegs); segmentsRef.current = newSegs;
    trimStartRef.current = sorted[0].start; trimEndRef.current = sorted[sorted.length - 1].end;
    activeRefRef.current?.setTrimRange(trimStartRef.current, trimEndRef.current);
    const v = activeRefRef.current?.getVideoElement();
    if (v) {
      const ct = v.currentTime;
      const inSeg = sorted.some(s => ct >= s.start && ct <= s.end);
      if (!inSeg) {
        const next = sorted.find(s => s.start > ct);
        activeRefRef.current?.seekTo(next ? next.start : sorted[0].start);
      }
    }
  }

  const canDelete = selection !== null && segments.length > 1;

  return (
    <div className="shrink-0 mx-3 mb-3 rounded-lg border border-zinc-800 bg-zinc-950 px-5 py-3 flex flex-col gap-2">

      {/* ── Transport row ─────────────────────────────────────────────────── */}
      <div className="flex items-center">
        <div className="flex-1 flex items-center gap-2">
          <button onClick={cutAtPlayhead}
            className="flex items-center justify-center w-7 h-7 text-zinc-400 hover:text-white transition-colors"
            title="Cut at playhead">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
              <line x1="20" y1="4" x2="8.12" y2="15.88"/>
              <line x1="14.47" y1="14.48" x2="20" y2="20"/>
              <line x1="8.12" y1="8.12" x2="12" y2="12"/>
            </svg>
          </button>
          <button
            onClick={() => { if (!selection || !canDelete) return; removeSegment(selection); setSelection(null); }}
            disabled={!canDelete}
            className="flex items-center justify-center w-7 h-7 text-zinc-400 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Delete selected clip">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              <line x1="10" y1="11" x2="10" y2="17"/>
              <line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
          </button>
          {selection && <span className="text-[10px] text-zinc-600 tabular-nums">Clip selected</span>}
        </div>

        <div className="flex items-center gap-3">
          <button onClick={() => activeRef.seekTo(trimStart)}
            className="flex items-center justify-center w-7 h-7 text-zinc-400 hover:text-white transition-colors" title="Go to start">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="4" y="4" width="2.5" height="16" rx="1"/>
              <polygon points="20,4 8,12 20,20"/>
            </svg>
          </button>
          <button onClick={() => isPlaying ? activeRef.pause() : activeRef.play()}
            className="flex items-center justify-center w-7 h-7 text-zinc-400 hover:text-white transition-colors">
            {isPlaying
              ? <svg width="10" height="10" viewBox="0 0 10 12" fill="currentColor"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>
              : <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><polygon points="2,0 12,6 2,12"/></svg>}
          </button>
          <button onClick={() => activeRef.seekTo(trimEnd)}
            className="flex items-center justify-center w-7 h-7 text-zinc-400 hover:text-white transition-colors" title="Go to end">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="17.5" y="4" width="2.5" height="16" rx="1"/>
              <polygon points="4,4 16,12 4,20"/>
            </svg>
          </button>
          <span className="text-[11px] text-zinc-500 tabular-nums ml-1">
            {fmtTime(currentTime)} / {fmtTime(duration)}
          </span>
        </div>

        <div className="flex-1 flex items-center justify-end gap-2">
          <button
            onClick={() => { const n = Math.max(0.1, +(timelineZoom - 0.05).toFixed(2)); setTimelineZoom(n); timelineZoomRef.current = n; }}
            disabled={timelineZoom <= 0.1}
            className="text-zinc-500 hover:text-zinc-300 disabled:opacity-30 transition-colors">
            <svg width="12" height="12" viewBox="0 0 12 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="1" y1="1" x2="11" y2="1"/></svg>
          </button>
          <input type="range" min={10} max={100} step={5} value={Math.round(timelineZoom * 100)}
            onChange={e => { const n = parseInt(e.target.value) / 100; setTimelineZoom(n); timelineZoomRef.current = n; }}
            className="w-24 h-1 accent-white cursor-pointer" />
          <button
            onClick={() => { const n = Math.min(1.0, +(timelineZoom + 0.05).toFixed(2)); setTimelineZoom(n); timelineZoomRef.current = n; }}
            disabled={timelineZoom >= 1.0}
            className="text-zinc-500 hover:text-zinc-300 disabled:opacity-30 transition-colors">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="6" y1="1" x2="6" y2="11"/><line x1="1" y1="6" x2="11" y2="6"/></svg>
          </button>
        </div>
      </div>

      {/* ── Time ruler ───────────────────────────────────────────────────── */}
      {(() => {
        const maj = duration <= 8 ? 1 : duration <= 20 ? 2 : duration <= 60 ? 5 : duration <= 120 ? 10 : duration <= 300 ? 30 : 60;
        const min = maj / 4;
        const majT: number[] = []; for (let t = 0; t <= duration; t += maj) majT.push(+t.toFixed(4));
        const minT: number[] = []; for (let t = min; t < duration; t += min) { const s = +t.toFixed(4); if (!majT.some(m => Math.abs(m - s) < 0.01)) minT.push(s); }
        return (
          <div className="relative w-full select-none pointer-events-none" style={{ height: 20 }}>
            {minT.map(t => (
              <div key={t} className="absolute bottom-0" style={{ left: `${(t / duration) * timelineZoom * 100}%` }}>
                <div className="w-px bg-zinc-700" style={{ height: 5 }} />
              </div>
            ))}
            {majT.map((t, i) => {
              const pct = (t / duration) * timelineZoom * 100;
              const isFirst = i === 0; const isLast = t >= duration - 0.01;
              return (
                <div key={t} className="absolute bottom-0 flex flex-col items-center" style={{ left: `${pct}%` }}>
                  <span className="text-[9px] text-zinc-600 tabular-nums leading-none mb-[3px] whitespace-nowrap"
                    style={{ transform: isFirst ? 'translateX(0)' : isLast ? 'translateX(-100%)' : 'translateX(-50%)' }}>
                    {fmtTime(t)}
                  </span>
                  <div className="w-px bg-zinc-600" style={{ height: 8 }} />
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ── Combined strip ───────────────────────────────────────────────── */}
      <div ref={filmstripRef} className="relative w-full select-none rounded-md overflow-hidden" style={{ height: STRIP_H }}
        onPointerDown={onVideoPointerDown} onPointerMove={onVideoPointerMove}>

        <div className="absolute top-0 left-0 bottom-0 bg-zinc-950 pointer-events-none"
          style={{ width: `${timelineZoom * 100}%`, borderRadius: tunnelW > 0 ? '6px 0 0 6px' : '6px' }} />

        {sortedSegs.map(seg => {
          // Visual position uses displayOffset; width stays based on source duration
          const visualStart = seg.start + seg.displayOffset;
          const lp = (visualStart / duration) * timelineZoom * 100;
          const wp = ((seg.end - seg.start) / duration) * timelineZoom * 100;
          return (
            <SegmentBody key={seg.id} segId={seg.id} leftPct={lp} widthPct={wp}
              segFrames={frames.slice(seg.fi, Math.min(seg.li, FRAME_COUNT))}
              isSelected={selection === seg.id}
              onDown={onSegBodyDown} onMove={onSegMove}
            />
          );
        })}

        {sortedSegs.map(seg => {
          const visualStart = seg.start + seg.displayOffset;
          const startLeft = (visualStart / duration) * timelineZoom * 100;
          const endLeft   = ((visualStart + seg.end - seg.start) / duration) * timelineZoom * 100;
          return (
            <Fragment key={`h-${seg.id}`}>
              <SegTrimStart segId={seg.id} left={startLeft} onDown={onSegTrimStartDown} onMove={onSegMove} />
              <SegTrimEnd   segId={seg.id} left={endLeft}   onDown={onSegTrimEndDown}   onMove={onSegMove} />
            </Fragment>
          );
        })}

        <PlayheadHandle left={curPct} onDown={onPlayheadDown} onMove={onPlayheadMove} />

        {tunnelW > 0 && (
          <div className="absolute top-0 right-0 bottom-0 bg-zinc-950 border-l-2 border-zinc-700/50 pointer-events-none"
            style={{ width: `${tunnelW}%`, borderRadius: '0 6px 6px 0' }} />
        )}
      </div>

      {/* ── Bottom controls ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <span className="text-[10px] text-zinc-600 tabular-nums">{fmtTime(trimStart)}–{fmtTime(trimEnd)}</span>
        <button
          onClick={() => {
            const d = durRef.current; activeRef.resetTrim();
            trimStartRef.current = 0; trimEndRef.current = d;
            const s = [mkSeg(0, d, d)];
            setSegments(s); segmentsRef.current = s;
            setSelection(null);
          }}
          className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">Reset trim</button>
        <div className="w-px h-3 bg-zinc-800" />
        <button onClick={() => activeRef.resetBox()}  className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">Reset box</button>
        {activeRef.setBlockTopPct && (
          <label className="flex items-center gap-1 text-[10px] text-zinc-600" title="Distance of the block's top edge from the top of the frame">
            <span>Top</span>
            <input
              type="number" min={0} max={100} step={1}
              value={topPct}
              onChange={e => {
                const n = Math.max(0, Math.min(100, parseInt(e.target.value || '0', 10) || 0));
                setTopPct(n);
                activeRef.setBlockTopPct?.(n / 100);
              }}
              className="w-10 bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-zinc-300 text-right tabular-nums outline-none focus:border-zinc-600"
            />
            <span>%</span>
          </label>
        )}
        <div className="flex-1" />
        {isRecording ? (
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-28 h-1 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full bg-[#fe2c55] transition-all duration-100" style={{ width: `${Math.round(recProgress * 100)}%` }} />
            </div>
            <span className="text-[10px] text-zinc-500 tabular-nums">{recStatus || `${Math.round(recProgress * 100)}%`}</span>
            <button onClick={() => activeRef.cancelExport()} className="text-[10px] text-red-400 hover:text-red-300 transition-colors">Cancel</button>
          </div>
        ) : (
          <button onClick={() => activeRef.startDownload()}
            className="flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black hover:bg-zinc-100 transition-colors shrink-0">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="4"/>
            </svg>
            Export
          </button>
        )}
      </div>

    </div>
  );
}
