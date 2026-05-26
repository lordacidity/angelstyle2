import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export async function POST(req: NextRequest) {
  const Schema = z.object({ url: z.string().url() });
  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'url required' }, { status: 400 });
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

    // Extracts a meta tag's content — handles property/name in either order,
    // and both single and double quote delimiters.
    const meta = (prop: string): string | null => {
      const escaped = prop.replace(':', '\\:').replace('.', '\\.');
      const re1 = new RegExp(
        `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
        'i',
      );
      const re2 = new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
        'i',
      );
      void escaped;
      const m = re1.exec(html) ?? re2.exec(html);
      return m ? m[1] : null;
    };

    // Resolve relative URLs against the article's final URL.
    const resolve = (src: string): string | null => {
      if (!src) return null;
      if (/^https?:\/\//i.test(src)) return src;
      try { return new URL(src, finalUrl).href; } catch { return null; }
    };

    const seen = new Set<string>();
    const images: string[] = [];
    for (const p of ['og:image', 'og:image:secure_url', 'twitter:image', 'twitter:image:src']) {
      const v = meta(p);
      const abs = v ? resolve(v) : null;
      if (abs && !seen.has(abs)) { seen.add(abs); images.push(abs); }
    }

    return NextResponse.json({
      images,
      siteName: meta('og:site_name'),
      title: meta('og:title'),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
