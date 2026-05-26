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
  viralScore: number;
  viralBreakdown: { tier: number; recency: number };
}

// Subtle color-coding so a hot story stands out at a glance without
// overwhelming the list.
function heatColor(score: number): { bg: string; fg: string } {
  if (score >= 8) return { bg: "#3a1a1a", fg: "#ff8b6b" };  // red — hot
  if (score >= 6) return { bg: "#2d2310", fg: "#ffba5c" };  // amber — warm
  if (score >= 4) return { bg: "#1e2615", fg: "#b6e08a" };  // green — fresh
  return { bg: "#1c2029", fg: "#8a93a0" };                  // grey — cold
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

// Four distinct content niches the user produces marketing for. Any future
// industry should slot into exactly one bucket — no overlap.
const HOLLYWOOD_INDUSTRIES = new Set(["Actor", "Musician"]);
const COMEDIAN_INDUSTRIES = new Set(["Comedian"]);
const CREATOR_INDUSTRIES = new Set(["Streamer", "Youtuber", "Influencer", "Podcaster"]);
const ATHLETE_INDUSTRIES = new Set(["Athlete"]);
type Category = "hollywood" | "comedians" | "creators" | "athletes";

export function TrendingView() {
  const [items, setItems] = useState<TrendingTalent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [buildingFor, setBuildingFor] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>("hollywood");

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
              Today's most-mentioned talents across entertainment outlets.
              Click a name to see their recent headlines, then build a card from any story.
            </div>
          </div>
          <div className="row">
            <button className="secondary" onClick={load} disabled={items === null}>
              {items === null ? "Loading…" : "↻ Refresh"}
            </button>
          </div>
        </div>

        {/* Category toggle — four distinct niches the user creates content for. */}
        {(() => {
          const countOf = (set: Set<string>) =>
            (items ?? []).filter((it) => it.talent.industry && set.has(it.talent.industry)).length;
          const hollywoodCount = countOf(HOLLYWOOD_INDUSTRIES);
          const comedianCount = countOf(COMEDIAN_INDUSTRIES);
          const creatorCount = countOf(CREATOR_INDUSTRIES);
          const athleteCount = countOf(ATHLETE_INDUSTRIES);
          return (
            <div className="row" style={{ marginBottom: 16, gap: 8 }}>
              <button
                className={category === "hollywood" ? "" : "secondary"}
                onClick={() => setCategory("hollywood")}
              >
                🎬 Music & Film {items !== null && <span style={{ opacity: 0.7, marginLeft: 6 }}>({hollywoodCount})</span>}
              </button>
              <button
                className={category === "comedians" ? "" : "secondary"}
                onClick={() => setCategory("comedians")}
              >
                🎤 Comedians {items !== null && <span style={{ opacity: 0.7, marginLeft: 6 }}>({comedianCount})</span>}
              </button>
              <button
                className={category === "creators" ? "" : "secondary"}
                onClick={() => setCategory("creators")}
              >
                🎮 Creators {items !== null && <span style={{ opacity: 0.7, marginLeft: 6 }}>({creatorCount})</span>}
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
            category === "hollywood" ? HOLLYWOOD_INDUSTRIES :
            category === "comedians" ? COMEDIAN_INDUSTRIES :
            category === "athletes"  ? ATHLETE_INDUSTRIES :
            CREATOR_INDUSTRIES;
          const filtered = (items ?? []).filter((it) => it.talent.industry && activeSet.has(it.talent.industry));
          if (items !== null && filtered.length === 0) {
            const emptyMsg =
              category === "hollywood" ? "No actors or musicians in the news today." :
              category === "comedians" ? "No comedians in the news today." :
              category === "athletes"  ? "No athletes in the news today." :
              "No creators in the news today.";
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
        });
        })()}
      </div>
    </div>
  );
}
