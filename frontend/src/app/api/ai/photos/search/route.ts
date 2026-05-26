import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

interface SerpImage {
  original?: string;
  thumbnail?: string;
  title?: string;
  source?: string;
  original_width?: number;
  original_height?: number;
}

export async function POST(req: NextRequest) {
  try {
    const Schema = z.object({ query: z.string().min(1), count: z.number().int().min(1).max(50).default(3), offset: z.number().int().min(0).default(0) });
    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'query required' }, { status: 400 });
    const { query, count, offset } = parsed.data;

    const key = process.env.SERPAPI_KEY ?? '';
    if (!key) throw new Error('SERPAPI_KEY not set');

    const PAGE_SIZE = 100;
    const page = Math.floor(offset / PAGE_SIZE);
    const within = offset % PAGE_SIZE;

    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google_images');
    url.searchParams.set('q', query);
    url.searchParams.set('api_key', key);
    url.searchParams.set('ijn', String(page));

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`serpapi ${res.status}: ${await res.text()}`);
    const json = await res.json() as { images_results?: SerpImage[]; error?: string };
    if (json.error) throw new Error(`serpapi: ${json.error}`);

    const images = (json.images_results ?? []).filter((i) => i.original);
    const slice = images.slice(within, within + count).map((i) => ({
      url: i.original!,
      thumbnail: i.thumbnail ?? i.original!,
      title: i.title,
      source: i.source,
    }));

    return NextResponse.json(slice);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
