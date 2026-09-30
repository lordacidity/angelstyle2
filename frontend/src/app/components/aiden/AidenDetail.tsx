'use client';

// The side panel: everything the log knows about one person, one firm or one
// place. It slides over the right edge of whatever view is open, so clicking a
// name anywhere (a card, a chip, a node on the spider) lands in the same place.
//
// For a person that is who they are, who they are tied to, and every event they
// were part of, in order.

import React, { useMemo } from 'react';
import {
  FIRM_KIND_LABEL, LINK_KIND_LABEL,
  type AidenEvent, type AidenFirm, type AidenPerson, type AidenPlace,
} from '@/lib/aiden-types';
import type { UseAidenData } from './useAidenData';
import type { AidenNav, Selection } from './aiden-nav';
import { EventCard } from './AidenEventCard';
import {
  Chip, FIRM_COLOR, LINK_COLOR, PLACE_COLOR, WARMTH_COLOR, ago, btnGhost, btnPrimary, href,
} from './aiden-ui';

function Section({ title, count, action, children }: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-zinc-800/80 px-5 py-4">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-500">
          {title}
          {count !== undefined && <span className="ml-1.5 text-zinc-700">{count}</span>}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const smallLink = 'text-[11px] font-medium text-zinc-500 transition-colors hover:text-white';

function PersonRow({ person, api, nav }: { person: AidenPerson; api: UseAidenData; nav: AidenNav }) {
  const firm = person.firmId ? api.index.firm.get(person.firmId) : undefined;
  const last = api.index.lastTouch.get(person.id);
  return (
    <button
      type="button"
      onClick={() => nav.select({ type: 'person', id: person.id })}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-zinc-900"
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: WARMTH_COLOR[person.warmth] }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] text-white">{person.name}</span>
        <span className="block truncate text-[11px] text-zinc-600">
          {[person.title, firm?.name].filter(Boolean).join(', ') || 'No title yet'}
        </span>
      </span>
      <span className="shrink-0 text-[10.5px] text-zinc-600">{last ? ago(last) : 'never'}</span>
    </button>
  );
}

function FirmRow({ firm, api, nav }: { firm: AidenFirm; api: UseAidenData; nav: AidenNav }) {
  const n = api.data.people.filter((p) => p.firmId === firm.id).length;
  return (
    <button
      type="button"
      onClick={() => nav.select({ type: 'firm', id: firm.id })}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-zinc-900"
    >
      <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: FIRM_COLOR }} />
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-white">{firm.name}</span>
      <span className="shrink-0 text-[10.5px] text-zinc-600">
        {FIRM_KIND_LABEL[firm.kind]}, {n} {n === 1 ? 'person' : 'people'}
      </span>
    </button>
  );
}

function Events({ events, api, nav, hidePersonId }: {
  events: AidenEvent[];
  api: UseAidenData;
  nav: AidenNav;
  hidePersonId?: string;
}) {
  if (!events.length) return <p className="text-[12px] text-zinc-600">Nothing logged yet.</p>;
  return (
    <div className="flex flex-col gap-2">
      {events.map((e) => <EventCard key={e.id} event={e} api={api} nav={nav} hidePersonId={hidePersonId} compact />)}
    </div>
  );
}

// ── Person ────────────────────────────────────────────────────────────────────
function PersonDetail({ person, api, nav }: { person: AidenPerson; api: UseAidenData; nav: AidenNav }) {
  const firm = person.firmId ? api.index.firm.get(person.firmId) : undefined;
  const place = person.placeId ? api.index.place.get(person.placeId) : undefined;
  const { index } = api;
  const events = useMemo(() => index.eventsOf.get(person.id) ?? [], [index, person.id]);
  const links = useMemo(() => index.linksOf.get(person.id) ?? [], [index, person.id]);
  const last = index.lastTouch.get(person.id);

  // Who else keeps turning up on the same events: the ties nobody has drawn yet.
  const seenWith = useMemo(() => {
    const tied = new Set(links.map((l) => (l.aId === person.id ? l.bId : l.aId)));
    const counts = new Map<string, number>();
    for (const e of events) {
      for (const ep of e.people) {
        if (ep.personId === person.id || tied.has(ep.personId)) continue;
        counts.set(ep.personId, (counts.get(ep.personId) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id, n]) => ({ person: index.person.get(id), n }))
      .filter((x): x is { person: AidenPerson; n: number } => Boolean(x.person));
  }, [index, events, links, person.id]);

  return (
    <>
      <div className="px-5 pb-4 pt-1">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: WARMTH_COLOR[person.warmth] }} />
          <h2 className="text-[18px] font-semibold leading-tight text-white">{person.name}</h2>
        </div>
        <p className="mt-1 text-[12.5px] text-zinc-400">
          {person.title || (firm ? '' : 'No title yet')}
          {person.title && firm && ' at '}
          {firm && (
            <button
              type="button"
              onClick={() => nav.select({ type: 'firm', id: firm.id })}
              className="font-medium text-blue-400 hover:underline"
            >
              {firm.name}
            </button>
          )}
        </p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <Chip color={WARMTH_COLOR[person.warmth]}>{person.warmth}</Chip>
          {place && (
            <Chip color={PLACE_COLOR} onClick={() => nav.select({ type: 'place', id: place.id })}>{place.name}</Chip>
          )}
          {person.tags.map((t) => <Chip key={t}>{t}</Chip>)}
        </div>
        <p className="mt-2.5 text-[11.5px] text-zinc-600">
          {events.length
            ? `${events.length} logged ${events.length === 1 ? 'touch' : 'touches'}, last ${ago(last)}`
            : 'Never contacted'}
        </p>

        {(person.email || person.linkedin || person.twitter) && (
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
            {person.email && (
              <a href={`mailto:${person.email}`} className="text-zinc-300 underline decoration-zinc-700 underline-offset-2 hover:text-white">
                {person.email}
              </a>
            )}
            {person.linkedin && (
              <a href={href(person.linkedin)} target="_blank" rel="noreferrer" className="text-zinc-300 underline decoration-zinc-700 underline-offset-2 hover:text-white">
                LinkedIn
              </a>
            )}
            {person.twitter && (
              <a
                href={/^https?:|\./i.test(person.twitter) ? href(person.twitter) : `https://x.com/${person.twitter.replace(/^@/, '')}`}
                target="_blank"
                rel="noreferrer"
                className="text-zinc-300 underline decoration-zinc-700 underline-offset-2 hover:text-white"
              >
                {person.twitter.startsWith('@') ? person.twitter : 'X'}
              </a>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => nav.open({
              kind: 'event', presetPeople: [person.id], presetFirmId: person.firmId, presetPlaceId: person.placeId,
            })}
            className={btnPrimary}
          >
            Log event
          </button>
          <button type="button" onClick={() => nav.open({ kind: 'link', fromId: person.id })} className={btnGhost}>
            Connect
          </button>
          <button type="button" onClick={() => nav.open({ kind: 'person', initial: person })} className={btnGhost}>
            Edit
          </button>
        </div>
      </div>

      <Section title="Bio">
        {person.bio
          ? <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-zinc-300">{person.bio}</p>
          : (
            <button type="button" onClick={() => nav.open({ kind: 'person', initial: person })} className={smallLink}>
              + Add a brief bio
            </button>
          )}
      </Section>

      <Section
        title="Ties"
        count={links.length}
        action={
          <button type="button" onClick={() => nav.open({ kind: 'link', fromId: person.id })} className={smallLink}>
            + Connect
          </button>
        }
      >
        {links.length === 0 && seenWith.length === 0 && (
          <p className="text-[12px] text-zinc-600">No ties drawn yet.</p>
        )}
        <div className="flex flex-col gap-0.5">
          {links.map((l) => {
            const other = api.index.person.get(l.aId === person.id ? l.bId : l.aId);
            if (!other) return null;
            const c = LINK_COLOR[l.kind];
            return (
              <div key={l.id} className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-zinc-900">
                <span className="w-[74px] shrink-0 text-[10.5px] font-medium" style={{ color: c }}>
                  {LINK_KIND_LABEL[l.kind]}
                </span>
                <button
                  type="button"
                  onClick={() => nav.select({ type: 'person', id: other.id })}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-[12.5px] text-white">{other.name}</span>
                  {l.note && <span className="block truncate text-[11px] text-zinc-600">{l.note}</span>}
                </button>
                <button
                  type="button"
                  onClick={() => nav.open({ kind: 'link', fromId: person.id, initial: l })}
                  className="text-[11px] text-zinc-600 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
                >
                  Edit
                </button>
              </div>
            );
          })}
        </div>
        {seenWith.length > 0 && (
          <div className="mt-3">
            <p className="mb-1.5 text-[10.5px] text-zinc-600">On the same events as</p>
            <div className="flex flex-wrap gap-1.5">
              {seenWith.map(({ person: p, n }) => (
                <Chip key={p.id} onClick={() => nav.select({ type: 'person', id: p.id })} title={`${n} shared`}>
                  {p.name}
                  {n > 1 && <span className="text-zinc-600">{n}</span>}
                </Chip>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section title="Events, newest first" count={events.length}>
        <Events events={events} api={api} nav={nav} hidePersonId={person.id} />
      </Section>
    </>
  );
}

// ── Firm ──────────────────────────────────────────────────────────────────────
function FirmDetail({ firm, api, nav }: { firm: AidenFirm; api: UseAidenData; nav: AidenNav }) {
  const place = firm.placeId ? api.index.place.get(firm.placeId) : undefined;
  const people = useMemo(
    () => api.data.people.filter((p) => p.firmId === firm.id),
    [api.data.people, firm.id],
  );
  // Filed under the firm, or with anyone who works there.
  const events = useMemo(() => {
    const staff = new Set(people.map((p) => p.id));
    return api.data.events
      .filter((e) => e.firmId === firm.id || e.people.some((ep) => staff.has(ep.personId)))
      .sort((a, b) => b.happenedAt.localeCompare(a.happenedAt));
  }, [api.data.events, firm.id, people]);

  return (
    <>
      <div className="px-5 pb-4 pt-1">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: FIRM_COLOR }} />
          <h2 className="text-[18px] font-semibold leading-tight text-white">{firm.name}</h2>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <Chip color={FIRM_COLOR}>{FIRM_KIND_LABEL[firm.kind]}</Chip>
          {place && (
            <Chip color={PLACE_COLOR} onClick={() => nav.select({ type: 'place', id: place.id })}>{place.name}</Chip>
          )}
        </div>
        {firm.website && (
          <a
            href={href(firm.website)}
            target="_blank"
            rel="noreferrer"
            className="mt-2.5 inline-block text-[12px] text-zinc-300 underline decoration-zinc-700 underline-offset-2 hover:text-white"
          >
            {firm.website.replace(/^https?:\/\//i, '')}
          </a>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => nav.open({ kind: 'event', presetFirmId: firm.id, presetPlaceId: firm.placeId })}
            className={btnPrimary}
          >
            Log event
          </button>
          <button
            type="button"
            onClick={() => nav.open({ kind: 'person', presetFirmId: firm.id, presetPlaceId: firm.placeId })}
            className={btnGhost}
          >
            Add person
          </button>
          <button type="button" onClick={() => nav.open({ kind: 'firm', initial: firm })} className={btnGhost}>
            Edit
          </button>
        </div>
      </div>

      <Section title="Notes">
        {firm.notes
          ? <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-zinc-300">{firm.notes}</p>
          : (
            <button type="button" onClick={() => nav.open({ kind: 'firm', initial: firm })} className={smallLink}>
              + Add notes
            </button>
          )}
      </Section>

      <Section
        title="People"
        count={people.length}
        action={
          <button type="button" onClick={() => nav.open({ kind: 'firm', initial: firm })} className={smallLink}>
            + Add people
          </button>
        }
      >
        {people.length === 0 && <p className="text-[12px] text-zinc-600">Nobody logged here yet.</p>}
        <div className="flex flex-col gap-0.5">
          {people.map((p) => <PersonRow key={p.id} person={p} api={api} nav={nav} />)}
        </div>
      </Section>

      <Section title="Events, newest first" count={events.length}>
        <Events events={events} api={api} nav={nav} />
      </Section>
    </>
  );
}

// ── Place ─────────────────────────────────────────────────────────────────────
function PlaceDetail({ place, api, nav }: { place: AidenPlace; api: UseAidenData; nav: AidenNav }) {
  const firms = api.data.firms.filter((f) => f.placeId === place.id);
  const people = api.data.people.filter((p) => p.placeId === place.id);
  const events = api.data.events
    .filter((e) => e.placeId === place.id)
    .sort((a, b) => b.happenedAt.localeCompare(a.happenedAt));

  return (
    <>
      <div className="px-5 pb-4 pt-1">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rotate-45" style={{ backgroundColor: PLACE_COLOR }} />
          <h2 className="text-[18px] font-semibold leading-tight text-white">{place.name}</h2>
        </div>
        {place.notes && (
          <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-zinc-400">{place.notes}</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => nav.open({ kind: 'event', presetPlaceId: place.id })} className={btnPrimary}>
            Log event
          </button>
          <button type="button" onClick={() => nav.open({ kind: 'person', presetPlaceId: place.id })} className={btnGhost}>
            Add person
          </button>
          <button type="button" onClick={() => nav.open({ kind: 'firm', presetPlaceId: place.id })} className={btnGhost}>
            Add firm
          </button>
          <button type="button" onClick={() => nav.open({ kind: 'place', initial: place })} className={btnGhost}>
            Edit
          </button>
        </div>
      </div>

      <Section title="Firms" count={firms.length}>
        {firms.length === 0 && <p className="text-[12px] text-zinc-600">No firms here yet.</p>}
        <div className="flex flex-col gap-0.5">
          {firms.map((f) => <FirmRow key={f.id} firm={f} api={api} nav={nav} />)}
        </div>
      </Section>

      <Section title="People" count={people.length}>
        {people.length === 0 && <p className="text-[12px] text-zinc-600">Nobody here yet.</p>}
        <div className="flex flex-col gap-0.5">
          {people.map((p) => <PersonRow key={p.id} person={p} api={api} nav={nav} />)}
        </div>
      </Section>

      <Section title="Events, newest first" count={events.length}>
        <Events events={events} api={api} nav={nav} />
      </Section>
    </>
  );
}

// ── The panel ─────────────────────────────────────────────────────────────────
export function AidenDetail({
  selection, api, nav,
}: {
  selection: Selection;
  api: UseAidenData;
  nav: AidenNav;
}) {
  const person = selection.type === 'person' ? api.index.person.get(selection.id) : undefined;
  const firm = selection.type === 'firm' ? api.index.firm.get(selection.id) : undefined;
  const place = selection.type === 'place' ? api.index.place.get(selection.id) : undefined;
  const found = person || firm || place;

  return (
    <aside className="vids-scroll absolute bottom-0 right-0 top-0 z-40 flex w-[440px] max-w-full flex-col overflow-y-auto border-l border-zinc-800 bg-[#101010] shadow-2xl">
      <div className="sticky top-0 z-10 flex items-center justify-between bg-[#101010]/95 px-5 py-3 backdrop-blur">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-600">
          {selection.type}
        </span>
        <button
          type="button"
          onClick={() => nav.select(null)}
          className="text-zinc-500 transition-colors hover:text-white"
          aria-label="Close"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {!found && <p className="px-5 py-6 text-[12px] text-zinc-600">This is no longer in the log.</p>}
      {person && <PersonDetail person={person} api={api} nav={nav} />}
      {firm && <FirmDetail firm={firm} api={api} nav={nav} />}
      {place && <PlaceDetail place={place} api={api} nav={nav} />}
    </aside>
  );
}
