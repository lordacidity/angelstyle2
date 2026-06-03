'use client';

// Standalone image search. Type a topic → grid of results from Google Images
// (via SerpAPI) → click any image to save it straight into
// ~/Downloads/copyright free images/. "+ More" paginates through additional
// results without losing what's already on screen.
//
// Ported from phonedeck/web; API calls now go to the Phonedeck server over
// HTTP via NEXT_PUBLIC_PHONEDECK_URL (defaults to localhost:8080).

import { useState } from "react";

const PHONEDECK_URL = process.env.NEXT_PUBLIC_PHONEDECK_URL ?? "http://localhost:8080";

interface Photo {
  url: string;
  thumbnail: string;
  title?: string;
  source?: string;
  width?: number;
  height?: number;
}

type DownloadState = "idle" | "downloading" | "done" | "error";

export function PhonedeckImages() {
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [offset, setOffset] = useState(0);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-photo download state keyed by URL — so the user can see exactly which
  // tiles are saving / saved without a global spinner.
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});

  const PAGE_SIZE = 12;

  const runSearch = async (q: string, off: number, mode: "replace" | "append") => {
    if (!q.trim()) return;
    setError(null);
    if (mode === "replace") setSearching(true); else setLoadingMore(true);
    try {
      const r = await fetch(`${PHONEDECK_URL}/api/photos/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, count: PAGE_SIZE, offset: off }),
      });
      if (!r.ok) throw new Error(await r.text());
      const fresh: Photo[] = await r.json();
      if (mode === "replace") {
        setPhotos(fresh);
        setActiveQuery(q);
        setOffset(off + fresh.length);
        setDownloads({});
      } else {
        // Dedupe by URL so a re-paginate doesn't show the same image twice.
        const seen = new Set(photos.map((p) => p.url));
        const novel = fresh.filter((p) => !seen.has(p.url));
        setPhotos([...photos, ...novel]);
        setOffset(off + fresh.length);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSearching(false);
      setLoadingMore(false);
    }
  };

  const onSearch = () => runSearch(query, 0, "replace");
  const onMore = () => runSearch(activeQuery, offset, "append");

  const onDownload = async (p: Photo) => {
    setDownloads((d) => ({ ...d, [p.url]: "downloading" }));
    try {
      const r = await fetch(`${PHONEDECK_URL}/api/images/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: p.url, query: activeQuery }),
      });
      if (!r.ok) throw new Error(await r.text());
      setDownloads((d) => ({ ...d, [p.url]: "done" }));
    } catch (e) {
      console.error("[images] download failed:", e);
      setDownloads((d) => ({ ...d, [p.url]: "error" }));
    }
  };

  return (
    <div className="layout-main">
      <div className="app-header">
          <div>
            <h1>Images</h1>
            <div className="subtitle">
              Search any topic and click an image to save it straight into
              <code style={{ marginLeft: 6, marginRight: 6 }}>~/Downloads/copyright free images/</code>.
              Use these as B-roll, backgrounds, or reference — always double-check the source's licence
              before publishing.
            </div>
          </div>
        </div>

        <div className="row" style={{ gap: 8, marginBottom: 16 }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onSearch(); }}
            placeholder="e.g. world cup, sunset, neon city…"
            style={{
              flex: 1,
              padding: "8px 12px",
              background: "#09090b",
              border: "1px solid #27272a",
              borderRadius: 6,
              color: "#fafafa",
              fontSize: 14,
            }}
          />
          <button onClick={onSearch} disabled={searching || !query.trim()}>
            {searching ? "Searching…" : "Search"}
          </button>
        </div>

        {error && (
          <div className="status err" style={{ whiteSpace: "pre-wrap", marginBottom: 16 }}>
            {error}
          </div>
        )}

        {photos.length === 0 && !searching && !error && (
          <div className="card empty">
            Type a topic above and hit Search. Results come from Google Images.
          </div>
        )}

        {photos.length > 0 && (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                gap: 10,
                marginBottom: 16,
              }}
            >
              {photos.map((p) => {
                const state = downloads[p.url] ?? "idle";
                const badge =
                  state === "downloading" ? "Saving…" :
                  state === "done"        ? "✓ Saved" :
                  state === "error"       ? "✗ Failed" : null;
                return (
                  <button
                    key={p.url}
                    onClick={() => onDownload(p)}
                    disabled={state === "downloading"}
                    title={p.title ? `${p.title} — click to save` : "Click to save"}
                    style={{
                      position: "relative",
                      padding: 0,
                      border: state === "done"
                        ? "2px solid #4ade80"
                        : state === "error"
                        ? "2px solid #ef4444"
                        : "1px solid #27272a",
                      borderRadius: 8,
                      overflow: "hidden",
                      background: "#000",
                      cursor: state === "downloading" ? "wait" : "pointer",
                      aspectRatio: "1 / 1",
                    }}
                  >
                    <img
                      src={`${PHONEDECK_URL}/api/img-proxy?url=${encodeURIComponent(p.thumbnail || p.url)}`}
                      alt={p.title ?? "image"}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                      }}
                      loading="lazy"
                    />
                    {badge && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: 6,
                          left: 6,
                          right: 6,
                          padding: "3px 8px",
                          background: "rgba(0,0,0,0.7)",
                          color:
                            state === "done"  ? "#4ade80" :
                            state === "error" ? "#ef4444" : "#fafafa",
                          fontSize: 11,
                          borderRadius: 4,
                          textAlign: "center",
                          fontWeight: 600,
                        }}
                      >
                        {badge}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="row" style={{ justifyContent: "center" }}>
              <button onClick={onMore} disabled={loadingMore} className="secondary">
                {loadingMore ? "Loading…" : "+ More"}
              </button>
            </div>
          </>
        )}
    </div>
  );
}
