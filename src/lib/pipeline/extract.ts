// LLM structuring: source material in, validated RecipeDoc out. The model
// emits a DAG; layoutRecipe plus validateDag act as the acceptance test, and
// failures feed back for up to two self-repair attempts.

import { layoutRecipe } from "../recipe/layout.ts";
import type { Ingredient, RecipeDoc, RecipeSource, Step } from "../recipe/types.ts";
import { validateQuantity, type RawQuantity } from "../recipe/validate.ts";
import { deepseekJson, type LlmUsage } from "./llm.ts";

export interface ExtractionMeta {
  model: string;
  attempts: number;
  usage: LlmUsage;
}

interface RawIngredient {
  id: string;
  name: string;
  qty: RawQuantity;
}

interface RawStep {
  id: string;
  label: string;
  inputs: string[];
}

interface RawExtraction {
  dish: string;
  servings?: string | null;
  prepNotes?: string[];
  ingredients: RawIngredient[];
  steps: RawStep[];
}

const SYSTEM_PROMPT = `You convert recipes into a strict machine-readable DAG for the Cooking for Engineers table notation. Output only JSON.

Rules:
- ingredients: every ingredient the recipe uses. List order does not matter; it is fixed later in code.
- Each ingredient object: unique snake_case id; name with no quantity inside it; qty object where text is the quantity exactly as the source states it ("1/2 cup", "2 large", "to taste"), amount is the number parsed from text (null if none), unit is the unit word in singular lowercase (cup, tbsp, tsp, oz, lb, g, ml, clove; null for bare counts), grams is a gram weight only if the source itself states one (else null), and estimated is true only when the source gives no usable quantity and text is your typical-value guess.
- steps: topologically ordered operations. Each step object: unique snake_case id; label as a short imperative verb phrase with temps in Fahrenheit and times included ("sear 3 min per side", "bake 375°F, 25 min"); inputs as an array of ingredient ids and earlier step ids this operation combines.
- Every ingredient id, and every step id except the final step, must appear in exactly one later step's inputs. The final step is the finished dish.
- 3 to 9 steps for most recipes. Fold trivial micro-steps (season, stir) into the parent operation's label.
- The structure is a tree with the finished dish as the root. When something is cooked, set aside, and returned later, it connects exactly once, at the step where it rejoins. Example for a sear-then-sauce recipe: sear(chicken, oil); saute(butter, garlic); sauce(saute, cream, broth, parmesan); combine(sear, sauce); finish(combine, basil). The sear step appears in exactly one inputs list.
- Divided use: if an ingredient goes into more than one step ("1 tsp salt, divided"), create a separate ingredient entry per use (salt_for_chicken, salt_for_sauce) with the portion each step actually gets; if the source does not state the split, give your best split and set estimated true on those qty objects.
- prepNotes: zero to three short whole-recipe preparations that happen before the table (pan prep, oven preheat).
- Do not invent ingredients. Do not drop any ingredient the source lists.

Output JSON with keys: dish, servings, prepNotes, ingredients, steps.`;

export function validateDag(doc: RecipeDoc): string | null {
  const consumers = new Map<string, string[]>();
  for (const step of doc.steps) {
    for (const input of step.inputs) {
      const list = consumers.get(input) ?? [];
      list.push(step.id);
      consumers.set(input, list);
    }
  }
  for (const ing of doc.ingredients) {
    const list = consumers.get(ing.id) ?? [];
    if (list.length === 0) return `ingredient ${ing.id} is never used by any step`;
    if (list.length > 1)
      return `ingredient ${ing.id} appears in the inputs of ${list.join(" and ")}; keep it only where it actually combines and restructure`;
  }
  const last = doc.steps[doc.steps.length - 1];
  for (const step of doc.steps) {
    const list = consumers.get(step.id) ?? [];
    if (step.id === last.id) {
      if (list.length !== 0) return `final step ${step.id} must not be an input to another step`;
    } else if (list.length === 0) {
      return `step ${step.id} is never consumed by a later step`;
    } else if (list.length > 1) {
      return `step ${step.id} appears in the inputs of ${list.join(" and ")}; a set-aside item connects exactly once, at the step where it rejoins`;
    }
  }
  try {
    layoutRecipe(doc);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return null;
}

function toRecipeDoc(raw: RawExtraction, slug: string, source: RecipeSource | undefined, inferred: boolean): RecipeDoc {
  const ingredients: Ingredient[] = raw.ingredients.map((i) => ({
    id: i.id,
    name: i.name,
    quantity: validateQuantity(i.name, i.qty ?? { text: "" }),
  }));
  const steps: Step[] = raw.steps.map((s) => ({ id: s.id, label: s.label, inputs: s.inputs }));
  return {
    slug,
    dish: raw.dish,
    source,
    prepNotes: raw.prepNotes ?? [],
    ingredients: orderIngredients(ingredients, steps),
    steps,
    inferred: inferred || undefined,
  };
}

// The notation needs every step's inputs on contiguous rows. Because the
// graph is a tree (each node consumed exactly once), a depth-first walk from
// the final step emits every subtree's ingredient leaves consecutively, so
// this ordering always satisfies contiguity. Solved in code so the model
// never has to think about row order.
function orderIngredients(ingredients: Ingredient[], steps: Step[]): Ingredient[] {
  if (steps.length === 0) return ingredients;
  const ingredientById = new Map(ingredients.map((i) => [i.id, i]));
  const stepById = new Map(steps.map((s) => [s.id, s]));
  const ordered: Ingredient[] = [];
  const seen = new Set<string>();
  const walk = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const ing = ingredientById.get(id);
    if (ing) {
      ordered.push(ing);
      return;
    }
    const step = stepById.get(id);
    if (step) for (const input of step.inputs) walk(input);
  };
  walk(steps[steps.length - 1].id);
  for (const ing of ingredients) if (!seen.has(ing.id)) ordered.push(ing);
  return ordered;
}

// Fallback when the model leaves one ingredient feeding several steps: split
// it into one row per consuming step, CfE divided-use style. Deterministic so
// the repair loop never spins on this failure class.
function splitDividedIngredients(raw: RawExtraction): RawExtraction {
  const consumers = new Map<string, RawStep[]>();
  for (const step of raw.steps ?? []) {
    for (const input of step.inputs ?? []) {
      if ((raw.ingredients ?? []).some((i) => i.id === input)) {
        const list = consumers.get(input) ?? [];
        list.push(step);
        consumers.set(input, list);
      }
    }
  }
  const ingredients: RawIngredient[] = [];
  for (const ing of raw.ingredients ?? []) {
    const steps = consumers.get(ing.id) ?? [];
    if (steps.length <= 1) {
      ingredients.push(ing);
      continue;
    }
    steps.forEach((step, n) => {
      const cloneId = `${ing.id}__u${n + 1}`;
      ingredients.push({
        id: cloneId,
        name: ing.name,
        qty:
          n === 0
            ? { ...ing.qty, text: `${ing.qty?.text ?? ""}, divided`.replace(/^, /, "") }
            : { text: "divided portion" },
      });
      step.inputs = step.inputs.map((i) => (i === ing.id ? cloneId : i));
    });
  }
  return { ...raw, ingredients };
}

export function slugify(dish: string): string {
  return dish
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function extractRecipe(opts: {
  apiKey: string;
  sourceMaterial: string;
  source?: RecipeSource;
  inferred?: boolean;
}): Promise<{ doc: RecipeDoc; meta: ExtractionMeta }> {
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  let attempts = 0;
  let model = "";
  let lastError = "";
  let user = opts.sourceMaterial;

  while (attempts < 3) {
    attempts += 1;
    const result = await deepseekJson({ apiKey: opts.apiKey, system: SYSTEM_PROMPT, user });
    model = result.model;
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    usage.costUsd += result.usage.costUsd;

    let raw: RawExtraction;
    try {
      raw = JSON.parse(result.content) as RawExtraction;
    } catch {
      lastError = "output was not valid JSON";
      user = `${opts.sourceMaterial}\n\nYour previous output was not valid JSON. Output the full corrected JSON.`;
      continue;
    }

    if (!raw.dish || !Array.isArray(raw.ingredients) || !Array.isArray(raw.steps) || raw.steps.length === 0) {
      lastError = "missing dish, ingredients, or steps";
      user = `${opts.sourceMaterial}\n\nYour previous JSON was missing dish, ingredients, or steps. Output the full corrected JSON.`;
      continue;
    }

    const doc = toRecipeDoc(splitDividedIngredients(raw), slugify(raw.dish), opts.source, opts.inferred ?? false);
    const dagError = validateDag(doc);
    if (dagError === null) {
      return { doc, meta: { model, attempts, usage } };
    }
    lastError = dagError;
    user = `${opts.sourceMaterial}\n\nYour previous JSON failed DAG validation: ${dagError}. Remember: every ingredient is used exactly once, every non-final step is consumed exactly once, and each step's inputs must cover contiguous rows (reorder the ingredient list if needed). Output the full corrected JSON.`;
  }

  throw new Error(`extraction failed after ${attempts} attempts: ${lastError}`);
}
