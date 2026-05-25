// Per-card drag overlay used in the build-card step. Sits as a sibling of the
// rendered card and projects an invisible hit box over each text layer (drag
// to nudge X — vertical position is determined by the stacked flow and is no
// longer per-card adjustable) and the mainPhoto (drag to reframe via
// objectPosition). All changes go into layoutOverrides — they do NOT modify
// the underlying template doc.
//
// Because vertical position is content-driven (text wraps and shifts the
// stack), we measure each layer's actual rendered box from the DOM rather
// than reading layer.x/y. The card's root element is passed in via cardEl.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  TemplateDoc,
  Layer,
  ImageLayer,
  LayoutOverride,
  LayoutOverrides,
} from "./templateModel";

interface Props {
  doc: TemplateDoc;
  overrides: LayoutOverrides;
  // The rendered card's root element. We query its descendants for
  // [data-layer-id] to discover actual rendered positions.
  cardEl: HTMLElement | null;
  // Wrapper's CSS-transform scale. Drag deltas in screen pixels are divided by
  // this to convert back to template coordinates.
  scale: number;
  onChange: (next: LayoutOverrides) => void;
}

// % of objectPosition shift per template-pixel of pan-drag. Tuned by feel —
// at 0.15, a ~200px drag panes the photo about a third of its overflow.
const PAN_SENSITIVITY = 0.15;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

interface Box { id: string; layer: Layer; top: number; left: number; width: number; height: number }

export function CardLayoutOverlay({ doc, overrides, cardEl, scale, onChange }: Props) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;

  // Measured layer rects in template-px, relative to cardEl.
  const [boxes, setBoxes] = useState<Box[]>([]);

  // Re-measure whenever the doc, overrides (text content can change), or
  // cardEl change. useLayoutEffect runs before paint so the hit boxes never
  // lag visibly behind the rendered content. The dep array is mandatory —
  // without it this re-runs every render, calls setBoxes, triggers another
  // render → infinite loop.
  useLayoutEffect(() => {
    if (!cardEl) { setBoxes([]); return; }
    const cardRect = cardEl.getBoundingClientRect();
    const next: Box[] = [];
    for (const l of doc.layers) {
      const isText = l.type === "text";
      const isMainPhoto = l.type === "image" && (l as ImageLayer).role === "mainPhoto";
      if (!isText && !isMainPhoto) continue;
      const el = cardEl.querySelector(`[data-layer-id="${l.id}"]`) as HTMLElement | null;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      next.push({
        id: l.id,
        layer: l,
        // getBoundingClientRect is in screen px (post-scale). Divide by scale
        // to translate to template px so we can position the overlay sibling
        // in the same template coordinate space as the card.
        top: (r.top - cardRect.top) / scale,
        left: (r.left - cardRect.left) / scale,
        width: r.width / scale,
        height: r.height / scale,
      });
    }
    setBoxes(next);
  }, [doc, overrides, cardEl, scale]);

  const dragRef = useRef<{
    layerId: string;
    mode: "move" | "pan";
    startScreenX: number;
    startScreenY: number;
    baseX: number;
    baseY: number;
  } | null>(null);

  const begin = (e: React.PointerEvent, layer: Layer, mode: "move" | "pan") => {
    e.stopPropagation();
    e.preventDefault();
    const cur = overridesRef.current[layer.id] ?? {};
    dragRef.current = {
      layerId: layer.id,
      mode,
      startScreenX: e.clientX,
      startScreenY: e.clientY,
      baseX: mode === "move" ? (cur.x ?? layer.x) : (cur.objectPositionX ?? 50),
      baseY: mode === "move" ? 0 : (cur.objectPositionY ?? 50),
    };
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const st = dragRef.current;
      if (!st) return;
      const dxTpl = (e.clientX - st.startScreenX) / scale;
      const dyTpl = (e.clientY - st.startScreenY) / scale;
      const cur = overridesRef.current[st.layerId] ?? {};
      let patch: LayoutOverride;
      if (st.mode === "move") {
        // Text layers only adjust X — Y is determined by the stacked flow.
        patch = { ...cur, x: Math.max(0, st.baseX + dxTpl) };
      } else {
        patch = {
          ...cur,
          objectPositionX: clamp(st.baseX - dxTpl * PAN_SENSITIVITY, 0, 100),
          objectPositionY: clamp(st.baseY - dyTpl * PAN_SENSITIVITY, 0, 100),
        };
      }
      onChangeRef.current({ ...overridesRef.current, [st.layerId]: patch });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [scale]);

  return (
    <>
      {boxes.map((b) => {
        const isMainPhoto = b.layer.type === "image";
        const mode: "move" | "pan" = isMainPhoto ? "pan" : "move";
        return (
          <div
            key={b.id}
            onPointerDown={(e) => begin(e, b.layer, mode)}
            title={mode === "pan" ? "Drag to reframe the photo" : "Drag to reposition horizontally"}
            style={{
              position: "absolute",
              left: b.left,
              top: b.top,
              width: b.width,
              height: b.height,
              cursor: mode === "pan" ? "grab" : "ew-resize",
              border: "1px dashed rgba(34, 197, 94, 0.55)",
              boxSizing: "border-box",
              touchAction: "none",
            }}
          />
        );
      })}
    </>
  );
}
