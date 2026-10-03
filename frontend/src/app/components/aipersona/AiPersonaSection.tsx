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
// Everything is kept on the server (lib/aipersona/db), and fal's jobs are
// queued rather than waited on, so a scene survives a reload and can be picked
// back up from the front screen. The section also stays mounted across tab
// switches (StudioShell), so an open scene keeps polling while you work
// somewhere else.

import { useCallback, useEffect, useState } from 'react';
import { getLibrary } from '@/lib/aipersona/client';
import type { LibraryPayload, Scene } from '@/lib/aipersona/types';
import { PersonaDetail } from './PersonaDetail';
import { PersonaLibrary } from './PersonaLibrary';
import { SceneReview } from './SceneReview';
import { SceneSetup } from './SceneSetup';
import { errorText } from './aipersona-ui';

type View =
  | { at: 'library' }
  | { at: 'persona'; id: string }
  | { at: 'setup' }
  /** `fresh` is the scene as Go answered with it, so the screen needn't ask again. */
  | { at: 'scene'; id: string; fresh: Scene | null };

export function AiPersonaSection() {
  const [library, setLibrary] = useState<LibraryPayload | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>({ at: 'library' });

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
    return () => { live = false; };
  }, []);

  const home = () => setView({ at: 'library' });
  const persona = view.at === 'persona' ? library?.personas.find((p) => p.id === view.id) : undefined;

  if (view.at === 'persona' && persona) {
    return <PersonaDetail key={persona.id} persona={persona} onBack={home} onChanged={refresh} />;
  }
  if (view.at === 'setup' && library) {
    return (
      <SceneSetup
        personas={library.personas}
        onBack={home}
        onCreated={(scene) => { setView({ at: 'scene', id: scene.id, fresh: scene }); void refresh(); }}
      />
    );
  }
  if (view.at === 'scene') {
    return <SceneReview key={view.id} sceneId={view.id} initial={view.fresh} onBack={home} onChanged={refresh} />;
  }
  return (
    <PersonaLibrary
      library={library}
      error={error}
      onOpenPersona={(id) => setView({ at: 'persona', id })}
      onNewScene={() => setView({ at: 'setup' })}
      onOpenScene={(id) => setView({ at: 'scene', id, fresh: null })}
      onChanged={refresh}
    />
  );
}
