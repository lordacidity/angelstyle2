// Fetch an article by URL and pull the bits the Carousel "From an article" flow
// needs: title, description, a slice of body text, the source name, and any
// og/twitter images. Mirrors article/scrape-images' fetch + meta parsing, adding
// a description + plain-text body so extract-person / carousel-copy have something
// to reason over. Best-effort: paywalled / JS-only pages still usually expose the
// og:* preview tags, which is enough to identify the subject.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const Schema = z.object({ url: z.string().url() });
  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'A valid article URL is required' }, { status: 400 });
  const { url } = parsed.data;
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    const finalUrl = r.url || url;
    const html = await r.text();

    // Read a meta tag's content — property/name in either order, single/double quotes.
    const meta = (prop: string): string | null => {
      const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
      const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i');
      const m = re1.exec(html) ?? re2.exec(html);
      return m ? m[1] : null;
    };
    const resolve = (src: string | null): string | null => {
      if (!src) return null;
      if (/^https?:\/\//i.test(src)) return src;
      try { return new URL(src, finalUrl).href; } catch { return null; }
    };

    // Title / description with sensible fallbacks to the plain <title>/<meta name=description>.
    const titleTag = /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
    const title = meta('og:title') ?? titleTag ?? '';
    const description = meta('og:description') ?? meta('description') ?? '';
    const siteName = meta('og:site_name') ?? (() => { try { return new URL(finalUrl).hostname.replace(/^www\./, ''); } catch { return null; } })();

    // Body text: drop non-content tags, pull paragraph text, collapse whitespace.
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ');
    const paras = Array.from(stripped.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi))
      .map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim())
      .filter(t => t.length > 40); // skip nav/boilerplate scraps
    const text = paras.join('\n\n').slice(0, 5000);

    const seen = new Set<string>();
    const images: string[] = [];
    for (const p of ['og:image', 'og:image:secure_url', 'twitter:image', 'twitter:image:src']) {
      const abs = resolve(meta(p));
      if (abs && !seen.has(abs)) { seen.add(abs); images.push(abs); }
    }

    if (!title && !description && !text) {
      return NextResponse.json({ error: 'Could not read this article — it may be paywalled or block scrapers.' }, { status: 422 });
    }

    return NextResponse.json({ url: finalUrl, title, description, siteName, text, images });
  } catch (err) {
    return NextResponse.json({ error: `Failed to fetch the article: ${String(err)}` }, { status: 500 });
  }
}
