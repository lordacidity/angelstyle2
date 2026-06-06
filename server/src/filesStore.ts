import fs from "node:fs";
import path from "node:path";

const FILES_PATH = path.resolve(process.cwd(), "data", "files.json");

export interface SentEvent {
  at: number;
  themeIds?: string[];
  serials: string[];
  okCount: number;
  errCount: number;
}

// "backlog" is a parking-lot shelf — file stays on disk but is hidden from
// the Incoming list. User can expand the Backlog section to send/save/delete
// later. Sending a backlog file flips it to "saved" via recordSent (same flow
// as sending an incoming file).
export type FileStatus = "new" | "saved" | "backlog";
export type DiskState = "present" | "deleted";

export interface FileRecord {
  name: string;
  size: number;
  receivedAt: number;
  status: FileStatus;
  diskState: DiskState;
  sentEvents: SentEvent[];
}

let records: Record<string, FileRecord> = {};

function load(): void {
  try {
    records = JSON.parse(fs.readFileSync(FILES_PATH, "utf8"));
  } catch {
    records = {};
  }
}

function persist(): void {
  fs.mkdirSync(path.dirname(FILES_PATH), { recursive: true });
  fs.writeFileSync(FILES_PATH, JSON.stringify(records, null, 2));
}

load();

type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify(): void {
  for (const fn of listeners) fn();
}

export function getAll(): FileRecord[] {
  return Object.values(records).sort((a, b) => b.receivedAt - a.receivedAt);
}

export function get(name: string): FileRecord | undefined {
  return records[name];
}

// Watcher reports a file is present on disk (newly added or returned).
export function onFilePresent(name: string, size: number): FileRecord {
  const existing = records[name];
  if (!existing) {
    records[name] = {
      name,
      size,
      receivedAt: Date.now(),
      status: "new",
      diskState: "present",
      sentEvents: [],
    };
  } else {
    existing.diskState = "present";
    existing.size = size;
  }
  persist();
  notify();
  return records[name];
}

// Watcher reports a file is no longer on disk.
export function onFileMissing(name: string): void {
  if (records[name]) {
    records[name].diskState = "deleted";
    persist();
    notify();
  }
}

export function markSaved(name: string): FileRecord | null {
  if (!records[name]) return null;
  records[name].status = "saved";
  persist();
  notify();
  return records[name];
}

export function markBacklog(name: string): FileRecord | null {
  if (!records[name]) return null;
  records[name].status = "backlog";
  persist();
  notify();
  return records[name];
}

// Bulk-mark every "new" record as "saved" in one shot. Used by the
// /api/files/clear-incoming endpoint to clean out the Incoming list when the
// user has already distributed everything (e.g. via the legacy app) but the
// records never flipped status because they weren't pushed through /api/push.
// Returns the count of records that were flipped.
export function markAllNewAsSaved(): number {
  let count = 0;
  for (const rec of Object.values(records)) {
    if (rec.status === "new") {
      rec.status = "saved";
      count++;
    }
  }
  if (count > 0) {
    persist();
    notify();
  }
  return count;
}

export function recordSent(name: string, event: SentEvent): FileRecord | null {
  if (!records[name]) return null;
  records[name].sentEvents.push(event);
  records[name].status = "saved"; // sending always saves
  persist();
  notify();
  return records[name];
}

// Fully delete from history (and assume the disk file is already gone).
export function deleteRecord(name: string): boolean {
  if (!records[name]) return false;
  delete records[name];
  persist();
  notify();
  return true;
}
