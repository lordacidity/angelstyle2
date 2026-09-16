// POST /api/vids/captions — the on-screen words for one build.
//
// A Vids build is always the same shape: the persona does something odd on
// camera (Start), then screen-records himself doing something online (Bottom A,
// then Bottom B) while the captions explain it, and it finishes on what he made
// (End). Bottom B is always Pauv — that is what the second screen clip is for —
// so the model is told outright rather than left to infer it from marks that
// often never mention the site, because whoever wrote them could see it. So this
// writes three kinds of line — one weird hook over Start, a step-by-step
// commentary over the screen recording, and the call to action over the winnings
// at the end. The hook always says he is making money and names the weird thing
// he is doing on camera ("making bank shorting trump in the woods" — see HOOK);
// the winnings carry one line and only one, the same call to action on every
// build, comment "<word>" for the link, where the model only picks the word, so
// the line matches the video without ever drifting from the form — nothing is
// written about the money itself. And somewhere in every set a line spells out
// pauv.com as a place to go (SEND), since that is the point of the video.
//
// The model is told how many lines each clip can hold; the caller works that out
// from the real timeline (lib/vidsCaptions), so nothing here has to think about
// timing — Bottom A on Fast aside, below. Extra lines are dropped at layout
// time rather than crammed in.
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
// Bottom A on Fast is the one clip the model times itself. Sped up to fit ten
// seconds, it has room for two lines rather than one per moment, so it arrives
// `placed`: its moments with their times on those ten seconds, or just its
// context when nobody marked it. The model answers with two lines and the
// second each goes up — nearly always the search and the pick ("look up most
// hated ppl on chatgpt", "pick trump from the list") — and the caller keeps
// them in order and apart and lays them over the clip there. No seam is merged
// across it: its last line is the pick, not the way into Pauv.
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
// Degen mode (Vids 2's form) changes ONE thing: the hook is written to
// DEGEN_HOOK instead of HOOK — no money, a name he calls himself, and a cry for
// help in brackets ("homeless man trades on ronaldo (i need serious help)").
// The step-by-step lines and the closing word are untouched, because they are
// what the video is actually for. Every other caller leaves `degen` out and
// gets the ordinary hook.
//
// The hook is written to one guide (HOOK): a money phrase from a fixed list,
// the weird thing or the place from the persona context, and usually who he is
// trading on and which way — "shorting" for down, plain "on" for up. He is
// always typing or on a computer, so that part is never said; the weird thing
// is what is left, and it is in the line every time. Which way the trade goes
// is read off the screen recordings' contexts and marks, the same reading the
// steps come from. Now and then it is a "how to", addressed to the viewer,
// or ends on how fast it was ("in 69 secs"). The winnings get no line of their
// own: the closing clip shows the money, and the one caption over it is the
// comment line, so the call to action has the whole of the ending to itself.
// Every build is written the same way; there is no choice of voice.
//
// Emoji come from the app's own set: the ones pinned in the Emojis drawer are
// handed over as the palette to pick from, and every line is drawn from that
// set's Apple images (lib/emoji), so any emoji the model writes that has no
// image there is taken back out. The hook is the one line that never takes a
// laughing face: it is delivered straight, and a laugh on the end does the
// reacting for the viewer. That is asked for in the prompt and taken back out
// of Start afterwards, since the palette is whatever the writer pinned.
//
// Every line is kept to a few words: text-speak shortens it ("bc", "rn"), and
// a moment that needs more than one short line is written as two captions
// with " / " between them — the layout (lib/vidsCaptions) shows those one
// after the other across that moment. A pair of strings for a moment is
// accepted too and joined the same way.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { extractGeminiJson, geminiGenerate } from '@/lib/gemini';
import { keepKnownEmoji, splitEmojiTokens } from '@/lib/emoji';
import { PAUV_BRIEF } from '@/lib/vids-brief';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Fast and cheap — these are a handful of short lines, not an essay. */
const MODEL = 'gemini-3.1-flash-lite';

/** The laughing faces the hook may not end on. The hook works by saying he is
 *  making money and naming the absurd thing happening to him in one breath, said
 *  straight — a face laughing at it tells the viewer it was a joke instead of
 *  letting it land. The screen lines may still take one, where a laugh reads as
 *  him reacting to what he pulled off. Compared without the
 *  U+FE0F presentation selector, since the same face arrives both ways. */
const LAUGHING = new Set(['😂', '🤣', '😹', '😆', '😅']);
const isLaughing = (char: string) => LAUGHING.has(char.replace(/\uFE0F/g, ''));

const style = (emojis: boolean, palette: string[], degen: boolean) => `Every caption:
- SHORT. A screen line is 3 to 7 words and never more than 8 — it is read in a second while the screen moves on. Not a sentence. No full stop at the end. The hook may run a little longer; it wraps.
- mostly lower case, the way ppl type — that is still the default for every line. Capitals are allowed: a word or a short line in caps for emphasis ("making BANK shorting trump", "he is DONE"), or a name or acronym capitalised where it reads better. Do not start every line with a capital, do not capitalise every word, and keep it consistent across the set — if one line writes Ronaldo, they all do.
- plain spoken, the way someone talks to a camera. No hashtags, no quote marks.
- text-speak, the way ppl actually type: "bc" for because, "rn" for right now, "ppl", "tbh", "ngl", "fr", "w/", "ur". Shorten with these before cutting meaning — "trade down on him bc ppl hate him rn". A few across the set, where they land naturally — never one in every line, never forced, never at the cost of being clear.
${emojis
  ? `- EMOJI: put two or three across the set, always — one on the START hook and at least one on a BOTTOM A or BOTTOM B line, each at the end of its line. Never two in one caption, never a row of them, never one standing in for a word. The comment line at the END is fixed and never gets one, and neither do the fixed screen lines under THE FIXED LINES — so the one you put on a screen line goes on a line you actually wrote.
  ${degen
    ? `The START hook ALWAYS takes one, and it is half the joke — either 🔥 or 💯 played dead straight over a line about his life falling apart, or one that laughs at him. It is ONE OF THESE SEVEN and nothing else: 🔥 💯 💀 🤡 😭 🥀 😂. Never an emoji of the thing he is doing or the place he is in — no trees for the woods, no toilet, no football. The picture is already showing that; the emoji is the tone. On the end of the line. The hook is the ONE caption that may go outside the saved set below; every other line stays inside it.`
    : `The START hook NEVER takes a laughing face — not ${[...LAUGHING].join(', ')}, nor any other face laughing or crying with laughter. The hook is said straight; a face laughing at it does the joke for the viewer and kills it. Give the hook one that points at what he is doing — the money, the thing he is doing on camera — or leave it without one.`}
${palette.length
    ? `  Pick from THESE, the app's own saved emoji, and only these: ${palette.join(' ')} — whichever fits what that caption is saying. If none of them fits a line, leave that line without one.`
    : `  Pick whatever emoji actually fits what that caption is saying — a plain standard one. No skin tones, no flags, no joined sequences.`}`
  : `- No emoji.`}`;

/** The hook, written to one guide. The persona context says what he is doing
 *  or where he is ("typing in the middle of the road", "in the woods on my
 *  computer"); he is always typing or on a computer, so the caption never says
 *  that part, and the weird thing or the place is what it names — every time.
 *  The money is one phrase from a fixed list, the trade is "shorting" when it
 *  is down and plain "on" when it is up, and which way it goes is read off the
 *  screen recordings, the same reading the steps come from. Now and then the
 *  line is a "how to", addressed to the viewer, or ends on how fast it was —
 *  "in 67 secs", "in 69 secs", the house numbers. Every build is written this
 *  way; there is no choice of voice. */
/** The hook with degen mode on — HOOK turned inside out. Instead of a man
 *  making bank while something absurd happens to him, it is a man visibly
 *  coming apart who is trading anyway, saying so himself, in the third person,
 *  with the cry for help in brackets on the end. Nothing is sold and nobody is
 *  impressed: the line stops the scroll by being worse than whatever was above
 *  it in the feed. Only the hook changes — the step-by-step lines still teach
 *  someone how Pauv works, and the closing word is the same fixed line, because
 *  that is what the video is for. Asked for on Vids 2's form and nowhere else;
 *  every other build gets HOOK. */
const DEGEN_HOOK = `START — the hook, in DEGEN MODE. One caption over the persona on camera.
Degen mode turns the hook inside out. The ordinary hook brags — the money, and the weird thing he is doing to get it. This one NEVER brags and NEVER mentions making money. He is a mess, he is trading anyway, and the caption is him saying it out loud. It is meant to be awful. That is the whole job: somebody scrolling stops because they cannot believe it was posted.

THE SHAPE, and it is usually this:
  <what he calls himself> trades on <person> (<the aside>)
- WHAT HE CALLS HIMSELF — a self-own in the third person, two or three words. Where the persona context gives you ANYTHING, build it out of that first: day drinking -> "day drinking man", in the woods -> "man living in the woods", a phone in his mouth -> "man with a phone in his mouth", in the car -> "man who lives in his car". Only when the context gives you nothing at all, fall back on plain self-loathing: "homeless man", "little goy boy", "depressed man", "unemployed man", "grown man", "man in debt", "man with no job".
- <person> — whoever the screen recording shows, the same name the other captions use. Which way he trades hardly matters here and is usually left out.
- THE ASIDE, in round brackets on the end. This is where the video actually gets written, and it MUST come out different every time. It is a cry for help, an admission, or something unhinged that follows from THIS video — who he is trading on, which way he is going, what the context has him doing. Off the video: going down on someone — "(i hate this man)", "(he ruined my life)"; going up on someone — "(she doesn't know i exist)", "(he is my only hope)"; off what he is doing — "(my mum is watching this)", "(im in the woods rn)". Off nothing in particular: "(i need serious help)", "(i hate my life)", "(this is my last penny)", "(send help)", "(i am not ok)", "(rent is due friday)", "(3 years no job)", "(me, i'm the depressed man)", "(i need serious therapy)".
  Every one of those has been used already. WRITE A NEW ONE for this video wherever you can, and where you do take one from the list, take one this video has earned. Never reach for "(i need serious therapy)" as a default — it is one of a dozen, not the answer.

Now and then drop the shape and write a straight plea, one breath, no brackets:
  "someone please help me dear god this is my last penny"
  "day drinking doing dis shi (i need serious therapy"
A bracket left open like that one is fine. Sloppy is in character. Do not tidy it every time.

THESE ARE EXAMPLES OF THE SPIRIT, and they are spent. Write new ones; do not hand any of these back:
  homeless man trades on ronaldo (i need serious help)
  little goy boy trades on trump (i hate my life)
  someone please help me dear god this is my last penny
  day drinking doing dis shi (i need serious therapy
  depressed man trades on mbappe (me, i'm the depressed man)
What they have in common is the only thing to copy: he says what he is, he says who he is trading on, then he says the quiet part out loud.

RULES:
- NEVER a money phrase. Not "making bank", not "getting paid", not "making bands", not "securing the bag". He is not winning. Where money comes into it at all it is the last of it: "my last penny", "rent money", "my mum's card".
- Lower case throughout, the way it is typed at 3am — the person's name included: "trades on ronaldo", "trades on trump", never "Ronaldo". No full stop. A capital only where a word is being shouted.
- Text-speak, misspellings and swallowed words are welcome: "dis shi", "im", "bc", "fr", "ngl", "istg". This is the one caption in the set where being badly written is right.
- It may run long and wrap. A hook that reads like it was typed in one go beats a tidy one.
- No hashtags, no quote marks.
WRONG:
  "making bank on ronaldo (i need help)" — it brags, and degen never brags
  "Homeless Man Trades On Ronaldo" — title case, and it reads like a headline
  "depressed man trades" — no person, no aside, nothing to stop on`;

const HOOK = `START — the hook. One caption over the persona on camera.
The persona context says what he is doing or where he is: "typing in the middle of the road", "putting a phone in my mouth", "in the park today", "in the woods on my computer". He is ALWAYS typing or on a computer, so never say that part — not "typing", not "on my laptop", not "on my phone". The hook is the WEIRD thing — the place he is, or the thing he is doing — and it is in the caption every single time, named from the context.
TWO things in every hook:
  1. THE MONEY, in one of these phrases and no other: making bank, getting paid, making money, making bands, making rent, profiting, paying my bills, securing the bag, making a living — or a salary: "making a doctor's salary", "making a lawyer's salary", "making messi's salary" (a job, or the person he is trading on).
  2. THE WEIRD THING, from the context: "in the woods", "with a phone in my mouth", "on the toilet", "at the park", "in a dinosaur costume".
Usually name WHO he is trading on — the person the screen recording shows — and say which way. Read the direction off the screen recordings' contexts and moments: trading up on him, backing him, buying him is UP; trading down on him, fading him, betting on him falling is DOWN. If nothing says, it is UP.
  UP:   "on ronaldo", "off ronaldo", "trading ronaldo"
  DOWN: "shorting trump", "profiting on tate's downfall", "off kanye getting cancelled"
Never "trade up", "trade down" or "trading down" in the hook. Now and then leave the person out and let the weird thing carry it: "getting paid with a phone in my mouth", "at the park getting paid".
Sometimes write it as a HOW TO, addressed to the viewer: "how to make rent off mbappe from a hammock", "how to get paid with a phone in your mouth". Then "my" becomes "your" and the money phrase goes to its base form.
Now and then put how fast it was on the end — "in 67 secs" or "in 69 secs", the house numbers: "making bank shorting trump in the woods in 69 secs", "getting paid off ronaldo on the toilet in 67 secs". Not on every build, and never any other number unless a context gives it.
Either order works — money first or weird thing first. Vary it. Mostly lower case, with capitals only as the style rules below allow; no full stop, no hashtags. Short, though the hook may wrap.
WRONG:
  "making bank on trump today" — no weird thing
  "making money typing in a park" — typing is not the thing, the park is
  "trading down on drake in the bath" — say shorting
RIGHT:
  making bank shorting trump in the woods
  getting paid with a phone in my mouth
  at the park making money on ronaldo
  on the toilet making money off kanye getting cancelled
  3am in bed profiting on tate's downfall
  getting paid in a shopping trolley
  making rent shorting drake with tape on my mouth
  velo in my mouth making bands on ronaldo
  paying my bills shorting trump in the back of an uber
  securing the bag on ronaldo on a trampoline
  making a living on messi at the bus stop
  in a cupboard profiting off drake getting cancelled
  how to make rent off mbappe from a hammock
  how to get paid with a phone in your mouth
  how to secure the bag on trump's downfall from the bath
  making a doctor's salary shorting trump in the woods
  making a lawyer's salary off ronaldo on the toilet
  making messi's salary off messi in the bath
  making bank shorting trump in the woods in 69 secs
  getting paid off ronaldo on the toilet in 67 secs`;

/** Where each screen recording is. Bottom B is the Pauv clip on every build,
 *  and its context and moments are written by whoever cut it — who could see
 *  the screen, and so had no reason to write "on pauv" anywhere. Left to infer
 *  it, the model puts Bottom B's steps on whatever site Bottom A named. */
const WHERE = `WHERE EACH SCREEN RECORDING IS
BOTTOM B IS ALWAYS PAUV. Every build, without exception: the second screen clip is pauv.com. Its context and its moments may never say so — whoever marked the clip could see the screen — and that changes nothing. Every BOTTOM B caption is a step taken on pauv.com and reads like one: name pauv where the line needs a place ("search ronaldo on pauv", "hit trade up on pauv.com"), and NEVER put a Bottom B step on chatgpt, google, x or anywhere else, however its context reads. If a Bottom B moment says only "searched the name", the caption is "search ronaldo on pauv".
BOTTOM A is wherever its own recording shows — chatgpt, google, x, or pauv.com itself. Take that from its context and moments rather than assuming.`;

/** Three screen lines are chosen from a fixed set rather than written, and the
 *  caller swaps them in once the model has replied (lib/vidsCaptions, Fixed
 *  lines). The model is told so it does not spend the set's one screen emoji on
 *  a line that is about to be thrown away, and does not try to carry the address
 *  on Bottom B's opener, which already says it. The slots still have to come
 *  back filled: the arrays line up with the marks by index, so a short one would
 *  put every later line on the wrong moment. */
const FIXED = `THE FIXED LINES
Three of the screen captions are not yours to write — they are picked from a set afterwards, and whatever you put in those slots is replaced:
  BOTTOM A's 2nd caption (waiting for the answer to load)
  BOTTOM A's 3rd caption (taking the name off the answer)
  BOTTOM B's 1st caption (which is always: go to pauv.com, then search the name)
Still return a line in each of those slots so the arrays stay one entry per moment — a short array puts every line after it on the wrong moment. Write something plain and short there; it will not be used. Never put an emoji on one of them — those lines get their own afterwards — and do not count on them to carry anything the rest of the set needs: the address, the person's name, the reason he picked them all have to stand up in the lines you DO write. BOTTOM A's 1st caption is yours, and it is the one that says what he searched.`;

/** The one thing every build has to leave the viewer holding. The Bottom B
 *  lines name Pauv often enough on their own, but "on pauv" is a name and not
 *  an address — somebody who reads only that has nowhere to go. So one line
 *  always spells the domain out, and it goes on the moment he lands there. */
const SEND = (hasScreen: boolean, hasBottomB: boolean) => hasBottomB
  ? `SEND THEM TO PAUV.COM
The address is already taken care of on this build: BOTTOM B's first caption is one of the fixed lines and reads go to pauv.com, then the search. So do not spell the domain out again — the BOTTOM B lines after it say "pauv" on its own, "trade up on pauv", and the BOTTOM A lines name wherever BOTTOM A actually is.`
  : hasScreen
    ? `SEND THEM TO PAUV.COM
At least one caption in the set says "pauv.com" in full, as a direction the viewer can follow — "go to pauv.com", "search ronaldo on pauv.com", "pull up pauv.com". Every build, no exception.
This build has no BOTTOM B, so it goes on the LAST BOTTOM A line — the moment he arrives at the site. Once the full domain has been on screen once, the lines after it can go back to "pauv" on its own.`
  : `SEND THEM TO PAUV.COM
This build has no screen recording to carry the address, so the START caption says "pauv.com" in full, on top of everything else it is doing — "making bank off ronaldo on pauv.com with a phone in my mouth". Every build, no exception.`;

// The screen-recording lines are directions the viewer follows along with, not a
// commentary on what the screen is doing. Marks get written down as "opening
// chatgpt", "typing the name" — the caption for one has to come back out the
// other way round.
const IMPERATIVE = `VOICE for the BOTTOM A and BOTTOM B captions — write them as INSTRUCTIONS to the viewer, not as narration of what is on screen. Every one starts with a plain command verb: "search", "go to", "type in", "look at", "trade up", "place a trade", "watch for", "pick", "check" — and says where: "search on chatgpt", "go to pauv.com", "trade up on pauv".
NEVER start one with an -ing word. Not "typing the name" but "type in the name". Not "looking up ronaldo" but "look up ronaldo". Not "placing a trade" but "place a trade". Not "heading to pauv.com" but "go to pauv.com".
THE PICK: a moment where he picks someone off what came back — the name chatgpt answers with, the one he highlights, the one he goes with from a list — is written as the pick, a command with the name in it: "pick drake", "choose drake from the answer", "go with drake". Never "see it's drake", "see that it's drake", "look at the answer", "read the answer" — the viewer is told what to do, not what to notice. Two moments in a row that are the search and then the pick read "search on chatgpt most hated ppl rn", then "pick drake from the answer".
The START caption is the exception — the hook, written to START above. (END carries only its comment line, which is fixed; you pick the word and nothing else.)`;

/** Seconds as the writer is shown them: "3.5s". */
const secs = (n: number) => `${n.toFixed(1)}s`;

/** Bottom A on Fast. Sped up to fit its window, it has room for a couple of
 *  lines rather than one per moment, so the writer picks the steps that matter
 *  and says when each goes up — the one place it does any timing. */
const FAST_A = (n: number, length: number) => `BOTTOM A ON FAST
Bottom A is sped up to play in ${secs(length)}, so it carries EXACTLY ${n} captions instead of one per moment — the ${n} steps that matter, in order. This replaces the one-caption-per-moment rule above for Bottom A; Bottom B keeps it. Nearly always the two are where he looks something up and what he picks from what comes back: "look up most hated ppl on chatgpt", then "pick trump from the list". Each still names the site and the exact thing, like every screen line, and still describes only what is on Bottom A's screen.
You also choose WHEN each comes up, as "at": seconds from the start of Bottom A, from 0 to ${length.toFixed(1)}. The first usually goes at 0. Each one after it goes at the moment the thing it describes happens — the start of that moment when the clip's moments are given, and when they are not, where that step most likely falls in a recording like this, usually a little past the middle. Keep them at least 2 seconds apart, and none in the last 2 seconds.
Unless Bottom A is itself on pauv.com, the address is not one of these — spell out pauv.com on the first BOTTOM B line instead.`;

/** One screen recording: what it shows overall, and — when it has been marked up
 *  — what happens at each stretch, in the order they play. `placed` is Bottom A
 *  on Fast: the writer places `count` lines itself — `length` is the clip's
 *  window in seconds, `spans` each mark's stretch of it, in `marks` order. */
const Clip = z.object({
  context: z.string().max(600).default(''),
  marks: z.array(z.string().max(200)).max(24).default([]),
  count: z.number().int().min(0).max(24),
  placed: z.object({
    length: z.number().min(0).max(600),
    spans: z.array(z.object({ start: z.number(), end: z.number() })).max(24).default([]),
  }).optional(),
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
  /** The emoji the writer may use, as characters — the ones pinned in the
   *  app's Emojis drawer. Empty means any plain standard emoji. */
  emojiPalette: z.array(z.string().max(16)).max(40).default([]),
  /** Degen mode — Vids 2's form. The hook is written to DEGEN_HOOK instead of
   *  HOOK: no money, a self-own and a cry for help. Nothing else about the set
   *  changes. Off unless asked for, so every other caller is untouched. */
  degen: z.boolean().default(false),
  /** Bottom A's last moment and Bottom B's first are too brief for a line each,
   *  so the writer puts one line across both — as A's last entry, with B's
   *  first left "". Decided by the caller from the real timeline. */
  mergeSeam: z.boolean().default(false),
});

/** The written lines as they go back: `end` is the one over the closing clip. */
interface Drafted { start: string; bottomA: string[]; bottomB: string[]; end: string }

/** A marked clip's lines are kept in step with its moments — '' where the writer
 *  passed on one — so the caller can lay line i over moment i. Padded out to
 *  `n` in case the model stopped short. An unmarked clip has no moments to line
 *  up with, so its blanks are simply dropped. */
/** One entry of the reply as a line: a string as it is; a pair of strings — a
 *  moment the writer split in two — as one line with " / " between them, which
 *  is how the layout knows to show them one after the other. */
/** One written line as it comes back: trimmed, and any emoji the app has no
 *  image for taken out — see keepKnownEmoji. */
const cleanLine = (v: unknown): string => keepKnownEmoji(typeof v === 'string' ? v.trim() : '');
/** The hook as it goes back: any laughing face the writer put on it taken out,
 *  whatever the prompt asked for — see LAUGHING. The rest of the line, other
 *  emoji included, is left as written. */
const dropLaughing = (text: string): string => splitEmojiTokens(text)
  .filter((t) => !(t.type === 'emoji' && isLaughing(t.value)))
  .map((t) => t.value)
  .join('')
  .replace(/ {2,}/g, ' ')
  .trim();
const asText = (x: unknown): string => {
  if (typeof x === 'string') return cleanLine(x);
  if (!Array.isArray(x)) return '';
  return x.map(cleanLine).filter(Boolean).slice(0, 2).join(' / ');
};
const asLines = (v: unknown, n: number, marked: boolean): string[] => {
  const lines = (Array.isArray(v) ? v : []).map(asText);
  if (!marked) return lines.filter(Boolean).slice(0, n);
  const out = lines.slice(0, n);
  while (out.length < n) out.push('');
  return out;
};
/** A placed clip's reply: each entry a line and the second it goes up, as the
 *  writer chose. A bare string, or a time that is missing or not a number,
 *  falls back to an even share of the window; anything outside it is pulled
 *  in. In play order — the caller keeps them apart (lib/vidsCaptions). */
const asPlaced = (v: unknown, n: number, length: number): { text: string; at: number }[] =>
  (Array.isArray(v) ? v : [])
    .map((x, i) => {
      const o: Record<string, unknown> = x && typeof x === 'object' && !Array.isArray(x)
        ? (x as Record<string, unknown>)
        : { text: x };
      const raw = typeof o.at === 'string' ? Number(o.at) : o.at;
      const at = typeof raw === 'number' && Number.isFinite(raw) ? raw : (length * i) / Math.max(1, n);
      return { text: asText(o.text), at: Math.round(Math.min(Math.max(0, at), length) * 100) / 100 };
    })
    .filter((l) => l.text)
    .slice(0, n)
    .sort((a, b) => a.at - b.at);

/** The comment line is the same on every build; only the word changes, and it
 *  goes in quotes so the viewer sees exactly what to type. */
const END_LINE = (word: string) => `comment "${word}" for the link`;
/** Used when the model hands back nothing usable for the word, so the build is
 *  never missing its call to action. Generic — worth swapping by hand. */
const END_FALLBACK_WORD = 'pauv';

/** The model is asked for just the word, but it sometimes hands back the whole
 *  line, quotes it, or tacks an emoji on. All of that is peeled off; what is
 *  left is at most two words. */
function endWord(v: unknown): string {
  const clean = (typeof v === 'string' ? v : '')
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}"'“”‘’`.,:;!?]/gu, '')
    .trim();
  const inner = clean.match(/^comment\s+(.+?)\s+for the link$/)?.[1] ?? clean;
  return inner.split(/\s+/).filter(Boolean).slice(0, 2).join(' ') || END_FALLBACK_WORD;
}

/** The one line over the closing clip, built here from the word the model
 *  picked and never taken as written — the form is fixed. */
const closing = (word: unknown): string => END_LINE(endWord(word));

/** The address, as the fallback writes it. The prompt offers a few phrasings
 *  and the model picks one; this is only what goes in when it picked none. */
const SEND_LINE = 'go to pauv.com';
const NAMES_SITE = /pauv\.com/i;

/** "on pauv.com" tacked onto the end of a line — ahead of the emoji, when the
 *  line ends on one, so the address is not left dangling after it. */
function withSite(text: string): string {
  const toks = splitEmojiTokens(text);
  const last = toks[toks.length - 1];
  if (last?.type === 'emoji') {
    return `${toks.slice(0, -1).map((t) => t.value).join('').trim()} on pauv.com ${last.value}`;
  }
  return `${text} on pauv.com`;
}

/** Every build has to put the address in front of the viewer — see SEND. The
 *  model writes it nearly every time now that it is asked to, but a call to
 *  action is not a thing to leave at nearly, so a set that came back without
 *  the domain anywhere gets it put in.
 *
 *  It goes on the moment he arrives at the site — Bottom B's first line, or
 *  Bottom A's last across a merged seam, where B's first slot is deliberately
 *  blank and A's line covers both sides of it. Joined with the " / " the layout
 *  already splits on (lib/vidsCaptions), so the direction goes up first and the
 *  line it joined follows on the same moment, rather than being written over.
 *  A build with no screen recording has nothing to hang a direction off, so
 *  there it goes on the hook — the End line is the fixed comment line, which
 *  never carries anything else. */
function ensureSite(d: Drafted, mergeSeam: boolean): Drafted {
  if ([d.start, ...d.bottomA, ...d.bottomB].some((l) => NAMES_SITE.test(l))) return d;

  const onA = mergeSeam || !d.bottomB.some(Boolean);
  const lines = onA ? d.bottomA : d.bottomB;
  let i = -1;
  if (onA) { for (let n = lines.length - 1; n >= 0; n--) if (lines[n]) { i = n; break; } }
  else i = lines.findIndex(Boolean);
  if (i >= 0) {
    const next = [...lines];
    next[i] = `${SEND_LINE} / ${next[i]}`;
    return onA ? { ...d, bottomA: next } : { ...d, bottomB: next };
  }

  if (d.start) return { ...d, start: withSite(d.start) };
  return d;
}

function buildPrompt(input: z.infer<typeof Schema>): string {
  const {
    personaContext, personaName, wantStart, bottomA, bottomB, wantEnd, endContext, notes, emojis, emojiPalette,
    degen,
  } = input;
  // A placed Bottom A ends on the pick, not on the way into Pauv, so no seam
  // is merged across it whatever the caller sent.
  const mergeSeam = input.mergeSeam && !bottomA?.placed;

  /** What the reply must hold for one screen recording: a marked clip's array
   *  stays in step with its moments, an unmarked one is a ceiling. */
  const shape = (key: string, clip: typeof bottomA): string | null => {
    if (!clip?.count) return null;
    if (clip.placed) {
      return `"${key}": an array of exactly ${clip.count} object${clip.count === 1 ? '' : 's'} in the order they play, each {"text": the caption, "at": the second it comes up, from 0 to ${secs(clip.placed.length)}}`;
    }
    const n = `${clip.count} string${clip.count === 1 ? '' : 's'}`;
    return clip.marks.length
      ? `"${key}": an array of exactly ${n}, one per moment in order`
      : `"${key}": an array of ${n} — that many fit the clip. Only go under it if the context genuinely has fewer steps than that; never pad with filler`;
  };
  /** Whether there is a screen recording at all — without one, no line but the
   *  hook is left to carry the address. */
  const hasScreen = !!(bottomA?.count || bottomB?.count);

  const wanted: string[] = [];
  if (wantStart) wanted.push('"start": one caption (a single string)');
  const shapeA = shape('bottomA', bottomA);
  if (shapeA) wanted.push(shapeA);
  const shapeB = shape('bottomB', bottomB);
  if (shapeB) wanted.push(shapeB);
  if (wantEnd) wanted.push('"end": the word for the comment line (a single string holding JUST the word)');
  /** An emoji for the worked example: from the palette when there is one, so
   *  the example is made of the same set the real lines are picked from. */
  const ex = (i: number, fallback: string) => (emojis ? ` ${emojiPalette[i] ?? fallback}` : '');
  /** The same for the hook's line of the example, past any laughing face in the
   *  palette — an example that laughs on the hook teaches the opposite of the
   *  rule above it. */
  const hookEx = () => {
    if (!emojis) return '';
    // Degen wants the opposite of the rule above: the hook laughs at him.
    if (degen) return ` ${emojiPalette.find(isLaughing) ?? '💀'}`;
    return ` ${emojiPalette.find((e) => !isLaughing(e)) ?? '💰'}`;
  };

  /** The worked example's screen part, shaped the way this build's Bottom A is
   *  asked for: one line per moment, or on Fast two lines with their times. */
  const fastEx = !!bottomA?.placed;
  const exA = fastEx
    ? 'bottom a — SPED UP to play in 10.0s, so EXACTLY 2 captions, and you choose what each says AND when it comes up (the clip overall: asking chatgpt who is trending, then heading to pauv). What happens when, in seconds on those 10.0s:\n'
      + '  0.0s–3.5s: typed who\'s trending into chatgpt\n'
      + '  3.5s–7.0s: chatgpt listed names, picked ronaldo\n'
      + '  7.0s–10.0s: typed pauv.com'
    : 'bottom a — 2 moments (the clip overall: asking chatgpt who is trending, then heading to pauv):\n'
      + '  1. asked chatgpt who\'s trending, picked ronaldo\n'
      + '  2. typed pauv.com';
  const exLines = fastEx
    ? `bottomA: [{"text": "ask chatgpt who's trending rn${ex(1, '👀')}", "at": 0}, {"text": "pick ronaldo from the list", "at": 3.5}]\n`
      + `bottomB: ["search ronaldo on pauv.com", "trade up on him bc he's trending${ex(2, '📈')}"]`
    : `bottomA: ["ask chatgpt who's trending rn${ex(1, '👀')} / pick ronaldo from the list", ${mergeSeam ? '"go to pauv.com, search ronaldo"' : '"go to pauv.com"'}]\n`
      + `bottomB: [${mergeSeam ? '""' : '"search ronaldo on pauv"'}, "trade up on him bc he's trending${ex(2, '📈')}"]`;
  const exShape = fastEx
    ? 'bottom a is on fast, so it is two captions: the search at 0, and the pick at 3.5, where that moment starts. '
    : mergeSeam
      ? 'the seam is merged there: one line across the end of A and the start of B, and "" in B\'s first slot. '
      : 'one short line per moment, in its own slot. ';
  const exSite = fastEx
    ? '"pauv.com" is spelled out the once, on the first bottom b line, since neither bottom a caption is where he types it'
    : '"go to pauv.com" spells the address out the once, on the moment he gets there. Moment 1 of bottom a is two things — the search, then the pick — so it is two short captions with " / " between them, one after the other, and the pick names ronaldo';

  /** A marked clip is a numbered list of moments; an unmarked one is a sentence. */
  const describe = (label: string, clip: typeof bottomA, onPauv = false): string => {
    if (!clip) return `${label}: (no clip)`;
    // Said again right beside the moments, because that is where it gets
    // ignored: a list of marks that never mentions Pauv reads like a list of
    // steps taken somewhere else.
    const where = onPauv ? ' Every one of these is on pauv.com, whether or not the moment says so.' : '';
    if (clip.placed) {
      const { length, spans } = clip.placed;
      const steps = clip.marks
        .map((m, i) => {
          const s = spans[i];
          return s ? `  ${secs(s.start)}–${secs(s.end)}: ${m}` : `  ${m}`;
        })
        .join('\n');
      return `${label} — SPED UP to play in ${secs(length)}, so EXACTLY ${clip.count} captions, and you choose what each says AND when it comes up`
        + `${clip.context ? ` (the clip overall: ${clip.context})` : ''}.`
        + (clip.marks.length
          ? ` What happens when, in seconds on those ${secs(length)}:${where}\n${steps}`
          : ` Nobody has marked when things happen in it, so place them from the context and how a recording like this usually goes.${where}`);
    }
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
Part 3 — END: the pay-off. He is back on camera showing off the money the trade made him, and over the whole of it ONE caption: the line that sends the viewer to the comments for the link. Nothing is written about the money — the clip already shows it.

WHAT EACH CAPTION DOES
${degen ? DEGEN_HOOK : HOOK}
BOTTOM A and BOTTOM B — tell the viewer what to do, step by step, so someone learns how Pauv works by following along. Assume they CANNOT see the screen: the recording is small and quick, and most people read the caption and never make out what is on it. So every line has to stand on its own — name the site or app and the exact thing being done there, in the words the viewer would need to go and do it themselves. Not "type in most hated person in the world" but "search on chatgpt most hated ppl rn". Not "click the button" but "hit trade up on pauv.com". Not "look him up" but "search ronaldo on pauv". Each caption still describes ITS OWN clip: a Bottom A caption is what the viewer does in the Bottom A recording, a Bottom B caption in Bottom B — which is on pauv.com every time, whatever its context happens to mention. Do not describe a step that is not on that clip's screen.
When a clip is given as a numbered list of moments, a caption goes on screen at exactly its moment and stays up until the next one — so caption 1 describes moment 1 and nothing else, caption 2 moment 2, and so on. Every moment gets its own caption: keep them in order, never skip one, never merge two into one line${mergeSeam ? ' — except at the seam, below' : ''}. Each line says what is on screen RIGHT THEN, not what came before or what comes next.
A moment that is really two things — go to the site, then do the thing there — or that will not fit in one short line, gets TWO captions: put both in that moment's one entry with " / " between them, like "go to chatgpt / see who the most hated person is rn". The first goes up where the moment starts, the second halfway through it. Two at most for a moment, and the entry still counts as one, so the array stays one entry per moment. Split rather than write one long line. The same " / " works inside any line of an unmarked clip.
${bottomA?.placed ? `${FAST_A(bottomA.count, bottomA.placed.length)}\n` : ''}END — ONE caption, up over the whole of him showing the money: THE COMMENT LINE, one fixed line, always exactly: comment "<word>" for the link. The line is already written, quotes and all; the ONLY thing you choose is <word>, what a viewer types in the comments to get the link. Reply with JUST the word as "end", not the whole line. It must match THIS video — the name of the person he traded on ("ronaldo"), or the stupid thing he did on camera ("velo") — taken from the contexts below, never made up. One word, two at the very most. Lower case, no quotes, no emoji. Not "pauv", not "link".
Do NOT write a line about the money he made. There is no caption for it: the ending is the comment line and nothing else, so whatever he made is left to the picture.

ONE STORY, NOT FOUR SEPARATE CAPTIONS
Read everything under THIS VIDEO before you write a word — the persona bit, both screen recordings, the ending — and keep the whole of it in mind for every line. The captions are one story told in order: the hook sets up what he is about to do online, each screen-recording line carries that same thread on (the same person he is trading on, the same reason he picked them, the same site), and the closing word ties it back. A line written from its own clip alone reads like a stranger wrote it. When a Bottom B line says "trade up on him", "him" is the person named in the hook and Bottom A; when the hook names who he made money on, it is the person the screen recording actually shows; the reason he picked them (trending, most hated, just got signed) can be carried from the clip that gives it into the lines that don't. Every line still says what is on screen RIGHT THEN — the whole video is what you write each line WITH, not what you write it ABOUT.

${mergeSeam ? `THE SEAM
Bottom A's last moment and Bottom B's first moment are too brief to carry a line each, so they share one. Write ONE short line that covers both — what he does at the end of A and straight after at the start of B, like "go to pauv.com, look up ronaldo" — as the LAST entry of "bottomA", and put "" (empty) as the FIRST entry of "bottomB". That "" is the only blank anywhere; every other moment still gets its own line.

` : ''}${WHERE}

${FIXED}

${SEND(hasScreen, !!bottomB?.count)}

${style(emojis, emojiPalette, degen)}

${IMPERATIVE}

WORKED EXAMPLE
persona context: putting a can of velo in mouth
${exA}
bottom b — 2 moments (the clip overall: finding ronaldo on pauv and trading up on him):
  1. searched ronaldo
  2. traded up on him
->
start: ${degen ? `little goy boy trades on ronaldo (i need serious help)` : `velo in my mouth making bands on ronaldo`}${hookEx()}
${exLines}
end: ronaldo
(${exShape}"end" closes it on its own: over the whole of the money he shows off, the one fixed line, which reads comment "ronaldo" for the link — and nothing is written about the money, since the clip is already showing it. Every screen line says where he is and what he does there — chatgpt, pauv.com, ronaldo — so it reads without seeing the screen; "him" in the last bottom b line is the ronaldo from the hook and bottom a, one story across all of it. ${degen
  ? 'The hook is degen: what he calls himself, who he is trading on, and the aside in brackets — no money anywhere near it'
  : 'The hook says he is making bands, names ronaldo and the velo in his mouth — the weird thing from the persona context — and never mentions the typing'}; ${exSite}; "rn" and "bc" are the text-speak)
${emojis ? `(the three emoji there are just where they happened to land for that video — choose your own${emojiPalette.length ? ', from the saved set above,' : ''} for this one)` : ''}
THIS VIDEO
persona${personaName ? ` (${personaName})` : ''} context: ${personaContext || '(not given — no weird thing to name, so the hook is just the money and who he is trading on)'}
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
      thinkingLevel: 'low',
      // Warm enough for the hook to be odd, not so warm it stops following the
      // brief on the how-it-works lines.
      temperature: 0.9,
      // Thinking is billed against this, and at 2048 a 'low' run's thoughts could
      // take enough of it that the JSON stopped mid-object — about one build in
      // four came back "Unterminated JSON object". The lines themselves are a few
      // hundred tokens; the rest of this is headroom for the thinking.
      maxOutputTokens: 6000,
    });

    const parsed = JSON.parse(extractGeminiJson(raw)) as Record<string, unknown>;
    // Bottom A on Fast comes back as lines with the second each goes up.
    const placedA = bottomA?.placed ? asPlaced(parsed.bottomA, bottomA.count, bottomA.placed.length) : null;
    const drafted: Drafted = {
      // Degen's hook is allowed to laugh at him — it is the one voice where a
      // face crying with laughter is the line landing rather than the line
      // being explained away.
      start: wantStart
        ? (input.degen ? cleanLine(parsed.start) : dropLaughing(cleanLine(parsed.start)))
        : '',
      bottomA: placedA
        ? placedA.map((l) => l.text)
        : asLines(parsed.bottomA, bottomA?.count ?? 0, !!bottomA?.marks.length),
      bottomB: asLines(parsed.bottomB, bottomB?.count ?? 0, !!bottomB?.marks.length),
      end: wantEnd ? closing(parsed.end) : '',
    };
    const done = ensureSite(drafted, input.mergeSeam && !bottomA?.placed);
    return NextResponse.json(placedA ? { ...done, bottomAAt: placedA.map((l) => l.at) } : done);
  } catch (err) {
    console.error('[vids captions POST]', err);
    const msg = err instanceof Error ? err.message : 'unexpected error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
