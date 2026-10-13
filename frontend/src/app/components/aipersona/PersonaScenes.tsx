'use client';

// "Make scenes", from a character's page: New scene the other way round. There
// the video is set and the characters are picked; here the character is set
// and the scenes are picked — from the saved ones (the Scenes page), sorted
// into Hook, Trading and End by their names.
//
// Go makes a scene of its own for every one picked, with this character in it,
// and starts its character first frame. Each then opens in a tab and goes on
// like any scene: the frame is looked over, the Kling prompt written, the
// video approved — and lands on this character's page under the saved scene's
// name, so one called "Trading at desk" is filed under Trading.
//
// Nothing is spent before Go.

import { useState } from 'react';
import { SpinnerIcon } from '@/lib/icons';
import { makeScenes } from '@/lib/aipersona/client';
import { DEFAULT_LOCATION_FRAME_PROMPT } from '@/lib/aipersona/location-prompt';
import {
  DEFAULT_FRAME_PROMPT, MAX_FRAME_PROMPT_CHARS, SCENE_KINDS, sceneKind, type Persona, type SavedScene, type Scene,
} from '@/lib/aipersona/types';
import { FIELD, GHOST, LABEL, PRIMARY, Split, errorText } from './aipersona-ui';

export function PersonaScenes({ persona, saved, onBack, onOpenSaved, onMade }: {
  persona: Persona;
  saved: SavedScene[];
  onBack: () => void;
  /** To the Scenes page, to save some. */
  onOpenSaved: () => void;
  /** Go answered: these are the scenes it made, their first frames running. */
  onMade: (scenes: Scene[]) => void;
}) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [prompt, setPrompt] = useState(DEFAULT_FRAME_PROMPT);
  const [locationPrompt, setLocationPrompt] = useState(DEFAULT_LOCATION_FRAME_PROMPT);
  /** Draw this character in its own room. Only there to switch on when it
   *  has one. */
  const [useLocation, setUseLocation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const located = useLocation && !!persona.roomUrl;
  const chosen = saved.filter((s) => picked.has(s.id));
  const ready = chosen.length > 0 && !busy && !!(located ? locationPrompt : prompt).trim();
  /** What this character already has a video of, by name. */
  const have = new Set(persona.videos.map((v) => v.sceneName.trim().toLowerCase()));

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function go() {
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      const { scenes, failed } = await makeScenes(persona.id, {
        savedIds: chosen.map((s) => s.id),
        // The one not in use still has to be something: a character with no
        // room is drawn from the first.
        prompt: prompt.trim() || DEFAULT_FRAME_PROMPT,
        ...(located ? { useLocation: true, locationPrompt: locationPrompt.trim() } : {}),
      });
      if (failed.length) {
        // The ones that were made are opened all the same; say which were not.
        alert(`${failed.length} could not be made:\n\n${failed.map((f) => `${f.name} — ${f.error}`).join('\n')}`);
      }
      onMade(scenes);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const side = (
    <div className="grid gap-5">
      <div className="flex items-center gap-3">
        <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-zinc-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={persona.avatarUrl ?? persona.thumbUrl} alt="" className="h-full w-full object-cover object-top" />
        </span>
        <span className="min-w-0">
          <span className={`block ${LABEL}`}>Character</span>
          <span className="block truncate text-sm">{persona.name}</span>
        </span>
      </div>

      {persona.roomThumbUrl ? (
        <button
          type="button"
          role="switch"
          aria-checked={useLocation}
          onClick={() => setUseLocation((v) => !v)}
          disabled={busy}
          title={useLocation ? 'Every first frame is drawn in its own location — click to turn off' : 'Draw every first frame in its own location'}
          className={`flex items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors disabled:cursor-default ${useLocation ? 'border-emerald-400' : 'border-zinc-800 hover:border-zinc-600'}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={persona.roomThumbUrl} alt="" className={`h-10 w-14 shrink-0 rounded object-cover ${useLocation ? '' : 'opacity-50'}`} />
          <span className={`min-w-0 flex-1 text-sm ${useLocation ? 'text-white' : 'text-zinc-400'}`}>Use location</span>
          <span className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${useLocation ? 'bg-emerald-500' : 'bg-zinc-700'}`}>
            <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${useLocation ? 'left-3.5' : 'left-0.5'}`} />
          </span>
        </button>
      ) : (
        <p className="text-[11px] text-zinc-600">No location saved for {persona.name}. Add a room photo on its page to draw it in its own place.</p>
      )}

      <label className={`grid gap-1.5 ${LABEL}`}>
        <span className="flex items-center justify-between">
          First-frame prompt
          {prompt !== DEFAULT_FRAME_PROMPT && !busy && (
            <button type="button" onClick={() => setPrompt(DEFAULT_FRAME_PROMPT)} className="normal-case tracking-normal text-zinc-500 transition-colors hover:text-white">
              back to the default
            </button>
          )}
        </span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value.slice(0, MAX_FRAME_PROMPT_CHARS))}
          disabled={busy}
          className={`${FIELD} min-h-[150px] resize-y py-2.5 normal-case leading-relaxed tracking-normal`}
        />
        <span className={`normal-case tracking-normal ${located ? 'text-zinc-600' : 'text-emerald-400'}`}>
          #image1 is the first frame of the video, #image2 the character&apos;s photo.{located ? ' Not used while “Use location” is on.' : ' This is the one in use.'}
        </span>
      </label>

      <label className={`grid gap-1.5 ${LABEL}`}>
        <span className="flex items-center justify-between">
          First-frame prompt with location
          {locationPrompt !== DEFAULT_LOCATION_FRAME_PROMPT && !busy && (
            <button type="button" onClick={() => setLocationPrompt(DEFAULT_LOCATION_FRAME_PROMPT)} className="normal-case tracking-normal text-zinc-500 transition-colors hover:text-white">
              back to the default
            </button>
          )}
        </span>
        <textarea
          value={locationPrompt}
          onChange={(e) => setLocationPrompt(e.target.value.slice(0, MAX_FRAME_PROMPT_CHARS))}
          disabled={busy}
          className={`${FIELD} min-h-[150px] resize-y py-2.5 normal-case leading-relaxed tracking-normal`}
        />
        <span className={`normal-case tracking-normal ${located ? 'text-emerald-400' : 'text-zinc-600'}`}>
          #image1 is the first frame of the video, #image2 the character&apos;s photo, #image3 its location.{located ? ' This is the one in use.' : ' Used when “Use location” is on.'}
        </span>
      </label>
    </div>
  );

  const footer = (
    <div className="grid gap-2.5">
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button type="button" onClick={go} disabled={!ready} className={PRIMARY}>
        {busy && <SpinnerIcon size={13} className="animate-spin" />}
        {busy ? 'Making the scenes…' : 'Go'}
      </button>
      <p className="text-[11px] text-zinc-600">
        {chosen.length === 0
          ? 'Pick the scenes to make on the right.'
          : `Go makes ${chosen.length === 1 ? 'a scene' : `${chosen.length} scenes`} with ${persona.name} in ${chosen.length === 1 ? 'it' : 'each'}${located ? ', in its own location' : ''}: one character first frame apiece. Each opens in its own tab.`}
      </p>
    </div>
  );

  return (
    <Split title="Make scenes" backLabel={persona.name} onBack={onBack} side={side} footer={footer}>
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold">Scenes to make with {persona.name}</h2>
        <span className="flex items-baseline gap-3 text-xs tabular-nums text-zinc-500">
          {chosen.length} of {saved.length} picked · click the ones you want
          {!busy && saved.length > 0 && (
            <button
              type="button"
              onClick={() => setPicked(chosen.length === saved.length ? new Set() : new Set(saved.map((s) => s.id)))}
              className="text-zinc-400 transition-colors hover:text-white"
            >
              {chosen.length === saved.length ? 'none' : 'all'}
            </button>
          )}
        </span>
      </div>

      {saved.length === 0 ? (
        <div className="grid max-w-[520px] gap-3">
          <p className="text-sm leading-relaxed text-zinc-500">
            No scenes saved yet. A scene is saved once — a video, trimmed and named — and can then be made for any character.
          </p>
          <button type="button" onClick={onOpenSaved} className={`${GHOST} w-fit`}>Open Scenes</button>
        </div>
      ) : (
        SCENE_KINDS.map((kind) => {
          const scenes = saved.filter((s) => sceneKind(s.name) === kind.key);
          return (
            <section key={kind.key} className="mb-8">
              <h3 className="mb-3 flex items-baseline gap-3 text-sm font-semibold">
                <span>{kind.label} <span className="ml-1 text-xs font-normal tabular-nums text-zinc-500">{scenes.length}</span></span>
                {!busy && scenes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setPicked((prev) => {
                      const next = new Set(prev);
                      const all = scenes.every((s) => next.has(s.id));
                      for (const s of scenes) { if (all) next.delete(s.id); else next.add(s.id); }
                      return next;
                    })}
                    className="text-xs font-normal text-zinc-500 transition-colors hover:text-white"
                  >
                    {scenes.every((s) => picked.has(s.id)) ? 'none of these' : 'all of these'}
                  </button>
                )}
              </h3>
              {scenes.length === 0 ? (
                <p className="text-xs text-zinc-600">
                  {kind.key === 'hook' ? 'None.' : `None — a saved scene with “${kind.key}” in its name is listed here.`}
                </p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] items-start gap-3">
                  {scenes.map((s) => {
                    const on = picked.has(s.id);
                    const made = have.has(s.name.trim().toLowerCase());
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggle(s.id)}
                        disabled={busy}
                        aria-pressed={on}
                        title={on ? 'Picked — click to take out' : 'Click to pick'}
                        className={`group overflow-hidden rounded-lg border text-left transition-colors disabled:cursor-default ${on ? 'border-emerald-400' : 'border-zinc-900 hover:border-zinc-600'}`}
                      >
                        <div className="relative bg-black">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={s.thumbUrl}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            draggable={false}
                            style={s.width && s.height ? { aspectRatio: `${s.width} / ${s.height}` } : undefined}
                            className={`w-full object-contain transition-opacity ${on ? '' : 'opacity-50 group-hover:opacity-80'}`}
                          />
                          {on && <span className="absolute right-1.5 top-1.5 rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold text-black">✓ in</span>}
                          {made && (
                            <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-zinc-400" title={`${persona.name} already has a video called this`}>
                              made
                            </span>
                          )}
                        </div>
                        <div className={`flex items-baseline gap-2 px-2.5 pt-2 text-sm ${on ? 'text-white' : 'text-zinc-500'}`}>
                          <span className="min-w-0 flex-1 truncate">{s.name}</span>
                          <span className="text-[11px] tabular-nums text-zinc-500">{s.duration.toFixed(1)}s</span>
                        </div>
                        {/* The sentence its Kling prompt will open with. */}
                        <p
                          className={`line-clamp-2 px-2.5 pb-2 text-[11px] leading-snug ${s.action ? 'text-zinc-500' : 'text-amber-400/80'}`}
                          title={s.action || 'No sentence written for this scene yet: its video prompt will have to be filled in by hand. Write one on the Scenes page.'}
                        >
                          {s.action || 'no sentence yet'}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })
      )}
    </Split>
  );
}
