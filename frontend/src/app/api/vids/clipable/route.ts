// PUT /api/vids/clipable { kind, key, clipable } — put one song or caption look
// on offer to the clippers, or take it off. For the things that have no row of
// their own (see VidClipable in vids-types): a song is keyed by its url, a
// caption look by its id. A persona's or clip's flag goes through its own
// PATCH route instead, like its name.
//
// The key is checked against what actually exists — a song the audio library
// holds, a look lib/vidsCaptions defines — so a typo can't approve nothing.
import { NextRequest, NextResponse } from 'next/server';
import { errMessage, listClipableKeys, setClipable } from '@/lib/vids-db';
import { MAX_CLIPABLE_KEY, MAX_SUGGESTED, isClipableKind, type ClipableKind, type VidClipableFlag } from '@/lib/vids-types';
import { CAPTION_STYLES } from '@/lib/vidsCaptions';
import { trackExists } from '@/lib/audio-library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Whether `key` names a real thing of this kind. Only a turn-on is held to
 *  this: a turn-off of something that has since gone (a song deleted from
 *  public/audio, a look retired) is exactly how its stray row gets cleared. */
function exists(kind: ClipableKind, key: string): boolean {
  if (kind === 'captionStyle') return CAPTION_STYLES.some((s) => s.id === key);
  // A suggested person is a name off the Pauv roster, which lives behind
  // another service — checking it here would mean fetching the whole roster on
  // every tick. The picker only ever offers real names, and a name that later
  // stops being on the roster simply matches nothing and shows as nothing.
  if (kind === 'suggested') return key.trim().length > 0;
  // A song is its url as /api/charts/list-audio hands it over.
  return trackExists(key);
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = body.kind;
  if (!isClipableKind(kind)) return NextResponse.json({ error: 'kind must be music, captionStyle or suggested' }, { status: 400 });
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!key || key.length > MAX_CLIPABLE_KEY) return NextResponse.json({ error: 'key is required' }, { status: 400 });
  if (typeof body.clipable !== 'boolean') return NextResponse.json({ error: 'clipable must be true or false' }, { status: 400 });
  if (body.clipable && !exists(kind, key)) {
    return NextResponse.json({ error: `no ${kind === 'music' ? 'song' : 'caption look'} called ${key}` }, { status: 404 });
  }
  // Five suggestions, and the fifth is the last. Counted here rather than left
  // to the page, so a second tab or a stale one cannot quietly make it six.
  if (kind === 'suggested' && body.clipable) {
    try {
      const on = await listClipableKeys('suggested');
      if (!on.has(key) && on.size >= MAX_SUGGESTED) {
        return NextResponse.json(
          { error: `${MAX_SUGGESTED} people are suggested already — take one off first.` },
          { status: 409 },
        );
      }
    } catch (err) {
      console.error('[vids clipable PUT] suggested count', err);
      return NextResponse.json({ error: errMessage(err) }, { status: 500 });
    }
  }
  try {
    await setClipable(kind, key, body.clipable);
    const flag: VidClipableFlag & { clipable: boolean } = { kind, key, clipable: body.clipable };
    return NextResponse.json(flag);
  } catch (err) {
    console.error('[vids clipable PUT]', err);
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
