'use client';

// The chat. DeepSeek on the other end, with the whole log read to it before
// every answer: every person, firm, place, tie, event, goal and note. So it can
// be asked who to chase this week, how to get to someone through people already
// known, or to draft the follow-up to a conversation it has the notes from.
//
// One running thread, kept on the server, so it is still here next time.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AidenChatMessage } from '@/lib/aiden-types';
import { AidenLockedError, aidenFetch, type UseAidenData } from './useAidenData';
import { btnGhost, btnPrimary, textareaCls } from './aiden-ui';

const STARTERS = [
  'Who should I follow up with this week, and what should I say?',
  'Who has gone quiet that I should not let go cold?',
  'Look at my goals. What are the three best moves I can make right now?',
  'Which people I know could introduce me to firms I have not reached yet?',
  'What is missing from my log that I should fill in?',
];

// ── A small reader for what the model writes ──────────────────────────────────
// Bold, headings, and lists: the handful of marks it actually uses. Anything
// else is shown as it came.
function inline(text: string, key: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={`${key}-${i}`} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={`${key}-${i}`} className="rounded bg-zinc-800 px-1 py-0.5 text-[11.5px]">{part.slice(1, -1)}</code>;
    }
    return <React.Fragment key={`${key}-${i}`}>{part}</React.Fragment>;
  });
}

function Rendered({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let quote: string[] = [];

  const flushQuote = (k: string) => {
    if (!quote.length) return;
    out.push(
      <blockquote key={k} className="my-1.5 whitespace-pre-wrap border-l-2 border-zinc-700 pl-3 text-zinc-300">
        {quote.map((l, i) => <React.Fragment key={i}>{i > 0 && '\n'}{inline(l, `${k}-${i}`)}</React.Fragment>)}
      </blockquote>,
    );
    quote = [];
  };

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const k = `l${i}`;
    if (/^\s*>/.test(line)) {
      quote.push(line.replace(/^\s*>\s?/, ''));
      return;
    }
    flushQuote(`q${i}`);

    if (!line.trim()) {
      out.push(<div key={k} className="h-2" />);
      return;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push(<hr key={k} className="my-2 border-zinc-800" />);
      return;
    }
    const head = /^\s*(#{1,6})\s+(.*)$/.exec(line);
    if (head) {
      out.push(<p key={k} className="mt-2 text-[13px] font-semibold text-white">{inline(head[2], k)}</p>);
      return;
    }
    const bullet = /^(\s*)[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      out.push(
        <div key={k} className="flex gap-2" style={{ paddingLeft: Math.min(3, Math.floor(bullet[1].length / 2)) * 14 }}>
          <span className="select-none text-zinc-600">•</span>
          <span className="min-w-0 flex-1">{inline(bullet[2], k)}</span>
        </div>,
      );
      return;
    }
    const numbered = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      out.push(
        <div key={k} className="flex gap-2" style={{ paddingLeft: Math.min(3, Math.floor(numbered[1].length / 2)) * 14 }}>
          <span className="w-4 shrink-0 select-none text-right text-zinc-500">{numbered[2]}.</span>
          <span className="min-w-0 flex-1">{inline(numbered[3], k)}</span>
        </div>,
      );
      return;
    }
    out.push(<p key={k}>{inline(line, k)}</p>);
  });
  flushQuote('q-end');

  return <div className="flex flex-col gap-0.5 text-[13px] leading-relaxed text-zinc-300">{out}</div>;
}

// ── The chat ──────────────────────────────────────────────────────────────────
export function AidenChat({
  api, active, onLocked,
}: {
  api: UseAidenData;
  active: boolean;
  onLocked: () => void;
}) {
  const [messages, setMessages] = useState<AidenChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const fail = useCallback((e: unknown, fallback: string) => {
    if (e instanceof AidenLockedError) { onLocked(); return; }
    setError(e instanceof Error ? e.message : fallback);
  }, [onLocked]);

  useEffect(() => {
    if (!active || loaded) return;
    let gone = false;
    aidenFetch<AidenChatMessage[]>('/api/aiden/chat')
      .then((list) => { if (!gone) { setMessages(list); setLoaded(true); } })
      .catch((e) => { if (!gone) fail(e, 'Failed to load the chat'); });
    return () => { gone = true; };
  }, [active, fail, loaded]);

  useEffect(() => {
    if (active) end.current?.scrollIntoView({ block: 'end' });
  }, [active, messages.length, thinking]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || thinking) return;
    setError(null);
    setDraft('');
    setThinking(true);
    // Shown at once, under a stand-in id, and swapped for the saved row after.
    const pending: AidenChatMessage = {
      id: `pending-${Date.now()}`, role: 'user', content, createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, pending]);
    try {
      const res = await fetch('/api/aiden/chat', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (res.status === 401) throw new AidenLockedError('locked');
      const json = (await res.json().catch(() => ({}))) as {
        user?: AidenChatMessage; assistant?: AidenChatMessage; error?: string;
      };
      setMessages((prev) => {
        const rest = prev.filter((m) => m.id !== pending.id);
        return [...rest, json.user ?? pending, ...(json.assistant ? [json.assistant] : [])];
      });
      if (!res.ok) setError(json.error ?? `HTTP ${res.status}`);
    } catch (e) {
      fail(e, 'Failed to send');
    } finally {
      setThinking(false);
      input.current?.focus();
    }
  }

  async function clear() {
    if (!messages.length || thinking) return;
    if (!window.confirm('Clear the whole conversation? The log itself is untouched.')) return;
    try {
      await aidenFetch('/api/aiden/chat', { method: 'DELETE' });
      setMessages([]);
      setError(null);
    } catch (e) {
      fail(e, 'Failed to clear');
    }
  }

  async function copy(m: AidenChatMessage) {
    try {
      await navigator.clipboard.writeText(m.content);
      setCopied(m.id);
      setTimeout(() => setCopied((c) => (c === m.id ? null : c)), 1500);
    } catch { /* clipboard blocked; the text can still be selected */ }
  }

  const d = api.data;
  const knows = `${d.people.length} people, ${d.firms.length} firms, ${d.events.length} events, ${d.goals.length} goals, ${d.notes.length} thoughts`;

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
      <div className="flex items-center justify-between pb-3">
        <p className="text-[11px] text-zinc-600">
          DeepSeek reads the whole log before every answer: {knows}.
        </p>
        {messages.length > 0 && (
          <button type="button" onClick={() => void clear()} disabled={thinking} className={btnGhost}>Clear</button>
        )}
      </div>

      <div className="vids-scroll min-h-0 flex-1 overflow-y-auto pr-1">
        {loaded && messages.length === 0 && (
          <div className="flex flex-col gap-2 py-6">
            <p className="mb-1 text-[13px] font-medium text-zinc-300">Ask it anything about your network.</p>
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void send(s)}
                disabled={thinking}
                className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3.5 py-2.5 text-left text-[12.5px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-white"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-4 py-2">
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-zinc-800 px-3.5 py-2 text-[13px] leading-relaxed text-white">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={m.id} className="group flex flex-col gap-1">
                <Rendered text={m.content} />
                <button
                  type="button"
                  onClick={() => void copy(m)}
                  className="self-start text-[10.5px] text-zinc-700 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
                >
                  {copied === m.id ? 'Copied' : 'Copy'}
                </button>
              </div>
            ),
          )}
          {thinking && (
            <div className="flex items-center gap-2 text-[12px] text-zinc-500">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
              Reading the log...
            </div>
          )}
          {error && (
            <p className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-[12px] text-red-300">{error}</p>
          )}
          <div ref={end} />
        </div>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); void send(draft); }}
        className="mt-3 flex items-end gap-2 border-t border-zinc-800 pt-3"
      >
        <textarea
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(draft); }
          }}
          rows={Math.min(8, Math.max(2, draft.split('\n').length))}
          placeholder="Who should I talk to next? Draft a follow-up to... (Enter to send, Shift+Enter for a new line)"
          className={textareaCls}
        />
        <button type="submit" disabled={!draft.trim() || thinking} className={`${btnPrimary} h-[34px] shrink-0`}>
          Send
        </button>
      </form>
    </div>
  );
}
