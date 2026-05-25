// DeepSeek chat-completions wrapper. OpenAI-compatible API at
// https://api.deepseek.com/v1/chat/completions. Used for: extracting the main
// person from a news article, picking person-centric stories out of a batch,
// and writing the "how this ties to Pauv" tie-in sentence.

// Read env lazily — this module can be statically imported before dotenv.config()
// runs, in which case capturing process.env at module load yields an empty key.
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOpts {
  json?: boolean;
  temperature?: number;
  model?: string;
}

interface DeepSeekResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

export async function chat(messages: ChatMessage[], opts: ChatOpts = {}): Promise<string> {
  const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY ?? "";
  if (!DEEPSEEK_KEY) throw new Error("DEEPSEEK_API_KEY not set");
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_KEY}`,
    },
    body: JSON.stringify({
      model: opts.model ?? "deepseek-chat",
      messages,
      temperature: opts.temperature ?? 0.2,
      ...(opts.json && { response_format: { type: "json_object" } }),
    }),
  });
  if (!res.ok) throw new Error(`deepseek ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as DeepSeekResponse;
  return json.choices?.[0]?.message?.content ?? "";
}

// Parse a JSON-mode response. DeepSeek occasionally wraps JSON in ```json fences
// even when JSON mode is on; strip those before parsing.
export function parseJson<T>(text: string): T {
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(stripped) as T;
}
