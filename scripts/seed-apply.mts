// Apply the local seed pack to the Supabase recipes table through the REST
// API, ignoring rows whose canonical_url_hash already exists. Reusable for
// bigger packs. Usage: node scripts/seed-apply.mts

import { readFileSync, readdirSync } from "node:fs";
import { canonicalizeUrl, canonicalUrlHash } from "../src/lib/recipe/canonical.ts";
import type { RecipeDoc } from "../src/lib/recipe/types.ts";

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2]) out[m[1]] = m[2].trim();
  }
  return out;
}

interface SeedFile {
  doc: RecipeDoc;
  seed: { fetchUrl: string; attributionUrl: string; license: string };
}

const env = loadEnv();
const base = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!base || !key) throw new Error("Supabase env missing");

const dir = new URL("../seed/recipes/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

const rows = [];
for (const file of files) {
  const { doc, seed } = JSON.parse(readFileSync(new URL(file, dir), "utf8")) as SeedFile;
  const canonical = canonicalizeUrl(seed.attributionUrl);
  rows.push({
    canonical_url_hash: await canonicalUrlHash(canonical.canonicalUrl),
    source_url: canonical.canonicalUrl,
    source_type: "article",
    source_platform: doc.source?.platform ?? "myplate.gov",
    creator_handle: doc.source?.creatorHandle ?? "USDA MyPlate Kitchen",
    slug: doc.slug,
    dish_name: doc.dish,
    recipe_json: { ...doc, seedLicense: seed.license },
    is_public: true,
    is_inferred: false,
  });
}

const res = await fetch(`${base}/rest/v1/recipes?on_conflict=canonical_url_hash`, {
  method: "POST",
  headers: {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    prefer: "resolution=ignore-duplicates,return=minimal",
  },
  body: JSON.stringify(rows),
});
if (!res.ok) throw new Error(`insert failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
console.log(`applied ${rows.length} seed recipes (duplicates ignored)`);

const count = await fetch(`${base}/rest/v1/recipes?select=id`, {
  method: "HEAD",
  headers: { apikey: key, authorization: `Bearer ${key}`, prefer: "count=exact" },
});
console.log(`recipes table now reports: ${count.headers.get("content-range")}`);
