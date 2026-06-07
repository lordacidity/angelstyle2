import { useState } from 'react';
import { api, pollJob, fmt } from '../api.js';
import { ProgressOverlay, Banner } from '../components/ui.jsx';

// Standalone YouTube → MP4 downloader (no projects, no AI). Reuses the same
// /api/youtube/download endpoint the studio uses, which now grabs the best
// stream up to 2160p and remuxes to MP4.
export default function Downloader() {
  const [url, setUrl] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState([]);
  const [result, setResult] = useState(null); // job result: { sourceUrl, title, width, height, duration }

  const safeName = (t) =>
    (t || 'video').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'video';

  function triggerDownload(href, name) {
    const a = document.createElement('a');
    a.href = href; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  async function handleDownload() {
    if (!/^https?:\/\//i.test(url)) return setError('Paste a valid YouTube URL.');
    setError(null); setResult(null);
    setBusy('Downloading in the highest quality (up to 4K)…'); setProgress(0); setLog([]);
    try {
      const { jobId } = await api.download(url);
      const r = await pollJob(jobId, (j) => { setProgress(j.progress); setLog(j.log); });
      setResult(r);
      triggerDownload(r.sourceUrl, `${safeName(r.title)}.mp4`); // auto-save to disk
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  }

  return (
    <div>
      <h1>Video downloader</h1>
      <p className="sub">Paste a YouTube link and save it as an MP4 in the highest quality available (up to 4K). No editing — just the raw download.</p>

      {error && <Banner kind="err">{error}</Banner>}

      <div className="card">
        <label>YouTube URL</label>
        <input type="url" value={url} placeholder="https://www.youtube.com/watch?v=…"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleDownload()} />
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={handleDownload} disabled={!url}>⬇ Download MP4 (up to 4K)</button>
          <span className="note">Picks the best stream ≤2160p and remuxes to MP4.</span>
        </div>

        {result && (
          <div style={{ marginTop: 18 }}>
            <Banner kind="ok">
              Saved “{result.title}” · {result.width}×{result.height} · {fmt(result.duration)}.{' '}
              <button className="btn ghost" onClick={() => triggerDownload(result.sourceUrl, `${safeName(result.title)}.mp4`)}>Save again</button>
            </Banner>
            <video src={result.sourceUrl} controls style={{ marginTop: 10, width: '100%' }} />
          </div>
        )}
      </div>

      {busy && <ProgressOverlay title={busy} progress={progress} log={log} />}
    </div>
  );
}
