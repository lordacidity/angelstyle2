import { useState } from 'react';
import { Banner } from '../components/ui.jsx';

// Standalone YouTube → MP4 downloader (no projects, no AI). Streams the file straight from
// YouTube through /api/aier/youtube/grab into the browser's download — no server storage,
// no background jobs, so it works on Vercel's ephemeral serverless filesystem.
export default function Downloader() {
  const [url, setUrl] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(null); // { title } once a download has started

  async function handleDownload() {
    if (!/^https?:\/\//i.test(url)) return setError('Paste a valid YouTube URL.');
    setError(null); setInfo(null); setBusy(true);
    try {
      // Probe first: validate + grab the title, and catch YouTube errors (e.g. datacenter-IP
      // bot blocks) before we hand the browser a download URL.
      const grab = `/api/aier/youtube/grab?url=${encodeURIComponent(url)}`;
      const res = await fetch(`${grab}&probe=1`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Couldn't fetch that video (${res.status}).`);

      setInfo({ title: data.title });
      // Navigating to an attachment URL starts the download without unloading the page, and
      // streams straight to disk (no whole-file-in-memory blob).
      window.location.href = grab;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>Video downloader</h1>
      <p className="sub">Paste a YouTube link and save it as an MP4. No editing — just the raw download.</p>

      {error && <Banner kind="err">{error}</Banner>}

      <div className="card">
        <label>YouTube URL</label>
        <input type="url" value={url} placeholder="https://www.youtube.com/watch?v=…"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && handleDownload()} />
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={handleDownload} disabled={!url || busy}>
            {busy ? 'Starting…' : '⬇ Download MP4'}
          </button>
          <span className="note">Best combined audio+video stream (up to 720p).</span>
        </div>

        {info && (
          <div style={{ marginTop: 18 }}>
            <Banner kind="ok">
              Downloading “{info.title}” — check your browser's downloads.{' '}
              <button className="btn ghost" onClick={() => { window.location.href = `/api/aier/youtube/grab?url=${encodeURIComponent(url)}`; }}>
                Download again
              </button>
            </Banner>
          </div>
        )}
      </div>
    </div>
  );
}
