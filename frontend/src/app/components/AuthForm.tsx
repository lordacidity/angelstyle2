'use client';

import { useState } from 'react';

interface AuthFormProps {
  onSignIn: (email: string, password: string) => Promise<string | null>;
  onSignUp: (email: string, password: string) => Promise<string | null>;
  onResetPassword: (email: string) => Promise<string | null>;
}

export function AuthForm({ onSignIn, onSignUp, onResetPassword }: AuthFormProps) {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (mode === 'forgot') {
      const err = await onResetPassword(email);
      if (err) { setError(err); } else { setResetSent(true); }
      setLoading(false);
      return;
    }

    const err = mode === 'login'
      ? await onSignIn(email, password)
      : await onSignUp(email, password);

    if (err) setError(err);
    setLoading(false);
  }

  function switchMode(next: 'login' | 'signup' | 'forgot') {
    setMode(next);
    setError(null);
    setResetSent(false);
  }

  if (mode === 'forgot' && resetSent) {
    return (
      <div className="w-full max-w-sm flex flex-col gap-6 text-center">
        <div>
          <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-4">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <h2 className="text-2xl font-semibold text-white tracking-tight">Check your email</h2>
          <p className="text-sm text-zinc-500 mt-2">
            We sent a password reset link to <span className="text-zinc-300">{email}</span>
          </p>
        </div>
        <button
          onClick={() => switchMode('login')}
          className="text-sm text-zinc-500 hover:text-white transition-colors"
        >
          ← Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm flex flex-col gap-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-white tracking-tight">
          {mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create account' : 'Reset password'}
        </h2>
        <p className="text-sm text-zinc-500 mt-1">
          {mode === 'login'
            ? 'Sign in to access your Brand Kit'
            : mode === 'signup'
            ? 'Set up your Brand Kit'
            : 'Enter your email to receive a reset link'}
        </p>
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

        {mode !== 'forgot' && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Password</label>
              {mode === 'login' && (
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  className="text-xs text-zinc-500 hover:text-white transition-colors"
                >
                  Forgot password?
                </button>
              )}
            </div>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
              className="w-full bg-zinc-900 border border-zinc-800 focus:border-zinc-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none transition-colors"
            />
          </div>
        )}

        {error && (
          <p className="text-sm text-red-400 bg-red-950/40 border border-red-800/50 rounded-lg px-3 py-2">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-xl bg-white text-black text-sm font-semibold hover:bg-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading
            ? 'Please wait…'
            : mode === 'login'
            ? 'Sign in'
            : mode === 'signup'
            ? 'Create account'
            : 'Send reset link'}
        </button>
      </form>

      {mode === 'forgot' ? (
        <button
          onClick={() => switchMode('login')}
          className="text-center text-sm text-zinc-500 hover:text-white transition-colors"
        >
          ← Back to sign in
        </button>
      ) : (
        <p className="text-center text-sm text-zinc-500">
          {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}
          {' '}
          <button
            onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}
            className="text-white hover:underline"
          >
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      )}
    </div>
  );
}
