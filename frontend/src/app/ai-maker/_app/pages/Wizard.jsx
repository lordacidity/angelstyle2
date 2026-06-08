import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, pollJob, fmt } from '../api.js';
import { Stepper, ProgressOverlay, Banner } from '../components/ui.jsx';
import PromptEditor from '../components/PromptEditor.jsx';

const STEPS = ['Paste link', 'Freeze Frame', 'Prompt & Generate', 'Download'];
const DURATIONS = [3, 4, 5, 6, 7, 8, 9, 10];

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// Seek a <video> to an exact time and resolve once the frame is decoded.
function seekExact(v, t) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; v.removeEventListener('seeked', finish); resolve(); };
    v.addEventListener('seeked', finish, { once: true });
    try { v.currentTime = t; } catch {}
    setTimeout(finish, 400); // fallback if 'seeked' doesn't fire (already at t)
  });
}

// Translucent shading over the trimmed-off edges, so the kept (cropped) region is obvious.
function CropShade({ crop }) {
  const pc = (n) => `${(n * 100).toFixed(2)}%`;
  const base = { position: 'absolute', background: 'rgba(0,0,0,.55)', pointerEvents: 'none' };
  return (
    <>
      <div style={{ ...base, left: 0, right: 0, top: 0, height: pc(crop.top) }} />
      <div style={{ ...base, left: 0, right: 0, bottom: 0, height: pc(crop.bottom) }} />
      <div style={{ ...base, top: pc(crop.top), bottom: pc(crop.bottom), left: 0, width: pc(crop.left) }} />
      <div style={{ ...base, top: pc(crop.top), bottom: pc(crop.bottom), right: 0, width: pc(crop.right) }} />
    </>
  );
}

// Drag-the-corners crop. The kept region is a box inside the frame; drag a corner
// or edge to resize, drag the interior to move. Fractions are relative to the full
// frame and applied to BOTH the freeze-frame capture and the exported real footage.
// Handle modes: compass directions (n/s/e/w + corners), or 'move'.
const CROP_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MIN_CROP = 0.08; // keep at least 8% of the frame on each axis

function CropBox({ crop, setCrop }) {
  const ref = useRef(null);

  function startDrag(e, mode) {
    e.preventDefault();
    e.stopPropagation();
    const rect = ref.current.getBoundingClientRect();
    const start = { ...crop };
    const sx = e.clientX, sy = e.clientY;

    const move = (ev) => {
      const dx = (ev.clientX - sx) / rect.width;
      const dy = (ev.clientY - sy) / rect.height;
      let { top, right, bottom, left } = start;
      if (mode === 'move') {
        const w = 1 - start.left - start.right;
        const h = 1 - start.top - start.bottom;
        left = clamp(start.left + dx, 0, 1 - w); right = 1 - w - left;
        top = clamp(start.top + dy, 0, 1 - h); bottom = 1 - h - top;
      } else {
        if (mode.includes('w')) left = clamp(start.left + dx, 0, 1 - start.right - MIN_CROP);
        if (mode.includes('e')) right = clamp(start.right - dx, 0, 1 - start.left - MIN_CROP);
        if (mode.includes('n')) top = clamp(start.top + dy, 0, 1 - start.bottom - MIN_CROP);
        if (mode.includes('s')) bottom = clamp(start.bottom - dy, 0, 1 - start.top - MIN_CROP);
      }
      setCrop({ top, right, bottom, left });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const pc = (n) => `${(n * 100).toFixed(2)}%`;
  const box = {
    left: pc(crop.left), top: pc(crop.top),
    width: pc(Math.max(0, 1 - crop.left - crop.right)),
    height: pc(Math.max(0, 1 - crop.top - crop.bottom)),
  };

  return (
    <div className="crop-layer" ref={ref}>
      <div className="crop-box" style={box} onPointerDown={(e) => startDrag(e, 'move')}>
        {CROP_HANDLES.map((h) => (
          <span key={h} className={`crop-handle h-${h}`} onPointerDown={(e) => startDrag(e, h)} />
        ))}
      </div>
    </div>
  );
}

const NO_CROP = { top: 0, right: 0, bottom: 0, left: 0 };
const isCropped = (c) => !!(c.top || c.right || c.bottom || c.left);

export default function Wizard({ slot = 0, onStatus } = {}) {
  const [step, setStep] = useState(0);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState(null);

  // job overlay
  const [busy, setBusy] = useState(null);
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState([]);

  // flow state
  const [url, setUrl] = useState('');
  const [project, setProject] = useState(null); // {projectId, sourceUrl, duration, width, height, fps, title}
  const [frameTime, setFrameTime] = useState(0);
  const [frameUrl, setFrameUrl] = useState(null);
  const [capturing, setCapturing] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState(5);
  // Fractions trimmed off each edge — applied to BOTH the freeze-frame capture and the exported real footage.
  const [crop, setCrop] = useState({ top: 0, right: 0, bottom: 0, left: 0 });
  const [kling, setKling] = useState(null); // {klingUrl, klingDuration}
  const [movieUrl, setMovieUrl] = useState(null); // rendered full movie scene (trimmed + cropped), for download

  // Admin reference photos ("@Element1") are GLOBAL — one settings.json shared by
  // every slot. This is just the live count for display, so each project can show
  // (and prove) it's using the same Aiden element. null = not loaded yet.
  const [refsCount, setRefsCount] = useState(null);

  // testing: load a saved project / skip Kling
  const [devList, setDevList] = useState(null); // null = not loaded, [] = loaded empty
  const [devOpen, setDevOpen] = useState(false);

  const scrubRef = useRef(null);

  // Read the (global) admin settings. `first` seeds the default clip length on
  // initial mount only — later refreshes must NOT clobber a length the user chose.
  const loadSettings = useCallback(async (first) => {
    try {
      const data = await api.getSettings();
      if (!data || !data.settings) {
        setError('Server not responding with settings — make sure it started with `npm run dev` and reload.');
        return;
      }
      const settings = data.settings;
      const env = data.env || {};
      if (first) setDuration(settings.defaultDuration || 5);
      setRefsCount(settings.refs?.length || 0);
      const w = [];
      if (!env.fal) w.push('FAL_KEY missing — add it to .env and restart the server.');
      if (!settings.refs?.length) w.push('No reference images yet — add your face/body in Admin so Kling can insert you.');
      setWarnings(w);
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { loadSettings(true); }, [loadSettings]);
  // Re-read settings whenever we land on the Generate step, so the shared admin
  // element count is never stale (e.g. after adding photos in Admin mid-session).
  useEffect(() => { if (step === 2) loadSettings(false); }, [step, loadSettings]);

  const fps = project?.fps && project.fps > 1 ? project.fps : 30;
  const dur = project?.duration || 0; // whole clip — no trimming anymore

  // Report this slot's status up to the project switcher (dot indicator), so you
  // can see at a glance which slot is mid-generation or has a clip ready even
  // while the other slot is showing.
  const slotStatus = busy ? 'busy' : kling ? 'ready' : (project || url) ? 'working' : 'empty';
  useEffect(() => { onStatus?.(slot, slotStatus); }, [slot, slotStatus, onStatus]);

  // Crop changed → any previously rendered movie scene no longer matches the new
  // framing, so drop the cache and re-render on the next "download movie".
  useEffect(() => { setMovieUrl(null); }, [crop]);

  // ---------- handlers ----------
  async function handleDownload() {
    if (!/^https?:\/\//i.test(url)) return setError('Paste a valid YouTube URL.');
    setError(null); setBusy('Downloading video…'); setProgress(0); setLog([]);
    try {
      const { projectId, jobId } = await api.download(url);
      const r = await pollJob(jobId, (j) => { setProgress(j.progress); setLog(j.log); });
      setProject({ projectId, ...r });
      setFrameTime(0); setFrameUrl(null); setKling(null); setMovieUrl(null);
      setStep(1); // straight to the freeze frame — no trim step
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  }

  // Capture the freeze frame from the BROWSER's own decode of the <video>, so the
  // saved still is pixel-for-pixel identical to the movie scene (no ffmpeg re-decode,
  // no color shift). Full native resolution + lossless PNG = no quality loss.
  async function handleCapture() {
    const v = scrubRef.current;
    if (!v) return;
    setError(null); setCapturing(true);
    try {
      await seekExact(v, Number(frameTime));
      // Crop the same fractions the export will, so the seed frame Kling continues
      // from is exactly the cropped scene (native res, lossless).
      const vw = v.videoWidth, vh = v.videoHeight;
      const sx = Math.round(vw * crop.left), sy = Math.round(vh * crop.top);
      const sw = Math.max(2, Math.round(vw * (1 - crop.left - crop.right)));
      const sh = Math.max(2, Math.round(vh * (1 - crop.top - crop.bottom)));
      const c = document.createElement('canvas');
      c.width = sw; c.height = sh;
      c.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob = await new Promise((res, rej) =>
        c.toBlob((b) => (b ? res(b) : rej(new Error('Capture failed'))), 'image/png'));
      const r = await api.saveFrame(project.projectId, Number(frameTime), blob);
      setFrameUrl(r.frameUrl);
      setStep(2); // captured → straight to the prompt, no separate approve
    } catch (e) {
      // fallback: server-side ffmpeg extract (may differ slightly in color)
      try { const r = await api.frame(project.projectId, Number(frameTime)); setFrameUrl(r.frameUrl); setStep(2); }
      catch (e2) { setError(e2.message); }
    } finally { setCapturing(false); }
  }

  async function handleGenerate() {
    if (!prompt.trim()) return setError('Draft a prompt with Gemini, or write one yourself.');
    setError(null); setBusy('Generating with Kling… (this can take a few minutes)'); setProgress(0);

    const t0 = Date.now();
    const dbg = [];
    const el = () => ((Date.now() - t0) / 1000).toFixed(1);
    const push = (m) => { dbg.push(`[t+${el()}s] ${m}`); };
    const flush = (serverLog) => setLog([...dbg, ...(serverLog?.length ? ['── kling server ──', ...serverLog] : [])]);

    push(`POST /api/generate`);
    push(`projectId=${project.projectId}`);
    push(`duration=${duration}s  promptChars=${prompt.length}`);
    push(`seed frame @ ${fmt(frameTime)}`);
    flush();

    try {
      const { jobId } = await api.generate({ projectId: project.projectId, prompt, duration });
      push(`job queued → ${jobId}`);
      flush();

      let polls = 0, lastP = -1, lastStatus = '';
      const r = await pollJob(jobId, (j) => {
        polls++;
        if (j.progress !== lastP || j.status !== lastStatus) {
          push(`poll #${polls}  status=${j.status}  progress=${j.progress ?? 0}%`);
          lastP = j.progress; lastStatus = j.status;
        }
        setProgress(j.progress);
        flush(j.log);
      });

      push(`✓ done in ${el()}s after ${polls} polls`);
      push(`klingUrl=${r.klingUrl}`);
      push(`klingDuration=${fmt(r.klingDuration)}`);
      flush();

      setKling(r); setMovieUrl(null);
      setStep(3);
    } catch (e) {
      push(`✗ ERROR: ${e.message}`);
      flush();
      setError(e.message);
    } finally { setBusy(null); }
  }

  function startOver() {
    setStep(0); setUrl(''); setProject(null); setFrameUrl(null);
    setPrompt(''); setKling(null); setMovieUrl(null); setError(null);
    setCrop(NO_CROP);
  }

  // ---------- download step ----------
  // Render the full movie scene ON DEMAND — the whole clip, cropped with the SAME
  // crop used to pick the freeze frame, so the movie matches the AI clip's framing.
  // Cached in movieUrl so a second download (or "both") doesn't re-render.
  async function renderMovie() {
    if (!project) return null;
    if (movieUrl) return movieUrl;
    setError(null); setBusy('Rendering movie scene…'); setProgress(0); setLog([]);
    try {
      const { jobId } = await api.exportMovie({
        projectId: project.projectId, trimStart: 0, trimEnd: dur, crop,
      });
      const r = await pollJob(jobId, (j) => { setProgress(j.progress); setLog(j.log); });
      setMovieUrl(r.movieUrl);
      return r.movieUrl;
    } catch (e) { setError(e.message); return null; } finally { setBusy(null); }
  }

  function fileName(kind) {
    const base = (project?.title || 'clip')
      .replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'clip';
    return `${base}-${kind}.mp4`;
  }

  function triggerDownload(href, name) {
    const a = document.createElement('a');
    a.href = href; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  function downloadAi() {
    if (kling?.klingUrl) triggerDownload(kling.klingUrl, fileName('ai'));
  }

  // Render (if needed) the cropped movie scene, then download it.
  async function downloadMovie() {
    const url = await renderMovie();
    if (url) triggerDownload(url, fileName('movie'));
  }

  async function downloadBoth() {
    downloadAi();
    const url = await renderMovie();
    // stagger so the browser doesn't drop the second download
    if (url) setTimeout(() => triggerDownload(url, fileName('movie')), 600);
  }

  // ---------- testing shortcuts ----------
  function goStep(i) { setError(null); setStep(i); } // stepper: jump anywhere

  async function loadDevList() {
    setDevOpen(true); setError(null);
    try { const { projects } = await api.devProjects(); setDevList(projects || []); }
    catch (e) { setError(e.message); }
  }

  // Load a saved project straight into the editor (or wherever it can go) — no download, no Kling.
  function useDevProject(p) {
    setError(null);
    setProject({ projectId: p.id, sourceUrl: p.sourceUrl, duration: p.duration, width: p.width, height: p.height, fps: p.fps, title: p.title });
    setCrop(NO_CROP);
    setMovieUrl(null);
    if (p.frameUrl) setFrameUrl(p.frameUrl);
    setFrameTime(Math.max(0.5, Math.min(4, (p.duration || 8) * 0.3)));
    if (p.hasKling) {
      setKling({ klingUrl: p.klingUrl, klingDuration: p.klingDuration || 5 });
      setStep(3); // jump straight to download
    } else {
      setKling(null);
      setStep(1); // has source but no AI clip — pick a frame, then Generate or Skip
    }
    setDevOpen(false);
  }

  // Skip Kling: fake the AI clip from the source so Combine + the editor work.
  async function handleSkipGen() {
    if (!project) return;
    setError(null); setBusy('Building placeholder clip (skipping Kling)…'); setProgress(0); setLog([]);
    try {
      const { jobId } = await api.devPlaceholder({ projectId: project.projectId, fromTime: frameTime, duration: duration || 5 });
      const r = await pollJob(jobId, (j) => { setProgress(j.progress); setLog(j.log); });
      setKling(r); setMovieUrl(null); setStep(3);
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  }

  function seekScrub(t) {
    setFrameTime(t);
    if (scrubRef.current) scrubRef.current.currentTime = t;
  }

  // ---------- render ----------
  return (
    <div>
      <h1>Put yourself in the video</h1>
      <p className="sub">Paste a YouTube link, pick the hand-off frame, then let Kling continue it with you in it — talking.</p>
      <Stepper steps={STEPS} current={step} onStep={goStep} />

      {warnings.map((w, i) => <Banner key={i} kind="warn">{w} <Link to="/admin">Open Admin →</Link></Banner>)}
      {error && <Banner kind="err">{error}</Banner>}

      {/* jumping to a step that needs media you don't have yet */}
      {((step >= 1 && !project) || (step === 3 && project && !kling)) && (
        <Banner kind="warn">
          {!project ? 'This step needs a project. ' : 'This step needs an AI clip. '}
          <button className="btn ghost" onClick={loadDevList}>⚡ Load a saved project</button>
          {project && !kling && <button className="btn ghost" onClick={() => setStep(2)}>Generate / skip →</button>}
        </Banner>
      )}

      {/* testing: pick a saved project to skip download + Kling */}
      {devOpen && (
        <div className="card">
          <div className="row between">
            <h2 style={{ margin: 0 }}>⚡ Load a saved project (test)</h2>
            <button className="btn ghost" onClick={() => setDevOpen(false)}>✕ close</button>
          </div>
          <p className="sub">Skip download + Kling — jump in with real media. Projects with an AI clip go straight to the download step; source-only ones drop you at the freeze-frame step (then “Skip” there fakes the AI clip).</p>
          {devList === null ? <p className="note">Loading…</p>
            : devList.length === 0 ? <p className="note">No saved projects found.</p>
              : (
                <div className="refs-grid">
                  {devList.map((p) => (
                    <button className="ref-card dev-pick" key={p.id} onClick={() => useDevProject(p)}>
                      {p.frameUrl ? <img src={p.frameUrl} alt="" /> : <div className="dev-thumb">no frame</div>}
                      <div className="meta">
                        <div>
                          <div style={{ fontSize: 12 }}>{p.width}×{p.height} · {fmt(p.duration)}</div>
                          <div className="tag">{p.hasKling ? '✓ has AI clip → download' : 'source only'}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
        </div>
      )}

      {/* STEP 0 — paste link */}
      {step === 0 && (
        <div className="card">
          <h2>1 · Paste a YouTube link</h2>
          <label>YouTube URL</label>
          <input type="url" value={url} placeholder="https://www.youtube.com/watch?v=…"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleDownload()} />
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn primary" onClick={handleDownload} disabled={!url}>Next: freeze frame →</button>
            <span className="note">Downloads locally (≤1080p), then jumps straight to picking the freeze frame.</span>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn ghost" onClick={loadDevList}>⚡ Skip — load a saved project to test the editor</button>
          </div>
        </div>
      )}

      {/* STEP 1 — freeze frame */}
      {step === 1 && project && (
        <div className="card">
          <h2>2 · Pick the freeze frame</h2>
          <p className="sub">Scrub to the exact moment the AI should take over. This frame seeds the Kling clip — captured straight from the player, so it matches the movie pixel-for-pixel.</p>
          <div className="cropwrap">
            {/* crossOrigin: the source now streams from the LOCAL server (a different origin
                than this Vercel page), so request it with CORS — otherwise canvas capture in
                handleCapture taints and falls back to the server-side ffmpeg frame. */}
            <video ref={scrubRef} src={project.sourceUrl} preload="auto" playsInline crossOrigin="anonymous"
              onLoadedMetadata={(e) => { e.target.currentTime = frameTime; }} />
            <CropShade crop={crop} />
            <CropBox crop={crop} setCrop={setCrop} />
          </div>
          <div className="row between" style={{ marginTop: 10 }}>
            <span className="note">Drag the corners or edges to crop — applies to the video and the freeze frame.</span>
            {isCropped(crop) && <button className="btn ghost" onClick={() => setCrop(NO_CROP)}>↺ Reset crop</button>}
          </div>
          <div className="timeline">
            <input type="range" min={0} max={dur} step={0.001} value={frameTime}
              onChange={(e) => seekScrub(Number(e.target.value))} />
            <div className="row between">
              <span className="readout">At <b>{fmt(frameTime)}</b> · frame <b>{Math.round(frameTime * fps)}</b></span>
              <div className="row">
                <button className="btn" onClick={() => seekScrub(Math.max(0, frameTime - 1 / fps))}>‹ frame</button>
                <button className="btn" onClick={() => seekScrub(Math.min(dur, frameTime + 1 / fps))}>frame ›</button>
                <button className="btn" onClick={handleCapture} disabled={capturing}>
                  {capturing ? 'Capturing…' : '📸 Capture'}
                </button>
              </div>
            </div>
          </div>
          {frameUrl && (
            <>
              <label>Captured (pixel-exact, saved to the millisecond)</label>
              <img className="frame-preview" src={frameUrl} alt="freeze frame" />
            </>
          )}
          <div className="row between" style={{ marginTop: 14 }}>
            <button className="btn ghost" onClick={startOver}>↺ New link</button>
            <button className="btn primary" disabled={!frameUrl} onClick={() => setStep(2)}>Next: prompt →</button>
          </div>
        </div>
      )}

      {/* STEP 2 — prompt & generate */}
      {step === 2 && project && (
        <div className="card">
          <h2>3 · Prompt & generate</h2>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <img className="frame-preview" src={frameUrl} alt="seed" style={{ maxWidth: 260 }} />
            <div style={{ flex: 1, minWidth: 240 }}>
              <label style={{ margin: 0 }}>Kling prompt</label>
              <PromptEditor value={prompt} onChange={setPrompt}
                placeholder="Describe the continuation — type # to drop in #start_image or #Element1 (that's you)…" />
              <p className="note" style={{ marginTop: 6 }}>Type <b>#</b> to insert a reference token: <b>#start_image</b> (the freeze frame) or <b>#Element1</b> (you). They’re highlighted here, but sent to Kling as plain text.</p>
            </div>
          </div>
          <div className={`elem-chip ${refsCount ? 'ok' : 'none'}`}>
            <span className="dot" />
            {refsCount == null ? 'Checking Admin…'
              : refsCount
                ? <>Aiden element: <b>{refsCount}</b> reference photo{refsCount > 1 ? 's' : ''} from Admin — shared by both projects.</>
                : <>No reference photos in Admin — Kling can’t insert you. <Link to="/admin">Add them →</Link></>}
          </div>
          <label>Clip length</label>
          <div className="dur-grid">
            {DURATIONS.map((d) => (
              <button key={d} className={`btn ${d === duration ? 'sel' : ''}`} onClick={() => setDuration(d)}>{d}s</button>
            ))}
          </div>
          <div className="row between" style={{ marginTop: 16 }}>
            <button className="btn ghost" onClick={() => setStep(1)}>← Frame</button>
            <div className="row">
              <button className="btn" onClick={handleSkipGen} title="Fake the AI clip from the source — skip Kling">⏭ Skip (placeholder)</button>
              <button className="btn primary" onClick={handleGenerate}>Generate with Kling →</button>
            </div>
          </div>
          {kling && <p className="note" style={{ marginTop: 10 }}>Clip ready. Re-generate above, or <button className="btn ghost" onClick={() => setStep(3)}>continue →</button></p>}
        </div>
      )}

      {/* STEP 3 — download (AI output only; movie scene renders on demand) */}
      {step === 3 && project && kling && (
        <div className="card">
          <h2>4 · Download</h2>
          <p className="sub">Your AI clip (with your voice) is ready. Download just it, the full movie scene{isCropped(crop) ? ' (cropped to match)' : ''}, or both. The movie scene renders when you ask for it.</p>
          <video src={kling.klingUrl} controls style={{ maxWidth: 480 }} />
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn" onClick={downloadMovie}>⬇ Movie scene</button>
            <button className="btn" onClick={downloadAi}>⬇ AI clip</button>
            <button className="btn primary" onClick={downloadBoth}>⬇ Download both</button>
          </div>
          <div className="row between" style={{ marginTop: 16 }}>
            <button className="btn ghost" onClick={() => setStep(2)}>← Prompt</button>
            <button className="btn ghost" onClick={startOver}>↺ New project</button>
          </div>
        </div>
      )}

      {busy && <ProgressOverlay title={busy} progress={progress} log={log} />}
    </div>
  );
}
