import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const STORE_PATH = path.resolve(process.cwd(), "data", "store.json");

export const PLATFORMS = ["ig", "x", "youtube", "tiktok"] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface PhoneEntry {
  serial: string;
  name: string;
}

export interface Account {
  id: string;
  phoneSerial: string;
  platform: Platform;
  username: string;
  themeIds: string[];
}

// Legacy on-disk shape from the single-theme era. Read-only — used only during migration.
interface LegacyAccount extends Omit<Account, "themeIds"> {
  themeId?: string | null;
}

export interface Theme {
  id: string;
  name: string;
}

interface StoreShape {
  phones: PhoneEntry[];
  accounts: Account[];
  themes: Theme[];
}

const SEED_PHONES: PhoneEntry[] = [
  { serial: "34181JEHN13273", name: "Pibble" },
  { serial: "3A031JEHN08462", name: "Addy" },
  { serial: "3C071JEHN14770", name: "Uganda" },
  { serial: "35081JEHN13862", name: "Victoria" },
];

let state: StoreShape = { phones: [], accounts: [], themes: [] };

function load(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, "utf8")) as StoreShape;
    state = raw;
    state.phones ??= [];
    state.accounts ??= [];
    state.themes ??= [];
    // Migrate any pre-existing accounts from single-theme to themeIds[].
    let migrated = false;
    for (const a of state.accounts as unknown as LegacyAccount[]) {
      if (!Array.isArray((a as unknown as Account).themeIds)) {
        const single = a.themeId ?? null;
        (a as unknown as Account).themeIds = single ? [single] : [];
        migrated = true;
      }
      // Always strip the legacy field, even if themeIds was already set.
      if ("themeId" in a) {
        delete a.themeId;
        migrated = true;
      }
    }
    if (migrated) persist();
  } catch {
    state = { phones: [], accounts: [], themes: [] };
  }
}

function persist(): void {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2));
}

function seed(): void {
  let dirty = false;
  for (const d of SEED_PHONES) {
    if (!state.phones.find((p) => p.serial === d.serial)) {
      state.phones.push(d);
      dirty = true;
    }
  }
  if (dirty) persist();
}

load();
seed();

// ---- phones ----
export function listPhones(): PhoneEntry[] {
  return state.phones.slice();
}
export function getPhoneName(serial: string): string | undefined {
  return state.phones.find((p) => p.serial === serial)?.name;
}
export function setPhoneName(serial: string, name: string): PhoneEntry {
  const existing = state.phones.find((p) => p.serial === serial);
  if (existing) existing.name = name;
  else state.phones.push({ serial, name });
  persist();
  return { serial, name };
}

// ---- themes ----
export function listThemes(): Theme[] {
  return state.themes.slice();
}
export function createTheme(name: string): Theme {
  const t: Theme = { id: randomUUID(), name };
  state.themes.push(t);
  persist();
  return t;
}
export function updateTheme(id: string, name: string): Theme | null {
  const t = state.themes.find((x) => x.id === id);
  if (!t) return null;
  t.name = name;
  persist();
  return t;
}
export function deleteTheme(id: string): boolean {
  const before = state.themes.length;
  state.themes = state.themes.filter((t) => t.id !== id);
  // Remove this theme id from every account that had it.
  for (const a of state.accounts) {
    a.themeIds = a.themeIds.filter((tid) => tid !== id);
  }
  const changed = state.themes.length < before;
  if (changed) persist();
  return changed;
}

// ---- accounts ----
export function listAccounts(): Account[] {
  return state.accounts.slice();
}
export function createAccount(input: Omit<Account, "id">): Account {
  if (!PLATFORMS.includes(input.platform)) {
    throw new Error(`invalid platform: ${input.platform}`);
  }
  const themeIds = Array.isArray(input.themeIds) ? input.themeIds.filter((x): x is string => typeof x === "string") : [];
  const a: Account = { id: randomUUID(), ...input, themeIds };
  state.accounts.push(a);
  persist();
  return a;
}
export function updateAccount(id: string, patch: Partial<Omit<Account, "id">>): Account | null {
  const a = state.accounts.find((x) => x.id === id);
  if (!a) return null;
  if (patch.platform !== undefined && !PLATFORMS.includes(patch.platform)) {
    throw new Error(`invalid platform: ${patch.platform}`);
  }
  if (patch.themeIds !== undefined) {
    if (!Array.isArray(patch.themeIds)) throw new Error("themeIds must be an array");
    patch.themeIds = patch.themeIds.filter((x): x is string => typeof x === "string");
  }
  Object.assign(a, patch);
  persist();
  return a;
}
export function deleteAccount(id: string): boolean {
  const before = state.accounts.length;
  state.accounts = state.accounts.filter((a) => a.id !== id);
  const changed = state.accounts.length < before;
  if (changed) persist();
  return changed;
}

// Unique phone serials with at least one account in the given theme.
export function phonesForTheme(themeId: string): string[] {
  const set = new Set<string>();
  for (const a of state.accounts) {
    if (a.themeIds.includes(themeId)) set.add(a.phoneSerial);
  }
  return [...set];
}
