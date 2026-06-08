'use client';

import { useRef, useEffect } from 'react';
import type { MutableRefObject } from 'react';
import { DISPLAY_SCALE, MIN_DIM } from '../constants';
import type { Box, Handle } from '../types';

interface DragState {
  handle: Handle;
  sx: number;
  sy: number;
  sb: Box;
  videoOffsetStart: { x: number; y: number };
}

interface UseDragParams {
  boxRef: MutableRefObject<Box>;
  setBox: (b: Box) => void;
  videoOffsetRef: MutableRefObject<{ x: number; y: number }>;
  // Called once a resize-handle drag ends (not a 'move'/pan), so the caller can
  // re-balance the block's vertical position around the new photo size.
  onResizeEnd?: () => void;
}

export function useDrag({ boxRef, setBox, videoOffsetRef, onResizeEnd }: UseDragParams) {
  const drag = useRef<DragState | null>(null);
  const isDraggingRef = useRef(false);
  const onResizeEndRef = useRef(onResizeEnd);
  onResizeEndRef.current = onResizeEnd;

  useEffect(() => {
    function applyDrag(dx: number, dy: number, shiftKey: boolean) {
      if (!drag.current) return;
      const { handle: h, sb, videoOffsetStart } = drag.current;
      let nx = sb.x, ny = sb.y, nw = sb.w, nh = sb.h;

      if (h === 'move') {
        // Reframe pans vertically only — the clip is fit to the frame width, so
        // dragging left/right would just slide it off into empty bars. Lock x to
        // where it started and apply the vertical delta only.
        videoOffsetRef.current = { x: videoOffsetStart.x, y: videoOffsetStart.y + dy };
        return;
      }

      switch (h) {
        case 'br': case 'bl':
          nh = Math.max(MIN_DIM, shiftKey ? sb.h + dy * 2 : sb.h + dy);
          if (shiftKey) ny = sb.y - dy;
          break;
        case 'tr': case 'tl': case 'tc':
          nh = Math.max(MIN_DIM, shiftKey ? sb.h - dy * 2 : sb.h - dy);
          ny = shiftKey ? sb.y + dy : sb.y + sb.h - nh;
          break;
        case 'bc':
          nh = Math.max(MIN_DIM, shiftKey ? sb.h + dy * 2 : sb.h + dy);
          if (shiftKey) ny = sb.y - dy;
          break;
      }

      const b = { x: nx, y: ny, w: nw, h: nh };
      boxRef.current = b;
      setBox({ ...b });
    }

    function onMove(e: MouseEvent) {
      if (!drag.current) return;
      isDraggingRef.current = true;
      applyDrag(
        (e.clientX - drag.current.sx) / DISPLAY_SCALE,
        (e.clientY - drag.current.sy) / DISPLAY_SCALE,
        e.shiftKey,
      );
    }
    function onUp() {
      const resized = !!drag.current && drag.current.handle !== 'move' && isDraggingRef.current;
      drag.current = null;
      isDraggingRef.current = false;
      if (resized) onResizeEndRef.current?.();
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  function startDrag(e: React.MouseEvent, handle: Handle) {
    e.preventDefault();
    e.stopPropagation();
    drag.current = {
      handle,
      sx: e.clientX,
      sy: e.clientY,
      sb: { ...boxRef.current },
      videoOffsetStart: { ...videoOffsetRef.current },
    };
  }

  return { startDrag, isDraggingRef };
}
