import React, { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
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

// Two independent project slots that share the global admin photos/refs. Both
// Wizards stay MOUNTED — the inactive one is just hidden with display:none, so
// its React state survives and its background job keeps polling/generating while
// you work in the other slot. The switch bar sits above the generation overlay
// (z-index) so you can always swap slots, even mid-generation.
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
        {/* standalone YouTube → MP4 downloader, pushed to the right */}
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

function Shell() {
  // The troll is mounted once here (not per-page), so he persists across
  // navigation instead of resetting. He's hidden on /admin, and his keyboard
  // controls only respond while a generation is running (see trollBus).
  const onAdmin = useLocation().pathname.startsWith('/admin');
  return (
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
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Shell />
    </BrowserRouter>
  </React.StrictMode>
);
