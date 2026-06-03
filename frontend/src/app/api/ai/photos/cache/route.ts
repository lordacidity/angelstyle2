import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

const CACHE_DIR = path.join(os.tmpdir(), 'photo-cache');

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function extFromContentType(ct: string | null): string {
  if (!ct) return '.jpg';
  if (ct.includes('png')) return '.png';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('gif')) return '.gif';
  return '.jpg';
}

function refererForUrl(url: string): string {
  try {
    return new URL(url).origin + '/';
  } catch {
    return 'https://www.google.com/';
  }
}

export async function POST(req: NextRequest) {
  try {
    const Schema = z.object({ url: z.string().min(1) });
    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'url required' }, { status: 400 });
    const { url } = parsed.data;

    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json({ localUrl: url });
    }

    const hash = crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
    ensureCacheDir();

    const existing = fs.readdirSync(CACHE_DIR).find((f) => f.startsWith(hash));
    if (existing) {
      return NextResponse.json({ localUrl: `/api/photos/serve/${existing}` });
    }

    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'image/*,*/*;q=0.8',
        // Use the image's own origin as Referer — satisfies CDN hotlink protection
        // on publisher sites (NYT, AP, etc.) that reject google.com or missing referers.
        Referer: refererForUrl(url),
      },
      redirect: 'follow',
    });

    if (!res.ok) return NextResponse.json({ error: `fetch failed: ${res.status}` }, { status: 502 });

    const ct = res.headers.get('content-type') ?? '';
    // Reject HTML responses — some servers return a 200 redirect/error page
    // instead of an image, which would corrupt the cached file.
    if (ct.includes('text/html') || ct.includes('application/json')) {
      return NextResponse.json({ error: 'not an image' }, { status: 422 });
    }

    const ext = extFromContentType(ct);
    const filename = `${hash}${ext}`;
    const filePath = path.join(CACHE_DIR, filename);

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 100) {
      return NextResponse.json({ error: 'response too small to be an image' }, { status: 422 });
    }
    fs.writeFileSync(filePath, buf);

    return NextResponse.json({ localUrl: `/api/photos/serve/${filename}` });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
