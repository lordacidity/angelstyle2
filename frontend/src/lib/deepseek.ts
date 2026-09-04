export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatOpts {
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

// The v4 reasoning models are slower and can occasionally stall; without a bound a
// single hung request would hold a whole route open indefinitely. 45s is a generous
// ceiling for even long generations — callers that want to fail faster pass timeoutMs.
const DEEPSEEK_TIMEOUT_MS = 45_000;

export async function deepseekChat(messages: ChatMessage[], opts: ChatOpts = {}): Promise<string> {
  const key = process.env.DEEPSEEK_API_KEY ?? '';
  if (!key) throw new Error('DEEPSEEK_API_KEY not set');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEEPSEEK_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
      body: JSON.stringify({
        // deepseek-chat was retired — the API now only accepts deepseek-v4-pro /
        // deepseek-v4-flash (both reasoning models). Default to flash (fast/cheap);
        // set DEEPSEEK_MODEL to override (e.g. deepseek-v4-pro for higher quality).
        model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
        messages,
        temperature: opts.temperature ?? 0.2,
        ...(opts.json && { response_format: { type: 'json_object' } }),
        ...(opts.maxTokens && { max_tokens: opts.maxTokens }),
      }),
    });
    if (!res.ok) throw new Error(`deepseek ${res.status}: ${await res.text()}`);
    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content ?? '';
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error('deepseek request timed out');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function parseJson<T>(text: string): T {
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(stripped) as T;
  } catch {
    // DeepSeek sometimes truncates mid-array. Try to salvage by cutting back to the
    // last complete object (last `}` before the closing `]`) and closing the structure.
    const lastBrace = stripped.lastIndexOf('}');
    if (lastBrace !== -1) {
      const arrayStart = stripped.indexOf('[');
      const objStart   = stripped.indexOf('{');
      if (arrayStart !== -1 && arrayStart < objStart) {
        // Looks like { "key": [ ... } — close the array and outer object
        const salvaged = stripped.slice(0, lastBrace + 1) + ']}';
        try { return JSON.parse(salvaged) as T; } catch { /* fall through */ }
      }
    }
    throw new SyntaxError(`Failed to parse DeepSeek response: ${stripped.slice(0, 120)}`);
  }
}
