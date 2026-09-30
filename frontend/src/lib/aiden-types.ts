// Aiden — a private networking log (Studio > Aiden).
//
// Everything that happens is an EVENT: an email sent, a LinkedIn message, a
// call, a coffee, a networking night. Events point at the PEOPLE they involved;
// people sit under FIRMS; people and firms sit in PLACES; people are tied to
// each other by LINKS (friend, mutual, colleague...). Goals and notes are the
// thinking that goes on around all of it.
//
// These are the shapes the client and the server both speak. Nothing in here
// imports pg, so a client component can import it freely.

export const EVENT_KINDS = [
  'email', 'linkedin', 'text', 'call', 'coffee', 'meeting', 'event', 'intro', 'referral', 'invested', 'other',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  email: 'Email',
  linkedin: 'LinkedIn',
  text: 'Text / DM',
  call: 'Call',
  coffee: 'Coffee / lunch',
  meeting: 'Meeting',
  event: 'Networking event',
  intro: 'Intro',
  referral: 'Referral ask',
  invested: 'Invested',
  other: 'Other',
};

/** What a person was to an event. */
export const EVENT_ROLES = ['contacted', 'met', 'host', 'referrer', 'introduced', 'investor', 'cc'] as const;
export type EventRole = (typeof EVENT_ROLES)[number];

export const EVENT_ROLE_LABEL: Record<EventRole, string> = {
  contacted: 'Reached out to',
  met: 'Met',
  host: 'Host',
  referrer: 'Referred by',
  introduced: 'Introduced to',
  investor: 'Invested',
  cc: 'Also on it',
};

export const FIRM_KINDS = ['vc', 'angel', 'company', 'accelerator', 'community', 'other'] as const;
export type FirmKind = (typeof FIRM_KINDS)[number];

export const FIRM_KIND_LABEL: Record<FirmKind, string> = {
  vc: 'VC',
  angel: 'Angel group',
  company: 'Company',
  accelerator: 'Accelerator',
  community: 'Community',
  other: 'Other',
};

export const WARMTHS = ['cold', 'warm', 'hot'] as const;
export type Warmth = (typeof WARMTHS)[number];

export const LINK_KINDS = [
  'friend', 'mutual', 'colleague', 'introduced', 'referred', 'partner', 'family', 'other',
] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const LINK_KIND_LABEL: Record<LinkKind, string> = {
  friend: 'Friends',
  mutual: 'Mutuals',
  colleague: 'Colleagues',
  introduced: 'Introduced',
  referred: 'Referred',
  partner: 'Partners',
  family: 'Family',
  other: 'Connected',
};

export const GOAL_STATUSES = ['active', 'done', 'parked'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** Where a place is on the map: '' not looked up yet, 'ok' found, 'missing' looked up and not found. */
export const GEO_STATUSES = ['', 'ok', 'missing'] as const;
export type GeoStatus = (typeof GEO_STATUSES)[number];

export interface AidenPlace {
  id: string;
  name: string;
  notes: string;
  lat: number | null;
  lng: number | null;
  /** What it was looked up as on the map, when the name alone was not enough. */
  geoQuery: string;
  /** What the map lookup said it found. */
  geoLabel: string;
  geoStatus: GeoStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AidenFirm {
  id: string;
  name: string;
  kind: FirmKind;
  website: string;
  placeId: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface AidenPerson {
  id: string;
  name: string;
  title: string;
  firmId: string | null;
  placeId: string | null;
  email: string;
  linkedin: string;
  twitter: string;
  tags: string[];
  warmth: Warmth;
  bio: string;
  createdAt: string;
  updatedAt: string;
}

export interface AidenEventPerson {
  personId: string;
  role: EventRole;
}

export interface AidenEvent {
  id: string;
  kind: EventKind;
  title: string;
  /** What was said, briefly. */
  summary: string;
  happenedAt: string;
  placeId: string | null;
  firmId: string | null;
  followUpAt: string | null;
  followUpDone: boolean;
  people: AidenEventPerson[];
  createdAt: string;
  updatedAt: string;
}

/** A tie between two people. Undirected: a and b are interchangeable. */
export interface AidenLink {
  id: string;
  aId: string;
  bId: string;
  kind: LinkKind;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface AidenGoal {
  id: string;
  title: string;
  body: string;
  status: GoalStatus;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AidenNote {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface AidenChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

/** The whole log in one read. It is one person's network, so it is small
 *  enough to hand over whole, and the spider view and the chat both want all
 *  of it anyway. */
export interface AidenSnapshot {
  places: AidenPlace[];
  firms: AidenFirm[];
  people: AidenPerson[];
  events: AidenEvent[];
  links: AidenLink[];
  goals: AidenGoal[];
  notes: AidenNote[];
}

/** One row an ingest wrote (POST /api/aiden/ingest). */
export interface AidenIngestedRow {
  id: string;
  label: string;
  /** false when it was already in the log and was updated in place. */
  created: boolean;
}

export const AIDEN_ENTITIES = ['places', 'firms', 'people', 'events', 'links', 'goals', 'notes'] as const;
export type AidenEntity = (typeof AIDEN_ENTITIES)[number];

export type AidenIngestResult = Record<AidenEntity, AidenIngestedRow[]>;

export function isAidenEntity(v: string): v is AidenEntity {
  return (AIDEN_ENTITIES as readonly string[]).includes(v);
}
