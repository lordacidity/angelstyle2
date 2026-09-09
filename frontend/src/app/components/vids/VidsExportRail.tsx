'use client';

// The export column — the far right of the build page's three rails, past the
// captions. Everything about a finished build that leaves this page is here:
//
//   Post caption   the long-form caption that goes under the video on
//                  Instagram: the copy-paste kind Media's Post caption card
//                  writes, three paragraphs and about 1900 characters. Here
//                  it is about the person being traded — not the persona —
//                  the position, UP or DOWN, and the case for it, and it
//                  always brings crypto in (api/vids/post-caption). Who and
//                  which way are read off the screen recordings' context,
//                  compiled by the builder into one brief, and both are shown
//                  on the card to correct or flip. It drafts itself once a vid
//                  is on the stage, and again whenever the clips change (the
//                  words were about whoever was there), so by the time the
//                  file has rendered the caption is waiting to be copied.
//                  Auto-copy is Media's setting, shared.
//
//                  The build's code goes on the end of it, on a line of its
//                  own, from the moment an export is started rather than when
//                  the file lands — the build is written down as the render
//                  begins, and the caption is what someone is copying while
//                  the frames go. It is the same code that ends the file name,
//                  so the post carries it too and a video found in the wild
//                  can be brought back to the stage from what is under it. An
//                  export that fails or is cancelled takes its code back off.
//   Phonedeck      the phones and what is in Incoming, given the whole height
//                  between the caption and the buttons rather than a few rows:
//                  it is where a push finishes.
//   Export         Push to Phonedeck and Download MP4, pinned to the foot.
//                  Built by the builder, which owns everything they report
//                  on, and handed over as `exportPanel`.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { VidsPhonedeck } from './VidsPhonedeck';
import { writePostCaption, type TradePosition } from '@/lib/vids-client';
import { SpinnerIcon } from '@/lib/icons';

/** Media's Auto-copy setting, shared with it and the carousel. */
const AUTO_COPY_KEY = 'studio.autoCopyCaption';
/** How long the stage is given to settle before the caption is drafted. A
 *  Bottom A brings its linked Bottom B a beat behind it and a roll lands slot
 *  by slot — one call for the lot, not one per slot. */
const AUTO_DELAY_MS = 2000;
const COPIED_MS = 1500;

const POSITIONS: readonly TradePosition[] = ['up', 'down'];
const POSITION_LABEL: Record<TradePosition, string> = { up: 'Up', down: 'Down' };
const POSITION_ON: Record<TradePosition, string> = { up: 'bg-emerald-300 text-black', down: 'bg-rose-300 text-black' };

interface CaptionState {
  /** The brief it was (or is being) written from. A caption is only ever shown
   *  against its own brief, so changing the clips takes it out of view without
   *  anything having to clear it — and a brief with no caption against it yet
   *  is what gets one drafted. */
  brief: string;
  /** Who and which way — read off the brief, or typed / flipped on the card. */
  person: string;
  position: TradePosition;
  text: string;
  /** The build code currently sitting on the end of `text`, or null while no
   *  export has minted one. Kept beside the words so the line can be taken off
   *  again by the exact string it was put on as. */
  code: string | null;
  loading: boolean;
  error: string | null;
  copied: boolean;
}

/** The code as it reads under a post: a line of its own after a blank one, the
 *  last thing in the caption the way it is the last thing in the file name. */
const withCode = (text: string, code: string | null): string => (code ? `${text}\n\n${code}` : text);

/** The caption carrying `next` as its code instead of whatever it carries now.
 *  The old line comes off by the exact string it went on as — never by hunting
 *  for something code-shaped, because the caption is edited by hand and a guess
 *  at what a code looks like would eventually eat somebody's words. */
const swapCode = (c: CaptionState, next: string | null): CaptionState => {
  const suffix = c.code ? `\n\n${c.code}` : '';
  const bare = suffix && c.text.endsWith(suffix) ? c.text.slice(0, -suffix.length) : c.text;
  return { ...c, text: withCode(bare, next), code: next };
};

/** Who and which way, when the card already knows — what a rewrite sends
 *  instead of having the recordings read again. */
type Fields = Pick<CaptionState, 'person' | 'position'>;

const blank = (brief: string): CaptionState =>
  ({ brief, person: '', position: 'up', text: '', code: null, loading: false, error: null, copied: false });

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-zinc-800 px-3 py-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{title}</p>
      {children}
    </div>
  );
}

const TOGGLE_ON = 'border-sky-500 bg-sky-500/20 text-sky-200';
const TOGGLE_OFF = 'border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300';
const PRIMARY = 'flex items-center gap-1.5 rounded bg-white px-2.5 py-1 text-[11px] font-medium text-black hover:bg-zinc-200 disabled:opacity-40';

interface Props {
  /** What the screen recordings and the ending show, compiled by the builder
   *  — where the person and the position are read from. Empty until a vid is
   *  on the stage. */
  brief: string;
  /** The file the last export put in Incoming — lit at the top of the list. */
  recent: string | null;
  /** The code the last export minted, or null before one has run. It goes on
   *  the end of the caption. */
  code: string | null;
  /** The export controls, built by the builder. */
  exportPanel: ReactNode;
}

export function VidsExportRail({ brief, recent, code, exportPanel }: Props) {
  const [caption, setCaption] = useState<CaptionState | null>(null);
  const [autoCopy, setAutoCopy] = useState(false);
  const autoCopyRef = useRef(autoCopy);
  autoCopyRef.current = autoCopy;
  const briefRef = useRef(brief);
  briefRef.current = brief;
  const codeRef = useRef(code);
  codeRef.current = code;
  /** What the build looked like when the code was minted. A code describes the
   *  build that was exported, so once the clips change it stops being this
   *  video's code and does not go on the caption drafted for the new ones. */
  const codeBrief = useRef<string | null>(null);
  // The request that counts. The clips can change while one is out, and the
  // answer to the earlier brief must not land over the later one's.
  const seqRef = useRef(0);
  const copiedTimer = useRef<number | null>(null);

  // Read after mount: the server has no localStorage, and the first paint has
  // to match what it rendered.
  useEffect(() => {
    try {
      setAutoCopy(window.localStorage.getItem(AUTO_COPY_KEY) === 'true');
    } catch { /* not remembered */ }
  }, []);
  const toggleAutoCopy = () => {
    const next = !autoCopy;
    setAutoCopy(next);
    try { window.localStorage.setItem(AUTO_COPY_KEY, String(next)); } catch { /* not remembered */ }
  };

  // An export writes the build down as it starts, long after the caption was
  // written, so the code goes on the end of the one already on show rather
  // than the caption waiting for it. An export clears the code before it mints
  // the next, so this runs twice — once taking the old line off, once putting
  // the new one on — and a cancelled one clears it again on the way out.
  useEffect(() => {
    codeBrief.current = code ? briefRef.current : null;
    setCaption((c) => (c && c.brief === briefRef.current ? swapCode(c, code) : c));
  }, [code]);

  const flashCopied = useCallback(() => {
    setCaption((c) => (c ? { ...c, copied: true } : c));
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(
      () => setCaption((c) => (c ? { ...c, copied: false } : c)),
      COPIED_MS,
    );
  }, []);
  useEffect(() => () => { if (copiedTimer.current) window.clearTimeout(copiedTimer.current); }, []);

  /** Write the caption for `forBrief`. With `fields` — a name and a position
   *  already on the card — those are sent and the recordings are not read
   *  again; without, the route reads who and which way off the brief.
   *  `fresh` takes the words on show down while it runs (the draft after the
   *  clips changed, when they were about someone else); Regenerate keeps them
   *  up until the new ones arrive, as Media's card does. */
  const generate = useCallback(async (forBrief: string, fields: Fields | null, fresh: boolean) => {
    const seq = ++seqRef.current;
    setCaption((prev) => {
      const same = prev?.brief === forBrief ? prev : null;
      return {
        brief: forBrief,
        person: fields?.person ?? same?.person ?? '',
        position: fields?.position ?? same?.position ?? 'up',
        text: !fresh && same ? same.text : '',
        code: !fresh && same ? same.code : null,
        loading: true,
        error: null,
        copied: false,
      };
    });
    try {
      const d = await writePostCaption(fields ? { person: fields.person, position: fields.position } : { brief: forBrief });
      if (seq !== seqRef.current) return;
      // Words written for the build the code was minted for — a Regenerate
      // after the export — carry it; ones written for other clips do not.
      const forCode = codeBrief.current === forBrief ? codeRef.current : null;
      const text = withCode(d.caption, forCode);
      setCaption({
        brief: forBrief, person: d.person, position: d.position, text, code: forCode,
        loading: false, error: null, copied: false,
      });
      if (autoCopyRef.current) {
        try {
          await navigator.clipboard.writeText(text);
          if (seq === seqRef.current) flashCopied();
        } catch { /* clipboard blocked — the Copy button still works */ }
      }
    } catch (e) {
      if (seq !== seqRef.current) return;
      setCaption((prev) => ({
        ...(prev?.brief === forBrief ? prev : blank(forBrief)),
        loading: false,
        error: e instanceof Error ? e.message : String(e),
        copied: false,
      }));
    }
  }, [flashCopied]);

  // Drafts itself: a brief nothing has been written against yet — a vid put
  // on, a clip swapped, a roll — gets its caption after a moment's settling.
  // Once each: a call that failed leaves its error against the brief and is
  // not made again (Regenerate is there for a second go), and a name typed in
  // before it fired counts as taking over. An empty brief has nothing to say
  // and is left alone.
  useEffect(() => {
    if (!brief || caption?.brief === brief) return;
    const t = window.setTimeout(() => void generate(brief, null, true), AUTO_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [brief, caption?.brief, generate]);

  const cur = caption && caption.brief === brief ? caption : null;
  /** What a rewrite sends: the name on the card and its position, when there
   *  is a name; otherwise the recordings are read again. */
  const fields = (): Fields | null => (cur?.person.trim()
    ? { person: cur.person.trim(), position: cur.position }
    : null);
  const rewrite = () => { if (brief && !cur?.loading) void generate(brief, fields(), false); };

  const setPerson = (person: string) =>
    setCaption((prev) => ({ ...(prev?.brief === brief ? prev : blank(brief)), person }));
  /** Flipping the position is a decision, so it rewrites straight away; a
   *  name is typed, so it waits for Enter. */
  const setPosition = (position: TradePosition) => {
    setCaption((prev) => ({ ...(prev?.brief === brief ? prev : blank(brief)), position }));
    const person = cur?.person.trim();
    if (person) void generate(brief, { person, position }, false);
  };
  const onPersonKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    rewrite();
  };

  const copy = async () => {
    if (!cur?.text) return;
    try {
      await navigator.clipboard.writeText(cur.text);
      flashCopied();
    } catch { /* no clipboard here */ }
  };

  return (
    <aside className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-l border-zinc-800">
      <Section title="Post caption">
        <div className="flex items-center gap-1.5">
          {cur?.text ? (
            <>
              <button onClick={() => void copy()} title="Copy the caption to the clipboard" className={PRIMARY}>
                {cur.copied ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={rewrite}
                disabled={cur.loading}
                title="Write it again for the same person and position"
                className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-white disabled:hover:text-zinc-500"
              >
                {cur.loading && <SpinnerIcon size={10} className="animate-spin" />}
                {cur.loading ? 'Writing…' : 'Regenerate'}
              </button>
            </>
          ) : (
            <button
              onClick={rewrite}
              disabled={!brief || !!cur?.loading}
              title={brief
                ? 'Draft the long-form caption: who is being traded, the case for up or down, and crypto'
                : 'Choose a vid first — the caption is about the person traded on in it'}
              className={PRIMARY}
            >
              {cur?.loading && <SpinnerIcon size={11} className="animate-spin" />}
              {cur?.loading ? 'Writing…' : 'Generate'}
            </button>
          )}
          <span className="flex-1" />
          <button
            onClick={toggleAutoCopy}
            title={autoCopy
              ? 'Auto-copy is ON — the caption goes to the clipboard the moment it is written'
              : 'Auto-copy is OFF — turn on to have each caption copied the moment it is written'}
            className={`flex shrink-0 items-center gap-1 rounded border px-1.5 py-1 text-[10px] leading-none transition-colors ${autoCopy ? TOGGLE_ON : TOGGLE_OFF}`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${autoCopy ? 'bg-sky-300' : 'bg-zinc-600'}`} />
            Auto-copy
          </button>
        </div>

        {/* Who and which way — read off the recordings, here to correct or
            flip. The whole of what the caption is written from. */}
        <div className="mt-1.5 flex items-center gap-1">
          <span className="w-10 shrink-0 text-[10px] text-zinc-500">Trading</span>
          <input
            value={cur?.person ?? ''}
            onChange={(e) => setPerson(e.target.value)}
            onKeyDown={onPersonKey}
            disabled={!brief}
            maxLength={120}
            placeholder={brief ? 'who is being traded' : 'choose a vid first'}
            title="The person the video trades on, read off the screen recordings' context. Correct it and press Enter to rewrite."
            className="min-w-0 flex-1 rounded border border-zinc-800 bg-black px-1.5 py-1 text-[10px] text-zinc-100 outline-none placeholder:text-zinc-700 focus:border-zinc-500 disabled:opacity-50"
          />
          <span className="flex shrink-0 overflow-hidden rounded border border-zinc-700" title="Up: the case that they are getting bigger. Down: the case that they should come down. Flipping it rewrites.">
            {POSITIONS.map((p) => (
              <button
                key={p}
                onClick={() => setPosition(p)}
                disabled={!brief}
                className={`px-1.5 py-0.5 text-[9px] disabled:opacity-50 ${
                  cur?.position === p ? POSITION_ON[p] : 'text-zinc-400 hover:text-white'
                }`}
              >
                {POSITION_LABEL[p]}
              </button>
            ))}
          </span>
        </div>
        <p className="mt-0.5 text-[9px] text-zinc-600">
          Read off the screen recordings. Enter rewrites for another name; Up / Down rewrites straight away.
        </p>

        <div className="mt-2">
          {cur?.error ? (
            <p className="break-words text-[10px] text-red-400">{cur.error}</p>
          ) : cur?.text ? (
            <>
              <textarea
                value={cur.text}
                onChange={(e) => setCaption((c) => (c ? { ...c, text: e.target.value, copied: false } : c))}
                rows={12}
                title="Edit by hand — Copy takes what is here"
                className="w-full resize-y rounded border border-zinc-800 bg-black px-1.5 py-1 text-[10px] leading-relaxed text-zinc-200 outline-none focus:border-zinc-500"
              />
              {cur.code && (
                <p className="mt-0.5 text-[9px] leading-relaxed text-zinc-600">
                  Ends on <span className="font-mono tracking-widest text-emerald-300">{cur.code}</span>, this
                  export&rsquo;s code — the same one in the file name. Delete the line if a post shouldn&rsquo;t carry it.
                </p>
              )}
            </>
          ) : (
            <p className="text-[10px] leading-relaxed text-zinc-600">
              {!brief
                ? 'Put a vid on the stage and it drafts itself, from what the screen recordings show: who he trades on, and which way.'
                : cur?.loading
                  ? 'Reading who is being traded, then writing the caption…'
                  : 'Drafting in a moment — or press Generate.'}
            </p>
          )}
        </div>
      </Section>

      {/* The Phonedeck list has the run of the rail between the caption and
          the buttons: it is the one thing here that gets longer with use. */}
      <div className="flex min-h-0 flex-1 flex-col px-3 py-3">
        <VidsPhonedeck grow recent={recent} />
      </div>

      {/* mt-auto puts it at the foot of a short rail; sticky keeps it there
          once the caption and the list run past the bottom of the screen. The
          background is the page's own, because the rail doesn't paint one and
          a transparent sticky footer would have the list scroll through it. */}
      <div className="sticky bottom-0 mt-auto border-t border-zinc-800 bg-[var(--background)] px-3 py-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Export</p>
        {exportPanel}
      </div>
    </aside>
  );
}
