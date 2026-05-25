// All News (Flow B): cross-industry firehose. "Find news" fans out one
// curator query per seeded industry in parallel, then DeepSeek classifies
// each tweet against the full Pauv roster. Always Pauv-only.

import { useState } from "react";
import { Sidebar } from "./Sidebar";

type NewsCategory =
  | "career" | "business" | "performance" | "statement" | "controversy" | "tabloid" | "other";

// Default newsworthy categories — tabloid / controversy hidden behind a toggle.
const DEFAULT_SHOW: ReadonlySet<NewsCategory> = new Set<NewsCategory>([
  "career", "business", "performance", "statement", "other",
]);

interface LookupItem {
  caption: string;
  source: "tweet" | "article";
  url: string;
  mainPerson: string;
  matchedTicker?: string;
  category?: NewsCategory;
  publishedAt: string | null;
  imageUrl: string | null;
  rawText: string;
  sourceName: string;
  likeCount?: number;
}

interface AllLookupBucket {
  industry: string;
  handlesUsed: number;
  tweetsFound: number;
  error?: string;
}

interface AllLookupResult {
  items: LookupItem[];
  candidatesConsidered: number;
  pauvTalentCount: number;
  buckets: AllLookupBucket[];
  industriesQueried: number;
}

export function AllNewsView() {
  const [loading, setLoading] = useState(false);
  const [findMoreLoading, setFindMoreLoading] = useState(false);
  const [result, setResult] = useState<AllLookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Off-brand content (tabloid + controversy) is hidden by default. Toggle to show.
  const [showOffBrand, setShowOffBrand] = useState(false);

  const runLookup = async () => {
    setError(null);
    setLoading(true);
    setResult(null);
    try {
      const r = await fetch("/api/news/all-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error(await r.text());
      setResult(await r.json());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const findMore = async () => {
    if (!result) return;
    setError(null);
    setFindMoreLoading(true);
    try {
      const r = await fetch("/api/news/all-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exclude: result.items.map((i) => i.url) }),
      });
      if (!r.ok) throw new Error(await r.text());
      const next: AllLookupResult = await r.json();
      const seen = new Set(result.items.map((i) => i.url));
      const fresh = next.items.filter((i) => !seen.has(i.url));
      setResult({ ...next, items: [...result.items, ...fresh] });
    } catch (e) {
      setError(String(e));
    } finally {
      setFindMoreLoading(false);
    }
  };

  return (
    <div className="layout">
      <Sidebar current="news-all" />
      <div className="layout-main">
        <div className="app-header">
          <div>
            <h1>All News</h1>
            <div className="subtitle">
              Cross-industry firehose. Pulls from every curator list in parallel, surfaces stories about Pauv talent.
            </div>
          </div>
          <div className="row">
            <label className="file-meta" style={{ display: "flex", alignItems: "center", gap: 6, marginRight: 12 }}>
              <input
                type="checkbox"
                checked={showOffBrand}
                onChange={(e) => setShowOffBrand(e.target.checked)}
              />
              Include tabloid / controversy
            </label>
            <button onClick={runLookup} disabled={loading}>
              {loading ? "Finding…" : result ? "↻ Refresh" : "Find news"}
            </button>
          </div>
        </div>

        {error && <div className="status err" style={{ whiteSpace: "pre-wrap" }}>{error}</div>}

        {result && (() => {
          const visibleItems = result.items.filter((it) =>
            showOffBrand || !it.category || DEFAULT_SHOW.has(it.category),
          );
          const hiddenCount = result.items.length - visibleItems.length;
          return (
          <>
            <div className="file-meta" style={{ marginBottom: 12 }}>
              {visibleItems.length} shown · {result.items.length} ranked · {result.candidatesConsidered} candidates · {result.industriesQueried} industries · {result.pauvTalentCount} roster
              {hiddenCount > 0 && !showOffBrand && (
                <span> · <em>{hiddenCount} hidden (tabloid/controversy)</em></span>
              )}
            </div>

            {result.buckets.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div className="file-meta" style={{ marginBottom: 6 }}>
                  Per-industry: <code>tweetsFound/handlesUsed</code>
                </div>
                <div className="file-meta">
                  {result.buckets.map((b) => (
                    <span key={b.industry} style={{ marginRight: 12 }}>
                      {b.industry}: {b.tweetsFound}/{b.handlesUsed}
                      {b.handlesUsed === 0 && !b.error ? " (no curators seeded)" : ""}
                    </span>
                  ))}
                </div>
                {result.buckets.filter((b) => b.error).map((b) => (
                  <div key={b.industry} className="status err" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
                    {b.industry}: {b.error}
                  </div>
                ))}
              </div>
            )}

            {visibleItems.length === 0 ? (
              <div className="card empty" style={{ textAlign: "left" }}>
                {result.items.length === 0
                  ? "No Pauv-relevant stories found across the curator fan-out. Try Refresh in a few minutes."
                  : "All ranked items were filtered out as tabloid/controversy. Toggle “Include tabloid / controversy” above to see them."}
              </div>
            ) : (
              <>
                {visibleItems.map((item, idx) => (
                  <a
                    key={`${item.url}-${idx}`}
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="file"
                    style={{ display: "block", textDecoration: "none", color: "inherit" }}
                  >
                    <div className="file-header">
                      <div className="file-name">{item.caption}</div>
                      <div className="file-meta">
                        {item.matchedTicker ? `$${item.matchedTicker} · ${item.mainPerson}` : item.mainPerson}
                        {item.category ? ` · ${item.category}` : ""}
                        {" · "}
                        {item.source === "tweet" ? "🐦" : "📰"} {item.sourceName}
                        {item.publishedAt ? ` · ${item.publishedAt}` : ""}
                      </div>
                    </div>
                  </a>
                ))}

                <div className="row" style={{ marginTop: 16 }}>
                  <button
                    className="secondary"
                    onClick={findMore}
                    disabled={loading || findMoreLoading}
                  >
                    {findMoreLoading ? "Finding…" : "+ Find more"}
                  </button>
                </div>
              </>
            )}
          </>
          );
        })()}
      </div>
    </div>
  );
}
