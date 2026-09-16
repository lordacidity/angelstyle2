'use client';

// ChatGPT lookalike (Studio > ChatGPT).
//
// Two stages. The setup card takes a name, a direction (up / down), the
// question and a video format. Start asks the model once, renders the
// 8-second "screen recording" of the chat right here in the browser (see
// chatgpt-video.ts: the typing, the loading, the pointer clicking the name and
// zooming in, all drawn frame by frame) and downloads it. "Open the chat"
// plays the same thing live instead, from the same answer. The chat is a
// pixel-faithful copy of the logged-out chatgpt.com
// dark theme: the "Where should we begin?" landing, the composer pill, the user
// bubble, the pulsing dot then the shimmering "Searching the web" status, and
// the answer streaming in as bold numbered names with a few sentences each.
//
// Whatever gets typed, /api/ai/chatgpt (Gemini Flash Lite) answers with the
// chosen name as #1, argued in the chosen direction, plus four more names. The
// loading state is held for at least ~1.5s no matter how fast the model returns.
// The model itself takes a couple of seconds, so for the pre-written question
// the answer is asked for the moment it starts typing itself out: by the time
// it sends, the answer is usually back and the loading runs just its ~1.5s.
//
// The question is written ahead of time on the setup card, spelled right: in
// the live chat the first click in the search bar types it out at a human
// pace and sends it. Enter mid-typing completes and sends.
//
// Ways back to the setup card: click the ChatGPT wordmark top-left, the rail's
// sidebar toggle, or press Esc. Start opens a fresh chat each time.
//
// The chat sits on a stage of adjustable width (1180px by default), centred on
// dark grey so it reads as a narrower browser window; the pill at the
// bottom-left sets it. The stage also zooms on its own, never the rest of
// Studio: Ctrl+scroll and Ctrl +/− scale it around whatever text is highlighted
// (else the pointer / the middle), keeping that point pinned on screen so the
// zoom reads as a camera push-in. Clicking a pick's name highlights just the
// name, so the next zoom lands on it. The pill's ↺ (or Ctrl 0) resets the zoom.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import s from './ChatGpt.module.css';
import { askChatGpt, buildBlocks, replyToText, totalLen, type Block, type Direction, type Reply, type Run } from './reply';
import { CLIP_SECONDS, FILE_H, FILE_W, renderChatVideo } from './chatgpt-video';

type AssistantStatus = 'loading' | 'streaming' | 'done' | 'error';
interface UserMsg { id: string; role: 'user'; text: string }
interface AssistantMsg {
  id: string;
  role: 'assistant';
  reply: Reply | null;
  status: AssistantStatus;
  shown: number;   // characters revealed so far while streaming
  error?: string;
}
type Msg = UserMsg | AssistantMsg;

const SETUP_KEY = 'studio-chatgpt-setup-v1';
// The loading state is held for this long (plus a little jitter so it never
// looks metronomic) before the answer starts streaming, however fast the model
// actually came back. If the model takes longer, loading simply continues.
const MIN_LOADING_MS = 1500;
const LOADING_JITTER_MS = 150;
// chatgpt.com shows a pulsing dot the instant a message is sent, then swaps to
// the shimmering status line.
const DOT_MS = 700;
// Reveal speed of the answer once it streams (a five-pick answer lands in ~2s).
const CHARS_PER_SEC = 560;
// The pre-written question types itself out at a human pace, then sends after
// a beat.
const TYPE_BASE_MS = 45;
const TYPE_JITTER_MS = 60;
const TYPE_SEND_PAUSE_MS = 700;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2, 10);

// The last name + direction, so a reload lands on a filled-in card. This
// section only ever mounts on the client (StudioShell mounts it from an
// effect), so reading storage in a lazy initialiser is safe.
function loadSetup(): { name: string; direction: Direction; question: string } {
  const fallback = { name: '', direction: 'up' as Direction, question: '' };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(SETUP_KEY);
    if (!raw) return fallback;
    const j = JSON.parse(raw) as { name?: unknown; direction?: unknown; question?: unknown };
    return {
      name: typeof j.name === 'string' ? j.name : '',
      direction: j.direction === 'down' ? 'down' : 'up',
      question: typeof j.question === 'string' ? j.question : '',
    };
  } catch {
    return fallback;
  }
}

// ── Stage: adjustable width + zoom around the highlighted text ──────────────
const WIDTH_KEY = 'studio-chatgpt-width-v1';
const MIN_STAGE_W = 360;
const DEFAULT_STAGE_W = 1180;
// Zoom only ever pushes in: the floor is the baseline, never smaller.
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.1;
// The stage's transform: translate(tx, ty) scale(zoom) from the top-left corner.
interface View { zoom: number; tx: number; ty: number }
const VIEW_RESET: View = { zoom: 1, tx: 0, ty: 0 };

function loadWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_STAGE_W;
  try {
    const v = JSON.parse(localStorage.getItem(WIDTH_KEY) ?? 'null');
    return typeof v === 'number' && v >= MIN_STAGE_W ? Math.round(v) : DEFAULT_STAGE_W;
  } catch {
    return DEFAULT_STAGE_W;
  }
}

// Highlight exactly this element's text (a pick's name), so a zoom lands on it.
function selectContents(el: HTMLElement) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
}

// Hand a rendered recording to the browser's downloads.
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// ── Icons (chatgpt.com's line icons, redrawn) ───────────────────────────────
const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const PanelIcon   = () => <svg width="20" height="20" viewBox="0 0 24 24" {...line}><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg>;
const ChevronIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" {...line} strokeWidth={2}><path d="M6 9l6 6 6-6"/></svg>;
const PlusIcon    = () => <svg width="20" height="20" viewBox="0 0 24 24" {...line} strokeWidth={2}><path d="M12 5v14M5 12h14"/></svg>;
const MicIcon     = () => <svg width="20" height="20" viewBox="0 0 24 24" {...line}><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></svg>;
const ArrowUpIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" {...line} strokeWidth={2.2}><path d="M12 19V5M5 12l7-7 7 7"/></svg>;
const StopIcon    = () => <svg width="20" height="20" viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>;
const CopyIcon    = () => <svg width="18" height="18" viewBox="0 0 24 24" {...line}><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>;
const ShareIcon   = () => <svg width="18" height="18" viewBox="0 0 24 24" {...line}><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>;
const ExtLinkIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" {...line}><path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>;

// ── Pieces ──────────────────────────────────────────────────────────────────
function Runs({ runs, limit }: { runs: Run[]; limit: number }) {
  const out: React.ReactNode[] = [];
  let left = limit;
  for (let i = 0; i < runs.length && left > 0; i++) {
    const r = runs[i];
    const t = r.text.slice(0, left);
    left -= r.text.length;
    if (r.name) out.push(<strong key={i} className={s.pickName} onClick={e => selectContents(e.currentTarget)}>{t}</strong>);
    else out.push(r.strong ? <strong key={i}>{t}</strong> : r.em ? <em key={i}>{t}</em> : <span key={i}>{t}</span>);
  }
  return <>{out}</>;
}

function AssistantBody({ blocks, shown }: { blocks: Block[]; shown: number }) {
  const nodes: React.ReactNode[] = [];
  let i = 0;
  while (i < blocks.length && blocks[i].start < shown) {
    if (blocks[i].kind === 'li') {
      // Keyed by the group's FIRST block so the list keeps its DOM nodes as
      // bullets stream in; a highlight made mid-stream survives that way.
      const groupStart = i;
      const items: React.ReactNode[] = [];
      while (i < blocks.length && blocks[i].kind === 'li' && blocks[i].start < shown) {
        const li = blocks[i];
        items.push(<li key={i}><Runs runs={li.runs} limit={shown - li.start} /></li>);
        i++;
      }
      nodes.push(<ul key={`ul-${groupStart}`}>{items}</ul>);
    } else {
      const p = blocks[i];
      nodes.push(<p key={i}><Runs runs={p.runs} limit={shown - p.start} /></p>);
      i++;
    }
  }
  return <>{nodes}</>;
}

function LoadingIndicator() {
  const [phase, setPhase] = useState<'dot' | 'text'>('dot');
  useEffect(() => {
    const t = setTimeout(() => setPhase('text'), DOT_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className={s.loading}>
      {phase === 'dot' ? <span className={s.dot} /> : <span className={s.shimmer}>Searching the web</span>}
    </div>
  );
}

function AssistantMessage({ msg, onRetry }: { msg: AssistantMsg; onRetry: () => void }) {
  const blocks = useMemo(() => (msg.reply ? buildBlocks(msg.reply) : []), [msg.reply]);
  if (msg.status === 'loading') return <LoadingIndicator />;
  if (msg.status === 'error') {
    return (
      <div className={s.errorBox}>
        <span>Something went wrong while generating the response. If this issue persists please contact us through our help center at help.openai.com.</span>
        <button type="button" className={s.retry} onClick={onRetry}>Retry</button>
      </div>
    );
  }
  return (
    <div>
      <div className={s.assistant}>
        <AssistantBody blocks={blocks} shown={msg.shown} />
      </div>
      {msg.status === 'done' && msg.reply && (
        <div className={s.actions}>
          <button
            type="button"
            className={s.actionBtn}
            title="Copy"
            onClick={() => { const r = msg.reply; if (r) navigator.clipboard?.writeText(replyToText(r)).catch(() => {}); }}
          >
            <CopyIcon />
          </button>
          <button type="button" className={s.actionBtn} title="Share"><ShareIcon /></button>
        </div>
      )}
    </div>
  );
}

interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  // A click anywhere in the pill; the landing composer uses it to start typing
  // the pre-written question.
  onEngage?: () => void;
  // While the question types itself out, keystrokes don't edit the text.
  locked?: boolean;
  generating: boolean;
  showDisclaimer: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}
function Composer({ value, onChange, onSend, onStop, onEngage, locked, generating, showDisclaimer, inputRef }: ComposerProps) {
  const empty = !value.trim();
  // Auto-grow the textarea with its content (capped by the stylesheet).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value, inputRef]);
  return (
    <div className={s.composerWrap}>
      <form className={s.composer} onSubmit={e => { e.preventDefault(); onSend(); }} onClick={onEngage}>
        <button type="button" className={s.iconBtn} aria-label="Add files and more"><PlusIcon /></button>
        <textarea
          ref={inputRef}
          className={s.input}
          rows={1}
          placeholder="Ask ChatGPT"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          value={value}
          onChange={e => { if (!locked) onChange(e.target.value); }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
          }}
        />
        {showDisclaimer && empty && <span className={s.disclaimer}>ChatGPT is AI and can make mistakes.</span>}
        <button type="button" className={s.iconBtn} aria-label="Dictate"><MicIcon /></button>
        {generating ? (
          <button type="button" className={s.stop} onClick={onStop} aria-label="Stop streaming"><StopIcon /></button>
        ) : (
          <button type="submit" className={s.send} disabled={empty} aria-label="Send prompt"><ArrowUpIcon /></button>
        )}
      </form>
    </div>
  );
}

// ── Section ─────────────────────────────────────────────────────────────────
export function ChatGptSection({ active }: { active: boolean }) {
  const [stage, setStage] = useState<'setup' | 'chat'>('setup');
  const [name, setName] = useState(() => loadSetup().name);
  const [direction, setDirection] = useState<Direction>(() => loadSetup().direction);
  const [question, setQuestion] = useState(() => loadSetup().question);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  // The recording being made (label + 0..1 once frames are going), and how the
  // last one ended.
  const [render, setRender] = useState<{ label: string; pct: number | null } | null>(null);
  const [renderNote, setRenderNote] = useState<{ ok: boolean; text: string } | null>(null);
  const renderCtrlRef = useRef<AbortController | null>(null);
  // What the last recording was made from, so Open the chat can replay it.
  const renderedRef = useRef<{ name: string; direction: Direction; question: string; reply: Reply } | null>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);

  const abortRef = useRef<AbortController | null>(null);
  // The pre-written question's answer, asked for while it types itself out —
  // see engageComposer. Taken up by send() when that question is what goes.
  const prefetchRef = useRef<{ text: string; ctrl: AbortController; request: Promise<Reply> } | null>(null);
  const streamRef = useRef<number | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // The pre-written question: waiting for the first click in the search bar
  // (scriptRef), then being typed out (typingRef holds the full text so Enter
  // mid-typing can complete it).
  const scriptRef = useRef<string | null>(null);
  const typingRef = useRef<string | null>(null);
  const typeTimerRef = useRef<number | null>(null);
  const [autoTyping, setAutoTyping] = useState(false);
  const cancelAutoType = useCallback(() => {
    if (typeTimerRef.current != null) { clearTimeout(typeTimerRef.current); typeTimerRef.current = null; }
    typingRef.current = null;
    setAutoTyping(false);
  }, []);

  // Stage width + zoom. viewRef mirrors `view` for the native wheel listener.
  const [stageWidth, setStageWidth] = useState(() => loadWidth());
  const [maxStageW, setMaxStageW] = useState(0);
  const [view, setView] = useState<View>(VIEW_RESET);
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);

  // Scale the stage to `nextZoom` around the highlighted text if there is any
  // inside the stage, else around `fallback` (a pointer position), else the
  // middle. The chosen point stays exactly where it is on screen, so zooming in
  // reads as pushing the camera into that text.
  const zoomTo = useCallback((nextZoom: number, fallback?: { x: number; y: number }) => {
    const holder = holderRef.current;
    if (!holder) return;
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(nextZoom * 100) / 100));
    if (z === 1) { setView(VIEW_RESET); return; }
    // The holder is never transformed, so its rect is the stage's layout box.
    const hr = holder.getBoundingClientRect();
    const cur = viewRef.current;
    let sx = hr.left + hr.width / 2;
    let sy = hr.top + hr.height / 2;
    const sel = window.getSelection();
    const range = sel && sel.rangeCount > 0 && !sel.isCollapsed ? sel.getRangeAt(0) : null;
    const rr = range?.getBoundingClientRect();
    if (range && rr && (rr.width > 0 || rr.height > 0) && holder.contains(range.commonAncestorContainer)) {
      sx = rr.left + rr.width / 2;
      sy = rr.top + rr.height / 2;
    } else if (fallback) {
      sx = fallback.x;
      sy = fallback.y;
    }
    // That screen point in unscaled stage coordinates, then the translate that
    // keeps it put at the new zoom.
    const px = (sx - hr.left - cur.tx) / cur.zoom;
    const py = (sy - hr.top - cur.ty) / cur.zoom;
    let tx = sx - hr.left - px * z;
    let ty = sy - hr.top - py * z;
    // Never show grey past the content: pin the edges.
    const W = hr.width, H = hr.height;
    tx = Math.min(0, Math.max(W - W * z, tx));
    ty = Math.min(0, Math.max(H - H * z, ty));
    setView({ zoom: z, tx, ty });
  }, []);

  function setWidth(w: number) {
    const v = Math.max(MIN_STAGE_W, Math.round(w));
    setStageWidth(v);
    try { localStorage.setItem(WIDTH_KEY, JSON.stringify(v)); } catch { /* ignore */ }
  }

  // Ctrl+scroll over the stage zooms the stage (and not the browser). React's
  // onWheel is passive, so this is a native, non-passive listener.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || stage !== 'chat') return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomTo(viewRef.current.zoom * Math.exp(-e.deltaY * 0.002), { x: e.clientX, y: e.clientY });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [stage, zoomTo]);

  // The pane's width bounds the width slider (the observer fires once on
  // observe, so the initial measurement comes through the callback too).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || stage !== 'chat') return;
    const ro = new ResizeObserver(entries => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w) setMaxStageW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [stage]);

  const last = messages[messages.length - 1];
  const generating = !!last && last.role === 'assistant' && (last.status === 'loading' || last.status === 'streaming');
  const answered = messages.some(m => m.role === 'assistant' && m.status === 'done');

  // Stop like chatgpt.com does: mid-stream keeps what has been shown; still
  // loading drops the pending answer entirely.
  const stop = useCallback(() => {
    cancelAutoType();
    prefetchRef.current?.ctrl.abort();
    prefetchRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    if (streamRef.current != null) { cancelAnimationFrame(streamRef.current); streamRef.current = null; }
    setMessages(prev => {
      const tail = prev[prev.length - 1];
      if (!tail || tail.role !== 'assistant') return prev;
      if (tail.status === 'loading') return prev.slice(0, -1);
      if (tail.status === 'streaming') return [...prev.slice(0, -1), { ...tail, status: 'done' }];
      return prev;
    });
  }, [cancelAutoType]);

  const backToSetup = useCallback(() => { stop(); setStage('setup'); }, [stop]);

  function saveSetup(n: string, q: string) {
    try { localStorage.setItem(SETUP_KEY, JSON.stringify({ name: n, direction, question: q })); } catch { /* ignore */ }
  }

  // Open the chat, to play the same thing live. The answer the last recording
  // was rendered from is queued for the click-to-type, so the preview matches
  // the file rather than asking the model again.
  function openChat() {
    const n = name.trim();
    if (!n) { nameRef.current?.focus(); return; }
    const q = question.trim();
    saveSetup(n, q);
    stop();
    scriptRef.current = q || null;
    const r = renderedRef.current;
    if (q && r && r.question === q && r.name === n && r.direction === direction) {
      prefetchRef.current = { text: q, ctrl: new AbortController(), request: Promise.resolve(r.reply) };
    }
    setMessages([]);
    setInput('');
    setView(VIEW_RESET);
    setStage('chat');
  }

  function cancelRender() {
    renderCtrlRef.current?.abort();
    renderCtrlRef.current = null;
    setRender(null);
  }

  // Start: ask the model once, render the recording from its answer, download
  // it. Stays on this card, so the next clip is a tweak and a click away.
  async function start() {
    const n = name.trim();
    if (!n) { nameRef.current?.focus(); return; }
    const q = question.trim();
    if (!q) {
      questionRef.current?.focus();
      setRenderNote({ ok: false, text: 'Type the question first: it is what gets asked in the recording.' });
      return;
    }
    saveSetup(n, q);
    cancelRender();
    const ctrl = new AbortController();
    renderCtrlRef.current = ctrl;
    setRenderNote(null);
    setRender({ label: 'Asking ChatGPT…', pct: null });
    try {
      const reply = await requestReply([{ role: 'user', content: q }], ctrl.signal);
      renderedRef.current = { name: n, direction, question: q, reply };
      const { blob, filename } = await renderChatVideo({
        name: n,
        direction,
        question: q,
        reply,
        signal: ctrl.signal,
        onProgress: (done, total) => setRender({ label: `Rendering ${Math.round((done / total) * 100)}%`, pct: done / total }),
      });
      downloadBlob(blob, filename);
      setRenderNote({ ok: true, text: `Saved ${filename}` });
    } catch (err) {
      if (!ctrl.signal.aborted) setRenderNote({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      if (renderCtrlRef.current === ctrl) { renderCtrlRef.current = null; setRender(null); }
    }
  }

  // The top-right Reset: everything back to square one. Chat, zoom, width,
  // name, direction and question all cleared, saved values dropped, back on an
  // empty setup card.
  function resetAll() {
    stop();
    cancelRender();
    renderedRef.current = null;
    setRenderNote(null);
    scriptRef.current = null;
    setMessages([]);
    setInput('');
    setView(VIEW_RESET);
    setStageWidth(DEFAULT_STAGE_W);
    setName('');
    setDirection('up');
    setQuestion('');
    try { localStorage.removeItem(SETUP_KEY); localStorage.removeItem(WIDTH_KEY); } catch { /* ignore */ }
    setStage('setup');
  }

  // First click in the landing search bar: type the pre-written question out
  // at a human pace, then send it after a beat.
  function engageComposer() {
    const script = scriptRef.current;
    if (!script || autoTyping || messages.length > 0 || generating) return;
    scriptRef.current = null;
    typingRef.current = script;
    setAutoTyping(true);
    inputRef.current?.focus();
    // Ask for the answer now, while the question types itself out, so the
    // model's own couple of seconds are spent before it is sent rather than
    // after; send() picks this up when the same question goes. Unless the
    // answer is already queued (Open the chat after a recording).
    if (prefetchRef.current?.text !== script) {
      const ctrl = new AbortController();
      const request = requestReply([{ role: 'user', content: script }], ctrl.signal);
      request.catch(() => { /* aborted, or handled where it is awaited */ });
      prefetchRef.current = { text: script, ctrl, request };
    }
    let i = 0;
    const step = () => {
      i++;
      setInput(script.slice(0, i));
      if (i >= script.length) {
        typeTimerRef.current = window.setTimeout(() => {
          typeTimerRef.current = null;
          typingRef.current = null;
          setAutoTyping(false);
          void send(script, []);
        }, TYPE_SEND_PAUSE_MS);
        return;
      }
      // A touch slower after a space, a real pause after punctuation.
      const prev = script[i - 1];
      const delay = TYPE_BASE_MS + Math.random() * TYPE_JITTER_MS + (prev === ' ' ? 25 : 0) + (/[,.?!]/.test(prev) ? 140 : 0);
      typeTimerRef.current = window.setTimeout(step, delay);
    };
    typeTimerRef.current = window.setTimeout(step, 250);
  }

  // Enter (or the arrow) while the question is still typing: complete it and
  // send right away.
  function sendFromComposer() {
    const full = typingRef.current;
    if (autoTyping && full) {
      cancelAutoType();
      setInput(full);
      void send(full, []);
      return;
    }
    void send(input);
  }

  // While this section is the visible one: Esc returns to the setup card, and
  // Ctrl +/− / Ctrl 0 zoom the stage instead of the browser.
  useEffect(() => {
    if (!active || stage !== 'chat') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { backToSetup(); return; }
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomTo(viewRef.current.zoom * ZOOM_STEP); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomTo(viewRef.current.zoom / ZOOM_STEP); }
      else if (e.key === '0') { e.preventDefault(); zoomTo(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, stage, backToSetup, zoomTo]);

  // Focus the composer when a chat opens, unless a question is waiting for the
  // click in the search bar (that click is the cue, not the focus).
  useEffect(() => {
    if (stage === 'chat') { if (!scriptRef.current) inputRef.current?.focus(); }
    else nameRef.current?.focus();
  }, [stage]);

  // Keep the thread pinned to the bottom as the answer grows, unless something
  // in it is highlighted (a name clicked mid-stream must stay where it is).
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const sel = window.getSelection();
    const range = sel && sel.rangeCount > 0 && !sel.isCollapsed ? sel.getRangeAt(0) : null;
    if (range && el.contains(range.commonAncestorContainer)) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => () => {
    abortRef.current?.abort();
    prefetchRef.current?.ctrl.abort();
    renderCtrlRef.current?.abort();
    if (streamRef.current != null) cancelAnimationFrame(streamRef.current);
    if (typeTimerRef.current != null) clearTimeout(typeTimerRef.current);
  }, []);

  function stream(id: string, total: number) {
    const t0 = performance.now();
    const tick = (now: number) => {
      const shown = Math.min(total, Math.floor(((now - t0) / 1000) * CHARS_PER_SEC));
      const status: AssistantStatus = shown >= total ? 'done' : 'streaming';
      setMessages(prev => prev.map(m => (m.id === id && m.role === 'assistant' ? { ...m, shown, status } : m)));
      streamRef.current = status === 'done' ? null : requestAnimationFrame(tick);
    };
    streamRef.current = requestAnimationFrame(tick);
  }

  /** One answer from the route, for the chat so far. */
  function requestReply(history: { role: 'user' | 'assistant'; content: string }[], signal: AbortSignal): Promise<Reply> {
    return askChatGpt(name.trim(), direction, history, signal);
  }

  // `base` is the chat the new message follows (defaults to the current one;
  // Retry passes a trimmed copy).
  async function send(textRaw: string, base: Msg[] = messages) {
    const text = textRaw.trim();
    if (!text || generating) return;
    const userMsg: UserMsg = { id: uid(), role: 'user', text };
    const asstId = uid();
    const history = [...base, userMsg]
      .map(m => (m.role === 'user'
        ? { role: 'user' as const, content: m.text }
        : { role: 'assistant' as const, content: m.reply ? replyToText(m.reply) : '' }))
      .filter(m => m.content.trim());
    setMessages([...base, userMsg, { id: asstId, role: 'assistant', reply: null, status: 'loading', shown: 0 }]);
    setInput('');

    // The answer already on its way for this exact question, when it was the
    // pre-written one; anything else is asked for now.
    const pre = prefetchRef.current;
    prefetchRef.current = null;
    const reuse = pre && base.length === 0 && pre.text === text ? pre : null;
    if (pre && !reuse) pre.ctrl.abort();
    const ctrl = reuse?.ctrl ?? new AbortController();
    abortRef.current = ctrl;
    const request = reuse?.request ?? requestReply(history, ctrl.signal);

    // Hold the loading state for ~1.5s no matter how fast the model returns.
    const [result] = await Promise.allSettled([request, sleep(MIN_LOADING_MS + Math.random() * LOADING_JITTER_MS)]);
    if (ctrl.signal.aborted) return;
    abortRef.current = null;

    if (result.status === 'rejected') {
      const reason = result.reason;
      const error = reason instanceof Error ? reason.message : String(reason);
      setMessages(prev => prev.map(m => (m.id === asstId && m.role === 'assistant' ? { ...m, status: 'error', error } : m)));
      return;
    }
    const reply = result.value;
    const total = totalLen(buildBlocks(reply));
    setMessages(prev => prev.map(m => (m.id === asstId && m.role === 'assistant' ? { ...m, reply, status: 'streaming', shown: 0 } : m)));
    stream(asstId, total);
  }

  // Retry re-sends the last user message on top of the chat before it.
  function retry() {
    let base = messages;
    const tail = base[base.length - 1];
    if (tail?.role === 'assistant' && tail.status === 'error') base = base.slice(0, -1);
    const lastUser = base[base.length - 1];
    if (!lastUser || lastUser.role !== 'user') return;
    void send(lastUser.text, base.slice(0, -1));
  }

  // ── Setup card ────────────────────────────────────────────────────────────
  if (stage === 'setup') {
    return (
      <div className={s.root}>
        <button type="button" className={s.resetAll} title="Reset everything" onClick={resetAll}>Reset</button>
        <div className="min-h-screen flex items-center justify-center p-4 sm:p-8">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-[#111] p-6 sm:p-8 flex flex-col gap-6">
            <div>
              <h1 className="text-3xl font-semibold text-white">ChatGPT</h1>
              <p className="text-base text-zinc-500 mt-2">
                Type a name and pick a direction. Whatever gets asked in the chat, ChatGPT argues it&apos;s them.
              </p>
            </div>
            <label className="flex flex-col gap-2">
              <span className="text-sm uppercase tracking-wide text-zinc-500">Name</span>
              <input
                ref={nameRef}
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void start(); }}
                placeholder="e.g. Trump"
                className="h-14 rounded-xl bg-black border border-zinc-800 px-4 text-white text-xl outline-none focus:border-zinc-500"
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-sm uppercase tracking-wide text-zinc-500">Question</span>
              <textarea
                ref={questionRef}
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void start(); } }}
                placeholder="e.g. who is the most overrated musician of all time?"
                rows={2}
                className="rounded-xl bg-black border border-zinc-800 px-4 py-3 text-white text-lg outline-none focus:border-zinc-500 resize-none"
              />
              <span className="text-sm text-zinc-600">
                Typed out in the recording, spelled right. In the live chat, the first click in the search bar types it out and sends it.
              </span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setDirection('up')}
                className={`h-16 rounded-xl border text-xl font-semibold transition-colors ${
                  direction === 'up'
                    ? 'bg-emerald-500/15 border-emerald-500 text-emerald-300'
                    : 'bg-black border-zinc-800 text-zinc-500 hover:text-zinc-300'
                }`}
              >
                📈 Up
              </button>
              <button
                type="button"
                onClick={() => setDirection('down')}
                className={`h-16 rounded-xl border text-xl font-semibold transition-colors ${
                  direction === 'down'
                    ? 'bg-red-500/15 border-red-500 text-red-300'
                    : 'bg-black border-zinc-800 text-zinc-500 hover:text-zinc-300'
                }`}
              >
                📉 Down
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={render ? undefined : () => void start()}
                disabled={!render && !name.trim()}
                className="relative overflow-hidden h-14 rounded-xl bg-white text-black font-semibold text-lg hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
              >
                {render?.pct != null && (
                  <span className="absolute inset-y-0 left-0 bg-zinc-400/70" style={{ width: `${Math.round(render.pct * 100)}%` }} />
                )}
                <span className="relative">{render ? render.label : 'Start'}</span>
              </button>
              <div className="flex items-center justify-between gap-3 text-sm">
                <button
                  type="button"
                  onClick={openChat}
                  disabled={!!render || !name.trim()}
                  className="text-zinc-400 hover:text-white underline underline-offset-2 disabled:opacity-40"
                >
                  Open the chat instead
                </button>
                {render && (
                  <button type="button" onClick={cancelRender} className="text-zinc-400 hover:text-white">Cancel</button>
                )}
              </div>
              {renderNote && (
                <p className={`text-sm leading-relaxed ${renderNote.ok ? 'text-emerald-300' : 'text-red-300'}`}>{renderNote.text}</p>
              )}
            </div>
            <p className="text-sm text-zinc-600 leading-relaxed">
              Start renders the recording, about {CLIP_SECONDS} seconds at {FILE_W}×{FILE_H}, right here and
              downloads it: the question typed out with the keyboard sound, the answer loading, then the pointer
              selecting the name to zoom in on it before leaving.
              Open the chat plays the same thing live (the first click in the search bar types the question;
              Esc or the wordmark comes back here). In the chat, Ctrl + scroll zooms around highlighted text
              and the pill at the bottom-right sets its width.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Chat ──────────────────────────────────────────────────────────────────
  const inChat = messages.length > 0;
  const sliderMax = Math.max(maxStageW || 1920, stageWidth);
  return (
    <div className={s.root}>
      <div className={s.viewport} ref={viewportRef}>
      <div className={s.holder} ref={holderRef} style={{ width: `${stageWidth}px` }}>
      <div className={s.stage} style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.zoom})` }}>
      <div className={s.app}>
        {inChat && (
          <aside className={s.rail}>
            <button type="button" className={s.railBtn} title="Open sidebar" onClick={backToSetup}><PanelIcon /></button>
            <div className={s.railSpacer} />
            <div className={s.railDivider} />
            <div className={s.railLinks}>
              <ExtLinkIcon />
              <ExtLinkIcon />
            </div>
            <div className={s.railDivider} />
          </aside>
        )}
        <div className={s.main}>
          <header className={s.header}>
            <button type="button" className={s.brand} onClick={backToSetup} title="Back to setup">
              ChatGPT <ChevronIcon />
            </button>
            <div className={s.auth}>
              <button type="button" className={s.btnLogin}>Log in</button>
              <button type="button" className={s.btnSignup}>Sign up for free</button>
            </div>
          </header>

          {!inChat ? (
            <>
              <div className={s.landing}>
                <h1 className={s.heading}>Where should we begin?</h1>
                <Composer
                  value={input}
                  onChange={setInput}
                  onSend={sendFromComposer}
                  onStop={stop}
                  onEngage={engageComposer}
                  locked={autoTyping}
                  generating={false}
                  showDisclaimer={false}
                  inputRef={inputRef}
                />
                <button type="button" className={s.chip} onClick={() => inputRef.current?.focus()}>What can you do?</button>
              </div>
              <footer className={s.footer}>
                ChatGPT is AI. By using it, you agree to our <u>Terms</u> &amp; <u>Privacy Policy</u>. Chats may be reviewed and used to improve our AI models. <u>Learn more</u>
              </footer>
            </>
          ) : (
            <>
              <div className={s.thread} ref={threadRef}>
                <div className={s.threadInner}>
                  {messages.map(m => (
                    m.role === 'user' ? (
                      <div key={m.id} className={s.userRow}><div className={s.userBubble}>{m.text}</div></div>
                    ) : (
                      <AssistantMessage key={m.id} msg={m} onRetry={retry} />
                    )
                  ))}
                </div>
              </div>
              <div className={s.bottom}>
                {answered && !generating && (
                  <div className={s.upsell}>
                    <span>You&apos;ll get smarter responses and can upload files, images, and more.</span>
                    <div className={s.upsellBtns}>
                      <button type="button" className={s.btnLogin}>Log in</button>
                      <button type="button" className={s.btnSignup}>Sign up for free</button>
                    </div>
                  </div>
                )}
                <Composer
                  value={input}
                  onChange={setInput}
                  onSend={() => void send(input)}
                  onStop={stop}
                  generating={generating}
                  showDisclaimer={answered}
                  inputRef={inputRef}
                />
              </div>
            </>
          )}
        </div>
      </div>
      </div>
      </div>
      </div>

      <button type="button" className={s.resetAll} title="Reset everything" onClick={resetAll}>Reset</button>

      {/* Stage pill: width slider + zoom reset. The reset swallows mousedown so
          a text selection survives the click. */}
      <div className={s.tools}>
        <span>Width</span>
        <input
          type="range"
          className={s.toolsRange}
          min={MIN_STAGE_W}
          max={sliderMax}
          step={10}
          value={Math.min(stageWidth, sliderMax)}
          onChange={e => setWidth(Number(e.target.value))}
        />
        <span className={s.toolsVal}>{stageWidth}px</span>
        <span className={s.toolsSep} />
        <button
          type="button"
          className={s.toolsBtn}
          title="Reset zoom (Ctrl 0)"
          onMouseDown={e => e.preventDefault()}
          onClick={() => zoomTo(1)}
        >
          ↺
        </button>
      </div>
    </div>
  );
}
