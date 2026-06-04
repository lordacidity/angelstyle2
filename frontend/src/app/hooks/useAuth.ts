'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signIn(email: string): Promise<string | null> {
    const res = await fetch('/api/auth/email-signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const json = await res.json();
    if (json.error) return json.error;

    const { data, error: verifyErr } = await supabase.auth.verifyOtp({
      token_hash: json.token_hash,
      type: 'magiclink',
    });
    if (verifyErr) return verifyErr.message;

    if (data.session) {
      await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
    }
    if (data.user) setUser(data.user);
    return null;
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
  }

  async function resetPassword(email: string): Promise<string | null> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return error?.message ?? null;
  }

  async function updatePassword(password: string): Promise<string | null> {
    const { error } = await supabase.auth.updateUser({ password });
    return error?.message ?? null;
  }

  async function changePassword(currentPassword: string, newPassword: string): Promise<string | null> {
    if (!user?.email) return 'No user email found';
    const { error: verifyErr } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
    if (verifyErr) return 'Current password is incorrect';
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return error?.message ?? null;
  }

  return { user, loading, signIn, signOut, resetPassword, updatePassword, changePassword };
}
