// POST /api/vids/hook — the Start caption on its own, written to the guide for
// the mode Vids 2's form was set to. None of these hooks is written off the
// screen recordings, so none of them is written alongside the step-by-step
// lines (api/vids/captions): each is written here, from who the video trades
// on, which way, and — for Middle's parenthetical and the me if twist — the
// persona's context.
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
// then takes one of four shapes, drawn here by MIDDLE_SHAPE_ODDS: the
// persona's parenthetical straight after the analogy, or the money against
// how little time it took — a drawn number of seconds, with or without the
// parenthetical on the end, or "in the time it takes to" a drawn task. The
// analogy, the seconds and the task are all off lists in lib/vids2/hookRules,
// and the parenthetical is what the persona's context says in parentheses
// ("wearing a knight helmet (with a fresh fit)"), word for word and without
// the brackets, so every shape is put together here with no model call — save
// the while shape's other half, the MYSTERY (1 - MIDDLE_PARENTHETICAL_ODDS of
// its lines, and all of them when the context has no parenthetical): the
// trade on someone described but never named, on a verb fixed by which way —
// "trading on" up, "shorting" down — set straight after the analogy. Middle
// takes no twist; its mystery is that slot.
//
//   making a lawyer's salary with a fresh fit                       while · the parenthetical
//   making a year of gas shorting the greatest rapper alive         while · the mystery
//   making drake's salary in 67 seconds with a fresh fit            seconds + parenthetical
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
// odds: a MYSTERY, the trade on someone described but never named — in a take
// ("the most erratic billionaire alive"), never a fact ("the richest man in
// the world"), so the viewer wonders who; HYPE, the
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
// Me if is the one twist written off the video: where it catches him comes from
// the persona's context, what he is doing on camera, and is never invented, so
// a build with no context draws from the other twists instead (NO_CONTEXT_TWISTS).
//
// Everything that is a choice between fixed options is drawn here rather than
// left to the model — the verb, Middle's shape and every part of it but the
// mystery, and all of Degen but the nickname — so builds spread across them
// instead of resting on whichever one the model favours. Down is always
// "shorting" / "shorts"; up is "going long on" or "trading on" / "goes long
// on" or "trades on", even odds. A Middle build whose context has no "(...)"
// has no parenthetical, so its while shape is the mystery and its seconds +
// parenthetical shape stops at its time. The lists, the odds and every
// guide's examples live in lib/vids2/hookRules, which the tuning page's guide
// to all of this (components/vids2/Vids2HookGuide) reads too.
//
// What the model writes is held to the rules rather than trusted with them:
// lower-cased, stripped of emoji, quotes and a full stop, and a trade said on
// the wrong verb has it swapped for the drawn one. A Serious line with no
// trade where one was asked for, or with "man" in it, is written again. A
// Degen nickname that comes back as nothing is the plain name. A mystery that
// names them, states a fact about them (FACTUAL: richest, most streamed, a
// title, a count) or describes them in a clause (CLAUSE: who, that), a hype
// line that opens on a trade, or a me if out of its frame is written again.
//
// Every ask that names the person also says who they are — their industry and
// bio off the Pauv roster (lib/vids2/whoIs) — and the guides that reason about
// the person's world (Serious's catalyst, the mystery) are told to take it from
// there and never guess one. A name alone had the model guessing: Clavicular,
// a looksmaxxing streamer, came back as "the most overhyped rookie in the
// game". A name the roster doesn't have goes without, and the guides then keep
// to what they know.
//
// Written by DeepSeek (lib/deepseek: deepseek-v4-flash unless DEEPSEEK_MODEL
// says otherwise) rather than the Gemini Flash-Lite the rest of the words use.
// The job is tone plus knowing the person well enough to name a real moment in
// their year or a nickname that lands, which Flash-Lite wrote flat. It was
// Claude Opus 5 at medium effort until 2026-09-18 and Claude Sonnet 5 at low
// effort until 2026-09-25, each swapped for cost: the code draws most of every
// line (verbs, Middle's shapes, Degen's parts), so what is left for the model
// is short enough that the bigger ones weren't earning their price.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { deepseekChat, parseJson } from '@/lib/deepseek';
import {
  DEGEN_EMOJI, DEGEN_EXAMPLES, DEGEN_VERBS, DESCRIPTORS, HOOK_ATTEMPTS, HYPE_NAMED, HYPE_NICKNAMED, LOVE_MAX,
  LOVE_ODDS, ME_IF_NAMED, ME_IF_NICKNAMED, MIDDLE_ANALOGIES, MIDDLE_MYSTERY_VERBS, MIDDLE_PARENTHETICAL_ODDS,
  MIDDLE_SECONDS, MIDDLE_SHAPE_ODDS, MIDDLE_SHAPES, MIDDLE_TASKS, MYSTERY_EXAMPLES, NICKNAME_EXAMPLES,
  NO_CONTEXT_TWISTS, SELF_OWNS, SERIOUS_EXAMPLES, TWIST_ODDS, TWISTS, VERBS, parentheticalsOf,
  type MiddleShape, type Twist,
} from '@/lib/vids2/hookRules';
import { whoIs, type Who } from '@/lib/vids2/whoIs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  mode: z.enum(['serious', 'middle', 'degen']),
  /** Who the video trades on, as the Pauv roster spells them. */
  person: z.string().trim().min(1).max(80),
  direction: z.enum(['up', 'down']),
  /** The persona's context: what he is doing on camera, with what it says in
   *  parentheses. Middle takes only the parentheses, word for word; the me if
   *  twist reads what he is doing; Serious and Degen never mention it. */
  personaContext: z.string().trim().max(600).default(''),
});

/** The body, with who the person is off the roster — null when it has no
 *  such name. */
type Input = z.infer<typeof Body> & { who: Who | null };
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
  /** Asked for a JSON object rather than a line (Degen's nickname). */
  json?: boolean;
  finish: (reply: string) => string | null;
}

/** A hook is asked of the model, or — Middle's shapes off the lists — put
 *  together here with no call at all. */
type Plan = Ask | { line: string };

const which = (direction: Direction) =>
  `which way: ${direction === 'up' ? 'up, backing them' : 'down, betting against them'}`;

/** Who they are, for the ask — nothing when the roster didn't know them. */
const whoLine = (who: Who | null): string[] => (who ? [`who they are: ${who.summary}`] : []);

// ── Serious ──────────────────────────────────────────────────────────────────

const SERIOUS = `${PAUV}

THE ORDER, every time:
  <trading verb> <person> <catalyst, optional> <money outcome>

TRADING VERB: the first words of the line, always. It is one of "trading on", "going long on" or "shorting", and the one to use is given with the person. Use exactly that one.
PERSON: their full, normal name, the name everyone actually calls them, the way the examples write it. No nicknames.
CATALYST (optional): between the person and the money, a real-world moment that gives the trade a reason, like "ahead of midterms", "before the album drops", "after the trade deadline". It has to belong to this person's actual world, which is given below as who they are, off Pauv's own listing: a tour or an album for a musician, the playoffs for a player, earnings or a launch for a founder, a stream or a stunt for a streamer. Never a moment from a world they are not in. When who they are is not given and you are not sure, leave it out rather than guess.
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
// Put together here from the drawn parts. The model is asked for the mystery
// on the while shape's other half, and for nothing else.

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

function middlePlan({ person, direction, personaContext, who }: Input): Plan {
  // One of the context's "(...)"s, word for word and without the brackets, with
  // the space that sets it on the end of a line — or nothing, when it has none.
  const parentheticals = parentheticalsOf(personaContext);
  const parenthetical = parentheticals.length ? ` ${pick(parentheticals)}` : '';
  const opening = `making ${analogyFor(person)}`;
  const shape = middleShape();
  if (shape !== 'while') {
    const time = shape.startsWith('seconds')
      ? `in ${pick(MIDDLE_SECONDS)} seconds`
      : `in the time it takes to ${pick(MIDDLE_TASKS)}`;
    // A context with no parenthetical leaves the parenthetical shape at its time.
    return { line: `${opening} ${time}${shape.endsWith('parenthetical') ? parenthetical : ''}` };
  }
  // The while shape: the parenthetical straight after the analogy, or the
  // mystery. With no parenthetical it is the mystery.
  if (parenthetical && Math.random() < MIDDLE_PARENTHETICAL_ODDS) return { line: `${opening}${parenthetical}` };
  // The mystery sits straight after the analogy too: "making lebron's salary
  // shorting the goat".
  const verb = MIDDLE_MYSTERY_VERBS[direction];
  return {
    system: MYSTERY,
    ask: [`person: ${person}`, ...whoLine(who), which(direction), `open with: ${verb}`].join('\n'),
    finish: (reply) => {
      const mystery = holdMystery(reply, verb, person);
      return mystery ? `${opening} ${mystery}` : null;
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
  try { j = parseJson<typeof j>(reply); } catch { /* the plain name, below */ }
  const nickname = asName(j.nickname) || asName(person);
  const short = asName(j.short).split(' ')[0];
  const tail = short && short.length <= LOVE_MAX && Math.random() < LOVE_ODDS
    ? `(i love you ${short})`
    : `(${pick(SELF_OWNS)}) ${pick(DEGEN_EMOJI)}`;
  return `${descriptor} ${verb} ${nickname} ${tail}`;
}

// ── The twists: mystery, hype and me if ──────────────────────────────────────

const MYSTERY = `${PAUV}

THIS CAPTION NEVER SAYS WHO. It is the trade on someone the viewer has to recognise without their name, and the video that follows shows who it is. The line has to make them go "ooo, who is that" — a take they could argue with, never a fact they would nod at.

THE ORDER:
  <trading verb> <who they are, never by name>

TRADING VERB: the first words of the line, always. It is one of "trading on", "going long on" or "shorting", and the one to use is given below. Use exactly that one.
WHO THEY ARE: a take, never a fact, in the shape that lands — a superlative on what they are, with where it holds on the end: "the most overhyped athlete on the planet", "the softest rapper alive", "the most emotional rapper alive", "the most erratic billionaire alive", "the most hated man in america". Or a short epithet the internet already uses: "the antichrist", "the goat". It is the strongest thing a fan or a hater would say about them, the kind the other would argue with, and it has to fit this person well enough that the reveal lands. Praise and a knock both work; the knock usually lands harder.
NEVER A DESCRIPTION: no clause that walks around them — not "the woman who owns the music industry", not "the guy who runs the biggest company on earth", not "the man behind the biggest album of the year". A "who" or a "that" turns the line into a fact dressed up as a flex, and it reads flat. Say what they are and how much, in six or seven words. And always a person, never a thing standing in for one: not "the music industry", but "the most untouchable woman in music".
NEVER A FACT: nothing anyone could look up. Not their job or title, not their team, not a record, a count or a ranking, not what they are the richest, most streamed, most followed or highest paid at. "the richest man in the world" is a fact and is wrong here; "the most erratic billionaire alive" is the line. A word like billionaire, rapper or streamer may sit inside the take, but the take is the point of the line, not the word.
Who they are is given below, off Pauv's own listing, so you know who you are writing about. Take their world from it — a streamer is a streamer, a rapper a rapper, a politician a politician — and never put them in a sport, a job or a field it does not say. Never quote the listing back: its facts are exactly what the line must not say. When nothing is given and you are not sure who they are, say how the internet talks about someone like them rather than guess a career: never a rookie, an athlete or a musician unless that is what they are.

RULES
- Never their name, any part of it, or a nickname.
- Never a fact: no title, team, record, count, ranking or "richest / most streamed / highest paid".
- Never a clause: no "who", "whose", "which" or "that".
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
 *  Where it catches him is what the persona's context says he is doing: taken
 *  off what the video shows, never invented. It asked for "somewhere it would be out of
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

/** A fact about them, which a mystery must never be: what they are richest,
 *  most streamed or highest paid at, a title, a team's kind of word, a count.
 *  The line is a take — "the most erratic billionaire alive", "the antichrist"
 *  — so the viewer wonders who, where a fact has them nod. A line that says
 *  one is thrown out and the second go draws afresh. */
const FACTUAL = new RegExp([
  String.raw`\b(richest|wealthiest|best[- ]selling|top[- ]selling|record[- ]holder|champion|mvp|grammy|oscar)\b`,
  String.raw`\bmost[- ](streamed|followed|watched|viewed|subscribed|decorated|awarded|capped|paid)\b`,
  String.raw`\bhighest[- ](paid|earning|grossing|scoring)\b`,
  String.raw`\b(ceo|founder|co-founder|owner|president|prime minister|senator|governor|quarterback|striker)\b`,
  String.raw`\b(number|no\.?)\s*(one|1)\b`,
  String.raw`\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)[- ]time\b`,
  String.raw`\d`,
].join('|'));

/** A clause that walks around them — "the woman who owns the music industry"
 *  — which reads as a fact dressed up as a flex, where "the softest rapper
 *  alive" lands. Thrown out like a fact. */
const CLAUSE = /\b(who|whose|whom|which|that)\b/;

/** A mystery held to its frame: on the drawn verb, with no part of their name,
 *  no fact about them and no clause. */
function holdMystery(reply: string, verb: string, person: string): string | null {
  const line = holdVerb(clean(reply), verb, true);
  return line && !namesPerson(line, person) && !FACTUAL.test(line) && !CLAUSE.test(line) ? line : null;
}

function mysteryPlan({ person, direction, who }: Input): Plan {
  const verb = pick(VERBS[direction]);
  return {
    system: MYSTERY,
    ask: [`person: ${person}`, ...whoLine(who), which(direction), `open with: ${verb}`].join('\n'),
    finish: (reply) => holdMystery(reply, verb, person),
  };
}

function hypePlan({ mode, person, who }: Input): Plan {
  return {
    system: hype(mode === 'degen'),
    ask: [`person: ${person}`, ...whoLine(who)].join('\n'),
    finish: (reply) => {
      const line = clean(reply);
      return line && !/^(trading on|going long on|shorting|shorts|goes long on|trades on)\b/.test(line) ? line : null;
    },
  };
}

function meIfPlan({ mode, person, direction, personaContext, who }: Input): Plan {
  const verb = pick(VERBS[direction]);
  return {
    system: meIf(mode === 'degen'),
    ask: [
      `person: ${person}`,
      ...whoLine(who),
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
  const { mode, person, direction, who } = input;
  if (mode === 'degen') {
    const descriptor = pick(DESCRIPTORS);
    const verb = pick(DEGEN_VERBS[direction]);
    return {
      system: DEGEN,
      ask: [`person: ${person}`, ...whoLine(who)].join('\n'),
      json: true,
      finish: (reply) => degenLine(reply, person, descriptor, verb),
    };
  }
  if (mode === 'serious') {
    const verb = pick(VERBS[direction]);
    return {
      system: SERIOUS,
      ask: [`person: ${person}`, ...whoLine(who), which(direction), `open with: ${verb}`].join('\n'),
      finish: (reply) => noMan(holdVerb(clean(reply), verb, true), person),
    };
  }
  return middlePlan(input);
}

// ── The call ─────────────────────────────────────────────────────────────────

/** The guide as the system message, the ask as the user's, one short reply. A
 *  missing key is an error from lib/deepseek on the call, so an answer from the
 *  route rather than a crash when the module loads. */
async function draft(plan: Ask): Promise<string> {
  const reply = await deepseekChat(
    [{ role: 'system', content: plan.system }, { role: 'user', content: plan.ask }],
    // Warmer than the helper's 0.2: the line is a joke, and everything that has
    // to be fixed about it is drawn by the code and checked in finish(). No
    // max_tokens: on the v4 reasoning models it counts the thinking too, and
    // one line thinks for 1,400–3,100 tokens, so a cap of 300 came back as an
    // empty reply every time. The helper's timeout bounds a runaway instead.
    { temperature: 1, ...(plan.json ? { json: true } : {}) },
  );
  if (!reply.trim()) throw new Error('the model came back with nothing');
  return reply;
}

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  const input: Input = { ...parsed.data, who: await whoIs(parsed.data.person) };

  let lastErr = '';
  // Two goes, each drawing afresh — twist, shape and all: the realistic
  // failures are a line with no trade where one was asked for, one with "man"
  // in it, or a mystery that names them, and a fresh draw fixes those more
  // often than not.
  for (let attempt = 0; attempt < HOOK_ATTEMPTS; attempt++) {
    try {
      const plan = planFor(input);
      const line = 'line' in plan ? plan.line : plan.finish(await draft(plan));
      if (!line) throw new Error('the line broke its rules');
      return NextResponse.json({ start: line });
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      console.error('[vids hook] attempt', attempt + 1, 'failed:', lastErr);
      // A key, balance or request problem is not going to fix itself on a
      // second go. lib/deepseek says those as "deepseek <status>: ..." or
      // "DEEPSEEK_API_KEY not set"; a timeout, a 429 or a 5xx gets the retry.
      if (/^deepseek 40[0-3]\b/.test(lastErr) || lastErr.startsWith('DEEPSEEK_API_KEY')) break;
    }
  }
  return NextResponse.json({ error: `Hook: ${lastErr || 'empty response'}` }, { status: 502 });
}
