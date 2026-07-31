// Run the image pipeline against a local file. Usage:
//   node scripts/compile-image.mts "C:\path\to\photo.jpg" "optional dish hint"

import { readFileSync } from "node:fs";
import { compileImage } from "../src/lib/pipeline/compile.ts";
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
const path = process.argv[2];
if (!path) throw new Error("pass an image path");
const dishHint = process.argv[3];

const bytes = readFileSync(path);
const mimeType = path.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";

const { doc, meta } = await compileImage(
  { base64: bytes.toString("base64"), mimeType, dishHint },
  { deepseekKey: env.DEEPSEEK_API_KEY, geminiKey: env.GEMINI_API_KEY },
);

console.log(`dish: ${doc.dish}${doc.inferred ? " (inferred)" : ""}`);
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
console.log(`\nlayout: ${layout.rows} rows x ${layout.columns} cols`);
console.log(
  `meta: ${meta.sourceType} model=${meta.model} attempts=${meta.attempts} cost=$${meta.usage.costUsd.toFixed(4)} elapsed=${(meta.elapsedMs / 1000).toFixed(1)}s`,
);
