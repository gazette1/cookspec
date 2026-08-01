// Regression gate for the raw-start defect Russ reported on 2026-07-31: a
// terse source that names a component as already cooked must still produce a
// card that teaches how to make it. Exits nonzero on failure so this can gate
// a prompt change.
//
// Usage: node scripts/regress-rawstart.mts

import { readFileSync } from "node:fs";
import { compile } from "../src/lib/pipeline/compile.ts";
import { gradeCard } from "../src/lib/eval/grade.ts";

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2]) out[m[1]] = m[2].trim();
  }
  return out;
}
const env = loadEnv();

interface Entry {
  id: string;
  text?: string;
  url?: string;
  notes?: string;
  expect?: { operationMatches: string; onIngredient: string };
}

const corpus = JSON.parse(readFileSync(new URL("../eval/corpus.json", import.meta.url), "utf8")) as {
  entries: Entry[];
};
const cases = corpus.entries.filter((e) => e.id.startsWith("raw-") && e.expect);

let failures = 0;
for (const c of cases) {
  const { doc } = await compile((c.text ?? c.url) as string, {
    deepseekKey: env.DEEPSEEK_API_KEY,
    geminiKey: env.GEMINI_API_KEY,
    apifyToken: env.SCRAPER_API_TOKEN,
  });
  const grade = gradeCard(doc);
  const want = new RegExp(c.expect?.operationMatches ?? "", "i");
  const target = (c.expect?.onIngredient ?? "").toLowerCase();

  // the named component must exist raw and be transformed by an operation
  const ing = doc.ingredients.find((i) => i.name.toLowerCase().includes(target));
  const taught = doc.steps.some((s) => want.test(s.label));
  const stillAssumed = grade.rawStartHard.some((r) => r.toLowerCase().includes(target));

  const pass = Boolean(ing) && taught && !stillAssumed;
  if (!pass) failures += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${c.id}  ${doc.dish}`);
  console.log(`      ${target} present: ${Boolean(ing)}${ing ? ` as "${ing.name}"` : ""}`);
  console.log(`      operation matching /${c.expect?.operationMatches}/: ${taught}`);
  console.log(`      still assumed pre-prepared: ${stillAssumed}${stillAssumed ? ` (${grade.rawStartHard.join("; ")})` : ""}`);
  console.log(`      operations: ${doc.steps.map((s) => s.label).join(" | ")}`);
}

console.log(failures === 0 ? `\nall ${cases.length} raw-start regressions pass` : `\n${failures} of ${cases.length} failing`);
process.exit(failures === 0 ? 0 : 1);
