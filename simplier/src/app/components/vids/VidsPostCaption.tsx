'use client';

// The post caption — the long-form caption that goes under the video on
// Instagram: three paragraphs and about 1900 characters, about the person
// being traded, the position (up or down) and the case for it, and it always
// brings crypto in (api/vids/post-caption). Who and which way are read off the
// screen recordings' context, compiled by the builder into one brief.
//
// It drafts itself once a vid is on the stage, and again whenever the clips
// change (the words were about whoever was there), so by the time the file has
// rendered the caption is waiting to be copied. Nothing here is edited: the
// card shows its opening lines so you can see it arrived and that it is about
// the right person, and Copy takes the whole thing.
//
// The build's code goes on the end of it, on a line of its own, from the
// moment an export is started rather than when the file lands — the build is
// written down as the render begins, and the caption is what someone is
// copying while the frames go. It is the same code that ends the file name, so
// the post carries it too. An export that fails or is cancelled takes its code
// back off.

import { useCallback, useEffect, useRef, useState } from 'react';
import { writePostCaption, type TradePosition } from '@/lib/vids-client';
import { SpinnerIcon } from '@/lib/icons';

/** How long the stage is given to settle before the caption is drafted. A
 *  Bottom A brings its linked Bottom B a beat behind it, so this is one call
 *  for the lot rather than one per slot. */
const AUTO_DELAY_MS = 2000;
const COPIED_MS = 1500;

interface CaptionState {
  /** The brief it was (or is being) written from. A caption is only ever shown
   *  against its own brief, so changing the clips takes it out of view without
   *  anything having to clear it — and a brief with no caption against it yet
   *  is what gets one drafted. */
  brief: string;
  /** Who and which way, as the route read them off the brief. Shown as a line
   *  under the words so a caption about the wrong person is obvious. */
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
 *  for something code-shaped. */
const swapCode = (c: CaptionState, next: string | null): CaptionState => {
  const suffix = c.code ? `\n\n${c.code}` : '';
  const bare = suffix && c.text.endsWith(suffix) ? c.text.slice(0, -suffix.length) : c.text;
  return { ...c, text: withCode(bare, next), code: next };
};

const blank = (brief: string): CaptionState =>
  ({ brief, person: '', position: 'up', text: '', code: null, loading: false, error: null, copied: false });

interface Props {
  /** What the screen recordings and the ending show, compiled by the builder
   *  — where the person and the position are read from. Empty until a vid is
   *  on the stage. */
  brief: string;
  /** The code the last export minted, or null before one has run. It goes on
   *  the end of the caption. */
  code: string | null;
}

export function VidsPostCaption({ brief, code }: Props) {
  const [caption, setCaption] = useState<CaptionState | null>(null);
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

  // An export writes the build down as it starts, long after the caption was
  // written, so the code goes on the end of the one already on show. An export
  // clears the code before it mints the next, so this runs twice — once taking
  // the old line off, once putting the new one on.
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

  /** Write the caption for `forBrief`, reading who and which way off the
   *  recordings. Whatever was on show goes down while it runs — it was about
   *  someone else. */
  const generate = useCallback(async (forBrief: string) => {
    const seq = ++seqRef.current;
    setCaption({ ...blank(forBrief), loading: true });
    try {
      const d = await writePostCaption({ brief: forBrief });
      if (seq !== seqRef.current) return;
      // Words written for the build the code was minted for carry it; ones
      // written for other clips do not.
      const forCode = codeBrief.current === forBrief ? codeRef.current : null;
      setCaption({
        brief: forBrief, person: d.person, position: d.position, text: withCode(d.caption, forCode),
        code: forCode, loading: false, error: null, copied: false,
      });
    } catch (e) {
      if (seq !== seqRef.current) return;
      setCaption((prev) => ({
        ...(prev?.brief === forBrief ? prev : blank(forBrief)),
        loading: false,
        error: e instanceof Error ? e.message : String(e),
        copied: false,
      }));
    }
  }, []);

  // Drafts itself: a brief nothing has been written against yet — a vid put
  // on, a clip swapped — gets its caption after a moment's settling. Once
  // each: a call that failed leaves its error against the brief and is not
  // made again, which is what Try again is for. An empty brief has nothing to
  // say and is left alone.
  useEffect(() => {
    if (!brief || caption?.brief === brief) return;
    const t = window.setTimeout(() => void generate(brief), AUTO_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [brief, caption?.brief, generate]);

  const cur = caption && caption.brief === brief ? caption : null;

  const copy = async () => {
    if (!cur?.text) return;
    try {
      await navigator.clipboard.writeText(cur.text);
      flashCopied();
    } catch { /* no clipboard here */ }
  };

  return (
    <div className="border-b border-zinc-800 px-3 py-3">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Post caption</p>
        {cur?.loading && <SpinnerIcon size={10} className="animate-spin text-zinc-500" />}
        <span className="flex-1" />
        <button
          onClick={() => void copy()}
          disabled={!cur?.text}
          title={cur?.text
            ? 'Copy the whole caption to the clipboard'
            : 'It writes itself once a vid is on the stage'}
          className="rounded bg-white px-2.5 py-1 text-[11px] font-medium text-black hover:bg-zinc-200 disabled:opacity-40"
        >
          {cur?.copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {cur?.error ? (
        <div className="flex items-baseline gap-2">
          <p className="min-w-0 flex-1 break-words text-[10px] text-red-400">{cur.error}</p>
          <button
            onClick={() => void generate(brief)}
            className="shrink-0 text-[10px] text-zinc-500 hover:text-white"
          >
            Try again
          </button>
        </div>
      ) : cur?.text ? (
        <>
          {/* The opening lines only: enough to see it arrived and that it is
              about the right person. Copy takes all of it. */}
          <p className="line-clamp-3 whitespace-pre-line text-[10px] leading-relaxed text-zinc-400">{cur.text}</p>
          <p className="mt-1 truncate text-[9px] text-zinc-600">
            {cur.person ? `${cur.person} · ${cur.position}` : cur.position} — three paragraphs, copied whole
          </p>
        </>
      ) : (
        brief && (
          <p className="text-[10px] leading-relaxed text-zinc-600">
            {cur?.loading ? 'Reading who is being traded, then writing the caption…' : 'Writing in a moment.'}
          </p>
        )
      )}
    </div>
  );
}
