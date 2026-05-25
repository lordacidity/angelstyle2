// Free supplemental news source. Google News exposes an RSS feed for any
// search query — no auth, no rate-limit-worth-worrying-about, indexes most
// news sites worldwide. We parse the XML by hand (the format is simple and
// consistent) so we don't add a dependency just for this.
//
// URL shape:
//   https://news.google.com/rss/search?q=<query>&hl=en-US&gl=US&ceid=US:en
//
// Item shape inside the feed:
//   <item>
//     <title>...</title>
//     <link>https://news.google.com/rss/articles/CBM...</link>   ← redirect URL
//     <pubDate>Mon, 25 May 2026 14:30:00 GMT</pubDate>
//     <description>... HTML snippet ...</description>
//     <source url="https://...">Source name</source>
//   </item>

import type { NewsArticle } from "./pauvData.js";

const FEED_BASE = "https://news.google.com/rss/search";

export async function searchGoogleNews(opts: {
  q: string;
  timeframeHours?: number;
}): Promise<NewsArticle[]> {
  const url = new URL(FEED_BASE);
  url.searchParams.set("q", opts.q);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");

  const res = await fetch(url, {
    headers: {
      // Google sometimes returns an empty body for the default Node UA.
      "User-Agent": "Mozilla/5.0 (compatible; Phonedeck/1.0)",
    },
  });
  if (!res.ok) throw new Error(`google news ${res.status}: ${await res.text()}`);
  const xml = await res.text();

  const items = parseItems(xml);
  const cutoffMs = opts.timeframeHours
    ? Date.now() - opts.timeframeHours * 3600_000
    : null;

  const articles: NewsArticle[] = [];
  for (const it of items) {
    if (cutoffMs !== null && it.pubDate) {
      const t = Date.parse(it.pubDate);
      if (Number.isFinite(t) && t < cutoffMs) continue;
    }
    articles.push({
      title: it.title,
      link: it.link,
      description: it.description,
      pubDate: it.pubDate,
      source_id: it.source ?? null,
      image_url: null,
      creator: null,
      category: null,
    });
  }
  return articles;
}

// ---- minimal RSS parser ------------------------------------------------

interface RawItem {
  title: string;
  link: string;
  description: string | null;
  pubDate: string | null;
  source: string | null;
}

function parseItems(xml: string): RawItem[] {
  const out: RawItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1];
    out.push({
      title: decodeXml(stripCdata(extractTag(block, "title"))) ?? "",
      link: decodeXml(stripCdata(extractTag(block, "link"))) ?? "",
      description: decodeXml(stripCdata(extractTag(block, "description"))) ?? null,
      pubDate: stripCdata(extractTag(block, "pubDate")) ?? null,
      source: decodeXml(stripCdata(extractTag(block, "source"))) ?? null,
    });
  }
  return out.filter((it) => it.title && it.link);
}

function extractTag(block: string, tag: string): string | null {
  // Match the tag whether or not it has attributes (e.g. <source url="...">text</source>).
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`);
  const m = re.exec(block);
  return m ? m[1].trim() : null;
}

function stripCdata(s: string | null): string | null {
  if (s === null) return null;
  const m = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(s);
  return m ? m[1] : s;
}

function decodeXml(s: string | null): string | null {
  if (s === null) return null;
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}
