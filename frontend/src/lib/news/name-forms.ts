// How the news says a name, for the search (lib/news/google-news) and the
// IMDb list (lib/news/imdb).
//
// Searching the whole name alone misses the stories that say it short:
// headlines call Vladimir Putin "Putin" and LeBron James "LeBron", so a story
// titled "Putin warns the West" was found but didn't count as naming him, and
// one that never spells him out in full wasn't found at all. Searching every
// surname alone would be as bad the other way: "Paul" for Jake Paul, "West"
// for Kanye West. So each name is looked at once, by Gemini, which knows how
// the press refers to people, for two kinds of short form:
//
//   search     unmistakable on its own — "Putin", "Musk", "LeBron", "AOC".
//              Searched for alongside the whole name, so a story that only
//              ever says "Putin" turns up too.
//   headline   what headlines call them that is too common a word or name to
//              search on alone — "Swift", "James", "Paul". It only counts in
//              the headline of a story already found for the whole name,
//              where it can only mean them.
//
// Either kind in a headline counts as the name being in the title.
//
// Without Gemini the forms are worked out from the name the way the news
// recording looks for it on the page (lib/news/page-measure): the surname and
// the first name, as headline forms only — never searched alone, since nothing
// has said they are safe to be. That answer is not kept; the next search asks
// again.

import { extractGeminiJson, geminiGenerate } from '@/lib/gemini';

export interface NameForms {
  /** Short forms searched for on their own, beside the whole name. */
  search: string[];
  /** Short forms that count in the headline of a story found for the whole
   *  name, and nowhere else. */
  headline: string[];
  /** Whether Gemini said so, or the fallback guessed. */
  ai: boolean;
}

/** Lower case, accents and curly quotes folded — the way google-news matches
 *  a name — so two spellings of one form are one form. */
const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[‘’]/g, "'").toLowerCase().trim();

/** The most of each kind worth searching or matching on. */
const MAX_FORMS = 4;

const prompt = (name: string) => `A news search is being run for one public figure: ${name}.

List the short forms news headlines use for them, in two groups.

"search": short forms that, alone in a headline, would be read as this person and almost nobody else, so the news can be searched for them on their own. Usually a distinctive surname ("Putin" for Vladimir Putin, "Musk" for Elon Musk, "Zuckerberg" for Mark Zuckerberg), sometimes a distinctive first name ("LeBron" for LeBron James, "Elon" for Elon Musk), or a handle or title the press really uses ("AOC", "MBS", "The Rock", "King Charles").

"headline": short forms headlines do use for them that are also common words, or shared with other famous people, places or things, so searching for them alone would bring back stories about something else: "Swift" for Taylor Swift, "James" for LeBron James, "Paul" for Jake Paul, "West" for Kanye West.

RULES
- Never their full name as given.
- Only forms the press actually uses for this person. Most people have one or two; many have none, and an empty list is a good answer. A one-word name (Drake, Zendaya) usually has nothing to add.
- When unsure whether a form is safe to search alone, put it in "headline".
- Spell each the way headlines print it.

Reply as JSON: {"search": ["..."], "headline": ["..."]}`;

/** A reply's list as forms: strings, a couple of characters to a few words,
 *  never the whole name, never a form already given. */
function forms(v: unknown, taken: Set<string>): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string') continue;
    const f = x.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
    const key = fold(f);
    if (f.length < 2 || f.length > 40 || f.split(' ').length > 4 || taken.has(key)) continue;
    taken.add(key);
    out.push(f);
    if (out.length >= MAX_FORMS) break;
  }
  return out;
}

async function ask(name: string): Promise<NameForms> {
  const raw = await geminiGenerate([{ text: prompt(name) }], {
    temperature: 0, maxOutputTokens: 300, timeoutMs: 10_000, thinkingLevel: 'minimal',
  });
  const j = JSON.parse(extractGeminiJson(raw)) as { search?: unknown; headline?: unknown };
  const taken = new Set([fold(name)]);
  const search = forms(j.search, taken);
  return { search, headline: forms(j.headline, taken), ai: true };
}

/** The surname and the first name, headline forms only — see the header. */
function guess(name: string): NameForms {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const taken = new Set([fold(name)]);
  const headline = words.length > 1 ? forms([words[words.length - 1], words[0]].filter((w) => w.length >= 3), taken) : [];
  return { search: [], headline, ai: false };
}

const cache = new Map<string, Promise<NameForms>>();
const CACHE_MAX = 500;

/** How the news says `name`, asked once per name for as long as the server
 *  runs. Never throws: without Gemini it is the guess. */
export function nameForms(name: string): Promise<NameForms> {
  const key = fold(name);
  let p = cache.get(key);
  if (!p) {
    p = ask(name).catch((err: unknown) => {
      console.warn('[news] name forms: falling back to a guess for', name, '—', err instanceof Error ? err.message : err);
      return guess(name);
    });
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, p);
    void p.then((f) => { if (!f.ai) cache.delete(key); });
  }
  return p;
}
