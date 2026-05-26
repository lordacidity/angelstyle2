import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { chat, parseJson, type ChatMessage } from "./deepseek.js";
import { searchTweets, type Tweet } from "./twitter.js";
import { getHandlesByIndustry } from "./newsSources.js";
import { searchGoogleNews } from "./googleNews.js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const NEWS_KEY = process.env.NEWSDATA_API_KEY ?? "";

// Node <22 has no native WebSocket; supabase-js bootstraps realtime in the
// client constructor, so hand it the `ws` polyfill explicitly.
const sb =
  SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY, {
        realtime: { transport: ws as unknown as typeof WebSocket },
        auth: { persistSession: false },
      })
    : null;

export interface ProfileRow {
  id: string;
  ticker: string;
  name: string;
  bio: string | null;
  photo_url: string | null;
  industry: string | null;
  info_subcategory: string | null;
  info_location: string | null;
  social_instagram: string | null;
  social_x: string | null;
  social_youtube: string | null;
  social_website: string | null;
  claim_status: string | null;
  delisted_at: string | null;
}

export interface MarketRow {
  profile_id: string;
  latest_price_cents: number | null;
  latest_price_microusdc: number | null;
  p0: number | null;
  holders_count: number | null;
  total_volume_lifetime_cents: number | null;
  latest_tick_at: string | null;
  frozen: boolean | null;
}

export interface Talent {
  id: string;
  ticker: string;
  name: string;
  bio: string | null;
  photo_url: string | null;
  industry: string | null;
  subcategory: string | null;
  location: string | null;
  socials: { instagram?: string; x?: string; youtube?: string; website?: string };
  price: {
    cents: number | null;       // current NPSI in cents
    usd: number | null;         // = cents/100
    p0Cents: number | null;     // initial price
    lifetimeChangePct: number | null; // (cents - p0) / p0 * 100
    holders: number | null;
    volumeLifetimeUsd: number | null;
    latestTickAt: string | null;
    frozen: boolean;
  };
  claimStatus: string | null;
  delistedAt: string | null;
}

function toTalent(p: ProfileRow, m: MarketRow | null): Talent {
  const cents = m?.latest_price_cents ?? null;
  const p0 = m?.p0 ?? null;
  const lifetime =
    cents != null && p0 != null && p0 > 0 ? ((cents - p0) / p0) * 100 : null;
  return {
    id: p.id,
    ticker: p.ticker,
    name: p.name,
    bio: p.bio,
    photo_url: p.photo_url && p.photo_url.length > 0 ? p.photo_url : null,
    industry: p.industry,
    subcategory: p.info_subcategory,
    location: p.info_location,
    socials: {
      instagram: p.social_instagram || undefined,
      x: p.social_x || undefined,
      youtube: p.social_youtube || undefined,
      website: p.social_website || undefined,
    },
    price: {
      cents,
      usd: cents != null ? cents / 100 : null,
      p0Cents: p0,
      lifetimeChangePct: lifetime,
      holders: m?.holders_count ?? null,
      volumeLifetimeUsd:
        m?.total_volume_lifetime_cents != null ? m.total_volume_lifetime_cents / 100 : null,
      latestTickAt: m?.latest_tick_at ?? null,
      frozen: m?.frozen ?? false,
    },
    claimStatus: p.claim_status,
    delistedAt: p.delisted_at,
  };
}

export async function listTalents(): Promise<Talent[]> {
  if (!sb) throw new Error("Supabase not configured (check root .env)");
  // profiles and markets aren't FK-linked through PostgREST embedding here, so
  // fetch both and zip in memory. With ~100 profiles this is fine.
  const [{ data: profiles, error: pErr }, { data: markets, error: mErr }] = await Promise.all([
    sb.from("profiles").select("*").is("delisted_at", null),
    sb.from("markets").select("*"),
  ]);
  if (pErr) throw new Error(`profiles: ${pErr.message}`);
  if (mErr) throw new Error(`markets: ${mErr.message}`);
  const byProfile = new Map<string, MarketRow>(
    (markets as MarketRow[] | null ?? []).map((m) => [m.profile_id, m]),
  );
  return (profiles as ProfileRow[] | null ?? [])
    .map((p) => toTalent(p, byProfile.get(p.id) ?? null))
    .sort((a, b) => (b.price.usd ?? 0) - (a.price.usd ?? 0));
}

// ---------- newsdata.io ----------

export interface NewsArticle {
  title: string;
  link: string;
  description: string | null;
  pubDate: string | null;
  source_id: string | null;
  image_url: string | null;
  creator: string[] | null;
  category: string[] | null;
}

interface NewsdataResponse {
  status: string;
  totalResults?: number;
  results?: NewsArticle[];
  message?: string;
}

export async function searchNews(opts: { q?: string; size?: number; timeframeHours?: number } = {}): Promise<{
  total: number;
  articles: NewsArticle[];
}> {
  if (!NEWS_KEY) throw new Error("NEWSDATA_API_KEY not set");
  const url = new URL("https://newsdata.io/api/1/latest");
  url.searchParams.set("apikey", NEWS_KEY);
  url.searchParams.set("language", "en");
  // newsdata caps free-tier `size` at 10 per request.
  url.searchParams.set("size", String(Math.min(opts.size ?? 10, 10)));
  if (opts.q) url.searchParams.set("q", opts.q);
  // NOTE: newsdata's `timeframe` parameter is a paid feature on their /latest
  // endpoint. We deliberately don't send it. Instead, the caller's intended
  // freshness window is enforced client-side by filtering on `pubDate` below.

  const res = await fetch(url);
  if (!res.ok) throw new Error(`newsdata ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as NewsdataResponse;
  if (json.status !== "success") throw new Error(`newsdata: ${json.message ?? "unknown"}`);

  let articles = json.results ?? [];
  if (opts.timeframeHours) {
    const cutoffMs = Date.now() - opts.timeframeHours * 3600_000;
    articles = articles.filter((a) => {
      if (!a.pubDate) return true; // keep articles missing timestamps — common for some sources
      const t = Date.parse(a.pubDate);
      if (!Number.isFinite(t)) return true;
      return t >= cutoffMs;
    });
  }
  return { total: articles.length, articles };
}

// Raw "news → person" entry point for step 1. No DeepSeek classification —
// the user picks an article, then the existing extract-person flow figures
// out who it's about. mainPerson is empty here intentionally.
export async function latestArticlesByIndustry(
  industrySingular: string,
  size = 5,
): Promise<LookupItem[]> {
  const { articles } = await searchNews({
    q: industrySingular,
    size,
    timeframeHours: 48,
  });
  return articles.map((a) => ({
    caption: a.title,
    source: "article" as const,
    url: a.link,
    mainPerson: "",
    publishedAt: a.pubDate,
    imageUrl: a.image_url,
    rawText: a.title,
    sourceName: a.source_id ?? "news",
    extractPayload: {
      title: a.title,
      description: a.description,
    },
  }));
}

export async function newsForTalent(ticker: string): Promise<{
  talent: Talent;
  news: NewsArticle[];
  total: number;
}> {
  const talents = await listTalents();
  const t = talents.find((x) => x.ticker === ticker);
  if (!t) throw new Error(`unknown ticker: ${ticker}`);
  const { total, articles } = await searchNews({ q: `"${t.name}"`, size: 10 });
  return { talent: t, news: articles, total };
}

// ---------- industries ----------

export interface Industry {
  plural: string;
  singular: string;
  sort_order: number;
  active: boolean;
  talentCount: number;     // # of Pauv talents currently in this industry
  withXHandle: number;     // # of those that have a social_x URL linked
}

export async function listIndustries(): Promise<Industry[]> {
  if (!sb) throw new Error("Supabase not configured");
  const [{ data, error }, talents] = await Promise.all([
    sb.from("industries")
      .select("plural, singular, sort_order, active")
      .eq("active", true)
      .order("sort_order"),
    listTalents(),
  ]);
  if (error) throw new Error(`industries: ${error.message}`);
  const counts = new Map<string, number>();
  const xHandles = new Map<string, number>();
  for (const t of talents) {
    if (!t.industry) continue;
    counts.set(t.industry, (counts.get(t.industry) ?? 0) + 1);
    if (t.socials.x) xHandles.set(t.industry, (xHandles.get(t.industry) ?? 0) + 1);
  }
  return (data as Array<Omit<Industry, "talentCount" | "withXHandle">> | null ?? []).map((i) => ({
    ...i,
    talentCount: counts.get(i.singular) ?? 0,
    withXHandle: xHandles.get(i.singular) ?? 0,
  }));
}

// ---------- news lookup (curator-first, unified items) ----------
//
// Strategy: pull tweets FROM curator accounts seeded in Railway news_sources
// (never from talent handles), pull articles from Newsdata, merge into a
// single raw list, then DeepSeek captions + ranks + matches to Pauv roster
// in one call. Same pipeline for both modes; pauvOnly is a final filter.

export type NewsCategory =
  | "career"        // signings, releases, projects, role announcements
  | "business"      // deals, investments, sales, partnerships
  | "performance"   // on-field/on-court/on-stage results, awards
  | "statement"     // newsworthy public statement / interview / position
  | "controversy"   // scandal, legal, dispute — newsworthy but reputationally charged
  | "tabloid"       // gossip, dating, paparazzi, body-talk, lifestyle bait
  | "other";        // anything else worth surfacing but not in the above buckets

export interface LookupItem {
  caption: string;            // DeepSeek news-headline-style line (rewritten, not quoted)
  source: "tweet" | "article";
  url: string;
  mainPerson: string;
  matchedTicker?: string;     // present only when DeepSeek matched a roster ticker
  category?: NewsCategory;    // present only when DeepSeek classified it (Flow B path)
  publishedAt: string | null;
  imageUrl: string | null;
  rawText: string;            // original tweet text or article title (for context display)
  sourceName: string;         // "@PopCrave on X" or Newsdata source_id
  likeCount?: number;         // tweets only

  // Pre-built body for /api/news/extract-person so the UI can pass it through.
  extractPayload: {
    title?: string;
    description?: string | null;
    tweetText?: string;
    tweetAuthorName?: string;
    tweetAuthorHandle?: string;
  };
}

export interface LookupResult {
  industry: string;
  mode: "pauv-only" | "anyone";
  items: LookupItem[];
  candidatesConsidered: number;   // total raw tweets+articles before DeepSeek
  pauvTalentCount: number;
  curatorHandlesUsed: number;     // # of from: clauses actually packed into the query
  tweetsError?: string;
  articlesError?: string;
  curatorsError?: string;         // set when Railway news_sources lookup failed
}

function yesterdayISODate(): string {
  return new Date(Date.now() - 86400000).toISOString().split("T")[0];
}

// Defense-in-depth against DeepSeek picking the wrong roster ticker (e.g. "Ben
// Shelton" → $alcaraz because both are tennis players). Returns true when the
// two names share at least one substantive token, treating short prefixes as
// matches so nicknames like "Wemby" ↔ "Victor Wembanyama" still pass.
const NAME_STOP_WORDS = new Set([
  "jr", "sr", "ii", "iii", "iv", "the", "de", "la", "van", "von",
  "pope", "king", "queen", "prince", "princess",
]);

function tokenizeName(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !NAME_STOP_WORDS.has(w));
}

export function namesPlausiblyMatch(person: string, rosterName: string): boolean {
  const a = tokenizeName(person);
  const b = tokenizeName(rosterName);
  if (a.length === 0 || b.length === 0) return false;
  for (const p of a) {
    for (const r of b) {
      if (p === r) return true;
      // Nickname-as-prefix: "Wemby" vs "Wembanyama". Require >=4 chars on the
      // shorter side so we don't false-positive on tiny prefixes like "Le".
      if (p.length >= 4 && r.startsWith(p)) return true;
      if (r.length >= 4 && p.startsWith(r)) return true;
    }
  }
  return false;
}

// (from:H1 OR from:H2 OR ...) -filter:replies -filter:retweets min_faves:N since:YYYY-MM-DD
// Twitter caps advanced-search at ~512 chars; pack as many handles as fit.
function buildCuratorTweetQuery(
  handles: string[],
  opts: { minFaves: number; maxLen?: number },
): { query: string; used: number } {
  const suffix = ` -filter:replies -filter:retweets min_faves:${opts.minFaves} since:${yesterdayISODate()}`;
  const headroom = (opts.maxLen ?? 480) - suffix.length - 2; // 2 for the wrapping ()
  const kept: string[] = [];
  let used = 0;
  for (const h of handles) {
    const piece = `from:${h}`;
    const cost = piece.length + (kept.length > 0 ? 4 : 0); // " OR "
    if (used + cost > headroom) break;
    kept.push(piece);
    used += cost;
  }
  return { query: `(${kept.join(" OR ")})${suffix}`, used: kept.length };
}

// OR-chain of "name" for the Newsdata query in pauvOnly mode. Newsdata's free
// tier rejects queries over 100 chars (422 UnsupportedQueryLength); cap at
// 95 to leave headroom for URL-encoding. Drops trailing names if they don't fit.
function buildNameOrQuery(names: string[]): string {
  const MAX = 95;
  const parts: string[] = [];
  let used = 0;
  for (const n of names) {
    const piece = `"${n}"`;
    const cost = piece.length + (parts.length > 0 ? 4 : 0); // " OR "
    if (used + cost > MAX) break;
    parts.push(piece);
    used += cost;
  }
  return parts.join(" OR ");
}

interface RawItem {
  type: "tweet" | "article";
  url: string;
  rawText: string;
  description: string | null;
  sourceName: string;
  publishedAt: string | null;
  imageUrl: string | null;
  likeCount?: number;
  tweetAuthorName?: string;
  tweetAuthorHandle?: string;
}

function tweetToRaw(t: Tweet): RawItem {
  return {
    type: "tweet",
    url: t.url,
    rawText: t.text,
    description: null,
    sourceName: `@${t.author.userName} on X`,
    publishedAt: t.createdAt || null,
    imageUrl: null,
    likeCount: t.likeCount,
    tweetAuthorName: t.author.name,
    tweetAuthorHandle: t.author.userName,
  };
}

function articleToRaw(a: NewsArticle): RawItem {
  return {
    type: "article",
    url: a.link,
    rawText: a.title,
    description: a.description,
    sourceName: a.source_id ?? "news",
    publishedAt: a.pubDate,
    imageUrl: a.image_url,
  };
}

export async function lookupNews(
  industrySingular: string,
  pauvOnly: boolean,
  exclude: string[] = [],
): Promise<LookupResult> {
  const allTalents = await listTalents();
  const industryTalents = allTalents.filter(
    (t) => t.industry?.toLowerCase() === industrySingular.toLowerCase(),
  );

  // ---- Twitter: curator FROM-chain (same for both modes; pauvOnly is filtered later) ----
  // Soft-fail on Railway hiccups (db not connected, table missing, etc.) so the
  // article path still works during local dev when Railway isn't wired up.
  let curatorHandles: string[] = [];
  let curatorsError: string | undefined;
  try {
    curatorHandles = await getHandlesByIndustry(industrySingular);
  } catch (err) {
    curatorsError = String(err);
  }
  const curator = buildCuratorTweetQuery(curatorHandles, { minFaves: 200 });

  // ---- Newsdata: name OR-chain when pauvOnly, otherwise the industry singular ----
  const articlesQuery = pauvOnly && industryTalents.length > 0
    ? buildNameOrQuery(industryTalents.map((t) => t.name))
    : industrySingular;

  const [tweetsResult, articlesResult] = await Promise.allSettled([
    curator.used > 0
      ? searchTweets({ query: curator.query, queryType: "Latest", maxItems: 20 })
      : Promise.resolve<Tweet[]>([]),
    // Newsdata free tier caps size at 10; raising it 422s.
    searchNews({ q: articlesQuery, size: 10 }),
  ]);

  const rawItems: RawItem[] = [];
  let tweetsError: string | undefined;
  let articlesError: string | undefined;

  if (tweetsResult.status === "fulfilled") {
    rawItems.push(...tweetsResult.value.map(tweetToRaw));
  } else {
    tweetsError = String(tweetsResult.reason);
  }
  if (articlesResult.status === "fulfilled") {
    rawItems.push(...articlesResult.value.articles.map(articleToRaw));
  } else {
    articlesError = String(articlesResult.reason);
  }

  if (rawItems.length === 0) {
    return {
      industry: industrySingular,
      mode: pauvOnly ? "pauv-only" : "anyone",
      items: [],
      candidatesConsidered: 0,
      pauvTalentCount: industryTalents.length,
      curatorHandlesUsed: curator.used,
      tweetsError,
      articlesError,
      curatorsError,
    };
  }

  // Drop already-seen items (for "Find more"). Done BEFORE DeepSeek so we don't
  // waste tokens on duplicates and so the picks are guaranteed to be net-new.
  const excludeSet = new Set(exclude);
  const eligible = excludeSet.size > 0
    ? rawItems.filter((r) => !excludeSet.has(r.url))
    : rawItems;

  if (eligible.length === 0) {
    return {
      industry: industrySingular,
      mode: pauvOnly ? "pauv-only" : "anyone",
      items: [],
      candidatesConsidered: rawItems.length,
      pauvTalentCount: industryTalents.length,
      curatorHandlesUsed: curator.used,
      tweetsError,
      articlesError,
      curatorsError,
    };
  }

  // ---- DeepSeek: caption + main person + ticker match + rank in one call ----
  const targetCount = 5;
  // Ask for a slightly larger pool when finding more, so pauvOnly filtering
  // still has a good chance of producing the full targetCount.
  const askCount = exclude.length > 0 ? Math.min(targetCount + 3, eligible.length) : targetCount;
  const roster = allTalents.map((t) => ({ ticker: t.ticker, name: t.name, industry: t.industry }));
  const compact = eligible.map((r, i) => ({
    i,
    type: r.type,
    source: r.sourceName,
    text: r.rawText,
    description: r.description ? r.description.slice(0, 240) : null,
  }));

  const pauvOnlyInstruction = pauvOnly
    ? `ONLY pick items whose main person is in the Pauv roster (skip any item not clearly about a roster name). If fewer than ${askCount} qualify, return fewer.`
    : `Pick the most newsworthy items regardless of whether the person is on the Pauv roster.`;

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a news editor curating a feed. For each item you pick you MUST do real work — " +
        "do NOT copy titles verbatim and do NOT leave fields empty. Specifically:\n\n" +
        "(a) CAPTION — REWRITE as a punchy news headline, ideally under 80 characters, " +
        "subject-verb-object, present tense, factual not opinion. Examples of the target style:\n" +
        "   Input: 'Stranger Things star Charlie Heaton to play Charles Shelby in Peaky Blinders series'\n" +
        "   Caption: 'Charlie Heaton joins Peaky Blinders as Charles Shelby'\n" +
        "   Input: 'BREAKING: LeBron James has officially surpassed Kareem Abdul-Jabbar for the all-time scoring record'\n" +
        "   Caption: 'LeBron beats Kareem to become all-time NBA scoring leader'\n" +
        "If the input is already a clean headline, you may keep it nearly identical, but strip filler words.\n\n" +
        "(b) PERSON — extract the single main person's real name from the headline. " +
        "If the headline names a person (e.g. 'Charlie Heaton', 'Pep Guardiola'), that's the person. " +
        "NEVER return an empty string for person — if no clear single person, SKIP the item entirely (don't include it in picks).\n\n" +
        "(c) TICKER — if that person matches a name in the Pauv roster, return their ticker. Otherwise null. " +
        "Never invent tickers.\n\n" +
        "RANK picks by news-worthiness: substantive > opinion, broad-impact > niche, breaking > evergreen. " +
        "Skip vibes, reactions, fan posts, ambiguous items, biography lists, or anything not about a single named person. " +
        "Return STRICT JSON.",
    },
    {
      role: "user",
      content:
        `Industry: ${industrySingular}\n\n` +
        `Pauv roster (ticker — name — industry):\n${roster.map((r) => `${r.ticker} — ${r.name} — ${r.industry ?? "?"}`).join("\n")}\n\n` +
        `Candidate items (indexed):\n${JSON.stringify(compact, null, 2)}\n\n` +
        `Pick up to ${askCount} items, ranked best first. ${pauvOnlyInstruction}\n\n` +
        `Respond with: {"picks": [{"i": <index>, "caption": "<rewritten headline>", "person": "<full real name>", "ticker": "<TICKER or null>"}]}`,
    },
  ];

  type Pick = { i: number; caption: string; person: string; ticker: string | null };
  let picks: Pick[] = [];
  try {
    const raw = await chat(messages, { json: true, temperature: 0.2 });
    picks = parseJson<{ picks: Pick[] }>(raw).picks ?? [];
  } catch (err) {
    // DeepSeek hiccup: fall back to eligible items with title-as-caption so
    // the user still sees a feed instead of an empty 500.
    console.error("[lookupNews] DeepSeek call failed, falling back:", err);
    picks = eligible.slice(0, askCount).map((r, i) => ({
      i,
      caption: r.rawText.slice(0, 140),
      person: "",
      ticker: null,
    }));
  }

  const tickerSet = new Set(allTalents.map((t) => t.ticker));
  const items: LookupItem[] = picks
    .filter((p) => eligible[p.i])
    .map((p) => {
      const r = eligible[p.i];
      const matchedTicker = p.ticker && tickerSet.has(p.ticker) ? p.ticker : undefined;
      return {
        caption: p.caption,
        source: r.type,
        url: r.url,
        mainPerson: p.person,
        matchedTicker,
        publishedAt: r.publishedAt,
        imageUrl: r.imageUrl,
        rawText: r.rawText,
        sourceName: r.sourceName,
        likeCount: r.likeCount,
        extractPayload: r.type === "tweet"
          ? {
              tweetText: r.rawText,
              tweetAuthorName: r.tweetAuthorName,
              tweetAuthorHandle: r.tweetAuthorHandle,
            }
          : {
              title: r.rawText,
              description: r.description,
            },
      };
    })
    .filter((item) => (pauvOnly ? !!item.matchedTicker : true))
    .slice(0, targetCount);

  return {
    industry: industrySingular,
    mode: pauvOnly ? "pauv-only" : "anyone",
    items,
    candidatesConsidered: eligible.length,
    pauvTalentCount: industryTalents.length,
    curatorHandlesUsed: curator.used,
    tweetsError,
    articlesError,
    curatorsError,
  };
}

// ---------- person-specific news (Flow C) ----------
//
// "Show me news ABOUT <talent> in the past 48h." Same item shape as the
// other lookups so the UI can share rendering. Strategy: pull curator tweets
// that mention the person's name + Newsdata articles for the same name, then
// DeepSeek captions + categorizes (no roster matching needed — person is
// fixed by ticker).

export interface PersonLookupResult {
  talent: Talent;
  items: LookupItem[];
  candidatesConsidered: number;
  curatorHandlesUsed: number;
  tweetsError?: string;
  articlesError?: string;
  curatorsError?: string;
}

// (from:H1 OR from:H2 OR ...) "Person Name" -filter:replies -filter:retweets since:YYYY-MM-DD
// Same headroom logic as buildCuratorTweetQuery, but reserving room for the
// quoted name filter. No min_faves: for a known talent, breaking news with low
// initial engagement is still interesting.
function buildPersonAboutQuery(
  handles: string[],
  personName: string,
  maxLen = 480,
): { query: string; used: number } {
  const namePart = ` "${personName}"`;
  const suffix = ` -filter:replies -filter:retweets since:${yesterdayISODate()}`;
  const headroom = maxLen - suffix.length - namePart.length - 2; // 2 for ()
  const kept: string[] = [];
  let used = 0;
  for (const h of handles) {
    const piece = `from:${h}`;
    const cost = piece.length + (kept.length > 0 ? 4 : 0);
    if (used + cost > headroom) break;
    kept.push(piece);
    used += cost;
  }
  return { query: `(${kept.join(" OR ")})${namePart}${suffix}`, used: kept.length };
}

export async function lookupPersonNews(
  ticker: string,
  exclude: string[] = [],
): Promise<PersonLookupResult> {
  const allTalents = await listTalents();
  const talent = allTalents.find((t) => t.ticker === ticker);
  if (!talent) throw new Error(`unknown ticker: ${ticker}`);

  // Curator handles for the talent's industry. Soft-fail so the Newsdata
  // path still works when Railway news_sources is unavailable.
  let curatorHandles: string[] = [];
  let curatorsError: string | undefined;
  if (talent.industry) {
    try {
      curatorHandles = await getHandlesByIndustry(talent.industry);
    } catch (err) {
      curatorsError = String(err);
    }
  }
  const curator = buildPersonAboutQuery(curatorHandles, talent.name);

  const [tweetsResult, articlesResult, googleResult] = await Promise.allSettled([
    curator.used > 0
      ? searchTweets({ query: curator.query, queryType: "Latest", maxItems: 20 })
      : Promise.resolve<Tweet[]>([]),
    searchNews({ q: `"${talent.name}"`, size: 10, timeframeHours: 48 }),
    // Free supplemental source: Google News RSS. Indexes most news sites
    // worldwide and isn't rate-limited like newsdata's free tier, so we
    // virtually always get hits for any well-known person.
    searchGoogleNews({ q: `"${talent.name}"`, timeframeHours: 48 }),
  ]);

  const rawItems: RawItem[] = [];
  let tweetsError: string | undefined;
  let articlesError: string | undefined;

  if (tweetsResult.status === "fulfilled") {
    rawItems.push(...tweetsResult.value.map(tweetToRaw));
  } else {
    tweetsError = String(tweetsResult.reason);
  }

  // Merge newsdata + Google News results, deduped by normalized title.
  const articleBucket: NewsArticle[] = [];
  if (articlesResult.status === "fulfilled") {
    articleBucket.push(...articlesResult.value.articles);
  } else {
    articlesError = String(articlesResult.reason);
  }
  if (googleResult.status === "fulfilled") {
    articleBucket.push(...googleResult.value);
  } else {
    // Google News failure is non-fatal — if newsdata succeeded we still
    // have results, and there's no user-facing knob for this source.
    if (!articlesError) articlesError = String(googleResult.reason);
  }
  const seenTitles = new Set<string>();
  const normalizeTitle = (t: string): string =>
    t.toLowerCase()
      // Drop the trailing " - Source Name" that Google News appends.
      .replace(/\s+-\s+[^-]+$/, "")
      .replace(/\s+/g, " ")
      .trim();
  for (const a of articleBucket) {
    const key = normalizeTitle(a.title);
    if (!key || seenTitles.has(key)) continue;
    seenTitles.add(key);
    rawItems.push(articleToRaw(a));
  }

  const excludeSet = new Set(exclude);
  const eligible = excludeSet.size > 0
    ? rawItems.filter((r) => !excludeSet.has(r.url))
    : rawItems;

  if (eligible.length === 0) {
    return {
      talent,
      items: [],
      candidatesConsidered: rawItems.length,
      curatorHandlesUsed: curator.used,
      tweetsError,
      articlesError,
      curatorsError,
    };
  }

  // Person is fixed — DeepSeek only needs to confirm the item is actually
  // about this person (not just a passing mention or listicle) and produce
  // a caption + category. Much cheaper prompt than the cross-roster path.
  const targetCount = 10;
  const askCount = Math.min(targetCount + (exclude.length > 0 ? 5 : 0), eligible.length);
  const compact = eligible.map((r, i) => ({
    i,
    type: r.type,
    source: r.sourceName,
    text: r.rawText,
    description: r.description ? r.description.slice(0, 240) : null,
  }));

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        `You are a news editor curating a feed about ONE person: ${talent.name}` +
        `${talent.industry ? ` (${talent.industry})` : ""}. For each candidate item:\n\n` +
        "(a) IS IT ABOUT THEM? — If the item just mentions the name in passing, is a " +
        "listicle where they're one of many names, or is about a different person with a " +
        "similar name, SKIP it (don't include in picks).\n\n" +
        "(b) CAPTION — rewrite as a punchy news headline (under 80 chars, subject-verb-object, " +
        "present tense, factual not opinion).\n\n" +
        "(c) CATEGORY — classify into one of:\n" +
        "    career     — signings, releases, role/project announcements\n" +
        "    business   — deals, investments, sales, partnerships\n" +
        "    performance— on-field/court/stage results, awards, records\n" +
        "    statement  — newsworthy public statement / interview position\n" +
        "    controversy— scandal, lawsuit, public dispute (real, not gossip)\n" +
        "    tabloid    — dating gossip, paparazzi, body/outfit talk, lifestyle bait\n" +
        "    other      — newsworthy but doesn't fit the above\n" +
        "Be honest with the tabloid label.\n\n" +
        "(d) NEWSWORTHY — boolean. True if a financial-news editor would price it; false for " +
        "fan takes, vibes, fluff, vague hype.\n\n" +
        "Rank picks by news-worthiness: substantive > opinion, breaking > evergreen. Return STRICT JSON.",
    },
    {
      role: "user",
      content:
        `Target person: ${talent.name} (ticker $${talent.ticker})\n\n` +
        `Candidate items (indexed):\n${JSON.stringify(compact, null, 2)}\n\n` +
        `Pick up to ${askCount} items genuinely about ${talent.name}, ranked best first.\n\n` +
        `Respond with: {"picks": [{"i": <index>, "caption": "<rewritten headline>", "category": "<one of: career|business|performance|statement|controversy|tabloid|other>", "newsworthy": <true|false>}]}`,
    },
  ];

  type Pick = {
    i: number;
    caption: string;
    category?: NewsCategory;
    newsworthy?: boolean;
  };
  let picks: Pick[] = [];
  try {
    const raw = await chat(messages, { json: true, temperature: 0.2 });
    picks = parseJson<{ picks: Pick[] }>(raw).picks ?? [];
  } catch (err) {
    console.error("[lookupPersonNews] DeepSeek call failed:", err);
    picks = [];
  }

  const validCategories: NewsCategory[] = [
    "career", "business", "performance", "statement", "controversy", "tabloid", "other",
  ];
  const items: LookupItem[] = picks
    .filter((p) => eligible[p.i])
    .filter((p) => p.newsworthy !== false)
    .map((p) => {
      const r = eligible[p.i];
      const category: NewsCategory =
        p.category && validCategories.includes(p.category) ? p.category : "other";
      return {
        caption: p.caption,
        source: r.type,
        url: r.url,
        mainPerson: talent.name,
        matchedTicker: talent.ticker,
        category,
        publishedAt: r.publishedAt,
        imageUrl: r.imageUrl,
        rawText: r.rawText,
        sourceName: r.sourceName,
        likeCount: r.likeCount,
        extractPayload: r.type === "tweet"
          ? {
              tweetText: r.rawText,
              tweetAuthorName: r.tweetAuthorName,
              tweetAuthorHandle: r.tweetAuthorHandle,
            }
          : {
              title: r.rawText,
              description: r.description,
            },
      };
    })
    .slice(0, targetCount);

  return {
    talent,
    items,
    candidatesConsidered: eligible.length,
    curatorHandlesUsed: curator.used,
    tweetsError,
    articlesError,
    curatorsError,
  };
}

// ---------- per-article person extraction + Pauv tie-in ----------

export interface ExtractResult {
  person: {
    name: string;
    summary: string;       // one-sentence what-happened
    isPauvTalent: boolean;
    matchedTicker: string | null;
  };
  pauvAngle: string;       // 1-2 sentence "why this matters for their NPSI"
  talent: Talent | null;   // full Pauv data if matched
}

export interface ExtractInput {
  // Article fields:
  title?: string;
  description?: string | null;
  content?: string | null;
  // Tweet fields (when source is a tweet):
  tweetText?: string;
  tweetAuthorName?: string;     // display name, e.g. "MrBeast"
  tweetAuthorHandle?: string;   // handle without @, e.g. "MrBeast"
}

export async function extractPerson(input: ExtractInput): Promise<ExtractResult> {
  const talents = await listTalents();
  const roster = talents.map((t) => ({ ticker: t.ticker, name: t.name, industry: t.industry }));

  // Build the source payload — tweets need the author context to disambiguate
  // "tweet BY a celeb" vs "tweet ABOUT a celeb."
  const isTweet = !!input.tweetText;
  const sourceBlock = isTweet
    ? `Tweet by ${input.tweetAuthorName ?? "?"} (@${input.tweetAuthorHandle ?? "?"}):\n${input.tweetText}`
    : `Article:\nTitle: ${input.title ?? ""}\nDescription: ${input.description ?? ""}\nContent: ${(input.content ?? "").slice(0, 1500)}`;

  const tweetGuidance = isTweet
    ? "\nIMPORTANT: this is a tweet. The 'main person' is whoever the tweet is most centrally about — " +
      "usually the author for personal posts, but if the author is commenting on someone else (e.g. a news anchor " +
      "tweeting about a celebrity), the main person is the subject, not the author."
    : "";

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You analyze a piece of social content and return strict JSON. Tasks: " +
        "(1) name the single main person it's about; " +
        "(2) summarize what happened in one sentence; " +
        "(3) match to the provided Pauv roster by ticker if and only if you are confident it's the same person; " +
        "(4) if matched, write 1-2 sentences on why this is likely to move that person's NPSI (positive or negative cultural signal). " +
        "Never invent tickers — only use ones from the roster." + tweetGuidance,
    },
    {
      role: "user",
      content:
        `${sourceBlock}\n\n` +
        `Pauv roster (ticker — name — industry):\n${roster.map((r) => `${r.ticker} — ${r.name} — ${r.industry ?? "?"}`).join("\n")}\n\n` +
        `Respond with: {"name": "<full real name>", "summary": "<one sentence>", "matchedTicker": "<ticker or null>", "pauvAngle": "<1-2 sentences or empty string>"}`,
    },
  ];

  const raw = await chat(messages, { json: true, temperature: 0.2 });
  const parsed = parseJson<{
    name: string;
    summary: string;
    matchedTicker: string | null;
    pauvAngle: string;
  }>(raw);

  const matched = parsed.matchedTicker
    ? talents.find((t) => t.ticker === parsed.matchedTicker) ?? null
    : null;

  return {
    person: {
      name: parsed.name,
      summary: parsed.summary,
      isPauvTalent: !!matched,
      matchedTicker: matched?.ticker ?? null,
    },
    pauvAngle: matched ? parsed.pauvAngle : "",
    talent: matched,
  };
}

// ---------- chat-edit (free-form refinement of card fields) ----------

export interface EditableCardState {
  caption: string;
  mainPerson: string;
  summary: string;
  pauvAngle: string;
  matchedTicker: string | null;
}

export interface ChatEditPatch {
  caption?: string;
  mainPerson?: string;
  summary?: string;
  pauvAngle?: string;
  matchedTicker?: string | null;
}

export interface ChatEditResult {
  reply: string;
  patch: ChatEditPatch;
  newTalent?: Talent | null;   // resolved only when patch.matchedTicker is present
}

export async function chatEdit(
  history: ChatMessage[],
  state: EditableCardState,
): Promise<ChatEditResult> {
  const talents = await listTalents();
  const roster = talents
    .map((t) => `${t.ticker} — ${t.name} — ${t.industry ?? "?"}`)
    .join("\n");

  const systemContent =
    "You are an editor helping the user refine a Pauv news card. " +
    "The card has these editable fields:\n" +
    "  - caption: the headline shown on the card (one short news-headline-style line)\n" +
    "  - mainPerson: the single real person the card is about (their commonly-known real name)\n" +
    "  - summary: one-sentence what-happened\n" +
    "  - pauvAngle: 1-2 sentences on why this is likely to move the person's NPSI signal\n" +
    "  - matchedTicker: the Pauv ticker if this person is on Pauv, else null. Must be a real ticker from the roster — never invent one.\n\n" +
    "When the user asks for a change, decide which fields to update and respond with STRICT JSON:\n" +
    `{"reply": "<short conversational reply to the user>", "patch": {"caption"?: "...", "mainPerson"?: "...", "summary"?: "...", "pauvAngle"?: "...", "matchedTicker"?: "<TICKER or null>"}}\n\n` +
    "Rules:\n" +
    "- ONLY include fields in patch that you are actually changing. Omit unchanged fields.\n" +
    "- If the user is just asking a question (not requesting a change), omit patch entirely.\n" +
    "- If the user changes who the card is about (mainPerson), re-evaluate matchedTicker — null it out if the new person isn't in the roster.\n" +
    "- Use a news-headline style for captions (punchy, present-tense, subject-verb-object).\n" +
    "- Keep replies short (1-2 sentences) — the user will see the actual diff in the UI.\n\n" +
    `Current card state:\n${JSON.stringify(state, null, 2)}\n\n` +
    `Pauv roster (ticker — name — industry):\n${roster}`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    ...history,
  ];

  const raw = await chat(messages, { json: true, temperature: 0.3 });
  const parsed = parseJson<{ reply?: string; patch?: ChatEditPatch }>(raw);

  // Sanitize the patch: drop unknown fields, coerce "null"/"" matchedTicker to null,
  // silently drop matchedTicker values not in the roster (so a hallucinated ticker
  // doesn't crash the flow).
  const tickerSet = new Set(talents.map((t) => t.ticker));
  const rawPatch = parsed.patch ?? {};
  const clean: ChatEditPatch = {};
  if (typeof rawPatch.caption === "string") clean.caption = rawPatch.caption;
  if (typeof rawPatch.mainPerson === "string") clean.mainPerson = rawPatch.mainPerson;
  if (typeof rawPatch.summary === "string") clean.summary = rawPatch.summary;
  if (typeof rawPatch.pauvAngle === "string") clean.pauvAngle = rawPatch.pauvAngle;
  if ("matchedTicker" in rawPatch) {
    const t = rawPatch.matchedTicker;
    if (t === null || t === "null" || t === "") {
      clean.matchedTicker = null;
    } else if (typeof t === "string" && tickerSet.has(t)) {
      clean.matchedTicker = t;
    }
  }

  let newTalent: Talent | null | undefined;
  if ("matchedTicker" in clean) {
    newTalent = clean.matchedTicker
      ? talents.find((t) => t.ticker === clean.matchedTicker) ?? null
      : null;
  }

  return {
    reply: parsed.reply ?? "(no reply)",
    patch: clean,
    newTalent,
  };
}

// ============================================================================
// Trending: today's most-talked-about Pauv talents in music & film.
//
// Approach: fetch the day's top entertainment headlines from Google News (free,
// no quota), then count name-mentions per Pauv talent restricted to music/film
// industries. Talents with more mentions across more headlines today rank
// higher. No external sentiment model required — frequency across reputable
// entertainment outlets is a strong proxy for "what's trending."
// ============================================================================

// Industries we consider for the "music & film" trending feed.
const TRENDING_INDUSTRIES = new Set(["Actor", "Musician", "Comedian"]);

// Broad queries that surface high-volume entertainment headlines without
// constraining to a single publication.
const TRENDING_QUERIES = [
  "entertainment news",
  "celebrity",
  "Hollywood",
  "music news",
];

export interface TrendingHeadline {
  title: string;
  link: string;
  pubDate: string | null;
  source: string | null;
  description: string | null;
}

export interface TrendingTalent {
  talent: Talent;
  mentionCount: number;
  headlines: TrendingHeadline[];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function getTrendingTalents(limit = 12): Promise<TrendingTalent[]> {
  const [talents, ...articleLists] = await Promise.all([
    listTalents(),
    ...TRENDING_QUERIES.map((q) => searchGoogleNews({ q, timeframeHours: 24 }).catch(() => [] as NewsArticle[])),
  ]);

  // Dedupe articles by link.
  const seenLinks = new Set<string>();
  const articles: NewsArticle[] = [];
  for (const list of articleLists) {
    for (const a of list) {
      if (!a.link || seenLinks.has(a.link)) continue;
      seenLinks.add(a.link);
      articles.push(a);
    }
  }

  // For each talent in the trending industries, find which articles mention them.
  const results: TrendingTalent[] = [];
  for (const t of talents) {
    if (!t.industry || !TRENDING_INDUSTRIES.has(t.industry)) continue;
    // Require at least a two-word name OR a name >= 5 chars to dodge ambiguous
    // single-name matches like "Drake" matching "Drake University."
    if (t.name.length < 5 && !t.name.includes(" ")) continue;
    const re = new RegExp(`\\b${escapeRegex(t.name)}\\b`, "i");
    const matched: TrendingHeadline[] = [];
    for (const a of articles) {
      const haystack = `${a.title} ${a.description ?? ""}`;
      if (re.test(haystack)) {
        matched.push({
          title: a.title,
          link: a.link,
          pubDate: a.pubDate,
          source: a.source_id,
          description: a.description,
        });
      }
    }
    if (matched.length === 0) continue;
    // Newest headline first.
    matched.sort((a, b) => {
      const ta = a.pubDate ? Date.parse(a.pubDate) : 0;
      const tb = b.pubDate ? Date.parse(b.pubDate) : 0;
      return tb - ta;
    });
    results.push({ talent: t, mentionCount: matched.length, headlines: matched });
  }

  results.sort((a, b) => b.mentionCount - a.mentionCount);
  return results.slice(0, limit);
}
