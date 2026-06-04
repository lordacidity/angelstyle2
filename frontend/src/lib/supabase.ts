import { createClient } from '@supabase/supabase-js';

// Studio's read/write client — auth (the shared Pauv session) + the brand kit
// and carousel templates. This is the *Distribution* Supabase project, NOT the
// read-only MAIN price-data project. The /api/ai/* and markets routes use the
// MAIN project (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)
// directly; keep these two pointed at the Distribution project.
const url = process.env.NEXT_PUBLIC_SUPABASE_DIST_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export const supabase = createClient(url, key);
