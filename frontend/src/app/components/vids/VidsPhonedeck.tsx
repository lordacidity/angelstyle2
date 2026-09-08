'use client';

// The Phonedeck list, cut down to sit under the export buttons on the Vids
// page: the phones as a row of chips to pick from, then one line per file in
// Incoming with its Push button. Same server, same list as the floating panel
// on Media (hooks/usePhonedeck) — this is a smaller face on it, so a build
// pushed from here is in that panel too, and the phones picked here are the
// phones picked there.
//
// `recent` is the file the last export put in Incoming: it goes first and is
// lit, so the one you just made is the one under your hand.
//
// Two sizes. Under Simple's buttons it is a few rows, as the panel on Media
// is. In Advanced's export rail, `grow` gives it the height of its column:
// the list takes whatever is left between the post caption and the buttons,
// so a day's worth of files is in view rather than three at a time.

import { useState } from 'react';
import { formatSize, usePhonedeck } from '../../hooks/usePhonedeck';

const LINK = 'text-[10px] text-zinc-500 transition-colors hover:text-zinc-200';

export function VidsPhonedeck({ recent, grow = false }: { recent?: string | null; grow?: boolean }) {
  const pd = usePhonedeck();
  const { connected, incoming, ready, selectedSerials, pushing, status } = pd;
  const [collapsed, setCollapsed] = useState(false);

  const files = recent
    ? [...incoming].sort((a, b) => (a.name === recent ? -1 : b.name === recent ? 1 : 0))
    : incoming;
  const allSelected = ready.length > 0 && selectedSerials.size === ready.length;
  // Only a list that is showing takes the column's height: folded, or with
  // nothing but the offline line to say, the box stays the size of its words.
  const stretched = grow && !collapsed && connected;

  return (
    <div
      data-vids-phonedeck
      className={`overflow-hidden rounded-md border border-zinc-800 bg-zinc-900/40 ${
        grow ? `flex min-h-0 flex-col ${stretched ? 'flex-1' : ''}` : 'mt-2'
      }`}
    >
      <button
        onClick={() => setCollapsed((c) => !c)}
        title={connected ? 'Phonedeck connected — click to fold' : 'Phonedeck offline — click to fold'}
        className="flex w-full shrink-0 items-center gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-zinc-900"
      >
        {/* The same downward triangle as the Deck entry in the sidebar and the
            panel on Media; green while the file feed is live. */}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${connected ? 'text-[#04df9d]' : 'text-zinc-600'}`}>
          <polygon points="4 6 20 6 12 20" />
        </svg>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Phonedeck</span>
        <span className="text-[10px] tabular-nums text-zinc-600">
          {connected ? `${ready.length} phone${ready.length === 1 ? '' : 's'}` : 'offline'}
          {connected && incoming.length > 0 ? ` · ${incoming.length} in` : ''}
        </span>
        <span className="flex-1" />
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600">
          {collapsed ? <polyline points="18 15 12 9 6 15" /> : <polyline points="6 9 12 15 18 9" />}
        </svg>
      </button>

      {!collapsed && (
        !connected ? (
          <p className="border-t border-zinc-800 px-2 py-2 text-[10px] leading-relaxed text-zinc-600">
            Phonedeck isn&apos;t running on this PC — start it with Launch server on the Media page.
          </p>
        ) : (
          <>
            {/* The phones. One sticky selection for every file. */}
            <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-zinc-800 px-2 py-1.5">
              {ready.length === 0 ? (
                <span className="text-[10px] italic text-zinc-600">No phones connected</span>
              ) : (
                <>
                  {ready.map((d) => {
                    const on = selectedSerials.has(d.serial);
                    return (
                      <button
                        key={d.serial}
                        onClick={() => pd.togglePhone(d.serial)}
                        title={d.serial}
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                          on
                            ? 'bg-[#04df9d] text-black hover:bg-[#03c98e]'
                            : 'border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-600'
                        }`}
                      >
                        {d.name ?? d.model ?? d.serial.slice(-4)}
                      </button>
                    );
                  })}
                  <span className="flex-1" />
                  {allSelected
                    ? <button onClick={pd.clearSelection} className={LINK}>None</button>
                    : <button onClick={pd.selectAll} className={LINK}>All</button>}
                </>
              )}
            </div>

            {/* Incoming — one line a file. Stretched, the list is what grows;
                the floor keeps a short window from crushing it to nothing
                (the rail scrolls instead). */}
            <div className={`overflow-y-auto border-t border-zinc-800 ${stretched ? 'min-h-[140px] flex-1' : 'max-h-28'}`}>
              {files.length === 0 ? (
                <p className="px-2 py-2 text-[10px] text-zinc-600">Nothing in Incoming yet.</p>
              ) : (
                files.map((f) => {
                  const hot = f.name === recent;
                  const st = status[f.name];
                  const busy = !!pushing[f.name];
                  return (
                    <div key={f.name} className={`flex items-center gap-2 px-2 py-1 ${hot ? 'bg-emerald-950/30' : ''}`}>
                      <span
                        className={`min-w-0 flex-1 truncate text-[10px] ${hot ? 'text-emerald-200' : 'text-zinc-300'}`}
                        title={`${f.name} · ${formatSize(f.size)}`}
                      >
                        {f.name}
                      </span>
                      {st ? (
                        <span className={`shrink-0 text-[10px] ${st.startsWith('✓') ? 'text-[#04df9d]' : 'text-red-400'}`}>{st}</span>
                      ) : (
                        <button
                          onClick={() => void pd.pushSelected(f.name)}
                          disabled={busy || selectedSerials.size === 0}
                          title={selectedSerials.size ? `Push to ${selectedSerials.size} phone${selectedSerials.size === 1 ? '' : 's'}` : 'Pick a phone above first'}
                          className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-black transition-colors hover:bg-zinc-200 disabled:cursor-default disabled:opacity-40"
                        >
                          {busy ? '…' : `Push → ${selectedSerials.size}`}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            {incoming.length > 0 && (
              <div className="flex shrink-0 justify-end border-t border-zinc-800 px-2 py-1">
                <button onClick={() => void pd.clearAllIncoming()} title="Mark every incoming file as past" className={LINK}>Clear list</button>
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}
