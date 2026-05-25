import { useEffect, useRef, useState } from "react";
import type { Theme } from "./Accounts";

interface Props {
  themes: Theme[];
  selected: string[];
  onChange: (next: string[]) => void;
  onManual?: () => void;
}

export function ThemePicker({ themes, selected, onChange, onManual }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  };

  const selectedNames = themes.filter((t) => selected.includes(t.id)).map((t) => t.name);
  const label =
    selected.length === 0
      ? "Choose themes..."
      : selected.length === 1
      ? selectedNames[0]
      : `${selected.length} themes selected`;

  return (
    <div className="theme-picker" ref={ref}>
      <button
        type="button"
        className="theme-picker-button"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{label}</span>
        <span className="theme-picker-caret">▾</span>
      </button>
      {open && (
        <div className="theme-picker-menu">
          {themes.length === 0 && (
            <div className="theme-picker-empty">No themes yet. Open Accounts to create one.</div>
          )}
          {themes.map((t) => {
            const checked = selected.includes(t.id);
            return (
              <label key={t.id} className="theme-picker-item">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(t.id)}
                />
                <span>{t.name}</span>
              </label>
            );
          })}
          {(themes.length > 0 || onManual) && <div className="theme-picker-divider" />}
          <div className="theme-picker-actions">
            {themes.length > 0 && (
              <button
                type="button"
                className="secondary small"
                onClick={() => onChange([])}
              >
                Clear
              </button>
            )}
            {onManual && (
              <button
                type="button"
                className="secondary small"
                onClick={() => { setOpen(false); onManual(); }}
              >
                Pick phones manually
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
