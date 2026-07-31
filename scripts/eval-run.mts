// Golden-set runner: compile every wired corpus entry, write the results to
// eval/runs/<stamp>.json, and diff against the previous run. The corpus file
// itself is never edited by this script. Run with: node scripts/eval-run.mts

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { compile } from "../src/lib/pipeline/compile.ts";
import { layoutRecipe } from "../src/lib/recipe/layout.ts";

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2]) out[m[1]] = m[2].trim();
  }
  return out;
}

interface RunEntry {
  id: string;
  ok: boolean;
  dish?: string;
  rows?: number;
  cols?: number;
  ingredients?: number;
  steps?: number;
  attempts?: number;
  costUsd?: number;
  elapsedMs?: number;
  inferred?: boolean;
  error?: string;
}

const env = loadEnv();
const corpus = JSON.parse(readFileSync(new URL("../eval/corpus.json", import.meta.url), "utf8")) as {
  entries: { id: string; url: string }[];
};

const WIRED = /^(tt|yt|art)-/;
const results: RunEntry[] = [];

for (const entry of corpus.entries) {
  if (!WIRED.test(entry.id)) {
    results.push({ id: entry.id, ok: false, error: "skipped: path not wired (needs scraper vendor)" });
    continue;
  }
  process.stdout.write(`${entry.id} ... `);
  try {
    const { doc, meta } = await compile(entry.url, {
      deepseekKey: env.DEEPSEEK_API_KEY,
      geminiKey: env.GEMINI_API_KEY,
    });
    const layout = layoutRecipe(doc);
    results.push({
      id: entry.id,
      ok: true,
      dish: doc.dish,
      rows: layout.rows,
      cols: layout.columns,
      ingredients: doc.ingredients.length,
      steps: doc.steps.length,
      attempts: meta.attempts,
      costUsd: Number(meta.usage.costUsd.toFixed(4)),
      elapsedMs: meta.elapsedMs,
      inferred: doc.inferred ?? false,
    });
    console.log(`ok  ${doc.dish} (${layout.rows}x${layout.columns}, $${meta.usage.costUsd.toFixed(4)})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({ id: entry.id, ok: false, error: message });
    console.log(`FAIL ${message}`);
  }
}

const runsDir = new URL("../eval/runs/", import.meta.url);
mkdirSync(runsDir, { recursive: true });
const prior = readdirSync(runsDir).filter((f) => f.endsWith(".json")).sort();
const stampSource = process.argv[2] ?? String(Date.now());
const stamp = /^\d+$/.test(stampSource) ? new Date(Number(stampSource)).toISOString() : stampSource;
const fileName = `${stamp.replace(/[:.]/g, "-")}.json`;

const okCount = results.filter((r) => r.ok).length;
const totalCost = results.reduce((s, r) => s + (r.costUsd ?? 0), 0);
writeFileSync(new URL(fileName, runsDir), JSON.stringify({ stamp, results }, null, 2));
console.log(`\n${okCount}/${results.length} ok, total cost $${totalCost.toFixed(4)}, wrote eval/runs/${fileName}`);

if (prior.length > 0) {
  const prev = JSON.parse(readFileSync(new URL(prior[prior.length - 1], runsDir), "utf8")) as {
    results: RunEntry[];
  };
  const prevById = new Map(prev.results.map((r) => [r.id, r]));
  const regressions: string[] = [];
  for (const r of results) {
    const p = prevById.get(r.id);
    if (!p) continue;
    if (p.ok && !r.ok) regressions.push(`${r.id}: was ok, now fails (${r.error})`);
    if (p.ok && r.ok && p.dish !== r.dish) regressions.push(`${r.id}: dish changed "${p.dish}" -> "${r.dish}"`);
  }
  console.log(regressions.length === 0 ? `no regressions vs ${prior[prior.length - 1]}` : regressions.join("\n"));
  if (regressions.length > 0) process.exit(1);
}
