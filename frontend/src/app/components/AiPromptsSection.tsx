'use client';

// "AI Prompts" — a full main-area section (reached from the left nav) with 15
// fixed topic slots. Type a few words into a slot (e.g. "basketball"), hit Go,
// and SerpAPI pulls the latest breaking news for that topic while DeepSeek picks
// the single biggest breaking story about one specific person (an athlete or
// artist) and writes three detailed sentences of interesting facts about them.
// "Generate All" (top-right) runs every slot that has a topic. Topics and
// overviews both persist to Railway Postgres via the /api/ai-prompts routes.
//
// Topic edits autosave on blur (PATCH); Go also commits whatever is in the input
// (so you can type and hit Go without blurring first).

import React, { useCallback, useEffect, useRef, useState } from 'react';

type PromptCategory = 'athlete' | 'artist';
const CATEGORIES: PromptCategory[] = ['athlete', 'artist'];

interface AiPrompt {
  id: string;
  position: number;
  topic: string;
  category: PromptCategory;
  overview: string;
  overviewUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function formatStamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function AiPromptsSection() {
  const [prompts, setPrompts] = useState<AiPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // ids currently generating an overview.
  const [generating, setGenerating] = useState<Set<string>>(new Set());
  // id → per-card generate error message.
  const [genErrors, setGenErrors] = useState<Record<string, string>>({});
  // Tracks "topic input has unsaved keystrokes" so blur only PATCHes on change.
  const dirty = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai-prompts', { cache: 'no-store' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      setPrompts(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const patchLocal = useCallback((id: string, patch: Partial<AiPrompt>) => {
    setPrompts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const onTopicChange = useCallback((id: string, value: string) => {
    dirty.current.add(id);
    patchLocal(id, { topic: value });
  }, [patchLocal]);

  // Flip a slot's athlete/artist category — optimistic local update, then persist.
  const setCategory = useCallback(async (id: string, category: PromptCategory) => {
    patchLocal(id, { category });
    try {
      const res = await fetch(`/api/ai-prompts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save category');
    }
  }, [patchLocal]);

  // Save the topic on blur, but only if it actually changed.
  const onTopicCommit = useCallback(async (id: string) => {
    if (!dirty.current.has(id)) return;
    dirty.current.delete(id);
    const current = prompts.find((p) => p.id === id);
    if (!current) return;
    try {
      const res = await fetch(`/api/ai-prompts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: current.topic }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save topic');
    }
  }, [prompts]);

  // Core generate — hit the route for one slot. Topic is sent in the body so the
  // pending edit commits server-side. No guard here; callers decide what to skip.
  const runGenerate = useCallback(async (id: string, topic: string) => {
    dirty.current.delete(id);
    setGenerating((prev) => new Set(prev).add(id));
    setGenErrors((prev) => { const next = { ...prev }; delete next[id]; return next; });
    try {
      const res = await fetch(`/api/ai-prompts/${id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      patchLocal(id, {
        topic: data.topic,
        overview: data.overview,
        overviewUpdatedAt: data.overviewUpdatedAt,
      });
    } catch (e) {
      setGenErrors((prev) => ({ ...prev, [id]: e instanceof Error ? e.message : 'Failed to generate' }));
    } finally {
      setGenerating((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }, [patchLocal]);

  const generate = useCallback((id: string) => {
    const current = prompts.find((p) => p.id === id);
    const topic = (current?.topic ?? '').trim();
    if (!topic || generating.has(id)) return;
    void runGenerate(id, topic);
  }, [prompts, generating, runGenerate]);

  // "Generate all" — fire every slot that has a topic and isn't already running.
  // They run concurrently; each card shows its own spinner / result / error.
  const generateAll = useCallback(() => {
    for (const p of prompts) {
      const topic = p.topic.trim();
      if (topic && !generating.has(p.id)) void runGenerate(p.id, topic);
    }
  }, [prompts, generating, runGenerate]);

  const topicCount = prompts.filter((p) => p.topic.trim()).length;
  const anyGenerating = generating.size > 0;

  return (
    <div className="flex h-full flex-col text-white">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b border-zinc-800 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">AI Prompts</h1>
          <p className="text-xs text-zinc-500">
            Type topics, hit Go for a 3-sentence take on the biggest breaking story about one person — or Generate All at once
          </p>
        </div>
        <button
          onClick={generateAll}
          disabled={topicCount === 0 || anyGenerating}
          title="Generate every topic that has text"
          className="flex shrink-0 items-center gap-2 rounded-md bg-white px-3.5 py-2 text-sm font-semibold text-black transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
        >
          {anyGenerating && (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent" />
          )}
          {anyGenerating ? 'Generating…' : `Generate All${topicCount ? ` (${topicCount})` : ''}`}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {error && (
          <div className="mb-4 rounded-md border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {prompts.map((p) => {
              const isGen = generating.has(p.id);
              const genError = genErrors[p.id];
              return (
                <div
                  key={p.id}
                  className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
                >
                  {/* Topic + Go */}
                  <div className="flex items-center gap-2">
                    <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-zinc-600">
                      {p.position}
                    </span>
                    <input
                      value={p.topic}
                      onChange={(e) => onTopicChange(p.id, e.target.value)}
                      onBlur={() => onTopicCommit(p.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); void generate(p.id); }
                      }}
                      placeholder="Topic (e.g. basketball)"
                      className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-zinc-600"
                    />
                    <button
                      onClick={() => generate(p.id)}
                      disabled={isGen || !p.topic.trim()}
                      title="Pull trending news for this topic"
                      className="flex h-8 w-12 shrink-0 items-center justify-center rounded-md bg-white text-sm font-semibold text-black transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
                    >
                      {isGen ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent" />
                      ) : (
                        'Go'
                      )}
                    </button>
                  </div>

                  {/* Category — athlete or artist */}
                  <div className="flex w-fit items-center gap-0.5 rounded-md border border-zinc-800 bg-zinc-950 p-0.5">
                    {CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setCategory(p.id, cat)}
                        className={`rounded px-2.5 py-0.5 text-[11px] font-medium capitalize transition-colors ${
                          p.category === cat
                            ? 'bg-zinc-700 text-white'
                            : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>

                  {/* Overview */}
                  <div className="min-h-[3.5rem]">
                    {isGen ? (
                      <p className="text-xs italic text-zinc-500">Pulling trending news…</p>
                    ) : genError ? (
                      <p className="text-xs text-red-400">{genError}</p>
                    ) : p.overview ? (
                      <>
                        <p className="text-sm leading-relaxed text-zinc-300">{p.overview}</p>
                        {p.overviewUpdatedAt && (
                          <p className="mt-2 text-[10px] text-zinc-600">Updated {formatStamp(p.overviewUpdatedAt)}</p>
                        )}
                      </>
                    ) : (
                      <p className="text-xs italic text-zinc-600">No overview yet — type a topic and hit Go.</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
