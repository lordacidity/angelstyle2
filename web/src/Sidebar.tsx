// Left-rail navigation shared by Phonedeck / News / Templates pages.
// Visual language mirrors Distribution Studio: narrow icon-only column,
// inline SVG line-art icons, tiny label below each, color-only active state.

import type { ReactNode } from "react";

// "news-industry" stays in the Tab union because NewsCardsView still lives at
// /news/industry — it's just hidden from the sidebar now that the card-build
// flow is reached via the Trending tab's "Build card" handoff. Pass
// `current="news-trending"` from there so the Trending tab stays highlighted
// during the build flow.
type Tab = "phonedeck" | "news-industry" | "news-person" | "news-trending" | "templates" | "images" | "studio";

interface Item {
  key: Tab;
  label: string;
  href: string;
  icon: ReactNode;
}

// All icons are 22×22 line-art, strokeWidth 1.8 — matches Studio's nav style.
const ICON_PROPS = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const ITEMS: Item[] = [
  {
    key: "phonedeck",
    label: "Phonedeck",
    href: "/",
    // Downward (apex-at-bottom) triangle — clean geometric mark for the
    // home/control surface.
    icon: <svg {...ICON_PROPS}><polygon points="4 6 20 6 12 20"/></svg>,
  },
  {
    key: "news-trending",
    label: "Trending",
    href: "/news/trending",
    // Six-spoke asterisk / spark — three lines crossing the center.
    icon: (
      <svg {...ICON_PROPS}>
        <line x1="12" y1="3"   x2="12"   y2="21"/>
        <line x1="4.5" y1="7.5"  x2="19.5" y2="16.5"/>
        <line x1="4.5" y1="16.5" x2="19.5" y2="7.5"/>
      </svg>
    ),
  },
  {
    key: "news-person",
    label: "Person",
    href: "/news/person",
    // Classic user silhouette — head circle + shoulders arc.
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="8" r="4"/>
        <path d="M4 21v-1a8 8 0 0 1 16 0v1"/>
      </svg>
    ),
  },
  {
    key: "templates",
    label: "Templates",
    href: "/templates",
    // 4-up grid of rounded squares — same as Studio's Template icon.
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="3"  y="3"  width="7" height="7" rx="1"/>
        <rect x="14" y="3"  width="7" height="7" rx="1"/>
        <rect x="3"  y="14" width="7" height="7" rx="1"/>
        <rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
    ),
  },
  {
    key: "images",
    label: "Images",
    href: "/images",
    // Camera body + lens circle + shutter bump on top.
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="2" y="7" width="20" height="14" rx="2"/>
        <path d="M8 7l1.5-3h5L16 7"/>
        <circle cx="12" cy="14" r="3.5"/>
      </svg>
    ),
  },
  {
    key: "studio",
    label: "Studio",
    href: "/studio",
    // Halo + curved wings — minimal angel mark for the creative app.
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="5" r="1.8"/>
        <path d="M3 15 Q 7 8, 12 13 Q 17 8, 21 15"/>
      </svg>
    ),
  },
];

export function Sidebar({ current }: { current: Tab }) {
  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        {ITEMS.map((it) => {
          const isActive = current === it.key;
          return (
            <a
              key={it.key}
              href={it.href}
              className={`sidebar-link${isActive ? " active" : ""}`}
              title={it.label}
            >
              <span className="sidebar-icon">{it.icon}</span>
              <span className="sidebar-label">{it.label}</span>
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
