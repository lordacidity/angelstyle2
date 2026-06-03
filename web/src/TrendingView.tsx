// Trending: today's most-mentioned music & film Pauv talents, sourced from
// Google News across major entertainment outlets. Each talent's row expands
// to show their recent headlines.

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
  viralScore: number;
  viralBreakdown: { tier: number; recency: number };
}

// Subtle color-coding so a hot story stands out at a glance without
// overwhelming the list.
function heatColor(score: number): { bg: string; fg: string } {
  if (score >= 8) return { bg: "#3a1a1a", fg: "#ff8b6b" };  // red — hot
  if (score >= 6) return { bg: "#2d2310", fg: "#ffba5c" };  // amber — warm
  if (score >= 4) return { bg: "#1e2615", fg: "#b6e08a" };  // green — fresh
  return { bg: "#18181b", fg: "#71717a" };                  // grey — cold
}

interface TrendingTalent {
  talent: Talent;
  mentionCount: number;
  headlines: TrendingHeadline[];
}

// Google News titles trail "  - Source Name" — strip for cleaner display.
function cleanHeadline(title: string): string {
  return title.replace(/\s+-\s+[^-]+$/, "").trim();
}

// Three distinct content niches the user produces marketing for. Any future
// industry should slot into exactly one bucket — no overlap.
// Markets = creators + comedians + film/actors (everything entertainment-adjacent
// outside of music + sports). Music is its own bucket; athletes is its own.
const MUSIC_INDUSTRIES = new Set(["Musician"]);
const MARKETS_INDUSTRIES = new Set(["Actor", "Comedian", "Streamer", "Youtuber", "Influencer", "Podcaster"]);
const ATHLETE_INDUSTRIES = new Set(["Athlete"]);
type Category = "music" | "markets" | "athletes";

export function TrendingView() {
  const [items, setItems] = useState<TrendingTalent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState<Category>("music");

  const load = async () => {
    setError(null);
    setItems(null);
    try {
      // Pull everything in one call (limit=200, well above the realistic
      // ceiling of ~150 matched talents). We filter into the four
      // categories client-side so the toggle is instant and no category
      // gets squeezed out by another.
      const r = await fetch("/api/trending/talents?limit=200");
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

  return (
    <div className="layout">
      <Sidebar current="news-trending" />
      <div className="layout-main">
        <div className="app-header">
          <div>
            <h1>Trending Now</h1>
            <div className="subtitle">
              Today's most-mentioned talents across entertainment outlets.
              Click a name to see their recent headlines.
            </div>
          </div>
          <div className="row">
            <button className="secondary" onClick={load} disabled={items === null}>
              {items === null ? "Loading…" : "↻ Refresh"}
            </button>
          </div>
        </div>

        {/* Category toggle — three distinct niches the user creates content for. */}
        {(() => {
          const countOf = (set: Set<string>) =>
            (items ?? []).filter((it) => it.talent.industry && set.has(it.talent.industry)).length;
          const musicCount = countOf(MUSIC_INDUSTRIES);
          const marketsCount = countOf(MARKETS_INDUSTRIES);
          const athleteCount = countOf(ATHLETE_INDUSTRIES);
          return (
            <div className="row" style={{ marginBottom: 16, gap: 8 }}>
              <button
                className={category === "music" ? "" : "secondary"}
                onClick={() => setCategory("music")}
              >
                🎵 Music {items !== null && <span style={{ opacity: 0.7, marginLeft: 6 }}>({musicCount})</span>}
              </button>
              <button
                className={category === "markets" ? "" : "secondary"}
                onClick={() => setCategory("markets")}
              >
                📈 Markets {items !== null && <span style={{ opacity: 0.7, marginLeft: 6 }}>({marketsCount})</span>}
              </button>
              <button
                className={category === "athletes" ? "" : "secondary"}
                onClick={() => setCategory("athletes")}
              >
                🏆 Athletes {items !== null && <span style={{ opacity: 0.7, marginLeft: 6 }}>({athleteCount})</span>}
              </button>
            </div>
          );
        })()}

        {error && (
          <div className="status err" style={{ whiteSpace: "pre-wrap", marginBottom: 16 }}>
            {error}
          </div>
        )}

        {items === null && !error && (
          <div className="card empty">Scanning today's entertainment headlines…</div>
        )}

        {(() => {
          const activeSet =
            category === "music"    ? MUSIC_INDUSTRIES :
            category === "athletes" ? ATHLETE_INDUSTRIES :
            MARKETS_INDUSTRIES;
          const filtered = (items ?? []).filter((it) => it.talent.industry && activeSet.has(it.talent.industry));
          if (items !== null && filtered.length === 0) {
            const emptyMsg =
              category === "music"    ? "No musicians in the news today." :
              category === "athletes" ? "No athletes in the news today." :
              "No film, comedy, or creator names in the news today.";
            return <div className="card empty">{emptyMsg} Try refreshing later or switch tabs.</div>;
          }
          return filtered.map((it) => {
          const isOpen = expanded.has(it.talent.ticker);
          return (
            <div className="file" key={it.talent.ticker}>
              <div
                className="file-header"
                style={{ alignItems: "center", cursor: "pointer", gap: 12 }}
                onClick={() => toggle(it.talent.ticker)}
              >
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
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #27272a" }}>
                  {it.headlines.map((h, idx) => {
                    return (
                      <div
                        key={`${h.link}-${idx}`}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 12,
                          padding: "8px 0",
                          borderBottom: idx < it.headlines.length - 1 ? "1px solid #18181b" : undefined,
                        }}
                      >
                        <div
                          title={`Heat ${h.viralScore}/10 — Publisher: ${h.viralBreakdown.tier}/5 · Recency: ${h.viralBreakdown.recency}/5`}
                          style={{
                            flexShrink: 0,
                            width: 38, height: 38,
                            borderRadius: 8,
                            background: heatColor(h.viralScore).bg,
                            color: heatColor(h.viralScore).fg,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 700,
                            fontSize: 14,
                            lineHeight: 1,
                          }}
                        >
                          {h.viralScore}
                          <span style={{ fontSize: 8, opacity: 0.7, marginTop: 2 }}>HEAT</span>
                        </div>
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
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        });
        })()}
      </div>
    </div>
  );
}
