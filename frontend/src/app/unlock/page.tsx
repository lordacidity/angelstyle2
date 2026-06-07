'use client';

import { useState } from 'react';

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
      const res = await fetch('/api/unlock', {
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
      window.location.href = dest;
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
      </form>
    </main>
  );
}
