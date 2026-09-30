'use client';

// One event, as it is drawn everywhere an event appears: the timeline, and the
// side panel of every person, firm and place it touched.

import React from 'react';
import { EVENT_KIND_LABEL, EVENT_ROLE_LABEL, type AidenEvent } from '@/lib/aiden-types';
import type { UseAidenData } from './useAidenData';
import type { AidenNav } from './aiden-nav';
import { Chip, FIRM_COLOR, KIND_COLOR, PLACE_COLOR, ago, fmtDay, isPast } from './aiden-ui';

export function FollowUpBadge({ event, api }: { event: AidenEvent; api: UseAidenData }) {
  if (!event.followUpAt) return null;
  const overdue = !event.followUpDone && isPast(event.followUpAt);
  const color = event.followUpDone ? '#52525b' : overdue ? '#f87171' : '#fbbf24';
  return (
    <button
      type="button"
      title={event.followUpDone ? 'Mark as not followed up' : 'Mark as followed up'}
      onClick={(e) => {
        e.stopPropagation();
        void api.update('events', event.id, { followUpDone: !event.followUpDone });
      }}
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition-opacity hover:opacity-75"
      style={{ color, borderColor: `${color}55`, backgroundColor: `${color}14` }}
    >
      <span
        className="flex h-2.5 w-2.5 items-center justify-center rounded-[3px] border"
        style={{ borderColor: color, backgroundColor: event.followUpDone ? color : 'transparent' }}
      />
      {event.followUpDone
        ? 'Followed up'
        : `Follow up ${fmtDay(event.followUpAt)} (${overdue ? 'overdue' : ago(event.followUpAt)})`}
    </button>
  );
}

export function EventCard({
  event, api, nav, hidePersonId, compact,
}: {
  event: AidenEvent;
  api: UseAidenData;
  nav: AidenNav;
  /** On a person's own panel their name on every card is noise. */
  hidePersonId?: string;
  compact?: boolean;
}) {
  const color = KIND_COLOR[event.kind] ?? KIND_COLOR.other;
  const firm = event.firmId ? api.index.firm.get(event.firmId) : undefined;
  const place = event.placeId ? api.index.place.get(event.placeId) : undefined;
  const people = event.people.filter((p) => p.personId !== hidePersonId);
  const mine = hidePersonId ? event.people.find((p) => p.personId === hidePersonId) : undefined;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => nav.open({ kind: 'event', initial: event })}
      onKeyDown={(e) => { if (e.key === 'Enter') nav.open({ kind: 'event', initial: event }); }}
      className="group cursor-pointer rounded-lg border border-zinc-800 bg-zinc-950/60 px-3.5 py-3 transition-colors hover:border-zinc-700"
      style={{ borderLeft: `2px solid ${color}` }}
    >
      <div className="flex items-center gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-wide" style={{ color }}>
          {EVENT_KIND_LABEL[event.kind] ?? event.kind}
        </span>
        {mine && (
          <span className="text-[10.5px] text-zinc-600">
            {(EVENT_ROLE_LABEL[mine.role] ?? mine.role).toLowerCase()}
          </span>
        )}
        <span className="ml-auto shrink-0 text-[11px] text-zinc-500" title={ago(event.happenedAt)}>
          {fmtDay(event.happenedAt)}
        </span>
      </div>

      {event.title && <p className="mt-1 text-[13px] font-medium leading-snug text-white">{event.title}</p>}
      {event.summary && (
        <p className={`mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-zinc-400 ${compact ? 'line-clamp-3' : ''}`}>
          {event.summary}
        </p>
      )}

      {(people.length > 0 || firm || place || event.followUpAt) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {people.map((ep) => {
            const p = api.index.person.get(ep.personId);
            if (!p) return null;
            return (
              <Chip
                key={ep.personId}
                title={EVENT_ROLE_LABEL[ep.role] ?? ep.role}
                onClick={(e) => { e.stopPropagation(); nav.select({ type: 'person', id: p.id }); }}
              >
                {ep.role === 'host' && <span className="text-zinc-500">host</span>}
                {p.name}
              </Chip>
            );
          })}
          {firm && (
            <Chip color={FIRM_COLOR} onClick={(e) => { e.stopPropagation(); nav.select({ type: 'firm', id: firm.id }); }}>
              {firm.name}
            </Chip>
          )}
          {place && (
            <Chip color={PLACE_COLOR} onClick={(e) => { e.stopPropagation(); nav.select({ type: 'place', id: place.id }); }}>
              {place.name}
            </Chip>
          )}
          <FollowUpBadge event={event} api={api} />
        </div>
      )}
    </div>
  );
}
