import { useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { Sidebar } from "./Sidebar";
import { TemplateRenderer } from "./TemplateRenderer";
import { CardLayoutOverlay } from "./CardLayoutOverlay";
import type { TemplateRow, PopulateContext, CopyOverrides, LayoutOverrides } from "./templateModel";

// ---- types mirroring the server ----

interface Industry {
  plural: string;
  singular: string;
  sort_order: number;
  active: boolean;
  talentCount: number;
  withXHandle: number;
}

interface LookupItem {
  caption: string;
  source: "tweet" | "article";
  url: string;
  mainPerson: string;
  matchedTicker?: string;
  publishedAt: string | null;
  imageUrl: string | null;
  rawText: string;
  sourceName: string;
  likeCount?: number;
  extractPayload: {
    title?: string;
    description?: string | null;
    tweetText?: string;
    tweetAuthorName?: string;
    tweetAuthorHandle?: string;
  };
}

interface LookupResult {
  industry: string;
  mode: "pauv-only" | "anyone";
  items: LookupItem[];
  candidatesConsidered: number;
  pauvTalentCount: number;
  curatorHandlesUsed: number;
  tweetsError?: string;
  articlesError?: string;
  curatorsError?: string;
}

type SelectedItem = LookupItem;

interface Talent {
  id: string;
  ticker: string;
  name: string;
  bio: string | null;
  photo_url: string | null;
  industry: string | null;
  subcategory: string | null;
  location: string | null;
  price: {
    cents: number | null;
    usd: number | null;
    p0Cents: number | null;
    lifetimeChangePct: number | null;
    holders: number | null;
    volumeLifetimeUsd: number | null;
    latestTickAt: string | null;
    frozen: boolean;
  };
}

interface ExtractResult {
  person: { name: string; summary: string; isPauvTalent: boolean; matchedTicker: string | null };
  pauvAngle: string;
  talent: Talent | null;
}

interface Photo { url: string; thumbnail: string; title?: string; source?: string; }

type Step = "industry" | "stories" | "photo" | "card";

// ---- component ----

export function NewsCardsView() {
  const [step, setStep] = useState<Step>("industry");
  const [error, setError] = useState<string | null>(null);

  // step 1
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [industry, setIndustry] = useState<string | null>(null);
  const [pauvOnly, setPauvOnly] = useState(true);

  // step 2
  const [lookupLoading, setLookupLoading] = useState(false);
  const [findMoreLoading, setFindMoreLoading] = useState(false);
  const [lookup, setLookup] = useState<LookupResult | null>(null);

  // step 3
  const [extractLoading, setExtractLoading] = useState(false);
  const [extract, setExtract] = useState<ExtractResult | null>(null);
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [photoQuery, setPhotoQuery] = useState("");
  const [photoOffset, setPhotoOffset] = useState(0);
  // Queries we've already tried so DeepSeek doesn't loop back to the same one.
  const [photoQueryHistory, setPhotoQueryHistory] = useState<string[]>([]);
  const [photoQueryRewriting, setPhotoQueryRewriting] = useState(false);

  // step 3 (chat-edit panel)
  interface ChatMsg { role: "user" | "assistant"; content: string }
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [lastPatchFields, setLastPatchFields] = useState<string[]>([]);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  // step 4 — useState (not useRef) so CardLayoutOverlay re-renders once the
  // card element mounts; otherwise it'd be stuck with the initial null and
  // never measure any layer positions.
  const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<CopyOverrides | null>(null);
  const [layoutOverrides, setLayoutOverrides] = useState<LayoutOverrides>({});
  const [populating, setPopulating] = useState(false);

  // Pull templates list on mount and any time we enter the card step so a new
  // template designed mid-session shows up without a page reload.
  useEffect(() => {
    fetch("/api/templates")
      .then(async (r) => { if (!r.ok) throw new Error(await r.text()); return r.json(); })
      .then((rows: TemplateRow[]) => {
        setTemplates(rows);
        // Auto-select the most recently updated template so the card step
        // isn't empty on first visit.
        if (rows[0] && !selectedTemplateId) setSelectedTemplateId(rows[0].id);
      })
      .catch((e) => {
        // Templates live in Railway. Don't surface as a page-level red banner
        // when Railway isn't wired — the news + chat flow doesn't need them,
        // and the step-4 empty state explains what's missing.
        console.warn("[templates] fetch failed:", e);
      });
  }, []);

  // Person News hand-off: if a seed was left in sessionStorage by clicking
  // "Build card →" on a Person News story, consume it and jump straight to
  // the photo step with the talent + DeepSeek-optimized caption preloaded.
  // The seed is one-shot — we delete it so a future visit to /news/industry
  // starts at the industry picker as usual.
  useEffect(() => {
    const raw = sessionStorage.getItem("person-news-seed");
    if (!raw) return;
    sessionStorage.removeItem("person-news-seed");
    try {
      const seed = JSON.parse(raw) as {
        selectedItem: SelectedItem;
        extract: ExtractResult;
        articleImages: string[];
        articleSourceName: string | null;
      };
      setSelectedItem(seed.selectedItem);
      setExtract(seed.extract);
      // Pre-populate the photo strip with any images scraped from the
      // article, marked with the publisher's name so the card can show
      // attribution.
      const articlePhotos: Photo[] = (seed.articleImages ?? []).map((url, i) => ({
        url,
        thumbnail: url,
        title: i === 0 ? "Article hero image" : `Article image ${i + 1}`,
        source: seed.articleSourceName ?? undefined,
      }));
      setPhotos(articlePhotos);
      if (articlePhotos.length > 0) setSelectedPhoto(articlePhotos[0]);
      setStep("photo");
      // Also kick off the normal SerpAPI photo search as a fallback —
      // article scrapes are often empty (Google News redirect URLs) or
      // hotlink-protected (publisher blocks browser <img> loads). Search
      // results get appended after the article images so the user always
      // has working pictures.
      const personName = seed.extract?.person?.name;
      if (personName) {
        loadPhotosAppending(personName, 0, articlePhotos);
      }
    } catch (e) {
      console.warn("[person-news-seed] failed to parse:", e);
    }
  }, []);

  // Variant of loadPhotos that appends to an existing seed instead of
  // replacing. Used by the Person News hand-off so article images stay at
  // the front while SerpAPI fills in fallback options behind them.
  const loadPhotosAppending = async (
    query: string,
    offset: number,
    keepFirst: Photo[],
  ) => {
    setPhotosLoading(true);
    setPhotoQuery(query);
    setPhotoOffset(offset);
    try {
      const r = await fetch("/api/photos/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, count: 3, offset }),
      });
      if (!r.ok) throw new Error(await r.text());
      const fresh: Photo[] = await r.json();
      // Skip any search result that duplicates an article image by URL.
      const articleUrls = new Set(keepFirst.map((p) => p.url));
      const merged: Photo[] = [...keepFirst, ...fresh.filter((p) => !articleUrls.has(p.url))];
      setPhotos(merged);
      // If we had no article images, auto-select the first search result.
      if (keepFirst.length === 0 && merged[0]) setSelectedPhoto(merged[0]);
      setPhotoQueryHistory((h) => (h.includes(query) ? h : [...h, query]));
    } catch (e) {
      console.warn("[photos] fallback search failed:", e);
    } finally {
      setPhotosLoading(false);
    }
  };

  // initial industries fetch
  useEffect(() => {
    fetch("/api/industries")
      .then(async (r) => { if (!r.ok) throw new Error(await r.text()); return r.json(); })
      .then((data: Industry[]) => setIndustries(data))
      .catch((e) => setError(String(e)));
  }, []);

  // If the user picks an industry with 0 Pauv talents, force pauvOnly off so
  // the lookup doesn't silently come back empty.
  useEffect(() => {
    const chosen = industries.find((i) => i.singular === industry);
    if (chosen && chosen.talentCount === 0 && pauvOnly) setPauvOnly(false);
  }, [industry, industries, pauvOnly]);

  const runLookup = async () => {
    if (!industry) return;
    setError(null);
    setLookupLoading(true);
    setLookup(null);
    try {
      const r = await fetch("/api/news/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ industry, pauvOnly }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data: LookupResult = await r.json();
      setLookup(data);
      setStep("stories");
    } catch (e) {
      setError(String(e));
    } finally {
      setLookupLoading(false);
    }
  };

  // Pull a fresh upstream batch and append items the user hasn't seen yet.
  // Server filters by URL, so duplicates from overlapping Newsdata/Twitter
  // responses are dropped before DeepSeek ranks.
  const findMore = async () => {
    if (!industry || !lookup) return;
    setError(null);
    setFindMoreLoading(true);
    try {
      const r = await fetch("/api/news/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          industry,
          pauvOnly,
          exclude: lookup.items.map((i) => i.url),
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data: LookupResult = await r.json();
      // Append the new items; keep existing ones in place. Defensively de-dupe
      // by URL in case the server returns one we already had (shouldn't happen,
      // but cheap insurance).
      const seenUrls = new Set(lookup.items.map((i) => i.url));
      const fresh = data.items.filter((i) => !seenUrls.has(i.url));
      setLookup({
        ...data,
        items: [...lookup.items, ...fresh],
        // Sum the candidates considered across calls so the counter reflects
        // total upstream work, not just this round.
        candidatesConsidered: lookup.candidatesConsidered + data.candidatesConsidered,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setFindMoreLoading(false);
    }
  };

  const pickItem = async (item: LookupItem) => {
    setError(null);
    setSelectedItem(item);
    setExtract(null);
    setPhotos([]);
    setSelectedPhoto(null);
    setChatMessages([]);
    setLastPatchFields([]);
    setLayoutOverrides({});
    setPhotoQuery("");
    setPhotoOffset(0);
    setPhotoQueryHistory([]);
    setStep("photo");
    setExtractLoading(true);
    try {
      const r = await fetch("/api/news/extract-person", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.extractPayload),
      });
      if (!r.ok) throw new Error(await r.text());
      const data: ExtractResult = await r.json();
      setExtract(data);
      if (data.person?.name) loadPhotos(data.person.name, 0, true);
    } catch (e) {
      setError(String(e));
    } finally {
      setExtractLoading(false);
    }
  };

  // `recordHistory` controls whether this query goes into the
  // "don't suggest these again" list — true for new queries, false for
  // re-pagination of the same query.
  const loadPhotos = async (query: string, offset: number, recordHistory: boolean) => {
    setPhotosLoading(true);
    setPhotoQuery(query);
    setPhotoOffset(offset);
    if (recordHistory) {
      setPhotoQueryHistory((h) => (h.includes(query) ? h : [...h, query]));
    }
    try {
      const r = await fetch("/api/photos/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, count: 3, offset }),
      });
      if (!r.ok) throw new Error(await r.text());
      const fresh: Photo[] = await r.json();
      setPhotos(fresh);
      // If the new batch happens to contain the currently-selected photo's URL
      // we keep it; otherwise drop the selection so the user actively re-picks.
      setSelectedPhoto((cur) => (cur && fresh.some((p) => p.url === cur.url) ? cur : null));
    } catch (e) {
      setError(String(e));
    } finally {
      setPhotosLoading(false);
    }
  };

  // Same query, next 3 results from SerpAPI.
  const reloadPhotos = () => {
    if (!photoQuery) return;
    loadPhotos(photoQuery, photoOffset + 3, false);
  };

  // Ask DeepSeek for a fresh query, then search with it.
  const rewritePhotoQuery = async () => {
    if (!extract?.person.name) return;
    setError(null);
    setPhotoQueryRewriting(true);
    try {
      const r = await fetch("/api/photos/rewrite-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personName: extract.person.name,
          personSummary: extract.person.summary,
          previousQueries: photoQueryHistory,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const { query } = (await r.json()) as { query: string };
      await loadPhotos(query, 0, true);
    } catch (e) {
      setError(String(e));
    } finally {
      setPhotoQueryRewriting(false);
    }
  };

  const buildCard = (): PopulateContext | null => {
    if (!extract?.talent || !selectedItem || !selectedPhoto) return null;
    return {
      photoUrl: selectedPhoto.url,
      headline: selectedItem.caption,
      source: selectedItem.sourceName,
      pubDate: selectedItem.publishedAt,
      pauvAngle: extract.pauvAngle || extract.person.summary,
      talent: {
        name: extract.talent.name,
        ticker: extract.talent.ticker,
        industry: extract.talent.industry,
        subcategory: extract.talent.subcategory,
        location: extract.talent.location,
        bio: extract.talent.bio,
        price: {
          usd: extract.talent.price.usd,
          lifetimeChangePct: extract.talent.price.lifetimeChangePct,
          holders: extract.talent.price.holders,
          volumeLifetimeUsd: extract.talent.price.volumeLifetimeUsd,
        },
      },
    };
  };

  // Ask DeepSeek to rewrite headline + subcaption copy so it fits the chosen
  // template's tone. We send the text-role slots and a budget derived from
  // the slot's width × height (rough char estimate). Image roles get
  // populated client-side from context — no DeepSeek needed.
  const populateWithDeepSeek = async () => {
    const ctx = buildCard();
    const tpl = templates.find((t) => t.id === selectedTemplateId);
    if (!ctx || !tpl) return;
    setPopulating(true);
    setError(null);
    try {
      const textSlots = tpl.doc.layers
        .filter((l) => l.type === "text")
        // Only rewrite the prose roles; everything else (ticker, price, etc.)
        // is a structured field, not something DeepSeek should reinvent.
        .filter((l) => l.role === "headline" || l.role === "subcaption" || l.role === "static")
        .map((l) => ({
          id: l.id,
          role: l.role,
          // Char budget: width * height / (fontSize^2 * 0.5) is a crude
          // upper bound; clamped so we don't ask for a paragraph in a chip.
          maxChars: Math.max(20, Math.min(280, Math.floor((l.width * l.height) / (l.fontSize * l.fontSize * 0.5)))),
        }));
      if (textSlots.length === 0) {
        setOverrides({});
        return;
      }
      const r = await fetch("/api/templates/populate-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slots: textSlots,
          context: {
            headline: ctx.headline,
            source: ctx.source,
            pubDate: ctx.pubDate,
            pauvAngle: ctx.pauvAngle,
            person: extract?.person ? { name: extract.person.name, summary: extract.person.summary } : undefined,
            talent: {
              name: ctx.talent.name,
              ticker: ctx.talent.ticker,
              industry: ctx.talent.industry,
              subcategory: ctx.talent.subcategory,
              location: ctx.talent.location,
              price: { usd: ctx.talent.price.usd, lifetimeChangePct: ctx.talent.price.lifetimeChangePct },
            },
          },
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data: { results: CopyOverrides } = await r.json();
      setOverrides(data.results);
    } catch (e) {
      setError(String(e));
    } finally {
      setPopulating(false);
    }
  };

  const downloadCard = async () => {
    if (!cardEl) return;
    setSaving(true);
    try {
      const dataUrl = await toPng(cardEl, {
        pixelRatio: 1,
        cacheBust: true,
        backgroundColor: "#0a0a0b",
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      const ticker = extract?.talent?.ticker ?? "card";
      a.download = `pauv-${ticker}-${Date.now()}.png`;
      a.click();
    } catch (e) {
      setError(`Couldn't render card: ${e}. (Sometimes the photo's host blocks cross-origin canvas — try another photo.)`);
    } finally {
      setSaving(false);
    }
  };

  const restart = () => {
    setStep("industry");
    setLookup(null);
    setExtract(null);
    setSelectedItem(null);
    setPhotos([]);
    setSelectedPhoto(null);
    setChatMessages([]);
    setLastPatchFields([]);
    setLayoutOverrides({});
    setError(null);
  };

  // Free-form DeepSeek chat that can edit caption / mainPerson / summary /
  // pauvAngle / matchedTicker. Patches apply immediately. If mainPerson
  // changes, photos auto-re-fetch from SerpAPI.
  const sendChat = async () => {
    const msg = chatInput.trim();
    if (!msg || !selectedItem || !extract || chatLoading) return;
    setChatInput("");
    const newHistory: ChatMsg[] = [...chatMessages, { role: "user", content: msg }];
    setChatMessages(newHistory);
    setChatLoading(true);
    try {
      const r = await fetch("/api/news/chat-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newHistory,
          state: {
            caption: selectedItem.caption,
            mainPerson: selectedItem.mainPerson,
            summary: extract.person.summary,
            pauvAngle: extract.pauvAngle,
            matchedTicker: extract.person.matchedTicker,
          },
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = (await r.json()) as {
        reply: string;
        patch: {
          caption?: string;
          mainPerson?: string;
          summary?: string;
          pauvAngle?: string;
          matchedTicker?: string | null;
        };
        newTalent?: Talent | null;
      };
      setChatMessages([...newHistory, { role: "assistant", content: data.reply }]);

      const changed: string[] = [];
      const prevMainPerson = selectedItem.mainPerson;

      // selectedItem fields
      if (data.patch.caption !== undefined || data.patch.mainPerson !== undefined) {
        setSelectedItem({
          ...selectedItem,
          ...(data.patch.caption !== undefined && { caption: data.patch.caption }),
          ...(data.patch.mainPerson !== undefined && { mainPerson: data.patch.mainPerson }),
        });
        if (data.patch.caption !== undefined) changed.push("caption");
        if (data.patch.mainPerson !== undefined) changed.push("mainPerson");
      }

      // extract fields
      const extractTouched =
        data.patch.summary !== undefined ||
        data.patch.pauvAngle !== undefined ||
        data.patch.matchedTicker !== undefined ||
        data.newTalent !== undefined;
      if (extractTouched) {
        setExtract({
          ...extract,
          person: {
            ...extract.person,
            ...(data.patch.summary !== undefined && { summary: data.patch.summary }),
            ...(data.patch.matchedTicker !== undefined && {
              matchedTicker: data.patch.matchedTicker,
              isPauvTalent: !!data.patch.matchedTicker,
            }),
          },
          ...(data.patch.pauvAngle !== undefined && { pauvAngle: data.patch.pauvAngle }),
          // newTalent comes back only when matchedTicker is in the patch.
          ...(data.newTalent !== undefined && { talent: data.newTalent }),
        });
        if (data.patch.summary !== undefined) changed.push("summary");
        if (data.patch.pauvAngle !== undefined) changed.push("pauvAngle");
        if (data.patch.matchedTicker !== undefined) changed.push("matchedTicker");
      }

      setLastPatchFields(changed);

      // If the subject changed, the existing photos are wrong — re-fetch.
      if (
        data.patch.mainPerson !== undefined &&
        data.patch.mainPerson &&
        data.patch.mainPerson !== prevMainPerson
      ) {
        setSelectedPhoto(null);
        setPhotoQueryHistory([]);
        loadPhotos(data.patch.mainPerson, 0, true);
      }
    } catch (e) {
      setChatMessages([
        ...newHistory,
        { role: "assistant", content: `Error: ${e}` },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  // Auto-scroll the chat to the bottom whenever a message lands.
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages, chatLoading]);

  // ---- render ----

  return (
    <div className="layout">
      <Sidebar current="news-industry" />
      <div className="layout-main">
      <div className="app-header">
        <div>
          <h1>News Cards</h1>
          <div className="subtitle">
            Industry → news about a person → photo → branded card you can save.
          </div>
        </div>
        <div className="row">
          {step !== "industry" && (
            <button className="secondary" onClick={restart}>← Start over</button>
          )}
        </div>
      </div>

      <StepBar step={step} />

      {error && <div className="status err" style={{ whiteSpace: "pre-wrap" }}>{error}</div>}

      {step === "industry" && (() => {
        const chosen = industries.find((i) => i.singular === industry);
        const pauvOnlyDisabled = !!chosen && chosen.talentCount === 0;
        // If the user picks an industry with 0 Pauv talents, flip the toggle
        // off automatically so they don't accidentally run an empty lookup.
        const effectivePauvOnly = pauvOnlyDisabled ? false : pauvOnly;
        return (
          <div className="card">
            <h2>Pick an industry</h2>
            <div className="file-meta" style={{ marginBottom: 12 }}>
              Count = Pauv talents currently in that industry. Pick one with 0
              and you'll have to use "Anyone" mode.
            </div>
            <div className="phones" style={{ marginBottom: 16 }}>
              {industries.map((ind) => {
                const active = industry === ind.singular;
                const empty = ind.talentCount === 0;
                return (
                  <label
                    key={ind.singular}
                    className={`phone-pill${active ? " checked" : ""}`}
                    style={empty ? { opacity: 0.55 } : undefined}
                    title={empty ? "No Pauv talents in this industry yet" : `${ind.talentCount} on Pauv (${ind.withXHandle} with X)`}
                  >
                    <input
                      type="radio"
                      name="industry"
                      checked={active}
                      onChange={() => setIndustry(ind.singular)}
                    />
                    {ind.plural}
                    <span className="file-meta" style={{ marginLeft: 6 }}>
                      ({ind.talentCount})
                    </span>
                  </label>
                );
              })}
            </div>

            <label
              className="checkbox"
              style={{ marginTop: 8, opacity: pauvOnlyDisabled ? 0.5 : 1 }}
              title={pauvOnlyDisabled ? "No Pauv talents in this industry — use Anyone mode instead" : undefined}
            >
              <input
                type="checkbox"
                checked={effectivePauvOnly}
                disabled={pauvOnlyDisabled}
                onChange={(e) => setPauvOnly(e.target.checked)}
              />
              <span>
                Only people currently on Pauv in this industry
                {chosen && (
                  <span className="file-meta" style={{ marginLeft: 8 }}>
                    ({chosen.talentCount} talent{chosen.talentCount === 1 ? "" : "s"}, {chosen.withXHandle} with X handle)
                  </span>
                )}
              </span>
            </label>

            <div className="row" style={{ marginTop: 16 }}>
              <button onClick={runLookup} disabled={!industry || lookupLoading}>
                {lookupLoading ? "Looking up…" : "Lookup news"}
              </button>
            </div>

          </div>
        );
      })()}

      {step === "stories" && lookup && (
        <div>
          <div className="card-header">
            <h2>
              {lookup.industry} · {lookup.mode === "pauv-only" ? "Pauv only" : "Anyone"}
              <span className="file-meta">
                {"  ·  "}{lookup.items.length} ranked · {lookup.candidatesConsidered} candidates · {lookup.curatorHandlesUsed} curators
              </span>
            </h2>
            <div className="row">
              <button
                className="secondary"
                onClick={findMore}
                disabled={lookupLoading || findMoreLoading}
                title="Pull a fresh batch and append items you haven't seen yet"
              >
                {findMoreLoading ? "Finding…" : "+ Find more"}
              </button>
              <button
                className="secondary"
                onClick={runLookup}
                disabled={lookupLoading || findMoreLoading}
              >
                {lookupLoading ? "Refreshing…" : "↻ Refresh"}
              </button>
            </div>
          </div>

          {lookup.curatorsError && (
            <div className="status err" style={{ whiteSpace: "pre-wrap" }}>
              Curators (Railway): {lookup.curatorsError}
            </div>
          )}
          {lookup.tweetsError && (
            <div className="status err" style={{ whiteSpace: "pre-wrap" }}>
              Tweets: {lookup.tweetsError}
            </div>
          )}
          {lookup.articlesError && (
            <div className="status err" style={{ whiteSpace: "pre-wrap" }}>
              Articles: {lookup.articlesError}
            </div>
          )}

          {lookup.items.length === 0 && (
            <div className="card empty" style={{ textAlign: "left" }}>
              {lookup.mode === "pauv-only" && lookup.pauvTalentCount === 0 ? (
                <>
                  No Pauv talents in <strong>{lookup.industry}</strong> yet, so
                  Pauv-only mode has no one to match against. Go back and uncheck
                  "Only people on Pauv" to see news about anyone in this industry.
                </>
              ) : lookup.mode === "pauv-only" ? (
                <>
                  Pulled {lookup.candidatesConsidered} candidate items from{" "}
                  {lookup.curatorHandlesUsed} curator{lookup.curatorHandlesUsed === 1 ? "" : "s"} + Newsdata,
                  but DeepSeek didn't find any clearly about a Pauv talent. Try refreshing or switch to "Anyone" mode.
                </>
              ) : lookup.curatorHandlesUsed === 0 ? (
                <>
                  No curator handles seeded in <code>news_sources</code> for{" "}
                  <strong>{lookup.industry}</strong> yet, and Newsdata returned no useful articles either.
                </>
              ) : (
                <>
                  Pulled {lookup.candidatesConsidered} candidate items but DeepSeek
                  didn't find any clearly about a single named person. Hit refresh.
                </>
              )}
            </div>
          )}

          {lookup.items.map((item, idx) => (
            <div
              key={`${item.url}-${idx}`}
              className="file"
              style={{ cursor: "pointer" }}
              onClick={() => pickItem(item)}
            >
              <div className="file-header">
                <div className="file-name">{item.caption}</div>
                <div className="file-meta">
                  {item.source === "tweet" ? "🐦" : "📰"} {item.sourceName}
                  {item.publishedAt ? ` · ${item.publishedAt}` : ""}
                  {item.likeCount != null ? ` · ♥ ${item.likeCount.toLocaleString()}` : ""}
                </div>
              </div>
              {item.mainPerson && (
                <div className="file-meta" style={{ marginTop: 6 }}>
                  About: <strong>{item.mainPerson}</strong>
                  {item.matchedTicker
                    ? <span style={{ color: "#22c55e" }}>  · on Pauv as ${item.matchedTicker}</span>
                    : <span style={{ color: "#9ca3af" }}>  · not on Pauv</span>}
                </div>
              )}
              {item.rawText && item.rawText !== item.caption && (
                <div className="file-meta" style={{ marginTop: 6, opacity: 0.7 }}>
                  Original: "{item.rawText.slice(0, 240)}{item.rawText.length > 240 ? "…" : ""}"
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {step === "photo" && selectedItem && (
        <div className="grid">
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <div className="card">
            <h2>{selectedItem.source === "article" ? "The article" : "The tweet"}</h2>
            <div className="file-name">{selectedItem.caption}</div>
            <div className="file-meta" style={{ marginTop: 6 }}>
              {selectedItem.source === "tweet" ? "🐦" : "📰"} {selectedItem.sourceName}
              {selectedItem.publishedAt ? ` · ${selectedItem.publishedAt}` : ""}
              {selectedItem.likeCount != null ? ` · ♥ ${selectedItem.likeCount.toLocaleString()}` : ""}
            </div>
            {selectedItem.rawText && selectedItem.rawText !== selectedItem.caption && (
              <div style={{ marginTop: 8, fontSize: 14, opacity: 0.8, fontStyle: "italic" }}>
                "{selectedItem.rawText}"
              </div>
            )}
            {extractLoading && <div className="empty">DeepSeek is identifying the person…</div>}
            {extract && (
              <>
                <div style={{ marginTop: 16 }}>
                  <div className="file-meta">Person</div>
                  <div className="file-name">
                    {extract.person.name}
                    {extract.person.isPauvTalent
                      ? <span style={{ color: "#22c55e" }}>  · on Pauv as ${extract.person.matchedTicker}</span>
                      : <span style={{ color: "#ef4444" }}>  · not on Pauv</span>}
                  </div>
                  <div className="file-meta" style={{ marginTop: 6 }}>{extract.person.summary}</div>
                </div>
                {extract.talent && (
                  <div style={{ marginTop: 16 }}>
                    <div className="file-meta">Pauv tie-in (DeepSeek)</div>
                    <div className="status ok" style={{ marginTop: 4 }}>{extract.pauvAngle}</div>
                    <div className="file-meta" style={{ marginTop: 12 }}>
                      Current NPSI: <strong>${extract.talent.price.usd?.toFixed(2)}</strong>
                      {" · "}
                      {extract.talent.price.lifetimeChangePct != null && (
                        <span>{extract.talent.price.lifetimeChangePct.toFixed(1)}% lifetime</span>
                      )}
                      {" · "}{extract.talent.price.holders ?? 0} holder(s)
                    </div>
                  </div>
                )}
                {!extract.talent && !extractLoading && (
                  <div className="status err" style={{ marginTop: 12 }}>
                    This person isn't on Pauv yet — can't generate the price card. Pick a different story or switch to the Pauv-only lookup mode.
                  </div>
                )}
              </>
            )}
          </div>

          {extract && (
            <div className="card">
              <h2>✨ Refine with DeepSeek</h2>
              <div className="file-meta" style={{ marginBottom: 12 }}>
                Ask for changes to anything on the card — caption, person, summary, Pauv tie-in, or which ticker it's matched to. Changes apply immediately.
              </div>
              <div
                ref={chatScrollRef}
                style={{
                  maxHeight: 320,
                  overflowY: "auto",
                  marginBottom: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  padding: 8,
                  background: "#141416",
                  borderRadius: 8,
                }}
              >
                {chatMessages.length === 0 && (
                  <div className="empty" style={{ fontSize: 13, textAlign: "left", padding: 8 }}>
                    Try: <em>"Make the caption punchier"</em>, <em>"Actually this is about Pep Guardiola"</em>, <em>"Rewrite the Pauv angle around streaming numbers"</em>, <em>"Match this to ticker XYZ"</em>.
                  </div>
                )}
                {chatMessages.map((m, i) => {
                  const isUser = m.role === "user";
                  const isLastAssistant =
                    !isUser && i === chatMessages.length - 1 && lastPatchFields.length > 0;
                  return (
                    <div
                      key={i}
                      style={{
                        alignSelf: isUser ? "flex-end" : "flex-start",
                        maxWidth: "85%",
                        padding: "8px 12px",
                        borderRadius: 12,
                        background: isUser ? "#22c55e22" : "#1f1f22",
                        color: "#fafafa",
                        fontSize: 14,
                        whiteSpace: "pre-wrap",
                        lineHeight: 1.4,
                      }}
                    >
                      {m.content}
                      {isLastAssistant && (
                        <div style={{ marginTop: 6, color: "#22c55e", fontSize: 12 }}>
                          ✓ updated {lastPatchFields.join(", ")}
                        </div>
                      )}
                    </div>
                  );
                })}
                {chatLoading && (
                  <div
                    style={{
                      alignSelf: "flex-start",
                      padding: "8px 12px",
                      color: "#9ca3af",
                      fontSize: 14,
                    }}
                  >
                    Thinking…
                  </div>
                )}
              </div>
              <div className="row" style={{ alignItems: "stretch", gap: 8 }}>
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendChat();
                    }
                  }}
                  rows={2}
                  placeholder="Ask DeepSeek for a change…  (Enter to send, Shift+Enter for newline)"
                  style={{
                    flex: 1,
                    resize: "vertical",
                    padding: 10,
                    borderRadius: 8,
                    background: "#1a1a1c",
                    color: "#fafafa",
                    border: "1px solid #2a2a2c",
                    fontSize: 14,
                    fontFamily: "inherit",
                  }}
                  disabled={chatLoading}
                />
                <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()}>
                  Send
                </button>
              </div>
            </div>
          )}
          </div>

          <div className="card">
            <h2>Pick a photo (3 from Google)</h2>

            {/* Query controls: edit by hand, reload for next page, or ask
                DeepSeek for a fresh angle. */}
            {extract?.person?.name && (
              <>
                <div className="row" style={{ marginBottom: 8, gap: 6, flexWrap: "nowrap" }}>
                  <input
                    type="text"
                    value={photoQuery}
                    onChange={(e) => setPhotoQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") loadPhotos(photoQuery, 0, true);
                    }}
                    placeholder="Search query"
                    style={{
                      flex: 1, minWidth: 0,
                      background: "#0f1115", border: "1px solid #242832",
                      color: "#e6e8eb", padding: "7px 10px", borderRadius: 6,
                      fontSize: 13, fontFamily: "inherit",
                    }}
                  />
                  <button
                    className="secondary"
                    onClick={() => loadPhotos(photoQuery, 0, true)}
                    disabled={!photoQuery.trim() || photosLoading}
                    title="Search Google Images with this query"
                  >
                    Search
                  </button>
                </div>
                <div className="row" style={{ marginBottom: 12, gap: 6 }}>
                  <button
                    className="secondary"
                    onClick={reloadPhotos}
                    disabled={!photoQuery || photosLoading}
                    title="Same query, next results from SerpAPI"
                  >
                    ↻ Reload (next 3)
                  </button>
                  <button
                    className="secondary"
                    onClick={rewritePhotoQuery}
                    disabled={photoQueryRewriting || photosLoading}
                    title="Ask DeepSeek to suggest a different search angle"
                  >
                    {photoQueryRewriting ? "Rewriting…" : "✨ Rewrite query (DeepSeek)"}
                  </button>
                </div>
              </>
            )}

            {photosLoading && <div className="empty">Searching SerpAPI…</div>}
            {!photosLoading && photos.length === 0 && (
              <div className="empty">
                {extract?.person?.name
                  ? "No photos on this page — try Reload or Rewrite query."
                  : "Photos will appear once the person is identified."}
              </div>
            )}
            <div className="phones">
              {photos.map((p) => {
                const active = selectedPhoto?.url === p.url;
                return (
                  <div
                    key={p.url}
                    onClick={() => setSelectedPhoto(p)}
                    style={{
                      cursor: "pointer",
                      border: active ? "3px solid #22c55e" : "3px solid transparent",
                      borderRadius: 8,
                      overflow: "hidden",
                      width: 200, height: 200,
                      background: "#1a1a1c",
                    }}
                  >
                    <img
                      src={p.thumbnail}
                      alt={p.title ?? ""}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  </div>
                );
              })}
            </div>
            {selectedPhoto?.source && (
              <div className="file-meta" style={{ marginTop: 8 }}>
                📸 Credit: <strong>{selectedPhoto.source}</strong> — verify usage rights before publishing.
              </div>
            )}
            {selectedPhoto && (
              <div className="row" style={{ marginTop: 16 }}>
                <button
                  onClick={() => setStep("card")}
                  disabled={!extract?.talent || !selectedPhoto}
                >
                  Build card →
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {step === "card" && buildCard() && (() => {
        const ctx = buildCard()!;
        const tpl = templates.find((t) => t.id === selectedTemplateId);
        return (
          <div>
            <div className="card-header" style={{ marginBottom: 16 }}>
              <h2>Card preview</h2>
              <div className="row">
                <button className="secondary" onClick={() => setStep("photo")}>← Change photo</button>
                <button
                  className="secondary"
                  onClick={populateWithDeepSeek}
                  disabled={!tpl || populating}
                  title="Rewrite the headline + subcaption copy to fit this template"
                >
                  {populating ? "Populating…" : "✨ Populate with DeepSeek"}
                </button>
                <button onClick={downloadCard} disabled={saving || !tpl}>
                  {saving ? "Saving…" : "💾 Save as PNG"}
                </button>
              </div>
            </div>

            {/* Template picker — thumbnails so you can see what you're choosing. */}
            <div className="card" style={{ marginBottom: 16 }}>
              <h2>Template</h2>
              {templates.length === 0 ? (
                <div className="empty-inline">
                  No templates yet. Open the <strong>Templates</strong> tab and create one.
                </div>
              ) : (
                <div className="template-picker-row">
                  {templates.map((t) => {
                    const active = t.id === selectedTemplateId;
                    return (
                      <div
                        key={t.id}
                        className={`template-picker-thumb${active ? " active" : ""}`}
                        onClick={() => {
                          setSelectedTemplateId(t.id);
                          setOverrides(null);
                          // Layer ids differ between templates, so positional
                          // overrides from the previous template don't apply.
                          setLayoutOverrides({});
                        }}
                      >
                        <div className="template-picker-thumb-img">
                          <div style={{
                            transform: `scale(${120 / t.doc.width})`,
                            transformOrigin: "top left",
                            width: t.doc.width, height: t.doc.height,
                          }}>
                            <TemplateRenderer doc={t.doc} context={ctx} />
                          </div>
                        </div>
                        <div className="template-picker-thumb-name">{t.name}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {tpl && (
              <div style={{
                display: "flex", justifyContent: "center",
                background: "#141416", padding: 24, borderRadius: 12, overflow: "auto",
              }}>
                <div style={{
                  transform: "scale(0.5)",
                  transformOrigin: "top center",
                  width: tpl.doc.width, height: tpl.doc.height,
                  position: "relative",
                }}>
                  <TemplateRenderer
                    doc={tpl.doc}
                    context={ctx}
                    overrides={overrides}
                    layoutOverrides={layoutOverrides}
                    refEl={setCardEl}
                  />
                  <CardLayoutOverlay
                    doc={tpl.doc}
                    overrides={layoutOverrides}
                    cardEl={cardEl}
                    scale={0.5}
                    onChange={setLayoutOverrides}
                  />
                </div>
              </div>
            )}
            <div className="file-meta" style={{ marginTop: 8, textAlign: "center" }}>
              Drag text to reposition · Drag the photo to reframe
              {Object.keys(layoutOverrides).length > 0 && (
                <>
                  {" · "}
                  <button
                    className="secondary small"
                    style={{ padding: "2px 8px", fontSize: 12 }}
                    onClick={() => setLayoutOverrides({})}
                  >
                    ↺ Reset layout
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })()}
      </div>
    </div>
  );
}

function StepBar({ step }: { step: Step }) {
  const steps: Array<{ key: Step; label: string }> = [
    { key: "industry", label: "1. Industry" },
    { key: "stories", label: "2. Stories" },
    { key: "photo", label: "3. Photo" },
    { key: "card", label: "4. Card" },
  ];
  const idx = steps.findIndex((s) => s.key === step);
  return (
    <div className="row" style={{ margin: "12px 0 20px", gap: 8 }}>
      {steps.map((s, i) => (
        <div
          key={s.key}
          style={{
            padding: "6px 14px", borderRadius: 999, fontSize: 13,
            background: i <= idx ? "#22c55e22" : "#1a1a1c",
            color: i <= idx ? "#22c55e" : "#6b7280",
            border: i === idx ? "1px solid #22c55e" : "1px solid #1f1f22",
            fontWeight: i === idx ? 700 : 500,
          }}
        >
          {s.label}
        </div>
      ))}
    </div>
  );
}
