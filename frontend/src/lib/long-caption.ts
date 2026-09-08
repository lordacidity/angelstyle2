// The long-form caption that goes under a post — the copy-paste kind, three
// paragraphs and about 1900 characters — as every route that writes one holds
// it to the same shape. The text helpers clean a draft up (wrapping quotes,
// stray markdown, and every em / en dash, which no caption may carry);
// writeInBand runs the generate → check → nudge loop that lands a draft inside
// the band, since the model tends to under-run the floor on its first try.
// Pure strings and one loop: no Node, no browser.

export const LONG_CAPTION_MIN = 1750;
export const LONG_CAPTION_MAX = 2000;
export const LONG_CAPTION_PARAGRAPHS = 3;

/** Strip wrapping quotes, stray markdown, and (critically) every em / en dash.
 *  Dashes become commas; any double comma that falls out of that is collapsed. */
export function cleanText(raw: string): string {
  return (raw ?? '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/\*/g, '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/,\s*,/g, ',')
    .trim();
}

/** Force the caption to exactly `n` paragraphs. Too many → merge the overflow
 *  into the last; too few → return as-is (nothing reliable to split on; the
 *  nudge asks the model instead). */
export function normalizeParagraphs(s: string, n: number): string {
  const paras = s.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length <= 1) return paras[0] ?? s.trim();
  if (paras.length === n) return paras.join('\n\n');
  if (paras.length > n) {
    const head = paras.slice(0, n - 1);
    const tail = paras.slice(n - 1).join(' ');
    return [...head, tail].join('\n\n');
  }
  return paras.join('\n\n');
}

export function countParagraphs(s: string): number {
  return s.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).length;
}

/** Trim an over-long caption to <= max, preferring the last sentence end
 *  at/above min so it stays inside the band and never cuts a word. */
export function clampRange(s: string, min: number, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  let best = -1;
  for (const stop of ['. ', '! ', '? ', '\n']) {
    const i = cut.lastIndexOf(stop);
    if (i >= 0 && i + 1 >= min && i + 1 > best) best = i + 1;
  }
  if (best >= min) return cut.slice(0, best).trim();
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace >= min ? cut.slice(0, lastSpace) : cut).trim();
}

interface Turn { role: 'system' | 'user' | 'assistant'; content: string }

export interface WriteInBandOptions {
  system: string;
  user: string;
  /** Said again with every nudge — the route's own rules, in a sentence. */
  remind: string;
  /** One draft for one flattened prompt. */
  generate: (prompt: string) => Promise<string>;
  /** Anything else wrong with a draft, as issues to nudge on — a banned word, say. */
  check?: (candidate: string) => string[];
  attempts?: number;
  min?: number;
  max?: number;
  paragraphs?: number;
}

/** Generate, check the band and the paragraph count (and `check`), nudge on a
 *  miss with the prior draft in view, up to `attempts` times. The first clean
 *  draft wins; failing one, the closest to valid — the right paragraph count
 *  first, then the longest still under the ceiling. '' when nothing came back. */
export async function writeInBand(o: WriteInBandOptions): Promise<string> {
  const {
    min = LONG_CAPTION_MIN, max = LONG_CAPTION_MAX, paragraphs = LONG_CAPTION_PARAGRAPHS, attempts = 4,
  } = o;
  const turns: Turn[] = [{ role: 'system', content: o.system }, { role: 'user', content: o.user }];
  // The model takes a single turn, so the retry conversation (prior draft +
  // feedback) is flattened into one prompt each attempt.
  const flatten = () => turns
    .map((t) => (t.role === 'assistant' ? `Your previous draft:\n${t.content}` : t.content))
    .join('\n\n');

  let best = '';
  for (let attempt = 0; attempt < attempts; attempt++) {
    const raw = await o.generate(flatten());
    let candidate = normalizeParagraphs(cleanText(raw), paragraphs);
    if (candidate.length > max) candidate = normalizeParagraphs(clampRange(candidate, min, max), paragraphs);
    const inBand = candidate.length >= min && candidate.length <= max;
    const okParas = countParagraphs(candidate) === paragraphs;
    const extra = o.check?.(candidate) ?? [];
    if (inBand && okParas && !extra.length) return candidate;

    const bestOkParas = best ? countParagraphs(best) === paragraphs : false;
    const promote = !best
      || (okParas && !bestOkParas)
      || (okParas === bestOkParas && candidate.length > best.length && candidate.length <= max);
    if (promote) best = candidate;

    const issues = [...extra];
    if (candidate.length < min) issues.push(`it is ${candidate.length} characters, under the ${min} minimum, add depth to land between ${min} and ${max}`);
    if (candidate.length > max) issues.push(`it is ${candidate.length} characters, over the ${max} maximum, tighten to between ${min} and ${max}`);
    if (!okParas) issues.push(`it has ${countParagraphs(candidate)} paragraphs, rewrite as EXACTLY ${paragraphs} paragraphs separated by single blank lines`);
    if (!issues.length) issues.push('output did not pass validation, regenerate');

    turns.push({ role: 'assistant', content: candidate });
    turns.push({ role: 'user', content: `That draft has problems: ${issues.join('; ')}. ${o.remind} Return ONLY the caption.` });
  }
  return best;
}
