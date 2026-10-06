'use client';

// AI Persona (Studio > AI Persona) — a cast of characters, and scenes that put
// every one of them into the same video.
//
//   Personas  a name and a character photo each. The front screen shows them
//             all and makes new ones; clicking one shows its videos and lets
//             the name and the photo be changed. (PersonaLibrary, PersonaDetail)
//   A scene   a video, trimmed and sped up. Its first frame is redrawn once
//             for every persona — GPT Image, the frame as #image1 and the
//             character photo as #image2 — and, when those are approved, Kling
//             motion control moves each redrawn frame the way the video moves.
//             Approve all, and the videos are saved to the personas.
//             (SceneSetup before Go, SceneReview after.)
//
// On screen a persona is called a character. Only the wording changed: the
// code, the routes and the tables still say persona, and the section is still
// AI Persona.
//
// Scenes open in tabs along the top, beside Characters, so several can be set
// up and generated at once. Every open tab stays mounted — a scene keeps
// polling, and a half-filled new scene keeps its form — and each tab wears
// where it stands: a spinner while something is generating, a dot when it is
// waiting on you, a tick once approved. The open scenes are remembered on this
// browser, so they come back after a reload.
//
// Everything is kept on the server (lib/aipersona/db), and fal's jobs are
// queued rather than waited on, so a scene survives a reload and can be picked
// back up from the front screen. The section also stays mounted across tab
// switches (StudioShell), so an open scene keeps polling while you work
// somewhere else.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getLibrary } from '@/lib/aipersona/client';
import type { LibraryPayload, Scene } from '@/lib/aipersona/types';
import { SpinnerIcon } from '@/lib/icons';
import { PersonaDetail } from './PersonaDetail';
import { PersonaLibrary } from './PersonaLibrary';
import { SceneReview, type SceneTabState } from './SceneReview';
import { SceneSetup } from './SceneSetup';
import { errorText } from './aipersona-ui';

/** The front tab: the characters, or one of them. */
type Home = { at: 'library' } | { at: 'persona'; id: string };

/** A scene tab: one being set up, or one already made. `fresh` is the scene
 *  as Go answered with it, so the screen needn't ask again. */
type Tab =
  | { key: string; kind: 'setup' }
  | { key: string; kind: 'scene'; id: string; fresh: Scene | null };

type TabState = SceneTabState | 'setup' | 'uploading';
const HOME = 'home';
const OPEN_KEY = 'aipersona.openScenes';

function TabIcon({ state }: { state: TabState | undefined }) {
  if (state === 'working' || state === 'uploading') return <SpinnerIcon size={12} className="shrink-0 animate-spin text-zinc-300" />;
  if (state === 'ready') return <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" title="Waiting on you" />;
  if (state === 'done') return <span className="shrink-0 text-[11px] font-bold text-emerald-400" title="Approved">✓</span>;
  if (state === 'error') return <span className="shrink-0 text-[11px] font-bold text-red-400" title="Something failed">!</span>;
  return <span className="shrink-0 text-[11px] text-zinc-500">✎</span>;
}

export function AiPersonaSection() {
  const [library, setLibrary] = useState<LibraryPayload | null>(null);
  const [error, setError] = useState('');
  const [home, setHome] = useState<Home>({ at: 'library' });
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string>(HOME);
  const [status, setStatus] = useState<Record<string, { title: string; state: TabState }>>({});
  const nextKey = useRef(0);

  /** Read the front screen again, after anything that changes what it lists. */
  const refresh = useCallback(async () => {
    try {
      setLibrary(await getLibrary());
      setError('');
    } catch (err) {
      setError(errorText(err));
    }
  }, []);
  useEffect(() => {
    let live = true;
    getLibrary().then(
      (loaded) => { if (live) setLibrary(loaded); },
      (err) => { if (live) setError(errorText(err)); },
    );
    // The scenes that were open last time, back in their tabs.
    const t = setTimeout(() => {
      try {
        const ids = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]') as unknown;
        if (live && Array.isArray(ids)) {
          setTabs(ids.filter((x): x is string => typeof x === 'string').map((id) => ({ key: `s-${id}`, kind: 'scene', id, fresh: null })));
        }
      } catch { /* nothing remembered */ }
    }, 0);
    return () => { live = false; clearTimeout(t); };
  }, []);
  useEffect(() => {
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(tabs.flatMap((t) => (t.kind === 'scene' ? [t.id] : [])))); } catch { /* private mode */ }
  }, [tabs]);

  const goHome = useCallback(() => setActive(HOME), []);
  const newScene = () => {
    const key = `n-${nextKey.current++}`;
    setTabs((ts) => [...ts, { key, kind: 'setup' }]);
    setActive(key);
  };
  const openScene = (id: string, fresh: Scene | null = null) => {
    const key = `s-${id}`;
    setTabs((ts) => (ts.some((t) => t.key === key) ? ts : [...ts, { key, kind: 'scene', id, fresh }]));
    setActive(key);
  };
  const close = (key: string) => {
    setTabs((ts) => {
      const i = ts.findIndex((t) => t.key === key);
      const rest = ts.filter((t) => t.key !== key);
      setActive((a) => (a === key ? (rest[Math.min(i, rest.length - 1)]?.key ?? HOME) : a));
      return rest;
    });
    setStatus((s) => { const { [key]: _gone, ...rest } = s; void _gone; return rest; });
  };
  const report = useCallback((key: string, title: string, state: TabState) => {
    setStatus((s) => (s[key]?.title === title && s[key]?.state === state ? s : { ...s, [key]: { title, state } }));
  }, []);

  const persona = home.at === 'persona' ? library?.personas.find((p) => p.id === home.id) : undefined;
  const homeScreen = home.at === 'persona' && persona ? (
    <PersonaDetail key={persona.id} persona={persona} onBack={() => setHome({ at: 'library' })} onChanged={refresh} />
  ) : (
    <PersonaLibrary
      library={library}
      error={error}
      onOpenPersona={(id) => setHome({ at: 'persona', id })}
      onNewScene={newScene}
      onOpenScene={(id) => openScene(id)}
      onChanged={refresh}
    />
  );

  return (
    <div className="flex h-screen flex-col bg-black text-white">
      <div className="vids-scroll flex shrink-0 items-stretch gap-1 overflow-x-auto border-b border-zinc-900 px-2 pt-2">
        <button
          type="button"
          onClick={goHome}
          className={`shrink-0 rounded-t-md px-3 py-1.5 text-xs transition-colors ${active === HOME ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-200'}`}
        >
          Characters
        </button>
        {tabs.map((t) => {
          const st = status[t.key];
          const busySetup = t.kind === 'setup' && st?.state === 'uploading';
          return (
            <div
              key={t.key}
              className={`group flex max-w-[220px] shrink-0 items-center gap-1.5 rounded-t-md pl-2.5 pr-1 text-xs transition-colors ${
                active === t.key ? 'bg-zinc-900 text-white' : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              <button type="button" onClick={() => setActive(t.key)} className="flex min-w-0 items-center gap-1.5 py-1.5">
                <TabIcon state={st?.state ?? (t.kind === 'setup' ? 'setup' : 'working')} />
                <span className="truncate">{st?.title ?? (t.kind === 'setup' ? 'New scene' : 'Scene')}</span>
              </button>
              <button
                type="button"
                onClick={() => { if (!busySetup || confirm('This scene is still uploading. Close it anyway?')) close(t.key); }}
                title={t.kind === 'scene' ? 'Close the tab — the scene carries on, and is still on the Characters tab' : 'Close'}
                className="grid h-5 w-5 shrink-0 place-items-center rounded text-zinc-500 opacity-60 transition hover:bg-zinc-800 hover:text-white group-hover:opacity-100"
              >
                ×
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={newScene}
          disabled={!library?.personas.length}
          title={library?.personas.length ? 'Set up another scene' : 'Make a character first'}
          className="shrink-0 rounded-t-md px-2.5 py-1.5 text-sm text-zinc-500 transition-colors hover:text-white disabled:opacity-30"
        >
          +
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div className={`h-full ${active === HOME ? '' : 'hidden'}`}>{homeScreen}</div>
        {tabs.map((t) => (
          <div key={t.key} className={`h-full ${active === t.key ? '' : 'hidden'}`}>
            {t.kind === 'setup' ? (
              library && (
                <SceneSetup
                  personas={library.personas}
                  onBack={goHome}
                  onStatus={(title, busy) => report(t.key, title, busy ? 'uploading' : 'setup')}
                  onCreated={(scene) => {
                    // The setup tab becomes the scene's own, in the same place.
                    const key = `s-${scene.id}`;
                    setTabs((ts) => ts.map((x) => (x.key === t.key ? { key, kind: 'scene', id: scene.id, fresh: scene } : x)));
                    setActive((a) => (a === t.key ? key : a));
                    setStatus((s) => { const { [t.key]: _gone, ...rest } = s; void _gone; return rest; });
                    void refresh();
                  }}
                />
              )
            ) : (
              <SceneReview
                sceneId={t.id}
                initial={t.fresh}
                onBack={goHome}
                onChanged={refresh}
                onStatus={(title, state) => report(t.key, title, state)}
                onDiscarded={() => close(t.key)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
