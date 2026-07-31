// One minimal call per provider to prove the keys work before the pipeline
// depends on them. Run with: node scripts/validate-keys.mts

import { readFileSync } from "node:fs";

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2]) out[m[1]] = m[2].trim();
  }
  return out;
}

const env = loadEnv();

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    const detail = await fn();
    console.log(`OK   ${name.padEnd(10)} ${detail}`);
  } catch (err) {
    console.log(`FAIL ${name.padEnd(10)} ${err instanceof Error ? err.message : String(err)}`);
  }
}

await check("deepseek", async () => {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
      max_tokens: 4,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[]; usage: { total_tokens: number } };
  return `reply="${data.choices[0].message.content.trim()}" tokens=${data.usage.total_tokens}`;
});

await check("kimi", async () => {
  const res = await fetch("https://api.moonshot.ai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.MOONSHOT_API_KEY}` },
    body: JSON.stringify({
      model: "kimi-k3",
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
      max_tokens: 4,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return `reply="${data.choices[0].message.content.trim()}"`;
});

await check("gemini", async () => {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = (await res.json()) as { models?: { name: string }[] };
  return `models visible=${data.models?.length ?? 0}`;
});
