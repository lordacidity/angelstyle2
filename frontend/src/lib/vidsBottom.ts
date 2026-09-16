// Who there are Bottom B clips of, read off the clips themselves. The Bottom B
// folder holds one Pauv recording per person and direction, named the way
// they were filed — "Trump B up", "trump down", "Kim Jong Un down b",
// "Chalamet B" — so the person and the direction are in the name, loosely,
// and when the name leaves the direction out the context ("trades up $10")
// usually has it. This reads both, and groups the clips by person, so the
// builder's Bottom card can offer a list of people and grey out the direction
// there is no clip for. Pure: no React, no network.

import type { ClipBeats } from '@/app/components/chatgpt/chatgpt-video';
import { MAX_MARK_TEXT, type VidMark, type VidRow } from '@/lib/vids-types';

export type Direction = 'up' | 'down';

/** One person with a Bottom B clip, and the newest clip of theirs in each
 *  direction (null where there is none). */
export interface BottomPerson {
  /** The person, lower-cased and squeezed — what two spellings of the same
   *  name group under. */
  key: string;
  /** The person as filed, the best-cased spelling on offer. */
  label: string;
  up: VidRow | null;
  down: VidRow | null;
}

// Words in a Bottom B name that say which slot or direction it is, not who.
const SLOT_WORDS = new Set(['a', 'b', 'bottom', 'search', 'clip', 'vid']);

/** The person and direction a Bottom B clip was filed as. The direction is the
 *  last "up" / "down" in the name, else whatever the context says; null when
 *  neither does. */
export function parseBottomB(v: Pick<VidRow, 'name' | 'context'>): { person: string; direction: Direction | null } {
  const tokens = v.name.replace(/\.[a-z0-9]{2,4}$/i, '').split(/[\s,_\-–—]+/).filter(Boolean);
  let direction: Direction | null = null;
  const who: string[] = [];
  for (const tok of tokens) {
    const low = tok.toLowerCase();
    if (low === 'up' || low === 'down') { direction = low; continue; }
    if (SLOT_WORDS.has(low)) continue;
    who.push(tok);
  }
  if (!direction) {
    const ctx = v.context.toLowerCase();
    if (/\b(down|short|shorting|shorted)\b/.test(ctx)) direction = 'down';
    else if (/\bup\b/.test(ctx)) direction = 'up';
  }
  return { person: (who.join(' ') || v.name).trim(), direction };
}

export const personKey = (person: string) => person.toLowerCase().replace(/\s+/g, ' ').trim();

// "mr Beast" → "Mr Beast", "netinyaho" → "Netinyaho"; "JD Vance" left alone.
const capWords = (s: string) => s.replace(/\b\p{Ll}+\b/gu, (w) => w[0].toUpperCase() + w.slice(1));

/** Everyone with a Bottom B clip, alphabetical, each with their newest clip
 *  per direction. A clip whose direction can't be read is left out: there is
 *  no telling which way it trades. */
export function peopleFromBottomB(clips: readonly VidRow[]): BottomPerson[] {
  const byKey = new Map<string, BottomPerson & { labels: string[] }>();
  const newestFirst = [...clips].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const v of newestFirst) {
    const { person, direction } = parseBottomB(v);
    if (!direction || !person) continue;
    const key = personKey(person);
    let p = byKey.get(key);
    if (!p) {
      p = { key, label: person, up: null, down: null, labels: [] };
      byKey.set(key, p);
    }
    p.labels.push(person);
    if (!p[direction]) p[direction] = v;
  }
  return Array.from(byKey.values())
    .map(({ labels, ...p }) => ({
      ...p,
      // A spelling with capitals in it beats one without, and lower-case
      // words get their capital either way.
      label: capWords(labels.find((l) => /\p{Lu}/u.test(l)) ?? labels[0]),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** What the rendered ChatGPT clip is filed as in the Bottom A folder. */
export const bottomAName = (person: string, direction: Direction) => `${person} ${direction} A · ChatGPT`;

/** Its context, in the words the other Bottom A clips use, so the caption
 *  writer reads it the same way. `answer` is the name the reply led with. */
export const bottomAContext = (question: string, answer: string) =>
  `chatgpt looking up "${question}", answer is ${answer}`;

/** Its marks: the recording's three beats, written the way a hand-marked clip
 *  is ("opening chatgpt", "typing the name" — the writer turns each into an
 *  instruction), so the captions come out search this, wait for it, choose
 *  them, and the layout lands each line where its beat starts
 *  (lib/vidsCaptions onMarks). Times are the renderer's own, in clip seconds. */
export function bottomAMarks(beats: ClipBeats, question: string, answer: string): VidMark[] {
  const at = (s: { start: number; end: number }) => ({ start: r2(s.start), end: r2(s.end) });
  const say = (text: string) => text.slice(0, MAX_MARK_TEXT);
  return [
    { ...at(beats.typing), text: say(`searching "${question.trim()}" on chatgpt`) },
    { ...at(beats.loading), text: say('waiting for chatgpt to load') },
    { ...at(beats.choosing), text: say(`picking ${answer} from the answer`) },
  ];
}
const r2 = (n: number) => Math.round(n * 100) / 100;
