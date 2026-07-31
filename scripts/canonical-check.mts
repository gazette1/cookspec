// Offline check: run the canonicalizer over the eval corpus and print what
// the dedupe layer would key on. Run with: node scripts/canonical-check.mts

import { readFileSync } from "node:fs";
import { canonicalizeUrl, canonicalUrlHash } from "../src/lib/recipe/canonical.ts";

interface CorpusEntry {
  id: string;
  url: string;
  notes: string;
}

const corpus = JSON.parse(readFileSync(new URL("../eval/corpus.json", import.meta.url), "utf8")) as {
  entries: CorpusEntry[];
};

for (const entry of corpus.entries) {
  const c = canonicalizeUrl(entry.url);
  const hash = await canonicalUrlHash(c.canonicalUrl);
  const resolve = c.needsResolution ? "resolve-later" : "final        ";
  console.log(`${entry.id.padEnd(6)} ${c.sourceType.padEnd(8)} ${resolve} ${hash.slice(0, 12)} ${c.canonicalUrl}`);
}
