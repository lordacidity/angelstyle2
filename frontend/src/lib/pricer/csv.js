// CSV helpers shared by the pricer pipeline (which reads the master list and, once, the two seed files) and the
// /api/pricer/log download. Carried verbatim from the standalone server.mjs.
import fs from "node:fs";

export function parseCsv(text) {
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
export const csvField = v => { const s = String(v ?? ""); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const csvLine = values => values.map(csvField).join(",") + "\n";

// Rows as objects keyed by the lower-cased header. A missing file is an empty list.
export function readCsv(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return []; }
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ""));
  if (!header) return [];
  const keys = header.map(h => h.trim().toLowerCase());
  return rows.filter(r => r.some(f => f.trim())).map(r => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
}
