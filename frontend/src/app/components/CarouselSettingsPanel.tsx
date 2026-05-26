'use client';

import { useState, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type {
  CarouselSettings, CarouselFontLabel, CarouselFontWeight, CarouselTextAlign,
  TagStyle, LayerId, CarouselSettingsPanelProps, DividerStyleSettings,
  SwipeStyle, SwipeArrowType, SwipeLayout, SwipeDirection, ShadowStyle,
  DividerSubSlotContent,
} from './carouselTypes';
import { CAROUSEL_FONTS, CAROUSEL_WEIGHTS, MAX_FONT, SUB_MAX, defaultTagStyle, defaultDividerSettings, defaultSwipeStyle, defaultShadowStyle } from './carouselTypes';
import { QUOTE_STYLES } from './quoteStyles';
import { SwipePreviewMini } from './SwipePreviewMini';

// ── Shared settings UI components ────────────────────────────────────────────

function Slider({ label, value, min = 0, max = 100, unit = '%', onChange }: {
  label: string; value: number; min?: number; max?: number; unit?: string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-zinc-400">{label}</span>
        <span className="text-[11px] text-zinc-500">{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1 accent-white cursor-pointer" />
    </div>
  );
}

function PillBtn({ active, onClick, children, compact }: { active: boolean; onClick: () => void; children: ReactNode; compact?: boolean }) {
  return (
    <button onClick={onClick} className={`px-2 flex items-center rounded-md text-[10px] transition-colors ${
      compact ? 'py-2' : 'h-9'
    } ${
      active ? 'bg-white text-black' : 'bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
    }`}>{children}</button>
  );
}

const ALIGN_ICONS: { value: CarouselTextAlign; icon: ReactNode }[] = [
  { value: 'left',    icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="1.5" rx="0.75"/><rect x="1" y="5.5" width="10" height="1.5" rx="0.75"/><rect x="1" y="9" width="14" height="1.5" rx="0.75"/><rect x="1" y="12.5" width="8" height="1.5" rx="0.75"/></svg> },
  { value: 'center',  icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="1.5" rx="0.75"/><rect x="3" y="5.5" width="10" height="1.5" rx="0.75"/><rect x="1" y="9" width="14" height="1.5" rx="0.75"/><rect x="4" y="12.5" width="8" height="1.5" rx="0.75"/></svg> },
  { value: 'right',   icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="1.5" rx="0.75"/><rect x="5" y="5.5" width="10" height="1.5" rx="0.75"/><rect x="1" y="9" width="14" height="1.5" rx="0.75"/><rect x="7" y="12.5" width="8" height="1.5" rx="0.75"/></svg> },
  { value: 'justify', icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="1.5" rx="0.75"/><rect x="1" y="5.5" width="14" height="1.5" rx="0.75"/><rect x="1" y="9" width="14" height="1.5" rx="0.75"/><rect x="1" y="12.5" width="14" height="1.5" rx="0.75"/></svg> },
];

function FontDropdown({ value, onChange }: { value: CarouselFontLabel; onChange: (v: CarouselFontLabel) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef  = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    CAROUSEL_FONTS.forEach(f => {
      if (!f.google) return;
      const id = `gfont-${f.label.replace(/\s+/g, '-')}`;
      if (!document.getElementById(id)) {
        const link = document.createElement('link');
        link.id = id; link.rel = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?family=${f.google}&display=swap`;
        document.head.appendChild(link);
      }
    });
    activeRef.current?.scrollIntoView({ block: 'nearest' });
    function handle(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    }
    window.addEventListener('mousedown', handle);
    return () => window.removeEventListener('mousedown', handle);
  }, [open]);

  function openDropdown() {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + window.scrollY + 2, left: r.left + window.scrollX, width: r.width });
    setOpen(true);
  }

  const selectedFont = CAROUSEL_FONTS.find(f => f.label === value) ?? CAROUSEL_FONTS[0];

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => open ? setOpen(false) : openDropdown()}
        className="w-full h-9 bg-zinc-950 border border-zinc-800 hover:border-zinc-600 rounded-md px-3 outline-none flex items-center justify-between transition-colors"
      >
        <span style={{ fontFamily: selectedFont.css, fontSize: 12, color: '#e4e4e7' }}>{value}</span>
        <svg width="9" height="6" viewBox="0 0 9 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#71717a', flexShrink: 0, marginLeft: 6 }}>
          <path d="M1 1l3.5 3.5L8 1"/>
        </svg>
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={listRef}
          style={{
            position: 'absolute',
            top: pos.top, left: pos.left, width: pos.width,
            zIndex: 9999,
            background: '#18181b',
            border: '1px solid #3f3f46',
            borderRadius: 6,
            overflowY: 'auto',
            maxHeight: 224,
            boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
          }}
        >
          {CAROUSEL_FONTS.map(f => {
            const isActive = f.label === value;
            return (
              <button
                key={f.label}
                ref={isActive ? activeRef : undefined}
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange(f.label); setOpen(false); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '7px 12px', fontSize: 13,
                  fontFamily: f.css,
                  color: isActive ? '#fff' : '#a1a1aa',
                  background: isActive ? '#27272a' : 'transparent',
                  cursor: 'pointer', border: 'none', outline: 'none',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = '#27272a';
                  (e.currentTarget as HTMLButtonElement).style.color = '#fff';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = isActive ? '#27272a' : 'transparent';
                  (e.currentTarget as HTMLButtonElement).style.color = isActive ? '#fff' : '#a1a1aa';
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}

function StyleRow({ italic, onItalic, allCaps, onAllCaps, align, onAlign }: {
  italic: boolean; onItalic: () => void; allCaps: boolean; onAllCaps: () => void;
  align: CarouselTextAlign; onAlign: (v: CarouselTextAlign) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {ALIGN_ICONS.map(({ value, icon }) => (
        <button key={value} onClick={() => onAlign(value)}
          className={`flex-1 flex items-center justify-center h-9 rounded-md transition-colors ${
            align === value ? 'bg-white text-black' : 'bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
          }`}>{icon}</button>
      ))}
      <button onClick={onItalic} className={`h-9 px-2.5 flex items-center rounded-md text-[11px] italic transition-colors ${
        italic ? 'bg-white text-black' : 'bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
      }`}>I</button>
      <button onClick={onAllCaps} className={`h-9 px-2.5 flex items-center rounded-md text-[11px] font-bold tracking-wider transition-colors ${
        allCaps ? 'bg-white text-black' : 'bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
      }`}>AA</button>
    </div>
  );
}

function TextSettingsBox({
  title, maxFontSize,
  fontSize, letterSpacing, lineSpacing, fontLabel, fontWeight, italic, allCaps, align,
  onChange,
}: {
  title: string; maxFontSize: number;
  fontSize: number; letterSpacing: number; lineSpacing: number;
  fontLabel: CarouselFontLabel; fontWeight: CarouselFontWeight;
  italic: boolean; allCaps: boolean; align: CarouselTextAlign;
  onChange: (p: Partial<CarouselSettings>) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-zinc-950 border border-zinc-800 p-3">
      <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">{title}</span>
      <Slider label="Size"           value={fontSize}       min={1}  max={maxFontSize} unit="px" onChange={v => onChange({ [title === 'Headline' ? 'fontSize' : 'subFontSize']: v })} />
      <Slider label="Letter spacing" value={letterSpacing}  onChange={v => onChange({ [title === 'Headline' ? 'lSpacing' : 'subLSpacing']: v })} />
      <Slider label="Line spacing"   value={lineSpacing}    onChange={v => onChange({ [title === 'Headline' ? 'lHeight'  : 'subLHeight']: v })} />
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-zinc-400">Font</span>
        <FontDropdown value={fontLabel} onChange={v => onChange({ [title === 'Headline' ? 'fontLabel' : 'subFontLabel']: v })} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-zinc-400">Weight</span>
        <div className="flex gap-1">
          {CAROUSEL_WEIGHTS.map(w => (
            <PillBtn key={w.value} active={fontWeight === w.value} onClick={() => onChange({ [title === 'Headline' ? 'fontWeight' : 'subFontWeight']: w.value })}>
              <span style={{ fontWeight: w.value }}>{w.label}</span>
            </PillBtn>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-zinc-400">Style</span>
        <StyleRow
          italic={italic}   onItalic={() => onChange({ [title === 'Headline' ? 'italic' : 'subItalic']: !italic })}
          allCaps={allCaps} onAllCaps={() => onChange({ [title === 'Headline' ? 'allCaps' : 'subAllCaps']: !allCaps })}
          align={align}     onAlign={v => onChange({ [title === 'Headline' ? 'textAlign' : 'subTextAlign']: v })}
        />
      </div>
    </div>
  );
}

// ── Tag UI helpers ────────────────────────────────────────────────────────────

const SLOT_LABELS = ['Top Left', 'Top Center', 'Top Right', 'Bottom Left', 'Bottom Center', 'Bottom Right'] as const;
const ZONE_LABELS = ['Top Left', 'Top Center', 'Top Right', 'Mid Left', 'Mid Center', 'Mid Right', 'Bottom Left', 'Bottom Center', 'Bottom Right'] as const;

function TagPillPreview({ ts, text }: { ts: TagStyle; text: string }) {
  const tc = ts.textCase ?? 'none';
  const displayText = tc === 'upper' ? text.toUpperCase() : text;
  return (
    <span style={{
      display: 'inline-block',
      backgroundColor: ts.bgOpacity > 0 ? `${ts.bgColor}${Math.round(ts.bgOpacity * 2.55).toString(16).padStart(2, '0')}` : 'transparent',
      border: ts.borderWidth > 0 ? `${ts.borderWidth}px solid ${ts.borderColor}${Math.round(ts.borderOpacity * 2.55).toString(16).padStart(2, '0')}` : 'none',
      borderRadius: ts.cornerRadius,
      padding: `${ts.paddingY}px ${ts.paddingX}px`,
      color: ts.textColor,
      fontSize: ts.fontSize,
      fontWeight: ts.fontWeight,
      fontStyle: ts.italic ? 'italic' : 'normal',
      fontVariant: tc === 'smallcaps' ? 'small-caps' : 'normal',
      letterSpacing: ts.letterSpacing ? `${ts.letterSpacing}px` : undefined,
      lineHeight: 1.2,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      maxWidth: '100%',
    }}>{displayText}</span>
  );
}

function TagStyleControls({ ts, onChange }: { ts: TagStyle; onChange: (ts: TagStyle) => void }) {
  return (
    <div className="flex flex-col gap-2 pt-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-zinc-400">BG Color</span>
        <input type="color" value={ts.bgColor} onChange={e => onChange({ ...ts, bgColor: e.target.value })}
          className="w-7 h-7 cursor-pointer rounded border-0 bg-transparent p-0" />
      </div>
      <Slider label="BG Opacity"     value={ts.bgOpacity}     onChange={v => onChange({ ...ts, bgOpacity: v })} />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-zinc-400">Border Color</span>
        <input type="color" value={ts.borderColor} onChange={e => onChange({ ...ts, borderColor: e.target.value })}
          className="w-7 h-7 cursor-pointer rounded border-0 bg-transparent p-0" />
      </div>
      <Slider label="Border Width"   value={ts.borderWidth}   min={0} max={8}  unit="px" onChange={v => onChange({ ...ts, borderWidth: v })} />
      <Slider label="Border Opacity" value={ts.borderOpacity}                  onChange={v => onChange({ ...ts, borderOpacity: v })} />
      <Slider label="Corner Radius"  value={ts.cornerRadius}  min={0} max={40} unit="px" onChange={v => onChange({ ...ts, cornerRadius: v })} />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-zinc-400">Text Color</span>
        <input type="color" value={ts.textColor} onChange={e => onChange({ ...ts, textColor: e.target.value })}
          className="w-7 h-7 cursor-pointer rounded border-0 bg-transparent p-0" />
      </div>
      <Slider label="Font Size"      value={ts.fontSize}      min={8}  max={36} unit="px" onChange={v => onChange({ ...ts, fontSize: v })} />
      <Slider label="Letter Spacing" value={ts.letterSpacing ?? 0} min={0} max={20} unit="px" onChange={v => onChange({ ...ts, letterSpacing: v })} />
      <div className="flex flex-wrap gap-1">
        {CAROUSEL_WEIGHTS.map(w => (
          <PillBtn key={w.value} active={ts.fontWeight === w.value} onClick={() => onChange({ ...ts, fontWeight: w.value })}>
            <span style={{ fontWeight: w.value }}>{w.label}</span>
          </PillBtn>
        ))}
      </div>
      <div className="flex gap-1.5">
        <PillBtn active={ts.italic} onClick={() => onChange({ ...ts, italic: !ts.italic })}>
          <span className="italic">I</span>
        </PillBtn>
        <PillBtn active={(ts.textCase ?? 'none') === 'upper'}     onClick={() => onChange({ ...ts, textCase: ts.textCase === 'upper'    ? 'none' : 'upper' })}>
          <span className="text-[10px] font-bold tracking-wide">AA</span>
        </PillBtn>
        <PillBtn active={(ts.textCase ?? 'none') === 'smallcaps'} onClick={() => onChange({ ...ts, textCase: ts.textCase === 'smallcaps' ? 'none' : 'smallcaps' })}>
          <span style={{ fontVariant: 'small-caps', fontSize: 11 }}>Aa</span>
        </PillBtn>
      </div>
      <FontDropdown value={ts.fontLabel} onChange={v => onChange({ ...ts, fontLabel: v })} />
      <Slider label="Pad X" value={ts.paddingX} min={0} max={32} unit="px" onChange={v => onChange({ ...ts, paddingX: v })} />
      <Slider label="Pad Y" value={ts.paddingY} min={0} max={20} unit="px" onChange={v => onChange({ ...ts, paddingY: v })} />
      <ShadowEditor value={ts.shadow} onChange={v => onChange({ ...ts, shadow: v })} />
    </div>
  );
}

function ShadowEditor({ value, onChange }: { value?: ShadowStyle; onChange: (s: ShadowStyle) => void }) {
  const s = { ...defaultShadowStyle(), ...value };
  return (
    <div className="flex flex-col gap-2 pt-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-zinc-400">Shadow</span>
        <button
          onClick={() => onChange({ ...s, enabled: !s.enabled })}
          className={`px-2 h-6 rounded text-[10px] transition-colors ${
            s.enabled ? 'bg-white text-black' : 'bg-zinc-900 border border-zinc-700 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          {s.enabled ? 'On' : 'Off'}
        </button>
      </div>
      {s.enabled && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-zinc-400">Shadow Color</span>
            <input type="color" value={s.color} onChange={e => onChange({ ...s, color: e.target.value })}
              className="w-7 h-7 cursor-pointer rounded border-0 bg-transparent p-0" />
          </div>
          <Slider label="Blur"     value={s.blur}    min={0}   max={80}  unit="px" onChange={v => onChange({ ...s, blur: v })} />
          <Slider label="Offset X" value={s.offsetX} min={-60} max={60}  unit="px" onChange={v => onChange({ ...s, offsetX: v })} />
          <Slider label="Offset Y" value={s.offsetY} min={-60} max={60}  unit="px" onChange={v => onChange({ ...s, offsetY: v })} />
          <Slider label="Opacity"  value={s.opacity} min={0}   max={100}            onChange={v => onChange({ ...s, opacity: v })} />
        </>
      )}
      <Slider label="Lift" value={s.lift} min={-200} max={400} unit="px" onChange={v => onChange({ ...s, lift: v })} />
    </div>
  );
}

function TagSlotEditor({
  idx, tagSlot, onChange, onRemove, label,
}: {
  idx: number;
  tagSlot: { text: string; style: TagStyle };
  onChange: (slot: { text: string; style: TagStyle }) => void;
  onRemove: () => void;
  label?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-zinc-950 border border-zinc-800 p-2">
      {/* Header row: label + preview + expand + remove */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-zinc-500 shrink-0 w-16">{label ?? SLOT_LABELS[idx]}</span>
        <div className="flex-1 overflow-hidden min-w-0">
          <TagPillPreview ts={tagSlot.style} text={tagSlot.text} />
        </div>
        <button
          onClick={() => setExpanded(e => !e)}
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
          title={expanded ? 'Collapse' : 'Edit style'}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            {expanded
              ? <polyline points="18 15 12 9 6 15"/>
              : <polyline points="6 9 12 15 18 9"/>}
          </svg>
        </button>
        <button
          onClick={onRemove}
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-zinc-600 hover:text-red-400 hover:bg-zinc-800 transition-colors"
          title="Remove tag"
        >
          <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M1 1l10 10M11 1L1 11"/>
          </svg>
        </button>
      </div>
      {expanded && (
        <>
          {/* Editable text */}
          <input
            type="text"
            value={tagSlot.text}
            onChange={e => onChange({ ...tagSlot, text: e.target.value })}
            placeholder="Tag text…"
            className="w-full bg-zinc-950 border border-zinc-700 focus:border-zinc-500 rounded px-2 py-1 text-xs text-white outline-none"
          />
          <TagStyleControls
            ts={tagSlot.style}
            onChange={newStyle => onChange({ ...tagSlot, style: newStyle })}
          />
        </>
      )}
    </div>
  );
}

// ── Divider settings ──────────────────────────────────────────────────────────

const DIVIDER_TYPE_LABEL: Record<string, string> = {
  solid: 'Solid', thick: 'Thick', dashed: 'Dashed', dotted: 'Dotted',
  double: 'Double', 'double-fade': 'Double Fade', triple: 'Triple',
  'dot-center': 'Dot Center', 'dots-row': 'Dots Row', 'diamond-center': 'Diamond',
  'dashed-fade': 'Dashed Fade', 'taper-dashed': 'Taper Dash',
  fade: 'Fade', 'fade-left': 'Fade Left',
  taper: 'Taper', 'thick-taper': 'Thick Taper', 'short-center': 'Short Center',
  wave: 'Wave', brackets: 'Brackets',
  'tag-center': 'Tag Center', 'tag-center-fade': 'Tag Center Fade',
  'tag-double': 'Tag Double', 'tag-short': 'Tag Short',
  'tag-left': 'Tag Left', 'tag-left-fade': 'Tag Left Fade', 'tag-right': 'Tag Right',
  'tag-logo': 'Tag + Logo',
  'logo-center': 'Logo Center', 'logo-center-fade': 'Logo Center Fade',
  'logo-left': 'Logo Left', 'logo-left-fade': 'Logo Left Fade', 'logo-right': 'Logo Right',
};

type DivField = 'lineColor' | 'lineOpacity' | 'lineWeight' | 'dashLen' | 'dashGap' |
  'dotSize' | 'dotSpacing' | 'doubleSpacing' | 'tripleSpacing' | 'centerWeight' |
  'dotRadius' | 'dotGap' | 'taperHeight' | 'shortLength' | 'waveAmplitude' |
  'bracketWidth' | 'bracketMargin' | 'contentGap' | 'fadeSpread';

const DIVIDER_FIELDS: Record<string, DivField[]> = {
  solid:             ['lineColor', 'lineOpacity', 'lineWeight'],
  thick:             ['lineColor', 'lineOpacity', 'lineWeight'],
  dashed:            ['lineColor', 'lineOpacity', 'lineWeight', 'dashLen', 'dashGap'],
  dotted:            ['lineColor', 'lineOpacity', 'dotSize', 'dotSpacing'],
  double:            ['lineColor', 'lineOpacity', 'lineWeight', 'doubleSpacing'],
  'double-fade':     ['lineColor', 'lineOpacity', 'lineWeight', 'doubleSpacing', 'fadeSpread'],
  triple:            ['lineColor', 'lineOpacity', 'lineWeight', 'centerWeight', 'tripleSpacing'],
  'dot-center':      ['lineColor', 'lineOpacity', 'lineWeight', 'dotRadius', 'dotGap'],
  'dashed-fade':     ['lineColor', 'lineOpacity', 'lineWeight', 'dashLen', 'dashGap', 'fadeSpread'],
  'taper-dashed':    ['lineColor', 'lineOpacity', 'lineWeight', 'dashLen', 'dashGap', 'fadeSpread'],
  'dots-row':        ['lineColor', 'lineOpacity', 'dotRadius', 'dotSpacing'],
  'diamond-center':  ['lineColor', 'lineOpacity', 'lineWeight', 'dotRadius', 'dotGap'],
  fade:              ['lineColor', 'lineOpacity', 'lineWeight', 'fadeSpread'],
  'fade-left':       ['lineColor', 'lineOpacity', 'lineWeight', 'fadeSpread'],
  taper:             ['lineColor', 'lineOpacity', 'taperHeight'],
  'thick-taper':     ['lineColor', 'lineOpacity', 'taperHeight'],
  'short-center':    ['lineColor', 'lineOpacity', 'lineWeight', 'shortLength'],
  wave:              ['lineColor', 'lineOpacity', 'lineWeight', 'waveAmplitude'],
  brackets:          ['lineColor', 'lineOpacity', 'lineWeight', 'bracketWidth', 'bracketMargin'],
  'tag-center':      ['lineColor', 'lineOpacity', 'lineWeight', 'contentGap'],
  'tag-center-fade': ['lineColor', 'lineOpacity', 'lineWeight', 'contentGap', 'fadeSpread'],
  'tag-double':      ['lineColor', 'lineOpacity', 'lineWeight', 'doubleSpacing', 'contentGap'],
  'tag-short':       ['lineColor', 'lineOpacity', 'lineWeight', 'contentGap'],
  'tag-left':        ['lineColor', 'lineOpacity', 'lineWeight', 'contentGap'],
  'tag-left-fade':   ['lineColor', 'lineOpacity', 'lineWeight', 'contentGap', 'fadeSpread'],
  'tag-right':       ['lineColor', 'lineOpacity', 'lineWeight', 'contentGap'],
  'tag-logo':        ['lineColor', 'lineOpacity', 'lineWeight', 'contentGap'],
  'logo-center':     ['lineColor', 'lineOpacity', 'lineWeight', 'contentGap'],
  'logo-center-fade':['lineColor', 'lineOpacity', 'lineWeight', 'contentGap', 'fadeSpread'],
  'logo-left':       ['lineColor', 'lineOpacity', 'lineWeight', 'contentGap'],
  'logo-left-fade':  ['lineColor', 'lineOpacity', 'lineWeight', 'contentGap', 'fadeSpread'],
  'logo-right':      ['lineColor', 'lineOpacity', 'lineWeight', 'contentGap'],
};

const SLOT_NAMES_3 = ['Top', 'Center', 'Bottom'] as const;

function DividerSlotEditor({
  idx, divId, ds, onChange, onRemove, subSlot, onSubChange,
}: {
  idx: number;
  divId: string;
  ds: Partial<DividerStyleSettings> | null;
  onChange: (ds: Partial<DividerStyleSettings>) => void;
  onRemove: () => void;
  subSlot?: DividerSubSlotContent | null;
  onSubChange?: (c: DividerSubSlotContent | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (subSlot) setExpanded(true); }, [subSlot]);
  const resolved: DividerStyleSettings = { ...defaultDividerSettings(divId), ...(ds ?? {}) };
  const fields = DIVIDER_FIELDS[divId] ?? ['lineColor', 'lineOpacity', 'lineWeight'];

  function upd(patch: Partial<DividerStyleSettings>) {
    onChange({ ...(ds ?? {}), ...patch });
  }

  const has = (f: DivField) => fields.includes(f);

  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-zinc-950 border border-zinc-800 p-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-zinc-500 shrink-0 w-12">{SLOT_NAMES_3[idx] ?? `#${idx + 1}`}</span>
        <span className="flex-1 text-[11px] text-zinc-300 font-medium truncate">{DIVIDER_TYPE_LABEL[divId] ?? divId}</span>
        <button
          onClick={() => setExpanded(e => !e)}
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            {expanded ? <polyline points="18 15 12 9 6 15"/> : <polyline points="6 9 12 15 18 9"/>}
          </svg>
        </button>
        <button
          onClick={onRemove}
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-zinc-600 hover:text-red-400 hover:bg-zinc-800 transition-colors"
        >
          <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M1 1l10 10M11 1L1 11"/>
          </svg>
        </button>
      </div>
      {expanded && (
        <div className="flex flex-col gap-2 pt-1">
          {has('lineColor') && (
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400">Color</span>
              <input type="color" value={resolved.lineColor}
                onChange={e => upd({ lineColor: e.target.value })}
                className="w-7 h-7 cursor-pointer rounded border-0 bg-transparent p-0" />
            </div>
          )}
          {has('lineOpacity') && (
            <Slider label="Opacity" value={resolved.lineOpacity} onChange={v => upd({ lineOpacity: v })} />
          )}
          {has('lineWeight') && (
            <Slider label="Line Weight" value={resolved.lineWeight} min={1} max={20} unit="px" onChange={v => upd({ lineWeight: v })} />
          )}
          {has('dashLen') && (
            <Slider label="Dash Length" value={resolved.dashLen} min={4} max={120} unit="px" onChange={v => upd({ dashLen: v })} />
          )}
          {has('dashGap') && (
            <Slider label="Dash Gap" value={resolved.dashGap} min={4} max={120} unit="px" onChange={v => upd({ dashGap: v })} />
          )}
          {has('dotSize') && (
            <Slider label="Dot Size" value={resolved.dotSize} min={1} max={20} unit="px" onChange={v => upd({ dotSize: v })} />
          )}
          {has('dotSpacing') && (
            <Slider label="Dot Spacing" value={resolved.dotSpacing} min={4} max={80} unit="px" onChange={v => upd({ dotSpacing: v })} />
          )}
          {has('doubleSpacing') && (
            <Slider label="Line Offset" value={resolved.doubleSpacing} min={2} max={40} unit="px" onChange={v => upd({ doubleSpacing: v })} />
          )}
          {has('tripleSpacing') && (
            <Slider label="Outer Offset" value={resolved.tripleSpacing} min={2} max={40} unit="px" onChange={v => upd({ tripleSpacing: v })} />
          )}
          {has('centerWeight') && (
            <Slider label="Center Weight" value={resolved.centerWeight} min={1} max={20} unit="px" onChange={v => upd({ centerWeight: v })} />
          )}
          {has('dotRadius') && (
            <Slider label="Dot Radius" value={resolved.dotRadius} min={2} max={30} unit="px" onChange={v => upd({ dotRadius: v })} />
          )}
          {has('dotGap') && (
            <Slider label="Dot Gap" value={resolved.dotGap} min={0} max={80} unit="px" onChange={v => upd({ dotGap: v })} />
          )}
          {has('taperHeight') && (
            <Slider label="Taper Height" value={resolved.taperHeight} min={5} max={60} unit="%" onChange={v => upd({ taperHeight: v })} />
          )}
          {has('shortLength') && (
            <Slider label="Line Length" value={resolved.shortLength} min={10} max={90} unit="%" onChange={v => upd({ shortLength: v })} />
          )}
          {has('waveAmplitude') && (
            <Slider label="Amplitude" value={resolved.waveAmplitude} min={2} max={50} unit="%" onChange={v => upd({ waveAmplitude: v })} />
          )}
          {has('bracketWidth') && (
            <Slider label="Bracket Width" value={resolved.bracketWidth} min={5} max={80} unit="px" onChange={v => upd({ bracketWidth: v })} />
          )}
          {has('bracketMargin') && (
            <Slider label="Side Margin" value={resolved.bracketMargin} min={0} max={120} unit="px" onChange={v => upd({ bracketMargin: v })} />
          )}
          {has('contentGap') && (
            <Slider label="Content Gap" value={resolved.contentGap} min={0} max={80} unit="px" onChange={v => upd({ contentGap: v })} />
          )}
          {has('fadeSpread') && (
            <Slider
              label="Fade Spread"
              value={resolved.fadeSpread}
              min={0}
              max={['fade-left', 'logo-left-fade', 'tag-left-fade'].includes(divId) ? 100 : 50}
              unit="%"
              onChange={v => upd({ fadeSpread: v })}
            />
          )}
          <ShadowEditor
            value={(ds as Partial<DividerStyleSettings> & { shadow?: ShadowStyle } | null)?.shadow}
            onChange={v => onChange({ ...(ds ?? {}), shadow: v })}
          />
          {subSlot?.type === 'tag' && onSubChange && (
            <div className="flex flex-col gap-2 pt-2 border-t border-zinc-800">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Box Tag</span>
                <button onClick={() => onSubChange(null)} className="text-[10px] text-zinc-600 hover:text-red-400 transition-colors">Remove</button>
              </div>
              <TagPillPreview ts={subSlot.style} text={subSlot.text} />
              <input
                type="text"
                value={subSlot.text}
                onChange={e => onSubChange({ ...subSlot, text: e.target.value })}
                placeholder="Tag text…"
                className="w-full bg-zinc-950 border border-zinc-700 focus:border-zinc-500 rounded px-2 py-1 text-xs text-white outline-none"
              />
              <TagStyleControls ts={subSlot.style} onChange={ts => onSubChange({ ...subSlot, style: ts })} />
            </div>
          )}
          {subSlot?.type === 'swipe' && onSubChange && (
            <div className="flex flex-col gap-2 pt-2 border-t border-zinc-800">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Box Swipe</span>
                <button onClick={() => onSubChange(null)} className="text-[10px] text-zinc-600 hover:text-red-400 transition-colors">Remove</button>
              </div>
              <SwipePreviewMini style={subSlot.style} />
              <SwipeStyleControls style={subSlot.style} onChange={s => onSubChange({ ...subSlot, style: s })} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── LayersPanel ──────────────────────────────────────────────────────────────

const LAYER_META: Record<LayerId, { label: string; icon: ReactNode }> = {
  background: {
    label: 'BG Blur',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <path d="M21 15l-5-5L5 21"/>
      </svg>
    ),
  },
  circle: {
    label: 'Circle 1',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="12" r="9"/>
        <text x="12" y="16" textAnchor="middle" fontSize="8" fontWeight="700" fill="currentColor" stroke="none">1</text>
      </svg>
    ),
  },
  circle2: {
    label: 'Circle 2',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="12" r="9"/>
        <text x="12" y="16" textAnchor="middle" fontSize="8" fontWeight="700" fill="currentColor" stroke="none">2</text>
      </svg>
    ),
  },
  subject: {
    label: 'Subject',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
    ),
  },
};

const LAYER_COLORS: Record<LayerId, string> = {
  background: '#3b82f6',
  circle:     '#a855f7',
  circle2:    '#c084fc',
  subject:    '#22c55e',
};

export function LayersPanel({ layers, onChange }: {
  layers: LayerId[];
  onChange: (layers: LayerId[]) => void;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  // Display reversed: top of list = visually on top (last drawn)
  const displayOrder = [...layers].reverse();

  return (
    <div
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'absolute',
        right: '100%',
        top: 0,
        marginRight: 24,
        width: 'max-content',
        background: '#09090b',
        border: '1px solid #27272a',
        borderRadius: 8,
        padding: '8px 6px',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        zIndex: 20,
        backdropFilter: 'blur(8px)',
      }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center', paddingBottom: 5, borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 2 }}>
        Layers
      </div>
      {displayOrder.map((layer) => {
        const realIdx  = layers.indexOf(layer);
        const isDragging = dragIdx === realIdx;
        const isOver   = overIdx === realIdx;
        return (
          <div
            key={layer}
            draggable
            onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragIdx(realIdx); }}
            onDragOver={e => { e.preventDefault(); setOverIdx(realIdx); }}
            onDrop={e => {
              e.preventDefault();
              if (dragIdx === null || dragIdx === realIdx) { setDragIdx(null); setOverIdx(null); return; }
              const next = [...layers];
              const [removed] = next.splice(dragIdx, 1);
              next.splice(realIdx, 0, removed);
              onChange(next);
              setDragIdx(null); setOverIdx(null);
            }}
            onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              height: 36,
              padding: '0 8px',
              borderRadius: 6,
              border: `1px solid ${isOver ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.05)'}`,
              background: isOver ? 'rgba(255,255,255,0.07)' : isDragging ? 'rgba(255,255,255,0.02)' : 'transparent',
              cursor: 'grab',
              userSelect: 'none',
              opacity: isDragging ? 0.4 : 1,
              transition: 'background 0.1s, border-color 0.1s, opacity 0.1s',
            }}
          >
            {/* Grip dots */}
            <svg width="7" height="11" viewBox="0 0 7 11" fill="rgba(255,255,255,0.22)" style={{ flexShrink: 0 }}>
              <circle cx="1.5" cy="1.5" r="1.2"/><circle cx="5.5" cy="1.5" r="1.2"/>
              <circle cx="1.5" cy="5.5" r="1.2"/><circle cx="5.5" cy="5.5" r="1.2"/>
              <circle cx="1.5" cy="9.5" r="1.2"/><circle cx="5.5" cy="9.5" r="1.2"/>
            </svg>
            {/* Icon + label inline */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
              <div style={{ color: 'rgba(255,255,255,0.6)', flexShrink: 0 }}>
                {LAYER_META[layer].icon}
              </div>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '0.02em' }}>
                {LAYER_META[layer].label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── SwipeZoneEditor ──────────────────────────────────────────────────────────

const SWIPE_ARROW_TYPES: { value: SwipeArrowType; label: string }[] = [
  { value: 'line',          label: 'Line' },
  { value: 'triangle',      label: 'Triangle' },
  { value: 'chevron',       label: 'Chevron' },
  { value: 'double-chevron',label: '>>' },
  { value: 'curved',        label: 'Curved' },
];

const SWIPE_LAYOUTS: { value: SwipeLayout; label: string }[] = [
  { value: 'text-arrow', label: 'Text → Arrow' },
  { value: 'arrow-text', label: 'Arrow ← Text' },
  { value: 'stacked',    label: 'Stacked' },
  { value: 'arrow-only', label: 'Arrow only' },
  { value: 'text-only',  label: 'Text only' },
];

const ZONE_LABELS_9 = [
  'Top-L','Top-C','Top-R',
  'Mid-L','Mid-C','Mid-R',
  'Bot-L','Bot-C','Bot-R',
];

function SwipeStyleControls({ style, onChange }: { style: SwipeStyle; onChange: (s: SwipeStyle) => void }) {
  function upd(patch: Partial<SwipeStyle>) { onChange({ ...style, ...patch }); }
  return (
    <div className="flex flex-col gap-2 pt-1">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-zinc-400">Text</span>
        <input type="text" value={style.text} onChange={e => upd({ text: e.target.value })}
          className="w-full bg-zinc-950 border border-zinc-700 text-white text-xs rounded px-2 py-1 outline-none focus:border-zinc-500" />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-zinc-400">All Caps</span>
        <PillBtn compact active={style.allCaps} onClick={() => upd({ allCaps: !style.allCaps })}>
          {style.allCaps ? 'On' : 'Off'}
        </PillBtn>
      </div>
      <FontDropdown value={style.fontLabel} onChange={v => upd({ fontLabel: v })} />
      <div className="flex gap-1 flex-wrap">
        {CAROUSEL_WEIGHTS.map(w => (
          <PillBtn key={w.value} active={style.fontWeight === w.value} onClick={() => upd({ fontWeight: w.value })}>
            <span style={{ fontWeight: w.value }}>{w.label}</span>
          </PillBtn>
        ))}
      </div>
      <Slider label="Font Size" value={style.fontSize} min={8} max={80} unit="px" onChange={v => upd({ fontSize: v })} />
      <Slider label="Letter Spacing" value={style.letterSpacing} min={0} max={20} unit="px" onChange={v => upd({ letterSpacing: v })} />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-zinc-400">Text Color</span>
        <input type="color" value={style.textColor} onChange={e => upd({ textColor: e.target.value })}
          className="w-7 h-7 cursor-pointer rounded border-0 bg-transparent p-0" />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-zinc-400">Arrow Type</span>
        <div className="flex gap-1 flex-wrap">
          {SWIPE_ARROW_TYPES.map(at => (
            <PillBtn key={at.value} active={style.arrowType === at.value} onClick={() => upd({ arrowType: at.value })}>
              {at.label}
            </PillBtn>
          ))}
        </div>
      </div>
      {style.arrowType !== 'chevron' && style.arrowType !== 'double-chevron' && (
        <Slider label="Arrow Length" value={style.arrowLength} min={0} max={200} unit="px" onChange={v => upd({ arrowLength: v })} />
      )}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-zinc-400">Arrow Color</span>
        <input type="color" value={style.arrowColor} onChange={e => upd({ arrowColor: e.target.value })}
          className="w-7 h-7 cursor-pointer rounded border-0 bg-transparent p-0" />
      </div>
      <Slider label="Arrow Weight" value={style.arrowWeight} min={0.5} max={10} unit="px" onChange={v => upd({ arrowWeight: v })} />
      <Slider label="Head Size" value={style.arrowHeadSize} min={2} max={40} unit="px" onChange={v => upd({ arrowHeadSize: v })} />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-zinc-400">Direction</span>
        <div className="flex gap-1">
          <PillBtn active={style.direction === 'left'} onClick={() => upd({ direction: 'left' })}>← Left</PillBtn>
          <PillBtn active={style.direction === 'right'} onClick={() => upd({ direction: 'right' })}>Right →</PillBtn>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-zinc-400">Layout</span>
        <div className="flex gap-1 flex-wrap">
          {SWIPE_LAYOUTS.map(l => (
            <PillBtn key={l.value} active={style.layout === l.value} onClick={() => upd({ layout: l.value })}>
              {l.label}
            </PillBtn>
          ))}
        </div>
      </div>
      <Slider label="Gap" value={style.gap} min={0} max={60} unit="px" onChange={v => upd({ gap: v })} />
      <Slider label="Opacity" value={style.opacity} min={0} max={100} onChange={v => upd({ opacity: v })} />
      <ShadowEditor value={style.shadow} onChange={v => upd({ shadow: v })} />
    </div>
  );
}

function SwipeZoneEditor({
  fi, style, onChange, onRemove,
}: {
  fi: number;
  style: SwipeStyle;
  onChange: (s: SwipeStyle) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-zinc-950 border border-zinc-800 p-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-zinc-500 shrink-0 w-12">{ZONE_LABELS_9[fi] ?? `#${fi}`}</span>
        <div className="flex-1 min-w-0" style={{ overflow: 'visible' }}>
          <SwipePreviewMini style={style} />
        </div>
        <button
          onClick={() => setExpanded(e => !e)}
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            {expanded ? <polyline points="18 15 12 9 6 15"/> : <polyline points="6 9 12 15 18 9"/>}
          </svg>
        </button>
        <button
          onClick={onRemove}
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-zinc-600 hover:text-red-400 hover:bg-zinc-800 transition-colors"
        >
          <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M1 1l10 10M11 1L1 11"/>
          </svg>
        </button>
      </div>
      {expanded && <SwipeStyleControls style={style} onChange={onChange} />}
    </div>
  );
}

// ── CarouselSettingsPanel (right column) ─────────────────────────────────────

function CollapsibleSection({ title, children, defaultOpen }: {
  title: string; children: ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="rounded-lg bg-zinc-950 border border-zinc-800">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left"
      >
        <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">{title}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-zinc-600 transition-transform ${open ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 220ms ease' }}>
        <div style={{ overflow: 'hidden' }}>
          <div className="px-3 pb-3 flex flex-col gap-2.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function CarouselSettingsPanel({ settings, onChange, videoMode }: CarouselSettingsPanelProps) {
  const s = settings;

  return (
    <div className="flex flex-col h-full bg-transparent">

      {/* Scrollable sections */}
      <div className="flex-1 overflow-y-auto min-h-0">
      <div className="flex flex-col gap-3 px-3 pt-3 pb-3">

      {/* Logo */}
      <CollapsibleSection title="Logo" defaultOpen>
        <Slider label="Opacity"        value={s.logoOpacity ?? 100}      onChange={v => onChange({ logoOpacity: v })} />
        <Slider label="Scale"          value={s.logoScale ?? 100}  min={10} max={200} unit="%" onChange={v => onChange({ logoScale: v })} />
        <Slider label="Corner Radius"  value={s.logoCornerRadius ?? 0} min={0} max={200} unit="px" onChange={v => onChange({ logoCornerRadius: v })} />
        <ShadowEditor value={s.logoShadow} onChange={v => onChange({ logoShadow: v })} />
      </CollapsibleSection>

      {/* Layout */}
      <CollapsibleSection title="Layout" defaultOpen={false}>
        <Slider label="Head / Sub Gap" value={s.headSubGap}     min={0} max={100} onChange={v => onChange({ headSubGap: v })} />
        <Slider label="Heading top padding" value={s.aboveLogoGap} min={0} max={50} unit="px" onChange={v => onChange({ aboveLogoGap: v })} />
        <Slider label="Content padding" value={s.contentPadding} min={0} max={100} onChange={v => onChange({ contentPadding: v })} />
      </CollapsibleSection>

      {/* Fade */}
      <CollapsibleSection title="Fade">
        {/* Bottom fade */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-zinc-400">Bottom fade</span>
            <PillBtn compact active={s.showFade} onClick={() => onChange({ showFade: !s.showFade })}>
              {s.showFade ? 'On' : 'Off'}
            </PillBtn>
          </div>
          {s.showFade && (
            <>
              <Slider label="Floor"     value={s.fadeFloor}     onChange={v => onChange({ fadeFloor: v })} />
              <Slider label="Reach"     value={s.fadeReach}     onChange={v => onChange({ fadeReach: v })} />
              <Slider label="Intensity" value={s.fadeIntensity} onChange={v => onChange({ fadeIntensity: v })} />
            </>
          )}
        </div>

        <div className="h-px bg-zinc-800 my-1" />

        {/* Top fade */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-zinc-400">Top fade</span>
            <PillBtn compact active={s.showTopFade} onClick={() => onChange({ showTopFade: !s.showTopFade })}>
              {s.showTopFade ? 'On' : 'Off'}
            </PillBtn>
          </div>
          {s.showTopFade && (
            <>
              <Slider label="Floor"     value={s.topFadeFloor     ?? 20} onChange={v => onChange({ topFadeFloor: v })} />
              <Slider label="Reach"     value={s.topFadeReach     ?? 40} onChange={v => onChange({ topFadeReach: v })} />
              <Slider label="Intensity" value={s.topFadeIntensity ?? 85} onChange={v => onChange({ topFadeIntensity: v })} />
            </>
          )}
        </div>
      </CollapsibleSection>

      {/* Background — hidden in video mode */}
      {!videoMode && (
        <CollapsibleSection title="Background" defaultOpen={false}>
          <Slider label="Darken" value={s.bgDarkenAmount} min={0} max={100} onChange={v => onChange({ bgDarkenAmount: v })} />
          {s.bgBlurEnabled && (
            <Slider label="Blur Amount" value={s.bgBlurAmount} min={1} max={30} unit="px" onChange={v => onChange({ bgBlurAmount: v })} />
          )}
        </CollapsibleSection>
      )}

      {/* Headline */}
      <CollapsibleSection title="Headline" defaultOpen={false}>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-500">Color</span>
          <input
            type="color"
            value={s.headlineColor ?? '#ffffff'}
            onChange={e => onChange({ headlineColor: e.target.value })}
            className="w-7 h-7 rounded cursor-pointer border border-zinc-700 bg-transparent"
          />
        </div>
        <Slider label="Size"   value={s.fontSize}  min={1} max={MAX_FONT} unit="px" onChange={v => onChange({ fontSize: v })} />
        <Slider label="Letter spacing" value={s.lSpacing}  onChange={v => onChange({ lSpacing: v })} />
        <Slider label="Line spacing"   value={s.lHeight}   onChange={v => onChange({ lHeight: v })} />
        <FontDropdown value={s.fontLabel} onChange={v => onChange({ fontLabel: v })} />
        <div className="flex gap-1">
          {CAROUSEL_WEIGHTS.map(w => (
            <PillBtn key={w.value} active={s.fontWeight === w.value} onClick={() => onChange({ fontWeight: w.value })}>
              <span style={{ fontWeight: w.value }}>{w.label}</span>
            </PillBtn>
          ))}
        </div>
        <StyleRow
          italic={s.italic}   onItalic={() => onChange({ italic: !s.italic })}
          allCaps={s.allCaps} onAllCaps={() => onChange({ allCaps: !s.allCaps })}
          align={s.textAlign} onAlign={v => onChange({ textAlign: v })}
        />
        {s.headlineSpans && s.headlineSpans.length > 0 && (
          <button
            onClick={() => onChange({ headlineSpans: null })}
            className="w-full text-left text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors py-0.5"
          >
            ✕ Clear custom text styles
          </button>
        )}
        <ShadowEditor value={s.headlineShadow} onChange={v => onChange({ headlineShadow: v })} />
      </CollapsibleSection>

      {/* Sub-headline */}
      <CollapsibleSection title="Sub-headline" defaultOpen={false}>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-500">Color</span>
          <input
            type="color"
            value={s.subheadlineColor ?? '#ffffff'}
            onChange={e => onChange({ subheadlineColor: e.target.value })}
            className="w-7 h-7 rounded cursor-pointer border border-zinc-700 bg-transparent"
          />
        </div>
        <Slider label="Size"   value={s.subFontSize}  min={1} max={SUB_MAX} unit="px" onChange={v => onChange({ subFontSize: v })} />
        <Slider label="Letter spacing" value={s.subLSpacing}  onChange={v => onChange({ subLSpacing: v })} />
        <Slider label="Line spacing"   value={s.subLHeight}   onChange={v => onChange({ subLHeight: v })} />
        <FontDropdown value={s.subFontLabel} onChange={v => onChange({ subFontLabel: v })} />
        <div className="flex gap-1">
          {CAROUSEL_WEIGHTS.map(w => (
            <PillBtn key={w.value} active={s.subFontWeight === w.value} onClick={() => onChange({ subFontWeight: w.value })}>
              <span style={{ fontWeight: w.value }}>{w.label}</span>
            </PillBtn>
          ))}
        </div>
        <StyleRow
          italic={s.subItalic}   onItalic={() => onChange({ subItalic: !s.subItalic })}
          allCaps={s.subAllCaps} onAllCaps={() => onChange({ subAllCaps: !s.subAllCaps })}
          align={s.subTextAlign} onAlign={v => onChange({ subTextAlign: v })}
        />
        {s.subSpans && s.subSpans.length > 0 && (
          <button
            onClick={() => onChange({ subSpans: null })}
            className="w-full text-left text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors py-0.5"
          >
            ✕ Clear custom text styles
          </button>
        )}
        <ShadowEditor value={s.subShadow} onChange={v => onChange({ subShadow: v })} />
      </CollapsibleSection>

      {/* Circle + Circle 2 — hidden in video mode */}
      {!videoMode && <CollapsibleSection title="Circle" defaultOpen={false}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-zinc-400">Border Color</span>
          <input type="color" value={s.circleBorderColor}
            onChange={e => onChange({ circleBorderColor: e.target.value })}
            className="w-7 h-7 cursor-pointer rounded border-0 bg-transparent p-0" />
        </div>
        <Slider label="Border Width"   value={s.circleBorderWidth}   min={0} max={30} unit="px" onChange={v => onChange({ circleBorderWidth: v })} />
        <Slider label="Border Opacity" value={s.circleBorderOpacity}                           onChange={v => onChange({ circleBorderOpacity: v })} />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-zinc-400">Drop Shadow</span>
          <PillBtn compact active={s.circleShadowEnabled} onClick={() => onChange({ circleShadowEnabled: !s.circleShadowEnabled })}>
            {s.circleShadowEnabled ? 'On' : 'Off'}
          </PillBtn>
        </div>
        {s.circleShadowEnabled && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400">Shadow Color</span>
              <input type="color" value={s.circleShadowColor}
                onChange={e => onChange({ circleShadowColor: e.target.value })}
                className="w-7 h-7 cursor-pointer rounded border-0 bg-transparent p-0" />
            </div>
            <Slider label="Blur"     value={s.circleShadowBlur}    min={0}   max={80}  unit="px" onChange={v => onChange({ circleShadowBlur: v })} />
            <Slider label="Offset X" value={s.circleShadowOffsetX} min={-50} max={50}  unit="px" onChange={v => onChange({ circleShadowOffsetX: v })} />
            <Slider label="Offset Y" value={s.circleShadowOffsetY} min={-50} max={50}  unit="px" onChange={v => onChange({ circleShadowOffsetY: v })} />
            <Slider label="Opacity"  value={s.circleShadowOpacity}                               onChange={v => onChange({ circleShadowOpacity: v })} />
          </>
        )}
        <Slider label="Lift" value={s.circleLift} min={0} max={100} onChange={v => onChange({ circleLift: v })} />
      </CollapsibleSection>}

      {!videoMode && <CollapsibleSection title="Circle 2" defaultOpen={false}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-zinc-400">Border Color</span>
          <input type="color" value={s.circle2BorderColor}
            onChange={e => onChange({ circle2BorderColor: e.target.value })}
            className="w-7 h-7 cursor-pointer rounded border-0 bg-transparent p-0" />
        </div>
        <Slider label="Border Width"   value={s.circle2BorderWidth}   min={0} max={30} unit="px" onChange={v => onChange({ circle2BorderWidth: v })} />
        <Slider label="Border Opacity" value={s.circle2BorderOpacity}                           onChange={v => onChange({ circle2BorderOpacity: v })} />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-zinc-400">Drop Shadow</span>
          <PillBtn compact active={s.circle2ShadowEnabled} onClick={() => onChange({ circle2ShadowEnabled: !s.circle2ShadowEnabled })}>
            {s.circle2ShadowEnabled ? 'On' : 'Off'}
          </PillBtn>
        </div>
        {s.circle2ShadowEnabled && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400">Shadow Color</span>
              <input type="color" value={s.circle2ShadowColor}
                onChange={e => onChange({ circle2ShadowColor: e.target.value })}
                className="w-7 h-7 cursor-pointer rounded border-0 bg-transparent p-0" />
            </div>
            <Slider label="Blur"     value={s.circle2ShadowBlur}    min={0}   max={80}  unit="px" onChange={v => onChange({ circle2ShadowBlur: v })} />
            <Slider label="Offset X" value={s.circle2ShadowOffsetX} min={-50} max={50}  unit="px" onChange={v => onChange({ circle2ShadowOffsetX: v })} />
            <Slider label="Offset Y" value={s.circle2ShadowOffsetY} min={-50} max={50}  unit="px" onChange={v => onChange({ circle2ShadowOffsetY: v })} />
            <Slider label="Opacity"  value={s.circle2ShadowOpacity}                               onChange={v => onChange({ circle2ShadowOpacity: v })} />
          </>
        )}
        <Slider label="Lift" value={s.circle2Lift} min={0} max={100} onChange={v => onChange({ circle2Lift: v })} />
      </CollapsibleSection>}

      {/* Tags */}
      <CollapsibleSection title="Tags" defaultOpen>
        {(s.tagSlots ?? []).some(t => t !== null) || (s.tagZoneSlots ?? []).some(t => t !== null) ? (
          <div className="flex flex-col gap-1.5">
            {(s.tagSlots ?? []).map((tagSlot, idx) => {
              if (!tagSlot) return null;
              return (
                <TagSlotEditor
                  key={`slot-${idx}`}
                  idx={idx}
                  tagSlot={tagSlot}
                  onChange={newSlot => {
                    const next = [...(s.tagSlots ?? Array(6).fill(null))];
                    next[idx] = newSlot;
                    onChange({ tagSlots: next });
                  }}
                  onRemove={() => {
                    const next = [...(s.tagSlots ?? Array(6).fill(null))];
                    next[idx] = null;
                    onChange({ tagSlots: next });
                  }}
                />
              );
            })}
            {(s.tagZoneSlots ?? []).map((tagSlot, idx) => {
              if (!tagSlot) return null;
              return (
                <TagSlotEditor
                  key={`zone-${idx}`}
                  idx={idx}
                  label={ZONE_LABELS[idx]}
                  tagSlot={tagSlot}
                  onChange={newSlot => {
                    const next = [...(s.tagZoneSlots ?? Array(9).fill(null))];
                    next[idx] = newSlot;
                    onChange({ tagZoneSlots: next });
                  }}
                  onRemove={() => {
                    const next = [...(s.tagZoneSlots ?? Array(9).fill(null))];
                    next[idx] = null;
                    onChange({ tagZoneSlots: next });
                  }}
                />
              );
            })}
          </div>
        ) : (
          <p className="text-[11px] text-zinc-600 italic">No tags placed yet — add one from the + button on the canvas</p>
        )}
      </CollapsibleSection>

      {/* Dividers */}
      {(s.dividerSlots ?? []).some(d => d !== null) && (
        <CollapsibleSection title="Dividers" defaultOpen>
          <div className="flex flex-col gap-1.5">
            {(s.dividerSlots ?? []).map((divId, idx) => {
              if (!divId) return null;
              const ds = s.dividerSettings?.[idx] ?? null;
              return (
                <DividerSlotEditor
                  key={idx}
                  idx={idx}
                  divId={divId}
                  ds={ds}
                  subSlot={s.dividerSubSlots?.[idx] ?? null}
                  onSubChange={c => {
                    const next = [...(s.dividerSubSlots ?? Array(3).fill(null))];
                    next[idx] = c;
                    onChange({ dividerSubSlots: next });
                  }}
                  onChange={newDs => {
                    const next = [...(s.dividerSettings ?? Array(3).fill(null))];
                    next[idx] = newDs;
                    onChange({ dividerSettings: next });
                  }}
                  onRemove={() => {
                    const nextSlots = [...(s.dividerSlots ?? Array(3).fill(null))];
                    const nextSubs  = [...(s.dividerSubSlots ?? Array(3).fill(null))];
                    const nextSets  = [...(s.dividerSettings ?? Array(3).fill(null))];
                    nextSlots[idx] = null;
                    nextSubs[idx]  = null;
                    nextSets[idx]  = null;
                    onChange({ dividerSlots: nextSlots, dividerSubSlots: nextSubs, dividerSettings: nextSets });
                  }}
                />
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      {/* Quotation Marks */}
      {((s.quoteSlots ?? []).some(q => q !== null) || (s.quoteZoneSlots ?? []).some(q => q !== null)) && (
        <CollapsibleSection title="Quotation Marks">
          <div className="flex flex-col gap-3">
            {/* Style grid — shows active slots with swap button */}
            <div className="flex flex-col gap-1.5">
              {(s.quoteSlots ?? []).map((styleId, idx) => {
                if (!styleId) return null;
                const qs = QUOTE_STYLES.find(q => q.id === styleId);
                return (
                  <div key={`slot-${idx}`} className="flex items-center gap-2 rounded-lg bg-zinc-950 border border-zinc-800 px-2.5 py-2">
                    <span className="text-[10px] text-zinc-500 w-16 shrink-0">{['Top Left','Top Ctr','Top Right','Bot Left','Bot Ctr','Bot Right'][idx]}</span>
                    {qs && (
                      <svg viewBox={qs.viewBox.join(' ')} style={{ width: 18, height: 18, fill: s.quoteColor ?? '#ffffff', flexShrink: 0 }}>
                        {qs.paths.map((d, pi) => <path key={pi} d={d} />)}
                      </svg>
                    )}
                    <span className="text-[10px] text-zinc-400 flex-1">{qs?.label ?? styleId}</span>
                    <button
                      onClick={() => {
                        const next = [...(s.quoteSlots ?? Array(6).fill(null))];
                        next[idx] = null;
                        onChange({ quoteSlots: next });
                      }}
                      className="text-zinc-600 hover:text-red-400 transition-colors text-xs"
                    >×</button>
                  </div>
                );
              })}
              {(s.quoteZoneSlots ?? []).map((styleId, idx) => {
                if (!styleId) return null;
                const qs = QUOTE_STYLES.find(q => q.id === styleId);
                return (
                  <div key={`zone-${idx}`} className="flex items-center gap-2 rounded-lg bg-zinc-950 border border-zinc-800 px-2.5 py-2">
                    <span className="text-[10px] text-zinc-500 w-16 shrink-0">{ZONE_LABELS[idx]}</span>
                    {qs && (
                      <svg viewBox={qs.viewBox.join(' ')} style={{ width: 18, height: 18, fill: s.quoteColor ?? '#ffffff', flexShrink: 0 }}>
                        {qs.paths.map((d, pi) => <path key={pi} d={d} />)}
                      </svg>
                    )}
                    <span className="text-[10px] text-zinc-400 flex-1">{qs?.label ?? styleId}</span>
                    <button
                      onClick={() => {
                        const next = [...(s.quoteZoneSlots ?? Array(9).fill(null))];
                        next[idx] = null;
                        onChange({ quoteZoneSlots: next });
                      }}
                      className="text-zinc-600 hover:text-red-400 transition-colors text-xs"
                    >×</button>
                  </div>
                );
              })}
            </div>
            {/* Shared color / size / opacity */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400">Color</span>
              <input type="color" value={s.quoteColor ?? '#ffffff'} onChange={e => onChange({ quoteColor: e.target.value })}
                className="w-7 h-7 cursor-pointer rounded border-0 bg-transparent p-0" />
            </div>
            <Slider label="Size" value={s.quoteSize ?? 120} min={20} max={400} unit="px"
              onChange={v => onChange({ quoteSize: v })} />
            <Slider label="Opacity" value={s.quoteOpacity ?? 100}
              onChange={v => onChange({ quoteOpacity: v })} />
            {((s.quoteSlots ?? []).some(id => id?.endsWith('-pair')) || (s.quoteZoneSlots ?? []).some(id => id?.endsWith('-pair'))) && (
              <Slider label="Pair Gap" value={s.quoteGap ?? 8} min={0} max={80} unit="px"
                onChange={v => onChange({ quoteGap: v })} />
            )}
            <ShadowEditor value={s.quoteShadow} onChange={v => onChange({ quoteShadow: v })} />
          </div>
        </CollapsibleSection>
      )}

      {/* Swipe elements */}
      {(s.swipeZoneSlots ?? []).some(sw => sw !== null) && (
        <CollapsibleSection title="Swipe">
          <div className="flex flex-col gap-1.5">
            {(s.swipeZoneSlots ?? []).map((sw, fi) => {
              if (!sw) return null;
              return (
                <SwipeZoneEditor
                  key={fi}
                  fi={fi}
                  style={sw}
                  onChange={newStyle => {
                    const next = [...(s.swipeZoneSlots ?? Array(9).fill(null))];
                    next[fi] = newStyle;
                    onChange({ swipeZoneSlots: next });
                  }}
                  onRemove={() => {
                    const next = [...(s.swipeZoneSlots ?? Array(9).fill(null))];
                    next[fi] = null;
                    onChange({ swipeZoneSlots: next });
                  }}
                />
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      </div>
      </div>
    </div>
  );
}
