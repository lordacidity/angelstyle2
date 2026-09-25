'use client';

// Vids2HookGuide — the ? beside Start in the tuning page's captions. The whole
// of how the hook is written, every mode, on a page over everything: what is
// drawn and at what odds, what the model writes, what gets a line thrown out,
// and how it sits on the frame.
//
// Every list and every percentage is read off lib/vids2/hookRules — the same
// lists and odds api/vids/hook draws with — so the page can't say one thing
// while the route does another. What it says in words (the rules the model is
// held to, the checks) is the route's, restated: change one there, change it
// here.

import { useEffect, type ReactNode } from 'react';
import {
  DEGEN_EMOJI, DEGEN_EXAMPLES, DEGEN_VERBS, DESCRIPTORS, HOOK_ATTEMPTS, HYPE_NAMED, HYPE_NICKNAMED, LOVE_MAX,
  LOVE_ODDS, ME_IF_NAMED, ME_IF_NICKNAMED, MIDDLE_ACTIVITY_ODDS, MIDDLE_ANALOGIES, MIDDLE_EXAMPLES,
  MIDDLE_MYSTERY_VERBS, MIDDLE_SECONDS, MIDDLE_SHAPE_ODDS, MIDDLE_SHAPES, MIDDLE_TASKS, MYSTERY_EXAMPLES,
  NICKNAME_EXAMPLES, NO_CONTEXT_TWISTS, SELF_OWNS, SERIOUS_EXAMPLES, TWIST_ODDS, TWISTS, VERBS,
  type HookDirection, type HookMode, type MiddleShape, type Twist,
} from '@/lib/vids2/hookRules';

/** A share as the page prints it: 40%, 6.7%, 33.3%. */
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const even = (xs: readonly unknown[]) => 1 / xs.length;

/** How often a hook is its mode's own line rather than a twist. */
const OWN = 1 - TWIST_ODDS;
/** Me if is written off what the video shows, so without a context it is not
 *  drawn and the twists that are left split its share. */
const twistsFor = (d: HookDirection, hasContext: boolean) => (hasContext ? TWISTS : NO_CONTEXT_TWISTS)[d];
const twistShare = (d: HookDirection, t: Twist, hasContext: boolean) => {
  const xs = twistsFor(d, hasContext);
  return xs.includes(t) ? TWIST_ODDS / xs.length : 0;
};

const DIRECTIONS: readonly HookDirection[] = ['up', 'down'];
const DIRECTION_LABEL: Record<HookDirection, string> = { up: '📈 Up', down: '📉 Down' };
const MODE_LABEL: Record<HookMode, string> = { serious: '👔 Serious', middle: '😐 Middle', degen: '💀 Degen' };
const TWIST_LABEL: Record<Twist, string> = { mystery: 'Mystery', hype: 'Hype', meIf: 'Me if' };
/** Each Middle shape, the way the frame would say it. */
const MIDDLE_SHAPE_LINE: Record<MiddleShape, string> = {
  while: 'making <analogy> while <what he is doing | the mystery>',
  'seconds + parenthetical': 'making <analogy> in <seconds> seconds <parenthetical>',
  'time + parenthetical': 'making <analogy> in the time it takes to <task> <parenthetical>',
  seconds: 'making <analogy> in <seconds> seconds',
  time: 'making <analogy> in the time it takes to <task>',
};
/** How often a Middle hook draws a number of seconds, and how often a task. */
const secondsShare = MIDDLE_SHAPE_ODDS.seconds + MIDDLE_SHAPE_ODDS['seconds + parenthetical'];
const timeShare = MIDDLE_SHAPE_ODDS.time + MIDDLE_SHAPE_ODDS['time + parenthetical'];
/** How often a Middle hook says what he is doing, and how often the mystery. */
const activityShare = MIDDLE_SHAPE_ODDS.while * MIDDLE_ACTIVITY_ODDS;
const mysteryShare = MIDDLE_SHAPE_ODDS.while * (1 - MIDDLE_ACTIVITY_ODDS);

interface Props {
  /** The video on the page — marked wherever the guide talks about it. */
  mode: HookMode;
  direction: HookDirection;
  /** Whether the persona has a context for Middle to say what he is doing
   *  from, and a parenthetical to put on the end. */
  hasContext: boolean;
  onClose: () => void;
}

/** A share, in the one colour the page uses for numbers. */
function Pct({ of, dim = false }: { of: number; dim?: boolean }) {
  return <span className={`font-mono ${dim ? 'text-zinc-500' : 'text-emerald-300'}`}>{pct(of)}</span>;
}

/** The words a line is made of, the way the frame would say them. */
function Q({ children }: { children: ReactNode }) {
  return <span className="rounded bg-zinc-800/80 px-1 py-px font-mono text-[11px] text-zinc-100">{children}</span>;
}

function Here() {
  return <span className="ml-2 rounded-full bg-white px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-black">this video</span>;
}

function Block({ title, here = false, children }: { title: string; here?: boolean; children: ReactNode }) {
  return (
    <section className={`rounded-lg border p-5 ${here ? 'border-zinc-400' : 'border-zinc-800'}`}>
      <h2 className="mb-3 text-[15px] font-semibold text-zinc-100">{title}{here && <Here />}</h2>
      <div className="space-y-3 text-[12px] leading-relaxed text-zinc-300">{children}</div>
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{children}</p>;
}

/** One fixed list, drawn at even odds: each entry, its share of the lines
 *  that draw it, and — when `of` is given — its share of every hook in the
 *  mode, twists included. */
function Draw({ items, of }: { items: readonly string[]; of?: number }) {
  return (
    <ul className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
      {items.map((it) => (
        <li key={it} className="flex items-baseline gap-2">
          <Q>{it}</Q>
          <span className="flex-1" />
          <Pct of={even(items)} />
          {of != null && <span className="w-12 text-right"><Pct of={even(items) * of} dim /></span>}
        </li>
      ))}
    </ul>
  );
}

/** The trading verbs one way and the other, as Draws side by side. */
function Verbs({ verbs, of, direction }: { verbs: Record<HookDirection, readonly string[]>; of?: number; direction: HookDirection }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {DIRECTIONS.map((d) => (
        <div key={d}>
          <p className="mb-1 text-[11px] text-zinc-400">
            {DIRECTION_LABEL[d]}
            {d === direction && <span className="ml-1.5 text-[9px] text-zinc-500">(this video)</span>}
          </p>
          <Draw items={verbs[d]} of={of} />
        </div>
      ))}
    </div>
  );
}

function Examples({ lines, max = 6 }: { lines: readonly string[]; max?: number }) {
  return (
    <ul className="space-y-0.5 border-l-2 border-zinc-800 pl-3 text-[12px] italic text-zinc-400">
      {lines.slice(0, max).map((l) => <li key={l}>{l}</li>)}
    </ul>
  );
}

function Rules({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-0.5 pl-5 text-zinc-400">{children}</ul>;
}

export function Vids2HookGuide({ mode, direction, hasContext, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="vids-scroll fixed inset-0 z-50 overflow-y-auto bg-zinc-950 text-white">
      <div className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[15px] font-semibold text-zinc-100">How the Start caption is written</h1>
            <p className="text-[11px] text-zinc-500">
              Every mode, every draw. This video: {MODE_LABEL[mode]} · {DIRECTION_LABEL[direction]}
            </p>
          </div>
          <button
            onClick={onClose}
            title="Back to the video (Esc)"
            className="shrink-0 rounded-md border border-zinc-700 px-3 py-1.5 text-[12px] text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
          >
            Close
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-5 px-6 py-8">
        <Block title="Who writes it">
          <p>
            One line per video, written by <b className="text-zinc-100">Claude Sonnet 5</b> (low effort) on its own call
            (<span className="font-mono text-[11px]">api/vids/hook</span>), beside the one that writes the rest of the
            captions. It is handed the <b className="text-zinc-100">mode</b>, <b className="text-zinc-100">who</b>{' '}
            — with who they are, their industry and bio off the Pauv roster, so it takes their world from that
            rather than guessing one — <b className="text-zinc-100">which way</b>, and, for Middle only, the
            persona&rsquo;s context: what he is doing, and what it says in parentheses. Nothing off the screen
            recordings.
          </p>
          <p>
            Every choice between fixed options is <b className="text-zinc-100">drawn by the code at random</b>, not
            left to the model: twist or not, the trading verb, Middle&rsquo;s shape and its analogy, seconds and
            task, and all of Degen but the nickname.
            So every percentage on this page is an exact odd, not a tendency. The model writes only the words in
            between — the name, the reason, what he is doing, the mystery, the nickname — and three Middle shapes
            in five never call it at all.
          </p>
          <p className="text-[11px] text-zinc-500">
            Green is the share of the lines that draw it. Where there is a grey one beside it, that is the share of
            every hook in that mode, twists included.
          </p>
        </Block>

        <Block title="Step 1 · its mode's own line, or a twist (Serious and Degen)">
          <p>
            Middle skips this step: it never takes a twist, and its mystery is one of the two things its while shape
            can hold, below{mode === 'middle' && <span className="text-zinc-200"> — as on this video</span>}.
          </p>
          <p>
            In Serious and Degen, {pct(TWIST_ODDS)} of hooks are a twist instead of the mode&rsquo;s own line, the twist
            drawn at even odds from those the trade can take. Hype only goes up, so a down trade&rsquo;s twist is a
            mystery or a me if. Me if is written off what the video shows, so a persona with no context leaves the
            other twists to split its share — the numbers below are for{' '}
            <b className="text-zinc-200">{hasContext ? 'a persona with a context, as on this video' : 'a persona with no context, as on this video'}</b>.
          </p>
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="py-1 font-semibold" />
                {DIRECTIONS.map((d) => (
                  <th key={d} className={`py-1 text-right font-semibold ${d === direction ? 'text-zinc-200' : ''}`}>
                    {DIRECTION_LABEL[d]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              <tr>
                <td className="py-1.5">The mode&rsquo;s own line</td>
                {DIRECTIONS.map((d) => <td key={d} className="py-1.5 text-right"><Pct of={OWN} /></td>)}
              </tr>
              {(['mystery', 'hype', 'meIf'] as const).map((t) => (
                <tr key={t}>
                  <td className="py-1.5">Twist · {TWIST_LABEL[t]}</td>
                  {DIRECTIONS.map((d) => (
                    <td key={d} className="py-1.5 text-right">
                      {twistShare(d, t, hasContext)
                        ? <Pct of={twistShare(d, t, hasContext)} />
                        : <span className="text-zinc-600">never</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Block>

        <Block title={`${MODE_LABEL.serious} · flat, in a fixed order`} here={mode === 'serious'}>
          <p>
            <Q>&lt;trading verb&gt; &lt;person&gt; &lt;catalyst, optional&gt; &lt;money outcome&gt;</Q>
          </p>
          <Label>Drawn · the trading verb, always the first words</Label>
          <Verbs verbs={VERBS} of={OWN} direction={direction} />
          <Label>Written by the model</Label>
          <Rules>
            <li><b className="text-zinc-200">Person</b> — their full, normal name, the one everyone calls them. No nicknames.</li>
            <li>
              <b className="text-zinc-200">Catalyst</b> — optional, the model&rsquo;s call: a real moment in their world
              that gives the trade a reason (before the album drops, through the playoffs, ahead of midterms). Left
              out when it isn&rsquo;t sure what their world is. No fixed odds.
            </li>
            <li><b className="text-zinc-200">Money outcome</b> — the end of the line, what the money does (to cover rent, to retire early).</li>
          </Rules>
          <Label>Held to</Label>
          <Rules>
            <li>Never the word &ldquo;man&rdquo; (unless it is in their name), and nothing about the guy on camera.</li>
            <li>No emoji, hashtags, quote marks or full stop. All lower case. Said like a plan, not a joke.</li>
          </Rules>
          <Label>Examples it is shown ({SERIOUS_EXAMPLES.length})</Label>
          <Examples lines={SERIOUS_EXAMPLES} />
        </Block>

        <Block title={`${MODE_LABEL.middle} · the money, against what he is doing or the clock`} here={mode === 'middle'}>
          <p>
            Every line opens <Q>making &lt;analogy&gt;</Q> and then takes one of five shapes. No twist step: the
            mystery is one of the two things the first shape can hold. The analogy, the seconds and the task are all
            off a list, and the parenthetical is the persona&rsquo;s own words, so only the while shape ever calls
            the model.
          </p>
          <Label>Drawn · the shape</Label>
          <ul className="space-y-0.5">
            {MIDDLE_SHAPES.map((sh) => (
              <li key={sh} className="flex items-baseline gap-2">
                <Q>{MIDDLE_SHAPE_LINE[sh]}</Q>
                <span className="flex-1" />
                <Pct of={MIDDLE_SHAPE_ODDS[sh]} />
              </li>
            ))}
          </ul>
          <Label>The while shape · what he is doing, or the mystery</Label>
          <Rules>
            <li>
              <b className="text-zinc-200">What he is doing</b> <Pct of={MIDDLE_ACTIVITY_ODDS} /> of while lines,{' '}
              <Pct of={activityShare} dim /> of every Middle hook — the persona&rsquo;s context with its parentheses
              taken out, said by the model so it reads straight after &ldquo;while&rdquo;: wearing a knight helmet,
              on the toilet, holding a hammer in my mouth. Never made up.
            </li>
            <li>
              <b className="text-zinc-200">The mystery</b> <Pct of={1 - MIDDLE_ACTIVITY_ODDS} /> of while lines,{' '}
              <Pct of={mysteryShare} dim /> of every Middle hook — the trade on someone described but never named,
              written to the mystery guide below, on a verb fixed by which way: up <Q>{MIDDLE_MYSTERY_VERBS.up}</Q>,
              down <Q>{MIDDLE_MYSTERY_VERBS.down}</Q>.
            </li>
            <li>
              A persona with no context has nothing he is doing, so its while shape is always the mystery
              {!hasContext && <span className="text-zinc-200"> — as on this video</span>}.
            </li>
          </Rules>
          <Label>Drawn · the money analogy, at even odds</Label>
          <Draw items={MIDDLE_ANALOGIES} />
          <p className="text-[10px] text-zinc-500">
            Less the one that names the person the video trades on: a Drake build never makes drake&rsquo;s salary.
          </p>
          <Label>Drawn · the seconds</Label>
          <Draw items={MIDDLE_SECONDS} of={secondsShare} />
          <Label>Drawn · the task</Label>
          <Draw items={MIDDLE_TASKS} of={timeShare} />
          <Label>The parenthetical</Label>
          <p>
            What the persona&rsquo;s context says in parentheses, word for word and without the brackets, on the end
            of the line: <Q>wearing a knight helmet (in a fresh fit)</Q> gives{' '}
            <Q>making drake&rsquo;s salary in 67 seconds in a fresh fit</Q>. A context with several has one drawn at
            even odds. One with none leaves the line at its time, so for that persona the two parenthetical shapes
            read like the two plain ones{!hasContext && <span className="text-zinc-200"> — as on this video</span>}.
          </p>
          <Label>Held to</Label>
          <Rules>
            <li>
              What he is doing: never &ldquo;man&rdquo; (unless it is in their name), no trading verb, no name, no
              time or number. Empty, or breaking one of those, and the line is thrown out.
            </li>
            <li>The mystery: thrown out when any word of their name is in it, or it doesn&rsquo;t open on the verb.</li>
            <li>No emoji, hashtags, quote marks or full stop. All lower case. The parenthetical is never touched.</li>
          </Rules>
          <Label>Examples it is shown ({MIDDLE_EXAMPLES.length})</Label>
          <Examples lines={MIDDLE_EXAMPLES} />
        </Block>

        <Block title={`${MODE_LABEL.degen} · a self-own with a nickname`} here={mode === 'degen'}>
          <p>
            <Q>&lt;descriptor&gt; &lt;verb&gt; &lt;nickname&gt; (&lt;bracket&gt;) &lt;emoji&gt;</Q> — every part but the
            nickname off a fixed list, so the line is put together by the code and the model is asked for the
            nickname alone.
          </p>
          <Examples lines={DEGEN_EXAMPLES} />
          <Label>Drawn · the descriptor</Label>
          <Draw items={DESCRIPTORS} of={OWN} />
          <Label>Drawn · the verb</Label>
          <Verbs verbs={DEGEN_VERBS} of={OWN} direction={direction} />
          <Label>Drawn · the bracket</Label>
          <Rules>
            <li>
              When the nickname has a one-word short form of {LOVE_MAX} letters or fewer:{' '}
              <Q>(i love you &lt;short&gt;)</Q> <Pct of={LOVE_ODDS} />, with no emoji after it — otherwise a self-own{' '}
              <Pct of={1 - LOVE_ODDS} />.
            </li>
            <li>When it has none: a self-own <Pct of={1} />.</li>
          </Rules>
          <p className="text-[11px] text-zinc-400">A self-own is one of these at even odds:</p>
          <Draw items={SELF_OWNS} />
          <p className="text-[11px] text-zinc-400">and after it one of these, at even odds:</p>
          <div className="flex flex-wrap gap-4">
            {DEGEN_EMOJI.map((e) => (
              <span key={e} className="flex items-baseline gap-1.5"><span className="text-[16px]">{e}</span><Pct of={even(DEGEN_EMOJI)} /></span>
            ))}
          </div>
          <Label>Written by the model</Label>
          <Rules>
            <li>
              <b className="text-zinc-200">Nickname</b> — a funny shorthand a group chat would call them, when one
              lands; their plain name when nothing does. Lower case, three words at most.
            </li>
            <li>
              <b className="text-zinc-200">Short form</b> — the one word you would say it with in &ldquo;i love you
              ___&rdquo; (swifty, sabby for sabby c). Empty when no single word says it — and then there is no
              &ldquo;i love you&rdquo;.
            </li>
            <li>A nickname that comes back as nothing is their plain name.</li>
          </Rules>
          <Label>Nicknames it is shown ({NICKNAME_EXAMPLES.length})</Label>
          <Examples lines={NICKNAME_EXAMPLES} max={NICKNAME_EXAMPLES.length} />
          <p className="text-[11px] text-zinc-500">
            Degen changes two other things that aren&rsquo;t the hook: three BOOMs lay themselves, and the random song
            can be one marked degen on the Music page.
          </p>
        </Block>

        <Block title={`The twists · ${pct(TWIST_ODDS)} of every Serious and Degen hook`}>
          <p>
            The same in both — Serious&rsquo;s trading verbs, even in Degen — except that Degen&rsquo;s hype and me
            if say the nickname instead of the name. Middle never takes a twist, but its while shape writes the
            mystery to this same guide, on a fixed verb (up {MIDDLE_MYSTERY_VERBS.up}, down{' '}
            {MIDDLE_MYSTERY_VERBS.down}), after &ldquo;making &lt;analogy&gt; while&rdquo;.
          </p>

          <div className="space-y-2 rounded-md border border-zinc-800 p-3">
            <p className="text-[13px] font-semibold text-zinc-100">
              Mystery <span className="ml-1 text-[11px] font-normal text-zinc-500">
                up <Pct of={twistShare('up', 'mystery', hasContext)} /> · down <Pct of={twistShare('down', 'mystery', hasContext)} /> of all hooks
              </span>
            </p>
            <p><Q>&lt;trading verb&gt; &lt;who they are, never by name&gt;</Q> — the trade on someone the viewer has to recognise; the video shows who.</p>
            <Label>Drawn · the verb</Label>
            <Verbs verbs={VERBS} direction={direction} />
            <Label>Thrown out when</Label>
            <Rules><li>any word of their name three letters or longer is in it (&ldquo;the&rdquo; and the like don&rsquo;t count), or it doesn&rsquo;t open on the verb.</li></Rules>
            <Examples lines={MYSTERY_EXAMPLES} />
          </div>

          <div className="space-y-2 rounded-md border border-zinc-800 p-3">
            <p className="text-[13px] font-semibold text-zinc-100">
              Hype <span className="ml-1 text-[11px] font-normal text-zinc-500">
                up <Pct of={twistShare('up', 'hype', hasContext)} /> of all hooks · never down
              </span>
            </p>
            <p><Q>&lt;name&gt; &lt;where they are headed&gt;</Q> — no trading verb, no money. Up as high as it goes; a stretched word when it lands (skyyyyy).</p>
            <Label>Thrown out when</Label>
            <Rules><li>it opens on a trade.</li></Rules>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><p className="mb-1 text-[11px] text-zinc-400">Serious</p><Examples lines={HYPE_NAMED} /></div>
              <div><p className="mb-1 text-[11px] text-zinc-400">Degen</p><Examples lines={HYPE_NICKNAMED} /></div>
            </div>
          </div>

          <div className="space-y-2 rounded-md border border-zinc-800 p-3">
            <p className="text-[13px] font-semibold text-zinc-100">
              Me if <span className="ml-1 text-[11px] font-normal text-zinc-500">
                up <Pct of={twistShare('up', 'meIf', hasContext)} /> · down <Pct of={twistShare('down', 'meIf', hasContext)} /> of all hooks
              </span>
            </p>
            <p><Q>me if &lt;trading verb&gt; &lt;name&gt; &lt;what he is in the middle of&gt; was legal</Q></p>
            <p className="text-[11px] text-zinc-500">
              The one twist written off the video: where it catches him is the persona&rsquo;s context, the same place
              Middle&rsquo;s activity comes from, and is never made up. A build with no context has nothing to catch
              him at, so me if isn&rsquo;t drawn at all{!hasContext && <span className="text-zinc-400"> — as on this video</span>}.
            </p>
            <Label>Drawn · the verb</Label>
            <Verbs verbs={VERBS} direction={direction} />
            <Label>Written by the model</Label>
            <Rules>
              <li><b className="text-zinc-200">What he is in the middle of</b> — what the video shows him doing, said so it reads straight after the name: in the hot tub, mid haircut, half asleep, on the treadmill. Never a place or a moment the video doesn&rsquo;t show.</li>
            </Rules>
            <Label>Thrown out when</Label>
            <Rules><li>it doesn&rsquo;t open &ldquo;me if&rdquo;, end &ldquo;was legal&rdquo;, and have the trade straight after &ldquo;me if&rdquo;.</li></Rules>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><p className="mb-1 text-[11px] text-zinc-400">Serious</p><Examples lines={ME_IF_NAMED} /></div>
              <div><p className="mb-1 text-[11px] text-zinc-400">Degen</p><Examples lines={ME_IF_NICKNAMED} /></div>
            </div>
          </div>
        </Block>

        <Block title="What is fixed, and what is thrown out">
          <Rules>
            <li>Every reply: the first line only, lower-cased, with any emoji, hashtags, quote marks, full stop or &ldquo;caption:&rdquo; label taken off.</li>
            <li>A trade said on the wrong verb has it swapped for the one that was drawn, rather than thrown out.</li>
            <li>Serious: a line with no trade, or with &ldquo;man&rdquo; in it, is thrown out. Middle: what he is doing with a trading verb, their name, a time or &ldquo;man&rdquo; in it.</li>
            <li>A mystery that names them, a hype that opens on a trade, or a me if out of its frame is thrown out.</li>
            <li>
              {HOOK_ATTEMPTS} goes, each drawn afresh from Step 1 — twist, shape and all. When both fail, the Captions box
              says why, and Rewrite has another go.
            </li>
            <li>A hook typed by hand is yours: Rewrite writes everything else again and leaves it alone. Empty the box to hand it back.</li>
          </Rules>
        </Block>

        <Block title="On the frame">
          <Rules>
            <li>Across the top of the Start clip, clear of the face in the middle.</li>
            <li>
              <b className="text-zinc-200">Always two lines</b>, broken between the two words that make the lines
              closest in width. The type is shrunk, Start only, until the wider line fits across; it never grows
              past the caption look and the Size slider.
            </li>
            <li>A one-word hook has nowhere to break and stays one line. One so long that fitting it on two would make the type too small to read wraps like any other caption instead.</li>
          </Rules>
        </Block>
      </div>
    </div>
  );
}
