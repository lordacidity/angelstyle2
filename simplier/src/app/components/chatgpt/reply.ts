// The ChatGPT lookalike's answer, as /api/ai/chatgpt returns it, and the two
// readings of it the section needs: inline runs (bold / italic / the pick's
// name) for rendering, and plain text for the clipboard and for sending the
// answer back as an earlier turn. Shared by the live chat (ChatGptSection) and
// the recording renderer (chatgpt-video), so both show the same thing.

export type Direction = 'up' | 'down';
export interface Pick { name: string; text: string }
export interface Reply { intro: string; picks: Pick[]; outro: string }

// The model may wrap titles in *asterisks*; nothing else is honoured.
export interface Run { text: string; em?: boolean; strong?: boolean; name?: boolean }
export function parseInline(text: string): Run[] {
  const runs: Run[] = [];
  const re = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    if (m[1]) runs.push({ text: m[1], strong: true });
    else runs.push({ text: m[2] ?? m[3], em: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs;
}

// The answer as blocks: the intro paragraph, one list item per pick, the outro
// paragraph. `start` / `len` are character offsets into the whole answer, which
// is what the streaming reveal counts.
export interface Block { kind: 'p' | 'li'; runs: Run[]; start: number; len: number }
export function buildBlocks(reply: Reply): Block[] {
  const blocks: Block[] = [];
  let pos = 0;
  const push = (kind: Block['kind'], runs: Run[]) => {
    const len = runs.reduce((n, r) => n + r.text.length, 0);
    blocks.push({ kind, runs, start: pos, len });
    pos += len;
  };
  if (reply.intro.trim()) push('p', parseInline(reply.intro.trim()));
  // The number and the name are separate runs so a click can highlight the
  // name alone.
  reply.picks.forEach((p, i) => push('li', [
    { text: `${i + 1}. `, strong: true },
    { text: p.name.trim(), strong: true, name: true },
    { text: ' — ' },
    ...parseInline(p.text.trim()),
  ]));
  if (reply.outro.trim()) push('p', parseInline(reply.outro.trim()));
  return blocks;
}
export const totalLen = (blocks: Block[]) => blocks.reduce((n, b) => n + b.len, 0);

/** One answer from /api/ai/chatgpt, for the chat so far (oldest first, ending
 *  with the user message to answer). */
export async function askChatGpt(
  name: string, direction: Direction, messages: { role: 'user' | 'assistant'; content: string }[], signal?: AbortSignal,
): Promise<Reply> {
  const r = await fetch('/api/ai/chatgpt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, direction, messages }),
    signal,
  });
  const j = await r.json().catch(() => ({})) as { error?: string } & Partial<Reply>;
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return { intro: j.intro ?? '', picks: j.picks ?? [], outro: j.outro ?? '' };
}

// Plain-text rendering: what Copy puts on the clipboard and what goes back to
// the route as an earlier assistant turn.
export function replyToText(reply: Reply): string {
  const lines: string[] = [];
  if (reply.intro.trim()) lines.push(reply.intro.trim(), '');
  reply.picks.forEach((p, i) => lines.push(`${i + 1}. ${p.name.trim()} — ${p.text.trim()}`));
  if (reply.outro.trim()) lines.push('', reply.outro.trim());
  return lines.join('\n').replace(/\*\*?([^*\n]+)\*\*?/g, '$1');
}
