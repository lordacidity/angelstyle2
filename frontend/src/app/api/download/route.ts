import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// Force Node.js runtime for CommonJS dependencies
export const runtime = 'nodejs';

const API_TIMEOUT = 30000;

function isTikTokUrl(url: string): boolean {
  return /tiktok\.com/i.test(url) || /vm\.tiktok\.com/i.test(url);
}

function isInstagramUrl(url: string): boolean {
  return /instagram\.com/i.test(url);
}

function isXUrl(url: string): boolean {
  return /twitter\.com/i.test(url) || /x\.com/i.test(url);
}

async function resolveShortUrl(url: string): Promise<string> {
  if (url.includes('vm.tiktok.com') || url.includes('vt.tiktok.com')) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(url, {
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const location = response.headers.get('location');
      if (location) return location;
    } catch (err) {
      console.error('Failed to resolve short URL:', err);
    }
  }
  return url;
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = API_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

type InstagramDownloader = (url: string) => Promise<{
  result?: Array<{ url: string; filename?: string; thumbnail?: string; type?: string }>;
  error?: string;
}>;

// Normalized TikTok payload — matches the frontend VideoData shape so callers
// don't care which extractor produced it.
interface TikTokData {
  id: string;
  title: string;
  cover: string;
  author: { uniqueId: string; nickname: string; avatarThumb: string };
  play: string;
  wmplay: string;
  hdplay: string;
  duration: number;
  size: number;
}

// btch-downloader's ttdl returns no author/id, so we recover what we can from
// the share URL itself.
function tiktokIdFromUrl(url: string): string {
  const m = url.match(/\/(?:video|photo)\/(\d+)/);
  return m ? m[1] : '';
}
function tiktokHandleFromUrl(url: string): string {
  const m = url.match(/tiktok\.com\/@([^/?#]+)/i);
  return m ? m[1] : '';
}

// Primary TikTok source: btch-downloader's hosted ttdl API. tikwm.com now sits
// behind a Cloudflare "Just a moment" JS challenge that 403s every server-side
// fetch, so it can no longer be the primary source.
async function fetchTikTokViaBtch(resolvedUrl: string): Promise<TikTokData | null> {
  const { ttdl } = await import('btch-downloader');
  const r = await ttdl(resolvedUrl) as {
    status?: boolean; title?: string; thumbnail?: string; video?: string[];
  };
  const video = (r.video ?? []).filter(Boolean);
  if (video.length === 0) return null;
  const handle = tiktokHandleFromUrl(resolvedUrl);
  const best = video[0];
  return {
    id: tiktokIdFromUrl(resolvedUrl) || Date.now().toString(),
    title: r.title ?? '',
    cover: r.thumbnail ?? '',
    author: { uniqueId: handle, nickname: handle, avatarThumb: '' },
    play: best, wmplay: best, hdplay: best,
    duration: 0, size: 0,
  };
}

// Fallback: tikwm.com — kept in case the Cloudflare challenge is later lifted
// (or the request lands on an un-challenged edge). Returns null on any block.
async function fetchTikTokViaTikwm(resolvedUrl: string): Promise<TikTokData | null> {
  const form = new URLSearchParams({ url: resolvedUrl, hd: '1' });
  const res = await fetchWithTimeout('https://www.tikwm.com/api/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    body: form.toString(),
  });
  if (!res.ok) {
    console.error('TikWM API error:', res.status, res.statusText);
    return null;
  }
  const json = await res.json().catch(() => null) as { code?: number; msg?: string; data?: TikTokData } | null;
  if (!json || json.code !== 0 || !json.data) {
    if (json?.msg) console.error('TikWM error:', json.msg);
    return null;
  }
  return json.data;
}

export async function POST(request: NextRequest) {
  let url: string;
  const Schema = z.object({ url: z.string() });
  const parsed = Schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'url is required' }, { status: 400 });
  url = parsed.data.url;

  const trimmedUrl = url.trim();

  try {
    if (isTikTokUrl(trimmedUrl)) {
      const resolvedUrl = await resolveShortUrl(trimmedUrl);

      let data: TikTokData | null = null;
      try {
        data = await fetchTikTokViaBtch(resolvedUrl);
      } catch (err) {
        console.error('ttdl error:', err instanceof Error ? err.message : err);
      }
      if (!data) {
        try {
          data = await fetchTikTokViaTikwm(resolvedUrl);
        } catch (err) {
          console.error('tikwm fallback error:', err instanceof Error ? err.message : err);
        }
      }

      if (!data) {
        return NextResponse.json(
          { error: 'Could not fetch this TikTok. The link may be private, deleted, or region-locked — try another.' },
          { status: 502 },
        );
      }

      return NextResponse.json(data);
    }

    if (isInstagramUrl(trimmedUrl)) {
      const { igdl } = await import('btch-downloader');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);
      const data = await igdl(trimmedUrl) as Awaited<ReturnType<InstagramDownloader>>;
      clearTimeout(timeoutId);

      if (!data.result || data.result.length === 0) {
        return NextResponse.json({ error: data.error || 'Failed to fetch Instagram media' }, { status: 400 });
      }

      const firstResult = data.result[0];
      return NextResponse.json({
        id: Date.now().toString(),
        title: '',
        cover: firstResult.thumbnail || '',
        author: { uniqueId: 'instagram', nickname: 'Instagram User', avatarThumb: '' },
        play: firstResult.url || '',
        wmplay: firstResult.url || '',
        hdplay: firstResult.url || '',
        duration: 0,
        size: 0,
      });
    }

    if (isXUrl(trimmedUrl)) {
      const match = trimmedUrl.match(/(?:twitter|x)\.com\/([^/]+)\/status\/(\d+)/);
      if (!match) {
        return NextResponse.json({ error: 'Invalid X/Twitter URL format' }, { status: 400 });
      }
      const [, user, statusId] = match;

      const fxRes = await fetchWithTimeout(`https://api.fxtwitter.com/${user}/status/${statusId}`);
      if (!fxRes.ok) {
        return NextResponse.json({ error: 'Failed to fetch X/Twitter post' }, { status: 502 });
      }

      const fxJson = await fxRes.json() as {
        tweet?: {
          text?: string;
          author?: { screen_name?: string; name?: string; avatar_url?: string };
          media?: {
            videos?: Array<{ variants?: Array<{ url: string; bitrate?: number; content_type?: string }>; thumbnail_url?: string; duration?: number }>;
            photos?: Array<{ url: string }>;
          };
        };
      };
      const tweet = fxJson.tweet;
      if (!tweet) {
        return NextResponse.json({ error: 'Post not found or unavailable' }, { status: 400 });
      }

      const author = tweet.author;
      const authorResult = {
        uniqueId: author?.screen_name || 'x',
        nickname: author?.name || 'X User',
        avatarThumb: author?.avatar_url || '',
      };

      const videos = tweet.media?.videos?.[0]?.variants ?? [];
      const photos = tweet.media?.photos ?? [];

      if (videos.length > 0) {
        const mp4Variants = videos.filter(v => v.content_type === 'video/mp4' && v.url);
        const best = mp4Variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0] || videos[0];
        return NextResponse.json({
          id: statusId,
          title: tweet.text || '',
          cover: tweet.media?.videos?.[0]?.thumbnail_url || '',
          author: authorResult,
          play: best.url,
          wmplay: best.url,
          hdplay: best.url,
          duration: Math.round(tweet.media?.videos?.[0]?.duration || 0),
          size: 0,
        });
      }

      if (photos.length > 0) {
        return NextResponse.json({
          id: statusId,
          title: tweet.text || '',
          cover: photos[0].url,
          author: authorResult,
          play: '',
          wmplay: '',
          hdplay: '',
          duration: 0,
          size: 0,
          images: photos.map((p) => p.url),
        });
      }

      return NextResponse.json({ error: 'No media found in this post' }, { status: 400 });
    }

    return NextResponse.json({ error: 'Unsupported URL. Please provide a TikTok, Instagram, or X/Twitter URL.' }, { status: 400 });
  } catch (error: unknown) {
    const isAbort = error instanceof Error && (error.name === 'AbortError' || error.message.includes('abort'));
    if (isAbort) {
      return NextResponse.json({ error: 'Request timeout. The server took too long to respond.' }, { status: 504 });
    }
    const message = error instanceof Error ? error.message : 'Failed to fetch video data';
    console.error('Download error:', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
