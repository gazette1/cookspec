// Deterministic card grading. No model in the loop, so this is cheap enough
// to run on every item and stable enough to diff between runs.
//
// The dimensions come from two places: the guardrails in design.md Part 1
// section 7, and the failure Russ hit on 2026-07-31, where a terse source
// listed "2 cups cooked sticky rice" and the card inherited that assumption
// instead of teaching the cook to cook rice.

import { layoutRecipe } from "../recipe/layout.ts";
import type { RecipeDoc } from "../recipe/types.ts";

/** Preparations that are real cooking. A card that assumes these were already
 *  done is not a recipe, it is an assembly note. */
const HARD_PREP = [
  "cooked",
  "boiled",
  "steamed",
  "roasted",
  "baked",
  "fried",
  "grilled",
  "braised",
  "poached",
  "seared",
  "toasted",
  "caramelized",
  "sauteed",
  "sautéed",
  "blanched",
  "rotisserie",
  "leftover",
  "prepared",
  "pre-cooked",
  "precooked",
];

/** Knife work and similar. Acceptable inline on the ingredient line. */
const SOFT_PREP = [
  "chopped",
  "diced",
  "sliced",
  "minced",
  "grated",
  "shredded",
  "melted",
  "softened",
  "drained",
  "rinsed",
  "peeled",
  "crushed",
  "beaten",
  "zested",
  "juiced",
  "trimmed",
  "cubed",
  "halved",
];

/** Verbs that imply heat and therefore need a time or temperature to be useful. */
const HEAT_VERBS = [
  "cook",
  "bake",
  "boil",
  "simmer",
  "steam",
  "roast",
  "fry",
  "sear",
  "grill",
  "saute",
  "sauté",
  "braise",
  "poach",
  "broil",
  "toast",
  "reduce",
  "melt",
  "caramelize",
];

const TIME_OR_TEMP = /\d\s*(s|sec|second|min|minute|hr|hour|h)\b|\d\s*°|\d\s*(f|c)\b|overnight|until\b/i;

export interface CardGrade {
  ingredients: number;
  steps: number;
  columns: number;
  rows: number;
  /** Ingredient names that embed real cooking with no operation doing it */
  rawStartHard: string[];
  /** Ingredient names that embed knife prep with no operation doing it */
  rawStartSoft: string[];
  /** Heat operations with no time or temperature */
  vagueOps: string[];
  /** Fraction of quantities not stated by the source */
  unresolvedRate: number;
  correctedCount: number;
  /** Source ingredient lines with no matching card ingredient, when ground truth exists */
  missingIngredients: string[];
  coverage: number | null;
  /** True when nothing structural is wrong */
  structurallyOk: boolean;
  notes: string[];
}

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

const STOP = new Set([
  "the","and","for","cup","cups","tsp","tbsp","teaspoon","teaspoons","tablespoon","tablespoons",
  "ounce","ounces","pound","pounds","gram","grams","large","small","medium","fresh","chopped",
  "sliced","diced","minced","optional","taste","into","with","plus","more","about","can","cans",
  "package","packages","finely","roughly","freshly","ground","divided","room","temperature",
]);

function contentWords(s: string): Set<string> {
  return new Set(words(s).filter((w) => !STOP.has(w) && !/^\d+$/.test(w)));
}

/** Does any operation in the card perform this preparation? */
function prepIsPerformed(prep: string, doc: RecipeDoc, ingredientId: string): boolean {
  const stem = prep.replace(/(ed|d)$/, "");
  const consuming = doc.steps.filter((s) => s.inputs.includes(ingredientId));
  const chain: string[] = [];
  // walk forward from the step that consumes this ingredient
  let frontier = consuming.map((s) => s.id);
  const seen = new Set<string>();
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      if (seen.has(id)) continue;
      seen.add(id);
      const step = doc.steps.find((s) => s.id === id);
      if (!step) continue;
      chain.push(step.label.toLowerCase());
      for (const s of doc.steps) if (s.inputs.includes(id)) next.push(s.id);
    }
    frontier = next;
  }
  const text = chain.join(" ") + " " + doc.prepNotes.join(" ").toLowerCase();
  return text.includes(stem);
}

export function gradeCard(
  doc: RecipeDoc,
  groundTruthIngredients?: string[],
): CardGrade {
  const notes: string[] = [];
  let columns = 0;
  let rows = 0;
  let structurallyOk = true;
  try {
    const layout = layoutRecipe(doc);
    columns = layout.columns;
    rows = layout.rows;
  } catch (err) {
    structurallyOk = false;
    notes.push(`layout failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const rawStartHard: string[] = [];
  const rawStartSoft: string[] = [];
  for (const ing of doc.ingredients) {
    const name = ing.name.toLowerCase();
    for (const prep of HARD_PREP) {
      if (name.includes(prep) && !prepIsPerformed(prep, doc, ing.id)) {
        rawStartHard.push(`${ing.name} (${prep})`);
        break;
      }
    }
    for (const prep of SOFT_PREP) {
      if (name.includes(prep) && !prepIsPerformed(prep, doc, ing.id)) {
        rawStartSoft.push(`${ing.name} (${prep})`);
        break;
      }
    }
  }

  const vagueOps: string[] = [];
  for (const step of doc.steps) {
    const label = step.label.toLowerCase();
    const hasHeat = HEAT_VERBS.some((v) => new RegExp(`\\b${v}`).test(label));
    if (hasHeat && !TIME_OR_TEMP.test(step.label)) vagueOps.push(step.label);
  }

  const unresolved = doc.ingredients.filter(
    (i) =>
      i.quantity.provenance === "estimated" ||
      i.quantity.provenance === "fetched" ||
      i.quantity.provenance === "inferred",
  ).length;
  const corrected = doc.ingredients.filter((i) => i.quantity.provenance === "corrected").length;

  let missingIngredients: string[] = [];
  let coverage: number | null = null;
  if (groundTruthIngredients && groundTruthIngredients.length > 0) {
    // Source lines carry brand asides and prep clauses ("1 cup sugar (I used
    // organic cane sugar)") that swamp a naive overlap test and make correct
    // cards look lossy. Compare against the substantive part of the line, and
    // treat a card ingredient as present when its head noun appears there.
    const cards = doc.ingredients.map((i) => {
      const w = words(i.name).filter((x) => !STOP.has(x));
      return { set: contentWords(i.name), head: w[w.length - 1] ?? "" };
    });
    missingIngredients = groundTruthIngredients.filter((line) => {
      const core = line.replace(/\([^)]*\)/g, " ").split(/,/)[0];
      const want = contentWords(core);
      const wantFull = contentWords(line);
      if (want.size === 0 && wantFull.size === 0) return false;
      return !cards.some((c) => {
        if (c.head && (want.has(c.head) || wantFull.has(c.head))) return true;
        let hits = 0;
        for (const w of want) if (c.set.has(w)) hits += 1;
        if (hits >= 2) return true;
        return want.size > 0 && hits / want.size >= 0.5;
      });
    });
    coverage = 1 - missingIngredients.length / groundTruthIngredients.length;
  }

  if (columns > 8) notes.push(`${columns} columns, board is unwieldy`);
  if (doc.steps.length < 2) notes.push("fewer than two operations");
  if (doc.ingredients.length < 2) notes.push("fewer than two ingredients");

  return {
    ingredients: doc.ingredients.length,
    steps: doc.steps.length,
    columns,
    rows,
    rawStartHard,
    rawStartSoft,
    vagueOps,
    unresolvedRate: doc.ingredients.length ? unresolved / doc.ingredients.length : 0,
    correctedCount: corrected,
    missingIngredients,
    coverage,
    structurallyOk,
    notes,
  };
}

/** A compact, judge-friendly rendering of the card. */
export function cardToText(doc: RecipeDoc): string {
  const lines: string[] = [`DISH: ${doc.dish}`];
  if (doc.servings) lines.push(`YIELD: ${doc.servings}`);
  for (const n of doc.prepNotes) lines.push(`PREP: ${n}`);
  lines.push("INGREDIENTS:");
  for (const i of doc.ingredients) {
    lines.push(`  [${i.id}] ${i.quantity.display} ${i.name} (${i.quantity.provenance})`);
  }
  lines.push("OPERATIONS (in order, each merges its inputs):");
  for (const s of doc.steps) lines.push(`  [${s.id}] ${s.label}  <= ${s.inputs.join(" + ")}`);
  return lines.join("\n");
}
