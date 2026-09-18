// Finding Pauv's people in a piece of text — a headline, a story — when nobody
// has said who it is about: the trending list (lib/news/trending) reads every
// fresh headline for anyone on the roster, and a pasted article link
// (api/news/article) is read for whoever it names. Pure; no I/O in here.
//
// Whole names only. The short forms the press uses ("Putin", "LeBron") are
// worked out one name at a time by lib/news/name-forms, which is no way to go
// through a roster of over a thousand; a headline that says the whole name is
// also the one the recording can drag over without guessing.
//
//   More than one word   matched as words, any case, accents folded, a dot or
//                        a trailing Jr. optional: "Ronald Acuña Jr." is found
//                        in "Ronald Acuna homers twice".
//   One word             matched as the roster spells it, or in capitals —
//                        "Drake", "DRAKE", "SZA" for sza — and never lower
//                        case, so "the future of AI" is not Future. A headline
//                        in title case still prints "The Future Of AI", which
//                        is what the trending list's AI check is for.

/** Accents and curly quotes folded, case kept. NFD leaves a few letters whole
 *  (Ødegaard, Yıldız), so those are folded by hand. */
const LETTERS: Record<string, string> = { ø: 'o', Ø: 'O', đ: 'd', Đ: 'D', ł: 'l', Ł: 'L', ı: 'i', ß: 'ss', æ: 'ae', Æ: 'AE' };
const plain = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2018\u2019]/g, "'").replace(/[øØđĐłŁıßæÆ]/g, c => LETTERS[c]);

/** A word as the index keys it: dots out, "$" as the "s" it stands for, a
 *  possessive dropped — "A$AP", "ASAP" and "asap's" are one key. */
const keyOf = (w: string) => w.toLowerCase().replace(/[^a-z0-9$']/g, '').replace(/\$/g, 's').replace(/'s?$/, '');

/** A word as a pattern: a dot optional, "$" or "s", a "!" optional. */
const wordPattern = (w: string) =>
  w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\./g, '\\.?').replace(/\\\$/g, '[$s]').replace(/!/g, '!?');

const SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/i;

/** One-word names on the roster that are also ordinary words, or somebody
 *  else's first name, once case and accents are out of it — Rosé is "Rose".
 *  A match on one of these proves nothing by itself: the trending list has the
 *  AI look at it, and anything with no such check leaves it out. */
const ORDINARY = new Set([
  'autumn!', 'che', 'dasha', 'dave', 'dijon', 'future', 'ian', 'jennie', 'lisa', 'logic', 'ludwig', 'marlon',
  'mike', 'nas', 'offset', 'rose', 'saba', 'silky', 'sketch', 'usher', 'wale',
]);
export const isOrdinaryName = (name: string) => ORDINARY.has(plain(name).trim().toLowerCase());

export interface RosterFind<T> {
  person: T;
  /** Where in the text the name starts. */
  at: number;
  /** How many times the text says it. */
  count: number;
}

/** A reader for one roster: give it text, get back everyone on the roster it
 *  names, in the order it first names them. Built once per roster — the index
 *  is by each name's first word, so reading a headline costs its own words and
 *  not the roster's length. */
export function rosterMatcher<T extends { name: string }>(people: readonly T[]): (text: string) => RosterFind<T>[] {
  const byFirst = new Map<string, { person: T; re: RegExp; cased: boolean }[]>();
  for (const person of people) {
    const words = plain(person.name).trim().split(/[\s-]+/).filter(Boolean);
    const key = words.length ? keyOf(words[0]) : '';
    if (!key) continue;
    let re: RegExp;
    const cased = words.length === 1;
    if (cased) {
      const as = wordPattern(words[0]);
      const caps = wordPattern(words[0].toUpperCase());
      re = new RegExp(`(?<![A-Za-z0-9])(?:${as}|${caps})(?![A-Za-z0-9])`, 'g');
    } else {
      const last = words[words.length - 1];
      const core = words.length > 2 && SUFFIX.test(last) ? words.slice(0, -1) : words;
      const tail = core.length < words.length ? `(?:[\\s,-]+${wordPattern(last.toLowerCase())})?` : '';
      re = new RegExp(`(?<![a-z0-9])${core.map(w => wordPattern(w.toLowerCase())).join('[\\s-]+')}${tail}(?![a-z0-9])`, 'g');
    }
    const list = byFirst.get(key);
    if (list) list.push({ person, re, cased }); else byFirst.set(key, [{ person, re, cased }]);
  }

  return (text: string) => {
    const kept = plain(text);
    const lower = kept.toLowerCase();
    const tried = new Set<string>();
    const found: (RosterFind<T> & { end: number; cased: boolean })[] = [];
    for (const m of lower.matchAll(/[a-z0-9$][a-z0-9$.']*/g)) {
      const key = keyOf(m[0]);
      if (!key || tried.has(key)) continue;
      tried.add(key);
      for (const c of byFirst.get(key) ?? []) {
        const all = [...(c.cased ? kept : lower).matchAll(c.re)];
        if (!all.length) continue;
        const at = all[0].index ?? 0;
        found.push({ person: c.person, at, end: at + all[0][0].length, count: all.length, cased: c.cased });
      }
    }
    // "Dave" inside "Dave Portnoy" is Dave Portnoy, when both are listed.
    const whole = found.filter(f => !f.cased);
    return found
      .filter(f => !f.cased || !whole.some(w => f.at >= w.at && f.at < w.end))
      .sort((a, b) => a.at - b.at)
      .map(({ person, at, count }) => ({ person, at, count }));
  };
}
