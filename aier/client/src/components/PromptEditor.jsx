import { useLayoutEffect, useRef, useState } from 'react';

// The two Kling reference tokens the prompt can use. The text is sent to Kling
// VERBATIM (plain "#start_image" / "#Element1") — the coloring below is purely a
// visual overlay so you can see the tokens while you type.
const TOKENS = [
  { token: '#start_image', desc: 'the freeze frame Kling continues from' },
  { token: '#Element1', desc: 'you (Aiden) — the inserted reference person' },
];

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Wrap the known tokens in a colored span for the highlight backdrop. The spans
// carry ONLY color (no padding/margin/font-weight) so the backdrop stays
// pixel-aligned with the transparent textarea on top of it.
const highlight = (text) =>
  escapeHtml(text).replace(/#(start_image|Element1)\b/g, '<mark class="pe-tok">#$1</mark>');

/**
 * Textarea that highlights #start_image / #Element1 and pops a picker when you
 * type "#". `value` is always plain text — that's what gets sent to Kling.
 */
export default function PromptEditor({ value, onChange, placeholder }) {
  const taRef = useRef(null);
  const backRef = useRef(null);
  const [menu, setMenu] = useState(null); // { start, query } while typing a #token

  // Keep the colored backdrop scrolled in lockstep with the textarea.
  const syncScroll = () => {
    if (backRef.current && taRef.current) {
      backRef.current.scrollTop = taRef.current.scrollTop;
      backRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };
  useLayoutEffect(syncScroll, [value]);

  // Are we mid-typing a "#token" right at the caret? (a '#' not glued to a word,
  // followed only by word chars up to the caret.)
  function detectMenu(text, caret) {
    const m = /#(\w*)$/.exec(text.slice(0, caret));
    if (!m) return null;
    const hashIdx = caret - m[0].length;
    const prev = text[hashIdx - 1];
    if (prev && /\w/.test(prev)) return null; // part of a bigger word, not a token
    return { start: hashIdx, query: m[1] };
  }

  function handleChange(e) {
    const text = e.target.value;
    onChange(text);
    setMenu(detectMenu(text, e.target.selectionStart));
  }

  function insertToken(tok) {
    const ta = taRef.current;
    if (!ta || !menu) return;
    const before = value.slice(0, menu.start);
    const after = value.slice(ta.selectionStart);
    const next = `${before}${tok} ${after}`;
    onChange(next);
    setMenu(null);
    const pos = (before + tok + ' ').length; // caret just past the inserted token
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(pos, pos); });
  }

  const items = menu
    ? TOKENS.filter((t) => t.token.slice(1).toLowerCase().startsWith(menu.query.toLowerCase()))
    : [];

  return (
    <div className="prompt-editor">
      <div className="pe-backdrop" ref={backRef} aria-hidden
        dangerouslySetInnerHTML={{ __html: highlight(value) + '\n' }} />
      <textarea
        ref={taRef}
        className="pe-input"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={handleChange}
        onScroll={syncScroll}
        onKeyDown={(e) => { if (e.key === 'Escape') setMenu(null); }}
        onBlur={() => setTimeout(() => setMenu(null), 120)} />
      {menu && items.length > 0 && (
        <div className="pe-menu">
          {items.map((t) => (
            <button type="button" key={t.token} className="pe-opt"
              onMouseDown={(e) => { e.preventDefault(); insertToken(t.token); }}>
              <b>{t.token}</b><span>{t.desc}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
