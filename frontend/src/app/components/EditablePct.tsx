'use client';

import { useState, useRef, useEffect } from 'react';

// A read-only-looking percentage label that turns into a tiny inline input on
// click. Used next to zoom sliders so users can type "200" instead of dragging.
// Looks identical to a plain `<span>{value}%</span>` when idle — only the
// cursor + a subtle hover color hint give away that it's editable.
interface EditablePctProps {
  value: number;                    // integer percent (e.g. 85)
  min: number;
  max: number;
  step?: number;
  onCommit: (pct: number) => void;  // fires once on blur / Enter, value clamped+snapped
}

export function EditablePct({ value, min, max, step = 1, onCommit }: EditablePctProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the draft in sync with external value when the user isn't editing.
  useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);

  // Select all on enter so typing replaces the existing number immediately.
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function commit() {
    const parsed = parseInt(draft, 10);
    if (Number.isFinite(parsed)) {
      const clamped = Math.max(min, Math.min(max, parsed));
      const snapped = step > 1 ? Math.round(clamped / step) * step : clamped;
      onCommit(snapped);
      setDraft(String(snapped));
    } else {
      setDraft(String(value));
    }
    setEditing(false);
  }

  if (editing) {
    return (
      <span className="text-[10px] text-zinc-500 w-8 text-right tabular-nums shrink-0 inline-flex items-baseline justify-end">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          value={draft}
          onChange={e => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { setDraft(String(value)); setEditing(false); }
          }}
          className="w-[22px] bg-transparent text-zinc-200 text-right tabular-nums outline-none p-0 m-0 border-0"
        />
        %
      </span>
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(true); } }}
      title="Click to type a value"
      className="text-[10px] text-zinc-500 w-8 text-right tabular-nums shrink-0 cursor-text hover:text-zinc-300 transition-colors select-none"
    >
      {value}%
    </span>
  );
}
