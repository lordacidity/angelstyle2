// Template editor. Layers stack in a flex column (see TemplateRenderer) so
// when the headline wraps the subcaption shifts down automatically. The
// interaction model:
//
//   • Click anywhere on a layer to select it. The whole layer body is the
//     drag target — there are no tiny grab dots; the whole card is alive.
//   • Body drag moves the layer: horizontal sets X, vertical reorders the
//     layer in the stack when it crosses a neighbor's vertical center.
//   • 8 resize handles + invisible edge strips: drag any edge to resize.
//       - left/right edges  → width (and x for left)
//       - top edge          → gapTop (the gap above this layer)
//       - bottom edge       → height (image/shape only; text is content-sized)
//   • Everything snaps to a 20px grid.

import { useEffect, useMemo, useRef, useState } from "react";
import { TemplateRenderer } from "./TemplateRenderer";
import {
  TEXT_ROLES, IMAGE_ROLES, defaultTemplate, newLayerId, migrateToStack, GRID, snap,
  type Layer, type TextLayer, type ImageLayer, type ShapeLayer,
  SHAPES, SHAPE_LABEL, type ShapeKind,
  type TemplateDoc, type TextRole, type ImageRole,
} from "./templateModel";

interface Props {
  initial: { id?: string; name: string; doc: TemplateDoc };
  onSave: (saved: { id: string; name: string; doc: TemplateDoc }) => void;
  onCancel: () => void;
}

// All resize directions: 4 corners + 4 edge midpoints. Edge strips along each
// side give the same direction as the matching edge handle, so users can
// grab any pixel of the border, not just the dot.
type Dir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const CORNER_DIRS: Dir[] = ["nw", "ne", "sw", "se"];
const EDGE_DIRS: Dir[] = ["n", "s", "e", "w"];

// Canvas display: figure out a scale that fits 1080x1350 in the viewport's
// editor pane comfortably. The renderer always draws at native size; we scale
// via CSS transform so html-to-image (used for export) still sees real pixels.
const CANVAS_DISPLAY_HEIGHT = 720;

export function TemplateEditor({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial.name);
  const [doc, setDoc] = useState<TemplateDoc>(() => migrateToStack(initial.doc));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);

  const canvasRef = useRef<HTMLDivElement>(null);

  const scale = CANVAS_DISPLAY_HEIGHT / doc.height;

  const selected = useMemo(
    () => doc.layers.find((l) => l.id === selectedId) ?? null,
    [doc.layers, selectedId],
  );

  // Patch helpers -----------------------------------------------------------
  const updateLayer = (id: string, patch: Partial<Layer>) => {
    setDoc((d) => ({
      ...d,
      layers: d.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)),
    }));
  };

  const deleteLayer = (id: string) => {
    setDoc((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  };

  const duplicateLayer = (id: string) => {
    setDoc((d) => {
      const idx = d.layers.findIndex((l) => l.id === id);
      if (idx < 0) return d;
      const copy = { ...d.layers[idx], id: newLayerId() } as Layer;
      const layers = [...d.layers];
      layers.splice(idx + 1, 0, copy);
      setSelectedId(copy.id);
      return { ...d, layers };
    });
  };

  // In stacked mode "front/back" means later/earlier in the column order.
  const moveLayer = (id: string, delta: number) => {
    setDoc((d) => {
      const idx = d.layers.findIndex((l) => l.id === id);
      const next = idx + delta;
      if (idx < 0 || next < 0 || next >= d.layers.length) return d;
      const layers = [...d.layers];
      const [it] = layers.splice(idx, 1);
      layers.splice(next, 0, it);
      return { ...d, layers };
    });
  };

  const addText = () => {
    const l: TextLayer = {
      id: newLayerId(), type: "text", role: "static",
      x: 40, y: 0, width: 1000, height: 80, gapTop: GRID * 2, sameRow: false,
      rotation: 0, opacity: 1,
      zIndex: 10,
      content: "New text",
      fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      fontSize: 40, fontWeight: 600, color: "#fafafa",
      textAlign: "left", lineHeight: 1.2, letterSpacing: 0,
      italic: false, uppercase: false, shadow: false,
    };
    setDoc((d) => ({ ...d, layers: [...d.layers, l] }));
    setSelectedId(l.id);
  };

  const addImage = () => {
    const l: ImageLayer = {
      id: newLayerId(), type: "image", role: "decorative",
      x: 40, y: 0, width: 1000, height: 600, gapTop: GRID * 2, sameRow: false,
      rotation: 0, opacity: 1, zIndex: 1,
      src: "https://placehold.co/1000x600/1a1a1c/666?text=Image",
      fit: "cover", borderRadius: 12,
    };
    setDoc((d) => ({ ...d, layers: [...d.layers, l] }));
    setSelectedId(l.id);
  };

  const addShape = () => {
    const l: ShapeLayer = {
      id: newLayerId(), type: "shape", role: "decorative",
      x: 40, y: 0, width: 1000, height: 200, gapTop: GRID * 2, sameRow: false,
      rotation: 0, opacity: 1, zIndex: 1,
      shape: "rect", fill: "#22c55e",
    };
    setDoc((d) => ({ ...d, layers: [...d.layers, l] }));
    setSelectedId(l.id);
  };

  // Pointer-driven drag & resize -------------------------------------------
  // For "move": dx snaps x, dy reorders the layer in the array when crossing
  // a neighbor's vertical midpoint. For resize: each direction edits the
  // corresponding side, snapping to GRID.

  const dragRef = useRef<{
    layerId: string;
    mode: "move" | Dir;
    startClientX: number;
    startClientY: number;
    startLayer: Layer;
    // Captured screen coords of every layer wrapper at drag start. Used during
    // move to decide when to reorder.
    layerCenters: Array<{ id: string; centerY: number }>;
  } | null>(null);

  const beginDrag = (e: React.PointerEvent, layer: Layer, mode: "move" | Dir) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedId(layer.id);
    // Snapshot every layer's screen-Y center so reorder-on-drag has a stable
    // reference (the live positions shift as we mutate the array).
    const els = canvasRef.current?.querySelectorAll<HTMLElement>("[data-layer-id]") ?? [];
    const layerCenters = Array.from(els).map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.layerId!, centerY: r.top + r.height / 2 };
    });
    dragRef.current = {
      layerId: layer.id,
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startLayer: { ...layer },
      layerCenters,
    };
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const st = dragRef.current;
      if (!st) return;
      const dx = (e.clientX - st.startClientX) / scale;
      const dy = (e.clientY - st.startClientY) / scale;

      if (st.mode === "move") {
        // Horizontal: free X, snapped.
        const newX = Math.max(0, snap(st.startLayer.x + dx));
        if (newX !== st.startLayer.x) {
          updateLayer(st.layerId, { x: newX } as Partial<Layer>);
        }
        // Vertical: reorder when pointer crosses neighbor centers.
        reorderByPointer(st.layerId, e.clientY, st.layerCenters);
        return;
      }

      // Resize. Each direction edits its side(s).
      const dir = st.mode;
      const s = st.startLayer;
      let patch: Partial<Layer> = {};
      if (dir.includes("w")) {
        // West edge: x grows / shrinks, width inversely.
        const newX = Math.max(0, snap(s.x + dx));
        const dxSnapped = newX - s.x;
        const newW = Math.max(GRID, s.width - dxSnapped);
        patch = { ...patch, x: newX, width: newW };
      }
      if (dir.includes("e")) {
        patch = { ...patch, width: Math.max(GRID, snap(s.width + dx)) };
      }
      if (dir.includes("n")) {
        // North edge: shrink/grow the gap above us. Can't go negative.
        const newGap = Math.max(0, snap((s.gapTop ?? 0) + dy));
        patch = { ...patch, gapTop: newGap };
      }
      if (dir.includes("s")) {
        // South edge: only meaningful for image/shape (text is content-sized).
        if (s.type !== "text") {
          patch = { ...patch, height: Math.max(GRID, snap(s.height + dy)) };
        }
      }
      if (Object.keys(patch).length > 0) {
        updateLayer(st.layerId, patch);
      }
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [scale]);

  // Reorder: if the pointer is closer to a different layer's center than the
  // dragged layer's current slot, move the dragged layer there. We use the
  // snapshot of centers from drag start — once we move into a new slot, the
  // pointer must travel to the *next* neighbor's center to move again, which
  // matches what feels right.
  const reorderByPointer = (
    layerId: string,
    clientY: number,
    centers: Array<{ id: string; centerY: number }>,
  ) => {
    // Find which captured slot is closest to the pointer.
    let nearest = centers[0];
    let nearestDist = Math.abs(clientY - centers[0].centerY);
    for (const c of centers) {
      const d = Math.abs(clientY - c.centerY);
      if (d < nearestDist) { nearest = c; nearestDist = d; }
    }
    if (nearest.id === layerId) return;
    setDoc((d) => {
      const layers = [...d.layers];
      const from = layers.findIndex((l) => l.id === layerId);
      const to = layers.findIndex((l) => l.id === nearest.id);
      if (from < 0 || to < 0 || from === to) return d;
      const [it] = layers.splice(from, 1);
      layers.splice(to, 0, it);
      return { ...d, layers };
    });
  };

  // Keyboard: delete/duplicate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedId) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteLayer(selectedId);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateLayer(selectedId);
      } else if (e.key === "ArrowUp" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        moveLayer(selectedId, -1);
      } else if (e.key === "ArrowDown" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        moveLayer(selectedId, 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, doc.layers]);

  // Save -------------------------------------------------------------------
  const save = async () => {
    if (!name.trim()) { setError("Name required"); return; }
    setSaving(true);
    setError(null);
    try {
      const url = initial.id ? `/api/templates/${initial.id}` : "/api/templates";
      const method = initial.id ? "PUT" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), doc }),
      });
      if (!r.ok) throw new Error(await r.text());
      const saved = await r.json();
      onSave({ id: saved.id, name: saved.name, doc: saved.doc });
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  // Editor overlay for one layer — drag body + 8 resize handles + edge strips.
  const renderLayerOverlay = (layer: Layer): React.ReactNode => {
    const isSel = layer.id === selectedId;
    return (
      <LayerOverlay
        key={`overlay-${layer.id}`}
        layer={layer}
        selected={isSel}
        onMoveStart={(e) => beginDrag(e, layer, "move")}
        onResizeStart={(e, dir) => beginDrag(e, layer, dir)}
      />
    );
  };

  return (
    <div className="template-editor">
      <div className="template-editor-header">
        <div className="row" style={{ gap: 8 }}>
          <button className="secondary" onClick={onCancel}>← Back</button>
          <input
            className="template-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Template name"
          />
        </div>
        <div className="row">
          <button className="secondary" onClick={() => setShowGrid((g) => !g)}>
            {showGrid ? "Grid ✓" : "Grid"}
          </button>
          <button className="secondary" onClick={addText}>+ Text</button>
          <button className="secondary" onClick={addImage}>+ Image</button>
          <button className="secondary" onClick={addShape}>+ Shape</button>
          <button onClick={save} disabled={saving}>{saving ? "Saving…" : "💾 Save"}</button>
        </div>
      </div>

      {error && <div className="status err" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="template-editor-body">
        {/* Canvas */}
        <div
          className="template-canvas-wrap"
          onPointerDown={(e) => {
            // Click empty canvas (not on a layer) → deselect.
            if ((e.target as HTMLElement).closest("[data-layer-id]")) return;
            setSelectedId(null);
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={(e) => {
            const file = Array.from(e.dataTransfer.files).find((f) =>
              f.type.startsWith("image/"),
            );
            if (!file) return;
            e.preventDefault();
            if (file.size > 5 * 1024 * 1024) {
              setError(`Image is ${(file.size / 1024 / 1024).toFixed(1)} MB — please use <5 MB while we're embedding as data URLs.`);
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = reader.result as string;
              if (selected?.type === "image") {
                updateLayer(selected.id, { src: dataUrl } as Partial<Layer>);
                return;
              }
              const l: ImageLayer = {
                id: newLayerId(),
                type: "image",
                role: "decorative",
                x: 40, y: 0, width: 1000, height: 600, gapTop: GRID * 2, sameRow: false,
                rotation: 0,
                opacity: 1,
                zIndex: 1,
                src: dataUrl,
                fit: "cover",
                borderRadius: 12,
              };
              setDoc((d) => ({ ...d, layers: [...d.layers, l] }));
              setSelectedId(l.id);
            };
            reader.readAsDataURL(file);
          }}
        >
          <div
            ref={canvasRef}
            className="template-canvas"
            style={{
              width: doc.width * scale,
              height: doc.height * scale,
            }}
          >
            <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: doc.width, height: doc.height }}>
              <TemplateRenderer
                doc={doc}
                gridStep={showGrid ? GRID : 0}
                layerOverlay={renderLayerOverlay}
              />
            </div>
          </div>
        </div>

        {/* Right panel: layers list + properties */}
        <div className="template-side">
          <div className="template-panel">
            <h2>Canvas</h2>
            <PanelField label="Background">
              <input
                type="color"
                value={doc.background}
                onChange={(e) => setDoc((d) => ({ ...d, background: e.target.value }))}
              />
            </PanelField>
            <div className="prop-row">
              <NumField
                label="Width"
                value={doc.width}
                min={100}
                step={GRID}
                onChange={(v) => setDoc((d) => ({ ...d, width: Math.max(100, Math.round(v)) }))}
              />
              <NumField
                label="Height"
                value={doc.height}
                min={100}
                step={GRID}
                onChange={(v) => setDoc((d) => ({ ...d, height: Math.max(100, Math.round(v)) }))}
              />
            </div>
            <div className="prop-row" style={{ gap: 6 }}>
              <button className="secondary small" onClick={() => setDoc((d) => ({ ...d, width: 1080, height: 1350 }))} title="Instagram portrait">1080×1350</button>
              <button className="secondary small" onClick={() => setDoc((d) => ({ ...d, width: 1080, height: 1080 }))} title="Square">1080×1080</button>
              <button className="secondary small" onClick={() => setDoc((d) => ({ ...d, width: 1080, height: 1920 }))} title="Story / 9:16">1080×1920</button>
            </div>
          </div>

          <div className="template-panel">
            <h2>Layers ({doc.layers.length})</h2>
            <div className="layers-list">
              {doc.layers.map((l) => (
                <div
                  key={l.id}
                  className={`layer-item${l.id === selectedId ? " selected" : ""}`}
                  onClick={() => setSelectedId(l.id)}
                >
                  <span className="layer-icon">{l.type === "text" ? "T" : l.type === "image" ? "🖼" : "▢"}</span>
                  <span className="layer-name">
                    {l.type === "text" ? `"${truncate((l as TextLayer).content, 24)}"` : l.type === "image" ? "Image" : "Shape"}
                  </span>
                  <span className="layer-role">{l.role}</span>
                </div>
              ))}
              {doc.layers.length === 0 && <div className="empty-inline">No layers yet — add one above.</div>}
            </div>
          </div>

          {selected && (
            <div className="template-panel">
              <h2>Properties</h2>
              <PropertyEditor
                layer={selected}
                onChange={(patch) => updateLayer(selected.id, patch)}
                onDelete={() => deleteLayer(selected.id)}
                onDuplicate={() => duplicateLayer(selected.id)}
                onMoveUp={() => moveLayer(selected.id, -1)}
                onMoveDown={() => moveLayer(selected.id, 1)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Overlay inside each layer's wrapper. Filling the wrapper means clicking
// anywhere on the layer drags it; resize hit zones along each edge plus
// visible corner handles cover all 8 directions.
function LayerOverlay({
  layer,
  selected,
  onMoveStart,
  onResizeStart,
}: {
  layer: Layer;
  selected: boolean;
  onMoveStart: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent, dir: Dir) => void;
}) {
  // Hit zone width along each edge (template px). 12px feels right at 1080
  // scaled to ~600 in the editor — that's ~7 css px, comfortable to grab.
  const EDGE = 12;
  return (
    <div
      onPointerDown={onMoveStart}
      style={{
        position: "absolute",
        inset: 0,
        cursor: "move",
        outline: selected ? "2px solid #2e7dd1" : "1px dashed rgba(46,125,209,0.35)",
        outlineOffset: 0,
      }}
    >
      {/* Edge hit strips — invisible, but they catch pointer events along the
          full border so any pixel of the edge resizes. */}
      <EdgeStrip dir="n" edge={EDGE} onPointerDown={(e) => onResizeStart(e, "n")} />
      <EdgeStrip dir="s" edge={EDGE} onPointerDown={(e) => onResizeStart(e, "s")} disabled={layer.type === "text"} />
      <EdgeStrip dir="w" edge={EDGE} onPointerDown={(e) => onResizeStart(e, "w")} />
      <EdgeStrip dir="e" edge={EDGE} onPointerDown={(e) => onResizeStart(e, "e")} />

      {/* Corner + edge handles — visible when selected. */}
      {selected && (
        <>
          {CORNER_DIRS.map((d) => (
            <Handle key={d} dir={d} onPointerDown={(e) => onResizeStart(e, d)} />
          ))}
          {EDGE_DIRS.map((d) => (
            <Handle
              key={d}
              dir={d}
              onPointerDown={(e) => onResizeStart(e, d)}
              hidden={d === "s" && layer.type === "text"}
            />
          ))}
        </>
      )}
    </div>
  );
}

function EdgeStrip({
  dir,
  edge,
  onPointerDown,
  disabled,
}: {
  dir: Dir;
  edge: number;
  onPointerDown: (e: React.PointerEvent) => void;
  disabled?: boolean;
}) {
  if (disabled) return null;
  const cursor = cursorForDir(dir);
  const base: React.CSSProperties = { position: "absolute", cursor };
  if (dir === "n") Object.assign(base, { left: edge, right: edge, top: -edge / 2, height: edge });
  if (dir === "s") Object.assign(base, { left: edge, right: edge, bottom: -edge / 2, height: edge });
  if (dir === "w") Object.assign(base, { top: edge, bottom: edge, left: -edge / 2, width: edge });
  if (dir === "e") Object.assign(base, { top: edge, bottom: edge, right: -edge / 2, width: edge });
  return <div style={base} onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e); }} />;
}

function Handle({
  dir,
  onPointerDown,
  hidden,
}: {
  dir: Dir;
  onPointerDown: (e: React.PointerEvent) => void;
  hidden?: boolean;
}) {
  if (hidden) return null;
  const size = 14;
  const half = size / 2;
  const cursor = cursorForDir(dir);
  const base: React.CSSProperties = {
    position: "absolute",
    width: size,
    height: size,
    background: "#fff",
    border: "2px solid #2e7dd1",
    borderRadius: 3,
    cursor,
  };
  // Corner positions
  if (dir === "nw") Object.assign(base, { left: -half, top: -half });
  if (dir === "ne") Object.assign(base, { right: -half, top: -half });
  if (dir === "sw") Object.assign(base, { left: -half, bottom: -half });
  if (dir === "se") Object.assign(base, { right: -half, bottom: -half });
  // Edge mid positions
  if (dir === "n") Object.assign(base, { left: `calc(50% - ${half}px)`, top: -half });
  if (dir === "s") Object.assign(base, { left: `calc(50% - ${half}px)`, bottom: -half });
  if (dir === "w") Object.assign(base, { top: `calc(50% - ${half}px)`, left: -half });
  if (dir === "e") Object.assign(base, { top: `calc(50% - ${half}px)`, right: -half });
  return <div style={base} onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e); }} />;
}

function cursorForDir(dir: Dir): string {
  switch (dir) {
    case "n": case "s": return "ns-resize";
    case "e": case "w": return "ew-resize";
    case "ne": case "sw": return "nesw-resize";
    case "nw": case "se": return "nwse-resize";
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function PanelField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="panel-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function PropertyEditor({
  layer, onChange, onDelete, onDuplicate, onMoveUp, onMoveDown,
}: {
  layer: Layer;
  onChange: (patch: Partial<Layer>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div className="property-editor">
      <div className="prop-row">
        <NumField label="X" value={layer.x} step={GRID} onChange={(v) => onChange({ x: Math.max(0, snap(v)) } as Partial<Layer>)} />
        <NumField label="Gap top" value={layer.gapTop ?? 0} step={GRID} min={0} onChange={(v) => onChange({ gapTop: Math.max(0, snap(v)) } as Partial<Layer>)} />
      </div>
      <div className="prop-row" style={{ gap: 6 }}>
        <Chip
          on={layer.sameRow}
          onClick={() => onChange({ sameRow: !layer.sameRow } as Partial<Layer>)}
          title="Sit side-by-side with the layer above instead of stacking below it"
        >
          {layer.sameRow ? "← Same row as above" : "Stack below"}
        </Chip>
      </div>
      <div className="prop-row">
        <NumField label="W" value={layer.width} step={GRID} min={GRID} onChange={(v) => onChange({ width: Math.max(GRID, snap(v)) } as Partial<Layer>)} />
        {layer.type !== "text" ? (
          <NumField label="H" value={layer.height} step={GRID} min={GRID} onChange={(v) => onChange({ height: Math.max(GRID, snap(v)) } as Partial<Layer>)} />
        ) : (
          <NumField label="H (auto)" value={0} onChange={() => {}} />
        )}
      </div>
      <div className="prop-row">
        <NumField label="Rotate" value={layer.rotation} onChange={(v) => onChange({ rotation: v } as Partial<Layer>)} />
        <NumField label="Opacity" value={layer.opacity} step={0.05} min={0} max={1} onChange={(v) => onChange({ opacity: v } as Partial<Layer>)} />
      </div>

      {layer.type === "text" && <TextProps layer={layer} onChange={onChange as (p: Partial<TextLayer>) => void} />}
      {layer.type === "image" && <ImageProps layer={layer} onChange={onChange as (p: Partial<ImageLayer>) => void} />}
      {layer.type === "shape" && <ShapeProps layer={layer} onChange={onChange as (p: Partial<ShapeLayer>) => void} />}

      <div className="prop-row" style={{ marginTop: 12, gap: 6 }}>
        <button className="secondary small" onClick={onMoveUp} title="Move up (Ctrl/Cmd+↑)">↑</button>
        <button className="secondary small" onClick={onMoveDown} title="Move down (Ctrl/Cmd+↓)">↓</button>
        <button className="secondary small" onClick={onDuplicate}>Duplicate</button>
        <button className="danger small" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

function TextProps({ layer, onChange }: { layer: TextLayer; onChange: (p: Partial<TextLayer>) => void }) {
  return (
    <>
      <PanelField label="Role">
        <select value={layer.role} onChange={(e) => onChange({ role: e.target.value as TextRole })}>
          {TEXT_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </PanelField>
      <PanelField label="Content">
        <textarea
          rows={3}
          value={layer.content}
          onChange={(e) => onChange({ content: e.target.value })}
        />
      </PanelField>
      <PanelField label="Font family">
        <select value={layer.fontFamily} onChange={(e) => onChange({ fontFamily: e.target.value })}>
          <option value="system-ui, -apple-system, 'Segoe UI', sans-serif">System sans</option>
          <option value="Georgia, 'Times New Roman', serif">Serif</option>
          <option value="ui-monospace, 'Cascadia Mono', monospace">Mono</option>
          <option value="'Inter', system-ui, sans-serif">Inter</option>
          <option value="'Helvetica Neue', Helvetica, Arial, sans-serif">Helvetica</option>
          <option value="'SF Pro Display', system-ui, sans-serif">SF Pro</option>
          <option value="Impact, 'Arial Narrow', sans-serif">Impact</option>
        </select>
      </PanelField>
      <div className="prop-row">
        <NumField label="Size" value={layer.fontSize} min={6} onChange={(v) => onChange({ fontSize: v })} />
        <NumField label="Weight" value={layer.fontWeight} step={100} min={100} max={900} onChange={(v) => onChange({ fontWeight: v })} />
      </div>
      <PanelField label="Color">
        <input type="color" value={layer.color} onChange={(e) => onChange({ color: e.target.value })} />
      </PanelField>
      <PanelField label="Align">
        <select value={layer.textAlign} onChange={(e) => onChange({ textAlign: e.target.value as TextLayer["textAlign"] })}>
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </PanelField>
      <div className="prop-row">
        <NumField label="Line h" value={layer.lineHeight} step={0.05} onChange={(v) => onChange({ lineHeight: v })} />
        <NumField label="Tracking" value={layer.letterSpacing} step={0.5} onChange={(v) => onChange({ letterSpacing: v })} />
      </div>
      <div className="prop-row" style={{ gap: 6 }}>
        <Chip on={layer.italic} onClick={() => onChange({ italic: !layer.italic })}>Italic</Chip>
        <Chip on={layer.uppercase} onClick={() => onChange({ uppercase: !layer.uppercase })}>UPPER</Chip>
        <Chip on={layer.shadow} onClick={() => onChange({ shadow: !layer.shadow })}>Shadow</Chip>
      </div>
    </>
  );
}

function ImageProps({ layer, onChange }: { layer: ImageLayer; onChange: (p: Partial<ImageLayer>) => void }) {
  return (
    <>
      <PanelField label="Role">
        <select value={layer.role} onChange={(e) => onChange({ role: e.target.value as ImageRole })}>
          {IMAGE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </PanelField>
      <PanelField label="Image URL">
        <input type="text" value={layer.src} onChange={(e) => onChange({ src: e.target.value })} placeholder="https://…" />
      </PanelField>
      <PanelField label="Fit">
        <select value={layer.fit} onChange={(e) => onChange({ fit: e.target.value as "cover" | "contain" })}>
          <option value="cover">Cover</option>
          <option value="contain">Contain</option>
        </select>
      </PanelField>
      <NumField label="Border radius" value={layer.borderRadius} min={0} onChange={(v) => onChange({ borderRadius: v })} />
    </>
  );
}

function ShapeProps({ layer, onChange }: { layer: ShapeLayer; onChange: (p: Partial<ShapeLayer>) => void }) {
  const borderWidth = layer.borderWidth ?? 0;
  const borderColor = layer.borderColor ?? "#000000";
  return (
    <>
      <PanelField label="Shape">
        <select
          value={layer.shape}
          onChange={(e) => {
            const next = e.target.value as ShapeKind;
            const patch: Partial<ShapeLayer> = { shape: next };
            // A circle should be a circle, not an ellipse — square the layer
            // when switching in. Use min so the layer can never grow off-canvas.
            if (next === "circle" && layer.width !== layer.height) {
              const size = Math.max(GRID, Math.min(layer.width, layer.height));
              patch.width = size;
              patch.height = size;
            }
            onChange(patch);
          }}
        >
          {SHAPES.map((k) => (
            <option key={k} value={k}>{SHAPE_LABEL[k]}</option>
          ))}
        </select>
      </PanelField>
      <PanelField label="Fill">
        <input type="color" value={layer.fill} onChange={(e) => onChange({ fill: e.target.value })} />
      </PanelField>
      <PanelField label="Border">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="color"
            value={borderColor}
            onChange={(e) => onChange({ borderColor: e.target.value })}
            disabled={borderWidth === 0}
            title="Border color"
          />
          <NumField
            label="Width"
            value={borderWidth}
            step={1}
            min={0}
            onChange={(v) => onChange({ borderWidth: Math.max(0, v) })}
          />
        </div>
      </PanelField>
    </>
  );
}

function NumField({
  label, value, onChange, step = 1, min, max,
}: {
  label: string; value: number; onChange: (v: number) => void;
  step?: number; min?: number; max?: number;
}) {
  return (
    <label className="num-field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
  );
}

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={on ? "" : "secondary"}
      style={{ padding: "4px 10px", fontSize: 12 }}
    >
      {children}
    </button>
  );
}

export { defaultTemplate };
