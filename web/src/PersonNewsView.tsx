// Person News (Flow C): pick a Pauv talent, get curator-and-Newsdata stories
// about them in the past 48h. About-them only — we don't query from:@theirhandle.

import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "./Sidebar";

type NewsCategory =
  | "career" | "business" | "performance" | "statement" | "controversy" | "tabloid" | "other";

const DEFAULT_SHOW: ReadonlySet<NewsCategory> = new Set<NewsCategory>([
  "career", "business", "performance", "statement", "other",
]);

interface Talent {
  id: string;
  ticker: string;
  name: string;
  industry: string | null;
  price: { cents: number | null; usd: number | null };
}

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

interface PersonLookupResult {
  talent: Talent;
  items: LookupItem[];
  candidatesConsidered: number;
  curatorHandlesUsed: number;
  tweetsError?: string;
  articlesError?: string;
  curatorsError?: string;
}

export function PersonNewsView() {
  const [talents, setTalents] = useState<Talent[]>([]);
  const [talentsError, setTalentsError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [findMoreLoading, setFindMoreLoading] = useState(false);
  const [result, setResult] = useState<PersonLookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showOffBrand, setShowOffBrand] = useState(false);

  useEffect(() => {
    fetch("/api/talents")
      .then(async (r) => { if (!r.ok) throw new Error(await r.text()); return r.json(); })
      .then((rows: Talent[]) => setTalents(rows))
      .catch((e) => setTalentsError(String(e)));
  }, []);

  const selected = useMemo(
    () => talents.find((t) => t.ticker === selectedTicker) ?? null,
    [talents, selectedTicker],
  );

  // Top-10 substring match on name or ticker. Roster is ~100 so this is fine
  // every keystroke; no need to debounce.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return talents.slice(0, 10);
    return talents
      .filter((t) =>
        t.name.toLowerCase().includes(q) || t.ticker.toLowerCase().includes(q),
      )
      .slice(0, 10);
  }, [talents, query]);

  const pickTalent = (t: Talent) => {
    setSelectedTicker(t.ticker);
    setQuery("");
    setPickerOpen(false);
    setResult(null);
    setError(null);
  };

  const clearTalent = () => {
    setSelectedTicker(null);
    setResult(null);
    setError(null);
  };

  const runLookup = async () => {
    if (!selectedTicker) return;
    setError(null);
    setLoading(true);
    setResult(null);
    try {
      const r = await fetch("/api/news/person-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: selectedTicker }),
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
    if (!selectedTicker || !result) return;
    setError(null);
    setFindMoreLoading(true);
    try {
      const r = await fetch("/api/news/person-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: selectedTicker,
          exclude: result.items.map((i) => i.url),
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const next: PersonLookupResult = await r.json();
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
      <Sidebar current="news-person" />
      <div className="layout-main">
        <div className="app-header">
          <div>
            <h1>Person News</h1>
            <div className="subtitle">
              Pick a Pauv talent, get curator + Newsdata stories about them from the past 48 hours.
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
            <button onClick={runLookup} disabled={loading || !selectedTicker}>
              {loading ? "Finding…" : result ? "↻ Refresh" : "Find news"}
            </button>
          </div>
        </div>

        {talentsError && (
          <div className="status err" style={{ whiteSpace: "pre-wrap" }}>
            Talents: {talentsError}
          </div>
        )}

        {/* Picker */}
        <div style={{ marginBottom: 16, position: "relative", maxWidth: 480 }}>
          {selected ? (
            <div className="file" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div className="file-header">
                <div className="file-name">{selected.name}</div>
                <div className="file-meta">
                  ${selected.ticker}{selected.industry ? ` · ${selected.industry}` : ""}
                </div>
              </div>
              <button className="secondary" onClick={clearTalent}>Change</button>
            </div>
          ) : (
            <>
              <input
                type="text"
                placeholder="Search talents by name or ticker…"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPickerOpen(true); }}
                onFocus={() => setPickerOpen(true)}
                style={{ width: "100%", padding: 8 }}
              />
              {pickerOpen && matches.length > 0 && (
                <div
                  className="card"
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    marginTop: 4,
                    maxHeight: 360,
                    overflowY: "auto",
                    padding: 0,
                    zIndex: 10,
                  }}
                >
                  {matches.map((t) => (
                    <div
                      key={t.id}
                      className="file"
                      style={{ cursor: "pointer", borderRadius: 0 }}
                      onClick={() => pickTalent(t)}
                    >
                      <div className="file-header">
                        <div className="file-name">{t.name}</div>
                        <div className="file-meta">
                          ${t.ticker}{t.industry ? ` · ${t.industry}` : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
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
                {visibleItems.length} shown · {result.items.length} ranked · {result.candidatesConsidered} candidates · {result.curatorHandlesUsed} curators
                {hiddenCount > 0 && !showOffBrand && (
                  <span> · <em>{hiddenCount} hidden (tabloid/controversy)</em></span>
                )}
              </div>

              {result.curatorsError && (
                <div className="status err" style={{ whiteSpace: "pre-wrap" }}>
                  Curators (Railway): {result.curatorsError}
                </div>
              )}
              {result.tweetsError && (
                <div className="status err" style={{ whiteSpace: "pre-wrap" }}>
                  Tweets: {result.tweetsError}
                </div>
              )}
              {result.articlesError && (
                <div className="status err" style={{ whiteSpace: "pre-wrap" }}>
                  Articles: {result.articlesError}
                </div>
              )}

              {visibleItems.length === 0 ? (
                <div className="card empty" style={{ textAlign: "left" }}>
                  {result.items.length === 0
                    ? `No stories found about ${result.talent.name} in the past 48 hours.`
                    : "All ranked items were filtered out as tabloid/controversy. Toggle the checkbox above to see them."}
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
                          {item.category ? `${item.category} · ` : ""}
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
