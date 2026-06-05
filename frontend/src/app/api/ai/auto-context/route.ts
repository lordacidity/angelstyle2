import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { geminiGenerate, uploadFileToGemini, waitForFileActive, deleteGeminiFile, type GeminiPart } from '@/lib/gemini';

// Force Node.js runtime — we fetch the video bytes server-side.
export const runtime = 'nodejs';
export const maxDuration = 60;

const FETCH_TIMEOUT = 25000;
// Gemini's inline-data request caps at ~20MB total (base64 inflates ~33%), so
// send clips under ~15MB inline (one fast call) and upload bigger ones via the
// Files API. HARD_MAX is just a sanity ceiling — beyond it we give up (UNSURE).
const INLINE_MAX = 15 * 1024 * 1024;
const HARD_MAX = 200 * 1024 * 1024;

const Schema = z.object({
  videoUrl: z.string().url(),
  sourceUrl: z.string().optional(),
  videoId: z.string().optional(),
  title: z.string().optional(),
  author: z.string().optional(),
});

function isTikTokUrl(url: string): boolean {
  return /tiktok\.com/i.test(url) || /vm\.tiktok\.com/i.test(url) || /vt\.tiktok\.com/i.test(url);
}

interface TikWmComment { text?: string; digg_count?: number }

// Best-effort: pull the loudest comments off a TikTok post. Comments often
// reveal who the person is / what actually happened / why it's notable — signal
// the frames alone don't carry. Never throws; returns [] on any failure so
// auto-context still works from the video + caption.
//
// NOTE: TikWM's free comment endpoint currently returns an empty list for every
// video (comment scraping appears gated behind their paid tier), so in practice
// this is usually a no-op today. It's wired correctly (url-form, which is the
// param TikWM accepts — aweme_id is rejected) so it lights up if that changes or
// COMMENTS_API_BASE points at a working Evil0ctal-style instance.
async function fetchTikTokComments(opts: { videoId?: string; sourceUrl?: string }): Promise<string[]> {
  // Prefer a canonical URL built from the numeric id (parses reliably); fall
  // back to the original share link.
  const url = opts.videoId ? `https://www.tiktok.com/@i/video/${opts.videoId}` : opts.sourceUrl;
  if (!url) return [];

  const norm = (texts: string[]) => texts
    .map(t => t.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 20)
    .map(t => (t.length > 200 ? `${t.slice(0, 200)}…` : t));

  // Optional: an Evil0ctal-style instance (self-hosted or chosen by the user)
  // that actually returns comments. Tried first when configured.
  const base = process.env.COMMENTS_API_BASE?.replace(/\/$/, '');
  if (base && opts.videoId) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`${base}/api/tiktok/web/fetch_post_comment?aweme_id=${encodeURIComponent(opts.videoId)}&count=40&cursor=0`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const json = await res.json() as { data?: { comments?: Array<{ text?: string; digg_count?: number }> } };
        const list = json.data?.comments ?? [];
        if (list.length) {
          return norm(list.slice().sort((a, b) => (b.digg_count ?? 0) - (a.digg_count ?? 0)).map(c => c.text ?? ''));
        }
      }
    } catch { /* fall through to TikWM */ }
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(`https://www.tikwm.com/api/comment/list/?url=${encodeURIComponent(url)}&count=40&cursor=0`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return [];
    const json = await res.json() as { code: number; data?: { comments?: TikWmComment[] } };
    if (json.code !== 0 || !json.data?.comments) return [];
    return norm(json.data.comments.slice().sort((a, b) => (b.digg_count ?? 0) - (a.digg_count ?? 0)).map(c => c.text ?? ''));
  } catch {
    return [];
  }
}

function buildPrompt(o: { title?: string; author?: string; comments: string[] }): string {
  const lines: string[] = [
    'Identify ONLY who is in this clip and what they are doing. Use the video, and the post caption / comments below as hints to name the person.',
  ];
  if (o.author) lines.push(`Creator: "${o.author}".`);
  if (o.title && o.title.trim()) lines.push(`Post caption: "${o.title.trim()}".`);
  if (o.comments.length) {
    lines.push('Comments (may name the person):');
    lines.push(o.comments.map((c, i) => `${i + 1}. ${c}`).join('\n'));
  }
  lines.push(
    [
      'Output ONE concise sentence: who is in it and what they are doing, plus a little context (the setting or the specific action).',
      'Examples: "Lewis Hamilton gives a post-race interview after finishing on the podium." · "Two women try a viral pasta recipe in a home kitchen." · "A man rebuilds a motorcycle engine in his garage."',
      'Name the person only if you are confident. Be precise and factual — keep it to one sentence, no marketing language, no emojis, no hashtags.',
      'If you cannot tell with confidence who is in it or what they are doing, output exactly: UNSURE',
    ].join(' '),
  );
  return lines.join('\n\n');
}

export async function POST(request: NextRequest) {
  const parsed = Schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'videoUrl is required' }, { status: 400 });
  const { videoUrl, sourceUrl, videoId, title, author } = parsed.data;

  // Comments (best-effort, TikTok only) and the video bytes in parallel.
  const wantComments = !!videoId || (!!sourceUrl && isTikTokUrl(sourceUrl));
  const commentsPromise = wantComments ? fetchTikTokComments({ videoId, sourceUrl }) : Promise.resolve<string[]>([]);

  // "Can't read the clip" → fill the cell with UNSURE (the editor's cue to write
  // it by hand) rather than a hard error. Reserved for content/size limits, not
  // operational failures (network, misconfig) which stay real errors.
  const unsure = () => NextResponse.json({ context: 'UNSURE' });

  let ab: ArrayBuffer;
  let mime: string;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const res = await fetch(videoUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.tiktok.com/' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return NextResponse.json({ error: `Could not fetch the video (${res.status}).` }, { status: 502 });
    mime = res.headers.get('content-type')?.split(';')[0] || 'video/mp4';
    if (!/^video\//.test(mime)) mime = 'video/mp4';
    ab = await res.arrayBuffer();
    if (ab.byteLength > HARD_MAX) return unsure(); // absurdly large → give up cleanly
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError' ? 'Fetching the video timed out.' : 'Could not fetch the video.';
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const comments = await commentsPromise;

  // Small clips go inline (one fast call); bigger ones upload via the Files API.
  let videoPart: GeminiPart;
  let uploadedName: string | null = null;
  try {
    if (ab.byteLength <= INLINE_MAX) {
      videoPart = { inline_data: { mime_type: mime, data: Buffer.from(ab).toString('base64') } };
    } else {
      const { uri, name } = await uploadFileToGemini(ab, mime, 'phonedeck-clip');
      uploadedName = name;
      await waitForFileActive(name);
      videoPart = { file_data: { mime_type: mime, file_uri: uri } };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'upload failed';
    if (uploadedName) void deleteGeminiFile(uploadedName);
    if (/GEMINI_API_KEY/.test(msg)) return NextResponse.json({ error: msg }, { status: 502 });
    console.error('auto-context prepare error:', msg);
    return unsure(); // couldn't get the clip into Gemini → UNSURE
  }

  const parts: GeminiPart[] = [
    { text: buildPrompt({ title, author, comments }) },
    videoPart,
  ];

  try {
    const text = (await geminiGenerate(parts, { temperature: 0.2, maxOutputTokens: 100 })).trim();
    if (!text) return unsure();
    return NextResponse.json({ context: text, commentsUsed: comments.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Gemini request failed';
    console.error('auto-context error:', msg);
    // Photo/slideshow post (TikTok photomode, IG carousel) — no real video track,
    // Gemini reports "0 Frames found". No usable visual context → UNSURE.
    if (/0 Frames found|corrupted|wrong video metadata/i.test(msg)) return unsure();
    if (/GEMINI_API_KEY/.test(msg)) return NextResponse.json({ error: msg }, { status: 502 });
    return NextResponse.json({ error: msg }, { status: 502 }); // transient/overload → real error, user can retry
  } finally {
    if (uploadedName) void deleteGeminiFile(uploadedName);
  }
}
