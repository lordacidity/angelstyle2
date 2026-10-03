'use client';

// Shared rounds: which firms have put money into the same round, and what that
// opens up.
//
// A round names the firms in the log that were in it. Two firms on one round
// know each other, so the rounds are read three ways:
//
//   Pairs    every two firms with a round in common, the most rounds first
//   Ways in  the pairs worth acting on: a firm where someone is warm, that has
//            shared a round with a firm where nobody is. The warm one is who
//            to ask for the intro, and the round is the reason to name
//   Rounds   the rounds themselves, newest first
//
// A firm is drawn as warm as the warmest person known there, the same as on the
// Firms tab, so a pair with one lit end and one dark end stands out anywhere.

import React, { useMemo, useState } from 'react';
import type { AidenFirm, AidenPerson, AidenRound, Warmth } from '@/lib/aiden-types';
import { fmtAnnounced, newestRoundFirst, roundLabel, roundNameKey, sharedPairs } from '@/lib/aiden-rounds';
import type { UseAidenData } from './useAidenData';
import type { AidenNav } from './aiden-nav';
import {
  Chip, Empty, INVESTED_COLOR, ROUND_COLOR, SearchBox, WARMTH_COLOR, btnGhost, btnPrimary, cardCls, href,
  inputCls, warmest,
} from './aiden-ui';

type RoundsView = 'pairs' | 'paths' | 'rounds';

const VIEWS: { id: RoundsView; label: string; hint: string }[] = [
  { id: 'pairs', label: 'Pairs', hint: 'Every two firms that have been in the same round' },
  { id: 'paths', label: 'Ways in', hint: 'Warm at one, cold at the other: who to ask for the intro' },
  { id: 'rounds', label: 'Rounds', hint: 'The rounds themselves, newest first' },
];

const VIEW_KEY = 'aiden.rounds.view';

function rememberedView(): RoundsView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (VIEWS.some((x) => x.id === v)) return v as RoundsView;
  } catch { /* storage blocked: the default */ }
  return 'pairs';
}

/** How well a firm is known: by its warmest person, and whether it has invested. */
interface Heat {
  people: AidenPerson[];
  warmth: Warmth | null;
  invested: boolean;
  /** 3 invested, 2 hot, 1 warm, 0 cold, -1 nobody logged there. */
  rank: number;
}

const WARMTH_RANK: Record<Warmth, number> = { cold: 0, warm: 1, hot: 2 };

function useHeat(api: UseAidenData): (firmId: string) => Heat {
  const byFirm = useMemo(() => {
    const staff = new Map<string, AidenPerson[]>();
    for (const p of api.data.people) {
      if (!p.firmId) continue;
      const list = staff.get(p.firmId) ?? [];
      list.push(p);
      staff.set(p.firmId, list);
    }
    const out = new Map<string, Heat>();
    for (const f of api.data.firms) {
      const people = staff.get(f.id) ?? [];
      const warmth = warmest(people);
      const invested = api.index.investedFirms.has(f.id);
      out.set(f.id, { people, warmth, invested, rank: invested ? 3 : warmth ? WARMTH_RANK[warmth] : -1 });
    }
    return out;
  }, [api.data.firms, api.data.people, api.index.investedFirms]);
  return (firmId) => byFirm.get(firmId) ?? { people: [], warmth: null, invested: false, rank: -1 };
}

const heatColor = (h: Heat): string =>
  h.invested ? INVESTED_COLOR : h.warmth ? WARMTH_COLOR[h.warmth] : '#3f3f46';

const heatWord = (h: Heat): string =>
  h.invested ? 'Invested' : h.warmth ? `Warmest contact here is ${h.warmth}` : 'Nobody logged here yet';

function FirmTag({ firm, heat, nav }: { firm: AidenFirm; heat: Heat; nav: AidenNav }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); nav.select({ type: 'firm', id: firm.id }); }}
      title={heatWord(heat)}
      className="flex min-w-0 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-left transition-colors hover:border-zinc-600"
    >
      <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: heatColor(heat) }} />
      <span className="truncate text-[12.5px] font-medium text-white">{firm.name}</span>
    </button>
  );
}

function RoundChips({ rounds, nav }: { rounds: AidenRound[]; nav: AidenNav }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {rounds.map((r) => (
        <Chip
          key={r.id}
          color={ROUND_COLOR}
          title={[fmtAnnounced(r.announced), r.amount].filter(Boolean).join(', ') || undefined}
          onClick={(e) => { e.stopPropagation(); nav.open({ kind: 'round', initial: r }); }}
        >
          {roundLabel(r)}
        </Chip>
      ))}
    </div>
  );
}

interface PairRow {
  key: string;
  /** The better known of the two. */
  a: AidenFirm;
  b: AidenFirm;
  rounds: AidenRound[];
}

export function AidenRounds({ api, nav }: { api: UseAidenData; nav: AidenNav }) {
  const [view, setView] = useState<RoundsView>(rememberedView);
  function pickView(v: RoundsView) {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ }
  }
  const [q, setQ] = useState('');
  const [firmId, setFirmId] = useState('');
  const heat = useHeat(api);
  const { index } = api;

  const needle = q.trim().toLowerCase();

  const pairs = useMemo<PairRow[]>(() => {
    const out: PairRow[] = [];
    for (const p of sharedPairs(api.data.rounds)) {
      const x = index.firm.get(p.aId);
      const y = index.firm.get(p.bId);
      if (!x || !y) continue;
      const [a, b] = heat(y.id).rank > heat(x.id).rank ? [y, x] : [x, y];
      out.push({ key: `${p.aId}|${p.bId}`, a, b, rounds: p.rounds });
    }
    return out;
    // `heat` is rebuilt whenever the people or the firms change, as `index` is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.data.rounds, index]);

  const shownPairs = useMemo(
    () =>
      pairs.filter((p) => {
        if (firmId && p.a.id !== firmId && p.b.id !== firmId) return false;
        if (!needle) return true;
        return `${p.a.name} ${p.b.name} ${p.rounds.map((r) => `${r.company} ${r.stage}`).join(' ')}`
          .toLowerCase().includes(needle);
      }),
    [firmId, needle, pairs],
  );

  // A way in: warm (or better) at one end, cold or nobody at the other.
  const paths = useMemo(
    () =>
      shownPairs
        .filter((p) => heat(p.a.id).rank >= 1 && heat(p.b.id).rank <= 0)
        .sort((x, y) => heat(y.a.id).rank - heat(x.a.id).rank || y.rounds.length - x.rounds.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shownPairs],
  );

  const rounds = useMemo(
    () =>
      api.data.rounds
        .filter((r) => {
          if (firmId && !r.firms.some((rf) => rf.firmId === firmId)) return false;
          if (!needle) return true;
          const names = r.firms.map((rf) => index.firm.get(rf.firmId)?.name ?? '').join(' ');
          return `${r.company} ${r.stage} ${r.others} ${r.notes} ${names}`.toLowerCase().includes(needle);
        })
        .sort(newestRoundFirst),
    [api.data.rounds, firmId, index, needle],
  );

  // A company that raised a round may be in the log as a firm of its own.
  const firmByName = useMemo(
    () => new Map(api.data.firms.map((f) => [roundNameKey(f.name), f])),
    [api.data.firms],
  );

  // Only the firms that are on a round are worth filtering by.
  const firmsOnRounds = useMemo(
    () => api.data.firms.filter((f) => index.roundsOf.has(f.id)),
    [api.data.firms, index],
  );

  if (!api.data.rounds.length) {
    return (
      <Empty
        title="No rounds yet"
        body="Add a funding round and the firms that were in it. Two firms on the same round know each other, and the one you are warm with can introduce you to the other."
        action={<button onClick={() => nav.open({ kind: 'round' })} className={btnPrimary}>Add a round</button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
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
              <span className="ml-1.5 text-[10.5px] text-zinc-600">
                {v.id === 'pairs' ? shownPairs.length : v.id === 'paths' ? paths.length : rounds.length}
              </span>
            </button>
          ))}
        </div>
        <SearchBox value={q} onChange={setQ} placeholder="Search firms and companies" />
        <select
          value={firmId}
          onChange={(e) => setFirmId(e.target.value)}
          className={`${inputCls} w-auto min-w-[120px] py-1.5 pr-7`}
        >
          <option value="">Any firm</option>
          {firmsOnRounds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <span className="text-[11px] text-zinc-600">{VIEWS.find((v) => v.id === view)?.hint}</span>
        <button type="button" onClick={() => nav.open({ kind: 'round' })} className={`${btnGhost} ml-auto`}>
          + Round
        </button>
      </div>

      {view === 'pairs' && (
        <div className="flex flex-col gap-2">
          {shownPairs.length === 0 && (
            <p className="py-8 text-center text-[12px] text-zinc-600">
              {pairs.length ? 'No pairs match.' : 'No two firms in the log have been in the same round yet.'}
            </p>
          )}
          {shownPairs.map((p) => (
            <div key={p.key} className={`${cardCls} flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5`}>
              <div className="flex min-w-0 items-center gap-2">
                <FirmTag firm={p.a} heat={heat(p.a.id)} nav={nav} />
                <span className="shrink-0 text-[11px] font-medium" style={{ color: ROUND_COLOR }}>
                  {p.rounds.length}
                </span>
                <FirmTag firm={p.b} heat={heat(p.b.id)} nav={nav} />
              </div>
              <RoundChips rounds={p.rounds} nav={nav} />
            </div>
          ))}
        </div>
      )}

      {view === 'paths' && (
        <div className="flex flex-col gap-2">
          {paths.length === 0 && (
            <p className="py-8 text-center text-[12px] leading-relaxed text-zinc-600">
              No ways in yet. One shows up when a firm where someone is warm, hot or has invested
              <br />
              has shared a round with a firm where everyone is cold or nobody is logged.
            </p>
          )}
          {paths.map((p) => {
            const from = heat(p.a.id);
            const to = heat(p.b.id);
            // The people worth asking: anyone there who is not cold. A firm
            // that invested with nobody warm on file still names its people.
            const askers = from.people.filter((x) => x.warmth !== 'cold' || api.index.invested.has(x.id));
            const ask = askers.length ? askers : from.people;
            return (
              <div key={p.key} className={`${cardCls} flex flex-col gap-2 px-3.5 py-3`}>
                <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-zinc-500">
                  <span>Ask</span>
                  {ask.map((x) => (
                    <Chip
                      key={x.id}
                      color={api.index.invested.has(x.id) ? INVESTED_COLOR : WARMTH_COLOR[x.warmth]}
                      onClick={() => nav.select({ type: 'person', id: x.id })}
                    >
                      {x.name}
                    </Chip>
                  ))}
                  <span>at</span>
                  <FirmTag firm={p.a} heat={from} nav={nav} />
                  <span>for an intro to</span>
                  <FirmTag firm={p.b} heat={to} nav={nav} />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-zinc-500">
                  <span>{p.rounds.length === 1 ? 'They shared' : `They shared ${p.rounds.length} rounds:`}</span>
                  <RoundChips rounds={p.rounds} nav={nav} />
                </div>
                <p className="text-[11px] text-zinc-600">
                  {to.people.length
                    ? `At ${p.b.name}: ${to.people.map((x) => x.name).join(', ')} (cold)`
                    : `Nobody logged at ${p.b.name} yet`}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {view === 'rounds' && (
        <>
          {rounds.length === 0 && <p className="py-8 text-center text-[12px] text-zinc-600">No rounds match.</p>}
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {rounds.map((r) => {
              const company = firmByName.get(roundNameKey(r.company));
              const open = () => nav.open({ kind: 'round', initial: r });
              return (
                <div
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={open}
                  onKeyDown={(e) => { if (e.key === 'Enter') open(); }}
                  className={`${cardCls} flex cursor-pointer flex-col gap-2 px-3.5 py-3 transition-colors hover:border-zinc-700`}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: ROUND_COLOR }} />
                    <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-white">
                      {company ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); nav.select({ type: 'firm', id: company.id }); }}
                          className="hover:underline"
                        >
                          {r.company}
                        </button>
                      ) : r.company}
                      {r.stage && <span className="ml-1.5 font-normal text-zinc-400">{r.stage}</span>}
                    </p>
                    <span className="shrink-0 text-[10.5px] text-zinc-600">
                      {[fmtAnnounced(r.announced), r.amount].filter(Boolean).join(', ')}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {r.firms.length === 0 && <span className="text-[11.5px] text-zinc-600">No firm in the log was in it</span>}
                    {r.firms.map((rf) => {
                      const f = index.firm.get(rf.firmId);
                      if (!f) return null;
                      return (
                        <Chip
                          key={rf.firmId}
                          color={heatColor(heat(f.id))}
                          title={`${rf.role === 'lead' ? 'Led the round. ' : ''}${heatWord(heat(f.id))}`}
                          onClick={(e) => { e.stopPropagation(); nav.select({ type: 'firm', id: f.id }); }}
                        >
                          {f.name}
                          {rf.role === 'lead' && <span className="opacity-70">led</span>}
                        </Chip>
                      );
                    })}
                  </div>
                  {r.others && (
                    <p className="line-clamp-2 text-[11.5px] leading-relaxed text-zinc-500" title={r.others}>
                      Also in it: {r.others}
                    </p>
                  )}
                  {r.source && (
                    <a
                      href={href(r.source)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="truncate text-[10.5px] text-zinc-600 underline decoration-zinc-800 underline-offset-2 hover:text-zinc-300"
                    >
                      {r.source.replace(/^https?:\/\/(www\.)?/i, '')}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
