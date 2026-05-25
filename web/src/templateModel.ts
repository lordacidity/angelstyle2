// Shared template data model. The editor manipulates these, the renderer draws
// them, and the server stores them as a JSON blob (no SQL columns per field).

export const TEXT_ROLES = [
  "headline",
  "subcaption",
  "talentName",
  "ticker",
  "priceUsd",
  "changePct",
  "source",
  "date",
  "logo",
  "static",
] as const;
export type TextRole = (typeof TEXT_ROLES)[number];

export const IMAGE_ROLES = ["mainPhoto", "logo", "decorative"] as const;
export type ImageRole = (typeof IMAGE_ROLES)[number];

export interface BaseLayer {
  id: string;
  // x is the layer's left offset within its row (template px).
  x: number;
  // Legacy absolute y. Kept for round-tripping older templates; the renderer
  // ignores it and uses flow + gapTop. Migration converts y → gapTop on load.
  y: number;
  width: number;
  height: number;
  // Vertical gap above this layer's row (only used when sameRow is false).
  gapTop: number;
  // When true, this layer joins the previous layer's row instead of starting
  // a new row below it. Multiple layers in a row sit side-by-side, each at
  // its own x. Row height = max(member heights). gapTop is ignored for
  // sameRow layers — the row's gap comes from its first member.
  sameRow: boolean;
  rotation: number;
  opacity: number;
  zIndex: number;
  // When true, this layer is absolutely positioned via x/y in template-px,
  // outside the flow. Used for image/shape layers so they can be dropped
  // anywhere in empty space without reordering other layers. Text layers
  // stay in flow by default so wrapped headlines push subcaptions down.
  pinned?: boolean;
}

// Snap step for editor moves/resizes. Same value drives the grid overlay.
export const GRID = 20;
export const snap = (v: number): number => Math.round(v / GRID) * GRID;

export interface TextLayer extends BaseLayer {
  type: "text";
  role: TextRole;
  content: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  textAlign: "left" | "center" | "right";
  lineHeight: number;
  letterSpacing: number;
  italic: boolean;
  uppercase: boolean;
  shadow: boolean;
}

export interface ImageLayer extends BaseLayer {
  type: "image";
  role: ImageRole;
  src: string;
  fit: "cover" | "contain";
  borderRadius: number;
}

export const SHAPES = [
  "rect",
  "circle",
  "triangle",
  "chevronRight",
  "chevronLeft",
  "chevronUp",
  "chevronDown",
] as const;
export type ShapeKind = (typeof SHAPES)[number];

export const SHAPE_LABEL: Record<ShapeKind, string> = {
  rect: "Rectangle",
  circle: "Circle",
  triangle: "Triangle",
  chevronRight: "Chevron →",
  chevronLeft: "Chevron ←",
  chevronUp: "Chevron ↑",
  chevronDown: "Chevron ↓",
};

export interface ShapeLayer extends BaseLayer {
  type: "shape";
  role: "decorative";
  shape: ShapeKind;
  fill: string;
  // Optional border (stroke). 0 or missing = no border.
  borderWidth?: number;
  borderColor?: string;
}

export type Layer = TextLayer | ImageLayer | ShapeLayer;

export interface TemplateDoc {
  width: number;
  height: number;
  background: string;
  layers: Layer[];
}

export interface TemplateRow {
  id: string;
  name: string;
  doc: TemplateDoc;
  createdAt: string;
  updatedAt: string;
}

// The data passed in when rendering a populated card.
export interface PopulateContext {
  photoUrl: string;
  headline: string;
  source: string | null;
  pubDate: string | null;
  pauvAngle: string;
  talent: {
    name: string;
    ticker: string;
    industry: string | null;
    subcategory: string | null;
    location: string | null;
    bio: string | null;
    price: {
      usd: number | null;
      lifetimeChangePct: number | null;
      holders: number | null;
      volumeLifetimeUsd: number | null;
    };
  };
}

// Optional copy rewritten by DeepSeek, keyed by layer id.
export type CopyOverrides = Record<string, string>;

// Per-card layout tweaks applied at render time but NOT saved to the template.
// Lets the user move text + reframe the main photo for one specific card
// without altering the template's defaults.
export interface LayoutOverride {
  x?: number;
  y?: number;
  // For image layers (typically the mainPhoto using fit:cover) — % shift of
  // the visible window into the image. 50/50 = centered (CSS default).
  // 0/0 = top-left visible; 100/100 = bottom-right visible.
  objectPositionX?: number;
  objectPositionY?: number;
}
export type LayoutOverrides = Record<string, LayoutOverride>;

function fmtUsd(n: number | null): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}
function fmtPct(n: number | null): string {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}
function fmtDate(s: string | null): string {
  if (!s) return "";
  try { return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  catch { return s; }
}

// Map a text layer's role to its populated content, with optional rewrites
// from DeepSeek overriding for headline/subcaption.
export function resolveText(
  layer: TextLayer,
  ctx: PopulateContext | null,
  overrides: CopyOverrides | null,
): string {
  if (!ctx) return layer.content;
  if (overrides && overrides[layer.id] != null) return overrides[layer.id];
  switch (layer.role) {
    case "headline": return ctx.headline;
    case "subcaption": return ctx.pauvAngle;
    case "talentName": return ctx.talent.name;
    case "ticker": return `$${ctx.talent.ticker.toUpperCase()}`;
    case "priceUsd": return fmtUsd(ctx.talent.price.usd);
    case "changePct": return fmtPct(ctx.talent.price.lifetimeChangePct);
    case "source": return ctx.source ?? "";
    case "date": return fmtDate(ctx.pubDate);
    case "logo":
    case "static":
    default:
      return layer.content;
  }
}

export function resolveImageSrc(layer: ImageLayer, ctx: PopulateContext | null): string {
  if (!ctx) return layer.src;
  if (layer.role === "mainPhoto") return ctx.photoUrl;
  return layer.src;
}

// A reasonable starting template — Pauv wordmark up top, main photo hero, big
// headline, sub-caption, price line. New users get this so they're not
// staring at an empty canvas.
export function defaultTemplate(): TemplateDoc {
  return {
    width: 1080,
    height: 1350,
    background: "#0a0a0b",
    layers: [
      {
        id: "logo",
        type: "text",
        role: "logo",
        x: 40, y: 32, width: 1000, height: 60, gapTop: 40, sameRow: false,
        rotation: 0, opacity: 1, zIndex: 10,
        content: "PAUV",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        fontSize: 32, fontWeight: 800,
        color: "#fafafa",
        textAlign: "left",
        lineHeight: 1, letterSpacing: 6,
        italic: false, uppercase: true, shadow: false,
      },
      {
        id: "photo",
        type: "image",
        role: "mainPhoto",
        x: 40, y: 120, width: 1000, height: 700, gapTop: 20, sameRow: false,
        rotation: 0, opacity: 1, zIndex: 1,
        src: "https://placehold.co/1000x700/1a1a1c/666?text=Main+Photo",
        fit: "cover", borderRadius: 16,
      },
      {
        id: "headline",
        type: "text",
        role: "headline",
        x: 40, y: 860, width: 1000, height: 200, gapTop: 40, sameRow: false,
        rotation: 0, opacity: 1, zIndex: 10,
        content: "Headline goes here",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        fontSize: 64, fontWeight: 800,
        color: "#fafafa",
        textAlign: "left",
        lineHeight: 1.05, letterSpacing: -1,
        italic: false, uppercase: false, shadow: false,
      },
      {
        id: "subcaption",
        type: "text",
        role: "subcaption",
        x: 40, y: 1080, width: 1000, height: 140, gapTop: 20, sameRow: false,
        rotation: 0, opacity: 0.85, zIndex: 10,
        content: "Sub-caption with the Pauv angle",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        fontSize: 26, fontWeight: 500,
        color: "#d1d5db",
        textAlign: "left",
        lineHeight: 1.35, letterSpacing: 0,
        italic: true, uppercase: false, shadow: false,
      },
      {
        id: "priceLine",
        type: "text",
        role: "priceUsd",
        x: 40, y: 1240, width: 600, height: 60, gapTop: 40, sameRow: false,
        rotation: 0, opacity: 1, zIndex: 10,
        content: "$0.00",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        fontSize: 44, fontWeight: 800,
        color: "#22c55e",
        textAlign: "left",
        lineHeight: 1, letterSpacing: 0,
        italic: false, uppercase: false, shadow: false,
      },
      {
        id: "tickerLine",
        type: "text",
        role: "ticker",
        x: 700, y: 1255, width: 340, height: 40, gapTop: 20, sameRow: true,
        rotation: 0, opacity: 0.7, zIndex: 10,
        content: "$TICKER",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        fontSize: 24, fontWeight: 600,
        color: "#9ca3af",
        textAlign: "right",
        lineHeight: 1, letterSpacing: 2,
        italic: false, uppercase: true, shadow: false,
      },
    ],
  };
}

// Convert an older absolute-positioned doc into the stacked model:
//   • Sort by y, then derive gapTop from y-deltas.
//   • Layers whose y-range overlaps the previous layer's y-range get
//     sameRow: true so they sit side-by-side instead of stacking.
// Pure — returns a new doc, never mutates the input.
export function migrateToStack(doc: TemplateDoc): TemplateDoc {
  const sorted = [...doc.layers].sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
  let rowTop = 0;
  let rowBottom = 0;
  let rowGap = 0;
  const layers = sorted.map((l, i) => {
    const hasFlowFields = typeof (l as Partial<Layer>).gapTop === "number"
      && typeof (l as Partial<Layer>).sameRow === "boolean";
    if (hasFlowFields) {
      // Already migrated — pass through.
      if (!l.sameRow) {
        rowTop = (l.y ?? 0);
        rowBottom = rowTop + (l.height ?? 0);
        rowGap = l.gapTop;
      } else {
        rowBottom = Math.max(rowBottom, (l.y ?? 0) + (l.height ?? 0));
      }
      return l;
    }
    const y = l.y ?? 0;
    const h = l.height ?? 0;
    // Side-by-side test: starts before the current row ends.
    const onSameRow = i > 0 && y < rowBottom;
    let gapTop: number;
    let sameRow: boolean;
    if (onSameRow) {
      sameRow = true;
      gapTop = rowGap;
      rowBottom = Math.max(rowBottom, y + h);
    } else {
      sameRow = false;
      gapTop = i === 0 ? Math.max(0, y) : Math.max(0, y - rowBottom);
      rowTop = y;
      rowBottom = y + h;
      rowGap = gapTop;
    }
    return { ...l, gapTop, sameRow } as Layer;
  });
  return { ...doc, layers };
}

// Group consecutive layers into rows for rendering. The first layer always
// starts a new row; layers with sameRow=true join the row above them. Pinned
// layers are skipped — they render absolutely positioned outside the flow.
export function groupRows(layers: Layer[]): Layer[][] {
  const rows: Layer[][] = [];
  for (const l of layers) {
    if (l.pinned) continue;
    if (l.sameRow && rows.length > 0) {
      rows[rows.length - 1].push(l);
    } else {
      rows.push([l]);
    }
  }
  return rows;
}

export function pinnedLayers(layers: Layer[]): Layer[] {
  return layers.filter((l) => l.pinned);
}

export function newLayerId(): string {
  return Math.random().toString(36).slice(2, 10);
}
