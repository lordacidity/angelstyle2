'use client';

// The four list views: the timeline of events, and the people, firms and
// places they involve. Each is a way into the same log; clicking anything opens
// the side panel on it.

import React, { useMemo, useState } from 'react';
import {
  EVENT_KINDS, EVENT_KIND_LABEL, FIRM_KIND_LABEL, WARMTHS,
  type AidenEvent, type AidenPerson, type EventKind, type Warmth,
} from '@/lib/aiden-types';
import type { UseAidenData } from './useAidenData';
import type { AidenNav } from './aiden-nav';
import { EventCard, FollowUpBadge } from './AidenEventCard';
import {
  Chip, Empty, FIRM_COLOR, KIND_COLOR, PLACE_COLOR, SearchBox, WARMTH_COLOR, ago, btnPrimary,
  cardCls, cardEdge, fmtMonth, inputCls, warmest,
} from './aiden-ui';

interface ViewProps {
  api: UseAidenData;
  nav: AidenNav;
}

const selectCls = `${inputCls} w-auto min-w-[120px] py-1.5 pr-7`;

// ── Timeline ──────────────────────────────────────────────────────────────────
export function AidenTimeline({ api, nav }: ViewProps) {
  const [q, setQ] = useState('');
  const [kinds, setKinds] = useState<Set<EventKind>>(new Set());

  const used = useMemo(() => {
    const s = new Set<EventKind>();
    for (const e of api.data.events) s.add(e.kind);
    return EVENT_KINDS.filter((k) => s.has(k));
  }, [api.data.events]);

  const due = useMemo(
    () =>
      api.data.events
        .filter((e) => e.followUpAt && !e.followUpDone)
        .sort((a, b) => (a.followUpAt ?? '').localeCompare(b.followUpAt ?? '')),
    [api.data.events],
  );

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hit = (e: AidenEvent) => {
      if (kinds.size && !kinds.has(e.kind)) return false;
      if (!needle) return true;
      const names = e.people.map((ep) => api.index.person.get(ep.personId)?.name ?? '').join(' ');
      const firm = e.firmId ? api.index.firm.get(e.firmId)?.name ?? '' : '';
      const place = e.placeId ? api.index.place.get(e.placeId)?.name ?? '' : '';
      return `${e.title} ${e.summary} ${names} ${firm} ${place}`.toLowerCase().includes(needle);
    };
    const sorted = api.data.events.filter(hit).sort((a, b) => b.happenedAt.localeCompare(a.happenedAt));
    const out: { month: string; events: AidenEvent[] }[] = [];
    for (const e of sorted) {
      const month = fmtMonth(e.happenedAt);
      const last = out[out.length - 1];
      if (last && last.month === month) last.events.push(e);
      else out.push({ month, events: [e] });
    }
    return out;
  }, [api.data.events, api.index, kinds, q]);

  if (!api.data.events.length) {
    return (
      <Empty
        title="Nothing logged yet"
        body="Every email, LinkedIn message, call, coffee and networking night goes in as an event, with the people it involved."
        action={<button onClick={() => nav.open({ kind: 'event' })} className={btnPrimary}>Log your first event</button>}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      {due.length > 0 && (
        <div className={`${cardCls} px-4 py-3`}>
          <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-500">
            Follow-ups owed <span className="text-zinc-700">{due.length}</span>
          </h3>
          <div className="flex flex-col gap-1">
            {due.map((e) => (
              <div
                key={e.id}
                role="button"
                tabIndex={0}
                onClick={() => nav.open({ kind: 'event', initial: e })}
                onKeyDown={(ev) => { if (ev.key === 'Enter') nav.open({ kind: 'event', initial: e }); }}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-zinc-900"
              >
                <FollowUpBadge event={e} api={api} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-zinc-200">
                  {e.title || e.summary}
                </span>
                <span className="shrink-0 truncate text-[11px] text-zinc-600">
                  {e.people.map((ep) => api.index.person.get(ep.personId)?.name).filter(Boolean).join(', ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Search events" />
        <div className="flex flex-wrap gap-1.5">
          {used.map((k) => {
            const on = kinds.has(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() =>
                  setKinds((prev) => {
                    const next = new Set(prev);
                    if (next.has(k)) next.delete(k); else next.add(k);
                    return next;
                  })
                }
                className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors"
                style={
                  on
                    ? { color: KIND_COLOR[k], borderColor: `${KIND_COLOR[k]}88`, backgroundColor: `${KIND_COLOR[k]}1a` }
                    : { color: '#71717a', borderColor: '#27272a' }
                }
              >
                {EVENT_KIND_LABEL[k]}
              </button>
            );
          })}
        </div>
      </div>

      {groups.length === 0 && <p className="py-8 text-center text-[12px] text-zinc-600">No events match.</p>}
      {groups.map((grp) => (
        <div key={grp.month}>
          <h3 className="mb-2 text-[11px] font-semibold text-zinc-500">
            {grp.month} <span className="text-zinc-700">{grp.events.length}</span>
          </h3>
          <div className="flex flex-col gap-2">
            {grp.events.map((e) => <EventCard key={e.id} event={e} api={api} nav={nav} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── People ────────────────────────────────────────────────────────────────────
type PeopleSort = 'recent' | 'stale' | 'touches' | 'name';

export function AidenPeople({ api, nav }: ViewProps) {
  const [q, setQ] = useState('');
  const [warmth, setWarmth] = useState<Warmth | ''>('');
  const [firmId, setFirmId] = useState('');
  const [placeId, setPlaceId] = useState('');
  const [sort, setSort] = useState<PeopleSort>('recent');

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const touches = (p: AidenPerson) => api.index.eventsOf.get(p.id)?.length ?? 0;
    const last = (p: AidenPerson) => api.index.lastTouch.get(p.id) ?? '';
    const out = api.data.people.filter((p) => {
      if (warmth && p.warmth !== warmth) return false;
      if (firmId && p.firmId !== firmId) return false;
      if (placeId && p.placeId !== placeId) return false;
      if (!needle) return true;
      const firm = p.firmId ? api.index.firm.get(p.firmId)?.name ?? '' : '';
      return `${p.name} ${p.title} ${firm} ${p.bio} ${p.tags.join(' ')}`.toLowerCase().includes(needle);
    });
    out.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'touches') return touches(b) - touches(a) || a.name.localeCompare(b.name);
      // Never-contacted people have no date: last when sorting by recent,
      // first when looking for who has gone quiet.
      const la = last(a);
      const lb = last(b);
      if (sort === 'stale') {
        if (!la || !lb) return la ? 1 : lb ? -1 : a.name.localeCompare(b.name);
        return la.localeCompare(lb);
      }
      if (!la || !lb) return la ? -1 : lb ? 1 : a.name.localeCompare(b.name);
      return lb.localeCompare(la);
    });
    return out;
  }, [api.data.people, api.index, firmId, placeId, q, sort, warmth]);

  if (!api.data.people.length) {
    return (
      <Empty
        title="No people yet"
        body="Add the VCs, founders and friends you want to keep track of. They don't need an event to exist."
        action={<button onClick={() => nav.open({ kind: 'person' })} className={btnPrimary}>Add a person</button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Search people" />
        <select value={warmth} onChange={(e) => setWarmth(e.target.value as Warmth | '')} className={selectCls}>
          <option value="">Any warmth</option>
          {WARMTHS.map((w) => <option key={w} value={w}>{w[0].toUpperCase() + w.slice(1)}</option>)}
        </select>
        <select value={firmId} onChange={(e) => setFirmId(e.target.value)} className={selectCls}>
          <option value="">Any firm</option>
          {api.data.firms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select value={placeId} onChange={(e) => setPlaceId(e.target.value)} className={selectCls}>
          <option value="">Any place</option>
          {api.data.places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as PeopleSort)} className={`${selectCls} ml-auto`}>
          <option value="recent">Recently touched</option>
          <option value="stale">Gone quiet</option>
          <option value="touches">Most touches</option>
          <option value="name">Name</option>
        </select>
      </div>

      {list.length === 0 && <p className="py-8 text-center text-[12px] text-zinc-600">Nobody matches.</p>}
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {list.map((p) => {
          const firm = p.firmId ? api.index.firm.get(p.firmId) : undefined;
          const place = p.placeId ? api.index.place.get(p.placeId) : undefined;
          const n = api.index.eventsOf.get(p.id)?.length ?? 0;
          const ties = api.index.linksOf.get(p.id)?.length ?? 0;
          const last = api.index.lastTouch.get(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => nav.select({ type: 'person', id: p.id })}
              className={`${cardCls} flex flex-col gap-2 px-3.5 py-3 text-left transition-colors hover:border-zinc-700`}
              title={api.index.invested.has(p.id) ? 'Invested' : undefined}
              style={cardEdge(p.warmth, api.index.invested.has(p.id))}
            >
              <div className="flex items-start gap-2">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: WARMTH_COLOR[p.warmth] }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-white">{p.name}</p>
                  <p className="truncate text-[11.5px] text-zinc-500">
                    {[p.title, firm?.name].filter(Boolean).join(', ') || 'No title yet'}
                  </p>
                </div>
                <span className="shrink-0 text-[10.5px] text-zinc-600">{last ? ago(last) : 'never'}</span>
              </div>
              {p.bio && <p className="line-clamp-2 text-[11.5px] leading-relaxed text-zinc-500">{p.bio}</p>}
              <div className="flex flex-wrap items-center gap-1.5">
                {place && <Chip color={PLACE_COLOR}>{place.name}</Chip>}
                {p.tags.slice(0, 3).map((t) => <Chip key={t}>{t}</Chip>)}
                <span className="ml-auto text-[10.5px] text-zinc-600">
                  {n} {n === 1 ? 'event' : 'events'}{ties ? `, ${ties} ${ties === 1 ? 'tie' : 'ties'}` : ''}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Firms ─────────────────────────────────────────────────────────────────────
export function AidenFirms({ api, nav }: ViewProps) {
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return api.data.firms
      .filter((f) => !needle || `${f.name} ${f.notes} ${FIRM_KIND_LABEL[f.kind]}`.toLowerCase().includes(needle))
      .map((f) => {
        const people = api.data.people.filter((p) => p.firmId === f.id);
        const staff = new Set(people.map((p) => p.id));
        let last = '';
        let events = 0;
        for (const e of api.data.events) {
          if (e.firmId !== f.id && !e.people.some((ep) => staff.has(ep.personId))) continue;
          events += 1;
          if (e.happenedAt > last) last = e.happenedAt;
        }
        return { firm: f, people, events, last };
      });
  }, [api.data.events, api.data.firms, api.data.people, q]);

  if (!api.data.firms.length) {
    return (
      <Empty
        title="No firms yet"
        body="Add the funds and companies you are working on. People get filed under them."
        action={<button onClick={() => nav.open({ kind: 'firm' })} className={btnPrimary}>Add a firm</button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SearchBox value={q} onChange={setQ} placeholder="Search firms" />
      {rows.length === 0 && <p className="py-8 text-center text-[12px] text-zinc-600">No firms match.</p>}
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {rows.map(({ firm, people, events, last }) => {
          const place = firm.placeId ? api.index.place.get(firm.placeId) : undefined;
          // A firm is as warm as the warmest person known there, and green
          // once it, or anyone in it, has invested.
          const warmth = warmest(people);
          const invested = api.index.investedFirms.has(firm.id);
          return (
            <button
              key={firm.id}
              type="button"
              onClick={() => nav.select({ type: 'firm', id: firm.id })}
              title={invested ? 'Invested' : warmth ? `Warmest contact here is ${warmth}` : undefined}
              className={`${cardCls} flex flex-col gap-2 px-3.5 py-3 text-left transition-colors hover:border-zinc-700`}
              style={cardEdge(warmth, invested)}
            >
              <div className="flex items-start gap-2">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: FIRM_COLOR }} />
                <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-white">{firm.name}</p>
                <span className="shrink-0 text-[10.5px] text-zinc-600">{last ? ago(last) : 'never'}</span>
              </div>
              <p className="truncate text-[11.5px] text-zinc-500">
                {people.length ? people.map((p) => p.name).join(', ') : 'Nobody logged here yet'}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip color={FIRM_COLOR}>{FIRM_KIND_LABEL[firm.kind]}</Chip>
                {place && <Chip color={PLACE_COLOR}>{place.name}</Chip>}
                <span className="ml-auto text-[10.5px] text-zinc-600">
                  {people.length} {people.length === 1 ? 'person' : 'people'}, {events} {events === 1 ? 'event' : 'events'}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Places ────────────────────────────────────────────────────────────────────
export function AidenPlaces({ api, nav }: ViewProps) {
  if (!api.data.places.length) {
    return (
      <Empty
        title="No places yet"
        body="SF, Austin, NYC. People and firms sit in a place, and an event can happen in one."
        action={<button onClick={() => nav.open({ kind: 'place' })} className={btnPrimary}>Add a place</button>}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {api.data.places.map((place) => {
        const firms = api.data.firms.filter((f) => f.placeId === place.id);
        const people = api.data.people.filter((p) => p.placeId === place.id);
        const events = api.data.events.filter((e) => e.placeId === place.id).length;
        return (
          <button
            key={place.id}
            type="button"
            onClick={() => nav.select({ type: 'place', id: place.id })}
            className={`${cardCls} flex flex-col gap-2 px-3.5 py-3 text-left transition-colors hover:border-zinc-700`}
          >
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rotate-45" style={{ backgroundColor: PLACE_COLOR }} />
              <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-white">{place.name}</p>
            </div>
            <p className="truncate text-[11.5px] text-zinc-500">
              {[...firms.map((f) => f.name), ...people.map((p) => p.name)].slice(0, 6).join(', ') || 'Nothing here yet'}
            </p>
            <span className="text-[10.5px] text-zinc-600">
              {people.length} {people.length === 1 ? 'person' : 'people'}, {firms.length} {firms.length === 1 ? 'firm' : 'firms'}, {events} {events === 1 ? 'event' : 'events'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
