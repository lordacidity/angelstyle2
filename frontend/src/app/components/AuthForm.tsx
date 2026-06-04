'use client';

import { useState } from 'react';

interface AuthFormProps {
  onSignIn: (email: string) => Promise<string | null>;
}

export function AuthForm({ onSignIn }: AuthFormProps) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const err = await onSignIn(email);
    if (err) setError(err);
    setLoading(false);
  }

  return (
    <div className="w-full max-w-sm flex flex-col gap-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-white tracking-tight">Welcome</h2>
        <p className="text-sm text-zinc-500 mt-1">Enter your email to continue</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="w-full bg-zinc-900 border border-zinc-800 focus:border-zinc-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none transition-colors"
          />
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-950/40 border border-red-800/50 rounded-lg px-3 py-2">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-xl bg-white text-black text-sm font-semibold hover:bg-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? 'Please wait…' : 'Continue'}
        </button>
      </form>
    </div>
  );
}
