// Generate seed/sources.json from Internet Archive snapshots of the retired
// USDA MyPlate Kitchen (US government work, public domain under 17 USC 105).
// MyPlate.gov redirects everything to a stub since the RealFood.gov rebrand;
// the Archive holds the server-rendered originals with JSON-LD intact.
// Usage: node scripts/seed-sources-myplate.mts [count]

import { mkdirSync, writeFileSync } from "node:fs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36";
const LICENSE =
  "US government work (USDA MyPlate Kitchen), public domain under 17 USC 105; retrieved via Internet Archive";

const count = Number(process.argv[2] ?? 30);

const cdx = await fetch(
  "https://web.archive.org/cdx/search/cdx?url=myplate.gov/recipes/*&output=json&collapse=urlkey&filter=statuscode:200&filter=mimetype:text/html&from=2023&to=2025&limit=1000",
  { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60000) },
);
if (!cdx.ok) throw new Error(`cdx HTTP ${cdx.status}`);
const rows = (await cdx.json()) as string[][];

const candidates = rows
  .slice(1)
  .map((r) => ({ timestamp: r[1], original: r[2] }))
  .filter(
    (r) =>
      !/\?|#|\/print|categor|search|myplate-kitchen|\/recipes\/?$/.test(r.original) &&
      /\/recipes\/[a-z0-9-]+$/.test(r.original),
  );

// spread the pick across the whole alphabetical list for variety
const step = Math.max(1, Math.floor(candidates.length / count));
const picked = candidates.filter((_, i) => i % step === 0).slice(0, count);

const sources = picked.map((p) => ({
  url: `https://web.archive.org/web/${p.timestamp}id_/${p.original}`,
  attributionUrl: p.original,
  creator: "USDA MyPlate Kitchen",
  license: LICENSE,
}));

mkdirSync(new URL("../seed/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../seed/sources.json", import.meta.url),
  JSON.stringify({ description: "Public-domain seed pack sources. Only add sources whose license permits republication.", sources }, null, 2),
);
console.log(`wrote seed/sources.json with ${sources.length} of ${candidates.length} candidate recipes`);
