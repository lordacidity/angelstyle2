'use client';

// Ported from the standalone aier app's main.jsx. Same Shell + two-slot Studio, but mounted
// as a Next client island: BrowserRouter → MemoryRouter so the AI-maker's internal Studio/
// Admin navigation stays in-memory and the Studio URL stays at /ai-maker.
import React, { useCallback, useEffect, useState } from 'react';
import { MemoryRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import Wizard from './pages/Wizard.jsx';
import Downloader from './pages/Downloader.jsx';
import Admin from './pages/Admin.jsx';
import TrollMark from './components/TrollMark.jsx';
import PixelTroll from './components/PixelTroll.jsx';
import './styles.css';

const SLOT_COUNT = 2;
const STATUS_DOT = {
  empty:   { cls: 'empty',   title: 'empty' },
  working: { cls: 'working', title: 'in progress' },
  busy:    { cls: 'busy',    title: 'generating…' },
  ready:   { cls: 'ready',   title: 'clip ready' },
};

// Two independent project slots that share the global admin photos/refs. Both Wizards stay
// MOUNTED — the inactive one is hidden with display:none, so its React state survives and its
// background job keeps polling/generating while you work in the other slot.
function StudioSlots() {
  const [active, setActive] = useState(0);
  const [statuses, setStatuses] = useState(() => Array(SLOT_COUNT).fill('empty'));

  const onStatus = useCallback((slot, status) => {
    setStatuses((prev) => (prev[slot] === status ? prev : prev.map((s, i) => (i === slot ? status : s))));
  }, []);

  return (
    <>
      <div className="slot-switch" role="tablist" aria-label="Project slots">
        {Array.from({ length: SLOT_COUNT }, (_, i) => {
          const dot = STATUS_DOT[statuses[i]] || STATUS_DOT.empty;
          return (
            <button key={i} role="tab" aria-selected={active === i}
              className={`slot-tab ${active === i ? 'active' : ''}`}
              onClick={() => setActive(i)}>
              <span className={`slot-dot ${dot.cls}`} title={dot.title} />
              Project {i + 1}
            </button>
          );
        })}
        <button role="tab" aria-selected={active === 'dl'}
          className={`slot-tab dl ${active === 'dl' ? 'active' : ''}`}
          onClick={() => setActive('dl')}>
          🎬 Video downloader
        </button>
      </div>
      {Array.from({ length: SLOT_COUNT }, (_, i) => (
        <div key={i} style={{ display: active === i ? 'block' : 'none' }}>
          <Wizard slot={i} onStatus={onStatus} />
        </div>
      ))}
      <div style={{ display: active === 'dl' ? 'block' : 'none' }}>
        <Downloader />
      </div>
    </>
  );
}

// Where the local downloader server lives (aier/downloader.js). Override at build time with
// NEXT_PUBLIC_AIER_DOWNLOADER_URL.
const DL_BASE = (process.env.NEXT_PUBLIC_AIER_DOWNLOADER_URL || 'http://localhost:3011').replace(/\/+$/, '');
// First-time, run-once command. Installs Git/Node if missing, clones, installs deps, registers
// the aier:// launch protocol, and starts the downloader — see setup-aier.ps1.
const SETUP_COMMAND = 'irm https://raw.githubusercontent.com/lordacidity/angelstyle2/main/setup-aier.ps1 | iex';

// Floating bottom-right "Launch Aier server" control, mirroring Phonedeck's launch button.
// The Vercel page can't spawn a process, so the main button is an aier:// deep-link
// (registered once by setup-aier.ps1) that runs launch-aier.bat → the local downloader.
// The "First time?" dropdown shows the one-paste setup command; it auto-opens once per
// browser so a new visitor sees how to get started. Inline-styled so it doesn't depend on
// Tailwind being present inside this ported SPA.
function LaunchAierButton() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [up, setUp] = useState(false); // is the local downloader reachable?

  const recheck = useCallback(() => {
    fetch(`${DL_BASE}/health`, { cache: 'no-store' }).then((r) => setUp(r.ok)).catch(() => setUp(false));
  }, []);

  useEffect(() => {
    recheck();
    try { if (!localStorage.getItem('aier.setupSeen')) setOpen(true); } catch { /* blocked — just don't auto-open */ }
  }, [recheck]);

  function markSeen() { try { localStorage.setItem('aier.setupSeen', '1'); } catch { /* ignore */ } }

  async function copy() {
    try {
      await navigator.clipboard.writeText(SETUP_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — the code is select-all, copy manually */ }
    markSeen();
  }

  return (
    <div style={{ position: 'fixed', right: 14, bottom: 14, zIndex: 60, fontFamily: 'system-ui, sans-serif' }}>
      {open && (
        <div style={{
          position: 'absolute', bottom: '100%', right: 0, marginBottom: 8, width: 372,
          background: '#0b0b0d', border: '1px solid #27272a', borderRadius: 8, padding: 12,
          boxShadow: '0 12px 34px rgba(0,0,0,.55)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <strong style={{ fontSize: 12, color: '#fff' }}>First time on this PC?</strong>
            <button onClick={() => { setOpen(false); markSeen(); }}
              style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', fontSize: 13 }}>✕</button>
          </div>
          <p style={{ fontSize: 11.5, lineHeight: 1.55, color: '#a1a1aa', margin: '0 0 8px' }}>
            Open <span style={{ color: '#e4e4e7' }}>Windows PowerShell</span> and paste this once — it installs
            everything needed (Node, the downloader) and registers the launch button:
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <code style={{
              flex: 1, userSelect: 'all', wordBreak: 'break-all', borderRadius: 4,
              border: '1px solid #27272a', background: 'rgba(0,0,0,.6)', padding: '6px 8px',
              fontFamily: 'monospace', fontSize: 10.5, color: '#6ee7b7',
            }}>{SETUP_COMMAND}</code>
            <button onClick={copy} style={{
              border: '1px solid #3f3f46', borderRadius: 4, padding: '0 10px', fontSize: 11,
              color: '#e4e4e7', background: 'transparent', cursor: 'pointer',
            }}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
          <p style={{ fontSize: 10, lineHeight: 1.55, color: '#71717a', margin: '8px 0 0' }}>
            Done once. After that just press <span style={{ color: '#d4d4d8' }}>Launch Aier server</span> each
            time — it opens a terminal running the downloader, then the Video downloader works locally.
          </p>
        </div>
      )}

      <div style={{ display: 'inline-flex', alignItems: 'stretch', overflow: 'hidden', borderRadius: 7, border: '1px solid #27272a', background: '#18181b', boxShadow: '0 4px 16px rgba(0,0,0,.4)' }}>
        <a href="aier://launch" title="Start the local Aier download server on this PC"
          onClick={() => { markSeen(); setTimeout(recheck, 3500); }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', fontSize: 12, fontWeight: 500, color: '#e4e4e7', textDecoration: 'none' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: up ? '#22c55e' : '#52525b', boxShadow: up ? '0 0 6px #22c55e' : 'none' }} />
          {up ? 'Aier server running' : 'Launch Aier server'}
        </a>
        <button onClick={() => setOpen((o) => !o)} title="First-time setup"
          style={{ borderLeft: '1px solid #27272a', padding: '0 9px', fontSize: 10, color: '#a1a1aa', background: 'transparent', cursor: 'pointer' }}>
          First time?
        </button>
      </div>
    </div>
  );
}

function Shell() {
  // The troll is mounted once here so he persists across navigation. Hidden on /admin.
  const onAdmin = useLocation().pathname.startsWith('/admin');
  return (
    <>
      <div className="app">
        <header className="topbar">
          <div className="brand" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <TrollMark size={20} /> AI-maker
          </div>
          <nav>
            <NavLink to="/" end>Studio</NavLink>
            <NavLink to="/admin">Admin</NavLink>
          </nav>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<StudioSlots />} />
            <Route path="/admin" element={<Admin />} />
          </Routes>
        </main>
        <PixelTroll hidden={onAdmin} />
      </div>
      {/* Floating launch-server control (bottom-right), like Phonedeck's. */}
      <LaunchAierButton />
    </>
  );
}

export default function AierApp() {
  return (
    <MemoryRouter>
      <Shell />
    </MemoryRouter>
  );
}
