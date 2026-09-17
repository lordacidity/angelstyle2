# Vids 2

A form, then a tuning page. It sits under Simpler in the left sidebar and
lives at `/vids-2`.

Vids and Simpler both open on the builder: an empty stage and cards to fill it
from. Vids 2 opens on six questions instead, asked one at a time —

1. **Who** — anybody on Pauv, from the roster itself (`/api/ai/talents`), not
   from what has been filmed.
2. **Mode** — 👔 Serious, 😐 Middle or 💀 Degen (`Vids2Mode`). Each is below.
3. **Which way** — up or down.
4. **Look** — light or dark.
5. **Persona** — Simpler's own chooser (`components/simpler/VidsPicker`).
6. **The question** — what gets typed into ChatGPT. Write it, or have it
   written (Ragebait / Factual, `api/vids/question`).

Nothing moves on by itself: pick an answer, then press Next; Back goes back
one. A strip along the top holds every answer given so far,
and pressing one goes back to it. The form opens on Who, or on the question
when Change brought you back from a video.

— and **Generate**, on the last question, makes the whole video from the answers before showing you
anything. Then it lands on the tuning page, which is Simpler's builder with
the deciding taken out: the sound, the captions, the BOOMs, the post caption
and Download MP4. **Change** goes back to the form with the answers as they
were left; Generate again replaces the video.

## One video, both recordings, rendered here

Bottom A is the ChatGPT search and Bottom B is the Pauv trade — and Vids 2
renders **both** for this one video rather than picking either off a shelf.
That is the difference from Simpler, which renders Bottom A and takes Bottom B
from the clips filed under that folder. Nothing Vids 2 makes goes to the
library, and nothing survives the page being left.

The two are made **at the same time**. Neither needs anything from the other,
and each spends a good part of its time waiting on something that is not the
CPU — the model answering, the roster and the photos arriving — which is
exactly the time the other can be drawing frames in. They share one thread, so
the drawing still takes the drawing's time; what goes is one wait sitting
behind the other. The first real failure aborts the pair.

The library is still read for two things: the **persona**'s three clips, and
an **End** off the shelf. (And Bottom B's folder, for a BOOM filed by hand.)

## The modes

The other questions say what the video *is*. The mode says how it talks.
Serious and Middle each change one line — the hook — and nothing else. Degen
changes the hook and two more things.

Every hook is written in `api/vids/hook`, by Claude Opus 5, on its own call
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
is doing (off the persona's context), the trade — and the route draws which
two. A build with no persona context has no activity to name, so it is always
analogy + trade.

> making a surgeon's salary from the hot tub
> shorting drake mid haircut
> how to make a lawyer's salary shorting kanye

**One hook in five is a twist**, whatever the mode, one of three at even odds:
a **mystery** — the trade on someone described but never named — **hype** —
the name and how high it is going — or **me if** — the trade somewhere it
would be out of line, "was legal". Hype only goes up, so a down trade's twist
is a mystery or a me if. Degen's hype and me if say the nickname; everything
else about the three is the same in every mode. A mystery that names them, or
a me if that breaks its frame, is written again.

> shorting the greatest musician of our generation
> going long on the most unhinged billionaire
> messi to the stratosphere
> swifty to outer space (Degen)
> me if shorting drake at a funeral was legal
> me if going long on swifty at church was legal (Degen)

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
> down bad guy goes long on swifty (i love you swifty)

Every part but the nickname comes off a fixed list, so the route draws those
itself and asks Claude for the nickname alone — a funny shorthand when one
lands, the plain name when not — plus its one-word short form. The descriptor
is one of chopped kid, homeless man, tweaker, down bad guy, dude, kid. The
bracket is one of nine self-owns followed by 💯 🔥 😎 or 🥀; or, a third of the
time when the nickname has a short form of eight letters or fewer,
"(i love you <short>)" with no emoji. The step-by-step lines still teach
someone how Pauv works and the closing word is the same fixed comment line,
because that is what the video is for.

**Three BOOMs lay themselves** (`degenBooms` in `lib/vids2/vids2Build.ts`), on
the beats somebody watching would react on:

| When | Sound | Picture |
| --- | --- | --- |
| ChatGPT gets to the name (Bottom A, the `choosing` beat) | fahh (2.2s) | the BOOM |
| Their page opens, the click after the search (Bottom B, `analyzing`) | oh hell nah (7.4s) | **none** |
| Place trade goes in (Bottom B, `confirming`) | fahh (2.2s) | the BOOM |

The middle one is the noise and nothing else. It runs 7.4 seconds — nearly four
times `BOOM_LENGTH` — and it is a reaction *to* what is on the screen, so
covering that screen with a BOOM for two seconds of it would cover the joke.
That is `BoomInsert.picture: false`: the item is still on the timeline, because
that is what carries the bang and what the bar marks, and both renderers simply
never draw it. Its mark on the bar is half height so it reads as a noise rather
than a hit.

Every bang plays its own full length wherever it lands — the preview drives it
from its own `<audio>` and the export lays it with `scheduleOnce`, neither of
which is bounded by `BOOM_LENGTH` — and two that run into each other both play.
The only thing that ever cuts one short is the end of the video.

Each moment is a second into its *own* recording, straight off that renderer's
beats, and the tuning page puts it on the timeline through the slot's plan item
— where the slot starts, where it was trimmed from, how fast it plays. Once
they are down they are ordinary BOOMs: the bar marks them, pressing a mark
takes that one off, Insert adds a fourth. They are laid once per build, held by
the build's number, so taking all three off does not bring them back.

The sounds come out of `public/audio/booms` and are matched on the file name
(`/fa+h+/i`, `/hell.?nah|oh.?hell/i`), not named outright — so a better take
dropped in under a near-enough name is picked up, and a folder tidy-up does not
break a build. A sound that is not there leaves its BOOM silent rather than not
laid at all.

## It is NOT a third copy

Simpler is a deliberate fork of Vids — its own components, its own build logic,
nothing shared, everything hand-synced. **Vids 2 is not that.** It shares
Simpler's logic outright:

| What | Where | Whose |
| --- | --- | --- |
| The plan, compose, audio, captions, edit, recipe, local clips | `lib/simpler/*` | **shared with Simpler** |
| The captions rail, the post caption, the persona chooser | `components/simpler/*` | **shared with Simpler** |
| The ChatGPT recording | `components/chatgpt/chatgpt-video.ts` | shared with everybody |
| The Pauv trade recording | `components/trade/trade-video.ts` | shared with everybody |
| The form, the tuning page, the section | `components/vids2/*` | Vids 2's own |
| The five answers, degen mode, the roster, the trade-as-a-Bottom-B | `lib/vids2/vids2Build.ts` | Vids 2's own |
| The hook for each mode | `api/vids/hook` | Vids 2's own |

**So a change to how Simpler builds a video is a change to how Vids 2 builds
one** — the opposite of the Vids/Simpler rule, and chosen deliberately: a third
hand-synced copy of nine thousand lines would have to be kept in step with two
others forever. What is forked is only what actually differs — the pages.

`Vids2Builder.tsx` *is* a fork of `components/simpler/VidsBuilder.tsx`, because
it diverges on purpose: no Persona card, no Bottom card, no Reset, a summary of
the form's answers in their place, and the captions written when a build lands
rather than when a bottom is chosen. Fixes to the parts they still share — the
stage, the transport, the export — have to be made in both by hand.

## What Vids 2 added to the shared files

Two things, both optional, both defaulting to how it has always been — so
nothing Simpler or Vids does moved.

- **`LocalClipMeta.theme`** (`lib/simpler/vidsLocal.ts`). A Bottom B carries
  which way Pauv was, because that is what the frame puts either side of the
  recording (`vidsPlan` `itemBacking`), and Vids 2 is the only caller that
  renders one.
- **`SlotPick.centred`** (`lib/simpler/vidsPlan.ts`, through `PlanItem`,
  `RecipePick` and the recipes spec). The house nudges every Bottom B
  `BOTTOM_B_LEFT` (5%) to the left, because one filmed off a screen wants it.
  Vids 2's is the page itself, drawn square on to fill the frame, so it sits
  dead centre. Left unset everywhere else, which is the nudge.

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

- **Light / dark is the Pauv page only.** The ChatGPT renderer has no light
  mode; that recording is dark whatever the form says.
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
