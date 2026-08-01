// Extend the corpus with more archive articles and a derived caption stress
// set.
//
// Why the stress set exists: the failure Russ reported came from a terse
// source that listed a component as already cooked. Real captions do this
// constantly, but sampling enough real captions that happen to contain the
// pattern is slow and noisy. Instead we take public-domain MyPlate recipes,
// where the full instructions are known, and degrade them the way a creator
// caption degrades a recipe: drop some quantities, collapse the method into a
// run-on, and phrase cooked staples as pre-cooked. Because the original
// structured data is retained as ground truth, we know exactly what the card
// should still teach.
//
// These items are labeled channel "caption" and must never be presented as
// real creator content.
//
// Usage: node scripts/corpus-extend.mts

import { readFileSync, writeFileSync } from "node:fs";

// MyPlate keeps ingredients and directions in Drupal list markup rather than
// in its JSON-LD, so parse them directly.
function parseMyPlate(html: string): { name: string; ingredients: string[]; instructions: string[] } | null {
  const name = html.match(/<script[^>]*application\/ld\+json[^>]*>[\s\S]*?"name"\s*:\s*"([^"]+)"/)?.[1];
  const listItems = (section: string): string[] => {
    const start = html.search(new RegExp(`field--name-field-${section}`, "i"));
    if (start < 0) return [];
    const chunk = html.slice(start, start + 12000);
    const ulEnd = chunk.search(/<\/ul>/i);
    const scope = ulEnd > 0 ? chunk.slice(0, ulEnd) : chunk;
    return [...scope.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
      .map((m) =>
        m[1]
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter((s) => s.length > 2 && s.length < 300);
  };
  const ingredients = listItems("ingredients");
  const instructions = listItems("directions").length ? listItems("directions") : listItems("instructions");
  if (!name || ingredients.length < 4 || instructions.length < 1) return null;
  return { name, ingredients, instructions };
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CorpusItem {
  id: string;
  channel: string;
  url?: string;
  text?: string;
  origin: string;
  groundTruth?: { ingredients: string[]; instructions: string[] };
  note?: string;
}

const corpusUrl = new URL("../eval/corpus-1000.json", import.meta.url);
const corpus = JSON.parse(readFileSync(corpusUrl, "utf8")) as { items: CorpusItem[]; counts: Record<string, number> };
const have = new Set(corpus.items.map((i) => i.url ?? ""));

// pull a CDX page for candidates we have not used yet, cached locally because
// the archive rate-limits this index
const cacheUrl = new URL("../eval/.cdx-cache.json", import.meta.url);
let rows: string[][] = [];
try {
  rows = JSON.parse(readFileSync(cacheUrl, "utf8")) as string[][];
  console.log(`cdx cache: ${rows.length} rows`);
} catch {
  for (let attempt = 1; attempt <= 4 && rows.length === 0; attempt += 1) {
    try {
      const cdx = await fetch(
        "https://web.archive.org/cdx/search/cdx?url=myplate.gov/recipes/*&output=json&collapse=urlkey&filter=statuscode:200&filter=mimetype:text/html&from=2023&to=2025&limit=1000",
        { headers: { "user-agent": UA }, signal: AbortSignal.timeout(90000) },
      );
      const body = await cdx.text();
      if (body.trimStart().startsWith("[")) {
        rows = JSON.parse(body) as string[][];
        writeFileSync(cacheUrl, JSON.stringify(rows));
      } else {
        console.log(`  cdx attempt ${attempt}: rate limited, backing off`);
        await sleep(attempt * 15000);
      }
    } catch {
      await sleep(attempt * 15000);
    }
  }
}
if (rows.length === 0) {
  console.log("cdx unavailable; cannot extend");
  process.exit(1);
}
const candidates = rows
  .slice(1)
  .map((r) => ({ ts: r[1], url: r[2] }))
  .filter((r) => /\/recipes\/[a-z0-9-]+$/.test(r.url))
  .map((r) => ({ ...r, snap: `https://web.archive.org/web/${r.ts}id_/${r.url}` }))
  .filter((r) => !have.has(r.snap));

for (let i = candidates.length - 1; i > 0; i -= 1) {
  const j = Math.floor(Math.random() * (i + 1));
  [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
}

const WANT_ARTICLES = 0;
const WANT_CAPTIONS = Number(process.argv[2] ?? 150);

let addedArticles = 0;
for (const c of candidates.slice(0, WANT_ARTICLES)) {
  corpus.items.push({
    id: `mp2-${corpus.items.length + 1}`,
    channel: "article",
    url: c.snap,
    origin: "myplate.gov (archive)",
  });
  addedArticles += 1;
}
console.log(`added ${addedArticles} archive articles`);

// ---- caption degradation ----------------------------------------------

/** Staples whose "cooked" form creators routinely list as an ingredient. */
const STAPLE_PRECOOK: [RegExp, string][] = [
  [/\b(white |brown |long.grain |instant )?rice\b/i, "cooked rice"],
  [/\bpasta|spaghetti|macaroni|noodles\b/i, "cooked pasta"],
  [/\bchicken breasts?|chicken thighs?|whole chicken\b/i, "shredded cooked chicken"],
  [/\bdried beans|dry beans\b/i, "cooked beans"],
  [/\bpotatoes\b/i, "cooked potatoes"],
  [/\blentils\b/i, "cooked lentils"],
  [/\bquinoa\b/i, "cooked quinoa"],
  [/\bbarley\b/i, "cooked barley"],
];

function stripQuantity(line: string): string {
  return line
    .replace(/^[\d\s./⁄¼½¾⅓⅔⅛-]+/, "")
    .replace(/^(cups?|tablespoons?|teaspoons?|tbsp|tsp|ounces?|oz|pounds?|lbs?|grams?|g|cans?|packages?)\s+/i, "")
    .trim();
}

function degrade(name: string, ingredients: string[], instructions: string[]): { text: string; precooked: string[] } {
  const precooked: string[] = [];
  const lines = ingredients.map((raw) => {
    let line = raw.trim();
    // creators drop quantities on maybe a third of lines
    if (Math.random() < 0.35) line = stripQuantity(line);
    // and phrase staples as already cooked, which is the failure we are hunting
    for (const [rx, replacement] of STAPLE_PRECOOK) {
      if (rx.test(line) && !/cooked|shredded/i.test(line) && Math.random() < 0.75) {
        const qty = line.match(/^[\d\s./⁄¼½¾⅓⅔-]*\s*(cups?|ounces?|oz|pounds?|lbs?)?/i)?.[0]?.trim() ?? "";
        line = `${qty} ${replacement}`.trim();
        precooked.push(replacement);
        break;
      }
    }
    return line;
  });

  // collapse the method into a run-on the way a caption does
  const method = instructions
    .map((s) => s.replace(/\s+/g, " ").trim())
    .join(" ")
    .replace(/\.\s+/g, ". ")
    .slice(0, 900);

  const text = `${name.toUpperCase()}\n\n${lines.join(", ")}\n\n${method}`;
  return { text, precooked };
}

let addedCaptions = 0;
for (const c of candidates.slice(WANT_ARTICLES)) {
  if (addedCaptions >= WANT_CAPTIONS) break;
  try {
    const res = await fetch(c.snap, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(25000) });
    if (!res.ok) continue;
    const r = parseMyPlate(await res.text());
    if (!r) continue;

    const { text, precooked } = degrade(r.name, r.ingredients, r.instructions);
    corpus.items.push({
      id: `cap-${corpus.items.length + 1}`,
      channel: "caption",
      text,
      origin: "derived from myplate.gov (public domain), degraded to caption form",
      groundTruth: { ingredients: r.ingredients, instructions: r.instructions },
      note: precooked.length ? `precooked phrasing injected: ${precooked.join(", ")}` : undefined,
    });
    addedCaptions += 1;
    if (addedCaptions % 25 === 0) console.log(`  captions: ${addedCaptions}`);
  } catch {
    // archive hiccup, move on
  }
  await sleep(250);
}
console.log(`added ${addedCaptions} caption stress items`);

const counts = corpus.items.reduce<Record<string, number>>((acc, i) => {
  acc[i.channel] = (acc[i.channel] ?? 0) + 1;
  return acc;
}, {});
writeFileSync(corpusUrl, JSON.stringify({ ...corpus, counts, items: corpus.items }, null, 2));
console.log(`corpus now ${corpus.items.length} items`, counts);
