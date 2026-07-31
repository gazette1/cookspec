// Seed-pack importer: compile a list of recipe URLs into local RecipeDoc JSON
// under seed/recipes/, ready for one bulk insert once Supabase exists. Only
// feed this sources whose license permits republication (federal public
// domain, licensed, or owned). Usage:
//   node scripts/seed-import.mts            (reads seed/sources.json)
//   node scripts/seed-import.mts <url> ...  (ad-hoc URLs)

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { compile } from "../src/lib/pipeline/compile.ts";
import { canonicalizeUrl, canonicalUrlHash } from "../src/lib/recipe/canonical.ts";

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2]) out[m[1]] = m[2].trim();
  }
  return out;
}

interface SeedSource {
  /** URL to fetch, possibly an Internet Archive id_ snapshot */
  url: string;
  /** Original URL to attribute on the card when it differs from the fetch URL */
  attributionUrl?: string;
  /** Attributed creator, e.g. "USDA MyPlate Kitchen" */
  creator?: string;
  license: string;
}

const env = loadEnv();
const args = process.argv.slice(2);
let sources: SeedSource[];
if (args.length > 0) {
  sources = args.map((url) => ({ url, license: "unspecified, verify before publishing" }));
} else {
  sources = (
    JSON.parse(readFileSync(new URL("../seed/sources.json", import.meta.url), "utf8")) as { sources: SeedSource[] }
  ).sources;
}

const outDir = new URL("../seed/recipes/", import.meta.url);
mkdirSync(outDir, { recursive: true });
const existing = new Set(readdirSync(outDir));

let done = 0;
let skipped = 0;
let failed = 0;
let totalCost = 0;

for (const source of sources) {
  const shortName = source.url.replace(/^https?:\/\//, "").slice(0, 70);
  try {
    // skip before compiling: the filename suffix is the fetch-URL hash, which
    // is computable for free
    const fetchHash = await canonicalUrlHash(canonicalizeUrl(source.url).canonicalUrl);
    const already = [...existing].find((f) => f.endsWith(`-${fetchHash.slice(0, 8)}.json`));
    if (already) {
      skipped += 1;
      console.log(`skip  ${shortName} (already imported as ${already})`);
      continue;
    }
    const { doc, meta } = await compile(source.url, {
      deepseekKey: env.DEEPSEEK_API_KEY,
      geminiKey: env.GEMINI_API_KEY,
    });
    if (source.attributionUrl) {
      doc.source = {
        url: source.attributionUrl,
        platform: new URL(source.attributionUrl).hostname.replace(/^www\./, ""),
        creatorHandle: source.creator,
      };
    }
    const hash = meta.canonicalHash ?? "nohash";
    const fileName = `${doc.slug}-${hash.slice(0, 8)}.json`;
    if (existing.has(fileName)) {
      skipped += 1;
      console.log(`skip  ${shortName} (already imported)`);
      continue;
    }
    writeFileSync(
      new URL(fileName, outDir),
      JSON.stringify(
        {
          doc,
          seed: { fetchUrl: source.url, attributionUrl: source.attributionUrl ?? source.url, license: source.license },
          meta: {
            sourceType: meta.sourceType,
            canonicalUrl: meta.canonicalUrl,
            canonicalHash: meta.canonicalHash,
            model: meta.model,
            attempts: meta.attempts,
            costUsd: Number(meta.usage.costUsd.toFixed(4)),
          },
        },
        null,
        2,
      ),
    );
    existing.add(fileName);
    done += 1;
    totalCost += meta.usage.costUsd;
    console.log(`ok    ${shortName} -> ${fileName} ($${meta.usage.costUsd.toFixed(4)})`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${shortName}: ${err instanceof Error ? err.message : String(err)}`);
  }
  await new Promise((r) => setTimeout(r, 1200));
}

console.log(`\nimported ${done}, skipped ${skipped}, failed ${failed}, cost $${totalCost.toFixed(4)}`);
