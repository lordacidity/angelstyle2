// Trending: today's most-mentioned music & film Pauv talents, sourced from
// Google News across major entertainment outlets. Each talent's row expands
// to show their recent headlines, with a "Build card →" button that drops
// into the existing News Cards flow via the sessionStorage seed handoff.

import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";

interface Talent {
  id: string;
  ticker: string;
  name: string;
  bio: string | null;
  photo_url: string | null;
  industry: string | null;
  subcategory: string | null;
  location: string | null;
}

interface TrendingHeadline {
  title: string;
  link: string;
  pubDate: string | null;
  source: string | null;
  description: string | null;
}

interface TrendingTalent {
  talent: Talent;
  mentionCount: number;
  headlines: TrendingHeadline[];
}

// Route absolute http(s) image URLs through the backend proxy so CORS-strict
// CDNs (and Supabase storage with restrictive policies) still render.
function proxiedImage(url: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/api/img-proxy") || !/^https?:\/\//i.test(url)) return url;
  return `/api/img-proxy?url=${encodeURIComponent(url)}`;
}

// Google News titles trail "  - Source Name" — strip for cleaner display.
function cleanHeadline(title: string): string {
  return title.replace(/\s+-\s+[^-]+$/, "").trim();
}

export function TrendingView() {
  const [items, setItems] = useState<TrendingTalent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [buildingFor, setBuildingFor] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    setItems(null);
    try {
      const r = await fetch("/api/trending/talents?limit=12");
      if (!r.ok) throw new Error(await r.text());
      const data: TrendingTalent[] = await r.json();
      setItems(data);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => { load(); }, []);

  const toggle = (ticker: string) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(ticker)) next.delete(ticker); else next.add(ticker);
      return next;
    });
  };

  // Same seed-handoff as PersonNewsView: prepare DeepSeek extract + article
  // image scrape, store seed, redirect to /news/industry which jumps straight
  // to the photo step.
  const buildCard = async (talent: Talent, h: TrendingHeadline) => {
    setBuildingFor(h.link);
    setError(null);
    try {
      const extractPayload = { title: h.title, description: h.description };
      const [extract, scrape] = await Promise.all([
        fetch("/api/news/extract-person", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(extractPayload),
        }).then(async (r) => {
          if (!r.ok) throw new Error(await r.text());
          return r.json();
        }),
        fetch("/api/article/scrape-images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: h.link }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);

      const articleImages: string[] = scrape?.images ?? [];
      const seed = {
        selectedItem: {
          caption: cleanHeadline(h.title),
          source: "article" as const,
          url: h.link,
          mainPerson: talent.name,
          matchedTicker: talent.ticker,
          publishedAt: h.pubDate,
          imageUrl: null,
          rawText: h.description ?? "",
          sourceName: h.source ?? "Google News",
          extractPayload,
        },
        extract,
        articleImages,
        articleSourceName: scrape?.siteName ?? h.source ?? null,
      };
      sessionStorage.setItem("person-news-seed", JSON.stringify(seed));
      window.location.href = "/news/industry";
    } catch (e) {
      setError(`Couldn't prepare card: ${String(e)}`);
      setBuildingFor(null);
    }
  };

  return (
    <div className="layout">
      <Sidebar current="news-trending" />
      <div className="layout-main">
        <div className="app-header">
          <div>
            <h1>Trending Now</h1>
            <div className="subtitle">
              Today's most-mentioned music &amp; film talents across entertainment outlets.
              Click a name to see their recent headlines, then build a card from any story.
            </div>
          </div>
          <div className="row">
            <button className="secondary" onClick={load} disabled={items === null}>
              {items === null ? "Loading…" : "↻ Refresh"}
            </button>
          </div>
        </div>

        {error && (
          <div className="status err" style={{ whiteSpace: "pre-wrap", marginBottom: 16 }}>
            {error}
          </div>
        )}

        {items === null && !error && (
          <div className="card empty">Scanning today's entertainment headlines…</div>
        )}

        {items !== null && items.length === 0 && (
          <div className="card empty">
            No mentions found across today's entertainment outlets. Try refreshing in a few hours.
          </div>
        )}

        {items?.map((it) => {
          const isOpen = expanded.has(it.talent.ticker);
          return (
            <div className="file" key={it.talent.ticker}>
              <div
                className="file-header"
                style={{ alignItems: "center", cursor: "pointer", gap: 12 }}
                onClick={() => toggle(it.talent.ticker)}
              >
                {it.talent.photo_url && (
                  <img
                    src={proxiedImage(it.talent.photo_url)}
                    alt={it.talent.name}
                    style={{
                      width: 48, height: 48, borderRadius: "50%",
                      objectFit: "cover", flexShrink: 0,
                      border: "1px solid #2e3340",
                    }}
                  />
                )}
                <div style={{ flex: 1 }}>
                  <div className="file-name">{it.talent.name}</div>
                  <div className="file-meta">
                    {it.talent.industry ?? "—"}
                    {it.talent.subcategory ? ` · ${it.talent.subcategory}` : ""}
                    {" · "}
                    <strong>{it.mentionCount}</strong> headline{it.mentionCount === 1 ? "" : "s"} today
                  </div>
                </div>
                <span className="file-meta" style={{ fontSize: 18 }}>
                  {isOpen ? "▾" : "▸"}
                </span>
              </div>

              {isOpen && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #242832" }}>
                  {it.headlines.map((h, idx) => {
                    const isBuilding = buildingFor === h.link;
                    return (
                      <div
                        key={`${h.link}-${idx}`}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 12,
                          padding: "8px 0",
                          borderBottom: idx < it.headlines.length - 1 ? "1px solid #1c2029" : undefined,
                        }}
                      >
                        <a
                          href={h.link}
                          target="_blank"
                          rel="noreferrer"
                          style={{ flex: 1, textDecoration: "none", color: "inherit" }}
                        >
                          <div style={{ fontWeight: 500 }}>{cleanHeadline(h.title)}</div>
                          <div className="file-meta" style={{ marginTop: 2 }}>
                            📰 {h.source ?? "?"}
                            {h.pubDate ? ` · ${new Date(h.pubDate).toLocaleString()}` : ""}
                          </div>
                        </a>
                        <button
                          onClick={() => buildCard(it.talent, h)}
                          disabled={isBuilding || buildingFor !== null}
                          style={{ flexShrink: 0 }}
                        >
                          {isBuilding ? "Preparing…" : "Build card →"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
