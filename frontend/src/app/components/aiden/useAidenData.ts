'use client';

// useAidenData — the Aiden section's one line to the server.
//
// The log is read whole (/api/aiden/data) and every write is followed by a
// fresh read, so the page never has to reason about what a change touched: a
// deleted firm un-files its people, a deleted person drops out of their events,
// and the next snapshot simply says so. It is one person's network; the whole
// thing is a few kilobytes.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AidenEntity, AidenEvent, AidenFirm, AidenIngestResult, AidenLink, AidenPerson, AidenPlace, AidenRound,
  AidenSnapshot,
} from '@/lib/aiden-types';
import { coInvestors, newestRoundFirst } from '@/lib/aiden-rounds';

const EMPTY: AidenSnapshot = {
  places: [], firms: [], people: [], events: [], links: [], rounds: [], goals: [], notes: [],
};

/** Thrown by any call the server answered with 401: the lock is back on. */
export class AidenLockedError extends Error {}

export async function aidenFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (res.status === 401) throw new AidenLockedError('locked');
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
  return json as T;
}

export interface AidenIndex {
  place: Map<string, AidenPlace>;
  firm: Map<string, AidenFirm>;
  person: Map<string, AidenPerson>;
  /** Each person's events, newest first. */
  eventsOf: Map<string, AidenEvent[]>;
  /** Each person's ties to other people. */
  linksOf: Map<string, AidenLink[]>;
  /** When each person was last touched (ISO), if ever. */
  lastTouch: Map<string, string>;
  /** People who have invested: on an Invested event as anything but a bystander. */
  invested: Set<string>;
  /** Firms that have invested: an Invested event is filed under them, or one
   *  of their people is an investor. */
  investedFirms: Set<string>;
  /** Each firm's rounds, newest first. */
  roundsOf: Map<string, AidenRound[]>;
  /** Each firm's co-investors: the firms it has shared a round with, and the
   *  rounds they shared. */
  sharedWith: Map<string, Map<string, AidenRound[]>>;
}

export interface UseAidenData {
  data: AidenSnapshot;
  index: AidenIndex;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  clearError: () => void;
  reload: () => Promise<void>;
  /** Forgets everything read so far. For when the lock goes back on. */
  reset: () => void;
  /** Adds a row and returns its id, or null if it could not be saved. */
  create: (entity: AidenEntity, body: Record<string, unknown>) => Promise<string | null>;
  update: (entity: AidenEntity, id: string, body: Record<string, unknown>) => Promise<boolean>;
  remove: (entity: AidenEntity, id: string) => Promise<boolean>;
  /** Writes a batch in one go, by name, all or nothing (the ingest route).
   *  Answers with what it wrote, or null if it could not be saved. */
  ingest: (batch: Record<string, unknown>) => Promise<AidenIngestResult | null>;
}

export function useAidenData(onLocked: () => void): UseAidenData {
  const [data, setData] = useState<AidenSnapshot>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only the newest read is allowed to land, so a slow one can't undo a fast one.
  const reads = useRef(0);
  const lockedRef = useRef(onLocked);
  useEffect(() => { lockedRef.current = onLocked; }, [onLocked]);

  const fail = useCallback((e: unknown, fallback: string) => {
    if (e instanceof AidenLockedError) {
      lockedRef.current();
      return;
    }
    setError(e instanceof Error ? e.message : fallback);
  }, []);

  const reload = useCallback(async () => {
    const mine = ++reads.current;
    setLoading(true);
    try {
      const snap = await aidenFetch<AidenSnapshot>('/api/aiden/data');
      if (mine !== reads.current) return;
      setData(snap);
      setLoaded(true);
    } catch (e) {
      if (mine === reads.current) fail(e, 'Failed to load');
    } finally {
      if (mine === reads.current) setLoading(false);
    }
  }, [fail]);

  const reset = useCallback(() => {
    reads.current += 1;
    setData(EMPTY);
    setLoaded(false);
    setLoading(false);
    setError(null);
  }, []);

  const create = useCallback<UseAidenData['create']>(async (entity, body) => {
    try {
      const { id } = await aidenFetch<{ id: string }>(`/api/aiden/${entity}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      await reload();
      return id;
    } catch (e) {
      fail(e, 'Failed to save');
      return null;
    }
  }, [fail, reload]);

  const update = useCallback<UseAidenData['update']>(async (entity, id, body) => {
    try {
      await aidenFetch(`/api/aiden/${entity}/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      await reload();
      return true;
    } catch (e) {
      fail(e, 'Failed to save');
      return false;
    }
  }, [fail, reload]);

  const remove = useCallback<UseAidenData['remove']>(async (entity, id) => {
    try {
      await aidenFetch(`/api/aiden/${entity}/${id}`, { method: 'DELETE' });
      await reload();
      return true;
    } catch (e) {
      fail(e, 'Failed to delete');
      return false;
    }
  }, [fail, reload]);

  const ingest = useCallback<UseAidenData['ingest']>(async (batch) => {
    try {
      const result = await aidenFetch<AidenIngestResult>('/api/aiden/ingest', {
        method: 'POST',
        body: JSON.stringify(batch),
      });
      await reload();
      return result;
    } catch (e) {
      fail(e, 'Failed to save');
      return null;
    }
  }, [fail, reload]);

  const index = useMemo<AidenIndex>(() => {
    const eventsOf = new Map<string, AidenEvent[]>();
    const lastTouch = new Map<string, string>();
    const newestFirst = [...data.events].sort((a, b) => b.happenedAt.localeCompare(a.happenedAt));
    for (const e of newestFirst) {
      for (const ep of e.people) {
        const list = eventsOf.get(ep.personId) ?? [];
        list.push(e);
        eventsOf.set(ep.personId, list);
        if (!lastTouch.has(ep.personId)) lastTouch.set(ep.personId, e.happenedAt);
      }
    }
    // Who put money in. The person who made the intro, the host of the dinner
    // and anyone copied on the thread were there, but did not invest.
    const BYSTANDER = new Set(['referrer', 'introduced', 'host', 'cc']);
    const invested = new Set<string>();
    const investedFirms = new Set<string>();
    const firmOf = new Map(data.people.map((p) => [p.id, p.firmId]));
    for (const e of data.events) {
      if (e.kind !== 'invested') continue;
      if (e.firmId) investedFirms.add(e.firmId);
      for (const ep of e.people) {
        if (BYSTANDER.has(ep.role)) continue;
        invested.add(ep.personId);
        const firmId = firmOf.get(ep.personId);
        if (firmId) investedFirms.add(firmId);
      }
    }

    const linksOf = new Map<string, AidenLink[]>();
    for (const l of data.links) {
      for (const id of [l.aId, l.bId]) {
        const list = linksOf.get(id) ?? [];
        list.push(l);
        linksOf.set(id, list);
      }
    }
    const roundsOf = new Map<string, AidenRound[]>();
    for (const r of [...data.rounds].sort(newestRoundFirst)) {
      for (const rf of r.firms) {
        const list = roundsOf.get(rf.firmId) ?? [];
        list.push(r);
        roundsOf.set(rf.firmId, list);
      }
    }

    return {
      place: new Map(data.places.map((p) => [p.id, p])),
      firm: new Map(data.firms.map((f) => [f.id, f])),
      person: new Map(data.people.map((p) => [p.id, p])),
      eventsOf,
      linksOf,
      lastTouch,
      invested,
      investedFirms,
      roundsOf,
      sharedWith: coInvestors(data.rounds),
    };
  }, [data]);

  return {
    data, index, loaded, loading, error,
    clearError: useCallback(() => setError(null), []),
    reload, reset, create, update, remove, ingest,
  };
}
