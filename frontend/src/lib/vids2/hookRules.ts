// The Start caption's fixed parts: everything api/vids/hook draws itself
// rather than leaving to the model — the trading verbs, Middle's shapes,
// analogies, seconds and tasks, all of Degen but the nickname, how often a
// twist comes up — and the example
// lines each guide is written around. Kept apart from the route so the guide
// on the tuning page (components/vids2/Vids2HookGuide) is read off the same
// lists and odds the route draws with, and can't drift from it.
//
// No prompts in here and nothing that calls anything — the one function reads
// a context's parentheticals, which Middle and the tuning page both need: the
// route owns how each guide is worded and how a reply is held to it.

export type HookMode = 'serious' | 'middle' | 'degen';
export type HookDirection = 'up' | 'down';

/** How a trade is said in Serious and the twists, by the way it goes. One of
 *  them at even odds. Middle's mystery is on MIDDLE_MYSTERY_VERBS instead. */
export const VERBS: Record<HookDirection, readonly string[]> = {
  up: ['going long on', 'trading on'],
  down: ['shorting'],
};

// ── Middle ───────────────────────────────────────────────────────────────────
//
// Every Middle line opens "making <analogy>", and then takes one of four
// shapes, drawn here by MIDDLE_SHAPE_ODDS:
//
//   making <analogy> <parenthetical>                               while · the parenthetical
//   making <analogy> <the mystery>                                 while · the mystery
//   making <analogy> in <seconds> seconds <parenthetical>          seconds + parenthetical
//   making <analogy> in <seconds> seconds                          seconds
//   making <analogy> in the time it takes to <task>                time
//
// The analogy, the seconds and the task are all off the lists below. The
// parenthetical is what the persona's context says in parentheses — "wearing
// a knight helmet (with a fresh fit)" puts "with a fresh fit" on the end of
// the line, word for word and without the brackets (parentheticalsOf); a
// context with several has one drawn, and one with none leaves the seconds
// line at its time and sends the while shape to the mystery. So the model is
// only ever asked for the mystery: the trade on someone described but never
// named, on a verb fixed by which way (MIDDLE_MYSTERY_VERBS), set straight
// after the analogy — "making lebron's salary shorting the goat". Nothing in
// a line says "while" unless the parenthetical does ("while daydrinking");
// the shape keeps its name from when the model wrote what he was doing after
// the word.

export type MiddleShape = 'while' | 'seconds + parenthetical' | 'seconds' | 'time';
export const MIDDLE_SHAPES: readonly MiddleShape[] = ['while', 'seconds + parenthetical', 'seconds', 'time'];
export const MIDDLE_SHAPE_ODDS: Record<MiddleShape, number> = {
  while: 0.4, 'seconds + parenthetical': 0.2, seconds: 0.2, time: 0.2,
};

/** In the while shape, how often the slot is the parenthetical; the rest of
 *  the time it is the mystery. A context with no "(...)" has no parenthetical,
 *  so its while shape is always the mystery. */
export const MIDDLE_PARENTHETICAL_ODDS = 0.6;

/** Each "(...)" a persona's context says, word for word, lower-cased and
 *  without the brackets — what Middle puts on the end of a line. "wearing a
 *  knight helmet (with a fresh fit)" gives ["with a fresh fit"]; "sitting in a
 *  park (in da park) (with just a computer)" gives both. */
export function parentheticalsOf(context: string): string[] {
  const out: string[] = [];
  for (const m of context.matchAll(/\(([^)]*)\)/g)) {
    const p = m[1].replace(/\s+/g, ' ').trim().toLowerCase();
    if (p) out.push(p);
  }
  return out;
}

/** The money analogies, at even odds — less the one that names the person the
 *  video trades on, so a Drake build never makes drake's salary. */
export const MIDDLE_ANALOGIES = [
  "a surgeon's salary",
  'a year of rent',
  "lebron's salary",
  "messi's salary",
  "ronaldo's salary",
  "sam altman's salary",
  "drake's salary",
  "a ceo's bonus",
  "a lawyer's salary",
  "an nba player's salary",
  'a month of groceries',
  'a year of gas',
] as const;

/** The seconds shapes' times, at even odds. */
export const MIDDLE_SECONDS = ['67', '69', '420'] as const;

/** The time shape's tasks, at even odds. */
export const MIDDLE_TASKS = [
  'skip an ad',
  'brush my teeth',
  'take a shower',
  'get a hug',
  'leave a voicemail',
  'drink a coffee',
] as const;

/** The mystery's verb in Middle, by the way the trade goes — fixed, where the
 *  twists' mystery draws from VERBS. */
export const MIDDLE_MYSTERY_VERBS: Record<HookDirection, string> = { up: 'trading on', down: 'shorting' };

// ── Degen ────────────────────────────────────────────────────────────────────

export const DESCRIPTORS = ['chopped kid', 'homeless man', 'tweaker', 'dude', 'kid'] as const;

export const DEGEN_VERBS: Record<HookDirection, readonly string[]> = {
  up: ['goes long on', 'trades on'],
  down: ['shorts'],
};

/** The brackets that go down on himself. Each takes one of DEGEN_EMOJI. */
export const SELF_OWNS = [
  'i need serious help',
  'dear god please help me',
  'i need serious therapy',
  'i live in my car',
  'this is my last dollar',
  'i have never been hugged',
  'im on the edge rn',
  'me at my low',
  'is there no end',
] as const;

export const DEGEN_EMOJI = ['💯', '🔥', '😎', '🥀'] as const;

/** How often a nickname with a short form gets "(i love you <short>)" instead
 *  of a self-own: a quarter of the examples do, and those are only the ones
 *  with a short form to say it with. */
export const LOVE_ODDS = 1 / 3;
/** Longer than this and "i love you ___" stops reading as a pet name. */
export const LOVE_MAX = 8;

// ── The twists ───────────────────────────────────────────────────────────────

/** How often a hook is one of the twists instead of its mode's own. */
export const TWIST_ODDS = 0.2;

export type Twist = 'mystery' | 'hype' | 'meIf';

/** The twists a trade can take, by the way it goes, at even odds. Hype only
 *  ever goes up. */
export const TWISTS: Record<HookDirection, readonly Twist[]> = {
  up: ['mystery', 'hype', 'meIf'],
  down: ['mystery', 'meIf'],
};

/** Me if catches him in the middle of what the video shows, so without a
 *  context there is nothing to catch him at — as Middle's while shape is always
 *  the mystery without a parenthetical. It would otherwise have to invent the
 *  moment, which is how a line came to put the guy in a wedding toast he was
 *  never in. Mystery and hype say nothing about him, so they stand either way. */
export const NO_CONTEXT_TWISTS: Record<HookDirection, readonly Twist[]> = {
  up: ['mystery', 'hype'],
  down: ['mystery'],
};

/** How many goes the route has at a line, each drawn afresh, twist and all. */
export const HOOK_ATTEMPTS = 2;

// ── The examples each guide is written around ────────────────────────────────

export const SERIOUS_EXAMPLES: readonly string[] = [
  'trading on trump ahead of midterms to double the account',
  'going long on taylor swift before the tour announcement to cover a year of rent',
  'shorting drake before the album drops to pay off the car',
  'going long on lebron through the playoffs for a six figure year',
  'shorting kanye after the next interview to fund a house down payment',
  'trading on elon every earnings call to replace a salary',
  'going long on sabrina carpenter before the grammys for a five figure month',
  'shorting jake paul before fight night to retire by 30',
  'trading on messi all season to out-earn the boss',
  'going long on mrbeast before the next video to clear student loans',
  'shorting zuckerberg after the next product launch to fund a year off',
  'trading on travis kelce through the super bowl for a second income',
  'going long on ishowspeed before the world tour to hit a full salary by december',
  'shorting bezos after the next rocket launch to pay off the credit cards',
  'trading on ronaldo through the world cup to quit the 9 to 5',
];

/** Middle lines the way they come out, for the guide. No Middle guide shows
 *  them to the model: the only part it writes is the mystery, which has
 *  MYSTERY_EXAMPLES. */
export const MIDDLE_EXAMPLES: readonly string[] = [
  "making a lawyer's salary with a fresh fit",
  'making a year of rent takin a dump',
  "making ronaldo's salary in da streets",
  "making a surgeon's salary without even looking",
  'making a month of groceries while daydrinking',
  "making sam altman's salary shorting the greatest rapper alive",
  "making drake's salary in 67 seconds with a fresh fit",
  'making a year of gas in 420 seconds',
  "making messi's salary in the time it takes to skip an ad",
  "making a ceo's bonus in the time it takes to get a hug",
];

/** Degen's whole line, the way its guide shows it to the model. */
export const DEGEN_EXAMPLES: readonly string[] = [
  'chopped kid shorts musky (i need serious help) 🔥',
  'tweaker goes long on swifty (i love you swifty)',
];

/** Nicknames that landed, "name: nickname". */
export const NICKNAME_EXAMPLES: readonly string[] = [
  'elon musk: musky',
  'vladimir putin: daddy vlady',
  'mark zuckerberg: zuckey',
  'taylor swift: swifty',
  'drake: drizzy',
  'lebron james: bron bron',
  'tom holland: tom holley',
  'kanye west: yeezy',
  'ishowspeed: speedy',
  'jake paul: jakey paul',
  'cristiano ronaldo: cr7',
  'donald trump: trumpy',
  'sabrina carpenter: sabby c',
  'jeff bezos: jeffy b',
  'kim kardashian: kimmy k',
  'mrbeast: mr beef',
  'lionel messi: messi goat',
  'kai cenat: kai cenat (nothing landed, so the plain name)',
  'travis kelce: travvy k',
  'timothée chalamet: timmy chalamet',
];

/** Takes, never facts, in the shape that lands: a superlative on what they
 *  are with where it holds on the end, or a short epithet. Each is something a
 *  fan or a hater would say and the other would argue with, so the viewer
 *  wonders who. "the richest man in the world" is a fact they would nod at,
 *  and "the woman who owns the music industry" a clause that walks around her;
 *  the route throws both out. */
export const MYSTERY_EXAMPLES: readonly string[] = [
  'shorting the most overhyped athlete on the planet',
  'shorting the softest rapper alive',
  'shorting the most emotional rapper alive',
  'shorting the most erratic billionaire alive',
  'going long on the greatest musician of our generation',
  'going long on the most hated man in america',
  'going long on the antichrist',
  'shorting the most overrated athlete of all time',
  'going long on the most overexposed woman on earth',
  "shorting every girl's celebrity crush",
  'shorting the goat',
  'going long on the most annoying streamer alive',
  'trading on the best rapper alive',
  'going long on the most divisive man in the nfl',
  'trading on the most unhinged billionaire on earth',
  'shorting the most washed athlete in sports',
  'shorting the man everyone pretends to like',
];

/** Hype says the name everyone calls them — or, in Degen, the nickname — so
 *  its examples come both ways, the same six lines. */
export const HYPE_NAMED: readonly string[] = [
  'putin to the skyyyyy',
  'messi to the stratosphere',
  'kanye to the heavens',
  'lebron through the roof',
  'taylor swift to outer space',
  'zuckerberg to the top floor',
];
export const HYPE_NICKNAMED: readonly string[] = [
  'daddy vlady to the skyyyyy',
  'messi goat to the stratosphere',
  'yeezy to the heavens',
  'bron bron through the roof',
  'swifty to outer space',
  'zuckey to the top floor',
];

/** Me if says the name everyone calls them — or, in Degen, the nickname — so
 *  its examples come both ways too, the same setting either way.
 *
 *  Every one of them is caught in the middle of something a persona clip
 *  actually shows, because that is where the line has to take it from. They
 *  used to be solemn occasions nobody films — a funeral, jury duty, church —
 *  and the model read those as licence to invent the moment rather than read
 *  it off the video. */
export const ME_IF_NAMED: readonly string[] = [
  'me if shorting lebron in the hot tub was legal',
  'me if going long on taylor swift in the grocery line was legal',
  'me if trading on elon half asleep was legal',
  'me if shorting drake mid haircut was legal',
  'me if going long on messi with a mouth full of cereal was legal',
  'me if trading on trump on the treadmill was legal',
];
export const ME_IF_NICKNAMED: readonly string[] = [
  'me if shorting bron bron in the hot tub was legal',
  'me if going long on swifty in the grocery line was legal',
  'me if trading on musky half asleep was legal',
  'me if shorting drizzy mid haircut was legal',
  'me if going long on messi goat with a mouth full of cereal was legal',
  'me if trading on trumpy on the treadmill was legal',
];
