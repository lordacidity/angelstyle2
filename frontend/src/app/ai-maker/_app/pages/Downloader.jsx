import { useState } from 'react';
import { Banner } from '../components/ui.jsx';

// YouTube → MP4 downloader. Runs against the LOCAL Aier server (aier/downloader.js), started
// with the floating "Launch Aier server" button (bottom-right). Downloading locally (vs the
// cloud) means a residential IP — YouTube bot-blocks datacenter IPs like Vercel/Railway — and
// a real yt-dlp + ffmpeg merge, so up to 1080p instead of the cloud grab's ~720p progressive
// cap. The studio/AI pipeline is unaffected; it still runs on Railway.

// Where the local server lives. Override at build time with NEXT_PUBLIC_AIER_DOWNLOADER_URL.
const LOCAL = (process.env.NEXT_PUBLIC_AIER_DOWNLOADER_URL || 'http://localhost:3011').replace(/\/+$/, '');

export default function Downloader() {
  const [url, setUrl] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(null); // { title } once a download has started

  async function handleDownload() {
    if (!/^https?:\/\//i.test(url)) return setError('Paste a valid YouTube URL.');
    setError(null); setInfo(null); setBusy(true);
    try {
      // Probe first: validate + grab the title, and confirm the local server is up before we
      // hand the browser a download URL.
      const grab = `${LOCAL}/grab?url=${encodeURIComponent(url)}`;
      let res;
      try {
        res = await fetch(`${grab}&probe=1`);
      } catch {
        // fetch threw → almost always the local server isn't running yet.
        throw new Error('Can’t reach the local Aier server. Press “Launch Aier server” (bottom-right) — run the first-time setup once if you haven’t — wait a few seconds, then try again.');
      }
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
      <p className="sub">Paste a YouTube link and save it as an MP4. Runs on your local Aier server — up to 1080p, no editing.</p>

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
          <span className="note">Best video+audio up to 1080p, merged locally. Press “Launch Aier server” (bottom-right) first.</span>
        </div>

        {info && (
          <div style={{ marginTop: 18 }}>
            <Banner kind="ok">
              Downloading “{info.title}” — check your browser's downloads.{' '}
              <button className="btn ghost" onClick={() => { window.location.href = `${LOCAL}/grab?url=${encodeURIComponent(url)}`; }}>
                Download again
              </button>
            </Banner>
          </div>
        )}
      </div>
    </div>
  );
}
