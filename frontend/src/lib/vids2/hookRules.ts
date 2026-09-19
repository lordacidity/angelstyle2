// The Start caption's fixed parts: everything api/vids/hook draws itself
// rather than leaving to the model — the trading verbs, Middle's combos and
// its clock's tasks and times, all of Degen but the nickname, how often a
// twist comes up — and the example
// lines each guide is written around. Kept apart from the route so the guide
// on the tuning page (components/vids2/Vids2HookGuide) is read off the same
// lists and odds the route draws with, and can't drift from it.
//
// No prompts in here and nothing that calls anything: the route owns how each
// guide is worded and how a reply is held to it.

export type HookMode = 'serious' | 'middle' | 'degen';
export type HookDirection = 'up' | 'down';

/** How a trade is said in Serious, Middle and the twists, by the way it goes.
 *  One of them at even odds. */
export const VERBS: Record<HookDirection, readonly string[]> = {
  up: ['going long on', 'trading on'],
  down: ['shorting'],
};

// ── Middle ───────────────────────────────────────────────────────────────────

/** Middle's combos, at even odds when the persona has a context to take the
 *  activity from. The last is the clock: the money against how little time it
 *  took, with no trade and no name in it. */
export const COMBOS = ['analogy + activity', 'trade + activity', 'analogy + trade', 'analogy + clock'] as const;
export type Combo = (typeof COMBOS)[number];
/** Without a context there is nothing to say he is doing, so never an
 *  activity: these two, at even odds. */
export const NO_CONTEXT_COMBOS: readonly Combo[] = ['analogy + trade', 'analogy + clock'];

// ── Middle's clock ───────────────────────────────────────────────────────────
//
//   making <analogy> in the time it takes to <task>        pool, context
//   making <analogy> in <number> while <activity>          number

/** Where a clock line's time comes from: a task off the pool, a task off what
 *  he is doing on camera, or a number with what he is doing after "while". */
export type ClockBranch = 'pool' | 'context' | 'number';
export const CLOCK_BRANCHES: readonly ClockBranch[] = ['pool', 'context', 'number'];

/** How often each branch comes up when the persona has a context. Without one
 *  there is no task or activity to take from it, so it is always the pool. */
export const CLOCK_BRANCH_ODDS: Record<ClockBranch, number> = { pool: 0.25, context: 0.25, number: 0.5 };
export const NO_CONTEXT_CLOCK_BRANCH: ClockBranch = 'pool';

/** The pool's tasks, at even odds. Also what the context branch falls back
 *  on when the context is only a place or a state, with no task in it. */
export const CLOCK_TASKS = [
  'lose an argument',
  'reheat cold pizza',
  'lie to my dentist about flossing',
  'microwave water',
  'ignore a phone call',
  'give up on a book',
  'text back after four days',
  'get rejected',
  'unwrap a gas station sandwich',
  'fake a laugh',
  'lose a game of chess',
  'skip an ad',
  'brush my teeth',
] as const;

/** The number branch's times, at even odds. */
export const CLOCK_NUMBERS = ['41 seconds', '67 seconds', '69 seconds', '12 minutes'] as const;

/** Whole clock lines, by branch, the way the guide shows them to the model. */
export const CLOCK_EXAMPLES: Record<ClockBranch, readonly string[]> = {
  pool: [
    'making rent in the time it takes to lose an argument',
    'making a week of groceries in the time it takes to microwave water',
    'making a month of gas in the time it takes to get rejected',
    "making a surgeon's salary in the time it takes to reheat cold pizza",
    'making a year of netflix in the time it takes to skip an ad',
    "making a bartender's night in the time it takes to fake a laugh",
  ],
  context: [
    'making rent in the time it takes to put a hammer in my mouth',
    'making a car payment in the time it takes to put on a suit of armor',
    'making tuition money in the time it takes to shave my head',
    'making a week of groceries in the time it takes to assemble an ikea chair',
    "making a lawyer's salary in the time it takes to parallel park",
  ],
  number: [
    'making rent in 67 seconds while half asleep',
    "making a surgeon's salary in 69 seconds while in the hot tub",
    'making a car payment in 41 seconds while eating cereal',
    'making lebron money in 12 minutes while pretending to listen in a meeting',
  ],
};

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
 *  context there is nothing to catch him at — the same reason Middle drops its
 *  activity combos (NO_CONTEXT_COMBOS). It would otherwise have to invent the
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

export const MIDDLE_EXAMPLES: readonly string[] = [
  "making a surgeon's salary from the hot tub",
  'shorting drake mid haircut',
  'how to make lebron money trading on bronny',
  'going long on taylor swift in the grocery line',
  'making a year of rent before my coffee gets cold',
  "how to make a lawyer's salary shorting kanye",
  "trading on elon at my cousin's wedding",
  'going long on messi with a mouth full of cereal',
  'out-earning my landlord shorting zuckerberg',
  "making a ceo's bonus from a lawn chair",
  'how to make mrbeast money trading on mrbeast',
  'shorting jake paul on the treadmill',
  'making tuition money going long on sabrina carpenter',
  'trading on trump in a bubble bath',
  'how to make an nba salary from the toilet',
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

export const MYSTERY_EXAMPLES: readonly string[] = [
  'shorting the greatest musician of our generation',
  'going long on the most hated man in america',
  'shorting the most overrated athlete of all time',
  'going long on the most famous woman on earth',
  "shorting every girl's celebrity crush",
  "trading on the guy your dad won't stop talking about",
  'shorting the goat',
  'going long on the most annoying streamer alive',
  'shorting the best rapper alive',
  'going long on the most divisive man in the nfl',
  "shorting your mom's favorite actor",
  'going long on the most unhinged billionaire',
  "shorting the internet's favorite boyfriend",
  'going long on the most washed athlete in sports',
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
