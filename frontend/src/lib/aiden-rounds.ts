// Shared rounds: what the rounds in the log say about which firms know each
// other.
//
// A round names the firms that were in it. Two firms on the same round have a
// shared round: their partners sat on the same cap table, and one of them can
// usually make the introduction to the other. This turns the rounds into those
// pairs. Pure: no DB, no network, safe to import anywhere.

import type { AidenRound } from '@/lib/aiden-types';

/** Two firms and every round both were in. `aId` sorts before `bId`. */
export interface SharedPair {
  aId: string;
  bId: string;
  rounds: AidenRound[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** What `announced` may hold: a year, a year and month, or a full day. */
export const ANNOUNCED_RE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;

/** '2021-02-17' as "Feb 17, 2021", '2021-02' as "Feb 2021", '2021' as "2021".
 *  No more exact than what was written down. */
export function fmtAnnounced(announced: string): string {
  if (!ANNOUNCED_RE.test(announced)) return '';
  const [y, m, d] = announced.split('-');
  if (!m) return y;
  const month = MONTHS[Number(m) - 1];
  return d ? `${month} ${Number(d)}, ${y}` : `${month} ${y}`;
}

/** "Kalshi Series A", or just "Kalshi" when the stage is not known. */
export function roundName(r: Pick<AidenRound, 'company' | 'stage'>): string {
  return [r.company, r.stage].filter(Boolean).join(' ');
}

/** "Kalshi Series A (2021)". */
export function roundLabel(r: Pick<AidenRound, 'company' | 'stage' | 'announced'>): string {
  const year = r.announced.slice(0, 4);
  return `${roundName(r)}${year ? ` (${year})` : ''}`;
}

/** Newest first; a round with no date goes last. */
export function newestRoundFirst(a: AidenRound, b: AidenRound): number {
  if (a.announced !== b.announced) {
    if (!a.announced) return 1;
    if (!b.announced) return -1;
    return b.announced.localeCompare(a.announced);
  }
  return roundName(a).localeCompare(roundName(b));
}

/** Every pair of firms with a round in common, the most rounds first. */
export function sharedPairs(rounds: AidenRound[]): SharedPair[] {
  const pairs = new Map<string, SharedPair>();
  for (const r of rounds) {
    const ids = [...new Set(r.firms.map((f) => f.firmId))].sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}|${ids[j]}`;
        const pair = pairs.get(key) ?? { aId: ids[i], bId: ids[j], rounds: [] };
        pair.rounds.push(r);
        pairs.set(key, pair);
      }
    }
  }
  const out = [...pairs.values()];
  for (const p of out) p.rounds.sort(newestRoundFirst);
  return out.sort((a, b) => b.rounds.length - a.rounds.length);
}

/** For each firm: the firms it has shared a round with, and which rounds. */
export function coInvestors(rounds: AidenRound[]): Map<string, Map<string, AidenRound[]>> {
  const out = new Map<string, Map<string, AidenRound[]>>();
  const put = (from: string, to: string, shared: AidenRound[]) => {
    const m = out.get(from) ?? new Map<string, AidenRound[]>();
    m.set(to, shared);
    out.set(from, m);
  };
  for (const p of sharedPairs(rounds)) {
    put(p.aId, p.bId, p.rounds);
    put(p.bId, p.aId, p.rounds);
  }
  return out;
}

/** Case and spacing ignored, the way the log matches every name. */
export const roundNameKey = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, ' ');
