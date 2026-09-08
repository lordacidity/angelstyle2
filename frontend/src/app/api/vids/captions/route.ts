// POST /api/vids/captions — the on-screen words for one build.
//
// A Vids build is always the same shape: the persona does something odd on
// camera (Start), then screen-records himself doing something online (Bottom A,
// then Bottom B) while the captions explain it, and it finishes on what he made
// (End). Bottom B is always Pauv — that is what the second screen clip is for —
// so the model is told outright rather than left to infer it from marks that
// often never mention the site, because whoever wrote them could see it. So this writes three kinds of line — one weird hook over Start, a
// step-by-step commentary over the screen recording, and the call to action
// over the winnings at the end. That last one is the same line on every build,
// "comment <word> for the link"; the model only picks the word, so the line
// matches the video without ever drifting from the form.
//
// The model is told how many lines each clip can hold; the caller works that out
// from the real timeline (lib/vidsCaptions), so nothing here has to think about
// timing. Extra lines are dropped at layout time rather than crammed in.
//
// A clip marked up in the editor (select a stretch, press G, say what happens)
// arrives with its moments in order, and then the job is one caption per
// moment — the caller lays each line over the stretch it was written for and
// holds it up until the next, so the words match the moment and something is
// always on screen. The one exception is the seam between Bottom A and Bottom
// B: when the caller finds A's last stretch or B's first too brief for a line
// each (`mergeSeam`), the model writes one line across both. An unmarked clip
// just gets its overall context and a count.
//
// Three rules shape the words themselves. The captions are written for someone
// who can't make out the screen — the recording is small and quick — so every
// screen line names the site and the exact thing done there ("search on
// chatgpt most hated ppl rn", never "type in most hated person"). Every line
// is written with the whole video in mind, not just its own clip, so the hook,
// the steps and the closing word tell one story. And the voice carries a
// little text-speak — ppl, rn, tbh — the way the audience types. Flash-Lite
// answers with no thinking unless asked; this asks for a little, since each
// line has to be right about the whole video and not only the clip it sits on.
//
// Every line is kept to a few words: text-speak shortens it ("bc", "rn"), and
// a moment that needs more than one short line is written as two captions
// with " / " between them — the layout (lib/vidsCaptions) shows those one
// after the other across that moment. A pair of strings for a moment is
// accepted too and joined the same way.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { extractGeminiJson, geminiGenerate } from '@/lib/gemini';
import { PAUV_BRIEF } from '@/lib/vids-brief';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Fast and cheap — these are a handful of short lines, not an essay. */
const MODEL = 'gemini-3.1-flash-lite';

const style = (emojis: boolean) => `Every caption:
- SHORT. A screen line is 3 to 7 words and never more than 8 — it is read in a second while the screen moves on. Not a sentence. No full stop at the end. The hook may run a little longer; it wraps.
- all lower case.
- plain spoken, the way someone talks to a camera. No hashtags, no quote marks.
- text-speak, the way ppl actually type: "bc" for because, "rn" for right now, "ppl", "tbh", "ngl", "fr", "w/", "ur". Shorten with these before cutting meaning — "trade down on him bc ppl hate him rn". A few across the set, where they land naturally — never one in every line, never forced, never at the cost of being clear.
${emojis
  ? `- EMOJI: put two or three across the set, always — one on the START hook and at least one on a BOTTOM A or BOTTOM B line, each at the end of its line. Pick whatever emoji actually fits what that caption is saying; anything at all, the whole set is yours. Never two in one caption, never a row of them, never one standing in for a word. The END line is fixed and never gets one.`
  : `- No emoji.`}`;

/** Where each screen recording is. Bottom B is the Pauv clip on every build,
 *  and its context and moments are written by whoever cut it — who could see
 *  the screen, and so had no reason to write "on pauv" anywhere. Left to infer
 *  it, the model puts Bottom B's steps on whatever site Bottom A named. */
const WHERE = `WHERE EACH SCREEN RECORDING IS
BOTTOM B IS ALWAYS PAUV. Every build, without exception: the second screen clip is pauv.com. Its context and its moments may never say so — whoever marked the clip could see the screen — and that changes nothing. Every BOTTOM B caption is a step taken on pauv.com and reads like one: name pauv where the line needs a place ("search ronaldo on pauv", "hit trade up on pauv.com"), and NEVER put a Bottom B step on chatgpt, google, x or anywhere else, however its context reads. If a Bottom B moment says only "searched the name", the caption is "search ronaldo on pauv".
BOTTOM A is wherever its own recording shows — chatgpt, google, x, or pauv.com itself. Take that from its context and moments rather than assuming.`;

// The screen-recording lines are directions the viewer follows along with, not a
// commentary on what the screen is doing. Marks get written down as "opening
// chatgpt", "typing the name" — the caption for one has to come back out the
// other way round.
const IMPERATIVE = `VOICE for the BOTTOM A and BOTTOM B captions — write them as INSTRUCTIONS to the viewer, not as narration of what is on screen. Every one starts with a plain command verb: "search", "go to", "type in", "look at", "trade up", "place a trade", "watch for", "pick", "check" — and says where: "search on chatgpt", "go to pauv.com", "trade up on pauv".
NEVER start one with an -ing word. Not "typing the name" but "type in the name". Not "looking up ronaldo" but "look up ronaldo". Not "placing a trade" but "place a trade". Not "heading to pauv.com" but "go to pauv.com".
The START caption is the exception — the hook, phrased however it lands best. (END is a fixed line; you only pick its word.)`;

/** One screen recording: what it shows overall, and — when it has been marked up
 *  — what happens at each stretch, in the order they play. */
const Clip = z.object({
  context: z.string().max(600).default(''),
  marks: z.array(z.string().max(200)).max(24).default([]),
  count: z.number().int().min(0).max(24),
}).nullable().default(null);

const Schema = z.object({
  /** What the persona is doing on camera — the funny bit. Drives the hook. */
  personaContext: z.string().max(600).default(''),
  personaName: z.string().max(120).default(''),
  /** Whether the build has a Start clip to caption at all. */
  wantStart: z.boolean().default(true),
  /** Free-text steer typed in the builder — "less funny", "be more specific". */
  notes: z.string().max(500).default(''),
  bottomA: Clip,
  bottomB: Clip,
  /** Whether the build has an End clip — the winnings — to sign off over. */
  wantEnd: z.boolean().default(false),
  /** What that closing clip shows — one more place the closing word can come
   *  from. */
  endContext: z.string().max(600).default(''),
  /** Whether a couple of emoji are allowed. Default on: these are captions for
   *  short vertical video, and a bare set reads flat beside everything else on
   *  the feed. */
  emojis: z.boolean().default(true),
  /** Bottom A's last moment and Bottom B's first are too brief for a line each,
   *  so the writer puts one line across both — as A's last entry, with B's
   *  first left "". Decided by the caller from the real timeline. */
  mergeSeam: z.boolean().default(false),
});

interface Drafted { start: string; bottomA: string[]; bottomB: string[]; end: string }

/** A marked clip's lines are kept in step with its moments — '' where the writer
 *  passed on one — so the caller can lay line i over moment i. Padded out to
 *  `n` in case the model stopped short. An unmarked clip has no moments to line
 *  up with, so its blanks are simply dropped. */
/** One entry of the reply as a line: a string as it is; a pair of strings — a
 *  moment the writer split in two — as one line with " / " between them, which
 *  is how the layout knows to show them one after the other. */
const asText = (x: unknown): string => {
  if (typeof x === 'string') return x.trim();
  if (!Array.isArray(x)) return '';
  return x.filter((s): s is string => typeof s === 'string').map((s) => s.trim()).filter(Boolean).slice(0, 2).join(' / ');
};
const asLines = (v: unknown, n: number, marked: boolean): string[] => {
  const lines = (Array.isArray(v) ? v : []).map(asText);
  if (!marked) return lines.filter(Boolean).slice(0, n);
  const out = lines.slice(0, n);
  while (out.length < n) out.push('');
  return out;
};

/** The closing line is the same on every build; only the word changes. */
const END_LINE = (word: string) => `comment ${word} for the link`;
/** Used when the model hands back nothing usable for the word, so the build is
 *  never missing its call to action. Generic — worth swapping by hand. */
const END_FALLBACK_WORD = 'pauv';

/** The model is asked for just the word, but it sometimes hands back the whole
 *  line, quotes it, or tacks an emoji on. All of that is peeled off; what is
 *  left is at most two words, dropped into the fixed line. */
function endLine(v: unknown): string {
  const clean = (typeof v === 'string' ? v : '')
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}"'“”‘’`.,:;!?]/gu, '')
    .trim();
  const inner = clean.match(/^comment\s+(.+?)\s+for the link$/)?.[1] ?? clean;
  const word = inner.split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
  return END_LINE(word || END_FALLBACK_WORD);
}

function buildPrompt(input: z.infer<typeof Schema>): string {
  const {
    personaContext, personaName, wantStart, bottomA, bottomB, wantEnd, endContext, notes, emojis, mergeSeam,
  } = input;

  /** What the reply must hold for one screen recording: a marked clip's array
   *  stays in step with its moments, an unmarked one is a ceiling. */
  const shape = (key: string, clip: typeof bottomA): string | null => {
    if (!clip?.count) return null;
    const n = `${clip.count} string${clip.count === 1 ? '' : 's'}`;
    return clip.marks.length
      ? `"${key}": an array of exactly ${n}, one per moment in order`
      : `"${key}": an array of ${n} — that many fit the clip. Only go under it if the context genuinely has fewer steps than that; never pad with filler`;
  };
  const wanted: string[] = [];
  if (wantStart) wanted.push('"start": one caption (a single string)');
  const shapeA = shape('bottomA', bottomA);
  if (shapeA) wanted.push(shapeA);
  const shapeB = shape('bottomB', bottomB);
  if (shapeB) wanted.push(shapeB);
  if (wantEnd) wanted.push('"end": the word for the closing line (a single string holding JUST the word)');

  /** A marked clip is a numbered list of moments; an unmarked one is a sentence. */
  const describe = (label: string, clip: typeof bottomA, onPauv = false): string => {
    if (!clip) return `${label}: (no clip)`;
    // Said again right beside the moments, because that is where it gets
    // ignored: a list of marks that never mentions Pauv reads like a list of
    // steps taken somewhere else.
    const where = onPauv ? ' Every one of these is on pauv.com, whether or not the moment says so.' : '';
    if (clip.marks.length) {
      const steps = clip.marks.map((m, i) => `  ${i + 1}. ${m}`).join('\n');
      return `${label} — ${clip.marks.length} moment${clip.marks.length === 1 ? '' : 's'}, in order`
        + `${clip.context ? ` (the clip overall: ${clip.context})` : ''}. `
        + `Write ONE short caption for each, in this order, telling the viewer what to do at that moment.${where}\n${steps}`;
    }
    return `${label} context: ${clip.context
      || (onPauv ? '(not given — it is on pauv.com; describe a plausible step there)' : '(not given — describe a plausible step of using Pauv)')}`
      + (clip.context ? where : '');
  };

  return `You write the on-screen captions for a short vertical video selling Pauv.

${PAUV_BRIEF}

THE VIDEO
Part 1 — START: the persona on camera doing something odd or funny.
Part 2 — the screen recording: the same guy's screen while he does something online, in two clips that play back to back, BOTTOM A then BOTTOM B. Bottom A is wherever he starts — often somewhere else online; BOTTOM B IS ALWAYS PAUV.COM.
Part 3 — END: the pay-off. He is back on camera showing off the money the trade made him, and over it the line that sends the viewer to the comments for the link.

WHAT EACH CAPTION DOES
START — one caption, the hook. Weird and funny, cocky and absurd, never like an ad. It MUST actually name the stupid thing he is doing on camera and tie it to making money on Pauv — that collision is the whole joke. If his context says he is putting a can of velo in his mouth, the caption says so. Do not swap it for some other bit of business you made up.
BOTTOM A and BOTTOM B — tell the viewer what to do, step by step, so someone learns how Pauv works by following along. Assume they CANNOT see the screen: the recording is small and quick, and most people read the caption and never make out what is on it. So every line has to stand on its own — name the site or app and the exact thing being done there, in the words the viewer would need to go and do it themselves. Not "type in most hated person in the world" but "search on chatgpt most hated ppl rn". Not "click the button" but "hit trade up on pauv.com". Not "look him up" but "search ronaldo on pauv". Each caption still describes ITS OWN clip: a Bottom A caption is what the viewer does in the Bottom A recording, a Bottom B caption in Bottom B — which is on pauv.com every time, whatever its context happens to mention. Do not describe a step that is not on that clip's screen.
When a clip is given as a numbered list of moments, a caption goes on screen at exactly its moment and stays up until the next one — so caption 1 describes moment 1 and nothing else, caption 2 moment 2, and so on. Every moment gets its own caption: keep them in order, never skip one, never merge two into one line${mergeSeam ? ' — except at the seam, below' : ''}. Each line says what is on screen RIGHT THEN, not what came before or what comes next.
A moment that is really two things — go to the site, then do the thing there — or that will not fit in one short line, gets TWO captions: put both in that moment's one entry with " / " between them, like "go to chatgpt / see who the most hated person is rn". The first goes up where the moment starts, the second halfway through it. Two at most for a moment, and the entry still counts as one, so the array stays one entry per moment. Split rather than write one long line. The same " / " works inside any line of an unmarked clip.
END — one fixed line, always exactly: comment <word> for the link. The line is already written; the ONLY thing you choose is <word>, what a viewer types in the comments to get the link. Reply with JUST the word, not the whole line. It must match THIS video — the name of the person he traded on ("ronaldo"), or the stupid thing he did on camera ("velo") — taken from the contexts below, never made up. One word, two at the very most. Lower case, no quotes, no emoji. Not "pauv", not "link".

ONE STORY, NOT FOUR SEPARATE CAPTIONS
Read everything under THIS VIDEO before you write a word — the persona bit, both screen recordings, the ending — and keep the whole of it in mind for every line. The captions are one story told in order: the hook sets up what he is about to do online, each screen-recording line carries that same thread on (the same person he is trading on, the same reason he picked them, the same site), and the closing word ties it back. A line written from its own clip alone reads like a stranger wrote it. When a Bottom B line says "trade up on him", "him" is the person named in the hook and Bottom A; when the hook names who he made money on, it is the person the screen recording actually shows; the reason he picked them (trending, most hated, just got signed) can be carried from the clip that gives it into the lines that don't. Every line still says what is on screen RIGHT THEN — the whole video is what you write each line WITH, not what you write it ABOUT.

${mergeSeam ? `THE SEAM
Bottom A's last moment and Bottom B's first moment are too brief to carry a line each, so they share one. Write ONE short line that covers both — what he does at the end of A and straight after at the start of B, like "go to pauv.com, look up ronaldo" — as the LAST entry of "bottomA", and put "" (empty) as the FIRST entry of "bottomB". That "" is the only blank anywhere; every other moment still gets its own line.

` : ''}${WHERE}

${style(emojis)}

${IMPERATIVE}

WORKED EXAMPLE
persona context: putting a can of velo in mouth
bottom a — 2 moments (the clip overall: asking chatgpt who is trending, then heading to pauv):
  1. asked chatgpt who's trending, picked ronaldo
  2. typed pauv.com
bottom b — 2 moments (the clip overall: finding ronaldo on pauv and trading up on him):
  1. searched ronaldo
  2. traded up on him
->
start: making ronaldo's salary in 67 seconds with a can of velo in my mouth${emojis ? ' 💰' : ''}
bottomA: ["go to chatgpt / see who's trending rn${emojis ? ' 👀' : ''}", ${mergeSeam ? '"go to pauv.com, search ronaldo"' : '"go to pauv.com"'}]
bottomB: [${mergeSeam ? '""' : '"search ronaldo on pauv"'}, "trade up on him bc he's trending${emojis ? ' 📈' : ''}"]
end: ronaldo
(${mergeSeam ? 'the seam is merged there: one line across the end of A and the start of B, and "" in B\'s first slot. ' : 'one short line per moment, in its own slot. '}"end" is just the word: the closing line then reads "comment ronaldo for the link". Every screen line says where he is and what he does there — chatgpt, pauv.com, ronaldo — so it reads without seeing the screen; "him" in the last line is the ronaldo from the hook and bottom a, one story across all four. Moment 1 of bottom a is two things, so it is two short captions with " / " between them, one after the other; "rn" and "bc" are the text-speak)
${emojis ? '(the three emoji there are just where they happened to land for that video — choose your own, from the whole set, for this one)' : ''}
THIS VIDEO
persona${personaName ? ` (${personaName})` : ''} context: ${personaContext || '(not given — keep the hook general, still weird and funny)'}
${describe('bottom a', bottomA)}
${describe('bottom b', bottomB, true)}
${wantEnd ? `end context: ${endContext || '(not given — pick the closing word from the rest of the video)'}` : 'end: (no clip)'}

${notes.trim() ? `
WHAT THE EDITOR ASKED FOR THIS TIME
${notes.trim()}
Follow that over the style notes above — but never over the banned words, which always hold.
` : ''}
Reply with ONLY a JSON object holding ${wanted.join(', ')}. No prose, no code fence.`;
}

export async function POST(req: NextRequest) {
  try {
    const input = Schema.parse(await req.json());
    const { wantStart, bottomA, bottomB, wantEnd } = input;
    if (!wantStart && !bottomA?.count && !bottomB?.count && !wantEnd) {
      return NextResponse.json({ error: 'Nothing to caption — fill Start, a bottom clip or End first.' }, { status: 400 });
    }

    const raw = await geminiGenerate([{ text: buildPrompt(input) }], {
      model: MODEL,
      // Flash-Lite thinks not at all unless asked. A little is asked for here:
      // every line has to be right about the whole video, not only its clip.
      // Thinking tokens count against the output cap, so that sits well above
      // what the reply itself needs.
      thinking: 'low',
      // Warm enough for the hook to be odd, not so warm it stops following the
      // brief on the how-it-works lines.
      temperature: 0.9,
      maxOutputTokens: 2048,
    });

    const parsed = JSON.parse(extractGeminiJson(raw)) as Record<string, unknown>;
    const drafted: Drafted = {
      start: wantStart && typeof parsed.start === 'string' ? parsed.start.trim() : '',
      bottomA: asLines(parsed.bottomA, bottomA?.count ?? 0, !!bottomA?.marks.length),
      bottomB: asLines(parsed.bottomB, bottomB?.count ?? 0, !!bottomB?.marks.length),
      end: wantEnd ? endLine(parsed.end) : '',
    };
    return NextResponse.json(drafted);
  } catch (err) {
    console.error('[vids captions POST]', err);
    const msg = err instanceof Error ? err.message : 'unexpected error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
