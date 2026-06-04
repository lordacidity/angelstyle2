'use client';

// usePauvSession — there's no login UI; the whole app is "Pauv". This silently
// signs in to one shared Supabase account on boot so the existing data layer
// (brand kit, carousel templates, logo storage) keeps working against a real
// auth user — its row-level-security policies are untouched. Everyone who opens
// the app is that one account, so the brand is set once and shared.
//
// Configure the shared account in frontend/.env:
//   NEXT_PUBLIC_PAUV_EMAIL=...
//   NEXT_PUBLIC_PAUV_PASSWORD=...
// (These ship in the client bundle — fine for an internal Pauv-only tool.)

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

const PAUV_EMAIL = process.env.NEXT_PUBLIC_PAUV_EMAIL ?? '';
const PAUV_PASSWORD = process.env.NEXT_PUBLIC_PAUV_PASSWORD ?? '';

export function usePauvSession() {
  const [userId, setUserId] = useState<string | null>(null);
  // ready flips true once we've settled the session (signed in, already had one,
  // or failed) so the UI doesn't render brand state against a null user forever.
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function ensureSession() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        if (!cancelled) { setUserId(session.user.id); setReady(true); }
        return;
      }
      if (!PAUV_EMAIL || !PAUV_PASSWORD) {
        if (!cancelled) {
          setError('Set NEXT_PUBLIC_PAUV_EMAIL and NEXT_PUBLIC_PAUV_PASSWORD in frontend/.env');
          setReady(true);
        }
        return;
      }
      const { data, error: signInErr } = await supabase.auth.signInWithPassword({
        email: PAUV_EMAIL,
        password: PAUV_PASSWORD,
      });
      if (cancelled) return;
      if (signInErr) { setError(signInErr.message); setReady(true); return; }
      setUserId(data.user?.id ?? null);
      setReady(true);
    }

    void ensureSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      if (!cancelled) setUserId(session?.user?.id ?? null);
    });

    return () => { cancelled = true; subscription.unsubscribe(); };
  }, []);

  return { userId, ready, error };
}
