// A paragraph written in when the page never says the name.
//
// The rule the section is built around (lib/news/types) is that nothing on a
// rendered page is made up: every paragraph was read from the outlet. This is
// the one exception, and it is made only when the alternative is a clip with
// nothing to highlight. A story is found for a name — by the search, or the
// trending list off the feed's headline — and the page it opens on says the
// name nowhere: the Times gives no article text at all, only a headline and
// a summary; the BBC prints its own headline rather than the feed's, and the
// story under it can run on without ever spelling them out. The recording
// drags over a name and zooms on it, so a page with none falls back to the
// first words of the headline (lib/news/page-measure) — nothing to highlight.
//
// So when the name is nowhere (lib/news/highlight says null), one paragraph
// is asked of Gemini: a couple of sentences in the outlet's plain voice that
// say the person by their whole name and tie them to the story as the
// headline, summary and paragraphs tell it — nothing the story doesn't say,
// no quotes, no figures. It goes in as the story's second paragraph (its
// first, when there are none — the Times), the page tells the reader so in
// `notes`, and the whole name is what the recording then finds. Without
// Gemini, or when what comes back never says the name, nothing is written in
// and the fallback stands.

import { geminiGenerate } from '@/lib/gemini';
import { headlineNames } from './google-news';
import { outletById } from './outlets';
import { MAX_BLOCKS } from './read-article';
import type { NameHighlight, NewsArticle } from './types';

/** How much of the story the model is shown: enough to place the person in
 *  it, not the whole thing. */
const SHOWN_BLOCKS = 10;
const SHOWN_CHARS = 3000;

/** A paragraph shorter than this says nothing; longer than this is two. */
const MIN_CHARS = 60;
const MAX_CHARS = 700;

function prompt(a: NewsArticle, name: string, sternly: boolean): string {
  const outlet = outletById(a.outlet).name;
  const shown: string[] = [];
  let chars = 0;
  for (const b of a.body) {
    if (shown.length >= SHOWN_BLOCKS || chars > SHOWN_CHARS) break;
    const line = b.kind === 'h2' ? `[Subheading] ${b.text}` : b.kind === 'li' ? `• ${b.text}` : b.kind === 'quote' ? `“${b.text}”` : b.text;
    shown.push(line);
    chars += line.length;
  }
  const place = shown.length ? 'the second paragraph of this story, after the first one above' : 'the first paragraph of this story, under the headline';
  return `A ${outlet} story is being shown with one more paragraph in it, and that paragraph has to say the name “${name}”.

The story as ${outlet} prints it:
HEADLINE: ${a.headline}
${a.dek ? `SUMMARY: ${a.dek}\n` : ''}${a.section ? `SECTION: ${a.section}\n` : ''}${a.keyPoints.length ? `KEY POINTS:\n${a.keyPoints.map(k => `• ${k}`).join('\n')}\n` : ''}${shown.length ? `PARAGRAPHS:\n${shown.join('\n\n')}` : 'PARAGRAPHS: none were given — only the headline and summary above.'}

Write one paragraph, two or three sentences, to sit as ${place}: who ${name} is, in a few words, and how they figure in this story, in ${outlet}'s plain reporting voice.

RULES
- It must say “${name}” in full, exactly as written here, at least once.${sternly ? ' The last attempt did not — this one must.' : ''}
- Only what the story above tells or plainly implies, plus who ${name} is as the press knows them (their team, job or role). No new facts, figures, dates or quotations.
- Plain prose: no heading, no bullets, no quotation marks around it, no markdown, no preamble. The paragraph alone.`;
}

/** The reply as one paragraph that says the name, or null when it doesn't:
 *  fences, labels and markdown marks stripped, the first paragraph that
 *  names them, its whitespace folded. */
function paragraphIn(raw: string, name: string): string | null {
  const text = raw
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/^\s*(paragraph|here is[^:\n]*|sure[^:\n]*)\s*:\s*/i, '')
    .replace(/\*\*|__|(?<!\w)[*_](?=\S)|(?<=\S)[*_](?!\w)/g, '')
    .trim();
  for (const chunk of text.split(/\n\s*\n/)) {
    const para = chunk.replace(/\s+/g, ' ').trim().replace(/^["“](.*)["”]$/, '$1');
    if (para.length < MIN_CHARS || para.length > MAX_CHARS) continue;
    if (headlineNames(para, name)) return para;
  }
  return null;
}

/** Where the paragraph goes: after the first paragraph, or at the top. */
function slotIn(a: NewsArticle): number {
  const first = a.body.findIndex(b => b.kind === 'p');
  return first < 0 ? 0 : first + 1;
}

/** One paragraph naming `name`, written into the story in place — its body
 *  and paragraphs, and a note saying so — and the highlight the recording
 *  then finds: the whole name, in the story. Null, and the story untouched,
 *  when Gemini is not there or never manages to say the name. */
export async function writeNameIn(a: NewsArticle, name: string): Promise<NameHighlight | null> {
  const want = name.trim();
  if (!want) return null;
  let text: string | null = null;
  for (let attempt = 0; attempt < 2 && !text; attempt++) {
    try {
      const raw = await geminiGenerate([{ text: prompt(a, want, attempt > 0) }], {
        temperature: 0.5, maxOutputTokens: 400, timeoutMs: 15_000,
      });
      text = paragraphIn(raw, want);
    } catch (err) {
      console.warn('[news] written-in: no paragraph for', want, '—', err instanceof Error ? err.message : err);
      return null;
    }
  }
  if (!text) {
    console.warn('[news] written-in: Gemini never said the name for', want);
    return null;
  }
  a.body.splice(slotIn(a), 0, { kind: 'p', text });
  if (a.body.length > MAX_BLOCKS) a.body.length = MAX_BLOCKS;
  a.paragraphs = a.body.filter(b => b.kind === 'p' || b.kind === 'quote').map(b => b.text);
  a.notes.push(`The story never says “${want}”, so a paragraph naming them was written in by AI for the clip to highlight — it isn't ${outletById(a.outlet).name}'s.`);
  return { form: want, where: 'story' };
}
