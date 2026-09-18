// POST /api/vids/hook — the Start caption on its own, written to the guide for
// the mode Vids 2's form was set to. None of these hooks is written off the
// screen recordings, so none of them is written alongside the step-by-step
// lines (api/vids/captions): each is written here, from who the video trades
// on, which way, and — for Middle, which says what he is doing — the persona's
// context.
//
// SERIOUS is one flat line in a fixed order: the trading verb, the person, now
// and then a real-world moment that gives the trade a reason, and what the
// money does. Nothing about what the guy on camera is doing. The joke is how
// straight-faced it is.
//
//   going long on taylor swift before the tour announcement to cover a year of rent
//   shorting drake before the album drops to pay off the car
//
// MIDDLE (the form's name for normal) uses exactly two of three parts — a
// money analogy, what he is doing on camera, the trade — in one of three
// combos. The funnier the gap between the money and the activity, the better.
//
//   making a surgeon's salary from the hot tub          analogy + activity
//   shorting drake mid haircut                          trade + activity
//   how to make a lawyer's salary shorting kanye        analogy + trade
//
// Middle's fourth combo is the CLOCK: the money against how little time it
// took, with no trade and no name. Its time is a task — one off a fixed pool,
// or what he is doing on camera said as a task — or a drawn number with what
// he is doing after "while". Like Degen, the line is put together here: the
// model gives the parts (the money, and the task or the activity when the
// branch needs one), so it can't open wrong, lose its "while" or carry a
// number and a task at once. A context that is only a place or a state has no
// task in it, and the task comes off the pool instead.
//
//   making rent in the time it takes to lose an argument            pool
//   making rent in the time it takes to put a hammer in my mouth    context
//   making a car payment in 41 seconds while eating cereal          number
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
// Whatever the mode, one hook in five is a TWIST instead, one of three at even
// odds: a MYSTERY, the trade on someone described but never named; HYPE, the
// name and how high they are going; or ME IF, the trade somewhere it would be
// out of line, "was legal". Hype only goes up, so a down trade's twist is a
// mystery or a me if. Degen's hype and me if say the nickname; everything else
// about the three is the same in every mode, Serious and Middle's trading
// verbs included.
//
//   shorting the greatest musician of our generation     mystery
//   messi to the stratosphere                            hype
//   me if shorting drake at a funeral was legal          me if
//
// Everything that is a choice between fixed options is drawn here rather than
// left to the model — the verb, Middle's combo, and all of Degen but the
// nickname — so builds spread across them instead of resting on whichever one
// the model favours. Down is always "shorting" / "shorts"; up is "going long
// on" or "trading on" / "goes long on" or "trades on", even odds. A Middle
// build with no persona context has no activity to name, so it is analogy +
// trade or the clock off the pool. The lists, the odds and every guide's examples live in
// lib/vids2/hookRules, which the tuning page's guide to all of this
// (components/vids2/Vids2HookGuide) reads too.
//
// What the model writes is held to the rules rather than trusted with them:
// lower-cased, stripped of emoji, quotes and a full stop, and a trade said on
// the wrong verb has it swapped for the drawn one. A Serious or Middle line
// with no trade where one was asked for, or with "man" in it, is written again.
// So is a clock line with a trading verb in it, a "while" or a time of its own
// in its task, or no activity where the number branch needs one.
// A Degen nickname that comes back as nothing is the plain name. A mystery that
// names them, a hype line that opens on a trade, or a me if out of its frame
// is written again.
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
  CLOCK_BRANCH_ODDS, CLOCK_BRANCHES, CLOCK_EXAMPLES, CLOCK_NUMBERS, CLOCK_TASKS, COMBOS, DEGEN_EMOJI,
  DEGEN_EXAMPLES, DEGEN_VERBS, DESCRIPTORS, HOOK_ATTEMPTS, HYPE_NAMED, HYPE_NICKNAMED, LOVE_MAX, LOVE_ODDS,
  ME_IF_NAMED, ME_IF_NICKNAMED, MIDDLE_EXAMPLES, MYSTERY_EXAMPLES, NICKNAME_EXAMPLES, NO_CONTEXT_CLOCK_BRANCH,
  NO_CONTEXT_COMBOS, SELF_OWNS, SERIOUS_EXAMPLES, TWIST_ODDS, TWISTS, VERBS,
  type ClockBranch, type Combo, type Twist,
} from '@/lib/vids2/hookRules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODEL = 'claude-sonnet-5';

const Body = z.object({
  mode: z.enum(['serious', 'middle', 'degen']),
  /** Who the video trades on, as the Pauv roster spells them. */
  person: z.string().trim().min(1).max(80),
  direction: z.enum(['up', 'down']),
  /** What the persona is doing on camera — Middle's activity. The other two
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
interface Plan {
  system: string;
  ask: string;
  format?: Anthropic.Beta.BetaJSONOutputFormat;
  finish: (reply: string) => string | null;
}

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

const hasTrade = (c: Combo) => c.includes('trade');
const hasActivity = (c: Combo) => c.includes('activity');

const MIDDLE = `${PAUV}

THE THREE PARTS. Every caption uses exactly TWO of them, and which two is given below.
MONEY ANALOGY: the payout compared to something relatable, like "a surgeon's salary", "a year of rent", "lebron money", "a ceo's bonus". The money part usually starts with "making" or "out-earning".
ACTIVITY: what the guy in the video is doing, like "in the hot tub", "mid haircut", "with a mouth full of cereal", "on the treadmill". Take it from what the video shows, given below, and say it casually; never make one up. Casual, mundane or absurd: the funnier the contrast with the money, the better.
TRADE: the trading verb plus the person's full, normal name, like "shorting drake" or "going long on taylor swift". The verb is one of "trading on", "going long on" or "shorting", and the one to use is given below. Use exactly that one.

THE THREE COMBOS
  analogy + activity: making a surgeon's salary from the hot tub
  trade + activity: shorting drake mid haircut
  analogy + trade: how to make a lawyer's salary shorting kanye

You may open with "how to", and the money part then reads "how to make". It works best with analogy + trade.

RULES
- Never the word "man".
- No emoji, no hashtags, no quote marks, no full stop.
- All lower case, names and acronyms included.

EXAMPLES
${examples(MIDDLE_EXAMPLES)}

They show the combos and the tone. Write a new line for this video; never hand one of these back.

${REPLY}`;

// ── Middle's clock ───────────────────────────────────────────────────────────

const CLOCK = `${PAUV}

THIS CAPTION IS THE MONEY AGAINST THE CLOCK: what the payout is worth, next to how little time it took. No trade, no trading verb, no one's name. The line is put together from the parts you give, so you write only the parts asked for.

THE LINE comes out one of two ways:
  <opener> <money analogy> in the time it takes to <task>
  <opener> <money analogy> in <how long> while <what he is doing>

OPENER: "making" or "out-earning", yours to choose, "making" most of the time. With "out-earning" the analogy is who or what gets out-earned, like "my landlord".
MONEY ANALOGY: the payout next to something relatable. Small and everyday beats big: a week of groceries, a month of gas, a year of netflix, rent, a bartender's night, a car payment. A salary-sized one ("a surgeon's salary", "lebron money") is fine now and then, never the default. Pick one that plays against the task or the time given.
TASK (only when asked for): what the guy in the video is doing, given below, said as a task with a clear start and end, first person: "put a hammer in my mouth", "tape my mouth shut", "put on a suit of armor", "crack open a beer". Wearing or being in something he could put on becomes putting it on. Take it only from what the video shows and never make one up. A place he is at or a state he is just in is not a task: "sit in a chair", "lie in the road", "be in a grocery store" are not tasks, and when that is all the video gives you, the task is "" and the line takes one of its own. Say it your own way rather than copying the words given.
WHAT HE IS DOING (only when asked for): what the guy in the video is doing, said casually so it reads straight after "while": "in the hot tub", "half asleep", "eating cereal", "getting a haircut", "on the toilet". Give it without the "while". Take it from what the video shows and never make one up.

RULES
- Never the word "man".
- No trading verb, no "how to", no one's name except inside a money analogy like "lebron money".
- No "while" in a task, and no time or number in a task or what he is doing: the line already has its time.
- No emoji, no hashtags, no quote marks, no full stop. All lower case.

EXAMPLES, whole lines as they come out
${examples([...CLOCK_EXAMPLES.pool, ...CLOCK_EXAMPLES.context, ...CLOCK_EXAMPLES.number])}

They show the shape and the tone. Write new parts for this video; never hand one of these back.

Reply as JSON: {"opener": "...", "analogy": "...", "task": "...", "activity": "..."}, with "" for any part not asked for.`;

const CLOCK_FORMAT: Anthropic.Beta.BetaJSONOutputFormat = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      opener: { type: 'string', enum: ['making', 'out-earning'] },
      analogy: { type: 'string' },
      task: { type: 'string' },
      activity: { type: 'string' },
    },
    required: ['opener', 'analogy', 'task', 'activity'],
    additionalProperties: false,
  },
};

/** The branch a clock line takes: by CLOCK_BRANCH_ODDS with a context to take
 *  a task or an activity from, the pool without one. */
function clockBranch(hasContext: boolean): ClockBranch {
  if (!hasContext) return NO_CONTEXT_CLOCK_BRANCH;
  let r = Math.random();
  for (const b of CLOCK_BRANCHES) {
    r -= CLOCK_BRANCH_ODDS[b];
    if (r < 0) return b;
  }
  return CLOCK_BRANCHES[CLOCK_BRANCHES.length - 1];
}

/** Every way a trade is said, Degen's included, which a clock line never has. */
const ANY_TRADE = /\b(trading on|going long on|shorting|shorts|goes long on|trades on)\b/;
/** A time of its own, which a task or an activity must not bring: the line's
 *  time is already drawn. */
const A_TIME = /\bin the time it takes\b|\b\d+\s*(seconds?|secs?|minutes?|mins?|hours?)\b/;

/** One part of the model's reply as the line takes it: no emoji, hashtags,
 *  quotes or trailing stop, lower case, one line — and anything it repeated
 *  from the frame around it (`frame`, at the start) taken off. */
const clockPart = (v: unknown, frame: RegExp): string => (typeof v === 'string' ? v : '')
  .replace(EMOJI, '')
  .replace(/#\S+/g, '')
  .replace(/["“”`]/g, '')
  .replace(/^['‘’]+|['‘’]+$/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .replace(/[\s.!,;:]+$/, '')
  .trim()
  .replace(frame, '')
  .trim();

function clockPlan(personaContext: string): Plan {
  const branch = clockBranch(!!personaContext);
  // Drawn for the pool, and for the context branch to fall back on when the
  // context has no task in it.
  const task = pick(CLOCK_TASKS);
  const number = pick(CLOCK_NUMBERS);
  const ask = branch === 'pool'
    ? ['write: the opener and the money analogy', `task (already chosen): ${task}`]
    : branch === 'context'
      ? ['write: the opener, the money analogy and the task', `what the guy in the video is doing: ${personaContext}`]
      : [
        'write: the opener, the money analogy and what he is doing',
        `how long (already chosen): ${number}`,
        `what the guy in the video is doing: ${personaContext}`,
      ];
  return {
    system: CLOCK,
    ask: ask.join('\n'),
    format: CLOCK_FORMAT,
    finish: (reply) => {
      let j: { opener?: unknown; analogy?: unknown; task?: unknown; activity?: unknown } = {};
      try { j = JSON.parse(reply) as typeof j; } catch { return null; }
      const opener = j.opener === 'out-earning' ? 'out-earning' : 'making';
      const analogy = clockPart(j.analogy, /^(how to make|how to|making|make|out-earning)\s+/);
      if (!analogy || A_TIME.test(analogy) || /\bwhile\b/.test(analogy)) return null;
      let time: string;
      if (branch === 'number') {
        const activity = clockPart(j.activity, /^while\s+/);
        if (!activity || A_TIME.test(activity)) return null;
        time = `in ${number} while ${activity}`;
      } else {
        const written = branch === 'context' ? clockPart(j.task, /^(in the time it takes\s+)?(to\s+)?/) : '';
        // The context branch's task has no "while" and no time of its own; an
        // empty one is a context with no task in it, and the pool stands in.
        if (written && (/\bwhile\b/.test(written) || A_TIME.test(written))) return null;
        time = `in the time it takes to ${written || task}`;
      }
      const line = `${opener} ${analogy} ${time}`;
      return ANY_TRADE.test(line) ? null : line;
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
 *  its examples come both ways too (ME_IF_NAMED, ME_IF_NICKNAMED). */
const meIf = (nickname: boolean) => `${PAUV}

THE ORDER, every time:
  me if <trading verb> <${nickname ? 'their nickname' : 'their name'}> <somewhere it would be out of line> was legal

TRADING VERB: one of "trading on", "going long on" or "shorting", and the one to use is given below. Use exactly that one.
${nickname
    ? `NICKNAME: ${NICKNAME_RULE}\n\nNICKNAMES THAT LANDED\n${NICKNAMES}\n`
    : 'NAME: the name everyone actually calls them, the way the examples write it. No nicknames.'}
SOMEWHERE IT WOULD BE OUT OF LINE: a place, a moment or something he is in the middle of where pulling out a phone to trade would be wrong, said casually: in a ..., at ..., during ..., doing a .... Mundane or solemn; the more out of place, the better.

RULES
- It always opens "me if" and always ends "was legal".
- No emoji, no hashtags, no quote marks, no full stop.
- All lower case.

EXAMPLES
${examples(nickname ? ME_IF_NICKNAMED : ME_IF_NAMED)}

They show the shape and the tone. Write a new one for this person; never hand one of these back.

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

function meIfPlan({ mode, person, direction }: Input): Plan {
  const verb = pick(VERBS[direction]);
  return {
    system: meIf(mode === 'degen'),
    ask: [`person: ${person}`, which(direction), `trading verb: ${verb}`].join('\n'),
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

/** What this call writes: now and then a twist, otherwise the mode's own. */
function planFor(input: Input): Plan {
  return Math.random() < TWIST_ODDS ? TWIST_PLAN[pick(TWISTS[input.direction])](input) : modePlan(input);
}

function modePlan({ mode, person, direction, personaContext }: Input): Plan {
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
  const combo: Combo = pick(personaContext ? COMBOS : NO_CONTEXT_COMBOS);
  // The clock has a guide and a shape of its own; "man" is held off it too.
  if (combo === 'analogy + clock') {
    const clock = clockPlan(personaContext);
    return { ...clock, finish: (reply) => noMan(clock.finish(reply), person) };
  }
  const verb = hasTrade(combo) ? pick(VERBS[direction]) : null;
  return {
    system: MIDDLE,
    ask: [
      `write: ${combo}`,
      `person: ${person}`,
      which(direction),
      ...(verb ? [`trading verb: ${verb}`] : []),
      ...(hasActivity(combo) ? [`what the guy in the video is doing: ${personaContext}`] : []),
    ].join('\n'),
    finish: (reply) => {
      const line = clean(reply);
      return noMan(verb ? holdVerb(line, verb, false) : line || null, person);
    },
  };
}

// ── The call ─────────────────────────────────────────────────────────────────

/** Built on first use, so a missing key is an answer from the route rather
 *  than a crash when the module loads. */
let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ timeout: 60_000, maxRetries: 2 }));

async function draft(plan: Plan): Promise<string> {
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
  // Two goes, each drawing afresh — twist and all: the realistic failures are
  // a line with no trade where one was asked for, one with "man" in it, or a
  // mystery that names them, and a fresh draw fixes those more often than not.
  for (let attempt = 0; attempt < HOOK_ATTEMPTS; attempt++) {
    try {
      const plan = planFor(parsed.data);
      const line = plan.finish(await draft(plan));
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
