// Templates list page: thumbnail grid + create + edit + delete.
// Edits open the TemplateEditor in-place so the sidebar layout stays.

import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { TemplateRenderer } from "./TemplateRenderer";
import { TemplateEditor } from "./TemplateEditor";
import { defaultTemplate, type TemplateDoc, type TemplateRow } from "./templateModel";

type Mode =
  | { kind: "list" }
  | { kind: "edit"; row: { id?: string; name: string; doc: TemplateDoc } };

export function TemplatesView() {
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setError(null);
    try {
      const r = await fetch("/api/templates");
      if (!r.ok) throw new Error(await r.text());
      setRows(await r.json());
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => { reload(); }, []);

  const newTemplate = () => {
    setMode({ kind: "edit", row: { name: "Untitled template", doc: defaultTemplate() } });
  };

  const editRow = (row: TemplateRow) => {
    setMode({ kind: "edit", row: { id: row.id, name: row.name, doc: row.doc } });
  };

  const deleteRow = async (row: TemplateRow) => {
    if (!confirm(`Delete "${row.name}"?`)) return;
    try {
      const r = await fetch(`/api/templates/${row.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
      reload();
    } catch (e) { setError(String(e)); }
  };

  return (
    <div className="layout">
      <Sidebar current="templates" />
      <div className="layout-main">
        {mode.kind === "list" ? (
          <>
            <div className="app-header">
              <div>
                <h1>Templates</h1>
                <div className="subtitle">Design the visual; the news card step fills it from Pauv + news data.</div>
              </div>
              <div className="row">
                <button onClick={newTemplate}>+ New template</button>
              </div>
            </div>

            {error && <div className="status err">{error}</div>}

            {rows === null && <div className="empty">Loading…</div>}
            {rows && rows.length === 0 && (
              <div className="card empty" style={{ textAlign: "left" }}>
                No templates yet. Click <strong>+ New template</strong> to design one.
              </div>
            )}

            <div className="template-grid">
              {rows?.map((row) => (
                <div key={row.id} className="template-card">
                  <div className="template-thumb" onClick={() => editRow(row)}>
                    {/* Thumbnail = renderer scaled to fit a 220×275 box */}
                    <div style={{
                      transform: `scale(${220 / row.doc.width})`,
                      transformOrigin: "top left",
                      width: row.doc.width,
                      height: row.doc.height,
                    }}>
                      <TemplateRenderer doc={row.doc} />
                    </div>
                  </div>
                  <div className="template-card-foot">
                    <div className="template-card-name" title={row.name}>{row.name}</div>
                    <div className="row" style={{ gap: 4 }}>
                      <button className="secondary small" onClick={() => editRow(row)}>Edit</button>
                      <button className="danger small" onClick={() => deleteRow(row)}>×</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <TemplateEditor
            initial={mode.row}
            onSave={() => { setMode({ kind: "list" }); reload(); }}
            onCancel={() => setMode({ kind: "list" })}
          />
        )}
      </div>
    </div>
  );
}
