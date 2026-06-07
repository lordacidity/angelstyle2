export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatOpts {
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export async function deepseekChat(messages: ChatMessage[], opts: ChatOpts = {}): Promise<string> {
  const key = process.env.DEEPSEEK_API_KEY ?? '';
  if (!key) throw new Error('DEEPSEEK_API_KEY not set');
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages,
      temperature: opts.temperature ?? 0.2,
      ...(opts.json && { response_format: { type: 'json_object' } }),
      ...(opts.maxTokens && { max_tokens: opts.maxTokens }),
    }),
  });
  if (!res.ok) throw new Error(`deepseek ${res.status}: ${await res.text()}`);
  const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? '';
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
