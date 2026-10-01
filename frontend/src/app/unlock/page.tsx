'use client';

import { useState } from 'react';
import { CLIPPERS, withBase } from '@/lib/clipping';

// Site password gate UI. Posts to /api/unlock; on success the cookie is set and we send the
// user to wherever they were headed (?next=), defaulting to the app root.
export default function UnlockPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch(withBase('/api/unlock'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError('Incorrect password');
        setBusy(false);
        return;
      }
      const next = new URLSearchParams(window.location.search).get('next');
      // Only allow same-site relative redirects (no protocol-relative // open redirects).
      const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
      // withBase: ?next= is basePath-relative (middleware reads it off nextUrl,
      // which strips the prefix), so in the clipper build this has to be put back
      // on or a successful unlock lands on pauv.io itself rather than /clipping.
      window.location.href = withBase(dest);
    } catch {
      setError('Something went wrong — try again');
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8"
      >
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-lg font-semibold text-white">Enter password</h1>
          <p className="text-sm text-zinc-500">This site is private.</p>
        </div>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-zinc-500"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="w-full rounded-lg bg-white py-2.5 text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-200 disabled:opacity-40"
        >
          {busy ? 'Checking…' : 'Unlock'}
        </button>
        {/* The clipper page's gate only (pauv.io/clipping): where a clipper
            without the password goes to get one. Discord's own mark and blurple. */}
        {CLIPPERS && (
          <a
            href="https://discord.gg/pauvinc"
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#5865F2] py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#4752C4]"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
            </svg>
            Join the Discord
          </a>
        )}
      </form>
    </main>
  );
}
