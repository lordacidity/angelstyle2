// /api/aiden/geocode — where a place is, for the map (POST).
//
//   { placeId }          look the place up (as its name, or its saved geoQuery)
//                        and save what was found on it
//   { placeId, query }   look it up as `query` instead, and save that too
//   { query }            just look a query up; nothing is saved
//
// Answers { found: true, lat, lng, label } or { found: false }.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { aidenLocked, isAidenUnlocked } from '@/lib/aiden-auth';
import { readPlace, updateRow } from '@/lib/aiden-db';
import { geoQueryFor, geocode } from '@/lib/aiden-geocode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  placeId: z.string().uuid().optional(),
  query: z.string().trim().max(200).optional(),
});

export async function POST(req: NextRequest) {
  if (!(await isAidenUnlocked(req))) return aidenLocked();
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success || (!parsed.data.placeId && !parsed.data.query)) {
    return NextResponse.json({ error: 'say which place, or what to look up' }, { status: 400 });
  }
  const { placeId, query } = parsed.data;

  try {
    if (!placeId) {
      const hit = await geocode(query!);
      return NextResponse.json(hit ? { found: true, ...hit } : { found: false });
    }

    const place = await readPlace(placeId);
    if (!place) return NextResponse.json({ error: 'no such place' }, { status: 404 });

    const asked = query || place.geoQuery || geoQueryFor(place.name);
    const hit = asked ? await geocode(asked) : null;
    await updateRow('places', placeId, hit
      ? { lat: hit.lat, lng: hit.lng, geoLabel: hit.label, geoStatus: 'ok', ...(query ? { geoQuery: query } : {}) }
      : { geoStatus: 'missing', ...(query ? { geoQuery: query } : {}) });
    return NextResponse.json(hit ? { found: true, ...hit } : { found: false });
  } catch (err) {
    console.error('[aiden geocode]', err);
    return NextResponse.json({ error: 'the map lookup could not be reached' }, { status: 502 });
  }
}
