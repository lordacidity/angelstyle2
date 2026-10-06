'use client';

// The front screen: every persona, a card to make a new one, and the scenes
// that were started and not yet approved.
//
// A new persona is a name and a character photo, nothing else. Write the name,
// drop the photo, and it exists.

import { useEffect, useState } from 'react';
import { SpinnerIcon, UploadIcon } from '@/lib/icons';
import { createPersona, makeAvatar, uploadFile } from '@/lib/aipersona/client';
import { MAX_NAME_CHARS, PHOTO_TYPES, type LibraryPayload, type SceneStage } from '@/lib/aipersona/types';
import { DropZone, FIELD, PRIMARY, errorText, photoProblem } from './aipersona-ui';

const STAGE_LABEL: Record<SceneStage, string> = {
  frames: 'first frames', prompt: 'writing the prompt', videos: 'videos', done: 'approved',
};

function NewPersonaCard({ onCreated }: { onCreated: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const photoUrl = photo?.url;
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);

  async function create(file: File) {
    setBusy(true);
    setError('');
    try {
      await createPersona(name.trim(), await uploadFile('photo', file));
      await onCreated();
      setName('');
      setPhoto(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  /** With the name already written, dropping the photo is the whole act. */
  function drop(file: File) {
    const problem = photoProblem(file);
    setError(problem);
    if (problem) return;
    setPhoto({ file, url: URL.createObjectURL(file) });
    if (name.trim()) void create(file);
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (photo && name.trim() && !busy) void create(photo.file); }}
      className="overflow-hidden rounded-lg border border-dashed border-zinc-800"
    >
      <DropZone accept={PHOTO_TYPES.join(',')} onFile={drop} disabled={busy} label="Drop a character photo" className="relative grid aspect-[3/4] place-items-center !border-0">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.url} alt="" className={`h-full w-full object-cover ${busy ? 'opacity-40' : ''}`} />
        ) : (
          <div className="flex flex-col items-center gap-2 px-4 text-center text-zinc-600">
            <UploadIcon size={20} />
            <span className="text-xs">Drop a character photo</span>
            <span className="text-[10px] text-zinc-700">JPEG · PNG · WebP</span>
          </div>
        )}
        {busy && <SpinnerIcon size={20} className="absolute animate-spin text-white" />}
      </DropZone>
      <div className="grid gap-2 border-t border-zinc-900 p-2.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_CHARS))}
          placeholder="New character — name"
          disabled={busy}
          className={`${FIELD} h-8`}
        />
        {photo && !busy && (
          <button type="submit" disabled={!name.trim()} className={`${PRIMARY} h-8`}>Add character</button>
        )}
        {error && <p className="text-[11px] text-red-400">{error}</p>}
      </div>
    </form>
  );
}

export function PersonaLibrary({ library, error, onOpenPersona, onNewScene, onOpenScene, onChanged }: {
  /** Null until the first load lands. */
  library: LibraryPayload | null;
  error: string;
  onOpenPersona: (id: string) => void;
  onNewScene: () => void;
  onOpenScene: (id: string) => void;
  onChanged: () => Promise<void>;
}) {
  const personas = library?.personas ?? [];
  const scenes = library?.scenes ?? [];

  // Profile pictures for everyone without one, three at a time.
  const missing = personas.filter((p) => !p.avatarUrl);
  const [making, setMaking] = useState<{ done: number; of: number; failed: string[] } | null>(null);
  async function makeMissing() {
    const queue = [...missing];
    const of = queue.length;
    const failed: string[] = [];
    let done = 0;
    setMaking({ done, of, failed });
    const worker = async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        try { await makeAvatar(p.id); } catch { failed.push(p.name); }
        done++;
        setMaking({ done, of, failed: [...failed] });
        await onChanged();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setMaking(failed.length ? { done, of, failed } : null);
  }

  return (
    <div className="flex h-full flex-col bg-black text-white">
      <div className="shrink-0 border-b border-zinc-900 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">AI Persona</h1>
            <p className="text-xs text-zinc-500">
              A character is a name and a photo. A scene puts every character into the same video: the first frame redrawn with each of them, then moved the way the video moves.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {making ? (
              <span className="flex items-center gap-2 text-xs text-zinc-400">
                {making.done < making.of && <SpinnerIcon size={13} className="animate-spin" />}
                Profile pics {making.done}/{making.of}
                {making.failed.length > 0 && <span className="text-red-400">· failed: {making.failed.join(', ')}</span>}
                {making.done >= making.of && <button type="button" onClick={() => setMaking(null)} className="text-zinc-500 hover:text-white">✕</button>}
              </span>
            ) : missing.length > 0 && (
              <button
                type="button"
                onClick={() => void makeMissing()}
                title="A round profile picture for every character that has none yet, made from its photo"
                className="h-8 rounded-md border border-zinc-700 px-3 text-xs text-zinc-200 transition-colors hover:border-zinc-400"
              >
                Make profile pics ({missing.length})
              </button>
            )}
            <button
              type="button"
              onClick={onNewScene}
              disabled={!personas.length}
              title={personas.length ? undefined : 'Make a character first'}
              className={PRIMARY}
            >
              New scene
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        {!library && !error ? (
          <div className="grid h-40 place-items-center text-zinc-600"><SpinnerIcon size={22} className="animate-spin" /></div>
        ) : (
          <div className="grid gap-8">
            {scenes.length > 0 && (
              <section>
                <h2 className="mb-3 text-[11px] uppercase tracking-wide text-zinc-500">Scenes in progress</h2>
                <div className="flex flex-wrap gap-3">
                  {scenes.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onOpenScene(s.id)}
                      className="flex w-[260px] items-center gap-3 overflow-hidden rounded-lg border border-zinc-800 text-left transition-colors hover:border-zinc-600"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.frameUrl} alt="" className="h-16 w-16 shrink-0 bg-zinc-950 object-cover" />
                      <span className="min-w-0 py-2 pr-3">
                        <span className="block truncate text-sm">{s.name}</span>
                        <span className="block text-[11px] text-zinc-500">
                          {STAGE_LABEL[s.stage]} · {s.personas} {s.personas === 1 ? 'character' : 'characters'}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h2 className="mb-3 text-[11px] uppercase tracking-wide text-zinc-500">
                Characters{personas.length > 0 && ` · ${personas.length}`}
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] items-start gap-4">
                {personas.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onOpenPersona(p.id)}
                    className="overflow-hidden rounded-lg border border-zinc-800 text-left transition-colors hover:border-zinc-500"
                  >
                    {p.avatarUrl ? (
                      <span className="grid aspect-[3/4] w-full place-items-center bg-zinc-950">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.avatarUrl} alt="" className="aspect-square w-[78%] rounded-full object-cover" />
                      </span>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.thumbUrl} alt="" loading="lazy" decoding="async" className="aspect-[3/4] w-full bg-zinc-950 object-cover" />
                    )}
                    <span className="block px-3 py-2.5">
                      <span className="block truncate text-sm">{p.name}</span>
                      <span className="block text-[11px] text-zinc-500">
                        {p.videos.length === 0 ? 'no videos yet' : `${p.videos.length} ${p.videos.length === 1 ? 'video' : 'videos'}`}
                      </span>
                    </span>
                  </button>
                ))}
                {library && <NewPersonaCard onCreated={onChanged} />}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
