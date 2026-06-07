import fs from 'node:fs';
import path from 'node:path';
import { STORAGE } from './paths.js';

// Hard daily ceiling on paid Kling generations — the only real backstop if the shared site
// password ever leaks. Counts calls per UTC day, persisted to STORAGE/spend.json so it
// survives restarts (within the same volume). Tune with MAX_DAILY_GENERATIONS:
//   unset  -> 50/day
//   0      -> generation disabled (handy for testing the cap)
const FILE = path.join(STORAGE, 'spend.json');
const MAX = Number(process.env.MAX_DAILY_GENERATIONS ?? 50);

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}
function current() {
  let s;
  try {
    s = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    s = null;
  }
  if (!s || s.date !== today()) return { date: today(), klingCalls: 0 };
  return s;
}
function save(s) {
  try {
    fs.writeFileSync(FILE, JSON.stringify(s));
  } catch {
    /* best-effort */
  }
}

export function canGenerate() {
  if (!Number.isFinite(MAX) || MAX <= 0) return false;
  return current().klingCalls < MAX;
}

export function recordGeneration() {
  const s = current();
  s.klingCalls += 1;
  save(s);
  return s.klingCalls;
}

export function spendStatus() {
  const s = current();
  return { used: s.klingCalls, max: MAX, remaining: Math.max(0, MAX - s.klingCalls) };
}
