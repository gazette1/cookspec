// Provider clients. Fetch-based so they run identically in Node dev and on
// Cloudflare Workers. Costs are approximate list prices kept for logging only.

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface LlmResult {
  content: string;
  usage: LlmUsage;
  model: string;
}

// Approximate per-million-token USD list prices, for cost logging only.
const DEEPSEEK_IN_PER_M = 0.27;
const DEEPSEEK_OUT_PER_M = 1.1;
const GEMINI_FLASH_IN_PER_M = 0.3;
const GEMINI_FLASH_OUT_PER_M = 2.5;

export async function deepseekJson(opts: {
  apiKey: string;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<LlmResult> {
  const model = "deepseek-chat";
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      response_format: { type: "json_object" },
      max_tokens: opts.maxTokens ?? 4000,
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`deepseek HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
    usage: { prompt_tokens: number; completion_tokens: number };
  };
  const inputTokens = data.usage.prompt_tokens;
  const outputTokens = data.usage.completion_tokens;
  return {
    content: data.choices[0].message.content,
    model,
    usage: {
      inputTokens,
      outputTokens,
      costUsd: (inputTokens * DEEPSEEK_IN_PER_M + outputTokens * DEEPSEEK_OUT_PER_M) / 1_000_000,
    },
  };
}

export interface GeminiPart {
  text?: string;
  fileData?: { fileUri: string; mimeType?: string };
  inlineData?: { mimeType: string; data: string };
}

export async function geminiGenerate(opts: {
  apiKey: string;
  model?: string;
  parts: GeminiPart[];
  jsonOutput?: boolean;
  maxTokens?: number;
}): Promise<LlmResult> {
  const model = opts.model ?? "gemini-flash-latest";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(opts.apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: opts.parts }],
        generationConfig: {
          maxOutputTokens: opts.maxTokens ?? 4000,
          temperature: 0.2,
          // extraction is validation-gated; deep internal thinking only adds latency
          thinkingConfig: { thinkingLevel: "low" },
          ...(opts.jsonOutput ? { responseMimeType: "application/json" } : {}),
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const content = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!content) throw new Error("gemini returned no text content");
  const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
  return {
    content,
    model,
    usage: {
      inputTokens,
      outputTokens,
      costUsd: (inputTokens * GEMINI_FLASH_IN_PER_M + outputTokens * GEMINI_FLASH_OUT_PER_M) / 1_000_000,
    },
  };
}
