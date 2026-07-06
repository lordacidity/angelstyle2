'use client';

import { useState, useRef, useEffect } from 'react';
import CarouselCanvas, { CAROUSEL_PREVIEW_W, LOGO_PH } from './CarouselCanvas';
import { CarouselSettingsPanel } from './CarouselSettingsPanel';
import { defaultCarouselSettings, TAG_PRESETS, defaultTagStyle, SWIPE_PRESETS } from './carouselTypes';
import { SwipePreviewMini } from './SwipePreviewMini';
import type { CarouselCanvasRef, CarouselSettings, CarouselBgLayerState, SidebarElementData, SwipeStyle } from './carouselTypes';
import { ALL_QUOTE_STYLES } from './quoteStyles';
import type { RecordingState } from './TikTokCanvas/types';
import type { BrandProps, BrandLogo } from '../types';
import { BTN_ICON, BTN_TEXT } from '@/lib/ui-constants';
import { useCarouselTemplates } from '../hooks/useCarouselTemplates';
import type { SlideType } from '../hooks/useCarouselTemplates';
import { EditablePct } from './EditablePct';

// ── Divider library ───────────────────────────────────────────────────────────

const DIVIDER_LIBRARY = [
  { id: 'solid',             label: 'Solid' },
  { id: 'thick',             label: 'Thick' },
  { id: 'dashed',            label: 'Dashed' },
  { id: 'dotted',            label: 'Dotted' },
  { id: 'double',            label: 'Double' },
  { id: 'triple',            label: 'Triple' },
  { id: 'dot-center',        label: 'Dot center' },
  { id: 'dots-row',          label: 'Dots row' },
  { id: 'diamond-center',    label: 'Diamond' },
  { id: 'logo-center',       label: 'Logo center' },
  { id: 'logo-left',         label: 'Logo left' },
  { id: 'logo-right',        label: 'Logo right' },
  { id: 'fade',              label: 'Fade out' },
  { id: 'fade-left',         label: 'Fade left' },
  { id: 'taper',             label: 'Taper' },
  { id: 'taper-dashed',      label: 'Taper dash' },
  { id: 'double-fade',       label: 'Double fade' },
  { id: 'logo-center-fade',  label: 'Logo + fade' },
  { id: 'logo-left-fade',    label: 'Logo left fade' },
  { id: 'dashed-fade',       label: 'Dashed fade' },
  { id: 'thick-taper',       label: 'Thick taper' },
  { id: 'short-center',      label: 'Short center' },
  { id: 'wave',              label: 'Wave' },
  { id: 'brackets',          label: 'Brackets' },
  { id: 'tag-center',        label: 'Tag center' },
  { id: 'tag-left',          label: 'Tag left' },
  { id: 'tag-right',         label: 'Tag right' },
  { id: 'tag-center-fade',   label: 'Tag + fade' },
  { id: 'tag-left-fade',     label: 'Tag left fade' },
  { id: 'tag-logo',          label: 'Tag + logo' },
  { id: 'tag-double',        label: 'Tag double' },
  { id: 'tag-short',         label: 'Tag short' },
  // Wave + content
  { id: 'wave-logo-center', label: 'Wave logo ●' },
  { id: 'wave-logo-left',   label: 'Wave logo left' },
  { id: 'wave-logo-right',  label: 'Wave logo right' },
  { id: 'wave-tag-center',  label: 'Wave tag ●' },
  { id: 'wave-tag-left',    label: 'Wave tag left' },
  { id: 'wave-tag-right',   label: 'Wave tag right' },
  // Taper + content
  { id: 'taper-logo-center',     label: 'Taper logo ●' },
  { id: 'taper-logo-center-out', label: 'Taper logo ◁▷' },
  { id: 'taper-logo-left',       label: 'Taper logo left' },
  { id: 'taper-logo-right',      label: 'Taper logo right' },
  { id: 'taper-tag-center',      label: 'Taper tag ●' },
  { id: 'taper-tag-center-out',  label: 'Taper tag ◁▷' },
  { id: 'taper-tag-left',        label: 'Taper tag left' },
  { id: 'taper-tag-right',       label: 'Taper tag right' },
  // Dashed + content
  { id: 'dashed-logo-center', label: 'Dashed logo ●' },
  { id: 'dashed-logo-left',   label: 'Dashed logo left' },
  { id: 'dashed-logo-right',  label: 'Dashed logo right' },
  { id: 'dashed-tag-center',  label: 'Dashed tag ●' },
  { id: 'dashed-tag-left',    label: 'Dashed tag left' },
  { id: 'dashed-tag-right',   label: 'Dashed tag right' },
];

const LINE   = '#52525b';
const LINE_D = '#3f3f46';

// Logo placeholder used inside slot-scale divider previews
const LogoPlaceholder = ({ size = 14 }: { size?: number }) => (
  <div
    className="shrink-0 rounded-[2px] bg-zinc-700 flex items-center justify-center"
    style={{ width: size, height: size }}
  >
    <div className="rounded-[1px] bg-zinc-500" style={{ width: size * 0.55, height: size * 0.4 }} />
  </div>
);

// Tag placeholder — looks like a badge label
const TagPlaceholder = () => (
  <div
    className="shrink-0 rounded-[2px] border border-zinc-600 bg-zinc-800 flex items-center justify-center"
    style={{ padding: '2px 5px', gap: 3 }}
  >
    <div className="rounded-full bg-zinc-600" style={{ width: 12, height: 3 }} />
    <div className="rounded-full bg-zinc-500" style={{ width: 8, height: 3 }} />
  </div>
);

function DividerSlotElement({ id }: { id: string }) {
  const h = LOGO_PH; // slot height in px — exact match to canvas slot
  const line1 = <div className="flex-1 h-px" style={{ background: LINE }} />;
  const line1d = <div className="flex-1 h-px" style={{ background: LINE_D }} />;
  // Wave path — shared by all 6 wave-* variants
  const wavePath = `M0,${h/2} C8,${h*0.14} 17,${h*0.86} 25,${h/2} C33,${h*0.14} 42,${h*0.86} 50,${h/2} C58,${h*0.14} 67,${h*0.86} 75,${h/2} C83,${h*0.14} 92,${h*0.86} 100,${h/2}`;
  const WaveSvg = () => (
    <svg className="flex-1" height={h} preserveAspectRatio="none" viewBox={`0 0 100 ${h}`}>
      <path d={wavePath} fill="none" stroke={LINE} strokeWidth="1.5" />
    </svg>
  );

  switch (id) {
    case 'solid':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%' }}>{line1}</div>;

    case 'thick':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%' }}>
        <div className="flex-1 rounded-full" style={{ height: 2, background: LINE }} />
      </div>;

    case 'dashed':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%' }}>
        <div className="flex-1" style={{ borderTop: `1px dashed ${LINE}` }} />
      </div>;

    case 'dotted':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%' }}>
        <div className="flex-1" style={{ borderTop: `1px dotted ${LINE}` }} />
      </div>;

    case 'double':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%' }}>
        <div className="flex-1 flex flex-col gap-[3px]">
          <div className="h-px" style={{ background: LINE_D }} />
          <div className="h-px" style={{ background: LINE_D }} />
        </div>
      </div>;

    case 'triple':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%' }}>
        <div className="flex-1 flex flex-col gap-[2px]">
          <div className="h-px" style={{ background: LINE_D }} />
          <div style={{ height: 2, background: LINE }} />
          <div className="h-px" style={{ background: LINE_D }} />
        </div>
      </div>;

    case 'dot-center':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        {line1d}
        <div className="rounded-full shrink-0" style={{ width: 5, height: 5, background: LINE }} />
        {line1d}
      </div>;

    case 'dots-row':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', gap: 5 }}>
        {[0,1,2,3,4,5].map(i => (
          <div key={i} className="rounded-full shrink-0" style={{ width: 4, height: 4, background: LINE, opacity: i === 0 || i === 5 ? 0.3 : i === 1 || i === 4 ? 0.6 : 1 }} />
        ))}
      </div>;

    case 'diamond-center':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        {line1d}
        <svg width="8" height="8" viewBox="0 0 8 8" className="shrink-0"><polygon points="4,0 8,4 4,8 0,4" fill={LINE} /></svg>
        {line1d}
      </div>;

    case 'logo-center':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        {line1d}
        <LogoPlaceholder />
        {line1d}
      </div>;

    case 'logo-left':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <LogoPlaceholder />
        {line1d}
      </div>;

    case 'logo-right':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        {line1d}
        <LogoPlaceholder />
      </div>;

    case 'fade':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%' }}>
        <div className="flex-1 h-px" style={{ background: `linear-gradient(to right, transparent, ${LINE} 30%, ${LINE} 70%, transparent)` }} />
      </div>;

    case 'fade-left':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%' }}>
        <div className="flex-1 h-px" style={{ background: `linear-gradient(to right, ${LINE}, transparent)` }} />
      </div>;

    case 'taper':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%' }}>
        <svg className="flex-1" height={h} preserveAspectRatio="none" viewBox={`0 0 100 ${h}`}>
          <polygon points={`0,${h/2} 50,${h*0.15} 100,${h/2} 50,${h*0.85}`} fill={LINE} />
        </svg>
      </div>;

    case 'taper-dashed':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%' }}>
        <svg className="flex-1" height={4} preserveAspectRatio="none" viewBox="0 0 100 4">
          <line x1="0" y1="2" x2="100" y2="2" stroke={LINE} strokeWidth="1.5" strokeDasharray="4 3"
            style={{ maskImage: 'linear-gradient(to right, transparent, black 20%, black 80%, transparent)', WebkitMaskImage: 'linear-gradient(to right, transparent, black 20%, black 80%, transparent)' }} />
        </svg>
      </div>;

    case 'double-fade':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%' }}>
        <div className="flex-1 flex flex-col gap-[3px]">
          <div className="h-px" style={{ background: `linear-gradient(to right, transparent, ${LINE_D} 25%, ${LINE_D} 75%, transparent)` }} />
          <div className="h-px" style={{ background: `linear-gradient(to right, transparent, ${LINE_D} 25%, ${LINE_D} 75%, transparent)` }} />
        </div>
      </div>;

    case 'logo-center-fade':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <div className="flex-1 h-px" style={{ background: `linear-gradient(to right, transparent, ${LINE_D})` }} />
        <LogoPlaceholder />
        <div className="flex-1 h-px" style={{ background: `linear-gradient(to left, transparent, ${LINE_D})` }} />
      </div>;

    case 'logo-left-fade':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <LogoPlaceholder />
        <div className="flex-1 h-px" style={{ background: `linear-gradient(to right, ${LINE}, transparent)` }} />
      </div>;

    case 'dashed-fade':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%' }}>
        <div className="flex-1 h-px" style={{
          background: `repeating-linear-gradient(to right, ${LINE} 0, ${LINE} 4px, transparent 4px, transparent 7px)`,
          maskImage: 'linear-gradient(to right, transparent, black 25%, black 75%, transparent)',
          WebkitMaskImage: 'linear-gradient(to right, transparent, black 25%, black 75%, transparent)',
        }} />
      </div>;

    case 'thick-taper':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%' }}>
        <svg className="flex-1" height={h} preserveAspectRatio="none" viewBox={`0 0 100 ${h}`}>
          <polygon points={`0,${h/2} 50,${h*0.08} 100,${h/2} 50,${h*0.92}`} fill={LINE} />
        </svg>
      </div>;

    case 'short-center':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
        <div className="h-px" style={{ width: '33%', background: LINE }} />
      </div>;

    case 'wave':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%' }}>
        <svg className="flex-1" height={10} preserveAspectRatio="none" viewBox="0 0 100 10">
          <path d="M0,5 C8,1 17,9 25,5 C33,1 42,9 50,5 C58,1 67,9 75,5 C83,1 92,9 100,5"
            fill="none" stroke={LINE} strokeWidth="1" />
        </svg>
      </div>;

    case 'brackets':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 3 }}>
        <svg width="7" height={h} viewBox={`0 0 7 ${h}`}>
          <path d={`M5,2 H2 Q1,2 1,4 V${h-4} Q1,${h-2} 2,${h-2} H5`} fill="none" stroke={LINE} strokeWidth="1" />
        </svg>
        {line1d}
        <svg width="7" height={h} viewBox={`0 0 7 ${h}`} style={{ transform: 'scaleX(-1)' }}>
          <path d={`M5,2 H2 Q1,2 1,4 V${h-4} Q1,${h-2} 2,${h-2} H5`} fill="none" stroke={LINE} strokeWidth="1" />
        </svg>
      </div>;

    case 'tag-center':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        {line1d}
        <TagPlaceholder />
        {line1d}
      </div>;

    case 'tag-left':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <TagPlaceholder />
        {line1d}
      </div>;

    case 'tag-right':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        {line1d}
        <TagPlaceholder />
      </div>;

    case 'tag-center-fade':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <div className="flex-1 h-px" style={{ background: `linear-gradient(to right, transparent, ${LINE_D})` }} />
        <TagPlaceholder />
        <div className="flex-1 h-px" style={{ background: `linear-gradient(to left, transparent, ${LINE_D})` }} />
      </div>;

    case 'tag-left-fade':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <TagPlaceholder />
        <div className="flex-1 h-px" style={{ background: `linear-gradient(to right, ${LINE}, transparent)` }} />
      </div>;

    case 'tag-logo':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        {line1d}
        <LogoPlaceholder />
        <TagPlaceholder />
        {line1d}
      </div>;

    case 'tag-double':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <div className="flex-1 flex flex-col gap-[2px]">
          <div className="h-px" style={{ background: LINE_D }} />
          <div className="h-px" style={{ background: LINE_D }} />
        </div>
        <TagPlaceholder />
        <div className="flex-1 flex flex-col gap-[2px]">
          <div className="h-px" style={{ background: LINE_D }} />
          <div className="h-px" style={{ background: LINE_D }} />
        </div>
      </div>;

    case 'tag-short':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', gap: 5 }}>
        <div className="h-px" style={{ width: 20, background: LINE }} />
        <TagPlaceholder />
        <div className="h-px" style={{ width: 20, background: LINE }} />
      </div>;

    // Wave + content variants — all share the same wavePath / WaveSvg
    case 'wave-logo-center':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <WaveSvg /><LogoPlaceholder /><WaveSvg />
      </div>;

    case 'wave-logo-left':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <LogoPlaceholder /><WaveSvg />
      </div>;

    case 'wave-logo-right':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <WaveSvg /><LogoPlaceholder />
      </div>;

    case 'wave-tag-center':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <WaveSvg /><TagPlaceholder /><WaveSvg />
      </div>;

    case 'wave-tag-left':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <TagPlaceholder /><WaveSvg />
      </div>;

    case 'wave-tag-right':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <WaveSvg /><TagPlaceholder />
      </div>;

    // Taper + content variants
    case 'taper-logo-center':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <svg className="flex-1" height={h} preserveAspectRatio="none" viewBox={`0 0 50 ${h}`}>
          <polygon points={`0,2 50,${h/2} 0,${h-2}`} fill={LINE_D} />
        </svg>
        <LogoPlaceholder />
        <svg className="flex-1" height={h} preserveAspectRatio="none" viewBox={`0 0 50 ${h}`} style={{ transform: 'scaleX(-1)' }}>
          <polygon points={`0,2 50,${h/2} 0,${h-2}`} fill={LINE_D} />
        </svg>
      </div>;

    case 'taper-logo-left':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <LogoPlaceholder />
        <svg className="flex-1" height={h} preserveAspectRatio="none" viewBox={`0 0 100 ${h}`}>
          <polygon points={`0,${h*0.15} 100,${h/2} 0,${h*0.85}`} fill={LINE_D} />
        </svg>
      </div>;

    case 'taper-logo-right':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <svg className="flex-1" height={h} preserveAspectRatio="none" viewBox={`0 0 100 ${h}`}>
          <polygon points={`100,${h*0.15} 0,${h/2} 100,${h*0.85}`} fill={LINE_D} />
        </svg>
        <LogoPlaceholder />
      </div>;

    case 'taper-tag-center':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <svg className="flex-1" height={h} preserveAspectRatio="none" viewBox={`0 0 50 ${h}`}>
          <polygon points={`0,2 50,${h/2} 0,${h-2}`} fill={LINE_D} />
        </svg>
        <TagPlaceholder />
        <svg className="flex-1" height={h} preserveAspectRatio="none" viewBox={`0 0 50 ${h}`} style={{ transform: 'scaleX(-1)' }}>
          <polygon points={`0,2 50,${h/2} 0,${h-2}`} fill={LINE_D} />
        </svg>
      </div>;

    case 'taper-tag-left':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <TagPlaceholder />
        <svg className="flex-1" height={h} preserveAspectRatio="none" viewBox={`0 0 100 ${h}`}>
          <polygon points={`0,${h*0.15} 100,${h/2} 0,${h*0.85}`} fill={LINE_D} />
        </svg>
      </div>;

    case 'taper-tag-right':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <svg className="flex-1" height={h} preserveAspectRatio="none" viewBox={`0 0 100 ${h}`}>
          <polygon points={`100,${h*0.15} 0,${h/2} 100,${h*0.85}`} fill={LINE_D} />
        </svg>
        <TagPlaceholder />
      </div>;

    // Inverse taper center — thick at element, tapers outward to points at edges
    case 'taper-tag-center-out':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <svg className="flex-1" height={h} preserveAspectRatio="none" viewBox={`0 0 50 ${h}`}>
          <polygon points={`50,2 0,${h/2} 50,${h-2}`} fill={LINE_D} />
        </svg>
        <TagPlaceholder />
        <svg className="flex-1" height={h} preserveAspectRatio="none" viewBox={`0 0 50 ${h}`}>
          <polygon points={`0,2 50,${h/2} 0,${h-2}`} fill={LINE_D} />
        </svg>
      </div>;

    case 'taper-logo-center-out':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <svg className="flex-1" height={h} preserveAspectRatio="none" viewBox={`0 0 50 ${h}`}>
          <polygon points={`50,2 0,${h/2} 50,${h-2}`} fill={LINE_D} />
        </svg>
        <LogoPlaceholder />
        <svg className="flex-1" height={h} preserveAspectRatio="none" viewBox={`0 0 50 ${h}`}>
          <polygon points={`0,2 50,${h/2} 0,${h-2}`} fill={LINE_D} />
        </svg>
      </div>;

    // Dashed + content variants
    case 'dashed-logo-center':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <div className="flex-1" style={{ borderTop: `1px dashed ${LINE}` }} />
        <LogoPlaceholder />
        <div className="flex-1" style={{ borderTop: `1px dashed ${LINE}` }} />
      </div>;

    case 'dashed-logo-left':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <LogoPlaceholder />
        <div className="flex-1" style={{ borderTop: `1px dashed ${LINE}` }} />
      </div>;

    case 'dashed-logo-right':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <div className="flex-1" style={{ borderTop: `1px dashed ${LINE}` }} />
        <LogoPlaceholder />
      </div>;

    case 'dashed-tag-center':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <div className="flex-1" style={{ borderTop: `1px dashed ${LINE}` }} />
        <TagPlaceholder />
        <div className="flex-1" style={{ borderTop: `1px dashed ${LINE}` }} />
      </div>;

    case 'dashed-tag-left':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <TagPlaceholder />
        <div className="flex-1" style={{ borderTop: `1px dashed ${LINE}` }} />
      </div>;

    case 'dashed-tag-right':
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%', gap: 5 }}>
        <div className="flex-1" style={{ borderTop: `1px dashed ${LINE}` }} />
        <TagPlaceholder />
      </div>;

    default:
      return <div style={{ height: h, display: 'flex', alignItems: 'center', width: '100%' }}>{line1}</div>;
  }
}

const SLIDE_COUNT = 3;
const SLIDE_IDS = ['slide-1', 'slide-2', 'slide-3'] as const;
type SlideId = typeof SLIDE_IDS[number];

const SLIDE_TYPE_MAP: Record<SlideId, SlideType> = {
  'slide-1': 'main',
  'slide-2': 'supporting_1',
  'slide-3': 'supporting_2',
};

interface SlideState {
  imageSrc: string;
  headline: string;
  subheadline: string;
  settings: CarouselSettings;
  bgState: CarouselBgLayerState;
  scale: number;
  recordingState: RecordingState | null;
}

const SLIDE_DEFAULTS: { headline: string; subheadline: string }[] = [
  { headline: 'Your brand starts here', subheadline: 'A bold statement that stops the scroll' },
  { headline: 'Build something people love', subheadline: 'Consistency creates trust — show up every day' },
  { headline: 'Every post tells a story', subheadline: 'Make yours impossible to ignore' },
];

function makeSlide(index = 0): SlideState {
  const defaults = SLIDE_DEFAULTS[index] ?? SLIDE_DEFAULTS[0];
  return {
    imageSrc: '',
    headline: defaults.headline,
    subheadline: defaults.subheadline,
    settings: defaultCarouselSettings(),
    bgState: { fgMaskReady: false, isBgProcessing: false, bgProcessError: false },
    scale: 1,
    recordingState: null,
  };
}

function makeDragHandlers(data: SidebarElementData, setDragging: (v: boolean) => void) {
  return {
    draggable: true as const,
    onDragStart: (e: React.DragEvent) => {
      setDragging(true);
      e.dataTransfer.setData('application/carousel-element', JSON.stringify(data));
      e.dataTransfer.setData('application/carousel-element-type/' + data.type, '');
      e.dataTransfer.effectAllowed = 'copy';
    },
    onDragEnd: () => setDragging(false),
  };
}

export function BuilderGrid({ brand, onSelectLogo, userId }: { brand: BrandProps; onSelectLogo: (url: string) => void; userId: string | null }) {
  // The Builder's draggable element is the active favicon logo (brand.logoSrc),
  // so its picker only lists favicon-kind logos — the separate full "Logo" isn't
  // wired into posts.
  const faviconLogos = brand.logos.filter(l => (l.kind ?? 'favicon') === 'favicon');
  const [selectedId, setSelectedId] = useState<SlideId>('slide-1');
  const [hoveredLogo, setHoveredLogo] = useState<string | null>(null);
  const [viewScale, setViewScale] = useState(0.9);
  const [isDraggingElement, setIsDraggingElement] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState<SlideId | null>(null);
  const [slides, setSlides] = useState<Record<SlideId, SlideState>>({
    'slide-1': makeSlide(0),
    'slide-2': makeSlide(1),
    'slide-3': makeSlide(2),
  });

  const canvasRefs = useRef<Record<SlideId, CarouselCanvasRef | null>>({
    'slide-1': null, 'slide-2': null, 'slide-3': null,
  });
  const fileRefs = useRef<Record<SlideId, HTMLInputElement | null>>({
    'slide-1': null, 'slide-2': null, 'slide-3': null,
  });
  const hydrated = useRef(false);

  const { savedSlides, saving: savingSlide, saveSlide } = useCarouselTemplates(userId);

  function updateSlide(id: SlideId, partial: Partial<SlideState>) {
    setSlides(prev => ({ ...prev, [id]: { ...prev[id], ...partial } }));
  }

  function updateSettings(id: SlideId, partial: Partial<CarouselSettings>) {
    setSlides(prev => ({
      ...prev,
      [id]: { ...prev[id], settings: { ...prev[id].settings, ...partial } },
    }));
  }

  function handleImageFile(id: SlideId, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    updateSlide(id, { imageSrc: URL.createObjectURL(file) });
  }

  useEffect(() => {
    if (!savedSlides || hydrated.current) return;
    hydrated.current = true;
    setSlides(prev => {
      const next = { ...prev };
      for (const [slideId, slideType] of Object.entries(SLIDE_TYPE_MAP) as [SlideId, SlideType][]) {
        const saved = savedSlides[slideType];
        if (!saved) continue;
        next[slideId] = { ...prev[slideId], headline: saved.headline, subheadline: saved.subheadline, settings: saved.settings };
      }
      return next;
    });
  }, [savedSlides]);

  async function handleSave(id: SlideId) {
    const slide = slides[id];
    await saveSlide(SLIDE_TYPE_MAP[id], slide.headline, slide.subheadline, slide.settings);
    setSavedFeedback(id);
    setTimeout(() => setSavedFeedback(prev => prev === id ? null : prev), 2000);
  }

  const selectedSlide = slides[selectedId];


  return (
    <div className="w-full flex flex-col h-full overflow-hidden">

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-zinc-800 shrink-0 bg-[#0f0f0f]">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-600 select-none tabular-nums w-8 text-right">
            {Math.round(viewScale * 100)}%
          </span>
          <input
            type="range" min={40} max={150} step={10}
            value={Math.round(viewScale * 100)}
            onChange={e => setViewScale(parseInt(e.target.value) / 100)}
            className="w-20 h-1 accent-white cursor-pointer"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => canvasRefs.current[selectedId]?.startDownload()}
            className="flex items-center gap-1.5 rounded-full bg-white px-2 py-1.5 text-xs font-medium text-black hover:bg-zinc-100 transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            PNG
          </button>
          <button
            onClick={() => {
              SLIDE_IDS.forEach(id => canvasRefs.current[id]?.startDownload());
            }}
            className="flex items-center gap-1.5 rounded-full bg-white px-2 py-1.5 text-xs font-medium text-black hover:bg-zinc-100 transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download All
          </button>
        </div>
      </div>

      {/* Left placeholder panel */}
      <div className="fixed top-0 left-[72px] z-20 bg-zinc-950 border-r border-zinc-800 w-[300px] h-screen overflow-y-auto flex flex-col [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
        <div className="px-3 py-3 border-b border-zinc-800 shrink-0">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Elements</span>
        </div>
        <div className="flex flex-col gap-5 p-3 overflow-y-auto [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>

          {/* Brand Kit — logo picker + draggable active logo */}
          {faviconLogos.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[9px] font-semibold text-zinc-600 uppercase tracking-wider">Brand Kit</span>

              {/* Logo grid — click to select, drag active logo to canvas */}
              <div className="flex flex-wrap gap-2">
                {faviconLogos.map((logo: BrandLogo) => {
                  const isActive = brand.logoSrc === logo.url;
                  return (
                    <div
                      key={logo.id}
                      className="relative"
                      onMouseEnter={() => setHoveredLogo(logo.id)}
                      onMouseLeave={() => setHoveredLogo(null)}
                    >
                      <button
                        onClick={() => onSelectLogo(logo.url)}
                        className={`w-12 h-12 rounded-lg overflow-hidden border-2 transition-all ${
                          isActive ? 'border-white' : 'border-zinc-700 hover:border-zinc-500'
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={logo.url} alt="" className="w-full h-full object-contain bg-zinc-900" />
                      </button>

                      {isActive && (
                        <div className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-white flex items-center justify-center shadow pointer-events-none">
                          <svg width="7" height="7" viewBox="0 0 12 12" fill="none">
                            <path d="M2 6l3 3 5-5" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Draggable element using the active logo */}
              {brand.logoSrc && (
                <div
                  {...makeDragHandlers({ type: 'logo' }, setIsDraggingElement)}
                  className="group flex items-center gap-2.5 px-3 rounded-md bg-zinc-950 border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900 transition-colors cursor-grab active:cursor-grabbing select-none"
                  style={{ height: LOGO_PH + 14 }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={brand.logoSrc} alt="" className="h-5 w-auto max-w-[72px] object-contain rounded shrink-0" />
                  <span className="text-[9px] text-zinc-500 group-hover:text-zinc-300 transition-colors truncate">Drag to canvas</span>
                </div>
              )}
            </div>
          )}

          {/* Tags — 3-column grid matching slot subdivision width, draggable */}
          <div className="flex flex-col gap-2">
            <span className="text-[9px] font-semibold text-zinc-600 uppercase tracking-wider">Tags</span>
            <div className="grid grid-cols-3 gap-1">
              {TAG_PRESETS.map((preset, i) => {
                const s = preset.initStyle;
                const tagStyle = { ...defaultTagStyle(), ...s };
                const variants: { bg: string; border: string; color: string; font: string; size: number; tracking: string; radius: number }[] = [
                  { bg: '#3f3f46',    border: 'none',              color: '#f4f4f5', font: 'Inter, sans-serif',          size: 10, tracking: '0.04em', radius: 3  },
                  { bg: '#ffffff',    border: 'none',              color: '#18181b', font: 'Impact, sans-serif',          size: 11, tracking: '0.06em', radius: 2  },
                  { bg: 'transparent',border: '1px solid #a1a1aa', color: '#a1a1aa', font: 'Inter, sans-serif',          size: 9,  tracking: '0.08em', radius: 3  },
                  { bg: '#27272a',    border: '1px solid #52525b', color: '#d4d4d8', font: '"Georgia", serif',            size: 10, tracking: '0.02em', radius: 4  },
                  { bg: '#52525b',    border: 'none',              color: '#fafafa', font: 'Impact, sans-serif',          size: 12, tracking: '0.05em', radius: 2  },
                  { bg: 'transparent',border: '1px solid #ffffff', color: '#ffffff', font: 'Inter, sans-serif',          size: 9,  tracking: '0.1em',  radius: 20 },
                  { bg: '#18181b',    border: '1px solid #3f3f46', color: '#a1a1aa', font: '"Courier New", monospace',    size: 9,  tracking: '0.03em', radius: 3  },
                  { bg: '#71717a',    border: 'none',              color: '#fafafa', font: 'Impact, sans-serif',          size: 11, tracking: '0.07em', radius: 0  },
                  { bg: 'transparent',border: '1px solid #52525b', color: '#71717a', font: 'Inter, sans-serif',          size: 9,  tracking: '0.12em', radius: 3  },
                ];
                const v = variants[i % variants.length];
                const isLive = preset.id === 'live';
                const displayText = isLive ? 'LIVE' : preset.label;
                return (
                  <div
                    key={preset.id}
                    {...makeDragHandlers({ type: 'tag', text: displayText, style: tagStyle }, setIsDraggingElement)}
                    className="group flex items-center justify-center rounded-md bg-zinc-950 border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900 transition-colors cursor-grab active:cursor-grabbing select-none overflow-hidden px-1"
                    style={{ height: LOGO_PH + 14 }}
                  >
                    <div className="flex items-center gap-1 shrink-0"
                      style={{ background: v.bg, border: v.border, borderRadius: v.radius, padding: '2px 6px' }}
                    >
                      {isLive && <div className="w-1 h-1 rounded-full shrink-0" style={{ background: v.color }} />}
                      <span className="truncate" style={{ fontSize: v.size, fontWeight: s.fontWeight ?? 700, color: v.color, letterSpacing: v.tracking, lineHeight: 1, fontFamily: v.font }}>
                        {displayText}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Swipe elements */}
          <div className="flex flex-col gap-2">
            <span className="text-[9px] font-semibold text-zinc-600 uppercase tracking-wider">Swipe</span>
            <div className="flex flex-col gap-1">
              {SWIPE_PRESETS.map(preset => (
                <div
                  key={preset.id}
                  {...makeDragHandlers({ type: 'swipe', swipeStyle: preset.style }, setIsDraggingElement)}
                  className="group flex items-center gap-2 px-3 rounded-md bg-zinc-950 border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900 transition-colors cursor-grab active:cursor-grabbing select-none"
                  style={{ height: LOGO_PH + 14, overflow: 'visible' }}
                >
                  <div className="flex-1" style={{ overflow: 'visible', minWidth: 0 }}>
                    <SwipePreviewMini style={preset.style} />
                  </div>
                  <span className="text-[9px] text-zinc-500 group-hover:text-zinc-300 transition-colors shrink-0 ml-auto pl-2">{preset.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Dividers — to-scale (LOGO_PH height) single column */}
          <div className="flex flex-col gap-2">
            <span className="text-[9px] font-semibold text-zinc-600 uppercase tracking-wider">Dividers</span>
            <div className="flex flex-col gap-1">
              {DIVIDER_LIBRARY.map(item => (
                <div
                  key={item.id}
                  {...makeDragHandlers({ type: 'divider', id: item.id }, setIsDraggingElement)}
                  className="group flex items-center gap-2 px-2 rounded-md bg-zinc-950 border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900 transition-colors cursor-grab active:cursor-grabbing select-none"
                  style={{ height: LOGO_PH + 14 }}
                >
                  <div className="flex-1 min-w-0">
                    <DividerSlotElement id={item.id} />
                  </div>
                  <span className="text-[8px] text-zinc-600 group-hover:text-zinc-400 shrink-0 w-14 text-right truncate">{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Quote marks */}
          <div className="flex flex-col gap-2">
            <span className="text-[9px] font-semibold text-zinc-600 uppercase tracking-wider">Quotes</span>
            <div className="flex flex-wrap gap-1.5">
              {ALL_QUOTE_STYLES.map(qs => {
                const [vbX, vbY, vbW, vbH] = qs.viewBox;
                const gapVB = vbW * 0.15;
                const closeTransform = `translate(${vbX + vbW + gapVB},${vbY}) rotate(180,${vbW / 2},${vbH / 2}) translate(${-vbX},${-vbY})`;
                const label = qs.paired ? qs.label.replace(/ ❝…❞$/, '') : qs.label;
                return (
                  <div
                    key={qs.id}
                    {...makeDragHandlers({ type: 'quote', id: qs.id }, setIsDraggingElement)}
                    className="group rounded-md border border-zinc-800 flex flex-col items-center justify-center gap-1.5 bg-zinc-900/60 hover:border-zinc-600 hover:bg-zinc-800/60 transition-colors cursor-grab active:cursor-grabbing select-none"
                    style={{ width: 72, height: 72 }}
                    title={label}
                  >
                    {qs.paired ? (
                      <svg
                        viewBox={`${vbX} ${vbY} ${vbW * 2 + gapVB} ${vbH}`}
                        style={{ width: 44, height: 22 }}
                        fill="#71717a"
                        className="group-hover:fill-zinc-400 transition-colors"
                      >
                        <g>{qs.paths.map((d, i) => <path key={i} d={d} />)}</g>
                        <g transform={closeTransform}>{qs.paths.map((d, i) => <path key={i} d={d} />)}</g>
                      </svg>
                    ) : (
                      <svg
                        viewBox={qs.viewBox.join(' ')}
                        style={{ width: 32, height: 32 }}
                        fill="#71717a"
                        className="group-hover:fill-zinc-400 transition-colors"
                      >
                        {qs.paths.map((d, i) => <path key={i} d={d} />)}
                      </svg>
                    )}
                    <span className="text-[7px] text-zinc-600 group-hover:text-zinc-400 text-center leading-tight px-1 transition-colors">{label}</span>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </div>

      {/* Scroll area */}
      <div
        className="flex-1 overflow-y-auto scroll-smooth"
        style={{ paddingRight: 360, paddingLeft: 300 }}
      >
        <div
          className="flex flex-col items-center gap-8 py-6 px-4"
          style={{ zoom: viewScale }}
        >
          {SLIDE_IDS.map((id, index) => {
            const slide = slides[id];
            const isSelected = id === selectedId;
            return (
              <div key={id} className="flex flex-col gap-3" style={{ width: CAROUSEL_PREVIEW_W }}>

                {/* Slide label */}
                <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">
                  {index === 0 ? 'Main' : `Supporting ${index}`}
                </span>

                {/* Image upload + text inputs */}
                <div className="rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden">
                  {/* Image row */}
                  <div className="flex items-center gap-2 px-3 py-3 border-b border-zinc-800">
                    {slide.imageSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={slide.imageSrc} alt="" className="w-9 h-9 rounded object-cover shrink-0" />
                    ) : (
                      <div className="flex items-center gap-2 flex-1 min-w-0 border border-zinc-700 rounded-md px-2.5 h-9 text-zinc-500">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                        </svg>
                        <span className="text-sm text-zinc-600">Upload image…</span>
                      </div>
                    )}
                    <button
                      onClick={() => fileRefs.current[id]?.click()}
                      title="Upload image"
                      className="flex items-center justify-center w-9 h-9 rounded-md bg-white hover:bg-zinc-100 transition-colors shrink-0"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/>
                        <line x1="12" y1="3" x2="12" y2="15"/>
                      </svg>
                    </button>
                    <input
                      ref={el => { fileRefs.current[id] = el; }}
                      type="file" accept="image/*" className="hidden"
                      onChange={e => handleImageFile(id, e)}
                    />
                  </div>

                  {/* Headline */}
                  <div className="px-3 py-2 border-b border-zinc-800">
                    <textarea
                      value={slide.headline}
                      onChange={e => updateSlide(id, { headline: e.target.value })}
                      placeholder="Headline…"
                      rows={2}
                      className="w-full bg-transparent text-sm text-white placeholder-zinc-600 outline-none resize-none leading-relaxed"
                    />
                  </div>

                  {/* Sub-headline — optional for Main/Supporting 1, compulsory for Supporting 2 */}
                  <div className="px-3 py-2">
                    <textarea
                      value={slide.subheadline}
                      onChange={e => updateSlide(id, { subheadline: e.target.value })}
                      placeholder={index === 2 ? 'Text…' : 'Sub-headline (optional)…'}
                      rows={index === 2 ? 2 : 1}
                      className={`w-full bg-transparent text-sm placeholder-zinc-600 outline-none resize-none leading-relaxed ${
                        index === 2 ? 'text-white' : 'text-zinc-400 placeholder-zinc-700'
                      }`}
                    />
                  </div>
                </div>

                {/* Controls bar */}
                {(() => {
                  const bgState = slide.bgState;
                  const s = slide.settings;
                  const splitActive = s.bgBlurEnabled && s.bgBlurAmount === 0 && bgState.fgMaskReady;
                  const blurActive  = s.bgBlurEnabled && s.bgBlurAmount > 0 && bgState.fgMaskReady;
                  return (
                    <div className="flex items-center justify-between gap-4">
                      {/* Per-slide zoom */}
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-zinc-600 select-none shrink-0">Zoom</span>
                        <input
                          type="range" min={20} max={800} step={5}
                          value={Math.round(slide.scale * 100)}
                          onChange={e => {
                            const n = parseInt(e.target.value) / 100;
                            canvasRefs.current[id]?.setZoom(n);
                          }}
                          className="w-20 h-1 accent-white cursor-pointer"
                        />
                        <EditablePct
                          value={Math.round(slide.scale * 100)}
                          min={20} max={800} step={5}
                          onCommit={pct => canvasRefs.current[id]?.setZoom(pct / 100)}
                        />
                      </div>

                      {/* Crop / Split / BG Blur */}
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => void handleSave(id)}
                          disabled={savingSlide === SLIDE_TYPE_MAP[id]}
                          className={BTN_ICON}
                          title="Save template"
                        >
                          {savingSlide === SLIDE_TYPE_MAP[id] ? (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
                              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                            </svg>
                          ) : savedFeedback === id ? (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          ) : (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                              <polyline points="17 21 17 13 7 13 7 21"/>
                              <polyline points="7 3 7 8 15 8"/>
                            </svg>
                          )}
                        </button>
                        <button
                          onClick={() => canvasRefs.current[id]?.enterCropMode()}
                          className={BTN_ICON}
                          title="Crop"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"/><path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"/>
                          </svg>
                        </button>

                        {slide.imageSrc && (
                          <>
                            <button
                              onClick={() => canvasRefs.current[id]?.toggleSplit()}
                              disabled={bgState.isBgProcessing}
                              title="Split layers"
                              className={`${BTN_TEXT} ${
                                splitActive
                                  ? 'bg-white text-black border-white'
                                  : bgState.bgProcessError
                                    ? 'bg-red-900/50 text-red-400 border-red-800 hover:bg-red-900'
                                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
                              }`}
                            >
                              {bgState.isBgProcessing ? (
                                <>
                                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}>
                                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                                  </svg>
                                  Processing…
                                </>
                              ) : bgState.bgProcessError ? 'Retry' : splitActive ? 'Split: On' : 'Split'}
                            </button>

                            {bgState.fgMaskReady && (
                              <button
                                onClick={() => canvasRefs.current[id]?.toggleBlur()}
                                title="Blur background"
                                className={`${BTN_TEXT} ${
                                  blurActive
                                    ? 'bg-white text-black border-white'
                                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
                                }`}
                              >
                                {blurActive ? 'Blur: On' : 'BG Blur'}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Canvas */}
                <div
                  onClick={() => setSelectedId(id)}
                  className={`relative cursor-pointer transition-all duration-150 mt-1 ${
                    isSelected
                      ? 'ring-2 ring-white ring-offset-2 ring-offset-black'
                      : 'ring-1 ring-zinc-800 hover:ring-zinc-600'
                  }`}
                >
                  <CarouselCanvas
                    ref={r => { canvasRefs.current[id] = r; }}
                    rectMode={true}
                    invertedSlots={index === 2}
                    imageSrc={slide.imageSrc}
                    headline={slide.headline}
                    subheadline={slide.subheadline}
                    settings={slide.settings}
                    onScaleChange={s => updateSlide(id, { scale: s })}
                    onSettingsChange={partial => updateSettings(id, partial)}
                    onBgLayerStateChange={s => updateSlide(id, { bgState: s })}
                    brandLogoSrc={brand.logoSrc || undefined}
                    onRecordingStateChange={state => updateSlide(id, { recordingState: state })}
                    onHeadlineChange={text => updateSlide(id, { headline: text })}
                    onSubheadlineChange={text => updateSlide(id, { subheadline: text })}
                    isDraggingElement={isDraggingElement}
                  />
                </div>

              </div>
            );
          })}
        </div>
      </div>

      {/* Settings panel */}
      <div className="fixed top-[52px] right-0 z-20 bg-transparent w-[360px] h-[calc(100vh-52px)] flex flex-col">
        <CarouselSettingsPanel
          settings={selectedSlide.settings}
          onChange={partial => updateSettings(selectedId, partial)}
          videoMode={false}
        />
      </div>

    </div>
  );
}
