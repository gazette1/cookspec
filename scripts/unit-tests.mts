// Tool unit tests: no model in the loop, pure fixtures. Exit code 1 on any
// failure. Run with: node scripts/unit-tests.mts

import { canonicalizeUrl } from "../src/lib/recipe/canonical.ts";
import { layoutRecipe } from "../src/lib/recipe/layout.ts";
import { validateQuantity } from "../src/lib/recipe/validate.ts";
import { extractJsonLdRecipe } from "../src/lib/pipeline/article.ts";
import { brownies } from "../src/lib/recipe/fixtures/brownies.ts";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`ok    ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name}\n      expected ${e}\n      got      ${a}`);
  }
}

// canonicalizer
check(
  "tiktok short link flagged for resolution",
  canonicalizeUrl("https://www.tiktok.com/t/ZP8tcHNQo/"),
  { sourceType: "tiktok", canonicalUrl: "https://www.tiktok.com/t/ZP8tcHNQo", needsResolution: true },
);
check(
  "instagram igsh param stripped",
  canonicalizeUrl("https://www.instagram.com/reel/DaDh4o8PFvG/?igsh=MWZvb2VjcWgwdzV0MQ=="),
  { sourceType: "reel", canonicalUrl: "https://www.instagram.com/reel/DaDh4o8PFvG/", needsResolution: false },
);
check(
  "youtube shorts share param stripped",
  canonicalizeUrl("https://youtube.com/shorts/DY-zJUTHBW0?is=z4mDpZAaMI06hzRZ").canonicalUrl,
  "https://www.youtube.com/shorts/DY-zJUTHBW0",
);
check(
  "two shares of one reel dedupe to the same canonical URL",
  canonicalizeUrl("https://www.instagram.com/reel/DSvLer9kp1t/?igsh=aaa").canonicalUrl ===
    canonicalizeUrl("instagram.com/reels/DSvLer9kp1t").canonicalUrl,
  true,
);
check(
  "article tracking params stripped, path preserved",
  canonicalizeUrl("https://www.tamingtwins.com/marry-me-chicken/?utm_source=x&fbclid=123").canonicalUrl,
  "https://tamingtwins.com/marry-me-chicken",
);

// unit validator
const cocoa = validateQuantity("Hershey's cocoa powder", { text: "1/3 cup", amount: 1 / 3, unit: "cup", grams: 80 });
check("cocoa 80 g for 1/3 cup gets corrected", [cocoa.provenance, cocoa.grams], ["corrected", 27]);
const statedGrams = validateQuantity("chicken breast", { text: "650 g", amount: 650, unit: "g", grams: 650 });
check("gram-stated text not duplicated", statedGrams.display, "650 g");
const butter = validateQuantity("unsalted butter", { text: "4 oz", amount: 4, unit: "oz", grams: 115 });
check("4 oz butter at 115 g passes within tolerance", [butter.provenance, butter.grams], ["stated", 115]);
const guess = validateQuantity("ground beef", { text: "about 1 lb", amount: 1, unit: "lb", estimated: true });
check("estimated flag carries through", guess.provenance, "estimated");
const toTaste = validateQuantity("salt", { text: "to taste" });
check("no-amount quantity stays plain", [toTaste.display, toTaste.provenance], ["to taste", "stated"]);

// layout engine: full brownies geometry snapshot
const layout = layoutRecipe(brownies);
check("brownies grid dimensions", [layout.rows, layout.columns], [9, 6]);
check(
  "brownies cell geometry matches the exemplar",
  layout.cells.map((c) => `${c.kind === "step" ? c.refId : c.refId}:r${c.row}s${c.rowSpan}c${c.col}s${c.colSpan}`),
  [
    "butter:r0s1c0s1",
    "melt:r0s1c1s1",
    "mix-wet:r0s4c2s1",
    "mix-eggs:r0s5c3s1",
    "fold:r0s9c4s1",
    "bake:r0s9c5s1",
    "sugar:r1s1c0s2",
    "vanilla:r2s1c0s2",
    "espresso:r3s1c0s2",
    "eggs:r4s1c0s3",
    "flour:r5s1c0s4",
    "cocoa:r6s1c0s4",
    "soda:r7s1c0s4",
    "salt:r8s1c0s4",
  ],
);

// layout engine rejects a non-tree
check(
  "layout throws on double consumption",
  (() => {
    try {
      layoutRecipe({
        slug: "x",
        dish: "x",
        prepNotes: [],
        ingredients: [
          { id: "a", name: "a", quantity: { display: "1", provenance: "stated" } },
          { id: "b", name: "b", quantity: { display: "1", provenance: "stated" } },
        ],
        steps: [
          { id: "s1", label: "mix", inputs: ["a"] },
          { id: "s2", label: "mix", inputs: ["a", "b"] },
        ],
      });
      return "no error";
    } catch {
      return "threw";
    }
  })(),
  "threw",
);

// JSON-LD parser
const html = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Recipe","name":"Test Soup","author":{"name":"Cook"},"recipeIngredient":["1 cup water","1 tsp salt"],"recipeInstructions":[{"@type":"HowToStep","text":"Boil the water."},{"@type":"HowToStep","text":"Add salt."}],"recipeYield":"2 servings"}]}</script></head><body></body></html>`;
const parsed = extractJsonLdRecipe(html);
check(
  "json-ld recipe parsed from @graph",
  [parsed?.kind, parsed?.recipe?.name, parsed?.recipe?.recipeIngredient?.length, parsed?.recipe?.recipeInstructions?.length],
  ["jsonld", "Test Soup", 2, 2],
);

console.log(failures === 0 ? "\nall unit tests passed" : `\n${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
