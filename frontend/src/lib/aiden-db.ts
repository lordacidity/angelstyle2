// Aiden's storage: Railway Postgres, the same data DB the Board lives in
// (DATABASE_PUBLIC_URL), in tables prefixed `aiden_` so they can't collide with
// anything already there. The schema creates itself on first use.
//
// Eight kinds of row are edited through one spec-driven path (SPECS below):
// each kind names its table and its editable columns, and a column names its
// type. A request body is read against that spec and nothing else, so a client
// can't smuggle in a column, and table names never come from the request.
//
// Server-only. Never import this from a client component: it would drag the DB
// connection string into the bundle. Client code imports lib/aiden-types.

import pg from 'pg';
import {
  EVENT_KINDS, EVENT_ROLES, FIRM_KINDS, GEO_STATUSES, GOAL_STATUSES, LINK_KINDS, ROUND_ROLES, WARMTHS,
  type AidenChatMessage, type AidenEntity, type AidenEvent, type AidenEventPerson,
  type AidenIngestResult, type AidenIngestedRow,
  type AidenFirm, type AidenGoal, type AidenLink, type AidenNote, type AidenPerson,
  type AidenPlace, type AidenRound, type AidenRoundFirm, type AidenSnapshot, type EventRole, type RoundRole,
} from '@/lib/aiden-types';
import { ANNOUNCED_RE } from '@/lib/aiden-rounds';

/** A request that can't be saved as asked. The routes answer these with 400. */
export class AidenInputError extends Error {}

/** Another batch is being written right now, and this one was not started.
 *  Nothing of it was saved. The ingest route answers these with 409. */
export class AidenBusyError extends Error {}

// ── Connection pool (singleton, hot-reload safe) ──────────────────────────────
const g = globalThis as unknown as {
  __aidenPool?: pg.Pool;
  __aidenSchema?: { version: number; ready: Promise<void> } | null;
};

function getPool(): pg.Pool {
  if (g.__aidenPool) return g.__aidenPool;
  const connectionString = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL ?? '';
  if (!connectionString) {
    throw new Error('DATABASE_PUBLIC_URL not set');
  }
  // A small pool: the snapshot runs its reads side by side, and this DB is
  // shared with the Board and the rest of the Studio.
  g.__aidenPool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 4 });
  return g.__aidenPool;
}

// ── Schema ────────────────────────────────────────────────────────────────────
const STAMPS = `
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`;

const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS aiden_places (
    id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name  TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    ${STAMPS}
  )`,
  `CREATE TABLE IF NOT EXISTS aiden_firms (
    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name     TEXT NOT NULL DEFAULT '',
    kind     TEXT NOT NULL DEFAULT 'vc',
    website  TEXT NOT NULL DEFAULT '',
    place_id UUID REFERENCES aiden_places(id) ON DELETE SET NULL,
    notes    TEXT NOT NULL DEFAULT '',
    ${STAMPS}
  )`,
  `CREATE TABLE IF NOT EXISTS aiden_people (
    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name     TEXT NOT NULL DEFAULT '',
    title    TEXT NOT NULL DEFAULT '',
    firm_id  UUID REFERENCES aiden_firms(id) ON DELETE SET NULL,
    place_id UUID REFERENCES aiden_places(id) ON DELETE SET NULL,
    email    TEXT NOT NULL DEFAULT '',
    linkedin TEXT NOT NULL DEFAULT '',
    twitter  TEXT NOT NULL DEFAULT '',
    tags     TEXT[] NOT NULL DEFAULT '{}',
    warmth   TEXT NOT NULL DEFAULT 'cold',
    bio      TEXT NOT NULL DEFAULT '',
    ${STAMPS}
  )`,
  `CREATE TABLE IF NOT EXISTS aiden_events (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind           TEXT NOT NULL DEFAULT 'other',
    title          TEXT NOT NULL DEFAULT '',
    summary        TEXT NOT NULL DEFAULT '',
    happened_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    place_id       UUID REFERENCES aiden_places(id) ON DELETE SET NULL,
    firm_id        UUID REFERENCES aiden_firms(id) ON DELETE SET NULL,
    follow_up_at   TIMESTAMPTZ,
    follow_up_done BOOLEAN NOT NULL DEFAULT false,
    ${STAMPS}
  )`,
  `CREATE INDEX IF NOT EXISTS aiden_events_happened_at_idx ON aiden_events (happened_at DESC)`,
  `CREATE TABLE IF NOT EXISTS aiden_event_people (
    event_id  UUID NOT NULL REFERENCES aiden_events(id) ON DELETE CASCADE,
    person_id UUID NOT NULL REFERENCES aiden_people(id) ON DELETE CASCADE,
    role      TEXT NOT NULL DEFAULT 'contacted',
    PRIMARY KEY (event_id, person_id)
  )`,
  `CREATE TABLE IF NOT EXISTS aiden_links (
    id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    a_id UUID NOT NULL REFERENCES aiden_people(id) ON DELETE CASCADE,
    b_id UUID NOT NULL REFERENCES aiden_people(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'friend',
    note TEXT NOT NULL DEFAULT '',
    ${STAMPS}
  )`,
  `CREATE TABLE IF NOT EXISTS aiden_goals (
    id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title  TEXT NOT NULL DEFAULT '',
    body   TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    due_at TIMESTAMPTZ,
    ${STAMPS}
  )`,
  `CREATE TABLE IF NOT EXISTS aiden_notes (
    id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL DEFAULT '',
    body  TEXT NOT NULL DEFAULT '',
    ${STAMPS}
  )`,
  `CREATE TABLE IF NOT EXISTS aiden_chat (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS aiden_chat_created_at_idx ON aiden_chat (created_at)`,
  // Where each place is, for the map (added 2026-09-29; the tables were already there).
  `ALTER TABLE aiden_places ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION`,
  `ALTER TABLE aiden_places ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION`,
  `ALTER TABLE aiden_places ADD COLUMN IF NOT EXISTS geo_query TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE aiden_places ADD COLUMN IF NOT EXISTS geo_label TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE aiden_places ADD COLUMN IF NOT EXISTS geo_status TEXT NOT NULL DEFAULT ''`,
  // Shared rounds (added 2026-10-01): a round some company raised, and the
  // firms in the log that were in it. `announced` is text on purpose: it holds
  // a year, a year and month, or a full day, and no more than is known.
  `CREATE TABLE IF NOT EXISTS aiden_rounds (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company   TEXT NOT NULL DEFAULT '',
    stage     TEXT NOT NULL DEFAULT '',
    announced TEXT NOT NULL DEFAULT '',
    amount    TEXT NOT NULL DEFAULT '',
    others    TEXT NOT NULL DEFAULT '',
    source    TEXT NOT NULL DEFAULT '',
    notes     TEXT NOT NULL DEFAULT '',
    ${STAMPS}
  )`,
  `CREATE TABLE IF NOT EXISTS aiden_round_firms (
    round_id UUID NOT NULL REFERENCES aiden_rounds(id) ON DELETE CASCADE,
    firm_id  UUID NOT NULL REFERENCES aiden_firms(id) ON DELETE CASCADE,
    role     TEXT NOT NULL DEFAULT 'participant',
    PRIMARY KEY (round_id, firm_id)
  )`,
  `CREATE INDEX IF NOT EXISTS aiden_round_firms_firm_idx ON aiden_round_firms (firm_id)`,
];

// One place per name, one firm per name, held by the database itself.
//
// On 2026-09-29 a first import was still being written when a second one
// arrived. Neither could see the other's unsaved rows, so each made its own
// "Austin" and its own "Sequoia": 12 places and 59 firms, twice. Looking before
// writing cannot prevent that, because two writers can both look and both find
// nothing. Only the database can refuse the second row, so it does.
//
// A name is read here as `nameKey` reads it below: case and spacing ignored.
// People are left out on purpose: two people can share a name.
const keySql = (col: string) => `lower(regexp_replace(btrim(${col}), '\\s+', ' ', 'g'))`;
const NAME_KEY_SQL = keySql('name');

const UNIQUE_NAMES: string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS aiden_places_name_key ON aiden_places ((${NAME_KEY_SQL}))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS aiden_firms_name_key ON aiden_firms ((${NAME_KEY_SQL}))`,
  // One round per company, stage and year, for the same reason: the same round
  // read off two sources must land once. The year is in it because a company
  // can raise twice with no stage given to either round.
  `CREATE UNIQUE INDEX IF NOT EXISTS aiden_rounds_company_stage_year_key
     ON aiden_rounds ((${keySql('company')}), (${keySql('stage')}), (left(announced, 4)))`,
];

const UNIQUE_VIOLATION = '23505';

// Raised whenever SCHEMA or UNIQUE_NAMES changes. The schema is set up once per
// process and remembered on globalThis, which a dev hot reload does not clear:
// without this a server already running would never pick the change up.
const SCHEMA_VERSION = 5;

function ensureSchema(): Promise<void> {
  if (g.__aidenSchema?.version === SCHEMA_VERSION) return g.__aidenSchema.ready;
  const ready = (async () => {
    const pool = getPool();
    // In order, one at a time: later tables reference earlier ones.
    for (const sql of SCHEMA) await pool.query(sql);
    for (const sql of UNIQUE_NAMES) {
      try {
        await pool.query(sql);
      } catch (e) {
        // Two rows already share a name, so the index can't be built over
        // them. The log still has to open: say so, and carry on without it.
        if ((e as { code?: string } | null)?.code !== UNIQUE_VIOLATION) throw e;
        console.warn('[aiden] names are doubled in the log; a unique index was not created:', sql);
      }
    }
  })().catch((e) => {
    // Reset so a passing Railway hiccup doesn't wedge the section for good.
    g.__aidenSchema = null;
    throw e;
  });
  g.__aidenSchema = { version: SCHEMA_VERSION, ready };
  return ready;
}

// ── The spec ──────────────────────────────────────────────────────────────────
// 'ref' is a nullable pointer at another row; 'ref!' one that must be there.
// 'when' is a nullable moment; 'when!' one that must be there. 'num' is a
// nullable number. 'day' is a date only as exact as it is known: a year, a year
// and month, or a full day, or '' for not known. A list of strings is an enum:
// the value has to be one of them.
type ColType = 'text' | 'ref' | 'ref!' | 'when' | 'when!' | 'bool' | 'tags' | 'num' | 'day' | readonly string[];

interface Col {
  key: string;
  col: string;
  type: ColType;
}

interface Spec {
  table: string;
  cols: Col[];
  order: string;
}

const SPECS: Record<AidenEntity, Spec> = {
  places: {
    table: 'aiden_places',
    order: 'lower(name) ASC',
    cols: [
      { key: 'name', col: 'name', type: 'text' },
      { key: 'notes', col: 'notes', type: 'text' },
      { key: 'lat', col: 'lat', type: 'num' },
      { key: 'lng', col: 'lng', type: 'num' },
      { key: 'geoQuery', col: 'geo_query', type: 'text' },
      { key: 'geoLabel', col: 'geo_label', type: 'text' },
      { key: 'geoStatus', col: 'geo_status', type: GEO_STATUSES },
    ],
  },
  firms: {
    table: 'aiden_firms',
    order: 'lower(name) ASC',
    cols: [
      { key: 'name', col: 'name', type: 'text' },
      { key: 'kind', col: 'kind', type: FIRM_KINDS },
      { key: 'website', col: 'website', type: 'text' },
      { key: 'placeId', col: 'place_id', type: 'ref' },
      { key: 'notes', col: 'notes', type: 'text' },
    ],
  },
  people: {
    table: 'aiden_people',
    order: 'lower(name) ASC',
    cols: [
      { key: 'name', col: 'name', type: 'text' },
      { key: 'title', col: 'title', type: 'text' },
      { key: 'firmId', col: 'firm_id', type: 'ref' },
      { key: 'placeId', col: 'place_id', type: 'ref' },
      { key: 'email', col: 'email', type: 'text' },
      { key: 'linkedin', col: 'linkedin', type: 'text' },
      { key: 'twitter', col: 'twitter', type: 'text' },
      { key: 'tags', col: 'tags', type: 'tags' },
      { key: 'warmth', col: 'warmth', type: WARMTHS },
      { key: 'bio', col: 'bio', type: 'text' },
    ],
  },
  events: {
    table: 'aiden_events',
    order: 'happened_at DESC, created_at DESC',
    cols: [
      { key: 'kind', col: 'kind', type: EVENT_KINDS },
      { key: 'title', col: 'title', type: 'text' },
      { key: 'summary', col: 'summary', type: 'text' },
      { key: 'happenedAt', col: 'happened_at', type: 'when!' },
      { key: 'placeId', col: 'place_id', type: 'ref' },
      { key: 'firmId', col: 'firm_id', type: 'ref' },
      { key: 'followUpAt', col: 'follow_up_at', type: 'when' },
      { key: 'followUpDone', col: 'follow_up_done', type: 'bool' },
    ],
  },
  links: {
    table: 'aiden_links',
    order: 'created_at ASC',
    cols: [
      { key: 'aId', col: 'a_id', type: 'ref!' },
      { key: 'bId', col: 'b_id', type: 'ref!' },
      { key: 'kind', col: 'kind', type: LINK_KINDS },
      { key: 'note', col: 'note', type: 'text' },
    ],
  },
  rounds: {
    table: 'aiden_rounds',
    // Newest first. '' (not known) sorts below every year.
    order: 'announced DESC, lower(company) ASC, lower(stage) ASC',
    cols: [
      { key: 'company', col: 'company', type: 'text' },
      { key: 'stage', col: 'stage', type: 'text' },
      { key: 'announced', col: 'announced', type: 'day' },
      { key: 'amount', col: 'amount', type: 'text' },
      { key: 'others', col: 'others', type: 'text' },
      { key: 'source', col: 'source', type: 'text' },
      { key: 'notes', col: 'notes', type: 'text' },
    ],
  },
  goals: {
    table: 'aiden_goals',
    order: 'created_at DESC',
    cols: [
      { key: 'title', col: 'title', type: 'text' },
      { key: 'body', col: 'body', type: 'text' },
      { key: 'status', col: 'status', type: GOAL_STATUSES },
      { key: 'dueAt', col: 'due_at', type: 'when' },
    ],
  },
  notes: {
    table: 'aiden_notes',
    order: 'updated_at DESC',
    cols: [
      { key: 'title', col: 'title', type: 'text' },
      { key: 'body', col: 'body', type: 'text' },
    ],
  },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_CAP = 20_000;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

function cleanTags(raw: unknown): string[] | null {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : null;
  if (!list) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const tag = item.trim().slice(0, 40);
    const k = tag.toLowerCase();
    if (!tag || seen.has(k)) continue;
    seen.add(k);
    out.push(tag);
    if (out.length >= 20) break;
  }
  return out;
}

function parseWhen(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const v = raw.trim();
  // A bare day ("2026-09-29") would parse as midnight UTC, which is the
  // evening before in every US timezone. Read it as midday in the US instead,
  // so the day that was written is the day that is shown.
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T18:00:00Z` : v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** One value off a request body, read as its column's type. `undefined` means
 *  the body didn't offer a usable value and the column is left alone. */
function readValue(type: ColType, raw: unknown): { value: unknown } | undefined {
  if (raw === undefined) return undefined;
  if (typeof type !== 'string') {
    return typeof raw === 'string' && type.includes(raw) ? { value: raw } : undefined;
  }
  switch (type) {
    case 'text':
      return typeof raw === 'string' ? { value: raw.trim().slice(0, TEXT_CAP) } : undefined;
    case 'ref':
      if (raw === null || raw === '') return { value: null };
      return isUuid(raw) ? { value: raw } : undefined;
    case 'ref!':
      return isUuid(raw) ? { value: raw } : undefined;
    case 'when': {
      if (raw === null || raw === '') return { value: null };
      const iso = parseWhen(raw);
      return iso ? { value: iso } : undefined;
    }
    case 'when!': {
      const iso = parseWhen(raw);
      return iso ? { value: iso } : undefined;
    }
    case 'bool':
      return typeof raw === 'boolean' ? { value: raw } : undefined;
    case 'num': {
      if (raw === null || raw === '') return { value: null };
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
      return Number.isFinite(n) ? { value: n } : undefined;
    }
    case 'tags': {
      const tags = cleanTags(raw);
      return tags ? { value: tags } : undefined;
    }
    case 'day': {
      if (raw === null) return { value: '' };
      if (typeof raw !== 'string') return undefined;
      const v = raw.trim();
      if (!v) return { value: '' };
      if (!ANNOUNCED_RE.test(v)) {
        throw new AidenInputError(`"${v.slice(0, 40)}" is not a date: write 2021, 2021-02 or 2021-02-17`);
      }
      return { value: v };
    }
  }
}

interface Picked {
  key: string;
  col: string;
  value: unknown;
}

function pick(entity: AidenEntity, body: unknown): Picked[] {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: Picked[] = [];
  for (const c of SPECS[entity].cols) {
    const v = readValue(c.type, b[c.key]);
    if (v) out.push({ key: c.key, col: c.col, value: v.value });
  }
  return out;
}

function pickPeople(body: unknown): AidenEventPerson[] | undefined {
  const raw = (body as Record<string, unknown> | null)?.people;
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: AidenEventPerson[] = [];
  for (const item of raw) {
    const p = (item ?? {}) as Record<string, unknown>;
    if (!isUuid(p.personId) || seen.has(p.personId)) continue;
    seen.add(p.personId);
    const role = (EVENT_ROLES as readonly string[]).includes(String(p.role))
      ? (p.role as EventRole)
      : 'contacted';
    out.push({ personId: p.personId, role });
  }
  return out;
}

function pickRoundFirms(body: unknown): AidenRoundFirm[] | undefined {
  const raw = (body as Record<string, unknown> | null)?.firms;
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: AidenRoundFirm[] = [];
  for (const item of raw) {
    const f = (item ?? {}) as Record<string, unknown>;
    if (!isUuid(f.firmId) || seen.has(f.firmId)) continue;
    seen.add(f.firmId);
    const role = (ROUND_ROLES as readonly string[]).includes(String(f.role))
      ? (f.role as RoundRole)
      : 'participant';
    out.push({ firmId: f.firmId, role });
  }
  return out;
}

// ── Rows out ──────────────────────────────────────────────────────────────────
type DbRow = Record<string, unknown>;

const iso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null;

function toRow(entity: AidenEntity, r: DbRow): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: r.id,
    createdAt: iso(r.created_at) ?? '',
    updatedAt: iso(r.updated_at) ?? '',
  };
  for (const c of SPECS[entity].cols) {
    const v = r[c.col];
    out[c.key] = c.type === 'when' || c.type === 'when!' ? iso(v) : v ?? null;
  }
  return out;
}

// ── Reads ─────────────────────────────────────────────────────────────────────
export async function readSnapshot(): Promise<AidenSnapshot> {
  await ensureSchema();
  const pool = getPool();
  const all = (entity: AidenEntity) =>
    pool
      .query<DbRow>(`SELECT * FROM ${SPECS[entity].table} ORDER BY ${SPECS[entity].order}`)
      .then((r) => r.rows.map((row) => toRow(entity, row)));

  const [places, firms, people, events, links, rounds, goals, notes, eventPeople, roundFirms] = await Promise.all([
    all('places'), all('firms'), all('people'), all('events'), all('links'), all('rounds'), all('goals'), all('notes'),
    pool.query<{ event_id: string; person_id: string; role: string }>(
      'SELECT event_id, person_id, role FROM aiden_event_people',
    ),
    // Leads first, then by name, so every reader lists a round's firms the same way.
    pool.query<{ round_id: string; firm_id: string; role: string }>(
      `SELECT rf.round_id, rf.firm_id, rf.role
       FROM aiden_round_firms rf JOIN aiden_firms f ON f.id = rf.firm_id
       ORDER BY (rf.role = 'lead') DESC, lower(f.name) ASC`,
    ),
  ]);

  const byEvent = new Map<string, AidenEventPerson[]>();
  for (const ep of eventPeople.rows) {
    const list = byEvent.get(ep.event_id) ?? [];
    list.push({ personId: ep.person_id, role: ep.role as EventRole });
    byEvent.set(ep.event_id, list);
  }

  const byRound = new Map<string, AidenRoundFirm[]>();
  for (const rf of roundFirms.rows) {
    const list = byRound.get(rf.round_id) ?? [];
    list.push({ firmId: rf.firm_id, role: rf.role as RoundRole });
    byRound.set(rf.round_id, list);
  }

  return {
    places: places as unknown as AidenPlace[],
    firms: firms as unknown as AidenFirm[],
    people: people as unknown as AidenPerson[],
    events: (events as unknown as AidenEvent[]).map((e) => ({ ...e, people: byEvent.get(e.id) ?? [] })),
    links: links as unknown as AidenLink[],
    rounds: (rounds as unknown as AidenRound[]).map((r) => ({ ...r, firms: byRound.get(r.id) ?? [] })),
    goals: goals as unknown as AidenGoal[],
    notes: notes as unknown as AidenNote[],
  };
}

/** One place, or null. For the map's lookup of where it is. */
export async function readPlace(id: string): Promise<AidenPlace | null> {
  await ensureSchema();
  const r = await getPool().query<DbRow>('SELECT * FROM aiden_places WHERE id = $1', [id]);
  return r.rows[0] ? (toRow('places', r.rows[0]) as unknown as AidenPlace) : null;
}

// ── Writes ────────────────────────────────────────────────────────────────────
const has = (fields: Picked[], key: string) =>
  fields.some((f) => f.key === key && f.value !== null && f.value !== '');

/** What a new row has to arrive with, per kind. */
function checkNew(entity: AidenEntity, fields: Picked[]): void {
  switch (entity) {
    case 'places':
    case 'firms':
    case 'people':
      if (!has(fields, 'name')) throw new AidenInputError('a name is required');
      return;
    case 'goals':
      if (!has(fields, 'title')) throw new AidenInputError('a title is required');
      return;
    case 'rounds':
      if (!has(fields, 'company')) throw new AidenInputError('a round needs the company that raised it');
      return;
    case 'notes':
      if (!has(fields, 'title') && !has(fields, 'body')) throw new AidenInputError('the note is empty');
      return;
    case 'events':
      if (!has(fields, 'title') && !has(fields, 'summary')) {
        throw new AidenInputError('say what happened: a title or a summary');
      }
      return;
    case 'links': {
      const a = fields.find((f) => f.key === 'aId')?.value;
      const b = fields.find((f) => f.key === 'bId')?.value;
      if (!a || !b) throw new AidenInputError('a link needs two people');
      if (a === b) throw new AidenInputError('a link needs two different people');
      return;
    }
  }
}

async function writeEventPeople(
  client: pg.PoolClient,
  eventId: string,
  people: AidenEventPerson[],
): Promise<void> {
  await client.query('DELETE FROM aiden_event_people WHERE event_id = $1', [eventId]);
  for (const p of people) {
    // A person deleted in another tab since the form opened just isn't linked.
    await client.query(
      `INSERT INTO aiden_event_people (event_id, person_id, role)
       SELECT $1::uuid, id, $3::text FROM aiden_people WHERE id = $2::uuid
       ON CONFLICT DO NOTHING`,
      [eventId, p.personId, p.role],
    );
  }
}

async function writeRoundFirms(
  client: pg.PoolClient,
  roundId: string,
  firms: AidenRoundFirm[],
): Promise<void> {
  await client.query('DELETE FROM aiden_round_firms WHERE round_id = $1', [roundId]);
  for (const f of firms) {
    // A firm deleted in another tab since the form opened just isn't on it.
    await client.query(
      `INSERT INTO aiden_round_firms (round_id, firm_id, role)
       SELECT $1::uuid, id, $3::text FROM aiden_firms WHERE id = $2::uuid
       ON CONFLICT DO NOTHING`,
      [roundId, f.firmId, f.role],
    );
  }
}

/** A pointer at a row that isn't there any more, or a name that is already
 *  taken, is a bad request and not a crash. */
function asInputError(e: unknown): unknown {
  const err = e as { code?: string; constraint?: string } | null;
  if (err?.code === '23503') {
    return new AidenInputError('that links to something that no longer exists');
  }
  if (err?.code === UNIQUE_VIOLATION) {
    if (err.constraint === 'aiden_places_name_key') {
      return new AidenInputError('there is already a place with that name');
    }
    if (err.constraint === 'aiden_firms_name_key') {
      return new AidenInputError('there is already a firm with that name');
    }
    if (err.constraint === 'aiden_rounds_company_stage_year_key') {
      return new AidenInputError('that round is already in the log: same company, same stage, same year');
    }
  }
  return e;
}

/** Adds one row, inside whatever transaction the client is in. */
async function insertWith(
  client: pg.PoolClient,
  entity: AidenEntity,
  fields: Picked[],
  people?: AidenEventPerson[],
  roundFirms?: AidenRoundFirm[],
): Promise<string> {
  checkNew(entity, fields);
  const r = await client.query<{ id: string }>(
    `INSERT INTO ${SPECS[entity].table} (${fields.map((f) => f.col).join(', ')})
     VALUES (${fields.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING id`,
    fields.map((f) => f.value),
  );
  const id = r.rows[0].id;
  if (people) await writeEventPeople(client, id, people);
  if (roundFirms) await writeRoundFirms(client, id, roundFirms);
  return id;
}

/** Edits one row, inside whatever transaction the client is in. */
async function patchWith(
  client: pg.PoolClient,
  entity: AidenEntity,
  id: string,
  fields: Picked[],
  people?: AidenEventPerson[],
  roundFirms?: AidenRoundFirm[],
): Promise<boolean> {
  const { table } = SPECS[entity];
  if (fields.some((f) => f.key === 'name' && f.value === '')) {
    throw new AidenInputError('a name is required');
  }
  if (entity === 'rounds' && fields.some((f) => f.key === 'company' && f.value === '')) {
    throw new AidenInputError('a round needs the company that raised it');
  }
  const sets = ['updated_at = now()', ...fields.map((f, i) => `${f.col} = $${i + 1}`)];
  const r = await client.query(
    `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${fields.length + 1}`,
    [...fields.map((f) => f.value), id],
  );
  const found = (r.rowCount ?? 0) > 0;
  if (found && entity === 'links') {
    const same = await client.query(`SELECT 1 FROM ${table} WHERE id = $1 AND a_id = b_id`, [id]);
    if ((same.rowCount ?? 0) > 0) throw new AidenInputError('a link needs two different people');
  }
  if (found && people) await writeEventPeople(client, id, people);
  if (found && roundFirms) await writeRoundFirms(client, id, roundFirms);
  return found;
}

/** Runs the work in one transaction: all of it lands, or none of it does. */
async function inTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await work(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw asInputError(e);
  } finally {
    client.release();
  }
}

export async function createRow(entity: AidenEntity, body: unknown): Promise<{ id: string }> {
  const fields = pick(entity, body);
  const people = entity === 'events' ? pickPeople(body) : undefined;
  const roundFirms = entity === 'rounds' ? pickRoundFirms(body) : undefined;
  return inTransaction(async (client) => ({ id: await insertWith(client, entity, fields, people, roundFirms) }));
}

export async function updateRow(entity: AidenEntity, id: string, body: unknown): Promise<boolean> {
  const fields = pick(entity, body);
  const people = entity === 'events' ? pickPeople(body) : undefined;
  const roundFirms = entity === 'rounds' ? pickRoundFirms(body) : undefined;
  return inTransaction((client) => patchWith(client, entity, id, fields, people, roundFirms));
}

export async function deleteRow(entity: AidenEntity, id: string): Promise<boolean> {
  await ensureSchema();
  const r = await getPool().query(`DELETE FROM ${SPECS[entity].table} WHERE id = $1`, [id]);
  return (r.rowCount ?? 0) > 0;
}

// ── Ingest: the log, written by name ──────────────────────────────────────────
// The page knows ids; anything writing from outside it (Parvis, a script) knows
// names. "Emailed Jane Doe at Sequoia, in SF" should be one request, whether or
// not Jane, Sequoia or SF were in the log a moment ago.
//
// So a batch names things, and each name is found or made:
//   - a place, firm or person is matched by name (case and spacing ignored);
//     matched, the fields sent are written over it; unmatched, it is created
//   - `place` and `firm` on anything, and `people` on an event, are names too
//   - an event sent twice (same kind, same words, same day) lands once
//   - a tie is matched on its two people and its kind; a goal on its title
//   - a round is matched on its company, its stage and the year it was
//     announced; its `firms` are names too, and sent on a round already there
//     they replace who was in it
//   - anything may carry an `id` instead, to say exactly which row is meant
// All of it in one transaction: a batch lands whole or not at all.

export type IngestedRow = AidenIngestedRow;
export type IngestResult = AidenIngestResult;

type Bag = Record<string, unknown>;
type Named = 'places' | 'firms' | 'people';

const isBag = (v: unknown): v is Bag => v !== null && typeof v === 'object' && !Array.isArray(v);
const bags = (v: unknown): Bag[] => (Array.isArray(v) ? v.filter(isBag) : isBag(v) ? [v] : []);
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const nameKey = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, ' ');

/** What someone most likely was to an event of this kind. */
function likelyRole(kind: unknown): EventRole {
  if (kind === 'event' || kind === 'meeting' || kind === 'call' || kind === 'coffee') return 'met';
  if (kind === 'intro') return 'introduced';
  if (kind === 'invested') return 'investor';
  return 'contacted';
}

function record(list: IngestedRow[], row: IngestedRow): void {
  // Made earlier in this same batch and touched again: it is still new.
  if (!list.some((r) => r.id === row.id)) list.push(row);
}

// One batch at a time. A batch finds its names by looking, and a second batch
// looking while the first is still unsaved finds nothing and makes them again
// (that is how the people of a batch could be doubled; places and firms are
// now refused by the database as well). So a batch holds this lock from start
// to save, and the next one does not begin until it can have it.
//
// It waits a short while and then gives up, out loud, with nothing written:
// whoever sent it knows exactly where they stand, which a request left hanging
// for minutes behind a long import would not tell them.
// Any fixed number: it only has to be the same for every batch.
const INGEST_LOCK = 41_492_026;
const INGEST_LOCK_WAIT_MS = 20_000;

async function takeIngestLock(client: pg.PoolClient): Promise<void> {
  const until = Date.now() + INGEST_LOCK_WAIT_MS;
  for (;;) {
    const r = await client.query<{ ok: boolean }>(
      'SELECT pg_try_advisory_xact_lock($1::bigint) AS ok',
      [INGEST_LOCK],
    );
    if (r.rows[0]?.ok) return;
    if (Date.now() >= until) {
      throw new AidenBusyError(
        'another batch is still being written to the log, so this one was not started and nothing in it was saved. '
        + 'Wait for that one to finish, read the log, then send only what is missing.',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}

export async function ingest(body: unknown): Promise<IngestResult> {
  const b = isBag(body) ? body : {};
  const result: IngestResult = {
    places: [], firms: [], people: [], events: [], links: [], rounds: [], goals: [], notes: [],
  };

  return inTransaction(async (client) => {
    // Before the first look at what is there: what the batch ahead of this one
    // saved has to be in it.
    await takeIngestLock(client);

    const known: Record<Named, Map<string, string>> = {
      places: new Map(), firms: new Map(), people: new Map(),
    };
    for (const kind of ['places', 'firms', 'people'] as const) {
      const r = await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM ${SPECS[kind].table} ORDER BY created_at ASC`,
      );
      // Two rows under one name: the older one answers to it.
      for (const row of r.rows) {
        const k = nameKey(row.name);
        if (!known[kind].has(k)) known[kind].set(k, row.id);
      }
    }

    const resolve = async (kind: Named, name: string): Promise<string> => {
      const found = known[kind].get(nameKey(name));
      if (found) return found;
      const id = await insertWith(client, kind, pick(kind, { name }));
      known[kind].set(nameKey(name), id);
      result[kind].push({ id, label: name, created: true });
      return id;
    };

    /** `place` and `firm`, given as names, become the ids the columns hold. */
    const withRefs = async (raw: Bag): Promise<Bag> => {
      const out: Bag = { ...raw };
      const place = text(raw.place);
      const firm = text(raw.firm);
      if (place) out.placeId = await resolve('places', place);
      if (firm) out.firmId = await resolve('firms', firm);
      return out;
    };

    const upsertNamed = async (kind: Named, raw: Bag): Promise<void> => {
      const name = text(raw.name);
      const fields = pick(kind, await withRefs(raw));
      const target = isUuid(raw.id) ? raw.id : name ? known[kind].get(nameKey(name)) : undefined;
      if (target) {
        if (!(await patchWith(client, kind, target, fields))) {
          throw new AidenInputError(`nothing in ${kind} has the id ${target}`);
        }
        if (name) known[kind].set(nameKey(name), target);
        record(result[kind], { id: target, label: name || target, created: false });
        return;
      }
      if (!name) throw new AidenInputError(`every entry in "${kind}" needs a name`);
      const id = await insertWith(client, kind, fields);
      known[kind].set(nameKey(name), id);
      result[kind].push({ id, label: name, created: true });
    };

    // In this order, so that what a row points at is there before the row is.
    for (const raw of bags(b.places)) await upsertNamed('places', raw);
    for (const raw of bags(b.firms)) await upsertNamed('firms', raw);
    for (const raw of bags(b.people)) await upsertNamed('people', raw);

    for (const raw of bags(b.links)) {
      const aName = text(raw.a);
      const bName = text(raw.b);
      const aId = isUuid(raw.aId) ? raw.aId : aName ? await resolve('people', aName) : '';
      const bId = isUuid(raw.bId) ? raw.bId : bName ? await resolve('people', bName) : '';
      if (!aId || !bId) throw new AidenInputError('every tie needs two people: "a" and "b"');
      const fields = pick('links', { ...raw, aId, bId });
      const kind = fields.find((f) => f.key === 'kind')?.value ?? 'friend';
      const label = `${aName || aId} / ${bName || bId}`;
      const target = isUuid(raw.id)
        ? raw.id
        : (await client.query<{ id: string }>(
            `SELECT id FROM aiden_links
             WHERE kind = $3 AND ((a_id = $1 AND b_id = $2) OR (a_id = $2 AND b_id = $1))
             ORDER BY created_at ASC LIMIT 1`,
            [aId, bId, kind],
          )).rows[0]?.id;
      if (target) {
        if (!(await patchWith(client, 'links', target, fields))) {
          throw new AidenInputError(`no tie has the id ${target}`);
        }
        record(result.links, { id: target, label, created: false });
      } else {
        const id = await insertWith(client, 'links', fields);
        result.links.push({ id, label, created: true });
      }
    }

    for (const raw of bags(b.events)) {
      const fields = pick('events', await withRefs(raw));
      const kind = fields.find((f) => f.key === 'kind')?.value ?? 'other';
      const title = String(fields.find((f) => f.key === 'title')?.value ?? '');
      const summary = String(fields.find((f) => f.key === 'summary')?.value ?? '');

      // Left out, the people on an event being edited are left as they are.
      let people: AidenEventPerson[] | undefined;
      if (Array.isArray(raw.people)) {
        people = [];
        const seen = new Set<string>();
        for (const item of raw.people) {
          const p: Bag = typeof item === 'string' ? { name: item } : isBag(item) ? item : {};
          const name = text(p.name);
          const personId = isUuid(p.personId) ? p.personId
            : isUuid(p.id) ? p.id
            : name ? await resolve('people', name)
            : '';
          if (!personId || seen.has(personId)) continue;
          seen.add(personId);
          const role = (EVENT_ROLES as readonly string[]).includes(String(p.role))
            ? (p.role as EventRole)
            : likelyRole(kind);
          people.push({ personId, role });
        }
      }

      let target = isUuid(raw.id) ? raw.id : undefined;
      if (!target && raw.allowDuplicate !== true) {
        const when = fields.find((f) => f.key === 'happenedAt')?.value ?? new Date().toISOString();
        target = (await client.query<{ id: string }>(
          `SELECT id FROM aiden_events
           WHERE kind = $1 AND lower(title) = lower($2) AND lower(summary) = lower($3)
             AND happened_at::date = ($4::timestamptz)::date
           ORDER BY created_at ASC LIMIT 1`,
          [kind, title, summary, when],
        )).rows[0]?.id;
      }

      const label = title || summary.slice(0, 60) || String(kind);
      if (target) {
        if (!(await patchWith(client, 'events', target, fields, people))) {
          throw new AidenInputError(`no event has the id ${target}`);
        }
        record(result.events, { id: target, label, created: false });
      } else {
        const id = await insertWith(client, 'events', fields, people);
        result.events.push({ id, label, created: true });
      }
    }

    for (const raw of bags(b.rounds)) {
      const fields = pick('rounds', raw);
      const company = text(raw.company);
      const stage = text(raw.stage);

      // Left out, the firms on a round being edited are left as they are.
      let firms: AidenRoundFirm[] | undefined;
      if (Array.isArray(raw.firms)) {
        firms = [];
        const seen = new Set<string>();
        for (const item of raw.firms) {
          const f: Bag = typeof item === 'string' ? { name: item } : isBag(item) ? item : {};
          const name = text(f.name);
          const firmId = isUuid(f.firmId) ? f.firmId
            : isUuid(f.id) ? f.id
            : name ? await resolve('firms', name)
            : '';
          if (!firmId || seen.has(firmId)) continue;
          seen.add(firmId);
          const role = (ROUND_ROLES as readonly string[]).includes(String(f.role))
            ? (f.role as RoundRole)
            : 'participant';
          firms.push({ firmId, role });
        }
      }

      // The same company and stage, and then the year. A round sent with a year
      // is the one in the log with that year, or the one whose year was not
      // known till now. Sent with no year, it is the only one there is.
      let target = isUuid(raw.id) ? raw.id : undefined;
      if (!target && company) {
        const same = (await client.query<{ id: string; year: string }>(
          `SELECT id, left(announced, 4) AS year FROM aiden_rounds
           WHERE ${keySql('company')} = $1 AND ${keySql('stage')} = $2
           ORDER BY created_at ASC`,
          [nameKey(company), nameKey(stage)],
        )).rows;
        const year = String(fields.find((f) => f.key === 'announced')?.value ?? '').slice(0, 4);
        if (year) {
          target = (same.find((r) => r.year === year) ?? same.find((r) => !r.year))?.id;
        } else if (same.length > 1) {
          throw new AidenInputError(
            `${same.length} rounds in the log are "${[company, stage].filter(Boolean).join(' ')}": say which year, or give its id`,
          );
        } else {
          target = same[0]?.id;
        }
      }
      const label = [company, stage].filter(Boolean).join(' ') || String(target ?? '');
      if (target) {
        if (!(await patchWith(client, 'rounds', target, fields, undefined, firms))) {
          throw new AidenInputError(`no round has the id ${target}`);
        }
        record(result.rounds, { id: target, label, created: false });
      } else {
        if (!company) throw new AidenInputError('every round needs the company that raised it');
        const id = await insertWith(client, 'rounds', fields, undefined, firms);
        result.rounds.push({ id, label, created: true });
      }
    }

    for (const raw of bags(b.goals)) {
      const fields = pick('goals', raw);
      const title = text(raw.title);
      const target = isUuid(raw.id)
        ? raw.id
        : title
          ? (await client.query<{ id: string }>(
              'SELECT id FROM aiden_goals WHERE lower(title) = lower($1) ORDER BY created_at ASC LIMIT 1',
              [title],
            )).rows[0]?.id
          : undefined;
      if (target) {
        if (!(await patchWith(client, 'goals', target, fields))) {
          throw new AidenInputError(`no goal has the id ${target}`);
        }
        record(result.goals, { id: target, label: title || target, created: false });
      } else {
        const id = await insertWith(client, 'goals', fields);
        result.goals.push({ id, label: title, created: true });
      }
    }

    for (const raw of bags(b.notes)) {
      const fields = pick('notes', raw);
      const title = text(raw.title);
      const bodyText = text(raw.body);
      const label = title || bodyText.slice(0, 60);
      const target = isUuid(raw.id)
        ? raw.id
        : (await client.query<{ id: string }>(
            'SELECT id FROM aiden_notes WHERE title = $1 AND body = $2 LIMIT 1',
            [title.slice(0, TEXT_CAP), bodyText.slice(0, TEXT_CAP)],
          )).rows[0]?.id;
      if (target) {
        if (!(await patchWith(client, 'notes', target, fields))) {
          throw new AidenInputError(`no note has the id ${target}`);
        }
        record(result.notes, { id: target, label, created: false });
      } else {
        const id = await insertWith(client, 'notes', fields);
        result.notes.push({ id, label, created: true });
      }
    }

    return result;
  });
}

// ── The chat ──────────────────────────────────────────────────────────────────
// One running thread. Kept so a conversation can be picked up again, and so
// what was suggested last week is still on the page this week.
const CHAT_CAP = 200;

interface ChatDbRow {
  id: string;
  role: string;
  content: string;
  created_at: Date;
}

const toChat = (r: ChatDbRow): AidenChatMessage => ({
  id: r.id,
  role: r.role === 'assistant' ? 'assistant' : 'user',
  content: r.content,
  createdAt: r.created_at.toISOString(),
});

/** The latest messages, oldest first. */
export async function listChat(limit = CHAT_CAP): Promise<AidenChatMessage[]> {
  await ensureSchema();
  const r = await getPool().query<ChatDbRow>(
    'SELECT id, role, content, created_at FROM aiden_chat ORDER BY created_at DESC LIMIT $1',
    [Math.max(1, Math.min(limit, CHAT_CAP))],
  );
  return r.rows.reverse().map(toChat);
}

export async function addChat(role: 'user' | 'assistant', content: string): Promise<AidenChatMessage> {
  await ensureSchema();
  const r = await getPool().query<ChatDbRow>(
    'INSERT INTO aiden_chat (role, content) VALUES ($1, $2) RETURNING id, role, content, created_at',
    [role, content],
  );
  return toChat(r.rows[0]);
}

export async function clearChat(): Promise<void> {
  await ensureSchema();
  await getPool().query('DELETE FROM aiden_chat');
}
