'use client';

// One persona: its videos, and the two things about it that can be edited —
// the name, and the character photo. Drop a new photo on the old one to
// replace it; scenes made from here on use the new one.
//
// The videos are also what a Vids persona is made from: "Make persona video"
// picks three of them — a start, a middle and an end — edits each, and saves
// them to Vids as a persona (PersonaVideoMaker). Under the videos are the
// personas made that way so far: whatever is in this character's folder in
// Vids.

import { useEffect, useState } from 'react';
import { DownloadIcon, SpinnerIcon } from '@/lib/icons';
import { deletePersona, deleteTake, downloadUrl, fileSlug, makeAvatar, updatePersona, uploadFile } from '@/lib/aipersona/client';
import { MAX_NAME_CHARS, PHOTO_TYPES, type Persona } from '@/lib/aipersona/types';
import { listLibrary } from '@/lib/vids-client';
import { personaFolders } from '@/lib/vids-persona-folders';
import { PERSONA_PARTS, type VidRow, type VidsLibraryPayload } from '@/lib/vids-types';
import { PersonaVideoMaker } from './PersonaVideoMaker';
import { ConfirmButton, DropZone, FIELD, LABEL, PRIMARY, Split, errorText, photoProblem } from './aipersona-ui';

type Busy = 'name' | 'photo' | 'video' | 'delete' | 'avatar';

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** A persona video played whole: its clips one after the other in the one
 *  player — Start, then Middle, then End — and back to the start when the
 *  last one ends. */
function WholeVideo({ clips }: { clips: VidRow[] }) {
  const [at, setAt] = useState(0);
  /** A clip ended and the next one follows on by itself. */
  const [rolling, setRolling] = useState(false);
  const clip = clips[Math.min(at, clips.length - 1)];
  return (
    <div className="relative">
      <video
        src={clip.url}
        poster={at === 0 ? clip.thumbUrl ?? undefined : undefined}
        controls
        playsInline
        preload="none"
        autoPlay={rolling}
        onEnded={() => {
          const last = at >= clips.length - 1;
          setRolling(!last);
          setAt(last ? 0 : at + 1);
        }}
        className="aspect-[9/16] w-full bg-black object-contain"
      />
      {clips.length > 1 && (
        <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] tabular-nums text-zinc-300">
          {at + 1} / {clips.length}
        </span>
      )}
    </div>
  );
}

export function PersonaDetail({ persona, onBack, onChanged }: {
  persona: Persona;
  onBack: () => void;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState(persona.name);
  /** "Make persona video" is open in place of the videos. */
  const [making, setMaking] = useState(false);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState('');

  // The personas already made from this character: the ones in its folder in
  // Vids — the folder under Persona with its name, which is where "Make
  // persona video" puts them (lib/vids-persona-folders). Read when the page
  // opens and again when the maker closes, since it may have just made one.
  const [vids, setVids] = useState<VidsLibraryPayload | null>(null);
  useEffect(() => {
    if (making) return;
    let live = true;
    listLibrary().then(
      (lib) => { if (live) setVids(lib); },
      () => { /* Vids could not be read: the videos above are still the page */ },
    );
    return () => { live = false; };
  }, [making]);
  const sameName = (a: string) => a.trim().toLowerCase() === persona.name.trim().toLowerCase();
  const folderIds = new Set(vids ? personaFolders(vids.folders).filter((f) => sameName(f.name)).map((f) => f.id) : []);
  const made = vids ? vids.personas.filter((p) => p.folderId && folderIds.has(p.folderId)) : [];

  async function run(what: Busy, action: () => Promise<unknown>) {
    setBusy(what);
    setError('');
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  function rename() {
    const next = name.trim();
    if (!next) { setName(persona.name); return; }
    if (next !== persona.name) void run('name', () => updatePersona(persona.id, { name: next }));
  }

  function replacePhoto(file: File) {
    const problem = photoProblem(file);
    setError(problem);
    if (!problem) void run('photo', async () => updatePersona(persona.id, { photoPath: await uploadFile('photo', file) }));
  }

  const side = (
    <div className="grid gap-5">
      <div className="flex items-center gap-3">
        <span className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-zinc-900">
          {persona.avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={persona.avatarUrl} alt="" className={`h-full w-full object-cover ${busy === 'avatar' ? 'opacity-40' : ''}`} />
          )}
          {busy === 'avatar' && <SpinnerIcon size={18} className="absolute animate-spin text-white" />}
        </span>
        <button
          type="button"
          onClick={() => void run('avatar', () => makeAvatar(persona.id))}
          disabled={!!busy}
          className="text-xs text-zinc-400 transition-colors hover:text-white disabled:opacity-40"
        >
          {busy === 'avatar' ? 'Making a profile pic…' : persona.avatarUrl ? 'New profile pic' : 'Make a profile pic'}
        </button>
      </div>

      <div className="grid gap-1.5">
        <span className={LABEL}>Character photo</span>
        <DropZone accept={PHOTO_TYPES.join(',')} onFile={replacePhoto} disabled={!!busy} label="Replace the character photo" className="relative grid place-items-center rounded-md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={persona.photoUrl} alt="" className={`w-full object-contain ${busy === 'photo' ? 'opacity-40' : ''}`} />
          {busy === 'photo' && <SpinnerIcon size={22} className="absolute animate-spin text-white" />}
        </DropZone>
        <span className="text-[11px] text-zinc-600">Drop a new photo on it, or click, to replace it.</span>
      </div>

      <label className={`grid gap-1.5 ${LABEL}`}>
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_CHARS))}
          onBlur={rename}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          disabled={busy === 'delete'}
          className={`${FIELD} h-9 normal-case tracking-normal`}
        />
      </label>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <ConfirmButton
        onConfirm={() => run('delete', async () => { await deletePersona(persona.id); onBack(); })}
        disabled={!!busy}
        armedLabel={`Click again to delete ${persona.name}${persona.videos.length ? ' and its videos' : ''}`}
        className="w-fit border border-transparent text-xs text-zinc-600 transition-colors hover:text-white"
      >
        Delete this character
      </ConfirmButton>
    </div>
  );

  // It takes the whole page: the editor it opens needs the room.
  if (making) return <PersonaVideoMaker persona={persona} onClose={() => setMaking(false)} />;

  return (
    <Split title={persona.name} backLabel="Characters" onBack={onBack} side={side}>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold">
          Videos <span className="ml-1 text-xs font-normal tabular-nums text-zinc-500">{persona.videos.length}</span>
        </h2>
        <button
          type="button"
          onClick={() => setMaking(true)}
          disabled={!persona.videos.length}
          title={persona.videos.length ? 'Pick a start, a middle and an end from these videos, edit each, and save them to Vids as one persona video' : 'This character has no videos yet'}
          className={PRIMARY}
        >
          Make persona video
        </button>
      </div>
      {persona.videos.length === 0 ? (
        <p className="text-sm text-zinc-500">No videos yet. They land here when a scene with {persona.name} in it is approved.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] items-start gap-4">
          {persona.videos.map((v) => {
            const fileName = `${fileSlug(v.sceneName)}-${fileSlug(persona.name)}.mp4`;
            return (
              <div key={v.id} className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
                <video src={v.url} poster={v.frameUrl ?? undefined} controls playsInline loop preload="metadata" className="max-h-[60vh] w-full bg-black object-contain" />
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{v.sceneName}</span>
                    <span className="block text-[11px] text-zinc-500">{day(v.savedAt)}</span>
                  </span>
                  <a href={downloadUrl(v.url, fileName)} download={fileName} title="Download" className="text-zinc-500 transition-colors hover:text-white">
                    <DownloadIcon size={14} />
                  </a>
                  <ConfirmButton
                    onConfirm={() => run('video', () => deleteTake(v.id))}
                    disabled={!!busy}
                    armedLabel="Delete?"
                    className="border border-transparent text-xs text-zinc-600 transition-colors hover:text-white"
                  >
                    Delete
                  </ConfirmButton>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* What has been made of them already: this character's persona videos
          in Vids — the ones under the persona of the same name there. */}
      <h2 className="mb-4 mt-10 text-sm font-semibold">
        Persona videos <span className="ml-1 text-xs font-normal tabular-nums text-zinc-500">{vids ? made.length : ''}</span>
      </h2>
      {!vids ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500"><SpinnerIcon size={13} className="animate-spin" /> Reading Vids…</p>
      ) : made.length === 0 ? (
        <p className="max-w-[560px] text-sm leading-relaxed text-zinc-500">
          None yet. A video made with “Make persona video” is filed under {persona.name} in Vids and is listed here —
          as is any other video moved to {persona.name} there.
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] items-start gap-4">
          {made.map((p) => {
            const clips = PERSONA_PARTS.map((part) => vids.videos.find((v) => v.id === p[part]));
            const first = clips.find(Boolean);
            const filled = clips.filter(Boolean).length;
            return (
              <div key={p.id} className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
                {first ? (
                  <WholeVideo clips={clips.filter((c): c is VidRow => !!c)} />
                ) : (
                  <div className="grid aspect-[9/16] place-items-center bg-black text-[11px] text-zinc-600">no clips</div>
                )}
                <div className="px-3 py-2.5">
                  <span className="block truncate text-sm" title={p.name}>{p.name}</span>
                  <span className={`block text-[11px] ${filled === PERSONA_PARTS.length ? 'text-zinc-500' : 'text-amber-400'}`}>
                    {filled === PERSONA_PARTS.length ? 'Start · Middle · End' : `${filled} of 3 parts`}
                    {' · '}
                    <span className={p.clipable ? 'text-emerald-400' : 'text-zinc-500'}>{p.clipable ? 'on for clippers' : 'off for clippers'}</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Split>
  );
}
