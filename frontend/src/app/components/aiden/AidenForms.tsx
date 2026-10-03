'use client';

// The forms: a person, a firm, a place, an event, a tie between two people,
// a round and the firms that were in it.
// Each one adds when it is opened bare and edits when it is handed a row.
//
// Nothing on a form is a dead end. The firm and the place can be made from the
// select that picks them, and an event's people can be made from the box that
// searches them, so logging "went to this, met these five" is one form even
// when none of the five existed a minute ago.

import React, { useMemo, useState } from 'react';
import {
  EVENT_KINDS, EVENT_KIND_LABEL, EVENT_ROLES, EVENT_ROLE_LABEL, FIRM_KINDS, FIRM_KIND_LABEL,
  LINK_KINDS, LINK_KIND_LABEL, ROUND_ROLES, ROUND_ROLE_LABEL, WARMTHS,
  type AidenEvent, type AidenEventPerson, type AidenFirm, type AidenLink, type AidenPerson,
  type AidenPlace, type AidenRound, type AidenRoundFirm, type EventKind, type EventRole, type FirmKind,
  type LinkKind, type RoundRole, type Warmth,
} from '@/lib/aiden-types';
import { ANNOUNCED_RE } from '@/lib/aiden-rounds';
import { aidenFetch, type UseAidenData } from './useAidenData';
import {
  Field, KIND_COLOR, Modal, RefSelect, WARMTH_COLOR, btnDanger, btnGhost, btnPrimary,
  fromDateInput, inputCls, textareaCls, toDateInput, todayInput,
} from './aiden-ui';

function Footer({
  onClose, onDelete, busy, canSave, saveLabel,
}: {
  onClose: () => void;
  onDelete?: () => void;
  busy: boolean;
  canSave: boolean;
  saveLabel: string;
}) {
  return (
    <div className="mt-5 flex items-center justify-between gap-2">
      <div>
        {onDelete && (
          <button type="button" onClick={onDelete} disabled={busy} className={btnDanger}>Delete</button>
        )}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
        <button type="submit" disabled={busy || !canSave} className={btnPrimary}>
          {busy ? 'Saving...' : saveLabel}
        </button>
      </div>
    </div>
  );
}

const byName = <T extends { name: string }>(list: T[]) =>
  [...list].sort((a, b) => a.name.localeCompare(b.name));

// ── Person ────────────────────────────────────────────────────────────────────
export function PersonForm({
  api, initial, presetFirmId, presetPlaceId, onClose, onSaved, onDeleted,
}: {
  api: UseAidenData;
  initial?: AidenPerson;
  presetFirmId?: string | null;
  presetPlaceId?: string | null;
  onClose: () => void;
  onSaved?: (id: string) => void;
  onDeleted?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [firmId, setFirmId] = useState<string | null>(initial?.firmId ?? presetFirmId ?? null);
  const [placeId, setPlaceId] = useState<string | null>(initial?.placeId ?? presetPlaceId ?? null);
  const [warmth, setWarmth] = useState<Warmth>(initial?.warmth ?? 'cold');
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [email, setEmail] = useState(initial?.email ?? '');
  const [linkedin, setLinkedin] = useState(initial?.linkedin ?? '');
  const [twitter, setTwitter] = useState(initial?.twitter ?? '');
  const [bio, setBio] = useState(initial?.bio ?? '');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const body = { name, title, firmId, placeId, warmth, tags, email, linkedin, twitter, bio };
    if (initial) {
      const ok = await api.update('people', initial.id, body);
      setBusy(false);
      if (ok) { onSaved?.(initial.id); onClose(); }
    } else {
      const id = await api.create('people', body);
      setBusy(false);
      if (id) { onSaved?.(id); onClose(); }
    }
  }

  async function del() {
    if (!initial) return;
    if (!window.confirm(`Delete ${initial.name}? They come off every event they were on, and their ties go too.`)) return;
    setBusy(true);
    const ok = await api.remove('people', initial.id);
    setBusy(false);
    if (ok) { onDeleted?.(); onClose(); }
  }

  return (
    <Modal title={initial ? `Edit ${initial.name}` : 'New person'} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className={inputCls} />
          </Field>
          <Field label="Title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Partner, Founder..." className={inputCls} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Firm">
            <RefSelect
              value={firmId}
              options={byName(api.data.firms)}
              onChange={setFirmId}
              onCreate={(n) => api.create('firms', { name: n, kind: 'vc', placeId })}
              none="No firm"
              noun="firm"
            />
          </Field>
          <Field label="Place">
            <RefSelect
              value={placeId}
              options={byName(api.data.places)}
              onChange={setPlaceId}
              onCreate={(n) => api.create('places', { name: n })}
              none="No place"
              noun="place"
            />
          </Field>
        </div>
        <Field label="Warmth" hint="How well they know you">
          <div className="flex gap-1.5">
            {WARMTHS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWarmth(w)}
                className="flex-1 rounded-md border px-2 py-1.5 text-[12px] font-medium capitalize transition-colors"
                style={
                  warmth === w
                    ? { color: WARMTH_COLOR[w], borderColor: `${WARMTH_COLOR[w]}88`, backgroundColor: `${WARMTH_COLOR[w]}1a` }
                    : { color: '#71717a', borderColor: '#27272a' }
                }
              >
                {w}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Bio" hint="Who they are, what they care about">
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={4} placeholder="Brief bio" className={textareaCls} />
        </Field>
        <Field label="Tags" hint="Comma separated">
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="seed, fintech, angel" className={inputCls} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Email">
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@firm.com" className={inputCls} />
          </Field>
          <Field label="LinkedIn">
            <input value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="linkedin.com/in/..." className={inputCls} />
          </Field>
          <Field label="X">
            <input value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="@handle" className={inputCls} />
          </Field>
        </div>
        <Footer
          onClose={onClose}
          onDelete={initial ? del : undefined}
          busy={busy}
          canSave={Boolean(name.trim())}
          saveLabel={initial ? 'Save' : 'Add person'}
        />
      </form>
    </Modal>
  );
}

// ── Firm ──────────────────────────────────────────────────────────────────────
// A firm is filled with its people from its own form: pick people already in
// the log, or type a name that isn't and they are made with the firm. Nothing
// is written until Save, and then all of it is, in one go: the firm, who joined
// it, who was made for it, and who was taken out.
interface Member {
  /** The person's id once they exist; a made-up key for one still to be made. */
  key: string;
  id?: string;
  name: string;
  title: string;
}

function MemberPicker({
  api, value, onChange, firmId,
}: {
  api: UseAidenData;
  value: Member[];
  onChange: (next: Member[]) => void;
  firmId?: string;
}) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const taken = useMemo(() => new Set(value.map((m) => m.id ?? '')), [value]);
  const typed = useMemo(() => new Set(value.map((m) => m.name.trim().toLowerCase())), [value]);

  const matches = useMemo(() => {
    if (!needle) return [];
    return api.data.people
      .filter((p) => !taken.has(p.id) && p.name.toLowerCase().includes(needle))
      .slice(0, 6);
  }, [api.data.people, needle, taken]);
  const exact = api.data.people.some((p) => p.name.toLowerCase() === needle) || typed.has(needle);

  function addExisting(id: string) {
    const p = api.index.person.get(id);
    if (!p) return;
    onChange([...value, { key: p.id, id: p.id, name: p.name, title: p.title }]);
    setQ('');
  }

  function addNew() {
    const name = q.trim();
    if (!name || exact) return;
    onChange([...value, { key: `new-${Date.now()}-${value.length}`, name, title: '' }]);
    setQ('');
  }

  return (
    <div className="flex flex-col gap-1.5">
      {value.length > 0 && (
        <div className="flex flex-col gap-1">
          {value.map((m) => (
            <div key={m.key} className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
              <div className="min-w-0 flex-1 truncate">
                <span className="text-[12.5px] text-white">{m.name}</span>
                {!m.id && <span className="ml-1.5 text-[10.5px] text-emerald-400">new</span>}
              </div>
              <input
                value={m.title}
                onChange={(e) => onChange(value.map((x) => (x.key === m.key ? { ...x, title: e.target.value } : x)))}
                placeholder="Title"
                className="w-[170px] rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11.5px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600"
              />
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x.key !== m.key))}
                title={m.id ? 'Take out of this firm' : 'Remove'}
                className="text-zinc-600 transition-colors hover:text-red-400"
                aria-label="Remove"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="relative">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (matches.length) addExisting(matches[0].id);
            else addNew();
          }}
          placeholder="Type a name: someone in the log, or someone new"
          className={inputCls}
        />
        {needle && (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-zinc-800 bg-[#161616] shadow-xl">
            {matches.map((p) => {
              const at = p.firmId && p.firmId !== firmId ? api.index.firm.get(p.firmId)?.name : '';
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addExisting(p.id)}
                  className="flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-zinc-800"
                >
                  <span className="text-[12.5px] text-white">{p.name}</span>
                  <span className="truncate text-[11px] text-zinc-600">
                    {[p.title, at ? `now at ${at}, moves here` : ''].filter(Boolean).join(', ')}
                  </span>
                </button>
              );
            })}
            {!exact && (
              <button
                type="button"
                onClick={addNew}
                className="flex w-full items-center gap-1.5 border-t border-zinc-800 px-2.5 py-1.5 text-left text-[12px] text-emerald-300 transition-colors hover:bg-zinc-800"
              >
                + New person &quot;{q.trim()}&quot;
              </button>
            )}
            {exact && matches.length === 0 && (
              <p className="px-2.5 py-1.5 text-[11.5px] text-zinc-600">Already in this firm.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function FirmForm({
  api, initial, presetPlaceId, onClose, onSaved, onDeleted,
}: {
  api: UseAidenData;
  initial?: AidenFirm;
  presetPlaceId?: string | null;
  onClose: () => void;
  onSaved?: (id: string) => void;
  onDeleted?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<FirmKind>(initial?.kind ?? 'vc');
  const [website, setWebsite] = useState(initial?.website ?? '');
  const [placeId, setPlaceId] = useState<string | null>(initial?.placeId ?? presetPlaceId ?? null);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  // Who was in the firm when the form opened, to tell on Save who has left.
  const [before] = useState<Member[]>(() =>
    initial
      ? api.data.people
          .filter((p) => p.firmId === initial.id)
          .map((p) => ({ key: p.id, id: p.id, name: p.name, title: p.title }))
      : [],
  );
  const [members, setMembers] = useState<Member[]>(before);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const firmName = name.trim();
    if (!firmName || busy) return;
    setBusy(true);

    const staying = new Set(members.map((m) => m.id).filter(Boolean));
    const result = await api.ingest({
      firms: [{ ...(initial ? { id: initial.id } : {}), name: firmName, kind, website, placeId, notes }],
      people: [
        ...members.map((m) =>
          m.id
            ? { id: m.id, title: m.title, firm: firmName }
            // Someone new starts out where the firm is.
            : { name: m.name, title: m.title, firm: firmName, placeId },
        ),
        ...before.filter((m) => m.id && !staying.has(m.id)).map((m) => ({ id: m.id, firmId: null })),
      ],
    });
    setBusy(false);
    if (!result) return;
    const id = initial?.id ?? result.firms.find((r) => r.label.toLowerCase() === firmName.toLowerCase())?.id ?? result.firms[0]?.id;
    if (id) onSaved?.(id);
    onClose();
  }

  async function del() {
    if (!initial) return;
    if (!window.confirm(`Delete ${initial.name}? Its people stay, with no firm.`)) return;
    setBusy(true);
    const ok = await api.remove('firms', initial.id);
    setBusy(false);
    if (ok) { onDeleted?.(); onClose(); }
  }

  return (
    <Modal title={initial ? `Edit ${initial.name}` : 'New firm'} onClose={onClose} wide>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Firm name" className={inputCls} />
          </Field>
          <Field label="Kind">
            <select value={kind} onChange={(e) => setKind(e.target.value as FirmKind)} className={inputCls}>
              {FIRM_KINDS.map((k) => <option key={k} value={k}>{FIRM_KIND_LABEL[k]}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Place">
            <RefSelect
              value={placeId}
              options={byName(api.data.places)}
              onChange={setPlaceId}
              onCreate={(n) => api.create('places', { name: n })}
              none="No place"
              noun="place"
            />
          </Field>
          <Field label="Website">
            <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="firm.com" className={inputCls} />
          </Field>
        </div>
        <Field label="People" hint="Add who you know there, or make them">
          <MemberPicker api={api} value={members} onChange={setMembers} firmId={initial?.id} />
        </Field>
        <Field label="Notes" hint="Stage, check size, thesis, what they have said">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className={textareaCls} />
        </Field>
        <Footer
          onClose={onClose}
          onDelete={initial ? del : undefined}
          busy={busy}
          canSave={Boolean(name.trim())}
          saveLabel={initial ? 'Save' : 'Add firm'}
        />
      </form>
    </Modal>
  );
}

// ── Place ─────────────────────────────────────────────────────────────────────
export function PlaceForm({
  api, initial, onClose, onSaved, onDeleted,
}: {
  api: UseAidenData;
  initial?: AidenPlace;
  onClose: () => void;
  onSaved?: (id: string) => void;
  onDeleted?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  // Where it is on the map. Looked up by name on its own the first time the
  // map opens; this is for saying what to look it up as when that lands wrong.
  const [geoQuery, setGeoQuery] = useState(initial?.geoQuery ?? '');
  const [hit, setHit] = useState<{ lat: number; lng: number; label: string } | null>(
    initial && initial.lat !== null && initial.lng !== null
      ? { lat: initial.lat, lng: initial.lng, label: initial.geoLabel }
      : null,
  );
  const [looking, setLooking] = useState(false);
  const [lookError, setLookError] = useState('');
  const [busy, setBusy] = useState(false);

  async function lookUp() {
    const query = geoQuery.trim() || name.trim();
    if (!query || looking) return;
    setLooking(true);
    setLookError('');
    try {
      const r = await aidenFetch<{ found: boolean; lat?: number; lng?: number; label?: string }>(
        '/api/aiden/geocode', { method: 'POST', body: JSON.stringify({ query }) },
      );
      if (r.found && r.lat !== undefined && r.lng !== undefined) setHit({ lat: r.lat, lng: r.lng, label: r.label ?? query });
      else setLookError(`Nothing found for "${query}". Try adding the state or country.`);
    } catch (e) {
      setLookError(e instanceof Error ? e.message : 'The lookup failed');
    } finally {
      setLooking(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const body = {
      name, notes, geoQuery,
      lat: hit?.lat ?? null,
      lng: hit?.lng ?? null,
      geoLabel: hit?.label ?? '',
      // Cleared on purpose is looked up again by name next time the map opens.
      geoStatus: hit ? 'ok' : '',
    };
    if (initial) {
      const ok = await api.update('places', initial.id, body);
      setBusy(false);
      if (ok) { onSaved?.(initial.id); onClose(); }
    } else {
      const id = await api.create('places', body);
      setBusy(false);
      if (id) { onSaved?.(id); onClose(); }
    }
  }

  async function del() {
    if (!initial) return;
    if (!window.confirm(`Delete ${initial.name}? The people and firms there stay, with no place.`)) return;
    setBusy(true);
    const ok = await api.remove('places', initial.id);
    setBusy(false);
    if (ok) { onDeleted?.(); onClose(); }
  }

  return (
    <Modal title={initial ? `Edit ${initial.name}` : 'New place'} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Name">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="SF, Austin, NYC..." className={inputCls} />
        </Field>
        <Field label="Notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={textareaCls} />
        </Field>
        <Field label="On the map" hint="Looked up by name unless you say otherwise">
          <div className="flex gap-1.5">
            <input
              value={geoQuery}
              onChange={(e) => setGeoQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void lookUp(); } }}
              placeholder={`Look up as, e.g. "${name.trim() || 'Novi'}, Michigan"`}
              className={inputCls}
            />
            <button type="button" onClick={() => void lookUp()} disabled={looking || (!geoQuery.trim() && !name.trim())} className={`${btnGhost} shrink-0`}>
              {looking ? 'Looking...' : 'Look up'}
            </button>
          </div>
          {hit ? (
            <p className="mt-1 flex items-baseline gap-2 text-[11px] text-zinc-500">
              <span className="min-w-0 flex-1 truncate" title={hit.label}>
                <span className="text-emerald-400">Found:</span> {hit.label || `${hit.lat.toFixed(3)}, ${hit.lng.toFixed(3)}`}
              </span>
              <button type="button" onClick={() => setHit(null)} className="shrink-0 text-zinc-600 hover:text-white">Clear</button>
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-zinc-600">
              {initial?.geoStatus === 'missing' ? 'Not found by name yet. Say what to look it up as.' : 'Not placed yet.'}
            </p>
          )}
          {lookError && <p className="mt-1 text-[11px] text-red-300">{lookError}</p>}
        </Field>
        <Footer
          onClose={onClose}
          onDelete={initial ? del : undefined}
          busy={busy}
          canSave={Boolean(name.trim())}
          saveLabel={initial ? 'Save' : 'Add place'}
        />
      </form>
    </Modal>
  );
}

// ── Event ─────────────────────────────────────────────────────────────────────
/** What someone most likely was to an event of this kind. */
function defaultRole(kind: EventKind): EventRole {
  if (kind === 'event' || kind === 'meeting' || kind === 'call' || kind === 'coffee') return 'met';
  if (kind === 'intro') return 'introduced';
  if (kind === 'invested') return 'investor';
  return 'contacted';
}

const TITLE_HINT: Record<EventKind, string> = {
  email: 'Cold email about the seed round',
  linkedin: 'Connection request and note',
  text: 'Texted to say thanks',
  call: 'Intro call',
  coffee: 'Coffee at Blue Bottle',
  meeting: 'Partner meeting',
  event: 'Founders and funders night',
  intro: 'Intro from a mutual',
  referral: 'Asked for a referral',
  invested: 'Invested in the seed round',
  other: 'What happened',
};

function PeoplePicker({
  api, value, onChange, kind,
}: {
  api: UseAidenData;
  value: AidenEventPerson[];
  onChange: (next: AidenEventPerson[]) => void;
  kind: EventKind;
}) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const picked = useMemo(() => new Set(value.map((v) => v.personId)), [value]);

  const needle = q.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!needle) return [];
    return api.data.people
      .filter((p) => !picked.has(p.id) && p.name.toLowerCase().includes(needle))
      .slice(0, 6);
  }, [api.data.people, needle, picked]);
  const exact = api.data.people.some((p) => p.name.toLowerCase() === needle);

  function add(personId: string) {
    onChange([...value, { personId, role: defaultRole(kind) }]);
    setQ('');
  }

  async function createAndAdd() {
    const name = q.trim();
    if (!name || busy) return;
    setBusy(true);
    const id = await api.create('people', { name });
    setBusy(false);
    if (id) add(id);
  }

  return (
    <div className="flex flex-col gap-1.5">
      {value.length > 0 && (
        <div className="flex flex-col gap-1">
          {value.map((v) => {
            const p = api.index.person.get(v.personId);
            const firm = p?.firmId ? api.index.firm.get(p.firmId)?.name : '';
            return (
              <div key={v.personId} className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
                <div className="min-w-0 flex-1">
                  <span className="text-[12.5px] text-white">{p?.name ?? 'Someone removed'}</span>
                  {firm && <span className="ml-1.5 text-[11px] text-zinc-600">{firm}</span>}
                </div>
                <select
                  value={v.role}
                  onChange={(e) =>
                    onChange(value.map((x) => (x.personId === v.personId ? { ...x, role: e.target.value as EventRole } : x)))
                  }
                  className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-300 outline-none"
                >
                  {EVENT_ROLES.map((r) => <option key={r} value={r}>{EVENT_ROLE_LABEL[r]}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => onChange(value.filter((x) => x.personId !== v.personId))}
                  className="text-zinc-600 transition-colors hover:text-red-400"
                  aria-label="Remove"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="relative">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (matches.length) add(matches[0].id);
            else if (needle && !exact) void createAndAdd();
          }}
          placeholder="Type a name to add someone"
          className={inputCls}
        />
        {needle && (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-zinc-800 bg-[#161616] shadow-xl">
            {matches.map((p) => {
              const firm = p.firmId ? api.index.firm.get(p.firmId)?.name : '';
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => add(p.id)}
                  className="flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-zinc-800"
                >
                  <span className="text-[12.5px] text-white">{p.name}</span>
                  <span className="truncate text-[11px] text-zinc-600">{[p.title, firm].filter(Boolean).join(', ')}</span>
                </button>
              );
            })}
            {!exact && (
              <button
                type="button"
                onClick={() => void createAndAdd()}
                disabled={busy}
                className="flex w-full items-center gap-1.5 border-t border-zinc-800 px-2.5 py-1.5 text-left text-[12px] text-emerald-300 transition-colors hover:bg-zinc-800"
              >
                {busy ? 'Adding...' : `+ New person "${q.trim()}"`}
              </button>
            )}
            {exact && matches.length === 0 && (
              <p className="px-2.5 py-1.5 text-[11.5px] text-zinc-600">Already on this event.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function EventForm({
  api, initial, presetKind, presetPeople, presetFirmId, presetPlaceId, onClose, onSaved, onDeleted,
}: {
  api: UseAidenData;
  initial?: AidenEvent;
  presetKind?: EventKind;
  presetPeople?: string[];
  presetFirmId?: string | null;
  presetPlaceId?: string | null;
  onClose: () => void;
  onSaved?: (id: string) => void;
  onDeleted?: () => void;
}) {
  const [kind, setKind] = useState<EventKind>(initial?.kind ?? presetKind ?? 'email');
  const [date, setDate] = useState(initial ? toDateInput(initial.happenedAt) : todayInput());
  const [title, setTitle] = useState(initial?.title ?? '');
  const [summary, setSummary] = useState(initial?.summary ?? '');
  const [people, setPeople] = useState<AidenEventPerson[]>(
    initial?.people ?? (presetPeople ?? []).map((personId) => ({ personId, role: defaultRole(presetKind ?? 'email') })),
  );
  const [firmId, setFirmId] = useState<string | null>(initial?.firmId ?? presetFirmId ?? null);
  const [placeId, setPlaceId] = useState<string | null>(initial?.placeId ?? presetPlaceId ?? null);
  const [followUp, setFollowUp] = useState(toDateInput(initial?.followUpAt));
  const [followUpDone, setFollowUpDone] = useState(initial?.followUpDone ?? false);
  const [busy, setBusy] = useState(false);

  const canSave = Boolean(title.trim() || summary.trim()) && Boolean(date);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave || busy) return;
    setBusy(true);
    const body = {
      kind, title, summary, people, firmId, placeId,
      happenedAt: fromDateInput(date) ?? new Date().toISOString(),
      followUpAt: fromDateInput(followUp),
      followUpDone: followUp ? followUpDone : false,
    };
    if (initial) {
      const ok = await api.update('events', initial.id, body);
      setBusy(false);
      if (ok) { onSaved?.(initial.id); onClose(); }
    } else {
      const id = await api.create('events', body);
      setBusy(false);
      if (id) { onSaved?.(id); onClose(); }
    }
  }

  async function del() {
    if (!initial) return;
    if (!window.confirm('Delete this event? The people on it stay.')) return;
    setBusy(true);
    const ok = await api.remove('events', initial.id);
    setBusy(false);
    if (ok) { onDeleted?.(); onClose(); }
  }

  return (
    <Modal title={initial ? 'Edit event' : 'Log an event'} onClose={onClose} wide>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="What was it">
          <div className="flex flex-wrap gap-1.5">
            {EVENT_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className="rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors"
                style={
                  kind === k
                    ? { color: KIND_COLOR[k], borderColor: `${KIND_COLOR[k]}88`, backgroundColor: `${KIND_COLOR[k]}1a` }
                    : { color: '#71717a', borderColor: '#27272a' }
                }
              >
                {EVENT_KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-[1fr_150px] gap-3">
          <Field label="Title">
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={TITLE_HINT[kind]} className={inputCls} />
          </Field>
          <Field label="When">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputCls} [color-scheme:dark]`} />
          </Field>
        </div>
        <Field label="What was said" hint="Briefly">
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={4}
            placeholder="What you said, what they said, how it landed"
            className={textareaCls}
          />
        </Field>
        <Field label="People" hint={kind === 'event' ? 'The host and everyone you met' : 'Everyone this involved'}>
          <PeoplePicker api={api} value={people} onChange={setPeople} kind={kind} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Firm" hint="Optional">
            <RefSelect
              value={firmId}
              options={byName(api.data.firms)}
              onChange={setFirmId}
              onCreate={(n) => api.create('firms', { name: n, kind: 'vc', placeId })}
              none="No firm"
              noun="firm"
            />
          </Field>
          <Field label="Place" hint="Optional">
            <RefSelect
              value={placeId}
              options={byName(api.data.places)}
              onChange={setPlaceId}
              onCreate={(n) => api.create('places', { name: n })}
              none="No place"
              noun="place"
            />
          </Field>
        </div>
        <div className="grid grid-cols-[150px_1fr] items-end gap-3">
          <Field label="Follow up by" hint="Optional">
            <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} className={`${inputCls} [color-scheme:dark]`} />
          </Field>
          {followUp && (
            <label className="flex items-center gap-2 pb-2 text-[12px] text-zinc-400">
              <input
                type="checkbox"
                checked={followUpDone}
                onChange={(e) => setFollowUpDone(e.target.checked)}
                className="accent-emerald-500"
              />
              Followed up
            </label>
          )}
        </div>
        <Footer
          onClose={onClose}
          onDelete={initial ? del : undefined}
          busy={busy}
          canSave={canSave}
          saveLabel={initial ? 'Save' : 'Log event'}
        />
      </form>
    </Modal>
  );
}

// ── Link ──────────────────────────────────────────────────────────────────────
export function LinkForm({
  api, initial, fromId, onClose,
}: {
  api: UseAidenData;
  initial?: AidenLink;
  /** The person the tie is being made from. */
  fromId: string;
  onClose: () => void;
}) {
  const otherOf = (l: AidenLink) => (l.aId === fromId ? l.bId : l.aId);
  const [otherId, setOtherId] = useState<string>(initial ? otherOf(initial) : '');
  const [kind, setKind] = useState<LinkKind>(initial?.kind ?? 'friend');
  const [note, setNote] = useState(initial?.note ?? '');
  const [busy, setBusy] = useState(false);

  const from = api.index.person.get(fromId);
  const others = useMemo(
    () => byName(api.data.people.filter((p) => p.id !== fromId)),
    [api.data.people, fromId],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!otherId || busy) return;
    setBusy(true);
    const ok = initial
      ? await api.update('links', initial.id, { aId: fromId, bId: otherId, kind, note })
      : Boolean(await api.create('links', { aId: fromId, bId: otherId, kind, note }));
    setBusy(false);
    if (ok) onClose();
  }

  async function del() {
    if (!initial) return;
    setBusy(true);
    const ok = await api.remove('links', initial.id);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Modal title={`${initial ? 'Edit tie' : 'Connect'}: ${from?.name ?? ''}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Is">
            <select value={kind} onChange={(e) => setKind(e.target.value as LinkKind)} className={inputCls}>
              {LINK_KINDS.map((k) => <option key={k} value={k}>{LINK_KIND_LABEL[k]}</option>)}
            </select>
          </Field>
          <Field label="With">
            <select autoFocus value={otherId} onChange={(e) => setOtherId(e.target.value)} className={inputCls}>
              <option value="">Pick a person</option>
              {others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Note" hint="How you know">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="College roommates, co-invested in..." className={inputCls} />
        </Field>
        {others.length === 0 && (
          <p className="text-[11.5px] text-zinc-600">Add another person first, then connect them.</p>
        )}
        <Footer
          onClose={onClose}
          onDelete={initial ? del : undefined}
          busy={busy}
          canSave={Boolean(otherId)}
          saveLabel={initial ? 'Save' : 'Connect'}
        />
      </form>
    </Modal>
  );
}

// ── Round ─────────────────────────────────────────────────────────────────────
// A funding round and the firms in the log that were in it. Two firms on one
// round have a shared round. Investors that are not in the log are written
// down as text, so the firm list stays the firms he is actually working on.
const STAGES = ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C', 'Series D', 'Growth', 'Strategic'];

function FirmPicker({
  api, value, onChange,
}: {
  api: UseAidenData;
  value: AidenRoundFirm[];
  onChange: (next: AidenRoundFirm[]) => void;
}) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const picked = useMemo(() => new Set(value.map((v) => v.firmId)), [value]);

  const needle = q.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!needle) return [];
    return api.data.firms
      .filter((f) => !picked.has(f.id) && f.name.toLowerCase().includes(needle))
      .slice(0, 6);
  }, [api.data.firms, needle, picked]);
  const exact = api.data.firms.some((f) => f.name.toLowerCase() === needle);

  function add(firmId: string) {
    onChange([...value, { firmId, role: 'participant' }]);
    setQ('');
  }

  async function createAndAdd() {
    const name = q.trim();
    if (!name || busy) return;
    setBusy(true);
    const id = await api.create('firms', { name, kind: 'vc' });
    setBusy(false);
    if (id) add(id);
  }

  return (
    <div className="flex flex-col gap-1.5">
      {value.length > 0 && (
        <div className="flex flex-col gap-1">
          {value.map((v) => {
            const f = api.index.firm.get(v.firmId);
            return (
              <div key={v.firmId} className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
                <div className="min-w-0 flex-1 truncate text-[12.5px] text-white">{f?.name ?? 'A firm removed'}</div>
                <select
                  value={v.role}
                  onChange={(e) =>
                    onChange(value.map((x) => (x.firmId === v.firmId ? { ...x, role: e.target.value as RoundRole } : x)))
                  }
                  className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-300 outline-none"
                >
                  {ROUND_ROLES.map((r) => <option key={r} value={r}>{ROUND_ROLE_LABEL[r]}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => onChange(value.filter((x) => x.firmId !== v.firmId))}
                  className="text-zinc-600 transition-colors hover:text-red-400"
                  aria-label="Remove"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="relative">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (matches.length) add(matches[0].id);
            else if (needle && !exact) void createAndAdd();
          }}
          placeholder="Type a firm to add it"
          className={inputCls}
        />
        {needle && (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-zinc-800 bg-[#161616] shadow-xl">
            {matches.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => add(f.id)}
                className="flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-zinc-800"
              >
                <span className="text-[12.5px] text-white">{f.name}</span>
                <span className="truncate text-[11px] text-zinc-600">{FIRM_KIND_LABEL[f.kind]}</span>
              </button>
            ))}
            {!exact && (
              <button
                type="button"
                onClick={() => void createAndAdd()}
                disabled={busy}
                className="flex w-full items-center gap-1.5 border-t border-zinc-800 px-2.5 py-1.5 text-left text-[12px] text-emerald-300 transition-colors hover:bg-zinc-800"
              >
                {busy ? 'Adding...' : `+ New firm "${q.trim()}"`}
              </button>
            )}
            {exact && matches.length === 0 && (
              <p className="px-2.5 py-1.5 text-[11.5px] text-zinc-600">Already on this round.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function RoundForm({
  api, initial, presetFirmIds, presetCompany, onClose,
}: {
  api: UseAidenData;
  initial?: AidenRound;
  presetFirmIds?: string[];
  presetCompany?: string;
  onClose: () => void;
}) {
  const [company, setCompany] = useState(initial?.company ?? presetCompany ?? '');
  const [stage, setStage] = useState(initial?.stage ?? '');
  const [announced, setAnnounced] = useState(initial?.announced ?? '');
  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [firms, setFirms] = useState<AidenRoundFirm[]>(
    initial?.firms ?? (presetFirmIds ?? []).map((firmId) => ({ firmId, role: 'participant' as RoundRole })),
  );
  const [others, setOthers] = useState(initial?.others ?? '');
  const [source, setSource] = useState(initial?.source ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [busy, setBusy] = useState(false);

  const when = announced.trim();
  const whenOk = !when || ANNOUNCED_RE.test(when);
  const canSave = Boolean(company.trim()) && whenOk;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave || busy) return;
    setBusy(true);
    const body = { company, stage, announced: when, amount, firms, others, source, notes };
    const ok = initial
      ? await api.update('rounds', initial.id, body)
      : Boolean(await api.create('rounds', body));
    setBusy(false);
    if (ok) onClose();
  }

  async function del() {
    if (!initial) return;
    if (!window.confirm('Delete this round? The firms on it stay.')) return;
    setBusy(true);
    const ok = await api.remove('rounds', initial.id);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Modal title={initial ? 'Edit round' : 'Add a round'} onClose={onClose} wide>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-[1fr_170px] gap-3">
          <Field label="Company" hint="Who raised it">
            <input autoFocus value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Kalshi" className={inputCls} />
          </Field>
          <Field label="Stage">
            <input value={stage} onChange={(e) => setStage(e.target.value)} list="aiden-round-stages" placeholder="Seed, Series A..." className={inputCls} />
            <datalist id="aiden-round-stages">
              {STAGES.map((s) => <option key={s} value={s} />)}
            </datalist>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Announced" hint="Only as exact as you know it">
            <input value={announced} onChange={(e) => setAnnounced(e.target.value)} placeholder="2021, 2021-02 or 2021-02-17" className={inputCls} />
            {!whenOk && <span className="text-[11px] text-red-300">Write it as 2021, 2021-02 or 2021-02-17.</span>}
          </Field>
          <Field label="Amount">
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$30M" className={inputCls} />
          </Field>
        </div>
        <Field label="Firms in it" hint="The ones in your log; two on one round have a shared round">
          <FirmPicker api={api} value={firms} onChange={setFirms} />
        </Field>
        <Field label="Also in it" hint="Investors that are not in your log">
          <textarea value={others} onChange={(e) => setOthers(e.target.value)} rows={2} placeholder="Sequoia (lead), Charles Schwab..." className={textareaCls} />
        </Field>
        <Field label="Source" hint="Where this was read">
          <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="https://..." className={inputCls} />
        </Field>
        <Field label="Notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={textareaCls} />
        </Field>
        <Footer
          onClose={onClose}
          onDelete={initial ? del : undefined}
          busy={busy}
          canSave={canSave}
          saveLabel={initial ? 'Save' : 'Add round'}
        />
      </form>
    </Modal>
  );
}
