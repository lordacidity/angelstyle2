// POST /api/vids/hook — the Start caption on its own, written to the guide for
// the mode Vids 2's form was set to. None of these hooks is written off the
// screen recordings, so none of them is written alongside the step-by-step
// lines (api/vids/captions): each is written here, from who the video trades
// on, which way, and — for the two that say what he is doing, Middle and the
// me if twist — the persona's context.
//
// SERIOUS is one flat line in a fixed order: the trading verb, the person, now
// and then a real-world moment that gives the trade a reason, and what the
// money does. Nothing about what the guy on camera is doing. The joke is how
// straight-faced it is.
//
//   going long on taylor swift before the tour announcement to cover a year of rent
//   shorting drake before the album drops to pay off the car
//
// MIDDLE (the form's name for normal) always opens "making <analogy>" and
// then takes one of five shapes, drawn here by MIDDLE_SHAPE_ODDS: what he is
// doing after "while", or the money against how little time it took — a drawn
// number of seconds, or "in the time it takes to" a drawn task — and, in two of
// those four, the persona's parenthetical on the end. The analogy, the seconds
// and the task are all off lists in lib/vids2/hookRules, and the parenthetical
// is what the persona's context says in parentheses ("wearing a knight helmet
// (in a fresh fit)"), word for word and without the brackets, so three shapes
// in five are put together here with no model call at all. The while shape's
// slot is what he is doing on camera (MIDDLE_ACTIVITY_ODDS of the time), said
// by the model off the rest of the context, or else the MYSTERY: the trade on
// someone described but never named, on a verb fixed by which way — "trading
// on" up, "shorting" down. Middle takes no twist; its mystery is that slot.
//
//   making a lawyer's salary while wearing a knight helmet          while · what he is doing
//   making a year of gas while shorting the greatest rapper alive   while · the mystery
//   making drake's salary in 67 seconds in a fresh fit              seconds + parenthetical
//   making a year of rent in the time it takes to skip an ad        time
//
// DEGEN is descriptor + trade + nickname + (bracket) + emoji, every part but
// the nickname from a fixed list. So the model is asked for the nickname and
// nothing else, and the line is put together here. A bracket that says "i love
// you" takes the nickname's short form and no emoji; only a nickname with a
// short form can have one.
//
//   chopped kid shorts musky (i need serious help) 🔥
//   tweaker goes long on swifty (i love you swifty)
//
// In Serious and Degen, one hook in five is a TWIST instead, one of three at even
// odds: a MYSTERY, the trade on someone described but never named; HYPE, the
// name and how high they are going; or ME IF, the trade caught in the middle of
// what he is doing on camera, "was legal". Hype only goes up, so a down trade's
// twist is a mystery or a me if. Degen's hype and me if say the nickname;
// everything else about the three is the same in every mode, Serious and
// Middle's trading verbs included.
//
//   shorting the greatest musician of our generation     mystery
//   messi to the stratosphere                            hype
//   me if shorting drake mid haircut was legal           me if
//
// Me if is the one twist written off the video: like Middle's activity, where
// it catches him comes from the persona's context and is never invented, so a
// build with no context draws from the other twists instead (NO_CONTEXT_TWISTS).
//
// Everything that is a choice between fixed options is drawn here rather than
// left to the model — the verb, Middle's shape and every part of it but the
// two the model writes, and all of Degen but the nickname — so builds spread
// across them instead of resting on whichever one the model favours. Down is
// always "shorting" / "shorts"; up is "going long on" or "trading on" / "goes
// long on" or "trades on", even odds. A Middle build with no persona context
// has nothing he is doing, so its while shape is the mystery and its
// parenthetical shapes stop at their time. The lists, the odds and every
// guide's examples live in lib/vids2/hookRules, which the tuning page's guide
// to all of this (components/vids2/Vids2HookGuide) reads too.
//
// What the model writes is held to the rules rather than trusted with them:
// lower-cased, stripped of emoji, quotes and a full stop, and a trade said on
// the wrong verb has it swapped for the drawn one. A Serious line with no
// trade where one was asked for, or with "man" in it, is written again. So is
// Middle's what-he-is-doing with a trading verb, their name, a time or "man"
// in it. A Degen nickname that comes back as nothing is the plain name. A
// mystery that names them, a hype line that opens on a trade, or a me if out
// of its frame is written again.
//
// Written by Claude Sonnet 5 at low effort rather than the Gemini Flash-Lite the
// rest of the words use. The job is tone plus knowing the person well enough to
// name a real moment in their year or a nickname that lands, which Flash-Lite
// wrote flat. It was Claude Opus 5 at medium effort until 2026-09-18; Sonnet 5
// is $2 / $10 per million tokens against Opus's $5 / $25, low effort spends
// fewer of them, and since the code draws most of
// every line (verbs, combos, Degen's parts, the clock's frame), what is left
// for the model is short enough that the bigger one wasn't earning its price.

import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  DEGEN_EMOJI, DEGEN_EXAMPLES, DEGEN_VERBS, DESCRIPTORS, HOOK_ATTEMPTS, HYPE_NAMED, HYPE_NICKNAMED, LOVE_MAX,
  LOVE_ODDS, ME_IF_NAMED, ME_IF_NICKNAMED, MIDDLE_ACTIVITY_ODDS, MIDDLE_ANALOGIES, MIDDLE_EXAMPLES,
  MIDDLE_MYSTERY_VERBS, MIDDLE_SECONDS, MIDDLE_SHAPE_ODDS, MIDDLE_SHAPES, MIDDLE_TASKS, MYSTERY_EXAMPLES,
  NICKNAME_EXAMPLES, NO_CONTEXT_TWISTS, SELF_OWNS, SERIOUS_EXAMPLES, TWIST_ODDS, TWISTS, VERBS,
  type MiddleShape, type Twist,
} from '@/lib/vids2/hookRules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODEL = 'claude-sonnet-5';

const Body = z.object({
  mode: z.enum(['serious', 'middle', 'degen']),
  /** Who the video trades on, as the Pauv roster spells them. */
  person: z.string().trim().min(1).max(80),
  direction: z.enum(['up', 'down']),
  /** The persona's context: what he is doing on camera, with what it says in
   *  parentheses — Middle's activity and its parenthetical. Serious and Degen
   *  never mention it. */
  personaContext: z.string().trim().max(600).default(''),
});

type Input = z.infer<typeof Body>;
type Direction = Input['direction'];

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

const PAUV = 'You write the first caption of a short vertical video. It sits over a guy on camera, and the video goes on to show him placing a trade on Pauv, where people trade on real public figures the way they would trade on a stock.';

const REPLY = 'Reply with the line and nothing else.';

const examples = (lines: readonly string[]) => lines.map((e) => `  ${e}`).join('\n');

/** What one call asks for, and how its reply becomes the line — null when the
 *  reply is not usable and a fresh go is better than a patched one. */
interface Ask {
  system: string;
  ask: string;
  format?: Anthropic.Beta.BetaJSONOutputFormat;
  finish: (reply: string) => string | null;
}

/** A hook is asked of the model, or — Middle's shapes off the lists — put
 *  together here with no call at all. */
type Plan = Ask | { line: string };

const which = (direction: Direction) =>
  `which way: ${direction === 'up' ? 'up, backing them' : 'down, betting against them'}`;

// ── Serious ──────────────────────────────────────────────────────────────────

const SERIOUS = `${PAUV}

THE ORDER, every time:
  <trading verb> <person> <catalyst, optional> <money outcome>

TRADING VERB: the first words of the line, always. It is one of "trading on", "going long on" or "shorting", and the one to use is given with the person. Use exactly that one.
PERSON: their full, normal name, the name everyone actually calls them, the way the examples write it. No nicknames.
CATALYST (optional): between the person and the money, a real-world moment that gives the trade a reason, like "ahead of midterms", "before the album drops", "after the trade deadline". It has to belong to this person's actual world: a tour or an album for a musician, the playoffs for a player, earnings or a launch for a founder. When you are not sure what their world is, leave it out rather than guess.
MONEY OUTCOME: the end of the line, what the money does, like "to cover rent", "for a six figure year", "to retire early".

RULES
- Never the word "man", and nothing about what the guy on camera is doing or where he is.
- No emoji, no hashtags, no quote marks, no full stop.
- All lower case, names included.
- Flat and matter-of-fact. The humour comes from how straight-faced it is, so say it like a plan, not a joke.

EXAMPLES
${examples(SERIOUS_EXAMPLES)}

They show the order and the tone. Write a new line for this person; never hand one of these back.

${REPLY}`;

// ── Middle ───────────────────────────────────────────────────────────────────
//
// Put together here from the drawn parts. The model is asked for what he is
// doing, or the mystery, on the while shape, and for nothing on the others.

/** Every way a trade is said, Degen's included, which what he is doing never
 *  has. */
const ANY_TRADE = /\b(trading on|going long on|shorting|shorts|goes long on|trades on)\b/;
/** A time of its own, which what he is doing must not bring: a Middle line's
 *  time, when it has one, is drawn. */
const A_TIME = /\bin the time it takes\b|\b\d+\s*(seconds?|secs?|minutes?|mins?|hours?)\b/;

/** The persona's context split for Middle: what he is doing, and each "(...)"
 *  it says — word for word, lower-cased, one of them drawn when there are
 *  several. */
function splitContext(context: string): { doing: string; parentheticals: string[] } {
  const parentheticals: string[] = [];
  const doing = context
    .replace(/\(([^)]*)\)/g, (_, inner: string) => {
      const p = inner.replace(/\s+/g, ' ').trim().toLowerCase();
      if (p) parentheticals.push(p);
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { doing, parentheticals };
}

/** The shape a Middle line takes, by MIDDLE_SHAPE_ODDS. */
function middleShape(): MiddleShape {
  let r = Math.random();
  for (const shape of MIDDLE_SHAPES) {
    r -= MIDDLE_SHAPE_ODDS[shape];
    if (r < 0) return shape;
  }
  return MIDDLE_SHAPES[MIDDLE_SHAPES.length - 1];
}

/** An analogy off the list — never the one that names the person the video
 *  trades on, so a Drake build never makes drake's salary. */
function analogyFor(person: string): string {
  const pool = MIDDLE_ANALOGIES.filter((a) => !namesPerson(a, person));
  return pick(pool.length ? pool : MIDDLE_ANALOGIES);
}

const ACTIVITY = `${PAUV}

THE LINE reads:
  making <money analogy> while <what he is doing>

The money analogy is already chosen and the line is put together from your part, so you write only WHAT HE IS DOING: what the guy in the video is doing, given below, said casually and briefly so it reads straight after "while": "wearing a knight helmet", "on the toilet", "holding a hammer in my mouth", "laying in the middle of the road", "sitting in the woods", "drinking a beer". Take it only from what the video shows and never make one up. Say it your own way rather than copying the words given, and give it without the "while".

RULES
- Never the word "man".
- No trading verb, no one's name, no time or number: the line is the money against what he is doing, nothing else.
- No emoji, no hashtags, no quote marks, no full stop. All lower case.

EXAMPLES, whole lines as they come out
${examples(MIDDLE_EXAMPLES)}

They show the shape and the tone. Write what he is doing for this video; never hand one of these back.

Reply with what he is doing and nothing else.`;

function middlePlan({ person, direction, personaContext }: Input): Plan {
  const { doing, parentheticals } = splitContext(personaContext);
  const opening = `making ${analogyFor(person)}`;
  const shape = middleShape();
  if (shape !== 'while') {
    const time = shape.startsWith('seconds')
      ? `in ${pick(MIDDLE_SECONDS)} seconds`
      : `in the time it takes to ${pick(MIDDLE_TASKS)}`;
    // The parenthetical shapes take one of the context's "(...)"s, no brackets;
    // a context with none leaves the line at its time.
    const parenthetical = shape.endsWith('parenthetical') && parentheticals.length ? ` ${pick(parentheticals)}` : '';
    return { line: `${opening} ${time}${parenthetical}` };
  }
  // The while shape: what he is doing on camera, or the mystery. With no
  // context there is nothing he is doing, so it is the mystery.
  if (doing && Math.random() < MIDDLE_ACTIVITY_ODDS) {
    return {
      system: ACTIVITY,
      ask: [`the line so far: ${opening} while`, `what the guy in the video is doing: ${doing}`].join('\n'),
      finish: (reply) => {
        const activity = clean(reply).replace(/^while\s+/, '');
        if (!activity || ANY_TRADE.test(activity) || A_TIME.test(activity) || /\d/.test(activity)) return null;
        if (namesPerson(activity, person)) return null;
        return noMan(`${opening} while ${activity}`, person);
      },
    };
  }
  const verb = MIDDLE_MYSTERY_VERBS[direction];
  return {
    system: MYSTERY,
    ask: [`person: ${person}`, which(direction), `open with: ${verb}`].join('\n'),
    finish: (reply) => {
      const mystery = holdVerb(clean(reply), verb, true);
      return mystery && !namesPerson(mystery, person) ? `${opening} while ${mystery}` : null;
    },
  };
}

// ── Degen ────────────────────────────────────────────────────────────────────

// The descriptors, verbs, self-owns, emoji and the odds on "(i love you ...)"
// are all in lib/vids2/hookRules.

/** What a Degen nickname is — shared with Degen's hype line, which says it too. */
const NICKNAME_RULE = 'a funny shorthand of their name, the kind a group chat would call them, when one lands. When nothing lands, their plain name. Lower case.';

const NICKNAMES = examples(NICKNAME_EXAMPLES);

const DEGEN = `You come up with the nickname for one person in the caption of a short vertical video, where a guy trades on real public figures on Pauv. The caption reads like:
${examples(DEGEN_EXAMPLES)}
The rest of the caption is already written. You give the nickname, and its short form.

NICKNAME: ${NICKNAME_RULE}
SHORT: the one word you would say it with in "i love you ___", like swifty, sabby for sabby c, kai for kai cenat. Empty when no single word of the nickname says it on its own.

NICKNAMES THAT LANDED
${NICKNAMES}

Reply as JSON: {"nickname": "...", "short": "..."}.`;

const NICKNAME_FORMAT: Anthropic.Beta.BetaJSONOutputFormat = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: { nickname: { type: 'string' }, short: { type: 'string' } },
    required: ['nickname', 'short'],
    additionalProperties: false,
  },
};

/** A name as the line says it: lower case, letters, numbers and the odd
 *  apostrophe, dot or hyphen, three words at most. */
const asName = (v: unknown): string => (typeof v === 'string' ? v : '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}'.\- ]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .split(' ')
  .slice(0, 3)
  .join(' ');

function degenLine(reply: string, person: string, descriptor: string, verb: string): string {
  let j: { nickname?: unknown; short?: unknown } = {};
  try { j = JSON.parse(reply) as typeof j; } catch { /* the plain name, below */ }
  const nickname = asName(j.nickname) || asName(person);
  const short = asName(j.short).split(' ')[0];
  const tail = short && short.length <= LOVE_MAX && Math.random() < LOVE_ODDS
    ? `(i love you ${short})`
    : `(${pick(SELF_OWNS)}) ${pick(DEGEN_EMOJI)}`;
  return `${descriptor} ${verb} ${nickname} ${tail}`;
}

// ── The twists: mystery, hype and me if ──────────────────────────────────────

const MYSTERY = `${PAUV}

THIS CAPTION NEVER SAYS WHO. It is the trade on someone the viewer has to recognise without their name, and the video that follows shows who it is.

THE ORDER:
  <trading verb> <who they are, never by name>

TRADING VERB: the first words of the line, always. It is one of "trading on", "going long on" or "shorting", and the one to use is given below. Use exactly that one.
WHO THEY ARE: the way the culture already talks about them, as a superlative or a line anyone would place, like "the greatest musician of our generation", "the most hated man in america", "every girl's celebrity crush", "the guy your dad won't stop talking about", "the goat". Praise, a knock or how the internet sees them all work, as long as it fits this person well enough that the reveal lands.

RULES
- Never their name, any part of it, or a nickname.
- No emoji, no hashtags, no quote marks, no full stop.
- All lower case.

EXAMPLES
${examples(MYSTERY_EXAMPLES)}

They show the shape and the tone. Write one that fits this person; take one of these only when it fits them better than anything new would.

${REPLY}`;

/** Hype says the name everyone calls them — or, in Degen, the nickname — so
 *  its examples come both ways (HYPE_NAMED, HYPE_NICKNAMED). */
const hype = (nickname: boolean) => `${PAUV}

THE ORDER:
  <${nickname ? 'their nickname' : 'their name'}> <where they are headed>

${nickname
    ? `NICKNAME: ${NICKNAME_RULE}\n\nNICKNAMES THAT LANDED\n${NICKNAMES}`
    : 'NAME: the name everyone actually calls them, the way the examples write it. No nicknames.'}
WHERE THEY ARE HEADED: up, as high as it goes, like "to the sky", "to the stratosphere", "to the heavens", "through the roof", "to outer space", "to the top floor". Stretch a word when it lands: "skyyyyy".

RULES
- No trading verb and no money: the name and where it is headed, nothing else.
- No emoji, no hashtags, no quote marks, no full stop.
- All lower case.

EXAMPLES
${examples(nickname ? HYPE_NICKNAMED : HYPE_NAMED)}

They show the shape and the tone. Write a new one for this person; never hand one of these back.

${REPLY}`;

/** Me if says the name everyone calls them — or, in Degen, the nickname — so
 *  its examples come both ways too (ME_IF_NAMED, ME_IF_NICKNAMED).
 *
 *  Where it catches him is Middle's activity in another frame: taken off what
 *  the video shows, never invented. It asked for "somewhere it would be out of
 *  line" and was told nothing about the footage until 2026-09-18, so the model
 *  had to make the moment up, and the line landed on the stage claiming
 *  something the video never showed. A build with no context has nothing to
 *  catch him at, so the twist is not drawn at all — see NO_CONTEXT_TWISTS. */
const meIf = (nickname: boolean) => `${PAUV}

THE ORDER, every time:
  me if <trading verb> <${nickname ? 'their nickname' : 'their name'}> <what he is in the middle of> was legal

TRADING VERB: one of "trading on", "going long on" or "shorting", and the one to use is given below. Use exactly that one.
${nickname
    ? `NICKNAME: ${NICKNAME_RULE}\n\nNICKNAMES THAT LANDED\n${NICKNAMES}\n`
    : 'NAME: the name everyone actually calls them, the way the examples write it. No nicknames.'}
WHAT HE IS IN THE MIDDLE OF: what the guy in the video is doing, given below, said casually so it reads straight after the name: "in the hot tub", "mid haircut", "half asleep", "with a mouth full of cereal", "on the treadmill". Take it only from what the video shows and never make one up — the joke is that he is trading through the very thing he is doing, and a moment he was never in is a lie about the video rather than a joke. Say it your own way rather than copying the words given.

RULES
- It always opens "me if" and always ends "was legal".
- Nothing about where he is that the video does not show: no funerals, weddings, jury duty or job interviews unless that is what is given below.
- No emoji, no hashtags, no quote marks, no full stop.
- All lower case.

EXAMPLES
${examples(nickname ? ME_IF_NICKNAMED : ME_IF_NAMED)}

They show the shape and the tone. Write a new one for this video; never hand one of these back.

${REPLY}`;

/** Words that carry no one's identity on their own, so "the" in a name never
 *  counts as naming them. */
const NAME_STOPWORDS = new Set(['the', 'and', 'for', 'von', 'van', 'der', 'den', 'del', 'dos', 'jnr', 'snr']);

/** Whether a mystery gave the game away: any distinctive word of the name,
 *  on its own, anywhere in the line. */
function namesPerson(line: string, person: string): boolean {
  return person.toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !NAME_STOPWORDS.has(w))
    .some((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${w}($|[^\\p{L}\\p{N}])`, 'u').test(line));
}

function mysteryPlan({ person, direction }: Input): Plan {
  const verb = pick(VERBS[direction]);
  return {
    system: MYSTERY,
    ask: [`person: ${person}`, which(direction), `open with: ${verb}`].join('\n'),
    finish: (reply) => {
      const line = holdVerb(clean(reply), verb, true);
      return line && !namesPerson(line, person) ? line : null;
    },
  };
}

function hypePlan({ mode, person }: Input): Plan {
  return {
    system: hype(mode === 'degen'),
    ask: `person: ${person}`,
    finish: (reply) => {
      const line = clean(reply);
      return line && !/^(trading on|going long on|shorting|shorts|goes long on|trades on)\b/.test(line) ? line : null;
    },
  };
}

function meIfPlan({ mode, person, direction, personaContext }: Input): Plan {
  const verb = pick(VERBS[direction]);
  return {
    system: meIf(mode === 'degen'),
    ask: [
      `person: ${person}`,
      which(direction),
      `trading verb: ${verb}`,
      `what the guy in the video is doing: ${personaContext}`,
    ].join('\n'),
    // Held to its frame: "me if", the trade on the drawn verb straight after
    // it, and "was legal" at the end.
    finish: (reply) => {
      const line = clean(reply);
      if (!line.startsWith('me if ') || !line.endsWith(' was legal')) return null;
      const trade = holdVerb(line.slice('me if '.length), verb, true);
      return trade ? `me if ${trade}` : null;
    },
  };
}

// ── Holding a line to its rules ──────────────────────────────────────────────

/** Emoji and the pieces they are built from, which Serious and Middle keep off
 *  the line. */
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/gu;

/** The model's reply as the caption takes it: the first line, no label, no
 *  emoji, no hashtags, no quotes around it or full stop after it, lower case. */
function clean(raw: string): string {
  const first = raw
    .replace(/```[a-z]*/gi, '')
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean) ?? '';
  return first
    .replace(/^(caption|hook|start|line)\s*[:–—-]\s*/i, '')
    .replace(EMOJI, '')
    .replace(/#\S+/g, '')
    .replace(/["“”`]/g, '')
    .replace(/^['‘’]+|['‘’]+$/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s.!,;:]+$/, '')
    .trim();
}

/** The line held to its trade: kept as it is on the drawn verb, swapped onto it
 *  from either of the other two, and null when the trade is missing — or, for
 *  a line it has to open, is not where it opens. */
function holdVerb(line: string, verb: string, opens: boolean): string | null {
  const m = line.match(opens ? /^(trading on|going long on|shorting)\b/ : /\b(trading on|going long on|shorting)\b/);
  if (!m || m.index == null) return null;
  return m[1] === verb ? line : `${line.slice(0, m.index)}${verb}${line.slice(m.index + m[1].length)}`;
}

/** Serious and Middle may never say "man" — unless it is part of the name. */
const noMan = (line: string | null, person: string): string | null =>
  line && /\bman\b/.test(line) && !/\bman\b/i.test(person) ? null : line;

/** Each twist's plan. Which ones a trade can take is TWISTS — hype only ever
 *  goes up. */
const TWIST_PLAN: Record<Twist, (input: Input) => Plan> = {
  mystery: mysteryPlan,
  hype: hypePlan,
  meIf: meIfPlan,
};

/** What this call writes: now and then a twist, otherwise the mode's own. Me if
 *  is written off what the video shows, so a build with no context draws from
 *  the twists that need none. Middle takes no twist: its mystery is a slot in
 *  its own while shape. */
function planFor(input: Input): Plan {
  if (input.mode === 'middle' || Math.random() >= TWIST_ODDS) return modePlan(input);
  const twists = input.personaContext ? TWISTS : NO_CONTEXT_TWISTS;
  return TWIST_PLAN[pick(twists[input.direction])](input);
}

function modePlan(input: Input): Plan {
  const { mode, person, direction } = input;
  if (mode === 'degen') {
    const descriptor = pick(DESCRIPTORS);
    const verb = pick(DEGEN_VERBS[direction]);
    return {
      system: DEGEN,
      ask: `person: ${person}`,
      format: NICKNAME_FORMAT,
      finish: (reply) => degenLine(reply, person, descriptor, verb),
    };
  }
  if (mode === 'serious') {
    const verb = pick(VERBS[direction]);
    return {
      system: SERIOUS,
      ask: [`person: ${person}`, which(direction), `open with: ${verb}`].join('\n'),
      finish: (reply) => noMan(holdVerb(clean(reply), verb, true), person),
    };
  }
  return middlePlan(input);
}

// ── The call ─────────────────────────────────────────────────────────────────

/** Built on first use, so a missing key is an answer from the route rather
 *  than a crash when the module loads. */
let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ timeout: 60_000, maxRetries: 2 }));

async function draft(plan: Ask): Promise<string> {
  const res = await anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    // One short line: low effort thinks a little, where medium spent tokens
    // the line didn't need.
    output_config: { effort: 'low', ...(plan.format ? { format: plan.format } : {}) },
    // No server-side fallback: Sonnet 5 has no allowed fallback models (the
    // Models API lists none), so a decline comes back as a refusal and the
    // second go below draws afresh.
    system: plan.system,
    messages: [{ role: 'user', content: plan.ask }],
  });
  if (res.stop_reason === 'refusal') throw new Error('the model declined to write it');
  if (res.stop_reason === 'max_tokens') throw new Error('the model ran out of room before the line');
  return res.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  let lastErr = '';
  // Two goes, each drawing afresh — twist, shape and all: the realistic
  // failures are a line with no trade where one was asked for, one with "man"
  // in it, or a mystery that names them, and a fresh draw fixes those more
  // often than not.
  for (let attempt = 0; attempt < HOOK_ATTEMPTS; attempt++) {
    try {
      const plan = planFor(parsed.data);
      const line = 'line' in plan ? plan.line : plan.finish(await draft(plan));
      if (!line) throw new Error('the line broke its rules');
      return NextResponse.json({ start: line });
    } catch (err) {
      lastErr = err instanceof Anthropic.APIError
        ? `Claude ${err.status ?? ''}: ${err.message}`.trim()
        : err instanceof Error ? err.message : String(err);
      console.error('[vids hook] attempt', attempt + 1, 'failed:', lastErr);
      // A key or request problem is not going to fix itself on a second go.
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.BadRequestError) break;
    }
  }
  return NextResponse.json({ error: `Hook: ${lastErr || 'empty response'}` }, { status: 502 });
}
