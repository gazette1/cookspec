// Run the compile pipeline against a URL or eval corpus id from the command
// line, print the layout as ASCII, and log cost. Usage:
//   node scripts/compile-url.mts art-1
//   node scripts/compile-url.mts https://example.com/recipe

import { readFileSync } from "node:fs";
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

const env = loadEnv();
const arg = process.argv[2];
if (!arg) throw new Error("pass a URL, corpus id, or quoted recipe text");

let input = arg;
if (/^[a-z]+-\d+$/.test(arg)) {
  const corpus = JSON.parse(readFileSync(new URL("../eval/corpus.json", import.meta.url), "utf8")) as {
    entries: { id: string; url: string }[];
  };
  const entry = corpus.entries.find((e) => e.id === arg);
  if (!entry) throw new Error(`no corpus entry ${arg}`);
  input = entry.url;
}

const { doc, meta } = await compile(input, { deepseekKey: env.DEEPSEEK_API_KEY, geminiKey: env.GEMINI_API_KEY });

console.log(`dish: ${doc.dish}`);
for (const note of doc.prepNotes) console.log(`prep: ${note}`);
console.log("");
for (const ing of doc.ingredients) {
  const marker = ing.quantity.provenance !== "stated" ? ` [${ing.quantity.provenance}]` : "";
  console.log(`  ${ing.quantity.display} ${ing.name}${marker}`);
}
console.log("");
for (const step of doc.steps) {
  console.log(`  ${step.id}: ${step.label}  <- ${step.inputs.join(", ")}`);
}
const layout = layoutRecipe(doc);
console.log(`\nlayout: ${layout.rows} rows x ${layout.columns} cols, ${layout.cells.length} cells`);
console.log(
  `meta: ${meta.sourceType} model=${meta.model} attempts=${meta.attempts} tokens=${meta.usage.inputTokens}+${meta.usage.outputTokens} cost=$${meta.usage.costUsd.toFixed(4)} elapsed=${(meta.elapsedMs / 1000).toFixed(1)}s`,
);
