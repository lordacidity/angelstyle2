'use client';

// Aiden — a private log of everyone he is reaching and everything that has
// happened with them (Studio > Aiden).
//
// Behind its own password, on top of the site's. Everything that happens goes
// in as an EVENT (an email, a LinkedIn message, a call, a networking night) and
// names the PEOPLE it involved. People sit under FIRMS, both sit in PLACES, and
// people are tied to each other as friends, mutuals and the rest. From there:
//
//   Timeline   every event, newest first, with the follow-ups still owed
//   People     everyone, with or without an event to their name
//   Firms      the funds and companies, and who is known at each
//   Places     SF, Austin, and who is where
//   Rounds     which firms have been in the same funding round, and so which
//              warm firm can introduce a cold one
//   Views      the web, laid out five ways (free, on a map, in rings by
//              warmth, in clusters by firm or place, along a timeline), and
//              Activity: each person's touches as dots along the months
//   Goals      goals, and whatever else is on his mind
//   Chat       DeepSeek, with the whole log in front of it
//
// Clicking a person, firm or place anywhere opens the same side panel on it.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAidenData } from './useAidenData';
import type { AidenNav, ModalState, Selection } from './aiden-nav';
import { AidenTimeline, AidenPeople, AidenFirms, AidenPlaces } from './AidenLists';
import { AidenRounds } from './AidenRounds';
import { AidenGraph, type Layout } from './AidenGraph';
import { AidenActivity } from './AidenActivity';
import { AidenMind } from './AidenMind';
import { AidenChat } from './AidenChat';
import { AidenDetail } from './AidenDetail';
import { EventForm, FirmForm, LinkForm, PersonForm, PlaceForm, RoundForm } from './AidenForms';
import { btnGhost, btnPrimary } from './aiden-ui';

type Tab = 'timeline' | 'people' | 'firms' | 'places' | 'rounds' | 'views' | 'mind' | 'chat';
type View = Layout | 'activity';

const VIEWS: { id: View; label: string; hint: string }[] = [
  { id: 'free', label: 'Web', hint: 'Everything, and how it connects' },
  { id: 'map', label: 'Map', hint: 'The web where it sits on the earth' },
  { id: 'rings', label: 'Rings', hint: 'The web around you: the closer the ring, the warmer' },
  { id: 'clusters', label: 'Clusters', hint: 'The web gathered by firm or place; the lines between groups are the ones to watch' },
  { id: 'timeline', label: 'Timeline', hint: 'The web along time: who has gone quiet is on the left' },
  { id: 'activity', label: 'Activity', hint: 'Each person, and their touches as dots along the months' },
];

const VIEW_KEY = 'aiden.view';

function rememberedView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (VIEWS.some((x) => x.id === v)) return v as View;
  } catch { /* storage blocked: the default */ }
  return 'free';
}
type Gate = 'checking' | 'locked' | 'unconfigured' | 'open';

// ── The lock ──────────────────────────────────────────────────────────────────
function LockScreen({ gate, onOpen }: { gate: Gate; onOpen: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/aiden/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setPassword('');
        onOpen();
        return;
      }
      setError(res.status === 401 ? 'Incorrect password' : 'This section has no password set on the server');
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (gate === 'checking') {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8"
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-400">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-white">Aiden</h1>
          <p className="text-sm text-zinc-500">This section is private.</p>
        </div>
        {gate === 'unconfigured' ? (
          <p className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2.5 text-[12px] leading-relaxed text-amber-200">
            No password is set on this server. Add AIDEN_PASSWORD to its environment and restart it.
          </p>
        ) : (
          <>
            <input
              type="password"
              autoFocus
              autoComplete="off"
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
              {busy ? 'Checking...' : 'Unlock'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}

// ── The section ───────────────────────────────────────────────────────────────
export function AidenSection({ active }: { active: boolean }) {
  const [gate, setGate] = useState<Gate>('checking');
  const [tab, setTab] = useState<Tab>('timeline');
  const [view, setView] = useState<View>(rememberedView);
  function pickView(v: View) {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ }
  }
  const [selection, setSelection] = useState<Selection | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);

  const lock = useCallback(() => {
    setGate('locked');
    setSelection(null);
    setModal(null);
  }, []);

  const api = useAidenData(lock);
  const { reload, reset } = api;

  // Asked once, the first time the section is looked at.
  useEffect(() => {
    if (!active || gate !== 'checking') return;
    let gone = false;
    fetch('/api/aiden/unlock', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { configured?: boolean; unlocked?: boolean }) => {
        if (gone) return;
        setGate(!j.configured ? 'unconfigured' : j.unlocked ? 'open' : 'locked');
      })
      .catch(() => { if (!gone) setGate('locked'); });
    return () => { gone = true; };
  }, [active, gate]);

  useEffect(() => {
    if (gate === 'open') void reload();
    // Locked again: nothing of the log is left in the page.
    else if (gate === 'locked') reset();
  }, [gate, reload, reset]);

  async function lockNow() {
    try {
      await fetch('/api/aiden/unlock', { method: 'DELETE' });
    } finally {
      lock();
    }
  }

  const nav = useMemo<AidenNav>(() => ({ select: setSelection, open: setModal }), []);
  const closeModal = useCallback(() => setModal(null), []);

  const d = api.data;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'timeline', label: 'Timeline', count: d.events.length },
    { id: 'people', label: 'People', count: d.people.length },
    { id: 'firms', label: 'Firms', count: d.firms.length },
    { id: 'places', label: 'Places', count: d.places.length },
    { id: 'rounds', label: 'Shared rounds', count: d.rounds.length },
    { id: 'views', label: 'Views' },
    { id: 'mind', label: 'Goals & thoughts', count: d.goals.filter((x) => x.status === 'active').length + d.notes.length },
    { id: 'chat', label: 'Chat' },
  ];

  if (gate !== 'open') {
    return <LockScreen gate={gate} onOpen={() => setGate('open')} />;
  }

  // The web, the map, the board and the chat fill the window and scroll
  // inside themselves; the rest scroll as a page.
  const canvas = tab === 'views' && view !== 'activity';
  const fills = canvas || tab === 'chat';

  return (
    <div className="flex h-screen flex-col bg-[#0f0f0f]">
      <header className="shrink-0 border-b border-zinc-800 px-6 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-2 text-[15px] font-semibold text-white">Aiden</h1>
          <button type="button" onClick={() => setModal({ kind: 'event' })} className={btnPrimary}>+ Log event</button>
          <button type="button" onClick={() => setModal({ kind: 'person' })} className={btnGhost}>+ Person</button>
          <button type="button" onClick={() => setModal({ kind: 'firm' })} className={btnGhost}>+ Firm</button>
          <button type="button" onClick={() => setModal({ kind: 'place' })} className={btnGhost}>+ Place</button>
          <button type="button" onClick={() => setModal({ kind: 'round' })} className={btnGhost}>+ Round</button>
          <div className="ml-auto flex items-center gap-2">
            {api.loading && (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
            )}
            <button type="button" onClick={() => void lockNow()} title="Lock this section" className={btnGhost}>
              Lock
            </button>
          </div>
        </div>

        <nav className="-mb-px mt-3 flex gap-1 overflow-x-auto no-scrollbar">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`shrink-0 border-b-2 px-3 pb-2.5 pt-1 text-[12.5px] font-medium transition-colors ${
                tab === t.id
                  ? 'border-white text-white'
                  : 'border-transparent text-zinc-500 hover:text-zinc-200'
              }`}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className="ml-1.5 text-[10.5px] text-zinc-600">{t.count}</span>
              )}
            </button>
          ))}
        </nav>
      </header>

      {api.error && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-red-900/60 bg-red-950/30 px-6 py-2">
          <p className="text-[12px] text-red-300">{api.error}</p>
          <button type="button" onClick={api.clearError} className="text-[11px] text-red-300/70 hover:text-white">
            Dismiss
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div
          className={`vids-scroll absolute inset-0 px-6 py-5 ${fills ? 'overflow-hidden' : 'overflow-y-auto'} ${
            selection && !canvas ? 'xl:pr-[464px]' : ''
          }`}
        >
          {!api.loaded ? (
            <div className="flex h-full min-h-[200px] items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
            </div>
          ) : (
            <>
              {tab === 'timeline' && <AidenTimeline api={api} nav={nav} />}
              {tab === 'people' && <AidenPeople api={api} nav={nav} />}
              {tab === 'firms' && <AidenFirms api={api} nav={nav} />}
              {tab === 'places' && <AidenPlaces api={api} nav={nav} />}
              {tab === 'rounds' && <AidenRounds api={api} nav={nav} />}
              {tab === 'views' && (
                <div className="flex h-full min-h-0 flex-col gap-3">
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <div className="flex overflow-hidden rounded-md border border-zinc-800">
                      {VIEWS.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => pickView(v.id)}
                          title={v.hint}
                          className={`px-3 py-1.5 text-[12px] font-medium transition-colors ${
                            view === v.id ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-200'
                          }`}
                        >
                          {v.label}
                        </button>
                      ))}
                    </div>
                    <span className="text-[11px] text-zinc-600">{VIEWS.find((v) => v.id === view)?.hint}</span>
                  </div>
                  <div className={canvas ? 'min-h-0 flex-1' : ''}>
                    {view !== 'activity' && (
                      <AidenGraph api={api} nav={nav} selection={selection} active={active} layout={view} />
                    )}
                    {view === 'activity' && <AidenActivity api={api} nav={nav} />}
                  </div>
                </div>
              )}
              {tab === 'mind' && <AidenMind api={api} />}
              {/* Kept mounted behind the other tabs, so an answer on its way
                  still lands if he looks at the timeline while he waits. */}
              <div className={tab === 'chat' ? 'h-full' : 'hidden'}>
                <AidenChat api={api} active={active && tab === 'chat'} onLocked={lock} />
              </div>
            </>
          )}
        </div>

        {selection && api.loaded && <AidenDetail selection={selection} api={api} nav={nav} />}
      </div>

      {modal?.kind === 'person' && (
        <PersonForm
          api={api}
          initial={modal.initial}
          presetFirmId={modal.presetFirmId}
          presetPlaceId={modal.presetPlaceId}
          onClose={closeModal}
          onSaved={(id) => setSelection({ type: 'person', id })}
          onDeleted={() => setSelection(null)}
        />
      )}
      {modal?.kind === 'firm' && (
        <FirmForm
          api={api}
          initial={modal.initial}
          presetPlaceId={modal.presetPlaceId}
          onClose={closeModal}
          onSaved={(id) => setSelection({ type: 'firm', id })}
          onDeleted={() => setSelection(null)}
        />
      )}
      {modal?.kind === 'place' && (
        <PlaceForm
          api={api}
          initial={modal.initial}
          onClose={closeModal}
          onSaved={(id) => setSelection({ type: 'place', id })}
          onDeleted={() => setSelection(null)}
        />
      )}
      {modal?.kind === 'event' && (
        <EventForm
          api={api}
          initial={modal.initial}
          presetKind={modal.presetKind}
          presetPeople={modal.presetPeople}
          presetFirmId={modal.presetFirmId}
          presetPlaceId={modal.presetPlaceId}
          onClose={closeModal}
        />
      )}
      {modal?.kind === 'link' && (
        <LinkForm api={api} initial={modal.initial} fromId={modal.fromId} onClose={closeModal} />
      )}
      {modal?.kind === 'round' && (
        <RoundForm
          api={api}
          initial={modal.initial}
          presetFirmIds={modal.presetFirmIds}
          presetCompany={modal.presetCompany}
          onClose={closeModal}
        />
      )}
    </div>
  );
}
