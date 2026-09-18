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
  CLOCK_BRANCH_ODDS, CLOCK_BRANCHES, CLOCK_EXAMPLES, CLOCK_NUMBERS, CLOCK_TASKS, COMBOS, DEGEN_EMOJI,
  DEGEN_EXAMPLES, DEGEN_VERBS, DESCRIPTORS, HOOK_ATTEMPTS, HYPE_NAMED, HYPE_NICKNAMED, LOVE_MAX, LOVE_ODDS,
  ME_IF_NAMED, ME_IF_NICKNAMED, MIDDLE_EXAMPLES, MYSTERY_EXAMPLES, NICKNAME_EXAMPLES, NO_CONTEXT_CLOCK_BRANCH,
  NO_CONTEXT_COMBOS, SELF_OWNS, SERIOUS_EXAMPLES, TWIST_ODDS, TWISTS, VERBS,
  type ClockBranch, type HookDirection, type HookMode, type Twist,
} from '@/lib/vids2/hookRules';

/** A share as the page prints it: 40%, 6.7%, 33.3%. */
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const even = (xs: readonly unknown[]) => 1 / xs.length;

/** How often a hook is its mode's own line rather than a twist. */
const OWN = 1 - TWIST_ODDS;
const twistShare = (d: HookDirection, t: Twist) => (TWISTS[d].includes(t) ? TWIST_ODDS / TWISTS[d].length : 0);

const DIRECTIONS: readonly HookDirection[] = ['up', 'down'];
const DIRECTION_LABEL: Record<HookDirection, string> = { up: '📈 Up', down: '📉 Down' };
const MODE_LABEL: Record<HookMode, string> = { serious: '👔 Serious', middle: '😐 Middle', degen: '💀 Degen' };
const TWIST_LABEL: Record<Twist, string> = { mystery: 'Mystery', hype: 'Hype', meIf: 'Me if' };
const CLOCK_BRANCH_LABEL: Record<ClockBranch, string> = {
  pool: 'task · off the pool', context: 'task · what he is doing', number: 'number + while',
};

/** How often a Middle hook is the clock, twists included: one combo of the
 *  four with a context, one of the two without. */
const clockWith = OWN / COMBOS.length;
const clockWithout = OWN / NO_CONTEXT_COMBOS.length;

interface Props {
  /** The video on the page — marked wherever the guide talks about it. */
  mode: HookMode;
  direction: HookDirection;
  /** Whether the persona has a context for Middle's activity to come from. */
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
            captions. It is handed four things and nothing else: the <b className="text-zinc-100">mode</b>,{' '}
            <b className="text-zinc-100">who</b>, <b className="text-zinc-100">which way</b>, and — for Middle only —
            what the persona is doing (the persona&rsquo;s context). Nothing off the screen recordings.
          </p>
          <p>
            Every choice between fixed options is <b className="text-zinc-100">drawn by the code at random</b>, not
            left to the model: twist or not, the trading verb, Middle&rsquo;s combo and its clock&rsquo;s branch, task
            and time, and all of Degen but the nickname.
            So every percentage on this page is an exact odd, not a tendency. The model writes only the words in
            between — the name, the reason, the money, the nickname.
          </p>
          <p className="text-[11px] text-zinc-500">
            Green is the share of the lines that draw it. Where there is a grey one beside it, that is the share of
            every hook in that mode, twists included.
          </p>
        </Block>

        <Block title="Step 1 · its mode's own line, or a twist">
          <p>
            Whatever the mode, {pct(TWIST_ODDS)} of hooks are a twist instead of the mode&rsquo;s own line, the twist
            drawn at even odds from those the trade can take. Hype only goes up, so a down trade&rsquo;s twist is a
            mystery or a me if.
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
                      {twistShare(d, t) ? <Pct of={twistShare(d, t)} /> : <span className="text-zinc-600">never</span>}
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

        <Block title={`${MODE_LABEL.middle} · two of three parts, or the clock`} here={mode === 'middle'}>
          <p>
            Exactly two of <Q>money analogy</Q> <Q>what he is doing</Q> <Q>the trade</Q>. The funnier the gap
            between the money and the activity, the better. Or the fourth combo, the clock: the money against how
            little time it took — its own section, below.
          </p>
          <Label>Drawn · which combo</Label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-[11px] text-zinc-400">
                Persona has a context
                {hasContext && <span className="ml-1.5 text-[9px] text-zinc-500">(this video)</span>}
              </p>
              <Draw items={COMBOS} of={OWN} />
            </div>
            <div>
              <p className="mb-1 text-[11px] text-zinc-400">
                Persona has no context
                {!hasContext && <span className="ml-1.5 text-[9px] text-zinc-500">(this video)</span>}
              </p>
              <Draw items={NO_CONTEXT_COMBOS} of={OWN} />
              <p className="mt-1 text-[10px] text-zinc-500">Nothing to say he is doing, so never an activity.</p>
            </div>
          </div>
          <Label>Drawn · the trading verb, only when the combo has the trade</Label>
          <Verbs verbs={VERBS} direction={direction} />
          <p className="text-[10px] text-zinc-500">
            With a context, {COMBOS.filter((c) => c.includes('trade')).length} combos in {COMBOS.length} carry the
            trade; without one, {NO_CONTEXT_COMBOS.filter((c) => c.includes('trade')).length} in{' '}
            {NO_CONTEXT_COMBOS.length}.
          </p>
          <Label>Written by the model</Label>
          <Rules>
            <li><b className="text-zinc-200">Money analogy</b> — the payout next to something relatable: a surgeon&rsquo;s salary, a year of rent, lebron money. Usually &ldquo;making&rdquo; or &ldquo;out-earning&rdquo;.</li>
            <li><b className="text-zinc-200">Activity</b> — taken from the persona&rsquo;s context and said casually (mid haircut, in the hot tub). Never made up.</li>
            <li><b className="text-zinc-200">&ldquo;how to&rdquo;</b> — it may open on it (&ldquo;how to make&rdquo;), best with analogy + trade. Its call; no fixed odds.</li>
          </Rules>
          <Label>Held to</Label>
          <Rules>
            <li>Never the word &ldquo;man&rdquo; (unless it is in their name).</li>
            <li>No emoji, hashtags, quote marks or full stop. All lower case.</li>
          </Rules>
          <Label>Examples it is shown ({MIDDLE_EXAMPLES.length})</Label>
          <Examples lines={MIDDLE_EXAMPLES} />
        </Block>

        <Block title="⏱ Middle · the clock combo" here={mode === 'middle'}>
          <p>
            Middle&rsquo;s fourth combo: the money analogy, and time where the trade or the activity would have gone.
            No trading verb, no name, no person — just the payout against how little time it took. The code puts
            the line together from the model&rsquo;s parts, the way Degen&rsquo;s is, so it always opens right and
            always carries exactly one time. Never inside a twist; Serious and Degen don&rsquo;t take it.
          </p>
          <div className="flex flex-col items-start gap-1">
            <Q>making &lt;analogy&gt; in the time it takes to &lt;task&gt;</Q>
            <Q>making &lt;analogy&gt; in &lt;number&gt; while &lt;what he is doing&gt;</Q>
          </div>
          <Label>How often</Label>
          <Rules>
            <li>
              Persona has a context: <Pct of={1 / COMBOS.length} /> of Middle&rsquo;s own lines, <Pct of={clockWith} dim /> of
              every Middle hook.
            </li>
            <li>
              No context: <Pct of={1 / NO_CONTEXT_COMBOS.length} /> of Middle&rsquo;s own lines, <Pct of={clockWithout} dim /> of
              every Middle hook — only on the pool.
            </li>
          </Rules>
          <Label>Drawn · which branch</Label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-[11px] text-zinc-400">
                Persona has a context
                {hasContext && <span className="ml-1.5 text-[9px] text-zinc-500">(this video)</span>}
              </p>
              <ul className="space-y-0.5">
                {CLOCK_BRANCHES.map((b) => (
                  <li key={b} className="flex items-baseline gap-2">
                    <Q>{CLOCK_BRANCH_LABEL[b]}</Q>
                    <span className="flex-1" />
                    <Pct of={CLOCK_BRANCH_ODDS[b]} />
                    <span className="w-12 text-right"><Pct of={CLOCK_BRANCH_ODDS[b] * clockWith} dim /></span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1 text-[11px] text-zinc-400">
                Persona has no context
                {!hasContext && <span className="ml-1.5 text-[9px] text-zinc-500">(this video)</span>}
              </p>
              <ul className="space-y-0.5">
                <li className="flex items-baseline gap-2">
                  <Q>{CLOCK_BRANCH_LABEL[NO_CONTEXT_CLOCK_BRANCH]}</Q>
                  <span className="flex-1" />
                  <Pct of={1} />
                  <span className="w-12 text-right"><Pct of={clockWithout} dim /></span>
                </li>
              </ul>
              <p className="mt-1 text-[10px] text-zinc-500">Nothing to say he is doing, so never an activity and never a number.</p>
            </div>
          </div>

          <Label>Branch 1 · the task</Label>
          <p>
            No &ldquo;while&rdquo; — the task is already the whole picture. Off the pool, at even odds:
          </p>
          <Draw items={CLOCK_TASKS} />
          <p>
            Or off the persona&rsquo;s context: what he is doing on camera, said as a task with a clear start and end,
            in his own words — put a hammer in my mouth, tape my mouth shut, crack open a beer. Wearing or being in
            something he could put on becomes putting it on (a suit of armor). Never made up, and never a place or a
            state he is just in: sit in a chair, lie in the road, be in a grocery store are not tasks.{' '}
            <b className="text-zinc-200">A context with no task in it takes one off the pool instead</b>, so a
            persona that is only somewhere always lands on the pool.
          </p>

          <Label>Branch 2 · the number</Label>
          <Draw items={CLOCK_NUMBERS} of={CLOCK_BRANCH_ODDS.number * clockWith} />
          <p>
            What he is doing comes off the context, said casually so it reads straight after &ldquo;while&rdquo;:
            in the hot tub, half asleep, eating cereal, getting a haircut.
          </p>

          <Label>Written by the model</Label>
          <Rules>
            <li><b className="text-zinc-200">Opener</b> — &ldquo;making&rdquo; most of the time, or &ldquo;out-earning&rdquo;, and then the analogy is who gets out-earned (my landlord).</li>
            <li>
              <b className="text-zinc-200">Money analogy</b> — small and everyday beats big: a week of groceries, a month
              of gas, a year of netflix, rent, a bartender&rsquo;s night. A salary-sized one now and then, never the default.
            </li>
            <li><b className="text-zinc-200">The task</b> — on branch 1&rsquo;s context half only.</li>
            <li><b className="text-zinc-200">What he is doing</b> — on branch 2 only.</li>
          </Rules>
          <Label>Held to</Label>
          <Rules>
            <li>Never the word &ldquo;man&rdquo; (unless it is in their name).</li>
            <li>No trading verb, no &ldquo;how to&rdquo;, no name outside the analogy itself (lebron money).</li>
            <li>No emoji, hashtags, quote marks or full stop. All lower case.</li>
          </Rules>
          <Label>Thrown out when</Label>
          <Rules>
            <li>there is a trading verb in it, or &ldquo;man&rdquo;</li>
            <li>the task has a &ldquo;while&rdquo; in it, or the task or what he is doing brings a time of its own</li>
            <li>branch 2 comes back with nothing for what he is doing</li>
          </Rules>
          <p className="text-[11px] text-zinc-500">
            A line that opens on anything but making or out-earning, a branch 2 with no &ldquo;while&rdquo;, or a number
            and a task together can&rsquo;t happen: the code puts the line together.
          </p>
          <Label>Examples it is shown ({CLOCK_BRANCHES.reduce((n, b) => n + CLOCK_EXAMPLES[b].length, 0)})</Label>
          <div className="grid grid-cols-1 gap-3">
            {CLOCK_BRANCHES.map((b) => (
              <div key={b}>
                <p className="mb-1 text-[11px] text-zinc-400">{CLOCK_BRANCH_LABEL[b]}</p>
                <Examples lines={CLOCK_EXAMPLES[b]} max={CLOCK_EXAMPLES[b].length} />
              </div>
            ))}
          </div>
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

        <Block title={`The twists · ${pct(TWIST_ODDS)} of every hook`}>
          <p>
            The same in every mode — Serious and Middle&rsquo;s trading verbs included, even in Degen — except that
            Degen&rsquo;s hype and me if say the nickname instead of the name.
          </p>

          <div className="space-y-2 rounded-md border border-zinc-800 p-3">
            <p className="text-[13px] font-semibold text-zinc-100">
              Mystery <span className="ml-1 text-[11px] font-normal text-zinc-500">
                up <Pct of={twistShare('up', 'mystery')} /> · down <Pct of={twistShare('down', 'mystery')} /> of all hooks
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
                up <Pct of={twistShare('up', 'hype')} /> of all hooks · never down
              </span>
            </p>
            <p><Q>&lt;name&gt; &lt;where they are headed&gt;</Q> — no trading verb, no money. Up as high as it goes; a stretched word when it lands (skyyyyy).</p>
            <Label>Thrown out when</Label>
            <Rules><li>it opens on a trade.</li></Rules>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><p className="mb-1 text-[11px] text-zinc-400">Serious, Middle</p><Examples lines={HYPE_NAMED} /></div>
              <div><p className="mb-1 text-[11px] text-zinc-400">Degen</p><Examples lines={HYPE_NICKNAMED} /></div>
            </div>
          </div>

          <div className="space-y-2 rounded-md border border-zinc-800 p-3">
            <p className="text-[13px] font-semibold text-zinc-100">
              Me if <span className="ml-1 text-[11px] font-normal text-zinc-500">
                up <Pct of={twistShare('up', 'meIf')} /> · down <Pct of={twistShare('down', 'meIf')} /> of all hooks
              </span>
            </p>
            <p><Q>me if &lt;trading verb&gt; &lt;name&gt; &lt;somewhere it would be out of line&gt; was legal</Q></p>
            <Label>Drawn · the verb</Label>
            <Verbs verbs={VERBS} direction={direction} />
            <Label>Thrown out when</Label>
            <Rules><li>it doesn&rsquo;t open &ldquo;me if&rdquo;, end &ldquo;was legal&rdquo;, and have the trade straight after &ldquo;me if&rdquo;.</li></Rules>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><p className="mb-1 text-[11px] text-zinc-400">Serious, Middle</p><Examples lines={ME_IF_NAMED} /></div>
              <div><p className="mb-1 text-[11px] text-zinc-400">Degen</p><Examples lines={ME_IF_NICKNAMED} /></div>
            </div>
          </div>
        </Block>

        <Block title="What is fixed, and what is thrown out">
          <Rules>
            <li>Every reply: the first line only, lower-cased, with any emoji, hashtags, quote marks, full stop or &ldquo;caption:&rdquo; label taken off.</li>
            <li>A trade said on the wrong verb has it swapped for the one that was drawn, rather than thrown out.</li>
            <li>Serious and Middle: a line with no trade where one was asked for, or with &ldquo;man&rdquo; in it, is thrown out.</li>
            <li>A mystery that names them, a hype that opens on a trade, or a me if out of its frame is thrown out.</li>
            <li>
              {HOOK_ATTEMPTS} goes, each drawn afresh from Step 1 — twist and all. When both fail, the Captions box
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
