// Left-rail navigation shared by Phonedeck / News / Templates pages.

type Tab = "phonedeck" | "news-industry" | "news-all" | "news-person" | "templates";

const ITEMS: Array<{ key: Tab; label: string; href: string; icon: string }> = [
  { key: "phonedeck",      label: "Phonedeck",     href: "/",              icon: "📱" },
  { key: "news-industry",  label: "Industry News", href: "/news/industry", icon: "📰" },
  { key: "news-all",       label: "All News",      href: "/news/all",      icon: "🌐" },
  { key: "news-person",    label: "Person News",   href: "/news/person",   icon: "👤" },
  { key: "templates",      label: "Templates",     href: "/templates",     icon: "🎨" },
];

export function Sidebar({ current }: { current: Tab }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">PAUV</div>
      <nav className="sidebar-nav">
        {ITEMS.map((it) => (
          <a
            key={it.key}
            href={it.href}
            className={`sidebar-link${current === it.key ? " active" : ""}`}
          >
            <span className="sidebar-icon">{it.icon}</span>
            <span>{it.label}</span>
          </a>
        ))}
      </nav>
    </aside>
  );
}
