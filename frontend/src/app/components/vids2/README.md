# Vids 2

A form, then a tuning page. It sits under Vids in the left sidebar and lives at
`/vids-2`. Since 2026-09-18 it is the only place a video is built here: Vids
itself is the library its footage is filed in, and the Simpler section — whose
build logic this one runs on, still under `lib/simpler/` — is gone.

Vids and Simpler both used to open on a builder: an empty stage and cards to
fill it from. Vids 2 opens on **five cards, top to bottom** — Who, Intro,
Which way, Mode, Persona — and one Generate button at the foot of the page.
One card is open at a time and it is always the next thing to do: the cards
above it are folded to their answer (press one to change it), the cards below
are dim until the form gets there. **Pressing an answer is the answer** — a
name, a story, Up, Degen, a persona tile each moves the form on by itself.
Only the two things that are typed (a ChatGPT question, a story searched for
somebody already chosen) wait for **Continue**. Which way and Mode have a
default but are still asked once each. On a return visit every answer is
already there, every card is folded, and Generate is lit.

The five cards —

1. **Who** — two tabs. **👤 By name**: anybody on Pauv, from the roster itself
   (`/api/ai/talents`), not from what has been filmed. The box opens its list
   as it is focused: the **Suggested** names starred in gold at the top, then
   the roster by who is moving on Pauv — today's change, then the week's, then
   holders (`byTrending`) — with today's change beside each name. **🔥 In the news**:
   the trending list, read the moment the tab is opened (below). Picking a
   story answers Who *and* the intro, and a story that names more than one
   person on Pauv asks which before moving on.
2. **Intro** — what opens the video, Bottom A (`Vids2Intro`). Three ways:
   - **No intro** — nothing before the trade; the video goes straight to
     trading on them on Pauv. Bottom A stays empty.
   - **ChatGPT** — the question typed into ChatGPT. Write it, or have it
     written (Ragebait / Factual, `api/vids/question`).
   - **News article** — a real story about them, found the way Studio > News
     finds one (`lib/news/client`): the search runs by itself the moment News
     is pressed, for the range chosen (a week, to start), and picking a story
     is the answer. The search goes by the whole name and by what
     headlines call them for short (`lib/news/name-forms`, below). It is read
     off the outlet and
     checked, and its page is drawn on the form — grey where the photos will
     go — to scroll through. Generate finds the photos and records it
     (`makeNewsClip` in `lib/vids2`). A story is kept with the answers, and
     is only an answer for the person it was found for: change Who and it
     has to be searched again. A **link can be pasted** instead of searched
     for — any article page on an approved outlet, read and checked the same
     way (`pastedLinkProblem`, `hitFromStory` in `lib/news/client`).
3. **Which way** — up or down.
4. **Mode** — 👔 Serious, 😐 Middle or 💀 Degen (`Vids2Mode`). Each is below.
5. **Persona** — every persona in the library as a tile (its Top A still and
   its name), with a **🎲 Random** tile first that picks one of the personas
   with all three clips. A tile pressed is the last answer, and Generate lights.

The order is what each recording waits on, soonest first — because each one
**starts as soon as its own answers are in**, not when Generate is pressed.

## The head start

`makeNewsClip` wants the story, `makeChatGptClip` the question, `makeTradeClip`
the name and the direction. Nothing any of them reads is asked after question
3, so each is started the moment the question it was waiting on is left behind
(`headStart` in `Vids2Section`, `onHeadStart` in `Vids2Form`), and **Generate
takes what is already running** rather than starting it. Answer Mode and
Persona at a normal pace and both recordings are usually done before Generate
is pressed; a small pill on the Intro card and the Which way card says so
(✓ Ready, or the percentage), and Generate's own progress picks their lines up
where the head start left them.

It is a render and nothing else: no stage, no words, no video until Generate.

Each run is keyed by the answers it was started from (`warmKey`). Change one
and the run is for a video nobody is making — it is dropped, its bytes let go
(`stopRun`), and the answer that replaced it starts its own when it settles, so
a question being retyped does not start a render on every letter. Two details:

- **Which way** is in a ChatGPT intro's key, because the model is told the
  direction before it writes a word — pressing it at question 3 starts that
  intro again. It is *not* in a news intro's key: those frames are the same
  either way and only the filed name carries it, so the run is kept and the
  name re-stamped (`stamp` in `generate`).
- **Light or dark** is rolled where the render starts rather than where
  Generate does (`rollTheme`), since by then the frames are already drawn.

A head start that fails is not taken: Generate makes that recording itself and
fails the way it would have anyway. Reset, leaving the page, and a Generate
that is cancelled all let the bytes go.

Mode (the hook's guide, the BOOMs) and Persona (the three clips around the
trade) are read by neither recording, which is why they are what gets asked
over the top of the rendering.

## In the news — the second tab of Who

**🔥 In the news** turns the form round: instead of picking somebody and then
looking for a story, see who is trending and make the video straight from the
story. It is one tab, not a second form —

1. **The list** — every story the approved outlets have put out in the past 24
   hours (1h, 6h and a week a press away) whose **headline names somebody on
   Pauv**, twenty shown, each with who it names, when it went out, and its
   **heat** — the AI's read, out of 100, of how hard the headline would stop
   somebody scrolling, with the hook in a few words ("traded to the lakers").
   **🔥 Biggest** first, to start; **🕒 Newest** is the other order. **↻**
   reads them again; **No politics** leaves those out. The list is read the
   moment the tab is opened, not on a button.
   Pick one — or paste a link — and it is read off the outlet and checked.
   That answers Who *and* the intro: the person is whoever the headline names
   first, and when the story names more than one person on Pauv the card asks
   **Who is the video about?** with a button each before moving on (the same
   names sit under "Trading on" on the Intro card, to swap later).
2. The form skips Intro, since the story is the intro, and opens **Which way**;
   then **Mode** and **Persona** as above. Open Intro from its folded card to
   see the story's page, pick another story, or switch to ChatGPT or no intro.

It is one set of answers whichever tab answered Who, and `flow` only records
which (`'news'` when a story did) — Generate gets exactly the same setup either
way. Switching the intro to anything but News puts `flow` back to `'who'`,
because `loadSetup` makes a saved news flow a news intro again.

The list is `lib/news/trending` behind `GET /api/news/trending?window=24h`:

- **Headlines** — Google News, one feed per outlet per window. A feed stops at
  100 items and a day of ESPN is more than that, so a day is read as the day
  *and* as its last six hours. `when:` is only roughly kept to (a years-old
  item turns up in a `when:1h` feed), so everything is held to the window by
  its own timestamp. IMDb comes from its own lists.
- **Names** — `lib/news/roster-match`: whole names only, off the whole roster
  (`pauvPeople`), accents folded, a dot or a trailing Jr. optional. One-word
  names match as the roster spells them or in capitals, never lower case, so
  "the future of AI" is not Future. Short forms ("Putin", "LeBron") are *not*
  matched here — `name-forms` asks Gemini one name at a time, which is no way
  to go through 1,255 people — so the trending list under-counts people the
  press calls by one name. Searching them by Who still finds those.
  How many of the window's headlines name each person is kept too (`buzz`):
  somebody in nine of them is what today is about.
- **The read** — Gemini (the site's flash model, minimal thinking) over every
  match in the window, up to 200, forty headlines to a call with the calls
  side by side, so it is a few seconds rather than most of a minute. Three
  things a name match can't know: whether "Future" is the rapper or "Dave" is
  Dave Chappelle; whether the story is politics; and its **heat** — 0 to 100
  against a fixed scale (90+ a death, an arrest, a scandal, a blockbuster
  trade, a feud blowing up; 70s a lawsuit, an injury, a remark; 40–69 ordinary
  news; under 40 filler), eyeballs and not importance, leaning up for somebody
  in a lot of headlines and for the more famous. The scale is absolute so
  scores from different calls sort together. The **whole window** is read,
  not its newest: the biggest story of the day may be ten hours old.
  Without Gemini the matches stand, less the one-word names that are also
  ordinary words (`isOrdinaryName` in `roster-match` — Future, Dave, Offset,
  Rosé as "Rose"), Biggest falls back to `buzz` and then the clock, and the
  form says so.
- **Links** — only what is sent is resolved to the outlet's URL: the 30
  hottest that aren't politics, the 15 hottest that are, and the 25 newest
  (they overlap). Video, live and section pages are left out, as search does.
  The newest are resolved while Gemini reads.
- **Politics** is any of: somebody filed under Politics on Pauv in the
  headline, `/politics/` in the outlet's link, or the AI's reading. The form
  shows 20 of what is sent and does the ordering and the hiding itself
  (`sortTrending` in `lib/news/client`), so either order, politics in or out,
  fills the list without another read.

A pasted link has nobody searched for, so `api/news/article` now also returns
`people`: everyone on Pauv the story names, the headline's first, then by how
often the story says them. It has no AI check, so those ordinary one-word
names are left out of it: a pasted story about Future has to be made from
Who. Studio > News uses the same `people` for its own paste box.

**Generate**, at the foot of the page, is lit once all five cards are answered
and makes the whole video from the answers before showing you anything; while
it runs it is the progress bar. Then it lands on the tuning page — a fork of
what was Simpler's builder, with the deciding taken out: the sound, the
captions, the BOOMs, the post caption and Download MP4. **← Start over**, top
right, starts Vids 2 over after a confirm: the video, its sound and its words
go, every answer is cleared, and the form opens on its first card.

## Bringing a video back by its code

Every Download writes the build down under a six-letter code
(`lib/simpler/vidsRecipe` → `api/vids/recipes`, `vids_recipes`): a three-word
title from the model, the persona, every slot's clip and settings, the sound,
the captions — and, since 2026-09-22, **the form's answers** (`Vids2Answers`,
`build.vids2` in the record), because the two recordings the record names were
never filed and can't be pointed at. The code sits after the title in the file
name (`Chipotle Lebron Trade - 8JEQMP.mp4`), on the end of both post captions
on a line of its own, and on the line under the tuning page's summary. It is
**minted in the browser as Download is pressed** (`mintRecipeCode`), so the
captions carry it in that same press; the server writes the record under it
and only mints its own if that one is taken (the reply says which), while the
three-word title is written during the render. An export that fails or is
cancelled takes the code back off the captions.

**The code box** sits top left of the form, and only there (`Vids2Recall`).
Type a code — or paste the whole file name; the code is picked out of it — and
`loadCode` in `Vids2Section` brings the video back:

1. The record is read (`GET api/vids/recipes/:code`) and its answers taken
   off it (`answersFromRecord`): who, which way, the intro and its question or
   story, the mode, and which way Pauv came up. A news story is only its
   address in the record, so it is read off its outlet again
   (`readStoryAgain`, the same route and checks a pasted link goes through);
   the persona is looked up by its id.
2. The form is mounted afresh on those answers — every card folded, the way it
   opens on a return visit — and, with nothing missing, **Generate is pressed
   for you**. Both recordings are made again from the answers (the trade
   light or dark as it was, not rolled), and the tuning page puts the record's
   words, look, size, song and levels on (`build.restore`, `restoreRecord` in
   `Vids2Builder`) rather than rolling a song and a look and asking for the
   words. Nothing is asked of the hook or captions routes; the post captions
   are not on the record and are written fresh, as ever. Hand-laid BOOMs come
   back where they were; a degen build's are laid on the new recordings' own
   beats instead, since the old timeline seconds were the old recordings'.
3. Short of an answer, it stops on the form and says why on the box: the
   persona gone from the library, a story that can't be read any more, or a
   record from before the answers were kept — those have only their clip
   names to go on (`bottomBName` says who, which way and the theme;
   `bottomAName` / `bottomANewsName` say what kind of intro), so the question
   or story and the mode are missing and the Intro card is left open. Answer
   what is missing and press Generate: the record is still waiting
   (`pendingRef`) and is taken as long as the answers are still that video's
   (`sameVideo` — the same person, way, intro and mode).

The recordings are rendered anew, so a ChatGPT answer, the trade's prices and
the story's photos are today's; the words over them are the ones that were
exported. Reset clears a waiting record with the answers. The clipper page has
the box too, and the recipes route is already in the clipper allowlist
(`CLIPPER_API_UNDER` in `middleware.ts`).

## One video, every recording rendered here

Bottom A is the intro — the ChatGPT search, or the news story, or nothing —
and Bottom B is the Pauv trade, and Vids 2 renders **every one of them** for
this one video rather than picking any off a shelf. That is the difference
from Simpler, which renders Bottom A and takes Bottom B from the clips filed
under that folder. Nothing Vids 2 makes goes to the library, and nothing
survives the page being left.

The news intro is the recording Studio > News makes
(`components/news/news-video.ts`): Google with the story as the third result,
the click, the outlet's page loading with its pictures arriving late, their
name dragged over and zoomed in on. Its photos are found the way that page
finds them — free ones of the person and the side column's thumbnails,
`lib/news/client` — and it is filed on the stage the way the ChatGPT one is:
a name, a context that says Google and the outlet, and three abutting marks
— Google up to the click, the story from the click to the pointer pressing on
their name (`nameAt`), the name from there to the end. Its captions are three,
one per mark, and the first two are fixed outright (`NEWS_BOTTOM_A_LINES`):
"look for trending news on google", then "find someone trending"; the third
is the pick, rolled from `BOTTOM_A_PICK` the way a ChatGPT clip's is ("lock
in trump"). A news intro is never captioned on Fast's two placed lines.

The intro and the trade are made **at the same time**. Neither needs anything
from the other, and each spends a good part of its time waiting on something
that is not the CPU — the model answering, the photos, the roster arriving —
which is exactly the time the other can be drawing frames in. They share one
thread, so the drawing still takes the drawing's time; what goes is one wait
sitting behind the other. The first real failure aborts the pair. With no
intro there is only the trade.

The library is still read for two things: the **persona**'s three clips, and
an **End** off the shelf. (And Bottom B's folder, for a BOOM filed by hand.)

## The modes

The other questions say what the video *is*. The mode says how it talks.
Serious and Middle each change one line — the hook — and nothing else. Degen
changes the hook and two more things.

Every hook is written in `api/vids/hook`, by Claude Sonnet 5 at low effort
(Opus 5 at medium until 2026-09-18, swapped for cost), on its own call
beside the one that writes the rest of the words (`api/vids/captions`, which
Vids 2 never asks for a hook). None is written off the screen recordings, so
none waits on them: the hook lands as it comes back. The trading verb is drawn
by the route, not the model — down is always "shorting" / "shorts", up is
"going long on" or "trading on" / "goes long on" or "trades on" — and a line
that says the trade on another verb has it swapped.

**Serious** is flat and in a fixed order: the trading verb, the person, now and
then a real-world moment that gives the trade a reason, and what the money
does. Nothing about what the persona is doing, no "man", no emoji, lower case.

> going long on taylor swift before the tour announcement to cover a year of rent
> shorting drake before the album drops to pay off the car

**Middle** uses exactly two of three parts — a money analogy, what the persona
is doing (off the persona's context), the trade — or the **clock**, and the
route draws which, a quarter each. A build with no persona context has no
activity to name, so it is analogy + trade or the clock, half each.

> making a surgeon's salary from the hot tub
> shorting drake mid haircut
> how to make a lawyer's salary shorting kanye

**The clock** is the money against how little time it took — no trade, no
name. Its time is a task off a fixed pool of thirteen (a quarter of clock
lines), what the persona is doing said as a task (a quarter), or one of four
drawn numbers with what they are doing after "while" (half). Without a
context it is always the pool. A context that is only a place or a state
("in a grocery store") has no task in it, and the pool stands in. The route
puts the line together from the model's parts — opener, analogy, and the task
or activity when the branch needs one — so it can't open wrong, lose its
"while" or carry a number and a task together.

> making rent in the time it takes to lose an argument
> making a car payment in the time it takes to put on a suit of armor
> making rent in 67 seconds while half asleep

**One hook in five is a twist**, whatever the mode, one of three at even odds:
a **mystery** — the trade on someone described but never named — **hype** —
the name and how high it is going — or **me if** — the trade caught in the
middle of what he is doing on camera, "was legal". Hype only goes up, so a down
trade's twist is a mystery or a me if. Degen's hype and me if say the nickname;
everything else about the three is the same in every mode. A mystery that names
them, or a me if that breaks its frame, is written again.

Me if is the one twist written off the video: where it catches him is the
persona's context, the same place Middle's activity comes from, and is never
invented. A build with no context has nothing to catch him at, so it draws from
the twists that need none (`NO_CONTEXT_TWISTS`).

> shorting the greatest musician of our generation
> going long on the most unhinged billionaire
> messi to the stratosphere
> swifty to outer space (Degen)
> me if shorting drake mid haircut was legal
> me if going long on swifty in the hot tub was legal (Degen)

Every fixed list, every odd and every guide's examples live in
`lib/vids2/hookRules.ts`, which the route draws from. The **?** beside Start in
the tuning page's captions opens `Vids2HookGuide`, a page over everything that
lays all of it out — every mode, every twist, every percentage — read off that
same file, so it can't say one thing while the route does another.

**The hook is always two lines** on the frame, broken where the two come out
closest in width, the type shrunk — Start only — until the wider fits
(`CaptionLine.twoLines` in `lib/simpler/vidsCaptions`). Vids2Builder puts it on
as the captions are laid out, never on the line itself, so no rewrite or hand
edit can leave it off; Simpler never sets it. A one-word hook stays one line.

### Degen

Degen changes three things and nothing else.

**The random song can be a degen one.** Songs are marked degen on the Music
page (`vids_track_degen`, handed out by `api/charts/list-audio`). The song a
build rolls — when the list first arrives and for every new build — comes from
every song in degen mode and from the rest only otherwise (`rollableMusic` in
`Vids2Builder`). That is the roll and nothing more: a degen song chosen by
hand from the builder's Music list stays on any build.

**The hook is a self-own with a nickname**: descriptor + trade + nickname +
(bracket) + emoji.

> chopped kid shorts musky (i need serious help) 🔥
> tweaker goes long on swifty (i love you swifty)

Every part but the nickname comes off a fixed list, so the route draws those
itself and asks Claude for the nickname alone — a funny shorthand when one
lands, the plain name when not — plus its one-word short form. The descriptor
is one of chopped kid, homeless man, tweaker, dude, kid. The
bracket is one of nine self-owns followed by 💯 🔥 😎 or 🥀; or, a third of the
time when the nickname has a short form of eight letters or fewer,
"(i love you <short>)" with no emoji. The step-by-step lines still teach
someone how Pauv works and the closing word is the same fixed comment line,
because that is what the video is for.

**Two BOOMs lay themselves** (`degenBooms` in `lib/vids2/vids2Build.ts`), on
the beats somebody watching would react on — one, with no intro:

| When | Sound | Picture |
| --- | --- | --- |
| The intro zooms in on them — the first quick in-out zoom pulse on their highlighted name, once it has been dragged over, in the ChatGPT answer or the story alike (each renderer's `pulseAt`). Never on the pointer going for the name or the drag | fahh (2.2s) | the BOOM |
| Place trade goes in (Bottom B, `confirming`) | fahh (2.2s) | the BOOM |

Until 2026-09-18 a third lay itself between them: an "oh hell nah" (7.4s) on
their page opening, the noise alone. It was dropped — it should not come by
itself — but what carried it stays: `BoomInsert.picture: false` is a BOOM that
is on the timeline (the bang, and the bar's mark, half height so it reads as a
noise rather than a hit) that neither renderer draws.

Every bang plays its own full length wherever it lands — the preview drives it
from its own `<audio>` and the export lays it with `scheduleOnce`, neither of
which is bounded by `BOOM_LENGTH` — and two that run into each other both play.
The only thing that ever cuts one short is the end of the video.

Each moment is a second into its *own* recording, straight off that renderer's
beats, and the tuning page puts it on the timeline through the slot's plan item
— where the slot starts, where it was trimmed from, how fast it plays. Once
they are down they are ordinary BOOMs: the bar marks them, pressing a mark
takes that one off, Insert adds a third. They are laid once per build, held by
the build's number, so taking both off does not bring them back.

The sounds come out of `public/audio/booms` and are matched on the file name
(`/fa+h+/i`), not named outright — so a better take
dropped in under a near-enough name is picked up, and a folder tidy-up does not
break a build. A sound that is not there leaves its BOOM silent rather than not
laid at all.

## It is NOT a third copy

Simpler was a deliberate fork of Vids — its own components, its own build logic,
nothing shared, everything hand-synced. **Vids 2 is not that.** It took
Simpler's logic outright rather than copying it, which is why deleting that
section left the engine standing: `lib/simpler/*` and the captions rail under
`components/simpler/` are Vids 2's now, kept under the old name.

| What | Where | Whose |
| --- | --- | --- |
| The plan, compose, audio, captions, edit, recipe, local clips | `lib/simpler/*` | Vids 2's, under the old name |
| The captions rail | `components/simpler/VidsCaptionsRail` | Vids 2's, under the old name |
| The post captions (Copy for IG, Copy for TikTok), written from a news search, asked for the moment Generate is pressed | `components/vids2/Vids2PostCaption.tsx`, `api/vids/post-captions` | Vids 2's own |
| Asking for the words off the plan, so Generate can while the frames are drawn | `lib/vids2/vids2Words.ts` | Vids 2's own |
| The ChatGPT recording | `components/chatgpt/chatgpt-video.ts` | shared with everybody |
| The news recording | `components/news/news-video.ts` | shared with Studio > News |
| Searching, reading and photographing a story | `lib/news/client.ts` | shared with Studio > News |
| The trending list, and finding Pauv's people in text | `lib/news/trending.ts`, `lib/news/roster-match.ts`, `api/news/trending` | the news side's; Vids 2 the only caller of the list |
| The Pauv trade recording | `components/trade/trade-video.ts` | shared with everybody |
| The form, the tuning page, the section | `components/vids2/*` | Vids 2's own |
| The answers, degen mode, the roster, the news-story-as-a-Bottom-A, the trade-as-a-Bottom-B | `lib/vids2/vids2Build.ts` | Vids 2's own |
| The degen hook (`DEGEN_HOOK`, behind an optional `degen` flag) | `api/vids/captions` | shared route, Vids 2 the only caller |
| The five answers, degen mode, the roster, the trade-as-a-Bottom-B | `lib/vids2/vids2Build.ts` | Vids 2's own |
| The hook for each mode | `api/vids/hook` | Vids 2's own |
| The hook's fixed lists, odds and examples; the ? guide to them | `lib/vids2/hookRules.ts`, `components/vids2/Vids2HookGuide.tsx` | Vids 2's own |

**So a change to `lib/simpler/*` is a change to how Vids 2 builds a video** —
there is nothing else left in there to break, and no second copy to keep in
step. That was the point: a third hand-synced copy of nine thousand lines would
have had to be kept in step with two others forever. What is forked is only what
actually differs — the pages.

`Vids2Builder.tsx` began as a fork of `components/simpler/VidsBuilder.tsx`,
diverging on purpose: no Persona card, no Bottom card, no Reset, a summary of
the form's answers in their place, and the captions asked for by Generate while
the recordings render rather than when a bottom is chosen. That original is gone
with its section, so it is nobody's twin now — there is nothing left to sync it
with by hand.

## What Vids 2 added to the shared files

These, all optional, all defaulting to how it has always been — so nothing Vids
or the Studio pages do moved.

- **`LocalClipMeta.theme`** (`lib/simpler/vidsLocal.ts`). A Bottom B carries
  which way Pauv was, because that is what the frame puts either side of the
  recording (`vidsPlan` `itemBacking`), and Vids 2 is the only caller that
  renders one.
- **`SlotPick.centred`** (`lib/simpler/vidsPlan.ts`, through `PlanItem`,
  `RecipePick` and the recipes spec). The house nudges every Bottom B
  `BOTTOM_B_LEFT` (5%) to the left, because one filmed off a screen wants it.
  Vids 2's is the page itself, drawn square on to fill the frame, so it sits
  dead centre. Left unset everywhere else, which is the nudge.
- **`onPlanned`** on the three renderers (`renderChatVideo` /
  `makeChatGptClip`, `renderNewsVideo`, `renderTradeVideo`): the clip's beats,
  length and size, called once they are worked out and before the first frame
  is drawn. With **`plannedClip`** (`lib/simpler/vidsLocal.ts`) — the row a
  clip will have, minus its bytes — that is enough to lay out the plan while
  the frames are still going.
- **An optional `signal`** on `writeCaptions`, `writeHook` and
  `writePostCaptions` (`lib/vids-client.ts`), so a cancelled Generate stops
  the calls it set off.

## The trade's captions

Bottom B is the rendered trade, four beats, one caption each — and only one
of the four is written:

| Beat | Caption |
| --- | --- |
| Searching them | fixed: go to pauv.com / search {name} (`bottomBOpen`) |
| Reading their chart | one at random: check their chart, look at the price, analyze... |
| Putting the money on | written by Gemini (`api/vids/captions`), always with the amount in $ |
| The trade goes through | one at random: locked in, trade confirmed, confirmed, order placed |

The two sets and the trade line's fallback are `bottomBFixed` and
`bottomBTrade` in `lib/vids2/vids2Build.ts`. The captions call goes out with
`renderedTrade`, which tells the writer those slots are fixed and the trade
line carries "$10", never "10 dollars"; a trade line that still comes back
without a $ amount is replaced with "put $10 up on {name}". The confirmation
never repeats a line Bottom A's pick already landed on ("locked in" is in
both sets).

## Things worth knowing

- **The words are written while the frames are drawn.** Generate asks for the
  hook and both post captions the moment it is pressed: they are written off
  who, which way, the mode and the persona, nothing on a recording. The post
  captions are told who and which way outright, so the route skips reading
  them off the recordings and goes straight to the news search, and each ask
  is `fresh` — a second video on the same person the same day gets its own
  pair rather than the one the route kept. The rest of the captions go the
  moment both recordings have been laid out (`onPlanned`), off the plan they
  are about to make. The tuning page takes what comes back (`Vids2Early`)
  instead of asking again, so the words are usually there when the stage is,
  "Consider holding" included. Rewrite still asks afresh from the stage. A
  build with a library clip whose length isn't known waits for the browser to
  measure it, then writes, as it used to.

- **Light / dark is rolled, not asked** — even odds on every Generate
  (`rollTheme`), and the tuning page's summary says which came up. It is the
  Pauv page only: the ChatGPT renderer has no light mode, so that recording is
  always dark.
- **The news search knows short names.** `lib/news/name-forms` asks Gemini
  once per name (cached for the server's life) which short forms the press
  uses: ones safe to search alone ("Putin", "LeBron", "AOC") get a Google
  News feed of their own beside the whole name's, and ones too common to
  search alone ("Swift", "James", "Paul") only count in the headline of a
  story found for the whole name. Either kind counts as the name being in the
  title, and the recording drags over the form the headline uses
  (`NewsHit.namedAs`). Without Gemini it falls back to the surname and first
  name, headline-only. Studio > News shares all of it.
- **The question keeps its capitals.** Only the two Generate question buttons
  come back lower case, the way a search bar is typed into; a question written
  by hand goes to ChatGPT exactly as it is written.
- **The trade plays at `INTAKE_SPEED`** (1.25×), which is the speed every filed
  Bottom B is rendered at. A screen recording of the site runs slow to watch
  back, and one made here is the same recording as one made with a screen
  grabber.
- **The answers are remembered** between visits (`vids2-setup-v1` in
  localStorage). The video is not: leaving the page lets both recordings go.
- **Generating survives a tab switch.** StudioShell keeps the section mounted
  once visited, which matters more here than anywhere else — a Generate is two
  video encoders running in this tab.
