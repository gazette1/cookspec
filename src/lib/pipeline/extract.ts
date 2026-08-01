// LLM structuring: source material in, validated RecipeDoc out. The model
// emits a DAG; layoutRecipe plus validateDag act as the acceptance test, and
// failures feed back for up to two self-repair attempts.

import { layoutRecipe } from "../recipe/layout.ts";
import type { Ingredient, RecipeDoc, RecipeSource, Step } from "../recipe/types.ts";
import { validateQuantity, type RawQuantity } from "../recipe/validate.ts";
import { deepseekJson, geminiGenerate, type LlmUsage } from "./llm.ts";

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
  /** Media paths set this when the source shows a dish but no recipe text */
  inferredGuess?: boolean;
  /** Set when the source is a roundup, an explainer, or otherwise not one recipe */
  notARecipe?: boolean;
  reason?: string;
}

/** Thrown when the source genuinely is not a recipe. Terminal: retrying only
 *  pressures the model into inventing something. */
export class NotARecipeError extends Error {
  readonly terminal = true;
  constructor(reason: string) {
    super(reason);
    this.name = "NotARecipeError";
  }
}

export const STRUCTURING_RULES = `You convert recipes into a strict machine-readable DAG for the Cooking for Engineers table notation. Output only JSON.

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
- If the source marks a quantity as not stated, do not echo "not stated": put your typical value for this dish in text ("about 1 lb") and set estimated true.
- Teach the dish from raw ingredients. If the source names a component in a form the cook has to produce ("cooked rice", "cooked pasta", "boiled potatoes", "cooked beans" from dry, "leftover chicken"), list the raw ingredient instead and add the operation that produces it, with its method and time. Keep the prepared form as a plain ingredient when it is something people buy that way: rotisserie chicken, canned or jarred goods, toasted sesame oil, roasted red peppers, store-bought crust, smoked or cured meats. Knife work and simple handling (chopped, diced, sliced, minced, grated, melted, drained) stays on the ingredient line without its own operation.
- When you add a preparation the source did not spell out, use standard method and timing for that ingredient and set estimated true on its qty.
- Every operation that applies heat carries a time, a temperature, or a doneness cue in its label. "cook rice" is not acceptable. "simmer covered 18 min", "bake 375°F, 25 min", "sear until browned, 3 min per side" are. If the source gives no timing, use standard timing for that technique.

If the source does not contain one complete recipe, do not invent one. This covers roundups and lists of several recipes, technique or explainer articles, product and category pages, and blurbs that only describe a dish. In that case output exactly {"notARecipe": true, "reason": "<short reason>"} and nothing else.

Output JSON with keys: dish, servings, prepNotes, ingredients, steps.`;

// Staples that are inedible until cooked. If one of these is on the card in
// raw form, some operation has to cook it, or the card is not a recipe you
// can follow. Prompt wording alone gets this right most of the time; this
// turns it into a gate the repair loop can act on.
const MUST_COOK: { match: RegExp; not: RegExp }[] = [
  { match: /\b(rice)\b/, not: /(vinegar|flour|paper|wine|milk|noodle|krispies|cooked|syrup|powder)/ },
  { match: /\b(pasta|spaghetti|macaroni|penne|linguine|fettuccine|lasagna noodles|egg noodles)\b/, not: /(sauce|salad dressing|cooked)/ },
  { match: /\b(dried|dry)\s+(beans|lentils|chickpeas|peas)\b/, not: /(canned|cooked)/ },
  { match: /\b(quinoa|pearl barley|farro|bulgur)\b/, not: /cooked/ },
  { match: /\braw\s+(chicken|beef|pork|turkey|shrimp|fish)\b/, not: /(broth|stock|bouillon)/ },
  { match: /\b(chicken (breasts?|thighs?|wings?)|ground (beef|turkey|pork)|pork (chops?|shoulder)|steak)\b/, not: /(broth|stock|bouillon|cooked|rotisserie|deli|smoked|cured)/ },
  { match: /\b(potatoes)\b/, not: /(chips|crisps|flakes|starch|cooked|salad)/ },
];

const COOK_VERB = /\b(cook|bake|boil|simmer|steam|roast|fry|sear|grill|saute|sauté|braise|poach|broil|pressure|air.fry|microwave|toast|heat|warm|stir.fry|blanch)/i;

/** Every downstream operation label reachable from an ingredient. */
function downstreamLabels(doc: RecipeDoc, ingredientId: string): string {
  const labels: string[] = [];
  const seen = new Set<string>();
  let frontier = doc.steps.filter((s) => s.inputs.includes(ingredientId)).map((s) => s.id);
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      if (seen.has(id)) continue;
      seen.add(id);
      const step = doc.steps.find((s) => s.id === id);
      if (!step) continue;
      labels.push(step.label);
      for (const s of doc.steps) if (s.inputs.includes(id)) next.push(s.id);
    }
    frontier = next;
  }
  return labels.join(" ");
}

export function validateRawStaplesCooked(doc: RecipeDoc): string | null {
  for (const ing of doc.ingredients) {
    const name = ing.name.toLowerCase();
    const rule = MUST_COOK.find((r) => r.match.test(name) && !r.not.test(name));
    if (!rule) continue;
    const chain = downstreamLabels(doc, ing.id) + " " + doc.prepNotes.join(" ");
    if (!COOK_VERB.test(chain)) {
      return `"${ing.name}" has to be cooked before it can be eaten, but no operation cooks it. Add the operation that cooks it, with its method and time, and keep it in the merge`;
    }
  }
  return null;
}

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
    servings: raw.servings ?? undefined,
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

/**
 * Parse and validate one model response into a RecipeDoc, or throw with a
 * repairable reason. Shared by the text structurer and the single-call media
 * paths.
 */
export function finalizeExtraction(
  jsonText: string,
  opts: { source?: RecipeSource; inferred?: boolean },
): RecipeDoc {
  let raw: RawExtraction;
  try {
    raw = JSON.parse(jsonText.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "")) as RawExtraction;
  } catch {
    throw new Error("output was not valid JSON");
  }
  if (raw.notARecipe === true) {
    const why = raw.reason?.trim();
    throw new NotARecipeError(
      `${why ? `This source is not a single recipe: ${why}.` : "This source is not a single recipe."} Paste a link to one recipe.`,
    );
  }
  if (!raw.dish || !Array.isArray(raw.ingredients) || !Array.isArray(raw.steps) || raw.steps.length === 0) {
    throw new Error("missing dish, ingredients, or steps");
  }
  // a nameless or idless entry corrupts every downstream consumer, so treat it
  // as a repairable extraction error rather than letting it through
  for (const i of raw.ingredients) {
    if (!i || typeof i.id !== "string" || typeof i.name !== "string" || !i.name.trim()) {
      throw new Error("every ingredient needs a string id and a non-empty name");
    }
  }
  for (const s of raw.steps) {
    if (!s || typeof s.id !== "string" || typeof s.label !== "string" || !Array.isArray(s.inputs)) {
      throw new Error("every step needs a string id, a label, and an inputs array");
    }
  }
  const inferred = (opts.inferred ?? false) || raw.inferredGuess === true;
  const doc = toRecipeDoc(splitDividedIngredients(raw), slugify(raw.dish), opts.source, inferred);
  const dagError = validateDag(doc);
  if (dagError !== null) throw new Error(dagError);
  const rawError = validateRawStaplesCooked(doc);
  if (rawError !== null) throw new Error(rawError);
  return doc;
}

const REPAIR_REMINDER =
  "Remember: every ingredient is used exactly once, every non-final step is consumed exactly once. Output the full corrected JSON.";

export async function extractRecipe(opts: {
  apiKey: string;
  sourceMaterial: string;
  source?: RecipeSource;
  inferred?: boolean;
  /** When set, the first two attempts run on the faster Gemini flash-lite */
  fastGeminiKey?: string;
}): Promise<{ doc: RecipeDoc; meta: ExtractionMeta }> {
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const modelsUsed: string[] = [];
  let attempts = 0;
  let lastError = "";
  let user = opts.sourceMaterial;

  while (attempts < 3) {
    attempts += 1;
    // fast structurer first, DeepSeek as the reliability anchor on the last try
    const useFast = opts.fastGeminiKey !== undefined && attempts < 3;
    const result = useFast
      ? await geminiGenerate({
          apiKey: opts.fastGeminiKey as string,
          model: "gemini-flash-lite-latest",
          jsonOutput: true,
          parts: [{ text: `${STRUCTURING_RULES}\n\n${user}` }],
        })
      : await deepseekJson({ apiKey: opts.apiKey, system: STRUCTURING_RULES, user });
    if (!modelsUsed.includes(result.model)) modelsUsed.push(result.model);
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    usage.costUsd += result.usage.costUsd;

    try {
      const doc = finalizeExtraction(result.content, { source: opts.source, inferred: opts.inferred });
      return { doc, meta: { model: modelsUsed.join(" + "), attempts, usage } };
    } catch (err) {
      if (err instanceof NotARecipeError) throw err;
      lastError = err instanceof Error ? err.message : String(err);
      user = `${opts.sourceMaterial}\n\nYour previous JSON failed validation: ${lastError}. ${REPAIR_REMINDER}`;
    }
  }

  throw new Error(`extraction failed after ${attempts} attempts: ${lastError}`);
}
