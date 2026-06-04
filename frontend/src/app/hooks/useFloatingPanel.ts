'use client';

// useFloatingPanel — the floating-widget mechanics shared by the Studio's
// draggable panels: drag-to-move (header is the grab handle), drag-to-resize
// (bottom-right grip), click-to-collapse, and localStorage persistence of all
// three so the panel stays where the user left it across refreshes.
//
// Modeled on PhonedeckMiniPanel's inline implementation and reused by
// BoardWidget. The consumer owns the markup; this hook owns the geometry:
//   const { panelRef, panelStyle, collapsed, onHeaderMouseDown, onResizeMouseDown } =
//     useFloatingPanel({ storageKey: 'studio.boardWidget', defaultSize: {...} });
//
// Position defaults to null so the consumer's className governs the resting
// spot (e.g. `fixed left-24 top-1/2 -translate-y-1/2`); the first drag pins an
// absolute position via inline style (and neutralizes any className transform).
// Pass defaultSize to start at an explicit size (inline width/height); omit it
// to let the className size the panel until the user first resizes.

import { useEffect, useRef, useState } from 'react';

// Which edge/corner a resize grip pulls. Compass directions; combine for
// corners (e.g. 'sw' = south-west). 'e'/'w' change width, 's'/'n' change
// height. 'w'/'n' also move the panel so the opposite edge stays anchored, so
// e.g. 'w' grows leftward and 's' grows downward.
export type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface UseFloatingPanelOptions {
  /** Prefix for the three localStorage keys (.collapsed/.position/.size). */
  storageKey: string;
  /** Initial explicit size. Omit to size via className until first resize. */
  defaultSize?: { w: number; h: number };
  minWidth?: number;
  minHeight?: number;
  defaultCollapsed?: boolean;
}

interface UseFloatingPanelReturn {
  panelRef: React.RefObject<HTMLDivElement | null>;
  panelStyle: React.CSSProperties;
  collapsed: boolean;
  setCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  dragging: boolean;
  resizing: boolean;
  onHeaderMouseDown: (e: React.MouseEvent) => void;
  /** Curried by direction: `onResizeMouseDown('e')`, `('s')`, or `('se')`. */
  onResizeMouseDown: (dir: ResizeDir) => (e: React.MouseEvent) => void;
}

export function useFloatingPanel({
  storageKey,
  defaultSize,
  minWidth = 220,
  minHeight = 140,
  defaultCollapsed = false,
}: UseFloatingPanelOptions): UseFloatingPanelReturn {
  // Position: null = default via className. {x,y} = absolute top-left, set on
  // first drag then sticky. Size: defaultSize (or null = className-sized).
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(defaultSize ?? null);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef({
    startMouseX: 0, startMouseY: 0,
    startPanelX: 0, startPanelY: 0,
    moved: false,
  });
  const resizeStateRef = useRef({
    startX: 0, startY: 0, startW: 0, startH: 0,
    startLeft: 0, startTop: 0, startRight: 0, startBottom: 0,
    dir: 'se' as ResizeDir,
  });
  const hydratedRef = useRef(false);

  // Hydrate collapsed + position + size from localStorage.
  useEffect(() => {
    try {
      const c = window.localStorage.getItem(`${storageKey}.collapsed`);
      if (c === 'true') setCollapsed(true);
      else if (c === 'false') setCollapsed(false);
      const p = window.localStorage.getItem(`${storageKey}.position`);
      if (p) {
        const parsed = JSON.parse(p) as { x: number; y: number };
        if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') setPosition(parsed);
      }
      const s = window.localStorage.getItem(`${storageKey}.size`);
      if (s) {
        const parsed = JSON.parse(s) as { w: number; h: number };
        if (typeof parsed?.w === 'number' && typeof parsed?.h === 'number') setSize(parsed);
      }
    } catch { /* ignore */ }
    hydratedRef.current = true;
  }, [storageKey]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try { window.localStorage.setItem(`${storageKey}.collapsed`, String(collapsed)); } catch { /* ignore */ }
  }, [collapsed, storageKey]);
  useEffect(() => {
    if (!hydratedRef.current) return;
    try { if (position) window.localStorage.setItem(`${storageKey}.position`, JSON.stringify(position)); } catch { /* ignore */ }
  }, [position, storageKey]);
  useEffect(() => {
    if (!hydratedRef.current) return;
    try { if (size) window.localStorage.setItem(`${storageKey}.size`, JSON.stringify(size)); } catch { /* ignore */ }
  }, [size, storageKey]);

  // Drag — header is the grab handle. Clicking the header (no movement past a
  // 3px threshold) toggles collapse instead of moving.
  const onHeaderMouseDown = (e: React.MouseEvent) => {
    if (!panelRef.current) return;
    e.preventDefault();
    const rect = panelRef.current.getBoundingClientRect();
    dragStateRef.current = {
      startMouseX: e.clientX, startMouseY: e.clientY,
      startPanelX: rect.left, startPanelY: rect.top,
      moved: false,
    };
    setDragging(true);
  };
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const ds = dragStateRef.current;
      const dx = e.clientX - ds.startMouseX;
      const dy = e.clientY - ds.startMouseY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) ds.moved = true;
      if (ds.moved) {
        // Clamp so at least 60px stays on-screen (so the user can always grab
        // it back if dragged near an edge).
        const w = panelRef.current?.offsetWidth ?? 256;
        const maxX = window.innerWidth - 60;
        const maxY = window.innerHeight - 30;
        setPosition({
          x: Math.max(60 - w, Math.min(maxX, ds.startPanelX + dx)),
          y: Math.max(0, Math.min(maxY, ds.startPanelY + dy)),
        });
      }
    };
    const onUp = () => {
      setDragging(false);
      if (!dragStateRef.current.moved) setCollapsed((c) => !c);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  // Resize — edge/corner grips. You only resize the dimension(s) you grab, and
  // the opposite edge stays put: 'e' grows right, 'w' grows left, 's' grows
  // down, 'n' grows up. Size + position stick (localStorage).
  const onResizeMouseDown = (dir: ResizeDir) => (e: React.MouseEvent) => {
    if (!panelRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = panelRef.current.getBoundingClientRect();
    resizeStateRef.current = {
      startX: e.clientX, startY: e.clientY,
      startW: rect.width, startH: rect.height,
      startLeft: rect.left, startTop: rect.top,
      startRight: rect.right, startBottom: rect.bottom,
      dir,
    };
    // Pin the panel to its current rect first. Until now it may be sitting at a
    // className resting spot (possibly centered via a CSS translate); pinning an
    // explicit position lets us hold one edge fixed while the opposite one moves.
    if (!position) setPosition({ x: rect.left, y: rect.top });
    setResizing(true);
  };
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const rs = resizeStateRef.current;
      const dx = e.clientX - rs.startX;
      const dy = e.clientY - rs.startY;
      const maxW = window.innerWidth - 40;
      const maxH = window.innerHeight - 40;

      let w = rs.startW;
      let h = rs.startH;
      let nx: number | null = null; // new left, when the right edge is anchored
      let ny: number | null = null; // new top, when the bottom edge is anchored
      if (rs.dir.includes('e')) w = Math.max(minWidth, Math.min(maxW, rs.startW + dx));
      if (rs.dir.includes('w')) { w = Math.max(minWidth, Math.min(maxW, rs.startW - dx)); nx = rs.startRight - w; }
      if (rs.dir.includes('s')) h = Math.max(minHeight, Math.min(maxH, rs.startH + dy));
      if (rs.dir.includes('n')) { h = Math.max(minHeight, Math.min(maxH, rs.startH - dy)); ny = rs.startBottom - h; }

      setSize({ w, h });
      if (nx !== null || ny !== null) {
        setPosition((p) => ({
          x: nx ?? p?.x ?? rs.startLeft,
          y: ny ?? p?.y ?? rs.startTop,
        }));
      }
    };
    const onUp = () => setResizing(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizing, minWidth, minHeight]);

  // When position is null the className governs the resting spot. Once dragged
  // (or a saved position hydrated), pin via inline style. Crucially we clear
  // BOTH `translate` and `transform`: a centered resting spot uses
  // `-translate-y-1/2`, which in Tailwind v4 compiles to the CSS `translate`
  // property (not `transform`). Leaving it set would offset the pinned coords by
  // half the panel height, making a drag feel like it's grabbed from the middle.
  // Height only applies when expanded — collapsed shows the header alone.
  const panelStyle: React.CSSProperties = {
    ...(position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto', translate: 'none', transform: 'none' } : {}),
    ...(size ? { width: size.w } : {}),
    ...(size && !collapsed ? { height: size.h } : {}),
  };

  return { panelRef, panelStyle, collapsed, setCollapsed, dragging, resizing, onHeaderMouseDown, onResizeMouseDown };
}
