// POST /api/vids/question — the question the ChatGPT lookalike gets asked,
// written for whoever the Bottom card has chosen. Two buttons, two opposite
// jobs:
//
//   ragebait  the extreme opposite of how the world actually rates them, so
//             that ChatGPT naming them makes no sense at all: "who is the best
//             president of all time" for Donald Trump, "who is the worst
//             musician of all time" for Taylor Swift, "who is the least
//             controversial person in the world" for Benjamin Netanyahu. The
//             reader should think: no way ChatGPT just said that.
//   factual   a plain question they genuinely belong at the top of, about who
//             is rising or who is big right now. Nobody should blink at it.
//
// Which way the video trades has nothing to do with it. The question is about
// the person and only the person; the direction is what the lookalike's own
// brain argues afterwards (api/ai/chatgpt), not what is asked.
//
// The question may never name the person — naming them gives the answer away,
// and the recording is of a search, not of a leading question. It comes back as
// one line in lower case, the way every question typed into that bar is
// written.
//
// The card waits on this with a spinner, so it is built to land fast: the
// smallest model the app uses, the floor thinking level, a short prompt and
// barely any room to answer in.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { geminiGenerate } from '@/lib/gemini';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Hard-coded rather than env-driven, so every environment writes the same.
 *  The fastest tier the app has. */
const MODEL = 'gemini-3.5-flash-lite';

/** Long enough for a real question, short enough to type out on screen inside
 *  the clip's few seconds (see typeDur in chatgpt-video). */
const MAX_QUESTION = 120;

const Body = z.object({
  /** Who the video is about, as the Bottom B clips have them filed. */
  person: z.string().trim().min(1).max(80),
  kind: z.enum(['ragebait', 'factual']),
});

type Kind = z.infer<typeof Body>['kind'];

/** Kept short on purpose: every token in here is latency on a button somebody
 *  is waiting at. */
const RAGEBAIT_JOB = [
  'Work out how the world actually rates this person at what they are known for. Then ask for the EXTREME',
  'OPPOSITE of that:',
  '- admired, loved, respected -> ask who is the WORST, or the most overrated, ever',
  '- disliked, divisive, notorious -> ask who is the BEST, the greatest, or the least controversial, ever',
  '',
  'Almost everyone famous FOR THEIR WORK — musicians, singers, actors, athletes — is admired, so for them it',
  'is nearly always the WORST. Only reach for "best" or "greatest" when the person is genuinely notorious or',
  'widely disliked, which in practice means politicians and the like. When in doubt, ask for the WORST.',
  '',
  'Always an absolute: "of all time", "ever", "in the world". Never "one of the", never a hedge.',
  'It should make NO SENSE that the answer is this person. That is the entire point: whoever is watching',
  'should think "no way ChatGPT just said that" and argue about it.',
  '',
  'Examples of the shape:',
  '- Donald Trump -> who is the best president of all time?',
  '- Taylor Swift -> who is the worst musician of all time?',
  '- Benjamin Netanyahu -> who is the least controversial person in the world?',
  '',
  'Aim it at their public work, record or standing. Never at looks, family, health, private life, race,',
  'religion, or any crime.',
].join('\n');

/** The four ways a growth question can be framed. One is drawn per request
 *  rather than left to the model, which otherwise answers "the safest bet in
 *  <field> right now" almost every time, however hot it is run — so pressing
 *  the button again gave the same question back. It is a steer, not an order:
 *  a framing that does not fit the person gives way to one that does, since a
 *  question nobody would ask is worse than one that rhymes with the last. */
const GROWTH_FRAMINGS: readonly string[] = [
  'who is ON THE WAY UP — the most up and coming, the ones about to break out, the ones about to blow up',
  'who is UNDERVALUED — the most underrated, the most slept on, the ones not getting the credit they deserve',
  'who is the SAFEST BET — the best bet for next year, the best long term bet in their field',
  'who is ABOUT TO WIN — most likely to win an emmy, an oscar, a grammy, the ballon d\'or, the next election',
];

const factualJob = (framing: string) => [
  'Ask a plain, sensible question about who is GOING UP: trajectory, upside, who is worth backing. NEVER',
  'about who is simply the biggest or the most talked about already — that is a fact about today, and this',
  'question is about tomorrow. Whoever is watching should read the answer and think "I should buy that',
  'person right now".',
  '',
  `FRAME IT AS: ${framing}.`,
  'If that framing genuinely does not fit this person, use whichever of these does instead: on the way up,',
  'undervalued, the safest bet, about to win something.',
  '',
  'This person must genuinely be one of the first names a well-informed answer would give. Nothing',
  'surprising, strange or provocative: it should look like somebody looking up a tip and getting a',
  'sensible one.',
  '',
  'Examples of the shape:',
  '- who are the most up and coming rappers right now?',
  '- who is most likely to win an emmy next year?',
  '- who are the most underrated young footballers?',
  '',
  'No superlatives that need defending. Nothing about the greatest of all time.',
].join('\n');

/** What this call asks for: the ragebait brief as it stands, or the growth
 *  brief under one of its four framings, drawn now. */
const jobFor = (kind: Kind): string => (kind === 'ragebait'
  ? RAGEBAIT_JOB
  : factualJob(GROWTH_FRAMINGS[Math.floor(Math.random() * GROWTH_FRAMINGS.length)]));

const buildPrompt = (person: string, kind: Kind): string => [
  'You write the one question that gets typed into a ChatGPT search bar in a short video.',
  '',
  `THE PERSON THE ANSWER MUST LAND ON: ${person}`,
  '',
  jobFor(kind),
  '',
  'RULES:',
  '- NEVER write their name, or any part of it. The question must not give away who the answer is.',
  '- It must be answerable with a ranked list of PEOPLE. Not songs, films, countries, teams or companies.',
  '- ONE question, one line. No preamble, no label, no quotes, no explanation.',
  '- ENTIRELY lower case, including the first word and any proper nouns.',
  `- At most ${MAX_QUESTION} characters, ending in a question mark.`,
  '',
  'Return ONLY the question.',
].join('\n');

/** The model's line as the search bar takes it: one line, no wrapper, no
 *  trailing punctuation but the question mark, and lower case whatever came
 *  back — the rule is the rule, not a request. */
function clean(raw: string): string {
  const first = raw
    .replace(/```[a-z]*/gi, '')
    .replace(/```/g, '')
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean) ?? '';
  const bare = first
    // A label the model added in front of its answer.
    .replace(/^(question|ragebait|factual|answer)\s*[:–—-]\s*/i, '')
    // Quotes around the whole thing, straight or curly.
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    // The question mark is put back below, so the cap can never cut it off.
    .replace(/[.!?]+$/, '')
    .trim()
    .slice(0, MAX_QUESTION - 1)
    .trim();
  return bare ? `${bare}?` : '';
}

/** Words that carry no one's identity on their own. Without these, "The
 *  Weeknd" would match every question ever written and nothing would ever come
 *  back. Short words ("de", "al") are already dropped by the length test. */
const NAME_STOPWORDS = new Set([
  'the', 'and', 'for', 'von', 'van', 'der', 'den', 'del', 'dos', 'ibn', 'bin', 'jnr', 'snr',
]);

/** Whether the question gives the game away. Each word of the name is checked
 *  on its own, so "cristiano ronaldo" is caught by either half. A name with
 *  nothing distinctive left in it is not checked at all — better a question
 *  through than no question at all. */
function namesPerson(question: string, person: string): boolean {
  const words = person.toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((w) => w.length > 2 && !NAME_STOPWORDS.has(w));
  return words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(question));
}

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  const { person, kind } = parsed.data;

  let lastErr = '';
  // Two goes: the realistic failure is a line that came back empty after
  // cleaning, or one that named the person anyway, and a fresh sample fixes
  // both far more often than not. The prompt is rebuilt each time so a second
  // go also draws a fresh framing rather than pushing at the one that failed.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await geminiGenerate([{ text: buildPrompt(person, kind) }], {
        model: MODEL,
        thinkingLevel: 'minimal',
        // Both get pressed again for another one, so both want range: held
        // down, factual answers "safest bet in X" almost every time. The rules
        // around it are strict enough that the heat costs nothing.
        temperature: kind === 'ragebait' ? 0.95 : 0.85,
        // One short line. Anything more is only latency.
        maxOutputTokens: 200,
        timeoutMs: 12_000,
        // Extreme superlatives about real public figures, which is the whole
        // job here — the lookalike's own brain runs the same way.
        relaxSafety: true,
      });
      const question = clean(raw);
      if (!question) throw new Error('nothing usable came back');
      // A question with the name in it gives the answer away. Ask again.
      if (namesPerson(question, person)) throw new Error('it named the person');
      return NextResponse.json({ question });
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      console.error('[vids question] attempt', attempt + 1, 'failed:', lastErr);
    }
  }
  return NextResponse.json({ error: lastErr || 'empty response' }, { status: 502 });
}
