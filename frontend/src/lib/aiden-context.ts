// The whole network, written out as text for the model to read.
//
// The Aiden chat is only useful if DeepSeek knows everything the log knows:
// who everyone is, where they sit, how they are tied together, which firms have
// shared a round, every touch in order, what is owed a follow-up, and what the
// goals are. This turns a
// snapshot into that brief. Pure: no DB, no network, safe to import anywhere.

import {
  EVENT_KIND_LABEL, EVENT_ROLE_LABEL, FIRM_KIND_LABEL, LINK_KIND_LABEL,
  type AidenSnapshot,
} from '@/lib/aiden-types';
import { coInvestors, fmtAnnounced, roundLabel, roundName } from '@/lib/aiden-rounds';

// Past this the long free-text fields are clipped, oldest events first, so a
// log that has grown for years still fits in one request.
const SOFT_CAP = 120_000;

const day = (iso: string | null): string => (iso ? iso.slice(0, 10) : '');

const clip = (s: string, n: number): string => {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}...` : flat;
};

function write(snap: AidenSnapshot, bioCap: number, summaryCap: number): string {
  const place = new Map(snap.places.map((p) => [p.id, p.name]));
  const firm = new Map(snap.firms.map((f) => [f.id, f]));
  const person = new Map(snap.people.map((p) => [p.id, p]));
  const nameOf = (id: string) => person.get(id)?.name ?? 'someone removed';

  // Last touch and touch count per person, off the events.
  const touches = new Map<string, { count: number; last: string }>();
  for (const e of snap.events) {
    for (const ep of e.people) {
      const t = touches.get(ep.personId) ?? { count: 0, last: '' };
      t.count += 1;
      if (e.happenedAt > t.last) t.last = e.happenedAt;
      touches.set(ep.personId, t);
    }
  }

  const shared = coInvestors(snap.rounds);

  const out: string[] = [];

  out.push('## PLACES');
  if (!snap.places.length) out.push('(none yet)');
  for (const p of snap.places) {
    out.push(`- ${p.name}${p.notes ? `: ${clip(p.notes, 200)}` : ''}`);
  }

  out.push('', '## FIRMS');
  if (!snap.firms.length) out.push('(none yet)');
  for (const f of snap.firms) {
    const staff = snap.people.filter((p) => p.firmId === f.id).map((p) => p.name);
    const bits = [
      FIRM_KIND_LABEL[f.kind] ?? f.kind,
      f.placeId && place.get(f.placeId) ? `in ${place.get(f.placeId)}` : '',
      f.website,
      staff.length ? `people I know there: ${staff.join(', ')}` : 'nobody logged there yet',
    ].filter(Boolean);
    // Who it has been on a round with: the firms it can introduce, and be introduced by.
    const co = [...(shared.get(f.id) ?? [])]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([otherId, rounds]) => `${firm.get(otherId)?.name ?? 'a firm removed'} (${rounds.map(roundLabel).join(', ')})`);
    out.push(
      `- ${f.name} (${bits.join('; ')})${f.notes ? `. Notes: ${clip(f.notes, bioCap)}` : ''}`
      + `${co.length ? `. Shared rounds with: ${co.join('; ')}` : ''}`,
    );
  }

  out.push('', '## PEOPLE');
  if (!snap.people.length) out.push('(none yet)');
  for (const p of snap.people) {
    const f = p.firmId ? firm.get(p.firmId) : undefined;
    const t = touches.get(p.id);
    const ties = snap.links
      .filter((l) => l.aId === p.id || l.bId === p.id)
      .map((l) => {
        const other = nameOf(l.aId === p.id ? l.bId : l.aId);
        return `${(LINK_KIND_LABEL[l.kind] ?? l.kind).toLowerCase()} with ${other}${l.note ? ` (${clip(l.note, 120)})` : ''}`;
      });
    const bits = [
      [p.title, f?.name].filter(Boolean).join(' at '),
      p.placeId && place.get(p.placeId) ? `based in ${place.get(p.placeId)}` : '',
      `warmth: ${p.warmth}`,
      p.tags.length ? `tags: ${p.tags.join(', ')}` : '',
      p.email ? `email: ${p.email}` : '',
      p.linkedin ? `linkedin: ${p.linkedin}` : '',
      p.twitter ? `x: ${p.twitter}` : '',
      t ? `${t.count} logged touch${t.count === 1 ? '' : 'es'}, last ${day(t.last)}` : 'never contacted',
      ties.length ? `ties: ${ties.join('; ')}` : '',
    ].filter(Boolean);
    out.push(`- ${p.name} (${bits.join('; ')})${p.bio ? `. Bio: ${clip(p.bio, bioCap)}` : ''}`);
  }

  out.push('', '## EVENTS (every logged touch, oldest first)');
  if (!snap.events.length) out.push('(none yet)');
  const ordered = [...snap.events].sort((a, b) => a.happenedAt.localeCompare(b.happenedAt));
  for (const e of ordered) {
    const who = e.people
      .map((ep) => `${nameOf(ep.personId)} [${(EVENT_ROLE_LABEL[ep.role] ?? ep.role).toLowerCase()}]`)
      .join(', ');
    const bits = [
      e.firmId && firm.get(e.firmId) ? `firm: ${firm.get(e.firmId)!.name}` : '',
      e.placeId && place.get(e.placeId) ? `place: ${place.get(e.placeId)}` : '',
      who ? `people: ${who}` : '',
      e.followUpAt
        ? `follow-up ${e.followUpDone ? 'done' : 'DUE'} ${day(e.followUpAt)}`
        : '',
    ].filter(Boolean);
    const head = `- ${day(e.happenedAt)} ${EVENT_KIND_LABEL[e.kind] ?? e.kind}: ${e.title || '(untitled)'}`;
    out.push(
      `${head}${bits.length ? ` (${bits.join('; ')})` : ''}${e.summary ? `. What was said: ${clip(e.summary, summaryCap)}` : ''}`,
    );
  }

  out.push('', '## ROUNDS (funding rounds, and the firms in the log that were in each; two firms on one round know each other)');
  if (!snap.rounds.length) out.push('(none yet)');
  for (const r of snap.rounds) {
    const firms = r.firms
      .map((rf) => `${firm.get(rf.firmId)?.name ?? 'a firm removed'}${rf.role === 'lead' ? ' [led]' : ''}`)
      .join(', ');
    const bits = [
      fmtAnnounced(r.announced),
      r.amount,
      firms ? `firms in the log: ${firms}` : 'no firm in the log',
      r.others ? `also in it: ${clip(r.others, 300)}` : '',
      r.source ? `source: ${r.source}` : '',
    ].filter(Boolean);
    out.push(`- ${roundName(r)} (${bits.join('; ')})${r.notes ? `. Notes: ${clip(r.notes, bioCap)}` : ''}`);
  }

  out.push('', '## GOALS');
  if (!snap.goals.length) out.push('(none yet)');
  for (const gl of snap.goals) {
    const due = gl.dueAt ? `, due ${day(gl.dueAt)}` : '';
    out.push(`- [${gl.status}${due}] ${gl.title}${gl.body ? `: ${clip(gl.body, bioCap)}` : ''}`);
  }

  out.push('', '## THOUGHTS (his own notes, newest first)');
  if (!snap.notes.length) out.push('(none yet)');
  for (const n of snap.notes) {
    out.push(`- ${day(n.updatedAt)} ${n.title || '(untitled)'}${n.body ? `: ${clip(n.body, bioCap * 2)}` : ''}`);
  }

  return out.join('\n');
}

export function buildAidenContext(snap: AidenSnapshot): string {
  let text = write(snap, 1200, 1200);
  if (text.length > SOFT_CAP) text = write(snap, 400, 400);
  if (text.length > SOFT_CAP) text = write(snap, 160, 160);
  return text;
}

export function buildAidenSystemPrompt(snap: AidenSnapshot, today: string): string {
  return [
    'You are the private networking chief of staff for Aiden Davenport, a founder who spends a lot of time ' +
      'reaching out to venture capitalists and building a network: cold emails, LinkedIn messages, referral asks, ' +
      'intros, calls, and in-person events.',
    '',
    'Below is his complete log: every place, firm, person, tie between people, the funding rounds firms have ' +
      'shared, every touch he has logged in order, his goals, and his own notes. Treat it as the single source of ' +
      'truth about his network.',
    '',
    'How to help:',
    '- Be specific. Name the actual people, firms and dates from the log. Never give generic networking advice.',
    '- When he asks what to do next, rank concrete moves: who to follow up with and why now, which ties could ' +
      'turn into a warm intro (and who should make it), what has gone stale, which follow-ups are overdue.',
    '- Use the ties. If he wants to reach someone, look for a path through people he already knows.',
    '- Use the shared rounds. Two firms that invested in the same round know each other: when he is warm at one ' +
      'and cold at the other, the person he knows at the first is the one to ask for the intro, and the round ' +
      'they shared is the reason to name.',
    '- Tie suggestions back to his goals when they are relevant.',
    '- When he asks for a message, draft it short and in a natural voice, ready to send, referring to what was ' +
      'actually said before.',
    '- If the log does not contain something, say so plainly. Never invent a person, a meeting, or a fact about ' +
      'someone. You may point out what is missing from the log and worth adding.',
    '- Keep answers tight. Short paragraphs and lists. No preamble.',
    '',
    `Today is ${today}.`,
    '',
    '===== THE LOG =====',
    buildAidenContext(snap),
    '===== END OF LOG =====',
  ].join('\n');
}
