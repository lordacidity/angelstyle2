'use client';

// Goals, and everything else on his mind.
//
// Two columns. On the left, goals: what he is trying to get done, with a date
// if it has one, ticked off when it is. On the right, thoughts: loose notes,
// newest first, written down before they are gone. Both are read by the chat,
// so a suggestion can be aimed at what he is actually after.

import React, { useMemo, useState } from 'react';
import type { AidenGoal, AidenNote, GoalStatus } from '@/lib/aiden-types';
import type { UseAidenData } from './useAidenData';
import {
  ago, btnPrimary, cardCls, fmtDay, fromDateInput, inputCls, isPast, textareaCls, toDateInput,
} from './aiden-ui';

const RANK: Record<GoalStatus, number> = { active: 0, parked: 1, done: 2 };

const quiet = 'text-[11px] text-zinc-600 transition-colors hover:text-white';

// ── Goals ─────────────────────────────────────────────────────────────────────
function GoalRow({ goal, api }: { goal: AidenGoal; api: UseAidenData }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(goal.title);
  const [body, setBody] = useState(goal.body);
  const [due, setDue] = useState(toDateInput(goal.dueAt));

  const done = goal.status === 'done';
  const parked = goal.status === 'parked';
  const overdue = !done && !parked && isPast(goal.dueAt);

  function save() {
    const t = title.trim();
    if (!t) { setTitle(goal.title); return; }
    const dueAt = fromDateInput(due);
    if (t === goal.title && body.trim() === goal.body && toDateInput(goal.dueAt) === due) return;
    void api.update('goals', goal.id, { title: t, body, dueAt });
  }

  function expand() {
    // Opened fresh each time, from what is saved.
    setTitle(goal.title);
    setBody(goal.body);
    setDue(toDateInput(goal.dueAt));
    setOpen(true);
  }

  return (
    <div className={`${cardCls} px-3.5 py-3 ${done || parked ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          title={done ? 'Mark as not done' : 'Mark as done'}
          onClick={() => void api.update('goals', goal.id, { status: done ? 'active' : 'done' })}
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
            done ? 'border-emerald-500 bg-emerald-500 text-black' : 'border-zinc-600 hover:border-zinc-400'
          }`}
        >
          {done && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l5 5 9-10" />
            </svg>
          )}
        </button>

        <div className="min-w-0 flex-1">
          {open ? (
            <div className="flex flex-col gap-2">
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { save(); setOpen(false); } }}
                className={inputCls}
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                placeholder="Why it matters, how you will know it is done"
                className={textareaCls}
              />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                  className={`${inputCls} w-[150px] [color-scheme:dark]`}
                />
                <button type="button" onClick={() => { save(); setOpen(false); }} className={btnPrimary}>Save</button>
                <button type="button" onClick={() => setOpen(false)} className={quiet}>Cancel</button>
                <span className="ml-auto flex gap-3">
                  <button
                    type="button"
                    onClick={() => { void api.update('goals', goal.id, { status: parked ? 'active' : 'parked' }); setOpen(false); }}
                    className={quiet}
                  >
                    {parked ? 'Unpark' : 'Park'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { if (window.confirm('Delete this goal?')) void api.remove('goals', goal.id); }}
                    className="text-[11px] text-zinc-600 transition-colors hover:text-red-400"
                  >
                    Delete
                  </button>
                </span>
              </div>
            </div>
          ) : (
            <button type="button" onClick={expand} className="block w-full text-left">
              <p className={`text-[13px] font-medium leading-snug ${done ? 'text-zinc-400 line-through' : 'text-white'}`}>
                {goal.title}
              </p>
              {goal.body && (
                <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-zinc-500">{goal.body}</p>
              )}
              <p className="mt-1.5 flex flex-wrap gap-x-2 text-[10.5px] text-zinc-600">
                {parked && <span className="text-zinc-500">Parked</span>}
                {goal.dueAt && (
                  <span className={overdue ? 'text-red-400' : ''}>
                    Due {fmtDay(goal.dueAt)} ({ago(goal.dueAt)})
                  </span>
                )}
                {!goal.dueAt && !parked && <span>No date</span>}
              </p>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Goals({ api }: { api: UseAidenData }) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);

  const goals = useMemo(
    () =>
      [...api.data.goals].sort((a, b) => {
        if (RANK[a.status] !== RANK[b.status]) return RANK[a.status] - RANK[b.status];
        // Dated goals first, soonest at the top; then the newest.
        if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
        if (a.dueAt || b.dueAt) return a.dueAt ? -1 : 1;
        return b.createdAt.localeCompare(a.createdAt);
      }),
    [api.data.goals],
  );
  const open = goals.filter((x) => x.status === 'active').length;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    const id = await api.create('goals', { title: t, dueAt: fromDateInput(due) });
    setBusy(false);
    if (id) { setTitle(''); setDue(''); }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h2 className="text-[13px] font-semibold text-white">
        Goals <span className="ml-1 text-[11px] font-normal text-zinc-600">{open} open</span>
      </h2>
      <form onSubmit={add} className="flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Close the seed round, meet ten partners in SF..."
          className={inputCls}
        />
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          title="Due date, if it has one"
          className={`${inputCls} w-[150px] shrink-0 [color-scheme:dark]`}
        />
        <button type="submit" disabled={!title.trim() || busy} className={`${btnPrimary} shrink-0`}>Add</button>
      </form>
      {goals.length === 0 && (
        <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-8 text-center text-[12px] text-zinc-600">
          No goals yet. Write down what all this reaching out is for.
        </p>
      )}
      <div className="flex flex-col gap-2">
        {goals.map((x) => <GoalRow key={x.id} goal={x} api={api} />)}
      </div>
    </div>
  );
}

// ── Thoughts ──────────────────────────────────────────────────────────────────
function NoteCard({ note, api }: { note: AidenNote; api: UseAidenData }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);

  function expand() {
    setTitle(note.title);
    setBody(note.body);
    setOpen(true);
  }

  function save() {
    if (!title.trim() && !body.trim()) return;
    if (title.trim() !== note.title || body.trim() !== note.body) {
      void api.update('notes', note.id, { title, body });
    }
    setOpen(false);
  }

  if (open) {
    return (
      <div className={`${cardCls} flex flex-col gap-2 px-3.5 py-3`}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className={inputCls} />
        <textarea
          autoFocus
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={Math.min(16, Math.max(4, body.split('\n').length + 1))}
          className={textareaCls}
        />
        <div className="flex items-center gap-2">
          <button type="button" onClick={save} className={btnPrimary}>Save</button>
          <button type="button" onClick={() => setOpen(false)} className={quiet}>Cancel</button>
          <button
            type="button"
            onClick={() => { if (window.confirm('Delete this note?')) void api.remove('notes', note.id); }}
            className="ml-auto text-[11px] text-zinc-600 transition-colors hover:text-red-400"
          >
            Delete
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={expand}
      className={`${cardCls} block w-full px-3.5 py-3 text-left transition-colors hover:border-zinc-700`}
    >
      {note.title && <p className="text-[13px] font-medium leading-snug text-white">{note.title}</p>}
      {note.body && (
        <p className={`whitespace-pre-wrap text-[12.5px] leading-relaxed text-zinc-400 ${note.title ? 'mt-1' : ''}`}>
          {note.body}
        </p>
      )}
      <p className="mt-1.5 text-[10.5px] text-zinc-600">{fmtDay(note.updatedAt)}, {ago(note.updatedAt)}</p>
    </button>
  );
}

function Thoughts({ api }: { api: UseAidenData }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e?: React.FormEvent) {
    e?.preventDefault();
    if ((!title.trim() && !body.trim()) || busy) return;
    setBusy(true);
    const id = await api.create('notes', { title, body });
    setBusy(false);
    if (id) { setTitle(''); setBody(''); }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h2 className="text-[13px] font-semibold text-white">
        Thoughts <span className="ml-1 text-[11px] font-normal text-zinc-600">{api.data.notes.length}</span>
      </h2>
      <form onSubmit={add} className={`${cardCls} flex flex-col gap-2 px-3 py-3`}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void add(); }}
          rows={3}
          placeholder="Whatever you are thinking. Ideas, worries, things people said, angles to try."
          className={textareaCls}
        />
        <div className="flex gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className={inputCls} />
          <button type="submit" disabled={(!title.trim() && !body.trim()) || busy} className={`${btnPrimary} shrink-0`}>
            Save thought
          </button>
        </div>
      </form>
      {api.data.notes.length === 0 && (
        <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-8 text-center text-[12px] text-zinc-600">
          Nothing written down yet.
        </p>
      )}
      <div className="flex flex-col gap-2">
        {api.data.notes.map((n) => <NoteCard key={n.id} note={n} api={api} />)}
      </div>
    </div>
  );
}

export function AidenMind({ api }: { api: UseAidenData }) {
  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-8 lg:grid-cols-2">
      <Goals api={api} />
      <Thoughts api={api} />
    </div>
  );
}
