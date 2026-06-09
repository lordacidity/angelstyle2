// Ticker generator for the Pricer tool. Takes a batch of names and asks DeepSeek
// to coin a short stock-style "ticker" for each one: one word, 6–10 letters,
// built from the last name plus a few letters (or something clever and clearly
// tied to the person). Tickers must be UNIQUE within the batch — the model is
// told, and we also de-dupe server-side as a safety net so the client never gets
// two identical symbols.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { deepseekChat, parseJson } from '@/lib/deepseek';

export const runtime = 'nodejs';

// Present a ticker as a single word with a capitalized first letter — the form the
// examples use: "Therock", "Chalamet", "Tcruise", "Elordi". Letters only, capped at
// 10. We deliberately DON'T pad short handles with filler: an iconic 5-letter name
// beats a mangled 6-letter one. Only if the model returned junk (<3 letters) do we
// fall back to the person's last name, which is the most recognizable thing we have.
function sanitize(raw: string, lastName: string): string {
  let t = (raw || '').replace(/[^A-Za-z]/g, '');
  if (t.length < 3) t = (lastName || '').replace(/[^A-Za-z]/g, '');
  if (!t) return '';
  if (t.length > 10) t = t.slice(0, 10);
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

// Guarantee uniqueness across the batch (case-insensitive) by appending a trailing
// lowercase letter, keeping within 10 chars. Collisions are rare — two different
// famous people seldom map to the same iconic handle — so this is just a safety net.
function makeUnique(t: string, used: Set<string>): string {
  const has = (s: string) => used.has(s.toLowerCase());
  const take = (s: string) => { used.add(s.toLowerCase()); return s; };
  if (!has(t)) return take(t);
  const base = t.length >= 10 ? t.slice(0, 9) : t;
  for (let i = 0; i < 26; i++) {
    const cand = (base + String.fromCharCode(97 + i)).slice(0, 10);
    if (!has(cand)) return take(cand);
  }
  return take((t.slice(0, 8) + 'xx').slice(0, 10));
}

export async function POST(req: NextRequest) {
  try {
    const Schema = z.object({ names: z.array(z.string()).min(1).max(200) });
    const parsed = Schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

    // Keep the original index so the response lines up 1:1 with the request even
    // if a name is blank.
    const names = parsed.data.names.map((n) => n.trim());
    const indexed = names.map((name, i) => ({ i, name })).filter((x) => x.name.length > 0);

    if (indexed.length === 0) {
      return NextResponse.json({ tickers: names.map((name) => ({ name, ticker: '' })) });
    }

    const sys =
      'You create ICONIC, instantly-recognizable one-word handles for famous people (actors, athletes, artists, ' +
      'public figures). The single most important rule: looking at the handle ALONE, anyone who knows the person ' +
      'should immediately know exactly who it is. Favor fame and recognizability over any formula.\n\n' +
      'Choose each handle using this priority order:\n' +
      '1. If the person has a famous nickname or stage identity, USE IT. ' +
      '(Dwayne Johnson -> "Therock", Drake -> "Drizzy", Conor McGregor -> "Notorious".)\n' +
      '2. Else if their LAST NAME alone instantly identifies them, use JUST the last name. ' +
      '(Timothee Chalamet -> "Chalamet", Jacob Elordi -> "Elordi", Zendaya -> "Zendaya".)\n' +
      '3. Else use first INITIAL + last name. (Tom Cruise -> "Tcruise", LeBron James -> "Ljames".)\n' +
      '4. Only if none of those are recognizable, make the cleverest recognizable play on their name you can.\n\n' +
      'Formatting rules for every handle:\n' +
      '- One single word, letters A-Z only (no spaces, digits, or punctuation).\n' +
      '- Aim for 6 to 10 letters, but NEVER add filler letters just to hit a length — a clean iconic handle ' +
      'like "Drake" or "Adele" is better than a padded one. Recognizability beats length.\n' +
      '- Capitalize the first letter, rest lowercase (like the examples above).\n' +
      '- All handles in the batch MUST be unique.\n\n' +
      'Return ONLY JSON of the form: { "tickers": [ { "name": string, "ticker": string }, ... ] } ' +
      'in the SAME ORDER as the input names.';

    const user = JSON.stringify({ names: indexed.map((x) => x.name) });

    const raw = await deepseekChat(
      [{ role: 'system', content: sys }, { role: 'user', content: user }],
      { json: true, temperature: 0.5 },
    );

    const out = parseJson<{ tickers?: Array<{ name?: string; ticker?: string }> }>(raw);
    const aiList = Array.isArray(out.tickers) ? out.tickers : [];

    // Map the model's answers back onto our indexed names positionally; sanitize +
    // de-dupe so the client always gets clean, unique symbols.
    const used = new Set<string>();
    const result: { name: string; ticker: string }[] = names.map((name) => ({ name, ticker: '' }));
    indexed.forEach((entry, pos) => {
      const aiTicker = aiList[pos]?.ticker ?? '';
      const clean = makeUnique(sanitize(aiTicker, entry.name.split(/\s+/).pop() || entry.name), used);
      result[entry.i] = { name: entry.name, ticker: clean };
    });

    return NextResponse.json({ tickers: result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
