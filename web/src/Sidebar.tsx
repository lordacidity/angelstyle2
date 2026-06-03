// Left-rail navigation. Visual language mirrors Distribution Studio:
// narrow icon-only column, inline SVG line-art icons, tiny label below
// each, color-only active state.

import type { ReactNode } from "react";

type Tab = "phonedeck" | "news-trending" | "images";

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
    icon: <svg {...ICON_PROPS}><polygon points="4 6 20 6 12 20"/></svg>,
  },
  {
    key: "news-trending",
    label: "Trending",
    href: "/news/trending",
    icon: (
      <svg {...ICON_PROPS}>
        <line x1="12" y1="3"   x2="12"   y2="21"/>
        <line x1="4.5" y1="7.5"  x2="19.5" y2="16.5"/>
        <line x1="4.5" y1="16.5" x2="19.5" y2="7.5"/>
      </svg>
    ),
  },
  {
    key: "images",
    label: "Images",
    href: "/images",
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="2" y="7" width="20" height="14" rx="2"/>
        <path d="M8 7l1.5-3h5L16 7"/>
        <circle cx="12" cy="14" r="3.5"/>
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
