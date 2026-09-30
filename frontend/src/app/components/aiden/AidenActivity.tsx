'use client';

// Activity: one row per person, their touches as dots along a time axis. Who
// is being talked to, how often, and who has gone quiet, all in one look.
// Hollow dots are follow-ups still owed; a red one is overdue.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { EVENT_KIND_LABEL, type AidenEvent, type AidenPerson } from '@/lib/aiden-types';
import type { UseAidenData } from './useAidenData';
import type { AidenNav } from './aiden-nav';
import {
  Empty, INVESTED_COLOR, KIND_COLOR, SearchBox, WARMTH_COLOR, ago, btnPrimary, fmtDay, inputCls,
} from './aiden-ui';

type Range = '3m' | '6m' | '1y' | 'all';
type Order = 'recent' | 'quiet';

const DAYS: Record<Exclude<Range, 'all'>, number> = { '3m': 91, '6m': 182, '1y': 365 };
const DAY = 86_400_000;
const ROW = 26;
const LABEL_W = 210;
const AXIS_H = 28;
const PAD_R = 24;
const AHEAD_DAYS = 21;

interface Row {
  person: AidenPerson;
  events: AidenEvent[];
  last: string | undefined;
}

export function AidenActivity({ api, nav }: { api: UseAidenData; nav: AidenNav }) {
  const [range, setRange] = useState<Range>('6m');
  const [order, setOrder] = useState<Order>('recent');
  const [q, setQ] = useState('');
  const [width, setWidth] = useState(0);
  const [hoverRow, setHoverRow] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; title: string; sub: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The clock, read once when the view opens rather than on every render.
  const [now] = useState(() => Date.now());
  const end = now + AHEAD_DAYS * DAY;

  const rows = useMemo<Row[]>(() => {
    const needle = q.trim().toLowerCase();
    const list: Row[] = [];
    for (const p of api.data.people) {
      const events = api.index.eventsOf.get(p.id) ?? [];
      if (!events.length) continue;
      if (needle) {
        const firm = p.firmId ? api.index.firm.get(p.firmId)?.name ?? '' : '';
        if (!`${p.name} ${p.title} ${firm}`.toLowerCase().includes(needle)) continue;
      }
      list.push({ person: p, events, last: api.index.lastTouch.get(p.id) });
    }
    list.sort((a, b) => {
      const la = a.last ?? '';
      const lb = b.last ?? '';
      return order === 'recent' ? lb.localeCompare(la) : la.localeCompare(lb);
    });
    return list;
  }, [api.data.people, api.index, order, q]);

  const start = useMemo(() => {
    if (range !== 'all') return now - DAYS[range] * DAY;
    let earliest = now;
    for (const e of api.data.events) {
      const t = new Date(e.happenedAt).getTime();
      if (t < earliest) earliest = t;
    }
    return Math.min(earliest, now - 30 * DAY);
  }, [api.data.events, now, range]);

  const plotW = Math.max(0, width - LABEL_W - PAD_R);
  const x = (t: number) => LABEL_W + ((t - start) / (end - start)) * plotW;

  // A tick at the first of each month across the range.
  const ticks = useMemo(() => {
    const out: { t: number; label: string }[] = [];
    const d = new Date(start);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    d.setMonth(d.getMonth() + 1);
    const monthsShown = (end - start) / (30 * DAY);
    const step = monthsShown > 30 ? 6 : monthsShown > 14 ? 3 : 1;
    while (d.getTime() < end) {
      if (d.getMonth() % step === 0) {
        const label = d.toLocaleDateString(undefined, {
          month: 'short', ...(d.getMonth() === 0 || step > 1 ? { year: '2-digit' } : {}),
        });
        out.push({ t: d.getTime(), label });
      }
      d.setMonth(d.getMonth() + 1);
    }
    return out;
  }, [end, start]);

  const never = api.data.people.length - api.data.people.filter((p) => api.index.eventsOf.has(p.id)).length;

  if (!api.data.events.length) {
    return (
      <Empty
        title="Nothing logged yet"
        body="Once there are events, this draws every person as a row and each touch as a dot along the months."
        action={<button onClick={() => nav.open({ kind: 'event' })} className={btnPrimary}>Log an event</button>}
      />
    );
  }

  const height = AXIS_H + rows.length * ROW + 8;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Search people" />
        <div className="flex overflow-hidden rounded-md border border-zinc-800">
          {(['3m', '6m', '1y', 'all'] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`px-2.5 py-1.5 text-[11.5px] font-medium transition-colors ${
                range === r ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-200'
              }`}
            >
              {r === 'all' ? 'All' : r}
            </button>
          ))}
        </div>
        <select value={order} onChange={(e) => setOrder(e.target.value as Order)} className={`${inputCls} w-auto min-w-[150px] py-1.5 pr-7`}>
          <option value="recent">Recently touched first</option>
          <option value="quiet">Quietest first</option>
        </select>
        <span className="ml-auto text-[11px] text-zinc-600">
          {rows.length} {rows.length === 1 ? 'person' : 'people'} with events
          {never > 0 && `, ${never} never contacted`}
        </span>
      </div>

      <div ref={box} className="relative w-full overflow-hidden rounded-lg border border-zinc-800 bg-[#0b0b0b]">
        {width > 0 && (
          <svg width={width} height={height} className="block select-none">
            {/* the months */}
            {ticks.map((tk) => (
              <g key={tk.t}>
                <line x1={x(tk.t)} x2={x(tk.t)} y1={AXIS_H - 6} y2={height} stroke="#27272a" strokeWidth={1} />
                <text x={x(tk.t) + 4} y={AXIS_H - 12} fontSize={10} fill="#71717a">{tk.label}</text>
              </g>
            ))}
            {/* today */}
            <line x1={x(now)} x2={x(now)} y1={AXIS_H - 6} y2={height} stroke="#e4e4e7" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
            <text x={x(now) + 4} y={AXIS_H - 12} fontSize={10} fill="#e4e4e7" opacity={0.7}>today</text>

            {rows.map((row, i) => {
              const y = AXIS_H + i * ROW + ROW / 2;
              const p = row.person;
              const firm = p.firmId ? api.index.firm.get(p.firmId)?.name : '';
              const invested = api.index.invested.has(p.id);
              const lit = hoverRow === p.id;
              return (
                <g key={p.id} onPointerEnter={() => setHoverRow(p.id)} onPointerLeave={() => setHoverRow((h) => (h === p.id ? null : h))}>
                  {lit && <rect x={0} y={y - ROW / 2} width={width} height={ROW} fill="#ffffff" opacity={0.04} />}
                  <line x1={LABEL_W} x2={width - PAD_R} y1={y} y2={y} stroke="#1f1f23" strokeWidth={1} />

                  <g className="cursor-pointer" onClick={() => nav.select({ type: 'person', id: p.id })}>
                    <rect x={0} y={y - ROW / 2} width={LABEL_W} height={ROW} fill="transparent" />
                    <circle cx={12} cy={y} r={3.5} fill={invested ? INVESTED_COLOR : WARMTH_COLOR[p.warmth]} />
                    <text x={22} y={y + 3.5} fontSize={11.5} fill={lit ? '#ffffff' : '#d4d4d8'} fontWeight={500}>
                      {p.name.length > 20 ? `${p.name.slice(0, 19)}...` : p.name}
                    </text>
                    <text x={LABEL_W - 8} y={y + 3.5} fontSize={9.5} fill="#52525b" textAnchor="end">
                      {row.last ? ago(row.last) : ''}
                    </text>
                    {firm && <title>{[p.title, firm].filter(Boolean).join(' at ')}</title>}
                  </g>

                  {row.events.map((e) => {
                    const t = new Date(e.happenedAt).getTime();
                    const inRange = t >= start && t <= end;
                    const fu = e.followUpAt && !e.followUpDone ? new Date(e.followUpAt).getTime() : null;
                    const fuIn = fu !== null && fu >= start && fu <= end;
                    if (!inRange && !fuIn) return null;
                    const color = KIND_COLOR[e.kind] ?? KIND_COLOR.other;
                    return (
                      <g key={e.id}>
                        {inRange && (
                          <circle
                            cx={x(t)} cy={y} r={4.5} fill={color} stroke="#0b0b0b" strokeWidth={1}
                            className="cursor-pointer"
                            onClick={() => nav.open({ kind: 'event', initial: e })}
                            onPointerEnter={() => setTip({
                              x: x(t), y: y - ROW / 2, title: e.title || EVENT_KIND_LABEL[e.kind],
                              sub: `${EVENT_KIND_LABEL[e.kind]}, ${fmtDay(e.happenedAt)}`,
                            })}
                            onPointerLeave={() => setTip(null)}
                          />
                        )}
                        {fuIn && (
                          <circle
                            cx={x(fu!)} cy={y} r={4.5} fill="#0b0b0b" stroke={fu! < now ? '#f87171' : '#fbbf24'} strokeWidth={1.5}
                            className="cursor-pointer"
                            onClick={() => nav.open({ kind: 'event', initial: e })}
                            onPointerEnter={() => setTip({
                              x: x(fu!), y: y - ROW / 2, title: `Follow up: ${e.title || EVENT_KIND_LABEL[e.kind]}`,
                              sub: `${fmtDay(e.followUpAt)}${fu! < now ? ', overdue' : `, ${ago(e.followUpAt)}`}`,
                            })}
                            onPointerLeave={() => setTip(null)}
                          />
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        )}

        {tip && (
          <div
            className="pointer-events-none absolute z-10 max-w-[260px] rounded-md border border-zinc-800 bg-[#161616]/95 px-2.5 py-1.5 shadow-xl backdrop-blur"
            style={{ left: Math.min(Math.max(8, tip.x + 10), Math.max(8, width - 270)), top: Math.max(4, tip.y - 44) }}
          >
            <p className="truncate text-[12px] font-medium text-white">{tip.title}</p>
            <p className="text-[10.5px] leading-snug text-zinc-500">{tip.sub}</p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-zinc-500">
        {(Object.keys(KIND_COLOR) as (keyof typeof KIND_COLOR)[]).map((k) => (
          <span key={k} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: KIND_COLOR[k] }} />
            {EVENT_KIND_LABEL[k]}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full border border-amber-400" />
          follow-up owed
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full border border-red-400" />
          overdue
        </span>
      </div>
    </div>
  );
}
