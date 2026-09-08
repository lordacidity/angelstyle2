// The three-word title of a finished build. The model writes it from what the
// build was made of — the persona's bit, what the screen recordings show, the
// captions that went on — so it names THIS video rather than describing the
// format; the code after it is what makes it unique. Whatever comes back is
// held to exactly three clean words, and if the model is unreachable the title
// is put together from the persona and clip names instead: an export must
// never wait on, or fail for, a name.
import { extractGeminiJson, geminiGenerate } from '@/lib/gemini';
import { BANNED_WORDS, PAUV_BRIEF } from '@/lib/vids-brief';
import type { RecipeTitleBrief, VidBuildSpec } from '@/lib/vids-types';

/** Fast and cheap — three words. */
const MODEL = 'gemini-3.1-flash-lite';
const WORDS = 3;
/** A word longer than this is a URL or a typo, either way not a title. */
const MAX_WORD = 16;

/** Only the single words: "stock market" is caught by "stock", and "market" on
 *  its own is a fine word. */
const BANNED = new Set(BANNED_WORDS.filter((w) => !w.includes(' ')));
/** Never worth one of the three, when the words are being scraped together. */
const FILLER = new Set(['the', 'a', 'an', 'of', 'and', 'to', 'in', 'on', 'for', 'with', 'video', 'clip', 'vid', 'pauv', 'top', 'bottom', 'start', 'end']);

const titleCase = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** Words out of free text: letters and digits, apostrophes and hyphens inside a
 *  word allowed, everything else — emoji, punctuation, quotes — dropped. */
export function cleanWords(text: string): string[] {
  return text
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s'’-]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^['’-]+|['’-]+$/g, ''))
    .filter(Boolean);
}

/** Exactly three words: the first three usable ones of `raw`, made up from
 *  `fallback` when there are fewer. Banned words never get in, and no word
 *  appears twice. Empty only if there is nothing at all to work with. */
export function threeWords(raw: string, fallback: readonly string[]): string {
  const out: string[] = [];
  const seen = new Set<string>();
  const take = (w: string) => {
    const key = w.toLowerCase();
    // A dash or a lone quote is not a word, wherever it came from.
    if (out.length >= WORDS || !/[\p{L}\p{N}]/u.test(w) || seen.has(key) || BANNED.has(key)) return;
    seen.add(key);
    out.push(titleCase(w.slice(0, MAX_WORD)));
  };
  for (const w of cleanWords(raw)) take(w);
  for (const w of fallback) take(w);
  return out.join(' ');
}

/** What to call it when the model can't: the persona's name, then the clips'
 *  (less the words that say nothing), then — so there are always three —
 *  something rather than nothing. */
export function fallbackWords(build: VidBuildSpec): string[] {
  const names = [
    build.persona?.name ?? '',
    ...Object.values(build.picks).map((p) => (p ? p.videoName.replace(/\.[^.]+$/, '') : '')),
  ];
  return [...names.flatMap(cleanWords).filter((w) => !FILLER.has(w.toLowerCase())), 'Pauv', 'Build', 'Vid'];
}

function buildPrompt(build: VidBuildSpec, brief: RecipeTitleBrief): string {
  const { lines } = build.captions;
  const captions = [lines.start.text, ...lines.bottomA.map((l) => l.text), ...lines.bottomB.map((l) => l.text), lines.end.text]
    .map((t) => t.trim())
    .filter(Boolean);
  const name = build.persona?.name ?? '';

  return `You name finished short vertical videos for the team that makes them. The name is how they tell one video from another in a long list, so it has to be specific to THIS video and easy to recognise at a glance.

${PAUV_BRIEF}

THE VIDEO
Every one is the same shape: a persona does something odd on camera (START), then screen-records himself doing something online (BOTTOM A, then BOTTOM B) while captions explain it, and it ends on him showing off what the trade made him (END). So the format is never what makes a video different — the stunt, the person looked up and the joke are.

persona${name ? ` (${name})` : ''}: ${brief.personaContext.trim() || '(not given)'}
bottom a: ${brief.bottomAContext.trim() || '(not given)'}
bottom b: ${brief.bottomBContext.trim() || '(not given)'}
end: ${brief.endContext.trim() || '(not given)'}
captions on screen, in order:
${captions.length ? captions.map((c) => `- ${c}`).join('\n') : '- (none written)'}

THE TITLE
- EXACTLY three words. Not two, not four.
- Concrete: the stunt on camera and/or who was looked up — "Velo Ronaldo Salary", "Mouth Tape Messi", "Ketchup Drake Trade". Whatever makes THIS video unmistakable next to fifty others in the same format.
- No filler: no "the", "a", "and", "video", "clip", and don't spend a word on "Pauv".
- Plain words only — no punctuation, no emoji, no hashtags.
- Title Case.

Reply with ONLY a JSON object: {"title": "Word Word Word"}. No prose, no code fence.`;
}

/** The title for a build: the model's three words, or the fallback's. */
export async function writeTitle(build: VidBuildSpec, brief: RecipeTitleBrief): Promise<string> {
  const fallback = fallbackWords(build);
  try {
    const raw = await geminiGenerate([{ text: buildPrompt(build, brief) }], {
      model: MODEL,
      // Room to be specific, not so warm it starts inventing a stunt that isn't there.
      temperature: 0.8,
      maxOutputTokens: 200,
      // The render this runs beside is long; the name must not be what holds it up.
      timeoutMs: 12_000,
    });
    const parsed = JSON.parse(extractGeminiJson(raw)) as { title?: unknown };
    const title = threeWords(typeof parsed.title === 'string' ? parsed.title : '', fallback);
    if (title) return title;
  } catch (e) {
    console.error('[vids recipes] title fell back to the clip names:', e);
  }
  return threeWords('', fallback) || 'Pauv Build Vid';
}
