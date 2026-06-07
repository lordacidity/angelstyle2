import { useEffect, useRef, useState } from 'react';
import { fmt } from '../api.js';

/**
 * One unified trim timeline:
 *  - drag the START or END handle → the video seeks live so you see that frame
 *  - click/drag anywhere on the track → scrub to preview
 *  - Play → loops the kept [start,end] region
 *
 * Props: videoRef (ref to the <video>), duration, start, end, onChange(start,end)
 */
export default function TimelineTrimmer({ videoRef, duration, start, end, onChange }) {
  const trackRef = useRef(null);
  const dragRef = useRef(null); // 'start' | 'end' | 'scrub'
  const [playhead, setPlayhead] = useState(start);
  const [playing, setPlaying] = useState(false);

  const pct = (t) => (duration ? (t / duration) * 100 : 0);

  function timeFromX(clientX) {
    const r = trackRef.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return ratio * duration;
  }

  function seek(t) {
    if (videoRef.current) videoRef.current.currentTime = t;
    setPlayhead(t);
  }

  function applyMove(clientX) {
    const t = timeFromX(clientX);
    const d = dragRef.current;
    if (!d) return;
    const { mode, limit } = d;
    if (mode === 'start') {
      // can't cross the playhead barrier (where playback is paused)
      const ns = Math.max(0, Math.min(t, end - 0.05, limit));
      onChange(ns, end);
      seek(ns);
    } else if (mode === 'end') {
      const ne = Math.min(duration, Math.max(t, start + 0.05, limit));
      onChange(start, ne);
      seek(ne);
    } else {
      seek(Math.min(end, Math.max(start, t)));
    }
  }

  const winMove = (e) => applyMove(e.clientX);
  const winUp = () => {
    dragRef.current = null;
    window.removeEventListener('pointermove', winMove);
    window.removeEventListener('pointerup', winUp);
  };

  function startDrag(e, mode) {
    e.preventDefault();
    e.stopPropagation();
    const v = videoRef.current;
    if (v && !v.paused) { v.pause(); setPlaying(false); }
    // freeze the current playhead as a barrier the handles can't cross.
    // scrub has no barrier (it's how you reposition the playhead).
    const head = v ? v.currentTime : playhead;
    dragRef.current = { mode, limit: mode === 'scrub' ? undefined : head };
    applyMove(e.clientX);
    window.addEventListener('pointermove', winMove);
    window.addEventListener('pointerup', winUp);
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < start || v.currentTime >= end - 0.02) v.currentTime = start;
      v.play(); setPlaying(true);
    } else {
      v.pause(); setPlaying(false);
    }
  }

  // keep playhead synced while playing, and loop within the kept region
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      if (v.currentTime >= end) { v.currentTime = start; }
      setPlayhead(v.currentTime);
    };
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('pause', onPause);
    v.addEventListener('play', onPlay);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('play', onPlay);
    };
  }, [videoRef, start, end]);

  return (
    <div className="trim">
      <div className="row between" style={{ marginBottom: 8 }}>
        <button className="btn" onClick={togglePlay}>{playing ? '⏸ Pause' : '▶ Play kept region'}</button>
        <span className="readout"><b>{fmt(playhead)}</b> / {fmt(duration)}</span>
      </div>

      <div className="trim-track" ref={trackRef} onPointerDown={(e) => startDrag(e, 'scrub')}>
        {/* dim the trimmed-away parts */}
        <div className="trim-cut" style={{ left: 0, width: pct(start) + '%' }} />
        <div className="trim-cut" style={{ right: 0, width: 100 - pct(end) + '%' }} />
        {/* kept region */}
        <div className="trim-keep" style={{ left: pct(start) + '%', width: pct(end) - pct(start) + '%' }} />
        <div className="trim-playhead" style={{ left: pct(playhead) + '%' }} />
        <div className="trim-handle" style={{ left: pct(start) + '%' }} onPointerDown={(e) => startDrag(e, 'start')}>
          <span className="lbl">{fmt(start)}</span>
        </div>
        <div className="trim-handle" style={{ left: pct(end) + '%' }} onPointerDown={(e) => startDrag(e, 'end')}>
          <span className="lbl">{fmt(end)}</span>
        </div>
      </div>

      <p className="readout" style={{ marginTop: 10 }}>
        Kept clip: <b>{fmt(start)} → {fmt(end)}</b> &nbsp;({fmt(end - start)}) — drag the blue handles, scrub to preview.
      </p>
    </div>
  );
}
