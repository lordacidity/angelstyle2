'use client';

// The small parts every Aiden view is built from: the modal, the form fields,
// the chips, the colors each kind of thing is drawn in, and the dates.

import React, { useEffect, useState } from 'react';
import type { EventKind, LinkKind, Warmth } from '@/lib/aiden-types';

// ── Classes ───────────────────────────────────────────────────────────────────
export const inputCls =
  'w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-[13px] text-white ' +
  'placeholder-zinc-600 outline-none transition-colors focus:border-zinc-600';
export const textareaCls = `${inputCls} resize-y leading-relaxed`;
export const btnPrimary =
  'rounded-md bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-950 transition-colors ' +
  'hover:bg-zinc-200 disabled:opacity-40 disabled:hover:bg-white';
export const btnGhost =
  'rounded-md border border-zinc-800 px-3 py-1.5 text-[12px] font-medium text-zinc-300 ' +
  'transition-colors hover:border-zinc-700 hover:bg-zinc-900 hover:text-white disabled:opacity-40';
export const btnDanger =
  'rounded-md border border-zinc-800 px-3 py-1.5 text-[12px] font-medium text-zinc-500 ' +
  'transition-colors hover:border-red-900 hover:bg-red-950/40 hover:text-red-300';
export const cardCls = 'rounded-lg border border-zinc-800 bg-zinc-950/60';

// ── Colors ────────────────────────────────────────────────────────────────────
// Hex, because the spider view draws with them in SVG as well.
export const KIND_COLOR: Record<EventKind, string> = {
  email: '#60a5fa',
  linkedin: '#38bdf8',
  text: '#2dd4bf',
  call: '#818cf8',
  coffee: '#d4a373',
  meeting: '#fbbf24',
  event: '#c084fc',
  intro: '#f472b6',
  referral: '#fb923c',
  invested: '#22c55e', // the same green as INVESTED_COLOR below
  other: '#a1a1aa',
};

export const WARMTH_COLOR: Record<Warmth, string> = {
  cold: '#71717a',
  warm: '#f59e0b',
  hot: '#ef4444',
};

const WARMTH_RANK: Record<Warmth, number> = { cold: 0, warm: 1, hot: 2 };

/** The warmest of a group: one hot person among three cold ones makes it hot.
 *  Null for a group with nobody in it. */
export function warmest(people: { warmth: Warmth }[]): Warmth | null {
  let best: Warmth | null = null;
  for (const p of people) {
    if (best === null || WARMTH_RANK[p.warmth] > WARMTH_RANK[best]) best = p.warmth;
  }
  return best;
}

export const INVESTED_COLOR = '#22c55e';

/** The line along the top of a card: green for someone who has invested,
 *  otherwise the color of how warm they are. Having invested outranks hot. */
export function cardEdge(warmth: Warmth | null, invested: boolean): React.CSSProperties | undefined {
  const color = invested ? INVESTED_COLOR : warmth ? WARMTH_COLOR[warmth] : null;
  return color ? { borderTop: `2px solid ${color}` } : undefined;
}

export const LINK_COLOR: Record<LinkKind, string> = {
  friend: '#f472b6',
  mutual: '#a78bfa',
  colleague: '#60a5fa',
  introduced: '#34d399',
  referred: '#fb923c',
  partner: '#facc15',
  family: '#f87171',
  other: '#a1a1aa',
};

export const FIRM_COLOR = '#3b82f6';
export const PLACE_COLOR = '#10b981';
/** A round two firms shared: the line between them, and the round itself. */
export const ROUND_COLOR = '#a3e635';

// ── Dates ─────────────────────────────────────────────────────────────────────
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function fmtMonth(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** "today", "3 days ago", "2 months ago", or "in 4 days" for what is ahead. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(then)) / 86_400_000);
  const n = Math.abs(days);
  const span =
    n === 0 ? 'today'
    : n === 1 ? '1 day'
    : n < 45 ? `${n} days`
    : n < 365 ? `${Math.round(n / 30)} months`
    : `${(n / 365).toFixed(1).replace(/\.0$/, '')} years`;
  if (n === 0) return span;
  return days > 0 ? `${span} ago` : `in ${span}`;
}

/** Has this moment gone by. */
export function isPast(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t < Date.now();
}

/** An ISO moment as the value a <input type="date"> wants, in local time. */
export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A <input type="date"> value as an ISO moment: noon local, so the day it
 *  names is the same day in every timezone it is likely to be read in. */
export function fromDateInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(`${v}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function todayInput(): string {
  return toDateInput(new Date().toISOString());
}

/** A link someone typed without the scheme still opens. */
export function href(raw: string): string {
  const v = raw.trim();
  if (!v) return '';
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

// ── Parts ─────────────────────────────────────────────────────────────────────
export function Modal({
  title, onClose, children, wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-10 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} rounded-xl border border-zinc-800 bg-[#121212] shadow-2xl`}>
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <h2 className="text-[13px] font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-zinc-500 transition-colors hover:text-white" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Field({
  label, hint, children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-zinc-400">{label}</span>
        {hint && <span className="text-[10px] text-zinc-600">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function Chip({
  children, color, onClick, title,
}: {
  children: React.ReactNode;
  color?: string;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
}) {
  const style = color
    ? { color, borderColor: `${color}55`, backgroundColor: `${color}14` }
    : undefined;
  const cls =
    'inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[10.5px] font-medium ' +
    (color ? '' : 'border-zinc-800 bg-zinc-900 text-zinc-300 ') +
    (onClick ? 'cursor-pointer transition-opacity hover:opacity-75' : '');
  return onClick ? (
    <button type="button" onClick={onClick} title={title} className={cls} style={style}>{children}</button>
  ) : (
    <span title={title} className={cls} style={style}>{children}</span>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-800 px-6 py-14 text-center">
      <p className="text-[13px] font-medium text-zinc-300">{title}</p>
      <p className="max-w-sm text-[12px] leading-relaxed text-zinc-600">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Pick one of a list, or make a new one on the spot. Used for the firm and
 *  the place on every form, so logging something never means leaving the form
 *  to go and create the thing it points at. */
export function RefSelect({
  value, options, onChange, onCreate, none, noun,
}: {
  value: string | null;
  options: { id: string; name: string }[];
  onChange: (id: string | null) => void;
  onCreate: (name: string) => Promise<string | null>;
  none: string;
  noun: string;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    const n = name.trim();
    if (!n || busy) return;
    // Typing a name that is already there picks it instead of doubling it.
    const existing = options.find((o) => o.name.toLowerCase() === n.toLowerCase());
    if (existing) {
      onChange(existing.id);
      setAdding(false);
      setName('');
      return;
    }
    setBusy(true);
    const id = await onCreate(n);
    setBusy(false);
    if (id) {
      onChange(id);
      setAdding(false);
      setName('');
    }
  }

  if (adding) {
    return (
      <div className="flex gap-1.5">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void add(); }
            if (e.key === 'Escape') { e.stopPropagation(); setAdding(false); setName(''); }
          }}
          placeholder={`New ${noun}`}
          className={inputCls}
        />
        <button type="button" onClick={() => void add()} disabled={!name.trim() || busy} className={btnPrimary}>
          {busy ? '...' : 'Add'}
        </button>
        <button type="button" onClick={() => { setAdding(false); setName(''); }} className={btnGhost}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <select
      value={value ?? ''}
      onChange={(e) => {
        if (e.target.value === '__new') setAdding(true);
        else onChange(e.target.value || null);
      }}
      className={inputCls}
    >
      <option value="">{none}</option>
      {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      <option value="__new">+ New {noun}...</option>
    </select>
  );
}

export function SearchBox({
  value, onChange, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <svg
        width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${inputCls} w-56 pl-8`}
      />
    </div>
  );
}
