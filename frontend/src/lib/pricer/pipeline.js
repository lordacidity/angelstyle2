// Pauv AI Pricer — prices a person in six steps: name → bio → three analysts (social, news, industry) → judge.
// Gemini does the research, except the social step, which runs on Claude with web search; Claude Sonnet 5 is the judge.
//
// This is the standalone pricer's server.mjs carried into the Studio (Studio > Pricer). The pricing mechanism is
// unchanged; what differs from the standalone is only plumbing:
//   - no HTTP server, env loading or password here: the /api/pricer/* route handlers call runPipeline() and the
//     site's own gate protects them; the root .env is loaded by next.config.ts before this module is imported.
//   - the master list is still a read-only CSV (./data/pauv_master_list.csv, re-read on every pricing).
//   - the peer standing lines and the pricing log live in Railway Postgres (./store) instead of CSVs beside the
//     code, so they survive Vercel's read-only disk and are shared between machines. The two CSVs in ./data are the
//     seed: loaded once into empty tables, so the standalone's lines and test history carry over.
//   - the Gemini research model is PRICER_GEMINI_MODEL, not the site's GEMINI_MODEL (that one is the caption model).
// How the pricing works is in ./HOW_IT_WORKS.md.
//
// Nothing is cached: every pricing runs every step.
// Server-only — imported by the /api/pricer/* route handlers. Never import it from a client component.
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { readCsv } from "./csv.js";
import * as store from "./store";

// ---------------------------------------------------------------------------
// Config (the root .env, or the environment)
// ---------------------------------------------------------------------------
const GEMINI_MODEL = process.env.PRICER_GEMINI_MODEL || "gemini-3.8-flash";   // research steps (not the site's GEMINI_MODEL)
// The judge is hard-coded, not an env override: the deployment's environment variables should never
// have to change to move the final decision to another model.
const JUDGE_MODEL = "claude-sonnet-5";                                  // final judge
const JUDGE_EFFORT = process.env.JUDGE_EFFORT || "medium";              // judge thinking depth: low | medium | high | xhigh | max
const JUDGE_CACHE_TTL = process.env.JUDGE_CACHE_TTL || "1h";            // static judge prompt cache: 5m or 1h
// The social step runs on Claude with web search: Gemini searched for accounts in a fifth of runs, Claude in all of them.
const SOCIAL_MODEL = process.env.SOCIAL_MODEL || "claude-haiku-4-5";
// Web searches allowed per social call, at $10 per 1,000 searches plus the result tokens — which are the
// step's real weight: every result is re-read on each later turn, so the context grows faster than the
// search count. Five, aimed at the four platforms that decide the price, instead of eight spread over nine.
const SOCIAL_MAX_SEARCHES = 5;
// Recent news comes from Google News's search feed: dated headlines with outlets, no key, and no model deciding
// whether to search. Gemini then prices from that list. The Gemini-with-search path is the fallback if the feed fails.
const NEWS_FEED_URL = "https://news.google.com/rss/search";
const NEWS_FEED_TIMEOUT_MS = 15_000;
const NEWS_FEED_MAX = 100;           // headlines shown to the analyst (a search stops at 100)
const NEWS_FEED_SEARCHES = 8;        // name + context searches per pricing, run in parallel
const NEWS_WINDOW_DAYS = Number(process.env.NEWS_WINDOW_DAYS || 90);
// Streamers, gamers and online-native celebrities are priced this much below what the analysts recommend.
const ONLINE_DISCOUNT = Number(process.env.ONLINE_CELEB_DISCOUNT ?? 0.25);
// Built-in draw-down of the master-list prices as the pricer reads them (the CSV itself is never changed): low list
// prices read lower and the middle a little lower, $32 and above unchanged. The factor slides on a log scale from
// `min` at `minAt` and below up to 1.0 at `fullAt`, rounded to the nearest 50 cents: $3 → $2, $5 → $3, $8 → $5.50,
// $10 → $7.50, $16 → $13.50, $20 → $18. Set min to 1 to disable.
const DRAWDOWN = { min: 0.6, minAt: 5, fullAt: 32 };
// Dollars → Pauv credits, shown next to the final price when set. The models never see credits.
const CREDITS_PER_USD = Number(process.env.PAUV_CREDITS_PER_USD) > 0 ? Number(process.env.PAUV_CREDITS_PER_USD) : null;

// Google serves 503 "high demand" on popular models for minutes at a time. The configured model is
// retried after these waits first; if it is still swamped it is parked and the call moves down the chain.
const GEMINI_FALLBACKS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash"];
const GEMINI_PRIMARY_PATIENCE = [3000, 8000];   // ms to wait before each retry of the configured model
const GEMINI_TIMEOUT_MS = 90_000;    // per attempt
const GEMINI_ATTEMPTS = 2;           // per model before moving down the chain
const GEMINI_COOLDOWN_MS = 300_000;  // how long a swamped model is skipped
const PEER_BATCH = 20;               // people per grounded call when writing peer lines
const PEER_CONCURRENCY = 5;          // parallel calls while writing them

// The social price is computed from what the analyst finds, not chosen by it: the best band sets the
// base, more accounts in that band and stronger engagement add to it. Tune these against known names.
const SOCIAL_BANDS = [
  { label: "top 0.0001%", followers: "100M+", base: 52 },
  { label: "top 0.001%", followers: "10M–100M", base: 30 },
  { label: "top 0.01%", followers: "1M–10M", base: 15 },
  { label: "top 0.1%", followers: "100K–1M", base: 8 },
  { label: "top 1%", followers: "10K–100K", base: 4 },
  { label: "top 10%", followers: "1K–10K", base: 1 },
  { label: "below top 10%", followers: "<1K", base: 0.2 },
];
const SOCIAL_EXTRA_SAME_BAND = 0.12;   // per additional account in the best band (up to 3 counted)
const SOCIAL_EXTRA_NEXT_BAND = 0.05;   // per account one band below the best (up to 3 counted)
const SOCIAL_ENGAGEMENT = { strong: 0.10, average: 0, weak: -0.10, unknown: 0 };   // averaged over the best-band accounts
const PRICE_MIN = 0.01;                // the floor of the whole scale: the default for a nobody
const SOCIAL_NONE = PRICE_MIN;         // no accounts found at all
const SOCIAL_MIN = PRICE_MIN, SOCIAL_MAX = 70;

// process.cwd() is the Next app root (frontend/) in dev, on Railway and on Vercel; next.config.ts traces these
// files into the serverless bundle so they exist there too.
const DATA_DIR = path.join(process.cwd(), "src", "lib", "pricer", "data");
const MASTER_CSV = path.join(DATA_DIR, "pauv_master_list.csv");
const PEERS_SEED = path.join(DATA_DIR, "pauv_peer_lines.csv");
const PRICED_SEED = path.join(DATA_DIR, "pauv_priced.csv");

// Checked when a pricing starts rather than at import, so a missing key fails that request instead of the whole site.
function requireKeys() { for (const k of ["GEMINI_API_KEY", "ANTHROPIC_API_KEY"]) if (!process.env[k]) throw new Error(`${k} is not set in the root .env`); }
let anthropicClient;
const anthropic = () => (anthropicClient ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 180_000, maxRetries: 2 }));

// ---------------------------------------------------------------------------
// Pricing tiers. The news, industry and judge steps get TIERS_TABLE verbatim, in dollars.
// The scale runs from $0.01 (the default for a nobody) to $70; the bottom two bands are priced in cents.
// ---------------------------------------------------------------------------
const TIERS = [
  { min: 55, range: "$55–70", name: "MAJOR global icons", desc: "People who will be in most history books", who: "Musk, Trump, Ronaldo, Swift, Messi, LeBron" },
  { min: 42, range: "$42–52", name: "Household names worldwide", desc: "The average person knows their name", who: "Bieber, Rihanna, Obama, DiCaprio, MrBeast, Jordan, Brady" },
  { min: 30, range: "$30–42", name: "A-list", who: "Most top actors, chart artists, superstar athletes, major politicians" },
  { min: 20, range: "$20–30", name: "Mainstream recognizable", who: "Stars within their field with real crossover" },
  { min: 10, range: "$10–20", name: "Known in their field", who: "Starters, charting artists, mid-size creators" },
  { min: 4, range: "$4–10", name: "Niche or rising", who: "Prospects, role players, small creators" },
  { min: 2, range: "$2–4", name: "Obscure but real", who: "Fringe players and minor candidates: a real, if marginal, professional standing" },
  { min: 0.10, range: "$0.10–2", name: "Barely known", desc: "Socially active, or an additive member of a niche", who: "Early-stage founders, tiny creators, local figures, people known inside one small community" },
  { min: 0, range: "$0.01–0.10", name: "Unknown", desc: "Essentially nobody has heard of them; $0.01 is the default for a nobody", who: "Private individuals and anyone with no press, no audience and no standing beyond existing" },
];
const TIERS_TABLE = "Tier | Range | Who\n" + TIERS.map(t => `${t.name}${t.desc ? ". " + t.desc : ""} | ${t.range} | ${t.who}`).join("\n");
const TIER_BANDS = TIERS.map((t, i) => `${i + 1}. ${t.name} (${t.range})`).join("\n");
const tierForPrice = p => (TIERS.find(t => p >= t.min) ?? TIERS.at(-1)).name;
// The model's tier string when it names a real band, otherwise the band the price falls in.
const tierName = (s, price) => TIERS.find(t => t.name.toLowerCase() === String(s || "").trim().toLowerCase())?.name ?? tierForPrice(price);

const PERCENTILE_ANCHORS = SOCIAL_BANDS.map((b, i) => `${(b.followers + (i ? "" : " followers")).padEnd(18)} → ${b.label}`).join("\n");
const CONFIDENCE_LEVELS = ["high", "medium", "low", "none"];
const ENGAGEMENT_LEVELS = ["strong", "average", "weak", "unknown"];

// ---------------------------------------------------------------------------
// Master list — the pricing reference
// ---------------------------------------------------------------------------
const drawDown = p => p >= DRAWDOWN.fullAt ? p
  : Math.max(0.5, Math.round(2 * p * Math.min(1, Math.max(DRAWDOWN.min, DRAWDOWN.min + (1 - DRAWDOWN.min) * Math.log(p / DRAWDOWN.minAt) / Math.log(DRAWDOWN.fullAt / DRAWDOWN.minAt)))) / 2);
// `price` is what the pricer works with (drawn down); `listed_price` is the number in the CSV.
function loadMaster() {
  return readCsv(MASTER_CSV)
    .map(r => { const listed = Number(r.price); return { name: (r.name || "").trim(), industry: (r.industry || "").trim(), subindustry: (r.subindustry || "").trim(), listed_price: listed, price: drawDown(listed) }; })
    .filter(r => r.name && Number.isFinite(r.price));
}

// industry → sorted subindustries, as found in the master list
function taxonomy(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!r.industry) continue;
    if (!map.has(r.industry)) map.set(r.industry, new Set());
    if (r.subindustry) map.get(r.industry).add(r.subindustry);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([industry, subs]) => ({ industry, subindustries: [...subs].sort() }));
}

const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const slug = s => norm(s).replace(/ /g, "-");
const money = n => `$${Number(n).toFixed(2)}`;
const round2 = n => Math.round(n * 100) / 100;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Grounded models sometimes leave citation markers like [1] or [2, 3] in prose — strip them.
const stripCites = s => String(s ?? "").replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, "").replace(/[ \t]{2,}/g, " ").trim();

// ---------------------------------------------------------------------------
// Gemini. Every call is stateless: one user message, no system prompt, no history, temperature 0.
// ---------------------------------------------------------------------------
const MODEL_CHAIN = [GEMINI_MODEL, ...GEMINI_FALLBACKS.filter(m => m !== GEMINI_MODEL)];
const coolingUntil = new Map();   // model → time until which it is skipped
const OVERLOAD_RE = /high demand|overloaded|currently unavailable|try again later|UNAVAILABLE/i;
const NETWORK_RE = /fetch failed|ECONN|socket|network/i;
const fail = (msg, flags) => Object.assign(new Error(msg), flags);
const retryAfter = data => { const s = parseFloat((data.error?.details || []).find(x => /RetryInfo/.test(x["@type"]))?.retryDelay); return s > 0 ? Math.min(s * 1000, 30_000) : 2000; };

// One request. Throws with `next: true` when another model should be tried (`swamped: true` when that is
// because of load rather than a timeout), or `retry: <ms>` when the same model deserves one more attempt.
async function geminiOnce(model, body, signal) {
  const timeout = AbortSignal.timeout(GEMINI_TIMEOUT_MS);
  let res, data;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    if (signal?.aborted) throw new Error("Cancelled");
    if (e.name === "TimeoutError" || e.name === "AbortError") throw fail(`Gemini request timed out after ${GEMINI_TIMEOUT_MS / 1000}s (${model})`, { next: true });
    if (NETWORK_RE.test(e.message)) throw fail(e.message, { retry: 1000 });
    throw e;
  }
  if (!res.ok) {
    const msg = data.error?.message || `HTTP ${res.status}`;
    const text = `Gemini ${res.status} (${model}): ${msg}`;
    if (res.status === 503 || OVERLOAD_RE.test(msg)) throw fail(text, { next: true, swamped: true });
    if (res.status === 429) throw fail(text, { retry: retryAfter(data) });
    if (res.status >= 500) throw fail(text, { retry: 1500 });
    throw new Error(text);   // 4xx: our request is wrong, no model will fix it
  }
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
  if (!text.trim()) throw fail(`Gemini returned no text (finishReason=${cand?.finishReason || data.promptFeedback?.blockReason || "none"})`, { retry: 1500 });
  const gm = cand.groundingMetadata || {};
  const seen = new Set();
  const sources = (gm.groundingChunks || []).map(c => c.web).filter(w => w?.uri && !seen.has(w.uri) && seen.add(w.uri)).map(w => ({ title: w.title || w.uri, uri: w.uri }));
  return { text, sources, queries: gm.webSearchQueries || [], model: data.modelVersion || model };
}

// Walks the model chain, skipping parked models. `onNote` reports waits and fallbacks.
async function gemini({ prompt, search = false, schema, signal, onNote }) {
  const body = { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0 } };
  if (search) body.tools = [{ google_search: {} }];   // grounding and JSON mode are mutually exclusive
  else if (schema) Object.assign(body.generationConfig, { responseMimeType: "application/json", responseSchema: schema });
  const payload = JSON.stringify(body);
  const chain = MODEL_CHAIN.filter(m => (coolingUntil.get(m) || 0) <= Date.now());
  if (!chain.length) chain.push(...MODEL_CHAIN);   // everything is parked: try anyway
  const busy = [];
  let lastErr;
  for (const m of chain) {
    const patience = m === GEMINI_MODEL ? [...GEMINI_PRIMARY_PATIENCE] : [];
    let attempts = 0;
    for (;;) {
      try {
        const out = await geminiOnce(m, payload, signal);
        coolingUntil.delete(m);
        if (busy.length) onNote?.(`${busy.join(", ")} busy — answered by ${m}`);
        return out;
      } catch (e) {
        lastErr = e;
        if (!e.next && !e.retry) throw e;
        if (e.swamped && patience.length) {   // the configured model is worth a short wait
          const wait = patience.shift();
          onNote?.(`${m} is busy — retrying in ${wait / 1000}s`);
          await sleep(wait);
          continue;
        }
        if (e.next || ++attempts >= GEMINI_ATTEMPTS) break;
        await sleep(e.retry);
      }
    }
    busy.push(m);
    coolingUntil.set(m, Date.now() + GEMINI_COOLDOWN_MS);
    console.warn(`gemini: ${m} unavailable (${lastErr.message.slice(0, 90)}) — parked for ${GEMINI_COOLDOWN_MS / 1000}s, trying next model`);
  }
  throw new Error(`${lastErr.message} — tried ${chain.join(", ")}`);
}

// Gemini decides for itself whether to use the search tool. When it answers without searching there are no
// queries and no sources; the call is then made once more with the search made mandatory.
const searched = raw => raw.queries.length > 0 || raw.sources.length > 0;
const MUST_SEARCH = "MANDATORY: use the web search tool. Run at least three separate searches and base your answer only on what they return. A previous answer to this request was rejected because it was written from memory without searching.\n\n";
async function grounded(prompt, signal, onNote) {
  let raw = await gemini({ prompt, search: true, signal, onNote });
  let attempts = 1;
  if (!searched(raw)) {
    onNote?.("answered without searching — asking again");
    raw = await gemini({ prompt: MUST_SEARCH + prompt, search: true, signal, onNote });
    attempts = 2;
  }
  return { raw, attempts, searched: searched(raw) };
}

// ---------------------------------------------------------------------------
// Claude with web search — the social step. Stateless like the Gemini calls: one user message, no system
// prompt. The response says exactly how many searches ran, and the model follows "search for each account".
// ---------------------------------------------------------------------------
// Claude 4.6 and later reject sampling parameters; Haiku 4.5 still takes temperature.
const SOCIAL_SAMPLING = /haiku-4-5|-4-6/.test(SOCIAL_MODEL) ? { temperature: 0 } : {};
async function claudeSearch({ prompt, signal }) {
  const messages = [{ role: "user", content: prompt }];
  const content = [];
  let res, searches = 0;
  const usage = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
  for (let turn = 0; turn < 4; turn++) {
    res = await anthropic().messages.create({
      model: SOCIAL_MODEL, max_tokens: 8000, ...SOCIAL_SAMPLING, messages,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: SOCIAL_MAX_SEARCHES }],
      // Prompt caching. The search loop re-reads the whole growing conversation before every search, so
      // each result is billed as input again on every later search: a 1,100-token prompt turns into
      // tens of thousands of input tokens. With caching on, the API caches up to the last search result
      // as it goes and those re-reads bill at a tenth of the input rate. The marker sits on the last
      // block, so a paused turn sent back unchanged reads what the previous request cached as well.
      // Same model, prompt and searches: only the bill changes.
      cache_control: { type: "ephemeral" },
    }, { signal });
    content.push(...res.content);
    searches += res.usage?.server_tool_use?.web_search_requests ?? 0;
    for (const k of Object.keys(usage)) usage[k] += res.usage?.[k] ?? 0;
    if (res.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: res.content });   // a paused search turn continues when sent back unchanged
  }
  if (res.stop_reason === "refusal") throw new Error(`Claude declined to answer (${res.stop_details?.category || "refusal"})`);
  const text = content.filter(b => b.type === "text").map(b => b.text).join("");
  if (!text.trim()) throw new Error(`${SOCIAL_MODEL} returned no text (stop_reason=${res.stop_reason})`);
  const queries = content.filter(b => b.type === "server_tool_use" && b.name === "web_search").map(b => b.input?.query).filter(Boolean);
  const seen = new Set(); const sources = [];
  for (const b of content) if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r.url && !seen.has(r.url)) { seen.add(r.url); sources.push({ title: r.title || r.url, uri: r.url }); }
  console.log(`  social: ${usage.input_tokens} new + ${usage.cache_read_input_tokens} cached in (${usage.cache_creation_input_tokens} written) / ${usage.output_tokens} out, ${searches} searches`);
  return { text, sources, queries, searches, usage, model: res.model };
}

// Same retry-once rule as the Gemini steps. If the Claude call fails outright, the Gemini path takes the
// step so a pricing never dies on one vendor; the page shows which model answered.
async function groundedSocial(prompt, signal, onNote) {
  try {
    let raw = await claudeSearch({ prompt, signal });
    let attempts = 1;
    if (!searched(raw)) {
      onNote?.("answered without searching — asking again");
      raw = await claudeSearch({ prompt: MUST_SEARCH + prompt, signal });
      attempts = 2;
    }
    return { raw, attempts, searched: searched(raw) };
  } catch (e) {
    if (signal?.aborted) throw e;
    console.warn(`social: ${SOCIAL_MODEL} failed (${e.message.slice(0, 120)}) — falling back to Gemini`);
    onNote?.(`${SOCIAL_MODEL} failed — answered by Gemini instead`);
    return grounded(prompt, signal, onNote);
  }
}

// ---------------------------------------------------------------------------
// Google News search feed — the news step's evidence. Returns the stories inside the window, newest first.
// ---------------------------------------------------------------------------
const OBITUARY_RE = /obituar|funeral|cremation|mortuary|tribute archive|dignity memorial/i;   // namesakes' death notices
async function fetchNews(searches, days, signal) {
  const timeout = AbortSignal.timeout(NEWS_FEED_TIMEOUT_MS);
  const opts = { headers: { "user-agent": "Mozilla/5.0 (compatible; pauv-ai-pricer)" }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout };
  const unescape = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
  const field = (it, tag) => unescape((it.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || "");
  const parse = xml => [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]).map(it => {
    const source = field(it, "source");
    let title = field(it, "title");
    if (source && title.toLowerCase().endsWith(` - ${source.toLowerCase()}`)) title = title.slice(0, -(source.length + 3)).trim();   // "Headline - Outlet"
    return { title, source, link: field(it, "link"), date: new Date(field(it, "pubDate")) };
  }).filter(i => i.title && !Number.isNaN(i.date.getTime()));
  // One request per name + context pair, in parallel: the context keeps namesakes out, and a noisy pair cannot crowd
  // the others out of the 100-item cap.
  const feeds = await Promise.all(searches.map(async s => {
    const res = await fetch(`${NEWS_FEED_URL}?q=${encodeURIComponent(`"${s.name}" ${s.context} when:${days}d`)}&hl=en-US&gl=US&ceid=US:en`, opts);
    if (!res.ok) throw new Error(`Google News HTTP ${res.status}`);
    const xml = await res.text();
    if (!/<rss[\s>]/i.test(xml)) throw new Error("Google News did not return a feed");
    return parse(xml);
  }));
  const cutoff = Date.now() - days * 86400000;
  const seen = new Set(); const items = []; let obituaries = 0;
  for (const list of feeds) for (const i of list) {
    if (i.date.getTime() < cutoff) continue;
    if (OBITUARY_RE.test(i.source) || OBITUARY_RE.test(i.title)) { obituaries++; continue; }
    const k = `${norm(i.title)}|${norm(i.source)}`;   // the same story from the same outlet, found under two searches
    if (!seen.has(k)) { seen.add(k); items.push(i); }
  }
  items.sort((a, b) => b.date - a.date);
  const query = searches.map(s => `"${s.name}" + ${s.context}`).join("; ");
  return { query, searches, total: feeds.reduce((s, l) => s + l.length, 0), capped: feeds.some(l => l.length >= 100), obituaries, days: new Set(items.map(i => i.date.toISOString().slice(0, 10))).size, items };
}
// The names to search: the canonical name, the bio's aliases, and the name as typed when it differs.
function newsTerms(typed, bio) {
  const seen = new Set(); const terms = [];
  for (const t of [bio.canonical_name, ...(bio.aliases || []), typed]) {
    const s = String(t || "").replace(/"/g, "").trim();
    const k = norm(s);
    if (k && !seen.has(k)) { seen.add(k); terms.push(s); }
  }
  return terms.slice(0, 4);
}
// Every search is a name plus context, so a common name does not drown in namesakes. Context comes from the
// operator's hint first (comma-separated pieces), then the bio's two search contexts, then the subindustry if there
// is nothing else. The canonical name is paired with every context before any alias is tried, so the cap drops
// alias searches, not angles.
function newsSearches(typed, hint, bio) {
  const contexts = []; const seen = new Set();
  const add = c => {
    const s = String(c || "").replace(/["()]/g, "").trim().split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
    const k = norm(s);
    if (k && !seen.has(k)) { seen.add(k); contexts.push(s); }
  };
  for (const piece of String(hint || "").split(/[,;·|/]| or /i)) add(piece);
  for (const c of bio.search_contexts || []) add(c);
  if (!contexts.length) add(bio.subindustry || bio.industry);
  const searches = [];
  for (const name of newsTerms(typed, bio)) for (const context of contexts) searches.push({ name, context });
  return searches.slice(0, NEWS_FEED_SEARCHES);
}

// ---------------------------------------------------------------------------
// JSON handling. Grounded calls cannot use schema mode, so they are asked for a
// JSON fence; if that fails validation, a schema-enforced call restructures the text.
// ---------------------------------------------------------------------------
function escapeRawNewlinesInStrings(s) {
  let out = "", inStr = false, esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === "\\") { out += ch; esc = true; continue; }
      if (ch === '"') { inStr = false; out += ch; continue; }
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") continue;
      if (ch === "\t") { out += "\\t"; continue; }
      out += ch; continue;
    }
    if (ch === '"') inStr = true;
    out += ch;
  }
  return out;
}

function extractJson(text) {
  const tryParse = s => {
    for (const v of [s, escapeRawNewlinesInStrings(s)]) {
      try { const j = JSON.parse(v); if (j && typeof j === "object" && !Array.isArray(j)) return j; } catch { /* next */ }
    }
    return undefined;
  };
  let v = tryParse(text.trim()); if (v) return v;
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(m => m[1].trim()).reverse();
  for (const f of fences) { v = tryParse(f); if (v) return v; }
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a !== -1 && b > a) { v = tryParse(text.slice(a, b + 1)); if (v) return v; }
  return undefined;
}

async function structured(raw, schema, validate, signal) {
  const direct = extractJson(raw.text);
  if (direct) { try { return validate(direct); } catch { /* fall through to schema-enforced extraction */ } }
  const fix = await gemini({
    schema, signal,
    prompt: `Convert the analyst output below into a JSON object matching the required schema. Use only information present in the text. Do not add, infer, or change anything. If a number is missing, use null.\n\nANALYST OUTPUT:\n${raw.text}`,
  });
  const v = extractJson(fix.text);
  if (!v) throw new Error("Could not parse the model's answer as JSON");
  return validate(v);
}

// Gemini response schemas (OpenAPI subset, every property required)
const S = { type: "STRING" }, B = { type: "BOOLEAN" }, N = { type: "NUMBER" };
const obj = properties => ({ type: "OBJECT", properties, required: Object.keys(properties) });
const arr = items => ({ type: "ARRAY", items });
const BIO_SCHEMA = obj({ identified: B, canonical_name: S, aliases: arr(S), search_contexts: arr(S), industry: S, subindustry: S, one_line: S, bio: S });
const SOCIAL_SCHEMA = obj({
  accounts: arr(obj({ platform: S, handle: S, band: { ...S, enum: SOCIAL_BANDS.map(b => b.label) }, engagement: { ...S, enum: ENGAGEMENT_LEVELS }, note: S })),
  confidence: { ...S, enum: CONFIDENCE_LEVELS },
  rationale: S,
});
const ANALYST_SCHEMA = obj({ price: N, confidence: { ...S, enum: CONFIDENCE_LEVELS }, tier: S, evidence: arr(obj({ label: S, value: S, note: S })), rationale: S });
const PEERS_SCHEMA = obj({ people: arr(obj({ name: S, identified: B, line: S })) });
// Claude structured-outputs schema (standard JSON Schema)
const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    price: { type: "number" },
    tier: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    weights: { type: "object", properties: { social: { type: "number" }, news: { type: "number" }, industry: { type: "number" } }, required: ["social", "news", "industry"], additionalProperties: false },
    anchors: { type: "array", items: { type: "string", enum: ["social", "news", "industry"] } },
    one_band_rule_applied: { type: "boolean" },
    online_celebrity: { type: "boolean" },
    online_celebrity_note: { type: "string" },
    rationale: { type: "string" },
  },
  required: ["price", "tier", "confidence", "weights", "anchors", "one_band_rule_applied", "online_celebrity", "online_celebrity_note", "rationale"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Validation — what each model answer must contain to count
// ---------------------------------------------------------------------------
function toNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = Number(v.replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : NaN; }
  return NaN;
}
function toConfidence(v) {
  const c = String(v || "").trim().toLowerCase();
  if (!CONFIDENCE_LEVELS.includes(c)) throw new Error(`invalid confidence "${v}"`);
  return c;
}
const isIdentified = v => String(v).toLowerCase() !== "false";

// Only aliases that identify the person on their own: "Tyler1" yes; "T1", "Tyler" or initials no.
function cleanAliases(list, canonical) {
  const words = new Set(norm(canonical).split(" "));
  const seen = new Set([norm(canonical)]);
  return (Array.isArray(list) ? list : []).map(a => stripCites(a)).filter(a => {
    const k = norm(a);
    if (a.length < 4 || !/[a-z]/i.test(a) || !k || seen.has(k) || words.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 3);
}
// Two distinct phrases of up to four words that a news search can add to the name ("Cluely", "Interview Coder").
function cleanContexts(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [list]).map(c => stripCites(c).replace(/["()]/g, "").split(/\s+/).filter(Boolean).slice(0, 4).join(" "))
    .filter(c => { const k = norm(c); if (!k || seen.has(k)) return false; seen.add(k); return true; }).slice(0, 2);
}
function validateBio(p) {
  if (typeof p.bio !== "string" || !p.bio.trim()) throw new Error("bio missing");
  return {
    identified: isIdentified(p.identified),
    canonical_name: stripCites(p.canonical_name),
    aliases: cleanAliases(p.aliases, stripCites(p.canonical_name)),
    search_contexts: cleanContexts(p.search_contexts),
    industry: String(p.industry || "").trim(),
    subindustry: String(p.subindustry || "").trim(),
    one_line: stripCites(p.one_line),
    bio: stripCites(p.bio),
  };
}

// "top 0.01%", "1M–10M", "6.5M followers" or "48 subscribers" → band index (0 = biggest), -1 if unreadable
const bandForCount = n => n >= 1e8 ? 0 : n >= 1e7 ? 1 : n >= 1e6 ? 2 : n >= 1e5 ? 3 : n >= 1e4 ? 4 : n >= 1e3 ? 5 : 6;
function bandIndex(v) {
  const s = String(v || "").toLowerCase().replace(/\s+/g, "");
  const exact = SOCIAL_BANDS.findIndex(b => b.followers.toLowerCase().replace(/\s+/g, "") === s);   // "<1K", "1K–10K"
  if (exact >= 0) return exact;
  if (s.includes("below") || s.startsWith("<") || s.startsWith("under")) return SOCIAL_BANDS.length - 1;
  const pct = s.match(/(\d*\.?\d+)%/);
  if (pct) { const i = SOCIAL_BANDS.findIndex(b => b.label.replace(/\s+/g, "") === `top${pct[1]}%`); if (i >= 0) return i; }
  const count = s.match(/(\d*\.?\d+)([kmb])/);
  if (count) return bandForCount(parseFloat(count[1]) * { k: 1e3, m: 1e6, b: 1e9 }[count[2]]);
  const bare = s.replace(/,/g, "").match(/^(\d+)(followers|subscribers|fans|subs)?$/);
  if (bare) return bandForCount(parseInt(bare[1], 10));
  return -1;
}
function validateSocial(p) {
  const accounts = (Array.isArray(p.accounts) ? p.accounts : []).filter(Boolean).map(a => {
    const band = bandIndex(a.band);
    const engagement = String(a.engagement || "").trim().toLowerCase();
    return { platform: stripCites(a.platform), handle: stripCites(a.handle), band, band_label: SOCIAL_BANDS[band]?.label || "", engagement: ENGAGEMENT_LEVELS.includes(engagement) ? engagement : "unknown", note: stripCites(a.note) };
  }).filter(a => a.band >= 0);
  return { accounts, confidence: accounts.length ? toConfidence(p.confidence) : "none", rationale: stripCites(p.rationale) };
}
// The fixed table that turns the accounts into a price.
function socialPrice(accounts) {
  if (!accounts.length) return { price: SOCIAL_NONE, tier: tierForPrice(SOCIAL_NONE), formula: `no accounts found — the ${money(SOCIAL_NONE)} floor` };
  const best = Math.min(...accounts.map(a => a.band));
  const top = accounts.filter(a => a.band === best), next = accounts.filter(a => a.band === best + 1);
  const base = SOCIAL_BANDS[best].base;
  const extraSame = Math.min(3, top.length - 1) * SOCIAL_EXTRA_SAME_BAND;
  const extraNext = Math.min(3, next.length) * SOCIAL_EXTRA_NEXT_BAND;
  const engagement = top.reduce((s, a) => s + SOCIAL_ENGAGEMENT[a.engagement], 0) / top.length;
  const price = Math.min(SOCIAL_MAX, Math.max(SOCIAL_MIN, round2(base * (1 + extraSame + extraNext) * (1 + engagement))));
  const pct = x => `${x > 0 ? "+" : ""}${Math.round(x * 100)}%`;
  const parts = [`${SOCIAL_BANDS[best].label} base ${money(base)}`];
  if (extraSame) parts.push(`${pct(extraSame)} for ${Math.min(3, top.length - 1)} more account${top.length > 2 ? "s" : ""} in that band`);
  if (extraNext) parts.push(`${pct(extraNext)} for ${Math.min(3, next.length)} account${next.length > 1 ? "s" : ""} one band below`);
  if (engagement) parts.push(`${pct(engagement)} engagement`);
  return { price, tier: tierForPrice(price), formula: parts.join(", ") };
}

function validateAnalyst(p) {
  const raw = toNumber(p.price);
  if (!Number.isFinite(raw) || raw < 0) throw new Error("price missing");
  const price = Math.max(PRICE_MIN, round2(raw));
  return {
    price,
    confidence: toConfidence(p.confidence),
    tier: tierName(p.tier, price),
    rationale: stripCites(p.rationale),
    evidence: Array.isArray(p.evidence) ? p.evidence.filter(Boolean).map(e => ({ label: stripCites(e.label), value: stripCites(e.value), note: stripCites(e.note) })) : [],
  };
}
function validatePeers(p) {
  if (!Array.isArray(p.people)) throw new Error("people missing");
  return { people: p.people.filter(x => x && x.name).map(x => ({ name: String(x.name).trim(), identified: isIdentified(x.identified), line: stripCites(x.line) })) };
}
// The judge reports the undiscounted price; the online-celebrity cut is applied here so it is exact.
function validateJudge(p) {
  const price = toNumber(p.price);
  if (!Number.isFinite(price) || price < 0) throw new Error("judge price missing");
  const w = p.weights || {};
  const base = Math.max(PRICE_MIN, round2(price));
  const online = Boolean(p.online_celebrity);
  const final = online ? Math.max(PRICE_MIN, round2(base * (1 - ONLINE_DISCOUNT))) : base;
  return {
    price: final,
    base_price: base,
    online_celebrity: online,
    online_celebrity_note: online ? stripCites(p.online_celebrity_note) : "",
    discount_pct: online ? Math.round(ONLINE_DISCOUNT * 100) : 0,
    tier: online ? tierForPrice(final) : tierName(p.tier, base),   // a cut can move someone down a band
    judge_tier: tierName(p.tier, base),
    confidence: ["high", "medium", "low"].includes(String(p.confidence).toLowerCase()) ? String(p.confidence).toLowerCase() : "low",
    weights: { social: toNumber(w.social) || 0, news: toNumber(w.news) || 0, industry: toNumber(w.industry) || 0 },
    anchors: Array.isArray(p.anchors) ? p.anchors.map(String).filter(a => ["social", "news", "industry"].includes(a)) : [],
    one_band_rule_applied: Boolean(p.one_band_rule_applied),
    rationale: stripCites(p.rationale),
  };
}

// ---------------------------------------------------------------------------
// Prompts — each AI receives exactly this text and nothing else
// ---------------------------------------------------------------------------
const JSON_RULE = "Return your entire answer as ONE JSON object inside a ```json fence, with nothing after the fence. Inside JSON strings, write newlines as \\n.";

function bioPrompt({ name, hint, tax }) {
  const taxLines = tax.map(t => t.subindustries.length
    ? `- ${t.industry}: ${t.subindustries.join(", ")}`
    : `- ${t.industry}: (no subindustry)`).join("\n");
  return `You are a research writer preparing a one-page biographical report.

SUBJECT: ${name}${hint ? `\nDISAMBIGUATION HINT: ${hint}` : ""}

Use Google Search to establish who this person is; do not write from memory alone. Write a one-page biographical report on who this person is, their accomplishments, what they have achieved, what they are known as, and any other relevant facts about them.

Rules:
1. Facts only. No opinions, no praise or criticism, no speculation, no evaluative adjectives.
2. No statistics. Do not include follower counts, career totals, records, box-office numbers, sales figures, salaries, rankings, or any other numbers used as measures. Describe achievements in words (for example "won multiple championships", not the count).
3. No recent news. Exclude anything from the past 3 months: no current events, ongoing stories, recent controversies, recent releases, transfers, or announcements.
4. Length: roughly one page (350–550 words) in plain paragraphs. No headings, bullet points, or markdown.
5. If you cannot confidently identify a specific real person by this name, set "identified" to false and explain in "bio" what you could and could not determine.
6. In "aliases", list other names that identify this person on their own: a stage name, ring name or gamertag (for example "Tyler1"). Never initials, abbreviations, team or brand names, or a nickname that could mean anyone. Use [] if there are none.
7. In "search_contexts", give two distinct phrases of one to four words each that a news search can add to the name to find this person and not a namesake, from two different angles: for example their company and their product, their team and their sport, their show and their network (["Cluely", "Interview Coder"] for a founder, ["Boston Celtics", "NBA"] for a player, ["League of Legends", "Twitch"] for a streamer). Not two wordings of the same thing.

Also classify the person into exactly one industry and one subindustry from this taxonomy. Use the exact strings shown. Use "" for subindustry only if no listed subindustry fits.
${taxLines}

${JSON_RULE}
{"identified": true, "canonical_name": "the full commonly used name", "aliases": ["other names they are widely known by"], "search_contexts": ["their company, team, show or field", "a second, different angle: their product, sport, network or role"], "industry": "...", "subindustry": "...", "one_line": "one sentence stating who they are", "bio": "the full report, paragraphs separated by \\n\\n"}`;
}

function socialPrompt({ name, oneLine, bio }) {
  return `You are one of three independent pricing analysts. Your lane is SOCIAL MEDIA ONLY.

SUBJECT: ${name} — ${oneLine}

BIOGRAPHY (use only to identify the right person and their official accounts):
${bio}

Task: Establish this person's current follower count and engagement with web search.

WHERE TO LOOK. Four platforms decide the price: Instagram, TikTok, YouTube and X/Twitter. Search for those, and for one more only when the biography says that is where this person's audience actually lives — Twitch or Kick for a streamer, Weibo or Douyin for a Chinese-language audience. If the results you already have happen to show other accounts (Facebook, Threads, Snapchat), report those too; they count toward the footprint. Never spend a search on one.

HOW TO SPEND YOUR ${SOCIAL_MAX_SEARCHES} SEARCHES. Open with one query that covers several platforms at once — a follower-count summary for the person usually lists every account they have on a single page. Then use what is left to pin down the account carrying the largest audience, because the best band alone sets the price; a smaller account only adjusts it. Do not run one search per platform, and do not answer from memory.

Do not consider career achievements, awards, news, or comparisons to other named people.

PERCENTILE BANDS — report each account as exactly one of these bands (the band, not a raw count, so the result stays comparable across people and survives stale numbers):
${PERCENTILE_ANCHORS}

ENGAGEMENT SIGNAL per account: "strong" (likes, comments, views or shares clearly above what is typical for that band, or posts routinely go viral), "average", "weak" (a large but inactive or low-response audience), or "unknown".

CONFIDENCE RUBRIC — you must pick exactly one:
high — found current figures on 2+ independent sources
medium — found figures but they are dated or from a single source
low — only found indirect signals (press mentions of "millions of followers", etc.)
none — no social presence found, or could not confirm the accounts belong to this person
Confidence is about how sure you are of the bands you report, not about how many accounts exist: two confirmed accounts with current counts is high (two sources) or medium (one source), never low.

Do not propose a price. The price is computed from the bands and engagement you report by a fixed table, so getting each account's band right matters more than anything else. Then write exactly two paragraphs describing the footprint: which accounts carry the person's main reach and their bands, how the audience is spread across platforms, and what the engagement looks like and how you established it.

${JSON_RULE}
{"accounts": [{"platform": "Instagram", "handle": "@handle", "band": "one of the bands exactly as written above", "engagement": "strong | average | weak | unknown", "note": "one short reason for the engagement call"}], "confidence": "high | medium | low | none", "rationale": "paragraph one\\n\\nparagraph two"}`;
}

function newsPrompt({ name, oneLine, bio }, feed) {
  const today = new Date();
  const from = new Date(today.getTime() - NEWS_WINDOW_DAYS * 86400000);
  const long = d => d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const head = `You are one of three independent pricing analysts. Your lane is RECENT NEWS ONLY.

Today is ${long(today)}. The only window you may consider is ${long(from)} through ${long(today)} (the past ${NEWS_WINDOW_DAYS} days).

SUBJECT: ${name} — ${oneLine}

BIOGRAPHY (use only to identify the right person and understand their baseline standing):
${bio}

PRICING TIERS (US dollars):
${TIERS_TABLE}`;

  // The evidence: either the dated headline list from Google News, or (fallback) the model's own searches.
  const n = feed?.items.length ?? 0;
  const task = feed
    ? `COVERAGE FOUND — Google News searches for ${feed.query} (each a name plus a context, to keep namesakes out), limited to the window, with duplicates and death notices removed, returned ${n} stor${n === 1 ? "y" : "ies"}${feed.capped ? " (a search stops at 100, so the true count is higher)" : ""}${n ? ` across ${feed.days} distinct day${feed.days === 1 ? "" : "s"}` : ""}. Most recent first, as date — outlet — headline:
${n ? feed.items.slice(0, NEWS_FEED_MAX).map(i => `${i.date.toISOString().slice(0, 10)} — ${i.source} — ${i.title}`).join("\n") : "(no stories inside the window)"}${n > NEWS_FEED_MAX ? `\n… and ${n - NEWS_FEED_MAX} more` : ""}

Task: Assess this coverage. Use the biography to discard stories that are about a different person with the same name or that mention the subject only in passing, and judge what remains: how much coverage there is, how prominent the outlets are, how it is spread across the window, and whether the sentiment is positive, negative, or mixed, as far as the headlines show. The list above is the only evidence: do not add, remove or redate stories from memory.`
    : `Task: Use Google Search to search thoroughly for news about this person published inside the window, both positive and negative: major-outlet coverage, sports, entertainment or business press, trending stories, awards, releases, performances, deals, scandals, legal issues, injuries, and public statements. Run several different searches (the name alone, the name plus their field, the name plus "news") before concluding there is little coverage; never conclude that from memory. Note how much coverage there is, how prominent the outlets are, how it is spread across the window, and whether the sentiment is positive, negative, or mixed. Ignore anything older than the window unless a story inside the window directly continues it.`;

  const pricing = `How to price: the biography gives you the baseline tier a person of this standing would normally occupy. The past ${NEWS_WINDOW_DAYS} days of news tells you whether they are currently in the public conversation.
- Read the baseline conservatively. This scale puts most working professionals with a real career — tour players outside the very top, starters, executives of large companies, well-known investors, mid-size creators — in Niche or rising or Known in their field. Mainstream recognizable needs crossover fame outside their own field, A-list is the top few in a field, and the bands above are household names.
- Little or no news is bad news. If a thorough search finds no coverage or only trivial mentions, price them BELOW the baseline the biography suggests. The quieter the window, the deeper the discount: a silent ${NEWS_WINDOW_DAYS} days for someone the biography paints as well known should cost them at least one tier band. Never treat silence as neutral.
- The scale runs down to $0.01, not $2. Someone the biography paints as essentially unknown — no press history, no audience, no professional standing — has a baseline in the Unknown band, and a silent window puts them at or near $0.01. An early-stage founder, a tiny creator or a local figure with a real but small footprint has a baseline in Barely known ($0.10–2), and a silent window puts them in its lower half. Only someone with a real, if marginal, professional standing (a roster spot, a ballot line, released work with an audience) starts as high as Obscure but real.
- Sustained, prominent coverage supports pricing at the baseline; coverage that clearly reaches beyond the person's own field (general-interest front pages, national storylines followed by people outside the field) supports pricing above it. Volume alone does not: a long list of stories is normal for anyone with regular trade, business or sports-press coverage, and a long list from field-specific outlets confirms the baseline rather than lifting it. Sentiment then adjusts within that: positive momentum pushes up; damaging negative coverage (scandal, suspension, legal trouble) pulls down even though it is attention.
- A single passing mention does not count as being in the conversation.`;

  const rubric = feed
    ? `CONFIDENCE RUBRIC — you must pick exactly one. Confidence is about how sure you are of the coverage picture, not about how much coverage there was:
high — the picture is clear: the stories that survive the biography check are clearly about this person and come from 2+ reputable outlets, or the list is empty or leaves nothing relevant for a person the biography describes
medium — some relevant coverage but single-source, minor outlets, or hard to attribute with confidence
low — the list is dominated by other people with the same name or by tangential mentions, so the picture is ambiguous
none — nothing in the list can be tied to this person and the biography does not identify them clearly`
    : `CONFIDENCE RUBRIC — you must pick exactly one. Confidence is about how sure you are of the coverage picture, not about how much coverage there was:
high — the picture is clear: either multiple dated stories from 2+ reputable outlets clearly about this person, or several searches confirm there is little or no coverage of this person inside the window
medium — some coverage found but single-source, minor outlets, or publication dates uncertain
low — results are ambiguous: mixed with other people of the same name, undated, or only tangential
none — could not confirm that any result relates to this person`;

  const paragraphs = "Then write exactly two paragraphs explaining why this is the correct price: the first on the amount and prominence of coverage (or the lack of it) and its sentiment, the second on how that moves them relative to their baseline.";
  const shape = `{"price": 0.00, "confidence": "high | medium | low | none", "tier": "tier name exactly as written in the table", "evidence": [{"label": "YYYY-MM-DD — Outlet", "value": "headline or one-line story summary", "note": "positive | negative | neutral | mixed"}], "rationale": "paragraph one\\n\\nparagraph two"}`;
  const tail = feed
    ? `Respond with a JSON object: ${shape}
List up to 8 of the most significant stories in "evidence", most recent first, with the dates and outlets exactly as given above. If none relate to this person, return an empty "evidence" array and say so in the rationale.`
    : `${JSON_RULE}
${shape}
List up to 8 of the most significant stories in "evidence", most recent first. If you found none, return an empty "evidence" array and say so in the rationale.`;
  return [head, task, pricing, rubric, paragraphs, tail].join("\n\n");
}

function industryPrompt({ name, oneLine, bio, industry, subindustry }, peers) {
  return `You are one of three independent pricing analysts. Your lane is INDUSTRY COMPARISON ONLY. Use nothing beyond what is in this message.

SUBJECT: ${name} — ${oneLine}
INDUSTRY: ${industry}
SUBINDUSTRY: ${subindustry || "(none)"}

BIOGRAPHY:
${bio}

PRICING TIERS (US dollars):
${TIERS_TABLE}

${peers.block}

Task: Compare the subject with their closest peers, using the reference prices as the established scale. Identify who the subject clearly sits above, who they clearly sit below, and who they are roughly level with, judged by stature, achievements, recognition and crossover appeal as described in the subject's biography and the peers' standing lines. Choose a specific price in US dollars that is consistent with those neighbours and with the tier definitions.

Evidence rules:
- Compare ONLY on the subject's biography and the peers' standing lines above. Do not assert anything about a peer that is not in their standing line, and do not rely on your own memory of them. A peer without a standing line is a price point only.
- The biography and the standing lines were written under the same rules (no statistics, nothing from the last 3 months), so compare like with like.
- The reference list bottoms out around $3, so it cannot show you the two bands beneath it. If the subject clearly sits below even the cheapest peer, do not stop at that peer's price. A $3 peer is a fringe professional with a real standing in the field (a roster spot, a ballot line, released work with an audience). An early-stage founder, a tiny creator or a local figure with no such standing is far below that, in Barely known ($0.10–2); a private individual with no press, no audience and no standing is Unknown, and the default there is $0.01.

CONFIDENCE RUBRIC — you must pick exactly one:
high — the biography clearly identifies the person and there are several close peers with standing lines in the same subindustry
medium — peers exist only at the industry level or mostly without standing lines, or the biography is thin
low — the biography is ambiguous or the available peers are poor fits
none — the subject could not be identified as a real, specific person

Then write exactly two paragraphs explaining why this is the correct price, naming the comparables and their prices.

Respond with a JSON object: {"price": 0.00, "confidence": "high | medium | low | none", "tier": "tier name exactly as written in the table", "evidence": [{"label": "Comparable name", "value": "$their price", "note": "subject is above | below | similar — brief reason"}], "rationale": "paragraph one\\n\\nparagraph two"}`;
}

// The judge prompt is split in two. Everything that is identical for every subject —
// the framing, the tier table, the bands and the rules — is sent as a cached system
// prompt; only the subject's name and the three analyst reports change per request.
// The CALIBRATION block records how each lane compared with the master list in the September 2026 check (see README);
// re-measure and update it after changing an analyst.
const JUDGE_SYSTEM = `You are the final pricing arbiter. Three independent analysts have each proposed a price for the same person, each with a confidence score and a rationale. Choose the final price.

PRICING TIERS (US dollars):
${TIERS_TABLE}

TIER BANDS, in order (used by the one-band rule below):
${TIER_BANDS}

CALIBRATION — how each analyst compared with the reference list when ten listed people were priced in September 2026:
- The industry estimate is the only one computed against the reference prices themselves. With the subject's own row hidden, it landed within one band of the list for every one of the ten, usually within a few dollars, a little high for people under $20. When its confidence is medium or high it is the best anchor for the LEVEL.
- The news estimate is read against the tier ladder in words and ran high across the board: about one band high for people in the $4–20 range and 15–35% high for A-list and household names, because a long headline list is normal for anyone with regular field coverage and the analyst reads it as a lift. Its strength is DIRECTION: momentum, scandal, silence. A confirmed-quiet window is strong evidence against someone whose standing lives in the press and weak evidence against someone whose standing lives online. A news estimate well above a confident industry estimate is a reason to sit high within the industry analyst's band, not to change bands, unless the stories show a real change in standing (a breakout, a scandal, a suspension).
- The social price is a fixed table on audience size. It runs low for traditional figures with modest accounts and two to three times high for internet-native creators who are on every platform (before the online-celebrity reduction, which is applied after you). But it is the only analyst that measures something directly, and for people the list has nobody comparable to — early founders and viral figures whose only measurable standing is their audience — it is often the only analyst that sees them at all: the news feed only finds stories that carry the person's name, and the list has almost nobody below $3 to compare them with.

Rules:
1. Weight the analysts by confidence and by the kind of evidence behind each estimate: high counts most, medium less, low very little, and an estimate with confidence "none" (or a failed analyst) carries no weight in the price. A measured audience (the social analyst searched and confirmed accounts) is direct evidence of standing. An empty news window and an industry price below the cheapest listed peer are indirect: the first is absence, the second an extrapolation past the end of the list.
2. One-band rule (hard constraint): an estimate with confidence low or none may not move the final price more than one tier band away from where the medium- and high-confidence estimates place the subject. If only one estimate is medium or high, anchor on it. If none are, choose conservatively within the band supported by the strongest available evidence and set your overall confidence to "low".
3. Audience rule (hard constraint): when the social analyst ran searches, reports at least one account in the top 0.1% band (100K–1M followers) or better, and its confidence is medium or high, an audience of that size is incompatible with the Barely known and Unknown bands. If the other analysts' case for a lower price rests on absence (a quiet window) or extrapolation (a price below the cheapest listed peer), the social price is the anchor: start from it and let the other two move it within the band it falls in. An industry estimate below the cheapest listed peer says only "below that peer", not how far below, so treat it as a ceiling at that peer's price, not as a point to average with. If instead the other analysts bracket the subject against real evidence (stories inside the window, listed peers on both sides), weigh normally and do not let the social price pull the subject to the top of the band they support: for people who are on every platform the table runs two to three times high, so their social price shows that the audience is real, not that they sit above their peers.
4. You are not required to average. You may side with one analyst when its evidence and reasoning are clearly stronger, as long as rules 2 and 3 hold.
5. Give the final price in US dollars to the cent, with exactly two decimal places (for example 14.37), and name the tier band it lands in. Do not round to whole dollars, halves or quarters: use the cents to express precisely where the subject sits within the band relative to the analysts' evidence. The scale runs from $0.01 to $70: $0.01 is the default for someone essentially nobody has heard of, and the bottom two bands are priced in cents (for example 0.04 or 0.62). Do not let an unknown person drift up to $2 because that is where the reference list ends.

6. Separately from the price, decide whether this person is a streamer, a gamer, or generally an online celebrity — someone whose fame was built on and lives on the internet (Twitch/Kick streaming, YouTube or gaming content, TikTok virality, meme fame) rather than in film, TV, music, sport, business or politics. Judge what the person actually is from the analysts' evidence. Do not go by any category label, and do not treat "has a big following" as the test — nearly everyone here does. The question is where the fame itself comes from.
   - Set "online_celebrity" true for: Twitch/Kick/YouTube streamers, gaming personalities, YouTubers, podcast-and-stream-native personalities, people famous mainly for going viral or for a meme.
   - Set it false for: actors, musicians, athletes, coaches, politicians, business figures and traditional media personalities — including ones with huge online followings, and including lifestyle, beauty or fashion influencers whose fame rests on modelling, reality TV or a consumer brand.
   - When it is genuinely borderline, set it false.
   In "online_celebrity_note" give one short sentence saying what the person is and why they do or do not qualify.
   IMPORTANT: report the full, undiscounted price in "price". Do NOT reduce the price yourself for this — the reduction is applied after you, and lowering it here would apply it twice.

Then write exactly two paragraphs: the first stating how much weight you gave each analyst and why, the second explaining the final number, including whether the one-band rule constrained it.

Respond with a JSON object: {"price": 14.37, "tier": "tier name exactly as written in the table", "confidence": "high | medium | low", "weights": {"social": 0, "news": 0, "industry": 0}, "anchors": ["the analysts you anchored on"], "one_band_rule_applied": false, "online_celebrity": false, "online_celebrity_note": "one sentence", "rationale": "paragraph one\\n\\nparagraph two"}  (weights are percentages that sum to 100; 0 for an analyst you ignored)`;

function judgeUser(name, results) {
  const block = (title, r, extra = "") => r.error
    ? `${title}\nThis analyst FAILED (${r.error}). Treat as confidence: none.`
    : `${title}\nProposed price: ${money(r.price)}   Confidence: ${r.confidence}   Tier: ${r.tier}${extra}\nRationale:\n${r.rationale}`;
  const social = results.social;
  const socialExtra = social.error ? "" :
    `\nThis price was computed by a fixed table from the accounts the analyst found (the best band sets the base; more accounts in that band and stronger engagement add to it). The analyst did not choose the number.` +
    `\nAccounts found: ${social.evidence.length ? social.evidence.map(e => `${e.label} — ${e.value}, ${e.note}`).join("; ") : "none"}` +
    (social.searched ? "" : `\nNOTE: this analyst did not run a single web search, so its figures come from memory and are unverified; its confidence has been capped at low for that reason.`);
  const ind = results.industry;
  const industryExtra = ind.error || !ind.peer_prices ? "" :
    `\nClosest peers on the list (same subindustry): ${ind.peers_total}, priced from ${money(ind.peer_prices.high)} down to ${money(ind.peer_prices.low)}.` +
    (ind.price < ind.peer_prices.low ? ` This estimate is BELOW the cheapest listed peer: an extrapolation past the end of the list, not a comparison bracketed by peers.` : "");
  return `SUBJECT: ${name}

${block("ANALYST 1 — SOCIAL MEDIA (followers and engagement only)", social, socialExtra)}

${block(`ANALYST 2 — RECENT NEWS (past ${NEWS_WINDOW_DAYS} days, positive and negative; this analyst is instructed to treat little or no news as a negative signal and price below baseline for a quiet window)`, results.news)}

${block("ANALYST 3 — INDUSTRY COMPARISON (against the established reference price list)", ind, industryExtra)}`;
}

function peerLinesPrompt(batch) {
  return `You are a research writer. For each person listed below, write one or two sentences stating who they are and where they stand in their field: what they are known for, the level they compete or work at, and notable achievements described in words. Use Google Search to confirm each person.

Rules:
1. Facts only. No opinions, no evaluative adjectives.
2. No statistics: no follower counts, career totals, records, rankings, sales or box-office figures. Describe achievements in words.
3. No recent news: nothing from the past 3 months.
4. Keep each line under 45 words.
5. If you cannot confidently identify a specific real person from the name and field given, set "identified" to false and leave "line" empty. Never invent.

PEOPLE (name — field):
${batch.map((r, i) => `${i + 1}. ${r.name} — ${r.industry}${r.subindustry ? " / " + r.subindustry : ""}`).join("\n")}

${JSON_RULE}
{"people": [{"name": "exactly as listed above", "identified": true, "line": "..."}]}  (one entry per person, in the same order as listed)`;
}

// ---------------------------------------------------------------------------
// Peer standing lines (Postgres, seeded from data/pauv_peer_lines.csv): one or two grounded sentences per
// master-list person, so the industry analyst compares against real information instead of its own memory.
// ---------------------------------------------------------------------------
const peerKey = r => `${slug(r.name)}__${slug(r.industry) || "x"}`;
// key → row. A rewrite for the same person replaces the earlier row (an upsert on the key).
async function loadPeerLines() {
  const map = new Map();
  for (const r of await store.listPeerLines()) map.set(peerKey(r), r);
  return map;
}

async function buildPeerLines(rows, { onProgress, signal, force = false } = {}) {
  const have = await loadPeerLines();
  const todo = rows.filter(r => force || !have.has(peerKey(r)));
  const batches = [];
  for (let i = 0; i < todo.length; i += PEER_BATCH) batches.push(todo.slice(i, i + PEER_BATCH));
  let done = 0; const failed = [];
  const worker = async () => {
    while (batches.length && !signal?.aborted) {
      const batch = batches.shift();
      try {
        const raw = await gemini({ prompt: peerLinesPrompt(batch), search: true, signal });
        const { people } = await structured(raw, PEERS_SCHEMA, validatePeers, signal);
        const byName = new Map(people.map(p => [norm(p.name), p]));
        const lines = [];
        batch.forEach((r, i) => {
          const p = byName.get(norm(r.name)) || (people.length === batch.length ? people[i] : null);
          if (!p) { failed.push(r.name); return; }
          lines.push({ key: peerKey(r), name: r.name, industry: r.industry, subindustry: r.subindustry, identified: p.identified && !!p.line, line: p.line, model: raw.model, written_at: new Date().toISOString() });
        });
        if (lines.length) await store.upsertPeerLines(lines);
      } catch (e) {
        if (signal?.aborted) return;
        failed.push(...batch.map(r => r.name));
        console.warn(`  peer batch failed (${batch[0].name}…): ${e.message}`);
      }
      done += batch.length;
      onProgress?.({ done, total: todo.length, failed: failed.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(PEER_CONCURRENCY, batches.length) }, worker));
  return { total: todo.length, failed };
}

// Same-subindustry peers get their standing line; the rest of the industry is price-only. If the subject is already
// on the list, their own row is left out, so their existing price cannot anchor the comparison.
function buildPeerContext(industry, subindustry, rows, peers, exclude = []) {
  const skip = new Set(exclude.map(norm).filter(Boolean));
  rows = rows.filter(r => !skip.has(norm(r.name)));
  let scope = rows.filter(r => r.industry === industry);
  let restLabel = industry.toUpperCase();
  if (!scope.length) { scope = rows; restLabel = "THE REFERENCE LIST"; }
  const same = scope.filter(r => r.subindustry === subindustry).sort((a, b) => b.price - a.price);
  const rest = scope.filter(r => r.subindustry !== subindustry).sort((a, b) => b.price - a.price);
  const lined = same.map(r => { const c = peers.get(peerKey(r)); return { ...r, line: c?.identified && c.line ? c.line : null }; });
  const sameLabel = subindustry ? `${industry} / ${subindustry}` : `${industry} with no subindustry`;
  const parts = [
    `CLOSEST PEERS — everyone on the reference list in ${sameLabel} (${same.length} people, highest price first). Each has a standing line written under the same rules as the subject's biography: facts only, no statistics, nothing from the last 3 months.`,
    ...lined.map(l => `${money(l.price).padStart(7)}  ${l.name} — ${l.line || "(no standing line available: treat as a price point only)"}`),
  ];
  if (rest.length) parts.push("", `REST OF ${restLabel} — price only (${rest.length} people, highest price first):`, ...rest.map(r => `${money(r.price).padStart(7)}  ${r.name}${r.subindustry ? `  (${r.subindustry})` : ""}`));
  return { same, linedCount: lined.filter(l => l.line).length, block: parts.join("\n") };
}

// ---------------------------------------------------------------------------
// The judge — Claude with schema-enforced output
// ---------------------------------------------------------------------------
async function judge(user, signal) {
  const res = await anthropic().messages.create({
    model: JUDGE_MODEL,
    max_tokens: 16000,
    // The static half is cached: a run within the TTL of the last one reads it at a tenth
    // of the input price instead of paying for those tokens again.
    system: [{ type: "text", text: JUDGE_SYSTEM, cache_control: { type: "ephemeral", ttl: JUDGE_CACHE_TTL } }],
    messages: [{ role: "user", content: user }],
    output_config: { format: { type: "json_schema", schema: JUDGE_SCHEMA }, effort: JUDGE_EFFORT },
  }, { signal });
  if (res.stop_reason === "refusal") throw new Error(`Claude declined to answer (${res.stop_details?.category || "refusal"})`);
  const j = extractJson(res.content.filter(b => b.type === "text").map(b => b.text).join(""));
  if (!j) throw new Error("Judge returned no JSON");
  const u = res.usage;
  console.log(`  judge: ${u.input_tokens} new + ${u.cache_read_input_tokens || 0} cached in / ${u.output_tokens} out` +
    `  (${u.cache_creation_input_tokens ? "wrote cache" : u.cache_read_input_tokens ? "cache hit" : "no cache"})`);
  return { ...validateJudge(j), model: res.model, usage: u };
}

// ---------------------------------------------------------------------------
// The pricing log (Postgres, seeded from data/pauv_priced.csv): one row per completed pricing. The columns are
// PRICED_COLUMNS in ./store; pricedRow() below fills them.
// ---------------------------------------------------------------------------
function pricedRow({ startedAt, name, hint, bio, results, final }) {
  const r = k => results[k] || {};
  const ok = k => results[k] && !results[k].error;
  const searchedText = k => r(k).feed ? `feed: ${r(k).feed.in_window}${r(k).feed.capped ? "+" : ""} stories (${r(k).feed.query})` : r(k).searched == null ? "" : r(k).searched ? (r(k).attempts > 1 ? "yes (second attempt)" : "yes") : "no";
  const evidence = (k, f) => ok(k) ? (r(k).evidence || []).map(f).join("; ") : "";
  const w = final.weights;
  return {
    priced_at: startedAt, name, hint, canonical_name: bio.canonical_name, industry: bio.industry, subindustry: bio.subindustry, one_line: bio.one_line, bio: bio.bio,
    social_price: ok("social") ? r("social").price : "", social_confidence: ok("social") ? r("social").confidence : "failed", social_searched: searchedText("social"),
    social_accounts: evidence("social", e => `${e.label}: ${e.value}, ${e.note}`),
    news_price: ok("news") ? r("news").price : "", news_confidence: ok("news") ? r("news").confidence : "failed", news_searched: searchedText("news"),
    news_stories: evidence("news", e => `${e.label}: ${e.value} (${e.note})`),
    industry_price: ok("industry") ? r("industry").price : "", industry_confidence: ok("industry") ? r("industry").confidence : "failed",
    industry_peers: evidence("industry", e => `${e.label} ${e.value} — ${e.note}`),
    judge_price: final.base_price, online_celebrity: final.online_celebrity, final_price: final.price, final_tier: final.tier, final_confidence: final.confidence,
    weights: `social ${w.social} / news ${w.news} / industry ${w.industry}`, anchors: final.anchors.join(", "), one_band_rule: final.one_band_rule_applied,
    models: `bio ${bio.model}; social ${r("social").model || "-"}; news ${r("news").model || "-"}; industry ${r("industry").model || "-"}; judge ${final.model}`,
    social_rationale: ok("social") ? r("social").rationale : r("social").error || "",
    news_rationale: ok("news") ? r("news").rationale : r("news").error || "",
    industry_rationale: ok("industry") ? r("industry").rationale : r("industry").error || "",
    judge_rationale: final.rationale,
  };
}
// The most recent earlier pricing of this name, if any — shown, never reused. Matched on the normalised name or
// canonical name, exactly as the CSV version did.
const pricedBefore = name => store.pricedBefore(norm(name));

// ---------------------------------------------------------------------------
// Storage. The tables self-create; the first use in a process also loads the two seed CSVs into empty tables
// (the standalone's peer lines and test history), so nothing was lost moving off the files. Once per process.
// ---------------------------------------------------------------------------
async function seedStore() {
  if (await store.countPeerLines() === 0) {
    const rows = readCsv(PEERS_SEED).map(r => ({ key: peerKey(r), name: r.name, industry: r.industry, subindustry: r.subindustry, identified: r.identified === "true", line: r.line, model: r.model, written_at: r.written_at }));
    if (rows.length) { await store.upsertPeerLines(rows); console.log(`pricer: seeded ${rows.length} peer standing lines from the CSV`); }
  }
  if (await store.countPriced() === 0) {
    const rows = readCsv(PRICED_SEED).map(r => ({ ...r, name_norm: norm(r.name), canonical_norm: norm(r.canonical_name) }));
    if (rows.length) { await store.insertPriced(rows); console.log(`pricer: seeded ${rows.length} earlier pricings from the CSV`); }
  }
}
const g = globalThis;
export function ensureStore() {
  return (g.__pricerStoreReady ??= store.ensureSchema().then(seedStore).catch(e => { delete g.__pricerStoreReady; throw e; }));
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------
async function runPipeline({ name, hint }, emit, signal) {
  requireKeys();
  await ensureStore();
  const master = loadMaster();
  const tax = taxonomy(master);
  const startedAt = new Date().toISOString();
  emit("info", { existing: master.find(r => norm(r.name) === norm(name)) || null, priced_before: await pricedBefore(name) });
  const note = step => n => emit("step", { step, status: "running", note: n });

  // ---- Step 2: bio ----
  emit("step", { step: "bio", status: "running" });
  const bioCall = await grounded(bioPrompt({ name, hint, tax }), signal, note("bio"));
  const bio = { ...await structured(bioCall.raw, BIO_SCHEMA, validateBio, signal), searched: bioCall.searched, attempts: bioCall.attempts, sources: bioCall.raw.sources, queries: bioCall.raw.queries, model: bioCall.raw.model };
  if (!bio.canonical_name) bio.canonical_name = name;
  bio.industry_known = tax.some(t => t.industry === bio.industry);
  emit("step", { step: "bio", status: "done", data: bio });

  const { industry, subindustry } = bio;
  const ctx = { name: bio.canonical_name, oneLine: bio.one_line, bio: bio.bio, industry, subindustry };

  // ---- Steps 3–5: three independent analysts in parallel ----
  const analysts = {
    social: async () => {
      const { raw, attempts, searched } = await groundedSocial(socialPrompt(ctx), signal, note("social"));
      const found = await structured(raw, SOCIAL_SCHEMA, validateSocial, signal);
      // From memory the bands are unverified: the judge's one-band rule then contains this estimate.
      const confidence = !searched && ["high", "medium"].includes(found.confidence) ? "low" : found.confidence;
      const evidence = found.accounts.map(a => ({ label: `${a.platform} ${a.handle}`.trim(), value: a.band_label, note: `${a.engagement}${a.note ? " — " + a.note : ""}` }));
      return { ...socialPrice(found.accounts), confidence, rationale: found.rationale, evidence, searched, attempts, searches: raw.searches ?? raw.queries.length, sources: raw.sources, queries: raw.queries, model: raw.model };
    },
    news: async () => {
      // Dated headlines from Google News, then Gemini prices from that list in schema mode (no search tool involved).
      let feed = null;
      try { feed = await fetchNews(newsSearches(name, hint, bio), NEWS_WINDOW_DAYS, signal); }
      catch (e) {
        if (signal.aborted) throw e;
        console.warn(`news: Google News feed failed (${e.message.slice(0, 120)}) — searching with Gemini instead`);
        note("news")(`news feed unavailable — searching with ${GEMINI_MODEL} instead`);
      }
      if (feed) {
        const raw = await gemini({ prompt: newsPrompt(ctx, feed), schema: ANALYST_SCHEMA, signal, onNote: note("news") });
        return {
          ...await structured(raw, ANALYST_SCHEMA, validateAnalyst, signal),
          source: "google-news", feed: { query: feed.query, in_window: feed.items.length, capped: feed.capped, days: feed.days, obituaries_dropped: feed.obituaries }, searched: true, attempts: 1,
          sources: feed.items.slice(0, 40).map(i => ({ title: `${i.date.toISOString().slice(0, 10)} — ${i.source} — ${i.title}`, uri: i.link })), queries: [feed.query], model: raw.model,
        };
      }
      // Fallback: the model searches for itself. Written from memory it is either invented or a false "quiet window", so that is discarded.
      const { raw, attempts, searched } = await grounded(newsPrompt(ctx, null), signal, note("news"));
      if (!searched) throw Object.assign(new Error(`the news feed was unavailable and the model answered without running a single web search, twice, so its picture of the past ${NEWS_WINDOW_DAYS} days is unverified and was discarded`), { searched: false, attempts });
      return { ...await structured(raw, ANALYST_SCHEMA, validateAnalyst, signal), source: "web", searched, attempts, sources: raw.sources, queries: raw.queries, model: raw.model };
    },
    industry: async () => {
      // Every same-subindustry peer needs a standing line first (written once, then kept in the store).
      const notSelf = [name, bio.canonical_name, ...bio.aliases];
      const have = await loadPeerLines();
      let peers = buildPeerContext(industry, subindustry, master, have, notSelf);
      const missing = peers.same.filter(r => !have.has(peerKey(r)));
      if (missing.length) {
        note("industry")(`writing standing lines for ${missing.length} peers first`);
        await buildPeerLines(missing, { signal });
        emit("step", { step: "industry", status: "running" });
        peers = buildPeerContext(industry, subindustry, master, await loadPeerLines(), notSelf);
      }
      const raw = await gemini({ prompt: industryPrompt(ctx, peers), schema: ANALYST_SCHEMA, signal, onNote: note("industry") });
      const peerPrices = peers.same.length ? { high: Number(peers.same[0].price), low: Number(peers.same.at(-1).price) } : null;   // sorted highest first
      return { ...await structured(raw, ANALYST_SCHEMA, validateAnalyst, signal), peers_total: peers.same.length, peers_with_lines: peers.linedCount, peer_prices: peerPrices, model: raw.model };
    },
  };
  const results = {};
  await Promise.all(Object.entries(analysts).map(async ([step, call]) => {
    emit("step", { step, status: "running" });
    try {
      results[step] = await call();
      emit("step", { step, status: "done", data: results[step] });
    } catch (e) {
      if (signal.aborted) throw e;
      results[step] = { error: e.message, searched: e.searched, attempts: e.attempts };
      emit("step", { step, status: "error", error: e.message });
    }
  }));
  if (!Object.values(results).some(r => !r.error)) throw new Error("All three pricing analysts failed, so there is nothing to judge.");

  // ---- Step 6: the judge ----
  emit("step", { step: "final", status: "running" });
  const verdict = await judge(judgeUser(ctx.name, results), signal);
  const final = { ...verdict, price_credits: CREDITS_PER_USD ? round2(verdict.price * CREDITS_PER_USD) : null };
  if (verdict.online_celebrity) console.log(`  online-celebrity discount -${verdict.discount_pct}%: ${money(verdict.base_price)} -> ${money(verdict.price)}`);
  emit("step", { step: "final", status: "done", data: final });

  // ---- Log the run ----
  let logged = false;
  try { await store.insertPriced([{ ...pricedRow({ startedAt, name, hint, bio, results, final }), name_norm: norm(name), canonical_norm: norm(bio.canonical_name) }]); logged = true; }
  catch (e) { console.warn("Could not write the pricing log:", e.message); }
  const run = { startedAt, finishedAt: new Date().toISOString(), input: { name, hint }, models: { fast: GEMINI_MODEL, social: SOCIAL_MODEL, judge: JUDGE_MODEL }, bio, analysts: results, final };
  emit("done", { logged, run });
}

// What the /api/pricer/* route handlers use. Everything else in this file is the pipeline.
export { runPipeline, loadMaster, GEMINI_MODEL, SOCIAL_MODEL, JUDGE_MODEL, CREDITS_PER_USD, NEWS_WINDOW_DAYS };
