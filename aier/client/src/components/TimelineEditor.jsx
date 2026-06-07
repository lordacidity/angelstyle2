import { useEffect, useMemo, useRef, useState } from 'react';
import { api, pollJob, fmt } from '../api.js';
import { ProgressOverlay, Banner } from './ui.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// A small, precise multi-track editor. The picture is the VIDEO lane: an ordered,
// gapless row of clips. ALL sound lives on the AUDIO lane as freely-placed items —
// a clip's own audio is "linked" (auto-included, moves with the clip) until you
// Detach it, after which it's an independent item you can move/trim/gain.
//
// Nothing here is authoritative — the browser preview is a convenience. On Render we
// hand the EDL to the backend (server/lib/render.js) which renders it frame-exact
// with ffmpeg. So every number shown is snapped to the frame grid before it ships.
// ─────────────────────────────────────────────────────────────────────────────

let _id = 0;
const uid = (p) => `${p}${++_id}`;

// Build the derived timeline from the two edit lists: clip start/duration (gapless),
// the effective audio items (linked clip audio + free items), and the total length.
function buildTimeline(clips, freeAudio, fps) {
  let t = 0;
  const laidClips = clips.map((c) => {
    const outDur = Math.max(1 / fps, (c.out - c.in) / c.speed);
    const item = { ...c, start: t, outDur };
    t += outDur;
    return item;
  });
  const total = t;

  const audioItems = [];
  for (const c of laidClips) {
    if (c.hasAudio && !c.audioDetached && !c.muted) {
      audioItems.push({
        id: `lk_${c.id}`, linked: c.id, src: c.src, label: `${c.label} · audio`,
        in: c.in, out: c.out, speed: c.speed, start: c.start,
        outDur: c.outDur, gain: c.gain ?? 1, srcDuration: c.srcDuration,
      });
    }
  }
  for (const a of freeAudio) {
    audioItems.push({ ...a, linked: null, outDur: Math.max(1 / fps, (a.out - a.in) / a.speed) });
  }
  return { laidClips, audioItems, total };
}

// Greedy-pack audio items into non-overlapping display rows (purely visual; the mix
// happily overlaps).
function packRows(items) {
  const rows = [];
  for (const a of [...items].sort((x, y) => x.start - y.start)) {
    let placed = false;
    for (const row of rows) {
      const last = row[row.length - 1];
      if (last.start + last.outDur <= a.start + 1e-3) { row.push(a); placed = true; break; }
    }
    if (!placed) rows.push([a]);
  }
  return rows;
}

export default function TimelineEditor({ projectId, fps = 30, seed = {}, onBack }) {
  const FRAME = 1 / fps;
  const snap = (t) => Math.round((Number(t) || 0) * fps) / fps;

  const [assets, setAssets] = useState(null);
  const [error, setError] = useState(null);
  const [clips, setClips] = useState(null); // ordered video lane
  const [freeAudio, setFreeAudio] = useState([]); // independent audio items
  const [sel, setSel] = useState(null); // { kind:'video'|'audio', id }
  const [pxPerSec, setPxPerSec] = useState(90);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);

  const [busy, setBusy] = useState(null);
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState([]);
  const [final, setFinal] = useState(null);

  const videoRef = useRef(null);
  const contentRef = useRef(null);
  const audioEls = useRef(new Map()); // id -> HTMLAudioElement
  const tp = useRef({ playing: false, t: 0, baseWall: 0, baseT: 0, raf: 0 });
  const tlRef = useRef({ laidClips: [], audioItems: [], total: 0 });

  // ── load assets + seed the initial two-clip timeline ──────────────────────
  useEffect(() => {
    let alive = true;
    api.renderAssets(projectId).then((a) => {
      if (!alive) return;
      setAssets(a);
      const real = a.clips.find((c) => /real/i.test(c.label)) || a.clips[0];
      const ai = a.clips.find((c) => /kling|ai/i.test(c.label)) || a.clips[1];
      const init = [];
      if (real) init.push(mkClip(real, {
        label: 'Real', in: snap(seed.trimStart ?? 0),
        out: snap(seed.takeover ?? real.duration), crop: seed.crop || null,
      }));
      if (ai) init.push(mkClip(ai, {
        label: 'AI (you)', in: snap(FRAME), // skip the duplicate seed frame
        out: snap(seed.klingEnd ?? ai.duration),
      }));
      setClips(init.filter((c) => c.out > c.in + 1e-6)); // drop a degenerate (zero-length) seed clip
    }).catch((e) => setError(e.message));
    return () => { alive = false; stopTransport(); audioEls.current.forEach((el) => el.pause()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function mkClip(asset, over) {
    return {
      id: uid('v'), src: asset.src, srcDuration: asset.duration || 0,
      hasAudio: !!asset.hasAudio, in: 0, out: asset.duration || 0,
      speed: 1, crop: null, gain: 1, muted: false, audioDetached: false, ...over,
    };
  }

  const tl = useMemo(
    () => buildTimeline(clips || [], freeAudio, fps),
    [clips, freeAudio, fps],
  );
  tlRef.current = tl;
  const { laidClips, audioItems, total } = tl;
  const contentW = Math.max(640, total * pxPerSec + 40);
  const xToTime = (clientX) => {
    const r = contentRef.current?.getBoundingClientRect();
    if (!r) return 0;
    return Math.max(0, snap((clientX - r.left) / pxPerSec));
  };

  // ── preview engine ────────────────────────────────────────────────────────
  function ensureAudioEl(a) {
    let el = audioEls.current.get(a.id);
    if (!el) { el = new Audio(a.src); el.preload = 'auto'; audioEls.current.set(a.id, el); }
    return el;
  }

  function drive(t, isPlaying) {
    const { laidClips: lc, audioItems: ai, total: tot } = tlRef.current;
    // picture
    const v = videoRef.current;
    const clip = lc.find((c) => t >= c.start && t < c.start + c.outDur) || (t >= tot ? lc[lc.length - 1] : lc[0]);
    if (v && clip) {
      if (v.dataset.src !== clip.src) { v.src = clip.src; v.dataset.src = clip.src; }
      const want = Math.max(0, clip.in + (t - clip.start) * clip.speed);
      // when paused, snap exactly to the frame; while playing only correct real drift
      if (Math.abs(v.currentTime - want) > (isPlaying ? 0.25 : 0.001)) {
        try { v.currentTime = want; } catch {}
      }
      v.playbackRate = clip.speed;
      if (isPlaying && v.paused) v.play().catch(() => {});
      if (!isPlaying && !v.paused) v.pause();
    }
    // sound — every audio file is muted on the <video>; it plays through its own element
    if (v) v.muted = true;
    for (const a of ai) {
      const el = ensureAudioEl(a);
      const inWin = t >= a.start && t < a.start + a.outDur - 1e-3;
      const want = a.in + Math.max(0, t - a.start) * a.speed;
      el.playbackRate = a.speed;
      el.volume = Math.min(1, a.gain); // >100% only fully applies on render
      if (inWin && isPlaying) {
        if (el.paused) { try { el.currentTime = want; } catch {} el.play().catch(() => {}); }
        else if (Math.abs(el.currentTime - want) > 0.2) { try { el.currentTime = want; } catch {} }
      } else if (!el.paused) {
        el.pause();
      }
    }
  }

  function frameLoop(now) {
    const s = tp.current;
    const t = s.baseT + (now - s.baseWall) / 1000;
    if (t >= tlRef.current.total) {
      pauseAt(tlRef.current.total);
      return;
    }
    s.t = t; setPlayhead(t); drive(t, true);
    s.raf = requestAnimationFrame(frameLoop);
  }

  function play() {
    if (total <= 0) return;
    const s = tp.current;
    s.baseT = playhead >= total - 1e-3 ? 0 : playhead;
    s.baseWall = performance.now();
    s.playing = true; setPlaying(true);
    s.raf = requestAnimationFrame(frameLoop);
  }
  function pauseAt(t) {
    const s = tp.current;
    cancelAnimationFrame(s.raf);
    s.playing = false; setPlaying(false);
    if (t != null) { s.t = t; setPlayhead(t); }
    drive(s.t, false);
  }
  function stopTransport() { cancelAnimationFrame(tp.current.raf); tp.current.playing = false; }
  function seek(t) {
    const c = Math.max(0, Math.min(total, snap(t)));
    const s = tp.current; s.t = c; s.baseT = c; s.baseWall = performance.now();
    setPlayhead(c); drive(c, s.playing);
  }
  function togglePlay() { tp.current.playing ? pauseAt(null) : play(); }
  function nudge(d) { seek(playhead + d); }

  // keep the picture synced when edits change geometry while paused
  useEffect(() => { if (!tp.current.playing) drive(Math.min(playhead, total), false); });

  // ── editing ops ───────────────────────────────────────────────────────────
  const patchClip = (id, p) => setClips((cs) => cs.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const patchAudio = (id, p) => setFreeAudio((as) => as.map((a) => (a.id === id ? { ...a, ...p } : a)));
  const selClip = sel?.kind === 'video' ? laidClips.find((c) => c.id === sel.id) : null;
  const selAudio = sel?.kind === 'audio' ? audioItems.find((a) => a.id === sel.id) : null;

  function addClip(asset) {
    setClips((cs) => [...cs, mkClip(asset, { label: asset.label.replace(/\s*\(.*\)/, '') })]);
  }
  function addAudio(lib) {
    const a = {
      id: uid('a'), src: lib.src, label: lib.label, srcDuration: lib.duration || 0,
      in: 0, out: lib.duration || 0, speed: 1, start: snap(playhead), gain: 1,
    };
    setFreeAudio((as) => [...as, a]);
    setSel({ kind: 'audio', id: a.id });
  }
  function removeSelected() {
    if (!sel) return;
    if (sel.kind === 'video') setClips((cs) => cs.filter((c) => c.id !== sel.id));
    else setFreeAudio((as) => as.filter((a) => a.id !== sel.id));
    setSel(null);
  }
  function reorder(id, dir) {
    setClips((cs) => {
      const i = cs.findIndex((c) => c.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= cs.length) return cs;
      const next = [...cs]; [next[i], next[j]] = [next[j], next[i]]; return next;
    });
  }
  function detachAudio(clip) {
    // snapshot the clip's current audio as an independent item, then stop auto-linking it
    const a = {
      id: uid('a'), src: clip.src, label: `${clip.label} audio`, srcDuration: clip.srcDuration,
      in: clip.in, out: clip.out, speed: clip.speed, start: clip.start, gain: clip.gain ?? 1,
    };
    setFreeAudio((as) => [...as, a]);
    patchClip(clip.id, { audioDetached: true });
    setSel({ kind: 'audio', id: a.id });
  }
  function splitAtPlayhead() {
    const t = playhead;
    if (sel?.kind === 'video') {
      const c = laidClips.find((x) => x.id === sel.id);
      if (!c || t <= c.start + FRAME || t >= c.start + c.outDur - FRAME) return;
      const cutSrc = snap(c.in + (t - c.start) * c.speed); // source time at the cut
      setClips((cs) => {
        const i = cs.findIndex((x) => x.id === c.id);
        const left = { ...cs[i], out: cutSrc };
        const right = { ...cs[i], id: uid('v'), in: cutSrc };
        const next = [...cs]; next.splice(i, 1, left, right); return next;
      });
    } else if (sel?.kind === 'audio') {
      const a = audioItems.find((x) => x.id === sel.id);
      if (!a || a.linked || t <= a.start + FRAME || t >= a.start + a.outDur - FRAME) return;
      const cutSrc = snap(a.in + (t - a.start) * a.speed);
      setFreeAudio((as) => {
        const i = as.findIndex((x) => x.id === a.id);
        const left = { ...as[i], out: cutSrc };
        const right = { ...as[i], id: uid('a'), in: cutSrc, start: snap(t) };
        const next = [...as]; next.splice(i, 1, left, right); return next;
      });
    }
  }

  // ── pointer drags (trim handles, move, reorder) ───────────────────────────
  const drag = useRef(null);
  function onPointerDownClip(e, clip, mode) {
    e.preventDefault(); e.stopPropagation();
    if (tp.current.playing) pauseAt(null);
    setSel({ kind: 'video', id: clip.id });
    drag.current = { kind: 'video', mode, id: clip.id, x0: e.clientX, snap: { ...clip } };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp);
  }
  function onPointerDownAudio(e, a, mode) {
    e.preventDefault(); e.stopPropagation();
    if (a.linked) { setSel({ kind: 'audio', id: a.id }); return; } // linked audio is edited via its clip
    if (tp.current.playing) pauseAt(null);
    setSel({ kind: 'audio', id: a.id });
    drag.current = { kind: 'audio', mode, id: a.id, x0: e.clientX, snap: { ...a } };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp);
  }
  function onDragMove(e) {
    const d = drag.current; if (!d) return;
    const dt = snap((e.clientX - d.x0) / pxPerSec); // timeline-seconds moved
    if (d.kind === 'video') {
      const s = d.snap;
      if (d.mode === 'move') {
        // reorder: drop where the pointer's time falls among the other clips
        const t = xToTime(e.clientX);
        const others = (clips || []).filter((c) => c.id !== d.id);
        let acc = 0, idx = others.length;
        for (let k = 0; k < others.length; k++) {
          const dur = (others[k].out - others[k].in) / others[k].speed;
          if (t < acc + dur / 2) { idx = k; break; }
          acc += dur;
        }
        const dragged = (clips || []).find((c) => c.id === d.id);
        setClips([...others.slice(0, idx), dragged, ...others.slice(idx)]);
      } else if (d.mode === 'l') {
        const newIn = Math.max(0, Math.min(s.out - FRAME, s.in + dt * s.speed));
        patchClip(d.id, { in: snap(newIn) });
      } else if (d.mode === 'r') {
        const newOut = Math.min(s.srcDuration || s.out + 9999, Math.max(s.in + FRAME, s.out + dt * s.speed));
        patchClip(d.id, { out: snap(newOut) });
      }
    } else {
      const s = d.snap;
      if (d.mode === 'move') {
        patchAudio(d.id, { start: Math.max(0, snap(s.start + dt)) });
      } else if (d.mode === 'l') {
        const newIn = Math.max(0, Math.min(s.out - FRAME, s.in + dt * s.speed));
        patchAudio(d.id, { in: snap(newIn), start: Math.max(0, snap(s.start + dt)) });
      } else if (d.mode === 'r') {
        const newOut = Math.min(s.srcDuration || s.out + 9999, Math.max(s.in + FRAME, s.out + dt * s.speed));
        patchAudio(d.id, { out: snap(newOut) });
      }
    }
  }
  function onDragUp() {
    drag.current = null;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragUp);
  }

  // ── render the EDL ────────────────────────────────────────────────────────
  function buildEdl() {
    const videoTrack = laidClips.map((c) => ({
      src: c.src, in: c.in, out: c.out, speed: c.speed, crop: c.crop || null,
    }));
    const audioTracks = audioItems.map((a) => ({
      src: a.src, in: a.in, out: a.out, speed: a.speed, start: a.start, gain: a.gain,
    }));
    return { fps, crop: seed.crop || null, videoTrack, audioTracks };
  }
  async function handleRender() {
    setError(null); setFinal(null); setBusy('Rendering your edit…'); setProgress(0); setLog([]);
    try {
      const { jobId } = await api.render({ projectId, edl: buildEdl() });
      const r = await pollJob(jobId, (j) => { setProgress(j.progress); setLog(j.log); });
      setFinal(r);
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  }

  if (error && !clips) return <Banner kind="err">{error}</Banner>;
  if (!clips || !assets) return <p className="sub">Loading editor…</p>;

  const rows = packRows(audioItems);
  const selItem = selClip || selAudio;

  return (
    <div className="editor">
      {error && <Banner kind="err">{error}</Banner>}

      {/* preview */}
      <div className="ed-stage">
        <video ref={videoRef} muted playsInline />
        <div className="ed-stage-time">{fmt(playhead)} / {fmt(total)}</div>
      </div>

      {/* transport */}
      <div className="ed-transport">
        <button className="btn primary" onClick={togglePlay}>{playing ? '⏸' : '▶'}</button>
        <button className="btn" onClick={() => nudge(-FRAME)} title="back one frame">‹</button>
        <button className="btn" onClick={() => nudge(FRAME)} title="forward one frame">›</button>
        <span className="readout"><b>{fmt(playhead)}</b> · frame {Math.round(playhead * fps)}</span>
        <span className="spacer" />
        <button className="btn" onClick={() => setPxPerSec((p) => Math.max(30, p - 25))} title="zoom out">－</button>
        <button className="btn" onClick={() => setPxPerSec((p) => Math.min(260, p + 25))} title="zoom in">＋</button>
      </div>

      {/* timeline lanes */}
      <div className="ed-scroll">
        <div className="ed-content" ref={contentRef} style={{ width: contentW }}
          onPointerDown={(e) => { if (e.target === e.currentTarget || e.target.classList.contains('ed-lane')) seek(xToTime(e.clientX)); }}>
          <div className="ed-ruler" onPointerDown={(e) => { e.stopPropagation(); seek(xToTime(e.clientX)); }}>
            {Array.from({ length: Math.ceil(total) + 1 }).map((_, s) => (
              <div className="ed-tick" key={s} style={{ left: s * pxPerSec }}><span>{s}s</span></div>
            ))}
          </div>

          <div className="ed-lane video">
            {laidClips.map((c) => (
              <div key={c.id}
                className={`ed-clip${sel?.id === c.id ? ' sel' : ''}`}
                style={{ left: c.start * pxPerSec, width: c.outDur * pxPerSec }}
                onPointerDown={(e) => onPointerDownClip(e, c, 'move')}>
                <div className="ed-handle l" onPointerDown={(e) => onPointerDownClip(e, c, 'l')} />
                <div className="ed-name">{c.label}{c.speed !== 1 ? ` · ${c.speed}×` : ''}</div>
                {c.hasAudio && !c.audioDetached && !c.muted && <div className="ed-haslink">♪ linked</div>}
                <div className="ed-handle r" onPointerDown={(e) => onPointerDownClip(e, c, 'r')} />
              </div>
            ))}
          </div>

          {rows.length === 0 && <div className="ed-lane audio empty">drop audio here</div>}
          {rows.map((row, ri) => (
            <div className="ed-lane audio" key={ri}>
              {row.map((a) => (
                <div key={a.id}
                  className={`ed-clip aud${a.linked ? ' linked' : ''}${sel?.id === a.id ? ' sel' : ''}`}
                  style={{ left: a.start * pxPerSec, width: a.outDur * pxPerSec }}
                  onPointerDown={(e) => onPointerDownAudio(e, a, 'move')}>
                  {!a.linked && <div className="ed-handle l" onPointerDown={(e) => onPointerDownAudio(e, a, 'l')} />}
                  <div className="ed-name">{a.label}{a.gain !== 1 ? ` · ${Math.round(a.gain * 100)}%` : ''}</div>
                  {!a.linked && <div className="ed-handle r" onPointerDown={(e) => onPointerDownAudio(e, a, 'r')} />}
                </div>
              ))}
            </div>
          ))}

          <div className="ed-playhead" style={{ left: playhead * pxPerSec }} />
        </div>
      </div>

      {/* inspector + palette */}
      <div className="ed-tools">
        <div className="ed-inspector">
          {!selItem && <p className="note">Select a clip to trim, split, speed, detach audio, or change volume.</p>}
          {selClip && (
            <>
              <div className="row between">
                <b>{selClip.label}</b>
                <span className="readout">{fmt(selClip.outDur)} on timeline</span>
              </div>
              <NudgeRow label="In" value={selClip.in} fps={fps}
                onNudge={(d) => patchClip(selClip.id, { in: snap(Math.max(0, Math.min(selClip.out - FRAME, selClip.in + d))) })} />
              <NudgeRow label="Out" value={selClip.out} fps={fps}
                onNudge={(d) => patchClip(selClip.id, { out: snap(Math.max(selClip.in + FRAME, Math.min(selClip.srcDuration || 1e9, selClip.out + d))) })} />
              <SpeedRow speed={selClip.speed} onChange={(sp) => patchClip(selClip.id, { speed: sp })} />
              <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => reorder(selClip.id, -1)}>◀ move</button>
                <button className="btn" onClick={() => reorder(selClip.id, 1)}>move ▶</button>
                <button className="btn" onClick={splitAtPlayhead}>⎬ split</button>
                {selClip.hasAudio && !selClip.audioDetached &&
                  <button className="btn" onClick={() => detachAudio(selClip)}>↓ detach audio</button>}
                {selClip.hasAudio && !selClip.audioDetached &&
                  <button className="btn" onClick={() => patchClip(selClip.id, { muted: !selClip.muted })}>{selClip.muted ? '🔇 muted' : '🔈 mute'}</button>}
                <button className="btn danger" onClick={removeSelected}>✕ delete</button>
              </div>
            </>
          )}
          {selAudio && (
            <>
              <div className="row between">
                <b>{selAudio.label}</b>
                <span className="readout">{selAudio.linked ? 'linked to clip' : 'free audio'}</span>
              </div>
              {selAudio.linked ? (
                <p className="note">This is a clip's own audio. Detach it from the clip to move, trim, or split it independently. Volume below applies to it.</p>
              ) : (
                <>
                  <NudgeRow label="Start" value={selAudio.start} fps={fps}
                    onNudge={(d) => patchAudio(selAudio.id, { start: snap(Math.max(0, selAudio.start + d)) })} />
                  <NudgeRow label="In" value={selAudio.in} fps={fps}
                    onNudge={(d) => patchAudio(selAudio.id, { in: snap(Math.max(0, Math.min(selAudio.out - FRAME, selAudio.in + d))) })} />
                  <NudgeRow label="Out" value={selAudio.out} fps={fps}
                    onNudge={(d) => patchAudio(selAudio.id, { out: snap(Math.max(selAudio.in + FRAME, Math.min(selAudio.srcDuration || 1e9, selAudio.out + d))) })} />
                  <SpeedRow speed={selAudio.speed} onChange={(sp) => patchAudio(selAudio.id, { speed: sp })} />
                </>
              )}
              <GainRow gain={selAudio.gain}
                onChange={(g) => (selAudio.linked ? patchClip(selAudio.linked, { gain: g }) : patchAudio(selAudio.id, { gain: g }))} />
              <div className="row" style={{ marginTop: 12 }}>
                {!selAudio.linked && <button className="btn" onClick={splitAtPlayhead}>⎬ split</button>}
                {!selAudio.linked && <button className="btn danger" onClick={removeSelected}>✕ delete</button>}
              </div>
            </>
          )}
        </div>

        <div className="ed-palette">
          <label>Add clip</label>
          <div className="ed-chips">
            {assets.clips.map((c, i) => (
              <button className="btn" key={i} onClick={() => addClip(c)}>+ {c.label}</button>
            ))}
          </div>
          <label style={{ marginTop: 12 }}>Add audio {assets.audioLibrary.length === 0 && <span className="note">— none in Admin yet</span>}</label>
          <div className="ed-chips">
            {assets.audioLibrary.map((a) => (
              <button className="btn" key={a.id} onClick={() => addAudio(a)}>♪ {a.label}{a.duration ? ` (${fmt(a.duration)})` : ''}</button>
            ))}
          </div>
          <p className="note" style={{ marginTop: 10 }}>Audio added at the playhead. Manage the library in Admin.</p>
        </div>
      </div>

      {/* output */}
      <div className="row between" style={{ marginTop: 16 }}>
        <button className="btn ghost" onClick={onBack}>← Back</button>
        <div className="row">
          {final && <a className="btn" href={final.finalUrl} download="ai-maker.mp4">⬇ Download {final.width}×{final.height}</a>}
          <button className="btn primary" onClick={handleRender}>{final ? '↻ Re-render' : 'Render final video →'}</button>
        </div>
      </div>

      {final && (
        <div className="card" style={{ marginTop: 14 }}>
          <Banner kind="ok">Rendered {fmt(final.duration)} · {final.width}×{final.height}. Edit more and re-render, or download.</Banner>
          <video src={final.finalUrl} controls />
        </div>
      )}

      {busy && <ProgressOverlay title={busy} progress={progress} log={log} />}
    </div>
  );
}

// ── small inspector controls ────────────────────────────────────────────────
function NudgeRow({ label, value, fps, onNudge }) {
  const F = 1 / fps;
  return (
    <div className="ed-row">
      <span className="readout cap">{label}</span>
      <button className="btn sm" onClick={() => onNudge(-1)} title="−1s">−1s</button>
      <button className="btn sm" onClick={() => onNudge(-F)} title="−1 frame">‹</button>
      <span className="readout val">{fmt(value)}</span>
      <button className="btn sm" onClick={() => onNudge(F)} title="+1 frame">›</button>
      <button className="btn sm" onClick={() => onNudge(1)} title="+1s">+1s</button>
    </div>
  );
}

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];
function SpeedRow({ speed, onChange }) {
  return (
    <div className="ed-row">
      <span className="readout cap">Speed</span>
      {SPEEDS.map((s) => (
        <button key={s} className={`btn sm${s === speed ? ' sel' : ''}`} onClick={() => onChange(s)}>{s}×</button>
      ))}
    </div>
  );
}

function GainRow({ gain, onChange }) {
  return (
    <div className="ed-row">
      <span className="readout cap">Volume</span>
      <input type="range" min={0} max={2} step={0.05} value={gain}
        onChange={(e) => onChange(Number(e.target.value))} style={{ flex: 1 }} />
      <span className="readout val">{Math.round(gain * 100)}%</span>
    </div>
  );
}
