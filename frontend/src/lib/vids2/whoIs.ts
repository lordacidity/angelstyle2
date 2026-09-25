// Who one person on Pauv is — their industry and bio off the roster — for the
// Start caption (api/vids/hook), whose guides have to know the person's world.
// A name alone had the model guessing: Clavicular, a looksmaxxing streamer, was
// written up as "the most overhyped rookie in the game" on 2026-09-24.
//
// One row by name from the MAIN price-data Supabase project (profiles), the
// way lib/news/pauv-people reads the roster, kept for an hour per name. Server
// only; the client is built inside the read so Next's build-time page-data
// collection never evaluates it without the env vars.

import { createClient } from '@supabase/supabase-js';

export interface Who {
  industry: string | null;
  subcategory: string | null;
  bio: string | null;
  /** The line a guide is handed: "Influencers: Braden Eric Peters, known
   *  online as Clavicular, is an American online streamer …" */
  summary: string;
}

const KEEP_MS = 60 * 60_000;
const KEEP_MAX = 1000;
/** A bio is cut to about this, at a sentence end. */
const BIO_MAX = 480;

const kept = new Map<string, { at: number; value: Promise<Who | null> }>();

function client() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/** The bio cut to BIO_MAX at the end of a sentence, so the guide gets whole
 *  ones. */
function brief(bio: string): string {
  const b = bio.replace(/\s+/g, ' ').trim();
  if (b.length <= BIO_MAX) return b;
  const cut = b.slice(0, BIO_MAX);
  const end = cut.lastIndexOf('. ');
  return end > BIO_MAX / 2 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

async function read(name: string): Promise<Who | null> {
  type Row = { industry: string | null; info_subcategory: string | null; bio: string | null };
  const { data, error } = await client()
    .from('profiles')
    .select('industry,info_subcategory,bio')
    // Case-insensitive and whole: ilike with no wildcard, the pattern
    // characters in the name escaped.
    .ilike('name', name.replace(/[%_\\]/g, '\\$&'))
    .limit(1);
  if (error) throw new Error(error.message);
  const row = (data as Row[] | null)?.[0];
  if (!row) return null;
  const industry = row.industry?.trim() || null;
  const subcategory = row.info_subcategory?.trim() || null;
  const bio = row.bio?.trim() || null;
  const world = [industry, subcategory].filter(Boolean).join(' · ');
  const summary = [world, bio ? brief(bio) : ''].filter(Boolean).join(': ');
  return summary ? { industry, subcategory, bio, summary } : null;
}

/** Who `name` is on Pauv — null when the roster has no such name, or the read
 *  failed, and the guide then goes without. */
export function whoIs(name: string): Promise<Who | null> {
  const key = name.trim().toLowerCase();
  if (!key) return Promise.resolve(null);
  const hit = kept.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.value;
  if (kept.size >= KEEP_MAX) kept.clear();
  const value = read(key).catch((err: unknown) => {
    console.error('[vids hook] who is', name, ':', err instanceof Error ? err.message : err);
    kept.delete(key);
    return null;
  });
  kept.set(key, { at: Date.now(), value });
  return value;
}
