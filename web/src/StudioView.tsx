// Distribution Studio embed. The Studio is a separate Next.js app on the
// `views-mog` branch (checked out in a sibling worktree at ../phonedeck-studio).
// We embed it via iframe so Phonedeck's sidebar stays visible while the user
// works in the Studio — "one site" feel, two dev servers under the hood.

import { Sidebar } from "./Sidebar";

const STUDIO_URL = "http://localhost:3000";

export function StudioView() {
  return (
    <div className="layout">
      <Sidebar current="studio" />
      <div
        className="layout-main"
        style={{ padding: 0, display: "flex", flexDirection: "column", minHeight: "100vh" }}
      >
        <div
          style={{
            padding: "12px 24px",
            borderBottom: "1px solid #27272a",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
            flexShrink: 0,
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 20 }}>🎬 Distribution Studio</h1>
            <div className="subtitle" style={{ marginTop: 4, marginBottom: 0, fontSize: 12 }}>
              Embedded from {STUDIO_URL} — make sure the Studio dev server is running.
              Start it with: <code>cd phonedeck-studio/frontend &amp;&amp; npm run dev</code>
            </div>
          </div>
          <a
            href={STUDIO_URL}
            target="_blank"
            rel="noreferrer"
            className="secondary"
            style={{
              display: "inline-block",
              padding: "8px 14px",
              border: "1px solid #27272a",
              borderRadius: 6,
              color: "#d4d4d8",
              textDecoration: "none",
              fontSize: 13,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            ↗ Open in new tab
          </a>
        </div>
        <iframe
          src={STUDIO_URL}
          title="Distribution Studio"
          style={{
            border: "none",
            flex: 1,
            width: "100%",
            background: "#000",
          }}
        />
      </div>
    </div>
  );
}
