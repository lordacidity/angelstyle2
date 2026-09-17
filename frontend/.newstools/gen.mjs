// src/lib/news/google-news.ts
import { request as httpsRequest2 } from "node:https";

// src/lib/news/html.ts
import { request as httpsRequest } from "node:https";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
var NAMED = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201C",
  rdquo: "\u201D",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  bull: "\u2022",
  middot: "\xB7",
  eacute: "\xE9",
  egrave: "\xE8",
  aacute: "\xE1",
  iacute: "\xED",
  oacute: "\xF3",
  uacute: "\xFA",
  ntilde: "\xF1",
  ccedil: "\xE7",
  uuml: "\xFC",
  ouml: "\xF6",
  auml: "\xE4",
  szlig: "\xDF",
  Eacute: "\xC9",
  Aacute: "\xC1",
  Oacute: "\xD3",
  Ntilde: "\xD1",
  copy: "\xA9",
  reg: "\xAE",
  trade: "\u2122"
};
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 1114112 ? String.fromCodePoint(cp) : m;
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
  });
}
function textOf(fragment) {
  return decodeEntities(fragment.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")).replace(/[ \s]+/g, " ").trim();
}
function jsonLdObjects(html) {
  const out = [];
  const walk = (x) => {
    if (Array.isArray(x)) {
      x.forEach(walk);
      return;
    }
    if (x && typeof x === "object") {
      out.push(x);
      const g = x["@graph"];
      if (g) walk(g);
    }
  };
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walk(JSON.parse(m[1].trim()));
    } catch {
    }
  }
  return out;
}
function articleLd(html) {
  return jsonLdObjects(html).find((o) => /Article|BlogPosting/i.test([o["@type"]].flat().join(","))) ?? null;
}
function ldString(v) {
  if (typeof v === "string") return v.trim() || null;
  return null;
}
function ldAuthors(v) {
  const names = [v].flat().map((a) => {
    if (typeof a === "string") return a;
    if (a && typeof a === "object") return ldString(a.name) ?? "";
    return "";
  });
  const seen = /* @__PURE__ */ new Set();
  return names.map((n) => decodeEntities(n).replace(/\s+/g, " ").trim()).filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
}
function elementText(html, tag, classPart) {
  const re = new RegExp(`<${tag}[^>]*class="[^"]*${classPart}[^"]*"[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = html.match(re);
  const t = m ? textOf(m[1]) : "";
  return t || null;
}
function firstH1(html) {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const t = m ? textOf(m[1]) : "";
  return t || null;
}
function isShouting(text) {
  const letters = text.replace(/[^A-Za-z]/g, "");
  return letters.length >= 12 && letters === letters.toUpperCase();
}
var BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9"
};
async function fetchText(url, timeoutMs = 15e3) {
  const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow", signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  return { status: res.status, text: await res.text(), finalUrl: res.url || url };
}
function fetchTextPlain(url, timeoutMs = 15e3, hops = 4) {
  return new Promise((resolve2, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      reject(new Error("not a link"));
      return;
    }
    const req = httpsRequest({
      host: u.hostname,
      path: u.pathname + u.search,
      method: "GET",
      headers: { Host: u.hostname, ...BROWSER_HEADERS },
      timeout: timeoutMs
    }, (res) => {
      const code = res.statusCode ?? 0;
      const location = res.headers.location;
      if (code >= 300 && code < 400 && location && hops > 0) {
        res.resume();
        fetchTextPlain(new URL(location, u).toString(), timeoutMs, hops - 1).then(resolve2, reject);
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        const enc = String(res.headers["content-encoding"] ?? "");
        let text;
        try {
          text = (enc === "gzip" ? gunzipSync(body) : enc === "br" ? brotliDecompressSync(body) : enc === "deflate" ? inflateSync(body) : body).toString("utf8");
        } catch {
          text = body.toString("utf8");
        }
        resolve2({ status: code, text, finalUrl: u.toString() });
      });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end();
  });
}
async function fetchPage(url, timeoutMs = 15e3) {
  const first = await fetchText(url, timeoutMs).catch((err) => err instanceof Error ? err : new Error(String(err)));
  if (!(first instanceof Error) && first.status !== 403) return first;
  let last = first;
  for (let i = 0; i < 3; i++) {
    last = await fetchTextPlain(url, timeoutMs).catch((err) => err instanceof Error ? err : new Error(String(err)));
    if (!(last instanceof Error) && last.status !== 403) return last;
  }
  if (last instanceof Error) throw last;
  return last;
}

// src/lib/news/outlets.ts
var OUTLETS = [
  { id: "espn", name: "ESPN", hosts: ["espn.com"], color: "#d00" },
  { id: "cnn", name: "CNN", hosts: ["cnn.com"], color: "#cc0000" },
  { id: "fox", name: "Fox News", hosts: ["foxnews.com"], color: "#003366" },
  { id: "nyt", name: "The New York Times", hosts: ["nytimes.com"], color: "#121212" },
  { id: "tmz", name: "TMZ", hosts: ["tmz.com"], color: "#d8000f" },
  { id: "bbc", name: "BBC", hosts: ["bbc.com", "bbc.co.uk"], color: "#141414" },
  { id: "people", name: "People", hosts: ["people.com"], color: "#29abe2" },
  { id: "imdb", name: "IMDb", hosts: ["imdb.com"], color: "#f5c518" }
];
var OUTLET_IDS = OUTLETS.map((o) => o.id);
function outletById(id) {
  return OUTLETS.find((o) => o.id === id);
}
function outletForHost(host) {
  const h = host.toLowerCase().replace(/\.$/, "");
  for (const o of OUTLETS) {
    if (o.hosts.some((x) => h === x || h.endsWith("." + x))) return o.id;
  }
  return null;
}
function athleticId(url) {
  return url.pathname.match(/^\/athletic\/(\d+)\//)?.[1] ?? null;
}
function articleUrlProblem(outlet, url) {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  switch (outlet) {
    case "espn":
      return /\/id\/\d+/.test(path) ? null : "That ESPN link is not a story page.";
    case "cnn":
      if (/\/(videos?|audio|interactive|gallery)\//.test(path)) return "That CNN link is a video or interactive page, not an article.";
      return /\/\d{4}\/\d{2}\/\d{2}\//.test(path) ? null : "That CNN link is not an article page.";
    case "fox":
      if (host !== "www.foxnews.com" && host !== "foxnews.com") return "That Fox link is not a foxnews.com article.";
      if (/^\/(video|videos|shows|live)\b/.test(path)) return "That Fox link is a video page, not an article.";
      return path.split("/").filter(Boolean).length >= 2 ? null : "That Fox link is not an article page.";
    case "nyt":
      if (path.startsWith("/athletic/")) return athleticId(url) ? null : "That Athletic link is not an article page.";
      if (/\/(video|interactive|slideshow|podcasts?)\//.test(path)) return "That Times link is a video or interactive page, not an article.";
      return /\/\d{4}\/\d{2}\/\d{2}\//.test(path) ? null : "That Times link is not an article page.";
    case "tmz":
      if (/\/(watch|photos?)\//.test(path)) return "That TMZ link is a video or gallery, not an article.";
      return /^\/\d{4}\/\d{2}\/\d{2}\//.test(path) ? null : "That TMZ link is not an article page.";
    case "bbc":
      if (/\/(audio|videos?|sounds|iplayer|live)\//.test(path)) return "That BBC link is audio, video or a live page, not an article.";
      return /\/articles\/|\/news\/[a-z-]+-\d{6,}/.test(path) ? null : "That BBC link is not an article page.";
    case "people":
      if (/^\/(tag|author|about|video|videos|gallery|photos|sweepstakes|newsletter)\b/.test(path)) return "That People link is not an article page.";
      return /-\d{6,}\/?$/.test(path) ? null : "That People link is not an article page.";
    case "imdb":
      return /^\/news\/ni\d+\/?$/.test(path) ? null : "That IMDb link is not a news page.";
  }
}

// src/lib/news/google-news.ts
var FEED = "https://news.google.com/rss/search";
async function fetchFeed(q) {
  const url = new URL(FEED);
  url.searchParams.set("q", q);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");
  const res = await fetch(url, { headers: { "User-Agent": BROWSER_HEADERS["User-Agent"] }, signal: AbortSignal.timeout(15e3), cache: "no-store" });
  if (!res.ok) throw new Error(`Google News answered ${res.status}`);
  const xml = await res.text();
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const pick = (tag) => {
      const r = it.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
      return r ? decodeEntities(r[1].replace(/^<!\[CDATA\[|\]\]>$/g, "")).trim() : null;
    };
    const src = it.match(/<source url="([^"]*)">([\s\S]*?)<\/source>/);
    const link = pick("link");
    const title = pick("title");
    if (!link || !title) continue;
    const pub = pick("pubDate");
    const t = pub ? Date.parse(pub) : NaN;
    items.push({
      title,
      link,
      publishedAt: Number.isFinite(t) ? new Date(t).toISOString() : null,
      sourceUrl: src ? decodeEntities(src[1]) : null,
      sourceName: src ? decodeEntities(src[2]).trim() : null
    });
  }
  return items;
}
function stripSourceSuffix(title, sourceName) {
  const t = sourceName && title.endsWith(` - ${sourceName}`) ? title.slice(0, -(sourceName.length + 3)) : title.replace(/\s+-\s+[^-]{2,40}$/, "");
  return t.replace(/\s+-\s+The Athletic$/, "").trim();
}
function siteClause(ids) {
  const hosts = OUTLETS.filter((o) => ids.includes(o.id)).flatMap((o) => o.hosts);
  return hosts.length === 1 ? `site:${hosts[0]}` : `(${hosts.map((h) => `site:${h}`).join(" OR ")})`;
}
function outletOf(item) {
  if (!item.sourceUrl) return null;
  try {
    return outletForHost(new URL(item.sourceUrl).hostname);
  } catch {
    return null;
  }
}
function fold(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u2018\u2019]/g, "'").toLowerCase();
}
function headlineNames(title, query) {
  const words = fold(query).split(/[\s-]+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (words.length === 0) return false;
  return new RegExp(`(^|[^a-z0-9])${words.join("[\\s-]+")}(?![a-z0-9])`).test(fold(title));
}
function storyKey(outlet, url) {
  return `${outlet}|${url.pathname.toLowerCase().replace(/\/$/, "")}`;
}
async function searchApprovedNews(query, ids, range) {
  const when = range === "any" ? "" : ` when:${range}`;
  const items = await fetchFeed(`${query} ${siteClause(ids)}${when}`);
  const seenTitles = /* @__PURE__ */ new Set();
  const candidates = [];
  for (const it of items) {
    const outlet = outletOf(it);
    if (!outlet || !ids.includes(outlet)) continue;
    const title = stripSourceSuffix(it.title, it.sourceName);
    const key = `${outlet}|${title.toLowerCase()}`;
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    candidates.push({ outlet, title, item: it });
  }
  const urls = await resolveGoogleNewsLinks(candidates.map((c) => c.item.link));
  if (candidates.length > 0 && urls.every((u) => u === null)) {
    throw new Error("Google News wouldn't open any of the results. Try again in a minute.");
  }
  const seenStories = /* @__PURE__ */ new Set();
  const hits = [];
  candidates.forEach((c, i) => {
    const url = urls[i];
    if (!url) return;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (outletForHost(parsed.hostname) !== c.outlet || articleUrlProblem(c.outlet, parsed)) return;
    const key = storyKey(c.outlet, parsed);
    if (seenStories.has(key)) return;
    seenStories.add(key);
    hits.push({ outlet: c.outlet, title: c.title, publishedAt: c.item.publishedAt, link: c.item.link, url, named: headlineNames(c.title, query) });
  });
  const ts = (h) => h.publishedAt ? Date.parse(h.publishedAt) : 0;
  hits.sort((a, b) => Number(b.named) - Number(a.named) || ts(b) - ts(a));
  return hits;
}
async function latestFromOutlet(id, excludeTitle, limit = 12) {
  const items = await fetchFeed(`${siteClause([id])} when:1d`);
  const skip = excludeTitle.toLowerCase();
  const seen = /* @__PURE__ */ new Set([skip]);
  const out = [];
  for (const it of items) {
    if (outletOf(it) !== id) continue;
    const title = stripSourceSuffix(it.title, it.sourceName);
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, publishedAt: it.publishedAt });
    if (out.length >= limit) break;
  }
  return out;
}
var resolved = /* @__PURE__ */ new Map();
var RESOLVED_MAX = 5e3;
function remember(link, url) {
  if (resolved.size >= RESOLVED_MAX) resolved.delete(resolved.keys().next().value);
  resolved.set(link, url);
}
function httpsText(url, timeoutMs, redirects = 3) {
  return new Promise((resolve2, reject) => {
    const req = httpsRequest2(url, { headers: { "User-Agent": BROWSER_HEADERS["User-Agent"] }, timeout: timeoutMs }, (res) => {
      const next = res.headers.location;
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && next && redirects > 0) {
        res.resume();
        resolve2(httpsText(new URL(next, url).toString(), timeoutMs, redirects - 1));
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve2(body));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end();
  });
}
async function articleSignature(id) {
  try {
    const html = await httpsText(`https://news.google.com/rss/articles/${id}?hl=en-US&gl=US&ceid=US:en`, 1e4);
    const sig = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
    const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
    return sig && ts ? { sig, ts: Number(ts) } : null;
  } catch {
    return null;
  }
}
async function resolveGoogleNewsLinks(links) {
  const out = [];
  const todo = [];
  links.forEach((link, i) => {
    let u = null;
    try {
      u = new URL(link);
    } catch {
    }
    out.push(u && u.hostname !== "news.google.com" ? link : resolved.get(link) ?? null);
    const id = u?.hostname === "news.google.com" ? u.pathname.split("/").filter(Boolean).pop() : void 0;
    if (out[i] === null && id) todo.push({ i, link, id });
  });
  if (todo.length === 0) return out;
  const signed = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, todo.length) }, async () => {
    while (next < todo.length) {
      const t = todo[next++];
      const s = await articleSignature(t.id);
      if (s) signed.push({ ...t, ...s });
    }
  }));
  for (let start = 0; start < signed.length; start += 100) {
    const chunk = signed.slice(start, start + 100);
    const envelopes = chunk.map((c, n) => ["Fbv4je", JSON.stringify([
      "garturlreq",
      [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
      c.id,
      c.ts,
      c.sig
    ]), null, String(n + 1)]);
    let text;
    try {
      const res = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": BROWSER_HEADERS["User-Agent"] },
        body: "f.req=" + encodeURIComponent(JSON.stringify([envelopes])),
        signal: AbortSignal.timeout(2e4),
        cache: "no-store"
      });
      text = await res.text();
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.startsWith("[")) continue;
      let rows;
      try {
        rows = JSON.parse(line);
      } catch {
        continue;
      }
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (!Array.isArray(row) || row[0] !== "wrb.fr" || typeof row[2] !== "string") continue;
        const c = chunk[Number(row[row.length - 1]) - 1];
        let url;
        try {
          url = JSON.parse(row[2])[1];
        } catch {
          continue;
        }
        if (!c || typeof url !== "string" || !/^https?:\/\//.test(url)) continue;
        out[c.i] = url;
        remember(c.link, url);
      }
    }
  }
  return out;
}

// src/lib/news/imdb.ts
var ENDPOINT = "https://api.graphql.imdb.com/";
var IMDB_LISTS = [
  { category: "TOP", label: "Top news" },
  { category: "CELEBRITY", label: "Celebrity news" },
  { category: "MOVIE", label: "Movie news" },
  { category: "TV", label: "TV news" },
  { category: "INDIE", label: "Indie news" }
];
var QUERY = `query($c:NewsCategory!,$n:Int!){news(category:$c,first:$n){edges{node{
  id articleTitle{plainText} byline date source{homepage{label}} text{plainText}
}}}}`;
var cache = /* @__PURE__ */ new Map();
var CACHE_MS = 5 * 6e4;
var PER_LIST = 60;
async function fetchList(category, label) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-imdb-client-name": "imdb-web-next" },
    body: JSON.stringify({ query: QUERY, variables: { c: category, n: PER_LIST } }),
    signal: AbortSignal.timeout(15e3),
    cache: "no-store"
  });
  if (!res.ok) throw new Error(`IMDb answered ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0]?.message ?? "IMDb refused the request");
  const edges = json.data?.news?.edges ?? [];
  const out = [];
  for (const e of edges) {
    const n = e.node;
    const headline = n?.articleTitle?.plainText?.trim();
    const byline = n?.byline?.trim();
    const date = n?.date;
    if (!n?.id || !headline || !byline || !date) continue;
    const t = Date.parse(date);
    if (!Number.isFinite(t)) continue;
    out.push({
      id: n.id,
      headline,
      byline,
      publishedAt: new Date(t).toISOString(),
      paragraphs: (n.text?.plainText ?? "").split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean),
      source: n.source?.homepage?.label?.trim() || null,
      list: category,
      label
    });
  }
  return out;
}
async function list(category, label) {
  const hit = cache.get(category);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.items;
  const items = await fetchList(category, label);
  cache.set(category, { at: Date.now(), items });
  return items;
}
async function imdbNews() {
  const lists = await Promise.all(IMDB_LISTS.map((l) => list(l.category, l.label).catch(() => [])));
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const items of lists) {
    for (const it of items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(it);
    }
  }
  return out;
}
var imdbUrl = (id) => `https://www.imdb.com/news/${id}/`;
function imdbIdOf(url) {
  return url.pathname.match(/^\/news\/(ni\d+)\/?$/)?.[1] ?? null;
}
async function imdbItem(id) {
  return (await imdbNews()).find((i) => i.id === id) ?? null;
}
async function searchImdbNews(query, range) {
  const days = range === "1d" ? 1 : range === "7d" ? 7 : range === "30d" ? 30 : null;
  const since = days === null ? 0 : Date.now() - days * 864e5;
  const words = query.trim().split(/\s+/).filter(Boolean);
  const items = await imdbNews();
  const hits = [];
  for (const it of items) {
    if (Date.parse(it.publishedAt) < since) continue;
    const named = headlineNames(it.headline, query);
    const inText = words.length > 0 && it.paragraphs.some((p) => headlineNames(p, query));
    if (!named && !inText) continue;
    hits.push({
      outlet: "imdb",
      title: it.headline,
      publishedAt: it.publishedAt,
      link: imdbUrl(it.id),
      url: imdbUrl(it.id),
      named
    });
  }
  return hits;
}
async function imdbRail(exclude) {
  const items = await imdbNews();
  const taken = /* @__PURE__ */ new Set([exclude]);
  const pick = (want, n) => {
    const out = [];
    for (const it of items) {
      if (out.length >= n) break;
      if (it.list !== want || taken.has(it.id)) continue;
      taken.add(it.id);
      out.push(it);
    }
    return out;
  };
  const asRail = (its, label) => its.map((i) => ({ title: i.headline, publishedAt: i.publishedAt, byline: i.byline, group: label }));
  return [
    ...asRail(pick("MOVIE", 3), "Movie news"),
    ...asRail(pick("TOP", 4), "Top news"),
    ...asRail(pick("CELEBRITY", 4), "Celebrity news"),
    ...asRail(pick("INDIE", 4), "Indie news")
  ];
}

// src/lib/news/read-article.ts
var MAX_PARAGRAPHS = 60;
var ArticleError = class extends Error {
};
function cleanUrl(u) {
  return `${u.origin}${u.pathname}`;
}
function joinNames(names) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
var SECTION_NAMES = {
  us: "U.S.",
  uk: "UK",
  nyregion: "New York",
  politics: "Politics",
  world: "World",
  business: "Business",
  entertainment: "Entertainment",
  sport: "Sport",
  sports: "Sports",
  arts: "Arts",
  style: "Style",
  health: "Health",
  tech: "Tech",
  technology: "Technology",
  science: "Science",
  travel: "Travel",
  media: "Media",
  opinion: "Opinion",
  opinions: "Opinion",
  lifestyle: "Lifestyle",
  climate: "Climate",
  weather: "Weather",
  food: "Food",
  books: "Books",
  movies: "Movies",
  television: "Television",
  theater: "Theater",
  music: "Music",
  well: "Well",
  realestate: "Real Estate",
  magazine: "Magazine",
  upshot: "The Upshot",
  economy: "Economy",
  markets: "Markets",
  crime: "Crime"
};
function sectionName(slug) {
  if (!slug) return null;
  return SECTION_NAMES[slug] ?? slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function isoOrNull(v) {
  const s = ldString(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
var PROMO = /\b(sign up here|sign up for|subscribe (to|now|here)|newsletter|download the .{0,30}app|click here|follow us on|on bbc sounds|on bbc iplayer)\b/i;
function articleText(paragraphs) {
  return paragraphs.map((p) => p.replace(/[ \s]+/g, " ").trim()).filter((p) => p.length > 1 && !isShouting(p) && !(p.length < 240 && PROMO.test(p))).slice(0, MAX_PARAGRAPHS);
}
async function pageHtml(url, outlet) {
  let res;
  try {
    res = await fetchPage(url);
  } catch (err) {
    throw new ArticleError(`Couldn't reach ${outletById(outlet).name}: ${String(err instanceof Error ? err.message : err)}`);
  }
  if (res.status !== 200) {
    throw new ArticleError(`${outletById(outlet).name} wouldn't serve that page (${res.status}). Try another story.`);
  }
  return res.text;
}
function requireVerified(a) {
  const name = outletById(a.outlet).name;
  if (!a.headline) throw new ArticleError(`Couldn't read the headline from ${name}, so this story can't be used.`);
  if (a.authors.length === 0 && !a.byline) throw new ArticleError(`${name} doesn't credit an author on this story, so it can't be used.`);
  if (!a.publishedAt && !a.publishedDate) throw new ArticleError(`Couldn't read the publish date from ${name}, so this story can't be used.`);
  return a;
}
async function readEspn(u) {
  const id = u.pathname.match(/\/id\/(\d+)/)?.[1];
  if (!id) throw new ArticleError("That ESPN link has no story id.");
  let json;
  try {
    const res = await fetchText(`https://content.core.api.espn.com/v1/sports/news/${id}`);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    json = JSON.parse(res.text);
  } catch (err) {
    throw new ArticleError(`ESPN wouldn't serve that story (${err instanceof Error ? err.message : String(err)}).`);
  }
  const h = json.headlines?.[0];
  if (!h) throw new ArticleError("ESPN has no story under that id.");
  const categories = Array.isArray(h.categories) ? h.categories : [];
  const byType = (t) => categories.filter((c) => c.type === t).map((c) => ldString(c.description)).filter(Boolean);
  const byline = ldString(h.byline) ?? "";
  const authors = byline ? byline.split(/\s*(?:,|\band\b)\s*/).filter(Boolean) : byType("contributor");
  const story = ldString(h.story) ?? "";
  const paragraphs = story.split(/<\/p>|<p(?:\s[^>]*)?>|\n/i).map(textOf);
  const league = byType("league")[0] ?? ldString(h.section);
  const team = byType("team")[0] ?? null;
  return {
    outlet: "espn",
    url: cleanUrl(u),
    headline: decodeEntities(ldString(h.headline) ?? ""),
    headlineParts: null,
    sourceName: null,
    dek: null,
    authors,
    byline: byline || joinNames(authors),
    publishedAt: isoOrNull(h.published),
    publishedDate: null,
    updatedAt: isoOrNull(h.lastModified),
    section: league ?? null,
    paragraphs: articleText(paragraphs),
    keyPoints: [],
    live: h.isLiveBlog === true,
    notes: team ? [`Team: ${team}`] : []
  };
}
var MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
async function readNyt(u) {
  if (athleticId(u)) return readAthletic(u, athleticId(u));
  const url = cleanUrl(u);
  let j;
  try {
    const res = await fetchText(`https://www.nytimes.com/svc/oembed/json/?url=${encodeURIComponent(url)}`);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    j = JSON.parse(res.text);
  } catch (err) {
    throw new ArticleError(`The Times wouldn't describe that story (${err instanceof Error ? err.message : String(err)}).`);
  }
  const byline = ldString(j.author_name) ?? "";
  const authors = byline.replace(/^By\s+/i, "").split(/\s*(?:,|\band\b)\s*/).map((s) => s.trim()).filter(Boolean);
  let publishedDate = null;
  const d = (ldString(j.publication_date) ?? "").match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (d) {
    const m = MONTHS.indexOf(d[1].toLowerCase());
    if (m >= 0) publishedDate = `${d[3]}-${String(m + 1).padStart(2, "0")}-${d[2].padStart(2, "0")}`;
  }
  const seg = u.pathname.split("/").filter(Boolean);
  const afterDate = /^\d{4}$/.test(seg[0] ?? "") ? seg[3] : seg[0];
  return {
    outlet: "nyt",
    url,
    headline: decodeEntities(ldString(j.title) ?? ""),
    headlineParts: null,
    sourceName: null,
    dek: ldString(j.summary) ? decodeEntities(ldString(j.summary)) : null,
    authors,
    byline,
    publishedAt: null,
    publishedDate,
    updatedAt: null,
    section: afterDate === "live" ? null : sectionName(afterDate),
    paragraphs: [],
    keyPoints: [],
    live: u.pathname.includes("/live/"),
    notes: ["The Times doesn't let its article text be read, so the page shows the headline, summary and byline only."]
  };
}
async function readAthletic(u, id) {
  let a;
  try {
    const res = await fetch("https://api.theathletic.com/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": BROWSER_HEADERS["User-Agent"] },
      body: JSON.stringify({
        // id is digits only (athleticId)
        query: `{ articleById(id: "${id}") { id title excerpt_plaintext published_at primary_tag permalink authors { author { name } } } }`
      }),
      signal: AbortSignal.timeout(15e3),
      cache: "no-store"
    });
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    a = (await res.json()).data?.articleById ?? null;
  } catch (err) {
    throw new ArticleError(`The Athletic wouldn't describe that story (${err instanceof Error ? err.message : String(err)}).`);
  }
  if (!a || String(a.id) !== id) throw new ArticleError("The Athletic has no story under that id.");
  const authors = (Array.isArray(a.authors) ? a.authors : []).map((x) => ldString(x?.author?.name)).filter(Boolean);
  const ms = typeof a.published_at === "number" ? a.published_at : NaN;
  const league = ldString(a.primary_tag);
  return {
    outlet: "nyt",
    url: ldString(a.permalink) ?? cleanUrl(u),
    headline: decodeEntities(ldString(a.title) ?? ""),
    headlineParts: null,
    sourceName: null,
    dek: ldString(a.excerpt_plaintext) ? decodeEntities(ldString(a.excerpt_plaintext)) : null,
    authors,
    byline: joinNames(authors),
    publishedAt: Number.isFinite(ms) ? new Date(ms).toISOString() : null,
    publishedDate: null,
    updatedAt: null,
    section: "The Athletic",
    paragraphs: [],
    keyPoints: [],
    live: false,
    notes: [
      `A story from The Athletic${league ? ` (${league})` : ""}, shown on The Times' page.`,
      "The Athletic doesn't let its article text be read, so the page shows the headline, summary and byline only."
    ]
  };
}
async function readCnn(u) {
  const html = await pageHtml(u.toString(), "cnn");
  const ld = articleLd(html) ?? {};
  const authors = ldAuthors(ld.author);
  const paragraphs = [...html.matchAll(/<p[^>]*data-component-name="paragraph"[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => textOf(m[1]));
  const section = u.pathname.match(/^\/\d{4}\/\d{2}\/\d{2}\/([a-z-]+)\//)?.[1];
  return {
    outlet: "cnn",
    url: cleanUrl(u),
    headline: elementText(html, "h1", "headline__text") ?? firstH1(html) ?? decodeEntities(ldString(ld.headline) ?? ""),
    headlineParts: null,
    sourceName: null,
    dek: null,
    authors,
    byline: joinNames(authors),
    publishedAt: isoOrNull(ld.datePublished),
    publishedDate: null,
    updatedAt: isoOrNull(ld.dateModified),
    section: sectionName(section),
    paragraphs: articleText(paragraphs),
    keyPoints: [],
    live: u.pathname.includes("/live-news/"),
    notes: []
  };
}
async function readFox(u) {
  const html = await pageHtml(u.toString(), "fox");
  const ld = articleLd(html) ?? {};
  const authors = ldAuthors(ld.author);
  const bodyAt = html.search(/class="article-body"/);
  const body = bodyAt >= 0 ? html.slice(bodyAt, bodyAt + 2e5) : "";
  const paragraphs = [...body.matchAll(/<p\s[^>]*data-layout-index[^>]*>([\s\S]*?)<\/p>/gi)].filter((m) => !/^\s*<(strong|b)>\s*<a /i.test(m[1])).map((m) => textOf(m[1]));
  return {
    outlet: "fox",
    url: cleanUrl(u),
    headline: elementText(html, "h1", "headline") ?? firstH1(html) ?? decodeEntities(ldString(ld.headline) ?? ""),
    headlineParts: null,
    sourceName: null,
    dek: elementText(html, "h2", "sub-headline"),
    authors,
    byline: joinNames(authors),
    publishedAt: isoOrNull(ld.datePublished),
    publishedDate: null,
    updatedAt: isoOrNull(ld.dateModified),
    section: sectionName(u.pathname.split("/").filter(Boolean)[0]),
    paragraphs: articleText(paragraphs),
    keyPoints: [],
    live: false,
    notes: []
  };
}
function tmzFragment(html, n) {
  const m = html.match(new RegExp(`<(\\w+)[^>]*class="article__header--hf${n}[^"]*"[^>]*>([\\s\\S]*?)</\\1>`, "i"));
  const t = m ? textOf(m[2]) : "";
  return t || null;
}
async function readTmz(u) {
  const html = await pageHtml(u.toString(), "tmz");
  const ld = articleLd(html) ?? {};
  const authors = ldAuthors(ld.author);
  const headline = elementText(html, "h1", "article__header--headline-title") ?? firstH1(html) ?? decodeEntities(ldString(ld.headline) ?? "");
  const kicker = tmzFragment(html, 1);
  const main2 = tmzFragment(html, 2);
  const sub = tmzFragment(html, 3);
  const bodyText = decodeEntities(ldString(ld.articleBody) ?? "");
  return {
    outlet: "tmz",
    url: cleanUrl(u),
    headline,
    headlineParts: main2 ? { kicker, main: main2, sub } : null,
    sourceName: null,
    dek: null,
    authors,
    byline: joinNames(authors),
    publishedAt: isoOrNull(ld.datePublished),
    publishedDate: null,
    updatedAt: isoOrNull(ld.dateModified),
    section: null,
    paragraphs: articleText(bodyText.split(/\n\s*\n/)),
    keyPoints: [],
    live: false,
    notes: []
  };
}
async function readBbc(u) {
  const html = await pageHtml(u.toString(), "bbc");
  const ld = articleLd(html) ?? {};
  const authors = ldAuthors(ld.author);
  const paragraphs = [...html.matchAll(/data-component="text-block"[^>]*>([\s\S]*?)<\/div>/gi)].map((m) => textOf(m[1]));
  return {
    outlet: "bbc",
    url: cleanUrl(u),
    // The page's own headline; BBC's JSON-LD often carries a different, search-engine one.
    headline: firstH1(html) ?? decodeEntities(ldString(ld.headline) ?? ""),
    headlineParts: null,
    sourceName: null,
    dek: null,
    authors,
    byline: joinNames(authors),
    publishedAt: isoOrNull(ld.datePublished),
    publishedDate: null,
    updatedAt: isoOrNull(ld.dateModified),
    section: null,
    paragraphs: articleText(paragraphs),
    keyPoints: [],
    live: false,
    notes: []
  };
}
function peopleKeyPoints(html) {
  const block = html.match(/<div[^>]*class="[^"]*theme-needtoknow[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
  if (!block) return [];
  return [...block[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => textOf(m[1])).filter(Boolean).slice(0, 6);
}
async function readPeople(u) {
  const html = await pageHtml(u.toString(), "people");
  const ld = articleLd(html) ?? {};
  const authors = ldAuthors(ld.author);
  const paragraphs = [...html.matchAll(/<p[^>]*class="[^"]*mntl-sc-block-html[^"]*"[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => textOf(m[1]));
  const first = u.pathname.split("/").filter(Boolean);
  return {
    outlet: "people",
    url: cleanUrl(u),
    headline: elementText(html, "h1", "article-heading") ?? firstH1(html) ?? decodeEntities(ldString(ld.headline) ?? ""),
    headlineParts: null,
    sourceName: null,
    dek: elementText(html, "p", "article-subheading"),
    authors,
    byline: joinNames(authors),
    publishedAt: isoOrNull(ld.datePublished),
    publishedDate: null,
    updatedAt: isoOrNull(ld.dateModified),
    section: first.length > 1 ? sectionName(first[0]) : null,
    paragraphs: articleText(paragraphs),
    keyPoints: peopleKeyPoints(html),
    live: false,
    notes: []
  };
}
async function readImdb(u) {
  const id = imdbIdOf(u);
  if (!id) throw new ArticleError("That IMDb link has no news id.");
  let item;
  try {
    item = await imdbItem(id);
  } catch (err) {
    throw new ArticleError(`IMDb wouldn't serve that story (${err instanceof Error ? err.message : String(err)}).`);
  }
  if (!item) throw new ArticleError("IMDb is no longer listing that story, so it can't be read.");
  return {
    outlet: "imdb",
    url: imdbUrl(id),
    headline: item.headline,
    headlineParts: null,
    sourceName: item.source,
    dek: null,
    authors: [item.byline],
    byline: item.byline,
    publishedAt: item.publishedAt,
    publishedDate: null,
    updatedAt: null,
    section: null,
    paragraphs: articleText(item.paragraphs),
    keyPoints: [],
    live: false,
    notes: []
  };
}
async function readNewsArticle(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new ArticleError("That is not a valid link.");
  }
  const outlet = outletForHost(u.hostname);
  if (!outlet) throw new ArticleError(`${u.hostname} is not one of the approved outlets.`);
  const problem = articleUrlProblem(outlet, u);
  if (problem) throw new ArticleError(problem);
  const readers = {
    espn: readEspn,
    nyt: readNyt,
    cnn: readCnn,
    fox: readFox,
    tmz: readTmz,
    bbc: readBbc,
    people: readPeople,
    imdb: readImdb
  };
  const article = await readers[outlet](u);
  if (article.outlet !== "nyt" && article.paragraphs.length === 0) {
    article.notes.push(`Couldn't read the article text from ${outletById(outlet).name}; the page shows no paragraphs.`);
  }
  return requireVerified(article);
}

// src/lib/news/templates/shared.ts
var PHOTO_SLOTS = {
  espn: { hero: { width: 800, height: 450 }, thumbs: [] },
  cnn: { hero: { width: 680, height: 453 }, thumbs: [{ width: 400, height: 225 }, { width: 128, height: 72 }, { width: 128, height: 72 }, { width: 128, height: 72 }] },
  fox: { hero: { width: 1020, height: 540 }, thumbs: Array.from({ length: 4 }, () => ({ width: 352, height: 198 })) },
  nyt: { hero: { width: 705, height: 470 }, thumbs: [] },
  tmz: { hero: { width: 870, height: 490 }, thumbs: Array.from({ length: 6 }, () => ({ width: 133, height: 95 })) },
  bbc: { hero: { width: 1084, height: 609 }, thumbs: [] },
  // Four across the Top Stories strip, then the right column: one big, four small.
  people: { hero: { width: 600, height: 338 }, thumbs: [...Array.from({ length: 4 }, () => ({ width: 110, height: 78 })), { width: 300, height: 169 }, ...Array.from({ length: 4 }, () => ({ width: 110, height: 78 }))] },
  // Three under Similar News, then the rail's three lists of four.
  imdb: { hero: { width: 724, height: 407 }, thumbs: [...Array.from({ length: 3 }, () => ({ width: 88, height: 112 })), ...Array.from({ length: 12 }, () => ({ width: 84, height: 104 }))] }
};
var NO_PHOTOS = { hero: null, thumbs: [] };
function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}
function partsIn(iso, timeZone) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
    weekday: "short"
  });
  const p = {};
  for (const x of f.formatToParts(new Date(iso))) p[x.type] = x.value;
  return {
    year: p.year,
    month: Number(p.month),
    day: p.day,
    hour: p.hour,
    minute: p.minute,
    dayPeriod: (p.dayPeriod ?? "").toUpperCase(),
    tz: p.timeZoneName ?? "",
    weekday: p.weekday ?? ""
  };
}
var MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function wasUpdated(publishedAt, updatedAt) {
  if (!publishedAt || !updatedAt) return false;
  return Date.parse(updatedAt) - Date.parse(publishedAt) > 6e4;
}
function agoLong(iso, now) {
  const mins = Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 6e4));
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
function agoShort(iso, now) {
  const mins = Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 6e4));
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}
function photoPlaceholder(width, height, extraStyle = "") {
  const icon = Math.round(Math.min(width, height) * 0.16);
  return `<div class="np-photo" style="width:${width}px;height:${height}px;${extraStyle}"><svg width="${icon}" height="${icon}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg></div>`;
}
function photoBox(src, size, extraStyle = "") {
  if (!src) return photoPlaceholder(size.width, size.height, extraStyle);
  return `<img class="np-img" src="${esc(src)}" alt="" width="${size.width}" height="${size.height}" style="width:${size.width}px;height:${size.height}px;${extraStyle}"/>`;
}
var PLACEHOLDER_CSS = `.np-img { display: block; flex: none; object-fit: cover; }
.np-photo { background: #d7d9dc; color: #a9acb1; display: flex; align-items: center; justify-content: center; flex: none; }`;
var GOOGLE_G = `<svg width="16" height="16" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.9 6.2C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/></svg>`;

// src/lib/news/templates/bbc.ts
function bbcWhen(iso, now) {
  const days = (now.getTime() - Date.parse(iso)) / 864e5;
  if (days < 7) return agoLong(iso, now);
  const p = partsIn(iso, "Europe/London");
  return `${p.day} ${MONTH_LONG[p.month - 1]} ${p.year}`;
}
var CSS = `
.np { --ink: #141414; --grey: #545658; --line: #e6e8ea; --blue: #0a6cff;
  width: 1440px; background: #fff; color: var(--ink); font-family: Figtree, Arial, sans-serif; -webkit-font-smoothing: antialiased; padding-bottom: 80px; }
* { box-sizing: border-box; }
.top { position: relative; height: 94px; border-bottom: 1px solid var(--line); }
.top .menu { position: absolute; left: 25px; top: 35px; }
.top .live { position: absolute; left: 103px; top: 34px; display: flex; align-items: center; gap: 8px; font-size: 16.5px; font-weight: 500; }
.top .logo { position: absolute; left: 50%; top: 23px; height: 48px; margin-left: -81px; display: block; }
.top .right { position: absolute; right: 35px; top: 27px; display: flex; align-items: center; gap: 40px; font-size: 18px; font-weight: 500; }
.top .sub { background: var(--blue); color: #fff; height: 40px; padding: 0 17px; display: flex; align-items: center; }
.nav { height: 48px; border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: center; gap: 19px; font-size: 16.5px; font-weight: 500; }
.nav .div { width: 1px; height: 34px; background: var(--line); margin: 0 -9px; }
.col { width: 882px; margin: 0 auto; }
h1 { margin: 30px 0 0; font: 500 44.5px/52px "Noto Serif", Georgia, serif; letter-spacing: -.3px; }
.meta { display: flex; align-items: flex-start; margin-top: 16px; }
.meta .ago { font-size: 14px; color: var(--grey); }
.meta .acts { margin-left: auto; margin-top: 4px; display: flex; align-items: center; gap: 26px; font-size: 15px; font-weight: 500; }
.meta .acts span { display: inline-flex; align-items: center; gap: 8px; }
.meta .acts .gpref { border: 1px solid #b9bcbf; border-radius: 3px; height: 38px; padding: 0 10px; gap: 9px; color: #3b3d40; font-weight: 400; margin-left: -8px; }
.author { margin-top: 12px; font-size: 17.5px; font-weight: 600; }
.hero { position: relative; width: 1084px; margin: 34px auto 0; }
.hero .credit { position: absolute; left: 0; bottom: 0; max-width: 70%; background: rgba(0,0,0,.72); color: #fff; font-size: 13px; line-height: 17px; padding: 4px 8px; }
.body { width: 632px; margin-top: 38px; font: 400 21px/31px "Noto Serif", Georgia, serif; color: var(--ink); }
.body p { margin: 0 0 19px; }
${PLACEHOLDER_CSS}
`;
function renderBbc(a, _rail, now, photos) {
  const html = `
<div class="np">
  <header class="top">
    <svg class="menu" width="47" height="22" viewBox="0 0 47 22" fill="none" stroke="#141414" stroke-width="2.6"><path d="M0 3h17M0 11h13M0 19h17"/><circle cx="31" cy="10" r="8"/><path d="m37 16 7 6"/></svg>
    <div class="live"><svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.5" fill="none" stroke="#d4351c" stroke-width="2"/><circle cx="10" cy="10" r="5" fill="#d4351c"/></svg>Watch Live</div>
    <img class="logo" src="/news/bbc.png" alt="BBC"/>
    <div class="right"><span class="sub">Subscribe</span><span>Sign In</span></div>
  </header>
  <nav class="nav">
    <span>Home</span><span>News</span><span>Sport</span><span>Business</span><span>Technology</span><span>Health</span><span>Culture</span><span>Arts</span><span>Travel</span><span>Earth</span><span class="div"></span><span>Audio</span><span>Video</span><span>Live</span><span>Documentaries</span>
  </nav>
  <div class="col">
    <h1>${esc(a.headline)}</h1>
    <div class="meta">
      <div class="ago">${a.publishedAt ? bbcWhen(a.publishedAt, now) : ""}</div>
      <div class="acts">
        <span>Share <svg width="17" height="17" viewBox="0 0 17 17" fill="#141414"><circle cx="13.5" cy="3.5" r="2.6"/><circle cx="3.5" cy="8.5" r="2.6"/><circle cx="13.5" cy="13.5" r="2.6"/><path d="M13.5 3.5 3.5 8.5l10 5" stroke="#141414" stroke-width="1.8" fill="none"/></svg></span>
        <span>Save <svg width="14" height="18" viewBox="0 0 14 18" fill="none" stroke="#141414" stroke-width="2"><path d="M1.5 1.5h11v15l-5.5-4-5.5 4z"/></svg></span>
        <span class="gpref">${GOOGLE_G}Add as preferred on Google</span>
      </div>
    </div>
    <div class="author">${esc(a.byline)}</div>
  </div>
  <div class="hero">${photoBox(photos.hero?.src, PHOTO_SLOTS.bbc.hero)}${photos.hero ? `<span class="credit">${esc(photos.hero.credit)}</span>` : ""}</div>
  <div class="col">
    <div class="body">${a.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}</div>
  </div>
</div>`;
  return {
    css: CSS,
    html,
    fontsHref: "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600&family=Noto+Serif:wght@300..600&display=swap"
  };
}

// src/lib/news/templates/cnn.ts
var NAV = {
  Politics: ["Elections", "Congress", "Facts First", "CNN Polls"],
  Entertainment: ["Movies", "Television", "Celebrity"],
  Sport: ["Football", "Tennis", "Golf", "Motorsport"],
  Business: ["Tech", "Media", "Markets", "Calculators"],
  Health: ["Life, But Better", "Fitness", "Food", "Sleep"],
  World: ["Africa", "Americas", "Asia", "Europe", "Middle East"]
};
var DEFAULT_NAV = ["US", "World", "Politics", "Business", "Health"];
function cnnDay(iso) {
  const p = partsIn(iso, "America/New_York");
  return `${MONTH_SHORT[p.month - 1].toUpperCase()} ${p.day}, ${p.year}`;
}
var CHEVRON = `<svg width="11" height="7" viewBox="0 0 11 7"><path d="m1 1 4.5 4.5L10 1" stroke="#0c0c0c" fill="none" stroke-width="1.3"/></svg>`;
var CSS2 = `
.np { --red: #cc0000; --ink: #0c0c0c; --muted: #6e6e6e; --line: #e6e6e6;
  width: 1440px; background: #fff; color: var(--ink); font-family: Inter, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
* { box-sizing: border-box; }
.container { width: 1250px; margin: 0 auto; }
.header { height: 70px; display: flex; align-items: center; border-bottom: 2px solid var(--ink); }
.burger { width: 20px; display: grid; gap: 4px; margin-right: 26px; }
.burger i { display: block; height: 2px; background: var(--ink); }
.burger i:nth-child(2) { width: 14px; }
.brand { display: flex; align-items: center; gap: 8px; margin-right: 24px; }
.brand img { width: 47px; display: block; }
.brand b { font-size: 18px; font-weight: 700; letter-spacing: -.2px; }
.nav { display: flex; gap: 24px; font-size: 15px; font-weight: 500; }
.nav span { display: inline-flex; align-items: center; gap: 6px; }
.tools { margin-left: auto; display: flex; align-items: center; gap: 24px; font-size: 15px; font-weight: 500; }
.tools span { display: inline-flex; align-items: center; gap: 7px; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--red); }
.btn { font: 700 14px/1 Inter, Arial, sans-serif; padding: 8px 12px; border-radius: 4px; }
.btn.sub { background: var(--red); color: #fff; margin-left: 12px; }
.btn.sign { border: 1px solid var(--line); margin-left: -8px; }
.head { padding-top: 46px; }
.kicker { font-size: 12.5px; letter-spacing: 1px; text-transform: uppercase; font-weight: 600; min-height: 16px; }
h1 { position: relative; margin: 20px 0 0; font-size: 58px; line-height: 68px; font-weight: 700; letter-spacing: -1.2px; max-width: 1180px; }
h1::before { content: ""; position: absolute; left: -95px; top: -3px; bottom: -3px; width: 12px; background: var(--red); }
.updated { margin-top: 34px; font-size: 12px; font-weight: 500; text-transform: uppercase; display: flex; align-items: center; gap: 6px; }
.byline { margin-top: 20px; display: flex; align-items: center; gap: 6px; font-size: 14px; flex-wrap: wrap; }
.avatar { width: 40px; height: 40px; border-radius: 50%; background: #dcdcdc; color: #555; display: grid; place-items: center; font-size: 13px; font-weight: 600; }
.byline a { font-weight: 600; text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px; }
.row { display: grid; grid-template-columns: 810px 400px; gap: 40px; margin-top: 38px; padding-bottom: 70px; }
.body { width: 602px; margin: 30px 0 0 78px; font: 18.5px/32px "Source Serif 4", Georgia, serif; }
.body p { margin: 0 0 24px; }
.rail-title { border-top: 2px solid var(--ink); padding-top: 12px; margin: 0 0 16px; font-size: 20px; font-weight: 700; letter-spacing: -.2px; }
.rail-title.second { margin-top: 38px; }
.lead { padding-bottom: 18px; border-bottom: 1px solid var(--line); }
.lead h4 { margin: 12px 0 0; font-size: 18px; line-height: 24px; font-weight: 700; letter-spacing: -.2px; }
.item { display: flex; gap: 14px; padding: 16px 0; border-bottom: 1px solid var(--line); }
.item h5 { margin: 0; font-size: 15px; line-height: 21px; font-weight: 600; }
.text-item { padding: 14px 0; border-bottom: 1px solid var(--line); font-size: 15px; line-height: 21px; font-weight: 600; }
.rail-title + .text-item { padding-top: 0; }
${PLACEHOLDER_CSS}
.lead .np-photo, .item .np-photo, .lead .np-img, .item .np-img { border-radius: 4px; }
.credit { margin-top: 8px; font-size: 12px; line-height: 16px; color: var(--muted); }
`;
function renderCnn(a, rail, _now, photos) {
  const slots = PHOTO_SLOTS.cnn;
  const section = a.section;
  const nav = section && NAV[section] || DEFAULT_NAV;
  const dateLine = a.publishedAt ? wasUpdated(a.publishedAt, a.updatedAt) ? `Updated ${cnnDay(a.updatedAt)}` : `Published ${cnnDay(a.publishedAt)}` : "";
  const names = a.authors.length ? a.authors : [a.byline];
  const byNames = names.map((n) => `<a>${esc(n)}</a>`);
  const byJoined = byNames.length <= 1 ? byNames.join("") : `${byNames.slice(0, -1).join(", ")} and ${byNames[byNames.length - 1]}`;
  const lead = rail[0];
  const withThumbs = rail.slice(1, 4);
  const textOnly = rail.slice(4, 11);
  const html = `
<div class="np">
  <div class="container">
    <header class="header">
      <div class="burger"><i></i><i></i><i></i></div>
      <div class="brand"><img src="/news/cnn.png" alt="CNN"/>${section ? `<b>${esc(section)}</b>` : ""}</div>
      <nav class="nav">${nav.map((n) => `<span>${esc(n)}</span>`).join("")}<span>More ${CHEVRON}</span></nav>
      <div class="tools">
        <span><i class="dot"></i>Watch</span>
        <span><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#0c0c0c" stroke-width="1.5"><path d="M2.5 11V8a5.5 5.5 0 0 1 11 0v3"/><rect x="2" y="9.5" width="3" height="5" rx="1"/><rect x="11" y="9.5" width="3" height="5" rx="1"/></svg>Listen</span>
        <svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="#0c0c0c" stroke-width="1.6"><circle cx="8.5" cy="8.5" r="6.5"/><path d="m13.5 13.5 5 5"/></svg>
        <span class="btn sub">Subscribe</span>
        <span class="btn sign">Sign in</span>
      </div>
    </header>
    <section class="head">
      <div class="kicker">${section ? esc(section) : ""}</div>
      <h1>${esc(a.headline)}</h1>
      ${dateLine ? `<div class="updated">${dateLine} ${CHEVRON}</div>` : ""}
      <div class="byline">By <span class="avatar">${esc(initials(names[0] ?? ""))}</span>${byJoined}</div>
    </section>
    <div class="row">
      <main>
        ${photoBox(photos.hero?.src, slots.hero, "border-radius:6px")}
        ${photos.hero ? `<div class="credit">${esc(photos.hero.credit)}</div>` : ""}
        <div class="body">${a.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}</div>
      </main>
      <aside>
        ${lead ? `<h3 class="rail-title">Latest</h3>
        <div class="lead">${photoBox(photos.thumbs[0], slots.thumbs[0])}<h4>${esc(lead.title)}</h4></div>
        ${withThumbs.map((r, i) => `<div class="item">${photoBox(photos.thumbs[i + 1], slots.thumbs[i + 1])}<h5>${esc(r.title)}</h5></div>`).join("")}` : ""}
        ${textOnly.length ? `<h3 class="rail-title second">More from CNN</h3>${textOnly.map((r) => `<div class="text-item">${esc(r.title)}</div>`).join("")}` : ""}
      </aside>
    </div>
  </div>
</div>`;
  return {
    css: CSS2,
    html,
    fontsHref: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400&display=swap"
  };
}

// src/lib/news/templates/espn.ts
function espnDate(iso) {
  const p = partsIn(iso, "America/New_York");
  return `${MONTH_SHORT[p.month - 1]} ${p.day}, ${p.year}, ${p.hour.padStart(2, "0")}:${p.minute} ${p.dayPeriod} ET`;
}
var CSS3 = `
.np { --red: #d00; --bar: #2b2c2d; --page: #e8e9ea; --rail: #f4f5f6; --ink: #121213; --muted: #6c6d6f; --line: #dcdddf;
  width: 1440px; background: var(--page); font-family: Roboto, Arial, sans-serif; color: var(--ink); -webkit-font-smoothing: antialiased; padding-bottom: 60px; }
* { box-sizing: border-box; }
.top { position: relative; height: 60px; background: var(--bar); }
.brand { position: absolute; left: 0; top: 0; height: 60px; width: 236px; background: var(--red); clip-path: polygon(0 0, 100% 0, 88% 100%, 0 100%); display: flex; align-items: center; gap: 30px; padding-left: 22px; }
.burger { width: 27px; display: grid; gap: 6px; }
.burger i { display: block; height: 3px; background: #fff; border-radius: 1px; }
.logo { display: block; width: 108px; height: auto; }
.top-icons { position: absolute; right: 26px; top: 0; height: 60px; display: flex; align-items: center; gap: 26px; }
.nav { height: 60px; background: #fff; display: flex; align-items: center; box-shadow: 0 1px 0 var(--line), 0 2px 4px rgba(0,0,0,.08); position: relative; z-index: 1; }
.league { display: flex; align-items: center; gap: 14px; padding: 0 22px 0 20px; height: 34px; border-right: 1px solid var(--line); }
.league b { font-size: 18px; font-weight: 700; letter-spacing: .2px; }
.links { display: flex; gap: 21px; padding-left: 20px; font-size: 17px; font-weight: 300; color: #222; }
.links span { display: inline-flex; align-items: center; gap: 4px; }
.wrap { width: 1308px; margin: 16px auto 0; display: flex; align-items: stretch; }
.rail { width: 400px; background: var(--rail); }
.story { padding: 18px 30px 20px; border-bottom: 1px solid var(--line); border-left: 5px solid transparent; }
.story.on { background: #fff; border-left-color: var(--red); }
.story h3 { margin: 0 0 8px; font-size: 17px; line-height: 22px; font-weight: 700; }
.meta { font: 12.5px/1 Georgia, serif; color: var(--muted); letter-spacing: 1.4px; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta em { font: 13px Roboto, Arial, sans-serif; letter-spacing: 0; text-transform: none; font-style: normal; margin-left: 6px; }
.meta em.solo { margin-left: 0; }
.rail-head { padding: 26px 30px 12px 35px; font: 700 13px/1 Roboto, Arial, sans-serif; letter-spacing: 1.2px; text-transform: uppercase; color: #48494b; border-bottom: 1px solid var(--line); }
.main { flex: 1; background: #fff; padding: 30px 54px 60px; }
h1 { margin: 0 0 26px; font-size: 50px; line-height: 58px; font-weight: 700; letter-spacing: -.3px; max-width: 800px; }
.credit { margin-top: 10px; font-size: 13px; line-height: 18px; color: var(--muted); }
.by { margin-top: 40px; font-size: 16px; font-weight: 500; }
.when { margin-top: 6px; font-size: 14px; color: var(--muted); }
.body { margin-top: 30px; width: 800px; font: 22px/35px Georgia, serif; color: #1d1d1e; }
.body p { margin: 0 0 28px; }
${PLACEHOLDER_CSS}
`;
var CHEVRON2 = `<svg width="10" height="6" viewBox="0 0 10 6"><path d="m1 1 4 4 4-4" stroke="#222" fill="none" stroke-width="1.4"/></svg>`;
function renderEspn(a, rail, now, photos) {
  const league = a.section ?? "ESPN";
  const firstMeta = [a.publishedAt ? agoShort(a.publishedAt, now) : null, a.byline || null].filter(Boolean).join(" - ");
  const railStory = (r) => `
    <div class="story"><h3>${esc(r.title)}</h3>${r.publishedAt ? `<div class="meta"><em class="solo">${agoShort(r.publishedAt, now)}</em></div>` : ""}</div>`;
  const firstGroup = rail.slice(0, 3).map(railStory).join("");
  const rest = rail.slice(3);
  const html = `
<div class="np">
  <header class="top">
    <div class="brand"><div class="burger"><i></i><i></i><i></i></div><img class="logo" src="/news/espn.png" alt="ESPN"/></div>
    <div class="top-icons">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><circle cx="10" cy="10" r="7"/><path d="M15.5 15.5 22 22"/></svg>
      <svg width="26" height="26" viewBox="0 0 26 26"><circle cx="13" cy="13" r="12" fill="#fff"/><circle cx="13" cy="10" r="4.2" fill="#2b2c2d"/><path d="M5.5 21c1.6-3.6 4.4-5.4 7.5-5.4s5.9 1.8 7.5 5.4" fill="#2b2c2d"/></svg>
    </div>
  </header>
  <nav class="nav">
    <div class="league">
      <svg width="24" height="30" viewBox="0 0 26 32"><path d="M13 1 2 4v13c0 8 5.5 12 11 14 5.5-2 11-6 11-14V4z" fill="#fff" stroke="#48494b" stroke-width="2"/><path d="M4 11h18v6c0 6-4 9.5-9 11.3C8 26.5 4 23 4 17z" fill="#48494b"/></svg>
      <b>${esc(league)}</b>
    </div>
    <div class="links">
      <span>Home</span><span>Scores</span><span>Schedule ${CHEVRON2}</span><span>Standings</span><span>Stats</span><span>Teams</span><span>Odds</span><span>More ${CHEVRON2}</span>
    </div>
  </nav>
  <div class="wrap">
    <aside class="rail">
      <div class="story on"><h3>${esc(a.headline)}</h3>${firstMeta ? `<div class="meta">${esc(league)} <em>${esc(firstMeta)}</em></div>` : ""}</div>
      ${firstGroup}
      ${rest.length ? `<div class="rail-head">Latest</div>${rest.map(railStory).join("")}` : ""}
    </aside>
    <main class="main">
      <h1>${esc(a.headline)}</h1>
      ${photoBox(photos.hero?.src, PHOTO_SLOTS.espn.hero)}
      ${photos.hero ? `<div class="credit">${esc(photos.hero.credit)}</div>` : ""}
      <div class="by">${esc(a.byline)}</div>
      ${a.publishedAt ? `<div class="when">${espnDate(a.publishedAt)}</div>` : ""}
      <div class="body">${a.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}</div>
    </main>
  </div>
</div>`;
  return {
    css: CSS3,
    html,
    fontsHref: "https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap"
  };
}

// src/lib/news/templates/fox.ts
function foxDate(iso) {
  const p = partsIn(iso, "America/New_York");
  return `${MONTH_LONG[p.month - 1]} ${p.day}, ${p.year} ${p.hour}:${p.minute}${p.dayPeriod.toLowerCase()} ${p.tz}`;
}
var CSS4 = `
.np { --navy: #003366; --link: #1c4f8c; --red: #c20017; --ink: #1a1a1a; --muted: #666; --line: #e3e3e3;
  width: 1440px; background: #fff; color: var(--ink); font-family: Roboto, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
* { box-sizing: border-box; }
.redline { height: 5px; background: var(--red); }
.header { height: 95px; background: var(--navy); display: flex; align-items: center; padding: 0 38px; }
.logo { width: 56px; height: 56px; display: block; box-shadow: 0 0 0 2px #fff; margin-right: 36px; }
.nav { display: flex; gap: 33px; color: #fff; font-size: 16px; font-weight: 700; }
.nav span { display: inline-flex; align-items: center; gap: 9px; }
.caret { width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 6px solid #8ea6c4; }
.dots { display: grid; gap: 2px; }
.dots i { width: 3px; height: 3px; border-radius: 50%; background: #fff; }
.right { margin-left: auto; display: flex; align-items: center; gap: 14px; }
.btn { font: 700 15px/1 Roboto, Arial, sans-serif; color: #fff; padding: 9px 12px; border-radius: 3px; }
.btn.login { background: #24578f; margin-left: 16px; }
.btn.watch { background: #d8001d; }
.head { text-align: center; padding: 32px 90px 0; }
.pill { display: inline-block; background: var(--red); color: #fff; font-size: 14px; font-weight: 700; text-transform: uppercase; padding: 5px 7px 4px; border-radius: 4px; letter-spacing: .2px; }
h1 { margin: 14px auto 0; max-width: 1260px; font: 700 57px/67px "Roboto Condensed", Roboto, Arial, sans-serif; letter-spacing: -.3px; color: #1b1b1b; }
.dek { margin: 12px auto 0; max-width: 1180px; font-size: 28px; line-height: 34px; font-weight: 300; color: #2b2b2b; }
.byline { margin-top: 14px; font-size: 16px; color: var(--muted); }
.byline b { color: var(--navy); font-weight: 700; }
.byline .mid { margin: 0 6px; }
.dates { margin-top: 36px; font-size: 16px; color: var(--muted); }
.dates .pipe { margin: 0 14px; }
.row { display: grid; grid-template-columns: 1020px 352px; gap: 20px; padding: 0 19px 70px; margin-top: 16px; }
.shares { border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); height: 76px; display: flex; align-items: center; justify-content: center; gap: 7px; }
.pillbtn { display: inline-flex; align-items: center; gap: 7px; height: 38px; padding: 0 14px; border-radius: 19px; background: var(--navy); color: #fff; font-size: 13px; font-weight: 700; }
.circle { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; }
.credit { margin-top: 10px; font-size: 14px; line-height: 20px; color: var(--muted); }
.body { margin-top: 30px; font-size: 21px; line-height: 33px; color: #222; }
.body p { margin: 0 0 26px; }
.rail h3 { margin: 0 0 10px; font-size: 21px; font-weight: 700; color: #1b1b1b; }
.card { margin-bottom: 26px; }
.card .img { position: relative; }
.card img.badge { position: absolute; top: 6px; left: 6px; width: 40px; height: 40px; box-shadow: 0 0 0 1.5px #fff; }
.card h4 { margin: 8px 0 0; color: var(--link); font-size: 18px; line-height: 26px; font-weight: 700; }
${PLACEHOLDER_CSS}
`;
function renderFox(a, rail, _now, photos) {
  const slots = PHOTO_SLOTS.fox;
  const authors = a.authors.length ? a.authors : [a.byline];
  const byNames = authors.map((n) => `<b>${esc(n)}</b>`);
  const byJoined = byNames.length <= 1 ? byNames.join("") : `${byNames.slice(0, -1).join(", ")} and ${byNames[byNames.length - 1]}`;
  const dates = a.publishedAt ? `Published ${foxDate(a.publishedAt)}${wasUpdated(a.publishedAt, a.updatedAt) ? `<span class="pipe">|</span>Updated ${foxDate(a.updatedAt)}` : ""}` : "";
  const html = `
<div class="np">
  <div class="redline"></div>
  <header class="header">
    <img class="logo" src="/news/fox.webp" alt="Fox News"/>
    <nav class="nav">
      <span>U.S. <i class="caret"></i></span><span>Politics <i class="caret"></i></span><span>World <i class="caret"></i></span><span>Opinion</span>
      <span>Media <i class="caret"></i></span><span>Entertainment <i class="caret"></i></span><span>Sports <i class="caret"></i></span>
      <span>More <span class="dots"><i></i><i></i><i></i></span></span>
    </nav>
    <div class="right">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#fff" stroke-width="2"><circle cx="8" cy="8" r="6"/><path d="m12.5 12.5 6 6"/></svg>
      <span class="btn login">Log In</span><span class="btn watch">Watch TV</span>
    </div>
  </header>
  <section class="head">
    ${a.section ? `<span class="pill">${esc(a.section)}</span>` : ""}
    <h1>${esc(a.headline)}</h1>
    ${a.dek ? `<div class="dek">${esc(a.dek)}</div>` : ""}
    <div class="byline">By ${byJoined}<span class="mid">&#183;</span><b>Fox News</b></div>
    ${dates ? `<div class="dates">${dates}</div>` : ""}
  </section>
  <div class="row">
    <main>
      <div class="shares">
        <span class="pillbtn"><svg width="16" height="15" viewBox="0 0 16 15"><path d="M8 1C4 1 1 3.4 1 6.5c0 1.7.9 3.2 2.4 4.2L2.7 14l3.5-2.1c.6.1 1.2.2 1.8.2 4 0 7-2.5 7-5.6S12 1 8 1z" fill="#fff"/></svg>Comments</span>
        <span class="circle" style="background:#3b5998"><svg width="10" height="18" viewBox="0 0 10 18"><path d="M6.5 18v-8h2.7l.4-3.1H6.5V4.9c0-.9.3-1.5 1.6-1.5H9.7V.6C9.4.6 8.4.5 7.3.5 4.9.5 3.3 1.9 3.3 4.6v2.3H.6V10h2.7v8z" fill="#fff"/></svg></span>
        <span class="circle" style="background:#000"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 1h4.2l3.3 4.5L12.4 1h2.1L9.4 6.8 15 15h-4.2L7.2 10.1 3 15H.9l5.3-6.1z" fill="#fff"/></svg></span>
        <span class="circle" style="background:#e12828"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 1h14v4.7H10.3v4.6H5.7V15H1z" fill="#fff"/></svg></span>
        <span class="circle" style="background:#003366"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#fff" stroke-width="1.6"><path d="M4.5 6V1.5h9V6"/><rect x="1.5" y="6" width="15" height="7" rx="1.5"/><path d="M4.5 11h9v5.5h-9z" fill="#003366"/></svg></span>
        <span class="circle" style="background:#003366"><svg width="18" height="14" viewBox="0 0 18 14" fill="none" stroke="#fff" stroke-width="1.6"><rect x="1" y="1" width="16" height="12" rx="1.5"/><path d="m1.5 2 7.5 6 7.5-6"/></svg></span>
        <span class="pillbtn"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" stroke="#fff" stroke-width="1.6"/></svg>Add Fox News on Google</span>
      </div>
      ${photoBox(photos.hero?.src, slots.hero, "margin-top:40px")}
      ${photos.hero ? `<div class="credit">(${esc(photos.hero.credit)})</div>` : ""}
      <div class="body">${a.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}</div>
    </main>
    <aside class="rail">
      ${rail.length ? `<h3>More From Fox News</h3>${rail.slice(0, 4).map((r, i) => `
      <div class="card"><div class="img">${photoBox(photos.thumbs[i], slots.thumbs[i])}<img class="badge" src="/news/fox.webp" alt=""/></div><h4>${esc(r.title)} | Fox News</h4></div>`).join("")}` : ""}
    </aside>
  </div>
</div>`;
  return {
    css: CSS4,
    html,
    fontsHref: "https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@700&family=Roboto:wght@300;400;500;700&display=swap"
  };
}

// src/lib/news/templates/imdb.ts
var EXT = (color) => `<svg class="ext" width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="${color}" stroke-width="1.3"><path d="M4.5 1.5h-3v9h9v-3"/><path d="M7 1.5h3.5V5"/><path d="M10.2 1.8 5.6 6.4"/></svg>`;
var CHEV = `<svg width="8" height="13" viewBox="0 0 8 13" fill="none" stroke="#101010" stroke-width="2"><path d="m1.5 1.5 5 5-5 5"/></svg>`;
function imdbDay(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}
var CSS5 = `
.np { --yellow: #f5c518; --blue: #5799ef; --ink: #000; --grey: #767676; --line: #e3e3e3;
  width: 1440px; background: #fff; color: var(--ink); font-family: Roboto, Arial, sans-serif; -webkit-font-smoothing: antialiased; padding-bottom: 70px; }
* { box-sizing: border-box; }
.bar { width: 1160px; margin: 0 auto; }
.head { height: 56px; background: #121212; color: #fff; }
.head .bar { height: 56px; display: flex; align-items: center; gap: 22px; }
.head .logo { width: 64px; display: block; }
.menu { display: flex; align-items: center; gap: 9px; font-size: 14px; font-weight: 700; }
.menu i { display: block; width: 17px; height: 2px; background: #fff; box-shadow: 0 5px 0 #fff, 0 10px 0 #fff; margin-top: -10px; }
.find { flex: 1; height: 32px; border-radius: 4px; background: #515151; display: flex; align-items: center; overflow: hidden; }
.find .all { display: flex; align-items: center; gap: 7px; padding: 0 12px; height: 32px; font-size: 14px; font-weight: 500; border-right: 1px solid #6a6a6a; }
.find .ph { flex: 1; padding-left: 13px; font-size: 14px; color: #c9c9c9; }
.find .go { width: 38px; height: 28px; margin-right: 2px; border-radius: 3px; background: #fff; display: grid; place-items: center; }
.pro { font-size: 15px; font-weight: 700; letter-spacing: -.2px; }
.pro b { color: #1ea7fd; font-weight: 700; }
.head .sep { width: 1px; height: 26px; background: #4a4a4a; }
.head .act { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 500; white-space: nowrap; }
.row { display: flex; padding-top: 24px; }
.card { width: 764px; border: 1px solid var(--line); border-radius: 10px; padding: 20px; }
h1 { margin: 0 0 14px; font-size: 17px; line-height: 23px; font-weight: 700; }
h1 .ext { margin-left: 4px; }
.body { margin-top: 16px; font-size: 15px; line-height: 24px; }
.body p { margin: 0 0 24px; }
.full { font-size: 15px; line-height: 24px; color: var(--blue); }
.meta { margin-top: 22px; display: flex; align-items: center; font-size: 13px; color: var(--grey); }
.dot { margin: 0 8px; }
.meta .src { color: var(--blue); }
.meta .kebab { margin-left: auto; width: 3px; height: 3px; border-radius: 50%; background: #5a5a5a; box-shadow: 0 -6px 0 #5a5a5a, 0 6px 0 #5a5a5a; }
.sec { display: flex; align-items: center; gap: 10px; margin: 38px 0 22px; font-size: 20px; font-weight: 700; }
.sec i { width: 4px; height: 24px; background: var(--yellow); }
.group { display: flex; align-items: center; gap: 7px; margin: 0 0 14px; font-size: 18px; font-weight: 700; }
.item { display: flex; height: 114px; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; margin-bottom: 14px; }
.item .txt { flex: 1; padding: 16px 18px; }
.item h4 { margin: 0; font-size: 15px; line-height: 21px; font-weight: 400; }
.item .when { margin-top: 8px; font-size: 13px; color: var(--grey); display: flex; align-items: center; }
.rail { width: 351px; margin-left: 45px; }
.rail .item { height: 106px; margin-bottom: 12px; }
.rail .item .txt { padding: 13px 14px; }
.rail .item h4 { font-size: 14.5px; line-height: 20px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-height: 40px; }
.rail .group { margin-top: 26px; }
${PLACEHOLDER_CSS}
`;
function groupRail(rail) {
  const out = [];
  rail.forEach((item, i) => {
    const label = item.group ?? "News";
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push({ item, i });
    else out.push({ label, items: [{ item, i }] });
  });
  return out;
}
function renderImdb(a, rail, _now, photos) {
  const slots = PHOTO_SLOTS.imdb;
  const groups = groupRail(rail);
  const similar = groups[0];
  const explore = groups.slice(1);
  const when = a.publishedAt ? imdbDay(a.publishedAt) : "";
  const card = (g) => `<div class="item">
    <div class="txt">
      <h4>${esc(g.item.title)}</h4>
      <div class="when">${g.item.publishedAt ? imdbDay(g.item.publishedAt) : ""}${g.item.byline ? `<span class="dot">\xB7</span>by ${esc(g.item.byline)}` : ""}</div>
    </div>
    ${photoBox(photos.thumbs[g.i], slots.thumbs[g.i] ?? slots.thumbs[slots.thumbs.length - 1])}
  </div>`;
  const html = `
<div class="np">
  <header class="head">
    <div class="bar">
      <img class="logo" src="/news/imdb.png" alt="IMDb"/>
      <span class="menu"><i></i>Menu</span>
      <div class="find">
        <span class="all">All <svg width="9" height="6" viewBox="0 0 9 6"><path d="M0 0h9L4.5 6z" fill="#fff"/></svg></span>
        <span class="ph">Search IMDb</span>
        <span class="go"><svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="#121212" stroke-width="2"><circle cx="7.5" cy="7.5" r="5.5"/><path d="m12 12 4.5 4.5"/></svg></span>
      </div>
      <span class="pro">IMDb<b>Pro</b></span>
      <i class="sep"></i>
      <span class="act"><svg width="16" height="19" viewBox="0 0 16 19" fill="#fff"><path d="M1 0h14v18l-7-5-7 5z"/><path d="M8 4v7M4.5 7.5h7" stroke="#121212" stroke-width="1.6"/></svg>Watchlist</span>
      <span class="act">Sign in</span>
      <span class="act">EN <svg width="9" height="6" viewBox="0 0 9 6"><path d="M0 0h9L4.5 6z" fill="#fff"/></svg></span>
    </div>
  </header>
  <div class="bar row">
    <main>
      <div class="card">
        <h1>${esc(a.headline)}${EXT("#000")}</h1>
        ${photoBox(photos.hero?.src, slots.hero, "border-radius:4px")}
        <div class="body">${a.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}</div>
        ${a.sourceName ? `<div class="full">See full article at ${esc(a.sourceName)}${EXT("#5799ef")}</div>` : ""}
        <div class="meta">
          ${when}<span class="dot">\xB7</span>by ${esc(a.byline)}${a.sourceName ? `<span class="dot">\xB7</span><span class="src">${esc(a.sourceName)}${EXT("#5799ef")}</span>` : ""}
          <i class="kebab"></i>
        </div>
      </div>
      ${similar ? `<div class="sec"><i></i>Similar News</div>
      <div class="group">${esc(similar.label)} ${CHEV}</div>
      ${similar.items.map((g) => card(g)).join("")}` : ""}
    </main>
    <aside class="rail">
      ${explore.length ? `<div class="sec"><i></i>More to explore</div>` : ""}
      ${explore.map((g) => `<div class="group">${esc(g.label)} ${CHEV}</div>${g.items.map((x) => card(x)).join("")}`).join("")}
    </aside>
  </div>
</div>`;
  return {
    css: CSS5,
    html,
    fontsHref: "https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap"
  };
}

// src/lib/news/templates/nyt.ts
var AP_MONTHS = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
function nytDate(a) {
  if (a.publishedDate) {
    const [y, m, d] = a.publishedDate.split("-").map(Number);
    return `${AP_MONTHS[m - 1]} ${d}, ${y}`;
  }
  if (a.publishedAt) {
    const p = partsIn(a.publishedAt, "America/New_York");
    return `${AP_MONTHS[p.month - 1]} ${p.day}, ${p.year}`;
  }
  return null;
}
var NAV2 = ["World", "U.S.", "Politics", "New York", "Business", "Opinion", "Arts", "Sports"];
var CSS6 = `
.np { --ink: #121212; --grey: #5a5a5a; --line: #e2e2e2; --red: #d0021b;
  width: 1440px; background: #fff; color: var(--ink); font-family: "Libre Franklin", Arial, sans-serif; -webkit-font-smoothing: antialiased; padding-bottom: 90px; }
* { box-sizing: border-box; }
.top { position: relative; height: 50px; border-bottom: 1px solid var(--line); }
.top .icons { position: absolute; left: 24px; top: 16px; display: flex; gap: 32px; }
.top .logo { position: absolute; left: 50%; top: 11px; width: 230px; margin-left: -115px; display: block; }
.top .account { position: absolute; right: 24px; top: 15px; font-size: 14px; color: #333; display: flex; align-items: center; gap: 8px; }
.sub { position: relative; height: 64px; border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: center; }
.sub .t { position: absolute; left: 27px; top: 18px; height: 28px; }
.sub nav { display: flex; align-items: center; gap: 26px; font-size: 15px; }
.sub nav b { font-size: 16px; font-weight: 700; }
.sub nav .div { width: 1px; height: 20px; background: #c7c7c7; margin: 0 -8px; }
.col { width: 705px; margin: 44px auto 0; }
.live { display: flex; align-items: center; gap: 12px; font-size: 14px; color: var(--red); margin-bottom: 12px; }
.live b { background: var(--red); color: #fff; font-weight: 700; padding: 6px 8px 5px; border-radius: 2px; letter-spacing: .3px; }
h1 { margin: 0; font: 700 47px/54px Newsreader, Georgia, serif; letter-spacing: -.4px; }
.dek { margin-top: 22px; font: 23.5px/35px Georgia, serif; color: #363636; }
.by { margin-top: 26px; font-size: 15px; line-height: 20px; }
.by b { font-weight: 700; }
.date { margin-top: 4px; font-size: 13px; color: var(--grey); }
.actions { display: flex; gap: 14px; margin-top: 20px; }
.pillb { height: 38px; border: 1px solid #dfdfdf; border-radius: 19px; display: inline-flex; align-items: center; gap: 8px; padding: 0 13px; font-size: 13px; }
.circ { width: 38px; height: 38px; border: 1px solid #dfdfdf; border-radius: 50%; display: grid; place-items: center; }
.credit { margin-top: 8px; font-size: 12px; line-height: 16px; color: var(--grey); letter-spacing: .1px; }
${PLACEHOLDER_CSS}
`;
function renderNyt(a, _rail, _now, photos) {
  const names = a.authors.length ? a.authors : [a.byline.replace(/^By\s+/i, "")];
  const byNames = names.map((n) => `<b>${esc(n)}</b>`);
  const byJoined = byNames.length <= 1 ? byNames.join("") : `${byNames.slice(0, -1).join(", ")} and ${byNames[byNames.length - 1]}`;
  const date = nytDate(a);
  const nav = NAV2.filter((n) => n !== a.section);
  const html = `
<div class="np">
  <header class="top">
    <div class="icons">
      <svg width="18" height="16" viewBox="0 0 18 16"><path d="M0 2h18M0 8h18M0 14h18" stroke="#121212" stroke-width="2.4"/></svg>
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="#121212" stroke-width="2.4"><circle cx="6.8" cy="6.8" r="5"/><path d="m10.5 10.5 5.3 5.3"/></svg>
    </div>
    <img class="logo" src="/news/nyt.png" alt="The New York Times"/>
    <div class="account">Account <svg width="10" height="6" viewBox="0 0 10 6"><path d="m1 1 4 4 4-4" stroke="#999" fill="none" stroke-width="1.2"/></svg></div>
  </header>
  <div class="sub">
    <img class="t" src="/news/nyt-t.png" alt=""/>
    <nav>${a.section ? `<b>${esc(a.section)}</b><span class="div"></span>` : ""}${nav.map((n) => `<span>${esc(n)}</span>`).join("")}</nav>
  </div>
  <article class="col">
    ${a.live ? `<div class="live"><b>LIVE</b></div>` : ""}
    <h1>${esc(a.headline)}</h1>
    ${a.dek ? `<div class="dek">${esc(a.dek)}</div>` : ""}
    <div class="by">By ${byJoined}</div>
    ${date ? `<div class="date">${date}</div>` : ""}
    <div class="actions">
      <span class="pillb"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#121212" stroke-width="1.3"><rect x="2" y="6" width="14" height="4"/><path d="M3 10v7h12v-7M9 6v11"/><path d="M9 6C7.5 2 4.5 2.5 5 4.5 5.3 5.7 9 6 9 6zM9 6c1.5-4 4.5-3.5 4-1.5C12.7 5.7 9 6 9 6z"/></svg>Share full article</span>
      <span class="circ"><svg width="20" height="16" viewBox="0 0 20 16" fill="none" stroke="#121212" stroke-width="1.4"><path d="M12 1l7 6-7 6V9.5C6.5 9.5 3.5 11 1 15c.8-6 4-9.5 11-10z"/></svg></span>
      <span class="circ"><svg width="13" height="17" viewBox="0 0 13 17" fill="none" stroke="#121212" stroke-width="1.4"><path d="M1 1h11v15l-5.5-4L1 16z"/></svg></span>
    </div>
    ${photoBox(photos.hero?.src, PHOTO_SLOTS.nyt.hero, "margin-top:36px")}
    ${photos.hero ? `<div class="credit">Credit...${esc(photos.hero.credit)}</div>` : ""}
  </article>
</div>`;
  return {
    css: CSS6,
    html,
    fontsHref: "https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,700&family=Libre+Franklin:wght@400;500;600;700&display=swap"
  };
}

// src/lib/news/templates/people.ts
function peopleStamp(iso) {
  const p = partsIn(iso, "America/New_York");
  return `${MONTH_LONG[p.month - 1]} ${p.day}, ${p.year} ${p.hour.padStart(2, "0")}:${p.minute}${p.dayPeriod} ${p.tz}`;
}
var NAV3 = ["Entertainment", "Crime", "Human Interest", "Lifestyle", "Royals", "Health", "Shopping"];
var CARET = `<svg width="9" height="6" viewBox="0 0 9 6"><path d="M0 0h9L4.5 6z" fill="#101010"/></svg>`;
var CSS7 = `
.np { --blue: #20b1ea; --ink: #101010; --grey: #767676; --line: #e3e3e3; --yellow: #fff100;
  width: 1440px; background: #fff; color: var(--ink); font-family: Figtree, Arial, sans-serif; -webkit-font-smoothing: antialiased; padding-bottom: 90px; }
* { box-sizing: border-box; }
.bar { width: 1248px; margin: 0 auto; }
.top { display: flex; align-items: center; height: 88px; }
.top .logo { width: 122px; display: block; }
.tools { margin-left: auto; display: flex; align-items: center; gap: 22px; font-size: 15px; }
.tools .sep { width: 1px; height: 22px; background: var(--line); }
.tools span { display: inline-flex; align-items: center; gap: 7px; }
.nav { display: flex; align-items: center; height: 58px; font-size: 14px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; }
.nav .item { margin-right: 32px; }
.nav .sub { margin-left: auto; display: flex; align-items: center; gap: 14px; }
.nav .pipe { color: #c8c8c8; font-weight: 400; }
.nav .get { background: var(--yellow); height: 34px; display: flex; align-items: center; padding: 0 12px 0 10px; }
.nav .app { width: 52px; height: 52px; border-radius: 50%; background: var(--blue); color: #fff; display: grid; place-items: center; font-size: 19px; font-weight: 800; letter-spacing: -.3px; margin-left: -14px; }
.rule { height: 1px; background: var(--line); }
.strip { padding: 16px 0 18px; }
.tag { position: relative; display: inline-block; font-size: 22px; font-weight: 800; letter-spacing: -.4px; padding: 1px 9px 2px; background: var(--yellow); }
.tag i { position: absolute; right: -7px; bottom: -6px; width: 0; height: 0; border-left: 8px solid #e01b00; border-bottom: 7px solid transparent; transform: rotate(8deg); }
.tops { display: flex; margin-top: 14px; }
.tops .cell { width: 312px; display: flex; padding-right: 20px; }
.tops .cell + .cell { border-left: 1px solid var(--line); padding-left: 20px; width: 332px; }
.shot { position: relative; flex: none; }
.rank { position: absolute; left: 0; bottom: 0; min-width: 20px; height: 19px; padding: 0 5px; background: #fff; color: var(--blue); font-size: 14px; font-weight: 700; line-height: 19px; }
.tops h4 { margin: 0 0 0 12px; font-size: 15.5px; line-height: 22px; font-weight: 400; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; max-height: 88px; }
.row { display: flex; padding-top: 30px; }
.main { width: 800px; margin-left: 200px; }
h1 { margin: 0; font-size: 46px; line-height: 50px; font-weight: 800; letter-spacing: -.6px; }
.dek { margin-top: 16px; width: 600px; font-size: 17.5px; line-height: 25px; }
.by { margin-top: 18px; font-size: 15px; display: flex; align-items: center; gap: 9px; }
.by b { font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
.by .pipe { color: #c8c8c8; }
.by .when { color: #5a5a5a; font-size: 14.5px; }
.hero { margin-top: 26px; }
.credit { margin-top: 7px; width: 600px; font-size: 12.5px; line-height: 17px; color: var(--grey); }
.know { position: relative; width: 600px; margin: 34px 0 6px; }
.know .hatch { position: absolute; left: 9px; top: 9px; right: -9px; bottom: -9px; background: repeating-linear-gradient(135deg, #1a1a1a 0 1px, #fff 1px 4px); }
.know .box { position: relative; border: 1px solid #1a1a1a; background: #fff; padding: 34px 26px 26px; }
.know .head { position: absolute; top: -10px; left: 0; right: 0; text-align: center; }
.know .head span { background: #fff; padding: 0 16px; font-size: 16px; font-weight: 700; letter-spacing: 2px; }
.know ul { margin: 0; padding: 0; list-style: none; }
.know li { position: relative; padding-left: 20px; font-size: 19px; line-height: 27px; }
.know li + li { margin-top: 18px; }
.know li i { position: absolute; left: 0; top: 10px; width: 6px; height: 6px; border-radius: 50%; background: var(--blue); }
.body { width: 600px; margin-top: 30px; font-size: 19.5px; line-height: 27px; }
.body p { margin: 0 0 26px; }
.rail { width: 300px; margin-left: 44px; }
.rail .tag { font-size: 19px; }
.lead { margin-top: 16px; padding-bottom: 20px; border-bottom: 1px solid var(--line); }
.lead h4 { margin: 12px 0 0; font-size: 20px; line-height: 26px; font-weight: 700; letter-spacing: -.2px; }
.more { display: flex; padding: 18px 0; border-bottom: 1px solid var(--line); }
.more h4 { margin: 0 0 0 12px; font-size: 15.5px; line-height: 21px; font-weight: 400; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; max-height: 84px; }
${PLACEHOLDER_CSS}
`;
function renderPeople(a, rail, _now, photos) {
  const slots = PHOTO_SLOTS.people;
  const stamp = a.publishedAt ? wasUpdated(a.publishedAt, a.updatedAt) ? `Updated on ${peopleStamp(a.updatedAt)}` : `Published on ${peopleStamp(a.publishedAt)}` : "";
  const tops = rail.slice(0, 4);
  const more = rail.slice(4, 9);
  const html = `
<div class="np">
  <div class="bar">
    <header class="top">
      <img class="logo" src="/news/people.png" alt="People"/>
      <div class="tools">
        <svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="#101010" stroke-width="1.8"><circle cx="8.5" cy="8.5" r="6"/><path d="m13 13 5 5"/></svg>
        <span><svg width="20" height="20" viewBox="0 0 20 20" fill="#101010"><circle cx="10" cy="10" r="9"/><circle cx="10" cy="8" r="3" fill="#fff"/><path d="M4.5 17a5.5 5.5 0 0 1 11 0z" fill="#fff"/></svg>Log In</span>
        <i class="sep"></i>
        <span>Magazine ${CARET}</span>
        <i class="sep"></i>
        <span>Newsletters</span>
        <span>Sweepstakes</span>
        <svg width="17" height="19" viewBox="0 0 17 19" fill="#101010"><path d="M8.5 0a2 2 0 0 1 2 2 6 6 0 0 1 4 5.6V12l2 3H.5l2-3V7.6A6 6 0 0 1 6.5 2a2 2 0 0 1 2-2zM6 16h5a2.5 2.5 0 0 1-5 0z"/></svg>
      </div>
    </header>
  </div>
  <div class="rule"></div>
  <div class="bar">
    <nav class="nav">
      ${NAV3.map((n) => `<span class="item">${esc(n)}</span>`).join("")}
      <span class="sub"><span>Subscribe</span><span class="pipe">|</span><span class="get">Get the</span><span class="app">APP</span></span>
    </nav>
  </div>
  <div class="rule"></div>
  ${tops.length ? `<div class="bar strip">
    <span class="tag">Top Stories<i></i></span>
    <div class="tops">
      ${tops.map((r, i) => `<div class="cell"><div class="shot">${photoBox(photos.thumbs[i], slots.thumbs[i])}<span class="rank">${i + 1}</span></div><h4>${esc(r.title)}</h4></div>`).join("")}
    </div>
  </div>` : ""}
  <div class="row">
    <main class="main">
      <h1>${esc(a.headline)}</h1>
      ${a.dek ? `<p class="dek">${esc(a.dek)}</p>` : ""}
      <div class="by">By <b>${esc(a.byline)}</b>${stamp ? `<span class="pipe">|</span><span class="when">${stamp}</span>` : ""}</div>
      <div class="hero">${photoBox(photos.hero?.src, slots.hero)}</div>
      ${photos.hero ? `<div class="credit">${esc(photos.hero.credit)}</div>` : ""}
      ${a.keyPoints.length ? `<div class="know">
        <i class="hatch"></i>
        <div class="box">
          <div class="head"><span>NEED TO KNOW</span></div>
          <ul>${a.keyPoints.map((k) => `<li><i></i>${esc(k)}</li>`).join("")}</ul>
        </div>
      </div>` : ""}
      <div class="body">${a.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}</div>
    </main>
    <aside class="rail">
      ${more.length ? `<span class="tag">More Top Stories<i></i></span>
      <div class="lead">${photoBox(photos.thumbs[4], slots.thumbs[4])}<h4>${esc(more[0].title)}</h4></div>
      ${more.slice(1).map((r, i) => `<div class="more"><div class="shot">${photoBox(photos.thumbs[5 + i], slots.thumbs[5 + i])}</div><h4>${esc(r.title)}</h4></div>`).join("")}` : ""}
    </aside>
  </div>
</div>`;
  return {
    css: CSS7,
    html,
    fontsHref: "https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;700;800&display=swap"
  };
}

// src/lib/news/templates/tmz.ts
function tmzDate(iso) {
  const p = partsIn(iso, "America/Los_Angeles");
  return `${MONTH_LONG[p.month - 1]} ${p.day}, ${p.year} ${p.hour}:${p.minute} ${p.dayPeriod} ${p.tz}`;
}
var CSS8 = `
.np { --red: #d8000f; --ink: #111; --grey: #9a9a9a;
  width: 1440px; background: #fff; color: var(--ink); font-family: "Fira Sans", Arial, sans-serif; -webkit-font-smoothing: antialiased; }
* { box-sizing: border-box; }
.header { height: 96px; background: #000; }
.header .inner { width: 1282px; margin-left: 85px; height: 96px; display: flex; align-items: center; }
.header .logo { width: 150px; display: block; margin-right: 44px; }
.nav { display: flex; gap: 40px; font: 33px/1 Anton, Impact, sans-serif; color: #fff; letter-spacing: .3px; }
.search { margin-left: auto; width: 217px; height: 48px; border-radius: 24px; background: #262626; display: flex; align-items: center; justify-content: flex-end; padding-right: 18px; }
.wrap { width: 1282px; margin: 0 0 0 85px; }
.row { display: grid; grid-template-columns: 870px 357px; gap: 55px; padding: 34px 0 80px; }
.kicker { font: 700 46px/50px "Fira Sans Condensed", Arial, sans-serif; text-transform: uppercase; }
h1 { margin: 6px 0 0; font: 800 88px/82px "Fira Sans Condensed", Arial, sans-serif; text-transform: uppercase; letter-spacing: 0; }
h1.long { font-size: 64px; line-height: 62px; }
.subhead { margin-top: 10px; font: 700 40px/44px "Fira Sans Condensed", Arial, sans-serif; }
.tools { display: flex; align-items: center; margin-top: 24px; }
.sq { width: 67px; height: 37px; display: grid; place-items: center; margin-right: 6px; }
.sq.fb { background: #3d85e6; }
.sq.x { background: #000; }
.sq.com { background: #e5001a; }
.gbtn { margin-left: auto; width: 222px; height: 55px; border-radius: 8px; padding: 2px; background: linear-gradient(90deg, #34a853, #fbbc05 40%, #ea4335 70%, #a142f4); }
.gbtn span { display: flex; align-items: center; gap: 12px; height: 100%; border-radius: 6px; background: #fff; padding-left: 10px; font: italic 700 13.5px/1 "Fira Sans", Arial, sans-serif; letter-spacing: .2px; color: #7b4fd6; }
.gbtn i { width: 28px; height: 28px; border-radius: 50%; box-shadow: 0 1px 3px rgba(0,0,0,.25); display: grid; place-items: center; }
.by { margin-top: 12px; font: italic 16px "Fira Sans", Arial, sans-serif; color: #777; }
.by b { color: var(--red); font-weight: 400; }
.dates { margin-top: 12px; font: italic 17px "Fira Sans", Arial, sans-serif; color: var(--grey); }
.dates .pipe { margin: 0 12px; }
.credit { margin-top: 6px; text-align: right; font: italic 13px "Fira Sans", Arial, sans-serif; color: var(--grey); }
.body { margin-top: 26px; font-size: 20px; line-height: 32px; letter-spacing: .25px; color: #222; text-align: justify; }
.body p { margin: 0 0 26px; }
.popular { position: relative; height: 38px; margin: 0 6px 22px 10px; }
.popular .shadow { position: absolute; left: 0; top: 0; right: 0; bottom: 0; transform: translate(6px, 5px) skewX(-14deg); background: repeating-linear-gradient(135deg, #9b9b9b 0 1px, transparent 1px 3px); }
.popular .bar { position: absolute; left: 0; top: 0; right: 0; bottom: 0; transform: skewX(-14deg); background: #000; }
.popular span { position: relative; display: block; text-align: center; color: #fff; font: italic 800 22px/38px "Fira Sans Condensed", Arial, sans-serif; letter-spacing: .5px; }
.pop { display: flex; gap: 13px; margin-bottom: 16px; }
.pop h4 { margin: 8px 0 0; font: 500 17.5px/25px "Fira Sans", Arial, sans-serif; letter-spacing: -.1px; }
${PLACEHOLDER_CSS}
`;
function renderTmz(a, rail, _now, photos) {
  const slots = PHOTO_SLOTS.tmz;
  const parts = a.headlineParts;
  const main2 = parts?.main ?? a.headline;
  const dates = a.publishedAt ? `Published ${tmzDate(a.publishedAt)}${wasUpdated(a.publishedAt, a.updatedAt) ? `<span class="pipe">|</span>Updated ${tmzDate(a.updatedAt)}` : ""}` : "";
  const html = `
<div class="np">
  <header class="header">
    <div class="inner">
      <img class="logo" src="/news/tmz.svg" alt="TMZ"/>
      <nav class="nav"><span>NEWS</span><span>SPORTS</span><span>PHOTOS</span><span>VIDEOS</span><span>PODS</span><span>TOURS</span><span>DEALS</span></nav>
      <div class="search"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="#fff" stroke-width="2.8"><circle cx="9" cy="9" r="6.5"/><path d="m14 14 6 6"/></svg></div>
    </div>
  </header>
  <div class="wrap">
    <div class="row">
      <main>
        ${parts?.kicker ? `<div class="kicker">${esc(parts.kicker)}</div>` : ""}
        <h1${main2.length > 70 ? ' class="long"' : ""}>${esc(main2)}</h1>
        ${parts?.sub ? `<div class="subhead">${esc(parts.sub)}</div>` : ""}
        <div class="tools">
          <span class="sq fb"><svg width="11" height="20" viewBox="0 0 10 18"><path d="M6.5 18v-8h2.7l.4-3.1H6.5V4.9c0-.9.3-1.5 1.6-1.5H9.7V.6C9.4.6 8.4.5 7.3.5 4.9.5 3.3 1.9 3.3 4.6v2.3H.6V10h2.7v8z" fill="#fff"/></svg></span>
          <span class="sq x"><svg width="20" height="20" viewBox="0 0 16 16"><path d="M1 1h4.2l3.3 4.5L12.4 1h2.1L9.4 6.8 15 15h-4.2L7.2 10.1 3 15H.9l5.3-6.1z" fill="none" stroke="#fff" stroke-width=".9"/></svg></span>
          <span class="sq com"><svg width="24" height="22" viewBox="0 0 24 22"><path d="M12 1C5.9 1 1 4.9 1 9.8c0 2.6 1.4 5 3.7 6.6L3.5 21l5.2-3c1 .2 2.2.4 3.3.4 6.1 0 11-3.9 11-8.8S18.1 1 12 1z" fill="#fff"/></svg></span>
          <span class="gbtn"><span><i>${GOOGLE_G}</i>ADD TMZ ON GOOGLE</span></span>
        </div>
        <div class="by">By <b>${esc(a.byline.toUpperCase())}</b></div>
        ${dates ? `<div class="dates">${dates}</div>` : ""}
        ${photoBox(photos.hero?.src, slots.hero, "margin-top:16px")}
        ${photos.hero ? `<div class="credit">${esc(photos.hero.credit)}</div>` : ""}
        <div class="body">${a.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}</div>
      </main>
      <aside>
        ${rail.length ? `<div class="popular"><i class="shadow"></i><i class="bar"></i><span>LATEST</span></div>
        ${rail.slice(0, 6).map((r, i) => `<div class="pop">${photoBox(photos.thumbs[i], slots.thumbs[i])}<h4>${esc(r.title)}</h4></div>`).join("")}` : ""}
      </aside>
    </div>
  </div>
</div>`;
  return {
    css: CSS8,
    html,
    fontsHref: "https://fonts.googleapis.com/css2?family=Anton&family=Fira+Sans:ital,wght@0,400;0,500;0,700;1,400;1,700&family=Fira+Sans+Condensed:ital,wght@0,700;0,800;1,800&display=swap"
  };
}

// src/lib/news/templates/index.ts
var TEMPLATES = {
  espn: renderEspn,
  cnn: renderCnn,
  fox: renderFox,
  nyt: renderNyt,
  tmz: renderTmz,
  bbc: renderBbc,
  people: renderPeople,
  imdb: renderImdb
};
function scopeCss(css) {
  return css.replace(/(^|})(\s*)([^{}@]+)\{/g, (_m, close, space, selectors) => {
    const scoped = selectors.split(",").map((s) => s.trim()).filter(Boolean).map((s) => s === ".np" || s.startsWith(".np ") || s.startsWith(".np.") || s.startsWith(".np-") ? s : `.np ${s}`).join(", ");
    return `${close}${space}${scoped} {`;
  });
}
function renderNewsPage(article, rail, photos = NO_PHOTOS, now = /* @__PURE__ */ new Date()) {
  const page = TEMPLATES[article.outlet](article, rail, now, photos);
  return { ...page, css: scopeCss(page.css) };
}

// .newstools/gen.ts
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
var UA = "PauvNewsPreview/1.0 (distribution@pauv.com)";
async function commons(search, limit, width) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrnamespace: "6",
    gsrlimit: String(limit),
    gsrsearch: `${search} filetype:bitmap`,
    prop: "imageinfo",
    iiprop: "url|size|mime",
    iiurlwidth: String(width)
  }).toString();
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(2e4) });
  const pages = (await res.json()).query?.pages ?? {};
  return Object.values(pages).sort((a, b) => a.index - b.index).map((p) => p.imageinfo?.[0]).filter((i) => !!i?.thumburl && /^image\/(jpeg|png|webp)$/.test(i.mime)).map((i) => i.thumburl);
}
async function photosFor(outlet, topic) {
  const slots = PHOTO_SLOTS[outlet];
  const wide = await commons(topic, 12, 1200);
  const small = await commons("film premiere red carpet", 14, 400);
  return {
    hero: wide[0] ? { src: wide[0], credit: "Photo: Wikimedia Commons (CC BY-SA 4.0)" } : null,
    thumbs: slots.thumbs.map((_, i) => small[i % Math.max(1, small.length)] ?? wide[(i + 1) % Math.max(1, wide.length)] ?? null)
  };
}
var PAGE = (title, fontsHref, css, html) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="${fontsHref}">
<style>html,body{margin:0;padding:0;background:#fff}${css}</style>
</head><body>${html}</body></html>`;
async function main() {
  const [, , outlet, name, out] = process.argv;
  let hits;
  if (outlet === "imdb") hits = await searchImdbNews(name, "30d");
  else hits = await searchApprovedNews(name, [outlet], "30d");
  if (!hits.length) throw new Error(`No ${outlet} stories about ${name}.`);
  let article = null;
  let picked = null;
  for (const h of hits.slice(0, 6)) {
    try {
      article = await readNewsArticle(h.url);
      picked = h;
      break;
    } catch (err) {
      console.log("  skipped", h.url, String(err instanceof Error ? err.message : err).slice(0, 90));
    }
  }
  if (!article || !picked) throw new Error("Could not read any story.");
  let rail = [];
  if (outlet === "imdb") rail = await imdbRail(imdbIdOf(new URL(article.url)) ?? "");
  else rail = await latestFromOutlet(outlet, article.headline).catch(() => []);
  const photos = await photosFor(outlet, outlet === "imdb" ? "movie theater interior" : "red carpet event");
  const page = renderNewsPage(article, rail, photos, /* @__PURE__ */ new Date());
  const html = page.html.replace(/src="\/news\//g, `src="${pathToFileURL(resolve("public/news")).href}/`);
  writeFileSync(out, PAGE(article.headline, page.fontsHref, page.css, html), "utf8");
  console.log(JSON.stringify({
    outlet,
    url: article.url,
    headline: article.headline,
    byline: article.byline,
    published: article.publishedAt,
    source: article.sourceName,
    dek: article.dek,
    paragraphs: article.paragraphs.length,
    keyPoints: article.keyPoints.length,
    rail: rail.length,
    notes: article.notes
  }, null, 1));
}
main().catch((err) => {
  console.error("FAILED", err);
  process.exit(1);
});
