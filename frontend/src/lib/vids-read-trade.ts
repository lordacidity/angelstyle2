// Who a finished build trades on, and which way, read off what its screen
// recordings show — their context and moments, as written on Edit & file
// ("pauv.com looking up and trading up on ronaldo"). Both post-caption routes
// start here: Simpler's one caption (api/vids/post-caption) and Vids 2's pair
// (api/vids/post-captions). One quick call at the floor thinking level.

import { extractGeminiJson, geminiGenerate } from '@/lib/gemini';

const MODEL = 'gemini-3.5-flash-lite';

/** Who the recordings trade on and which way, or null where they don't say. */
export async function readTrade(brief: string): Promise<{ person: string | null; position: 'up' | 'down' | null }> {
  const prompt = `Below is what the screen recordings in a short video show, as written by the person who cut them. In the video he looks a person up online and then trades on that person on pauv.com: UP if he thinks they are getting more popular, DOWN if he thinks they are falling off. The second recording is always the pauv.com one, whether or not its notes say so.

Say WHO is being traded on and WHICH WAY.
- person: the person's name as they are commonly known ("Cristiano Ronaldo", "Drake"). A real, named person: the one looked up and traded on. Never the site, the app, or the person filming. If more than one is named, the one traded on wins. null if no one is named.
- position: "up" if the notes say he trades up, backs, buys or bets on them rising; "down" if he trades down, fades them, or bets on them falling; null if they don't say.

${brief}

Reply with ONLY a JSON object: {"person": "<name or null>", "position": "up" | "down" | null}. No prose, no code fence.`;
  const raw = await geminiGenerate([{ text: prompt }], {
    model: MODEL,
    thinkingLevel: 'minimal',
    temperature: 0.1,
    maxOutputTokens: 300,
    timeoutMs: 20_000,
  });
  const parsed = JSON.parse(extractGeminiJson(raw)) as { person?: unknown; position?: unknown };
  const person = typeof parsed.person === 'string' ? parsed.person.trim().slice(0, 120) : '';
  const position = parsed.position === 'up' || parsed.position === 'down' ? parsed.position : null;
  return { person: person && person.toLowerCase() !== 'null' ? person : null, position };
}
