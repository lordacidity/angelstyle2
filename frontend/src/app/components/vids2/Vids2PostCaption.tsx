'use client';

// Vids 2's post captions: one for Instagram, one for TikTok, each a Copy
// button and nothing to read here (api/vids/post-captions). Both are written
// from the person's news this week, for who and which way the form said —
// nothing is read off the screen recordings, so nothing waits for them.
//
// Which is why Generate asks for them the moment it is pressed (Vids2Section),
// and the whole render is theirs to land in: the tuning page takes that draft
// rather than asking again, so they are usually ready when the build lands —
// "Consider holding" included, which is worth knowing before the export rather
// than after it. One pair per build: nobody picks clips one at a time here, and
// each draft is a news search and a model call. A draft that failed has a Try
// again, and exporting tries it again too. Every ask is for a fresh pair, so a
// second video on the same person the same day doesn't go out under the first
// one's words.
//
// Under the buttons, one line: who and which way it was written for, or why to
// hold the post when the news says trading on them now would read badly.
//
// The build's code goes on the end of both, on a line of its own, as it does
// on Simpler's one caption: the same code that ends the file name, taken back
// off if the export fails or is cancelled.

import { useCallback, useEffect, useRef, useState } from 'react';
import { writePostCaptions, type PostCaptionsDraft, type TradePosition } from '@/lib/vids-client';
import { personKey } from '@/lib/simpler/vidsBottom';
import type { Vids2Early } from '@/lib/vids2/vids2Words';
import { SpinnerIcon } from '@/lib/icons';

const COPIED_MS = 1500;

type Which = 'ig' | 'tiktok';

interface CaptionState {
  /** The build they were (or are being) written for. They are only ever
   *  offered against their own build, so a new Generate takes them out of
   *  reach without anything having to clear them. */
  build: number;
  person: string;
  position: TradePosition;
  ig: string;
  tiktok: string;
  hold: string | null;
  /** The build code currently on the end of both, or null. Kept beside them so
   *  it comes off again by the exact string it went on as. */
  code: string | null;
  loading: boolean;
  error: string | null;
  copied: Which | null;
}

/** The code as it reads under a post: a line of its own after a blank one. */
const withCode = (text: string, code: string | null): string => (code ? `${text}\n\n${code}` : text);

const withoutCode = (text: string, code: string | null): string => {
  const suffix = code ? `\n\n${code}` : '';
  return suffix && text.endsWith(suffix) ? text.slice(0, -suffix.length) : text;
};

/** Both captions carrying `next` as their code instead of the current one. */
const swapCode = (c: CaptionState, next: string | null): CaptionState => ({
  ...c,
  ig: withCode(withoutCode(c.ig, c.code), next),
  tiktok: withCode(withoutCode(c.tiktok, c.code), next),
  code: next,
});

const blank = (build: number): CaptionState => ({
  build, person: '', position: 'up', ig: '', tiktok: '', hold: null, code: null,
  loading: false, error: null, copied: null,
});

interface Props {
  /** The build on the stage — Generate's number for it (Vids2Build.id). */
  buildId: number;
  /** Who it trades on, as Pauv spells them, and which way. */
  person: string;
  position: TradePosition;
  /** The draft Generate asked for the moment it was pressed, and who and which
   *  way it asked for. Taken in place of asking when they are this build's. */
  early: Vids2Early['post'];
  /** The code the last export minted, or null before one has run. */
  code: string | null;
  /** An export is running. Its start tries again a draft that failed. */
  exporting: boolean;
}

export function Vids2PostCaption({ buildId, person, position, early, code, exporting }: Props) {
  const [caption, setCaption] = useState<CaptionState | null>(null);
  const captionRef = useRef(caption);
  captionRef.current = caption;
  const buildRef = useRef(buildId);
  buildRef.current = buildId;
  const askRef = useRef({ person, position });
  askRef.current = { person, position };
  const codeRef = useRef(code);
  codeRef.current = code;
  /** Which build the code was minted for: a code only goes on captions written
   *  for the build it was exported from. */
  const codeBuild = useRef<number | null>(null);
  // The request that counts, so an answer for an earlier build can't land over
  // the later one's.
  const seqRef = useRef(0);
  const copiedTimer = useRef<number | null>(null);

  // A draft still being written picks the code up when it lands; one already
  // written takes it on now.
  useEffect(() => {
    codeBuild.current = code ? buildRef.current : null;
    setCaption((c) => (c && c.build === buildRef.current && !c.loading ? swapCode(c, code) : c));
  }, [code]);

  /** The build the latest draft was asked for — set as it is asked, so asking
   *  twice for the same build (an effect run twice) is caught before either
   *  answer is back. */
  const askedFor = useRef<number | null>(null);
  /** Generate's draft, once it has been taken: it is taken once. */
  const tookEarly = useRef<Vids2Early['post']>(null);

  /** Write both for `forBuild` — or, with `asked`, wait on a draft already
   *  asked for it. */
  const generate = useCallback(async (forBuild: number, asked?: Promise<PostCaptionsDraft>) => {
    const seq = ++seqRef.current;
    askedFor.current = forBuild;
    setCaption({ ...blank(forBuild), loading: true });
    try {
      const d = await (asked ?? writePostCaptions({ ...askRef.current, fresh: true }));
      if (seq !== seqRef.current) return;
      const forCode = codeBuild.current === forBuild ? codeRef.current : null;
      setCaption({
        build: forBuild, person: d.person, position: d.position,
        ig: withCode(d.ig, forCode), tiktok: withCode(d.tiktok, forCode), hold: d.hold,
        code: forCode, loading: false, error: null, copied: null,
      });
    } catch (e) {
      if (seq !== seqRef.current) return;
      setCaption({ ...blank(forBuild), error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  // Drafted once per build, the moment it lands: Generate's own draft when it
  // was asked for this person and this way, otherwise asked for here. Generate
  // asks with the form's spelling of them, so a build Pauv spells differently
  // asks again.
  useEffect(() => {
    const own = early && personKey(early.person) === personKey(person) && early.position === position
      ? early
      : null;
    if (own && tookEarly.current !== own) {
      tookEarly.current = own;
      void generate(buildId, own.draft);
      return;
    }
    if (askedFor.current === buildId) return;
    void generate(buildId);
  }, [buildId, person, position, early, generate]);

  // Starting an export is asking for them too: a draft that failed is tried
  // again. One already written (or being written) for this build is kept.
  const wasExporting = useRef(false);
  useEffect(() => {
    const started = exporting && !wasExporting.current;
    wasExporting.current = exporting;
    if (!started) return;
    const forBuild = buildRef.current;
    const c = captionRef.current;
    if (c?.build === forBuild && !c.error) return;
    void generate(forBuild);
  }, [exporting, generate]);

  const flashCopied = useCallback((which: Which) => {
    setCaption((c) => (c ? { ...c, copied: which } : c));
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(
      () => setCaption((c) => (c ? { ...c, copied: null } : c)),
      COPIED_MS,
    );
  }, []);
  useEffect(() => () => { if (copiedTimer.current) window.clearTimeout(copiedTimer.current); }, []);

  const cur = caption && caption.build === buildId ? caption : null;
  const ready = !!cur && !cur.loading && !cur.error && !!cur.ig;

  const copy = async (which: Which) => {
    if (!ready || !cur) return;
    try {
      await navigator.clipboard.writeText(cur[which]);
      flashCopied(which);
    } catch { /* no clipboard here */ }
  };

  const button = (which: Which, label: string) => (
    <button
      onClick={() => void copy(which)}
      disabled={!ready}
      title={ready ? `Copy the whole ${label} caption` : 'Still being written'}
      className="h-9 flex-1 rounded-lg bg-white text-[13px] font-semibold text-black transition-colors hover:bg-zinc-200 disabled:opacity-40"
    >
      {cur?.copied === which ? 'Copied' : `Copy for ${label}`}
    </button>
  );

  return (
    <div className="border-b border-zinc-800 px-3 py-3">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Post caption</p>
        {cur?.loading && <SpinnerIcon size={10} className="animate-spin text-zinc-500" />}
      </div>

      <div className="flex gap-2">
        {button('ig', 'IG')}
        {button('tiktok', 'TikTok')}
      </div>

      {cur?.error ? (
        <div className="mt-1.5 flex items-baseline gap-2">
          <p className="min-w-0 flex-1 break-words text-xs text-red-400">{cur.error}</p>
          <button
            onClick={() => void generate(buildId)}
            className="shrink-0 text-xs text-zinc-500 hover:text-white"
          >
            Try again
          </button>
        </div>
      ) : cur?.loading ? (
        <p className="mt-2 text-xs text-zinc-500">Reading this week&apos;s news, then writing…</p>
      ) : ready && cur ? (
        <>
          <p className="mt-2 truncate text-xs text-zinc-500">{cur.person} · {cur.position === 'up' ? '📈 Up' : '📉 Down'}</p>
          {cur.hold && (
            <p className="mt-1 break-words text-xs leading-relaxed text-amber-400">Consider holding: {cur.hold}</p>
          )}
        </>
      ) : null}
    </div>
  );
}
