// Renders a template doc at its native size (e.g. 1080x1350). Layers stack
// top-to-bottom in a flex column: each layer's vertical position is determined
// by the rendered height of the layers above it plus its own gapTop. This is
// what makes a wrapped headline push the subcaption down instead of overlapping
// it. Horizontal position is still freely set (per-layer x), so layers can be
// indented, full-width, or aligned right.
//
// The editor reuses this exact layout structure and overlays interaction
// affordances inside each layer's wrapper, so what you drag is always exactly
// where the content renders.

import { forwardRef } from "react";
import type {
  Layer,
  TemplateDoc,
  TextLayer,
  ImageLayer,
  ShapeLayer,
  PopulateContext,
  CopyOverrides,
  LayoutOverrides,
  LayoutOverride,
} from "./templateModel";
import { resolveText, resolveImageSrc, groupRows, pinnedLayers } from "./templateModel";

interface Props {
  doc: TemplateDoc;
  context?: PopulateContext | null;          // when present, role-tagged layers are populated
  overrides?: CopyOverrides | null;          // DeepSeek-rewritten copy by layer id
  layoutOverrides?: LayoutOverrides | null;  // per-card photo reframe (and x nudge)
  refEl?: React.Ref<HTMLDivElement>;
  // Editor-only: render an interactive overlay inside each layer's wrapper.
  // The fn receives the layer and must return absolutely-positioned content
  // that fits within the wrapper's box.
  layerOverlay?: (layer: Layer) => React.ReactNode;
  // Editor-only: grid step in template px. Renders a faint background grid
  // when > 0. Ignored in production renders.
  gridStep?: number;
}

export function TemplateRenderer({
  doc,
  context = null,
  overrides = null,
  layoutOverrides = null,
  refEl,
  layerOverlay,
  gridStep = 0,
}: Props) {
  // Layers flow in array order (top → bottom), grouped into rows. Within a
  // row, layers sit side-by-side at their own x. z-index controls paint
  // order *within* a slot.
  const rows = groupRows(doc.layers);
  return (
    <div
      ref={refEl}
      style={{
        width: doc.width,
        height: doc.height,
        background: doc.background,
        position: "relative",
        overflow: "hidden",
        boxSizing: "border-box",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        backgroundImage: gridStep > 0
          ? `linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
             linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)`
          : undefined,
        backgroundSize: gridStep > 0 ? `${gridStep}px ${gridStep}px` : undefined,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          width: "100%",
        }}
      >
        {rows.map((row, rowIdx) => (
          <div
            key={row[0].id}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "flex-start",
              marginTop: rowIdx === 0 ? row[0].gapTop : row[0].gapTop,
              width: "100%",
            }}
          >
            {row.map((l, colIdx) => {
              const prev = colIdx > 0 ? row[colIdx - 1] : null;
              // For the first item in a row, marginLeft = its x (offset from
              // the canvas left edge). For subsequent items, marginLeft is
              // the gap from the previous item's right edge to this item's
              // x — letting users place items at any x within the row.
              const marginLeft = prev ? (l.x - prev.x - prev.width) : l.x;
              return (
                <LayerSlot
                  key={l.id}
                  layer={l}
                  marginLeft={marginLeft}
                  context={context}
                  overrides={overrides}
                  layoutOverride={layoutOverrides?.[l.id] ?? null}
                  overlay={layerOverlay?.(l)}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Pinned layers — absolutely positioned, outside the flex flow. They
          live wherever the user dragged them. */}
      {pinnedLayers(doc.layers).map((l) => (
        <PinnedSlot
          key={l.id}
          layer={l}
          context={context}
          overrides={overrides}
          layoutOverride={layoutOverrides?.[l.id] ?? null}
          overlay={layerOverlay?.(l)}
        />
      ))}
    </div>
  );
}

// Same content as LayerSlot but absolutely positioned via the layer's x/y.
function PinnedSlot({
  layer,
  context,
  overrides,
  layoutOverride,
  overlay,
}: {
  layer: Layer;
  context: PopulateContext | null;
  overrides: CopyOverrides | null;
  layoutOverride: LayoutOverride | null;
  overlay: React.ReactNode;
}) {
  const xDelta = (layoutOverride?.x ?? layer.x) - layer.x;
  const wrapStyle: React.CSSProperties = {
    position: "absolute",
    left: layer.x + xDelta,
    top: layer.y,
    width: layer.width,
    height: layer.height,
    opacity: layer.opacity,
    transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
    transformOrigin: "top left",
    zIndex: layer.zIndex,
  };
  return (
    <div style={wrapStyle} data-layer-id={layer.id}>
      {layer.type === "text" && (
        <TextView layer={layer} context={context} overrides={overrides} />
      )}
      {layer.type === "image" && (
        <ImageView layer={layer} context={context} layoutOverride={layoutOverride} />
      )}
      {layer.type === "shape" && <ShapeView layer={layer} />}
      {overlay}
    </div>
  );
}

// Wrapper that gives the layer its slot in the row (marginLeft, width) and
// hosts the editor overlay (if any) absolutely on top of the content. The
// vertical gap is handled by the row container, not here.
function LayerSlot({
  layer,
  marginLeft,
  context,
  overrides,
  layoutOverride,
  overlay,
}: {
  layer: Layer;
  marginLeft: number;
  context: PopulateContext | null;
  overrides: CopyOverrides | null;
  layoutOverride: LayoutOverride | null;
  overlay: React.ReactNode;
}) {
  // Per-card override can nudge x at render time without mutating the doc.
  // We treat that as a delta from the layer's stored x (since stored x is
  // already baked into marginLeft above), applied here as additional left
  // offset.
  const xDelta = (layoutOverride?.x ?? layer.x) - layer.x;
  const wrapStyle: React.CSSProperties = {
    marginLeft: marginLeft + xDelta,
    width: layer.width,
    flexShrink: 0,
    position: "relative",
    opacity: layer.opacity,
    transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
    transformOrigin: "top left",
    zIndex: layer.zIndex,
  };
  return (
    <div style={wrapStyle} data-layer-id={layer.id}>
      {layer.type === "text" && (
        <TextView layer={layer} context={context} overrides={overrides} />
      )}
      {layer.type === "image" && (
        <ImageView layer={layer} context={context} layoutOverride={layoutOverride} />
      )}
      {layer.type === "shape" && <ShapeView layer={layer} />}
      {overlay}
    </div>
  );
}

function TextView({
  layer,
  context,
  overrides,
}: {
  layer: TextLayer;
  context: PopulateContext | null;
  overrides: CopyOverrides | null;
}) {
  const content = resolveText(layer, context, overrides);
  return (
    <div
      style={{
        width: "100%",
        // Text height is content-driven — this is the whole point of the
        // stacked flow. The layer's stored `height` is only used for resize
        // affordance sizing in the editor; it does not constrain the box.
        color: layer.color,
        fontFamily: layer.fontFamily,
        fontSize: layer.fontSize,
        fontWeight: layer.fontWeight,
        fontStyle: layer.italic ? "italic" : "normal",
        textAlign: layer.textAlign,
        lineHeight: layer.lineHeight,
        letterSpacing: layer.letterSpacing,
        textTransform: layer.uppercase ? "uppercase" : "none",
        textShadow: layer.shadow ? "0 2px 12px rgba(0,0,0,0.6)" : undefined,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {content}
    </div>
  );
}

const ImageView = forwardRef<HTMLDivElement, {
  layer: ImageLayer;
  context: PopulateContext | null;
  layoutOverride: LayoutOverride | null;
}>(function ImageView({ layer, context, layoutOverride }, ref) {
  const src = resolveImageSrc(layer, context);
  const posX = layoutOverride?.objectPositionX ?? 50;
  const posY = layoutOverride?.objectPositionY ?? 50;
  return (
    <div
      ref={ref}
      style={{
        width: "100%",
        height: layer.height,
        overflow: "hidden",
        borderRadius: layer.borderRadius,
        background: "#1a1a1c",
      }}
    >
      {src && (
        <img
          src={src}
          alt=""
          crossOrigin="anonymous"
          style={{
            width: "100%",
            height: "100%",
            objectFit: layer.fit,
            objectPosition: `${posX}% ${posY}%`,
            display: "block",
          }}
        />
      )}
    </div>
  );
});

function ShapeView({ layer }: { layer: ShapeLayer }) {
  const w = layer.width;
  const h = layer.height;
  const sw = Math.max(0, layer.borderWidth ?? 0);
  const stroke = sw > 0 ? (layer.borderColor ?? "#000") : "none";
  // Inset the geometry by half the stroke width so the border is fully
  // contained within the layer box (SVG strokes paint centered on the path).
  const inset = sw / 2;

  let body: React.ReactNode;
  switch (layer.shape) {
    case "rect": {
      body = (
        <rect
          x={inset}
          y={inset}
          width={Math.max(0, w - sw)}
          height={Math.max(0, h - sw)}
          fill={layer.fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
      break;
    }
    case "circle": {
      // Editor enforces width === height for circles, so this is a true
      // circle. If a legacy template has unequal sides we still draw the
      // largest centered circle that fits.
      const d = Math.min(w, h);
      const cx = w / 2;
      const cy = h / 2;
      const r = Math.max(0, d / 2 - inset);
      body = (
        <circle cx={cx} cy={cy} r={r} fill={layer.fill} stroke={stroke} strokeWidth={sw} />
      );
      break;
    }
    case "triangle": {
      // Upward-pointing isosceles triangle filling the bounds.
      const pts = `${w / 2},${inset} ${w - inset},${h - inset} ${inset},${h - inset}`;
      body = (
        <polygon points={pts} fill={layer.fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
      );
      break;
    }
    case "chevronRight":
    case "chevronLeft":
    case "chevronUp":
    case "chevronDown": {
      // Filled chevron — a > shape with thickness. The "thickness" controls
      // how thick the chevron's arms are relative to its bounds.
      const T = 0.4; // arm thickness (fraction of the long dimension)
      const i = inset;
      let pts: string;
      if (layer.shape === "chevronRight") {
        pts = `${i},${i} ${w * (1 - T)},${i} ${w - i},${h / 2} ${w * (1 - T)},${h - i} ${i},${h - i} ${w * T},${h / 2}`;
      } else if (layer.shape === "chevronLeft") {
        pts = `${w - i},${i} ${w * T},${i} ${i},${h / 2} ${w * T},${h - i} ${w - i},${h - i} ${w * (1 - T)},${h / 2}`;
      } else if (layer.shape === "chevronUp") {
        pts = `${i},${h - i} ${i},${h * T} ${w / 2},${i} ${w - i},${h * T} ${w - i},${h - i} ${w / 2},${h * (1 - T)}`;
      } else {
        // chevronDown
        pts = `${i},${i} ${i},${h * (1 - T)} ${w / 2},${h - i} ${w - i},${h * (1 - T)} ${w - i},${i} ${w / 2},${h * T}`;
      }
      body = (
        <polygon points={pts} fill={layer.fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
      );
      break;
    }
  }

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: "block" }}
    >
      {body}
    </svg>
  );
}
