// Re-score a completed run against the current deterministic grader, using
// the stored cards. No model calls, no network, no cost. Use this whenever a
// metric definition changes so old runs stay comparable with new ones.
//
// Usage: node scripts/eval-regrade.mts --tag baseline [--out baseline-v2]

import { readFileSync, writeFileSync } from "node:fs";
import { gradeCard } from "../src/lib/eval/grade.ts";
import type { RecipeDoc } from "../src/lib/recipe/types.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}

const tag = arg("tag", "baseline") as string;
const out = arg("out", tag) as string;

const rows = readFileSync(new URL(`../eval/scale/${tag}.jsonl`, import.meta.url), "utf8")
  .split(/\r?\n/)
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as { doc?: RecipeDoc; groundTruth?: string[]; grade?: unknown });

let regraded = 0;
let skipped = 0;
for (const row of rows) {
  if (row.doc) {
    row.grade = gradeCard(row.doc, row.groundTruth);
    regraded += 1;
  } else {
    skipped += 1;
  }
}

writeFileSync(
  new URL(`../eval/scale/${out}.jsonl`, import.meta.url),
  rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
);
console.log(`regraded ${regraded}, skipped ${skipped} (no stored card), wrote ${out}.jsonl`);
