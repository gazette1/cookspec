// Unit validation. Turns the extractor's raw quantities into display
// quantities with honest provenance: stated values that pass a density check
// stay stated, stated grams that contradict the stated volume get corrected,
// and missing grams get estimated from the density table when we know the
// ingredient. Sources for densities are cited in the correction notes.

export interface RawQuantity {
  /** Quantity text as the source states it, e.g. "1/2 cup" or "2 large" */
  text: string;
  amount?: number | null;
  unit?: string | null;
  grams?: number | null;
  /** True when the extractor guessed because the source gave nothing */
  estimated?: boolean | null;
}

import type { Quantity } from "./types.ts";

interface DensityEntry {
  match: RegExp;
  gramsPerCup: number;
  source: string;
}

// grams per US cup unless noted; kept small and conservative on purpose
const DENSITIES: DensityEntry[] = [
  { match: /all.purpose flour|plain flour|\bflour\b/, gramsPerCup: 120, source: "King Arthur ingredient weight chart" },
  { match: /granulated sugar|white sugar|\bsugar\b/, gramsPerCup: 200, source: "King Arthur ingredient weight chart" },
  { match: /brown sugar/, gramsPerCup: 213, source: "King Arthur ingredient weight chart" },
  { match: /powdered sugar|confectioners/, gramsPerCup: 113, source: "King Arthur ingredient weight chart" },
  { match: /cocoa/, gramsPerCup: 80, source: "Hershey's label, 5 g per tablespoon" },
  { match: /\bbutter\b/, gramsPerCup: 227, source: "USDA, 227 g per cup butter" },
  { match: /parmesan|parmigiano/, gramsPerCup: 100, source: "USDA grated parmesan" },
  { match: /heavy cream|double cream|whipping cream/, gramsPerCup: 238, source: "USDA heavy cream" },
  { match: /\bmilk\b/, gramsPerCup: 244, source: "USDA whole milk" },
  { match: /chicken (stock|broth)|vegetable (stock|broth)|\bstock\b|\bbroth\b/, gramsPerCup: 240, source: "USDA broth" },
  { match: /\bwater\b/, gramsPerCup: 237, source: "USDA water" },
  { match: /olive oil|vegetable oil|\boil\b/, gramsPerCup: 216, source: "USDA olive oil" },
  { match: /honey/, gramsPerCup: 339, source: "USDA honey" },
  { match: /uncooked rice|\brice\b/, gramsPerCup: 185, source: "USDA long-grain rice" },
  { match: /rolled oats|\boats\b/, gramsPerCup: 90, source: "King Arthur ingredient weight chart" },
  { match: /tomato paste/, gramsPerCup: 262, source: "USDA tomato paste" },
  { match: /sun.dried tomato/, gramsPerCup: 110, source: "USDA sun-dried tomatoes, drained" },
];

const CUPS_PER_UNIT: Record<string, number> = {
  cup: 1,
  cups: 1,
  tbsp: 1 / 16,
  tablespoon: 1 / 16,
  tablespoons: 1 / 16,
  tsp: 1 / 48,
  teaspoon: 1 / 48,
  teaspoons: 1 / 48,
  "fl oz": 1 / 8,
  ml: 1 / 236.6,
  milliliter: 1 / 236.6,
  milliliters: 1 / 236.6,
  l: 4.227,
  liter: 4.227,
  liters: 4.227,
  pint: 2,
  pints: 2,
  quart: 4,
  quarts: 4,
};

const GRAMS_PER_OZ = 28.35;
const TOLERANCE = 0.3;

function densityFor(name: string): DensityEntry | undefined {
  const lower = name.toLowerCase();
  return DENSITIES.find((d) => d.match.test(lower));
}

function expectedGrams(name: string, amount: number, unit: string): { grams: number; source: string } | undefined {
  const normalized = unit.toLowerCase().trim();
  if (normalized === "oz" || normalized === "ounce" || normalized === "ounces") {
    return { grams: amount * GRAMS_PER_OZ, source: "28.35 g per ounce" };
  }
  if (normalized === "lb" || normalized === "pound" || normalized === "pounds") {
    return { grams: amount * GRAMS_PER_OZ * 16, source: "453.6 g per pound" };
  }
  if (normalized === "g" || normalized === "gram" || normalized === "grams") {
    return { grams: amount, source: "stated in grams" };
  }
  if (normalized === "kg") {
    return { grams: amount * 1000, source: "stated in kilograms" };
  }
  const cups = CUPS_PER_UNIT[normalized];
  if (cups === undefined) return undefined;
  const density = densityFor(name);
  if (!density) return undefined;
  return { grams: amount * cups * density.gramsPerCup, source: density.source };
}

function round(grams: number): number {
  if (grams >= 100) return Math.round(grams / 5) * 5;
  if (grams >= 10) return Math.round(grams);
  return Math.round(grams * 10) / 10;
}

export function validateQuantity(name: string, raw: RawQuantity): Quantity {
  const text = raw.text.trim();
  // "650 g" already states its weight; appending "(650 g)" again is noise
  const textStatesGrams = /(^|\s)\d+([.,]\d+)?\s*(g|kg|grams?|kilograms?)\b/i.test(text);
  const stated = raw.grams ?? undefined;
  const expected =
    raw.amount != null && raw.unit ? expectedGrams(name, raw.amount, raw.unit) : undefined;

  if (raw.estimated) {
    const grams = stated ?? (expected ? round(expected.grams) : undefined);
    return {
      display: grams !== undefined ? `${text} (about ${round(grams)} g)` : text,
      grams: grams !== undefined ? round(grams) : undefined,
      provenance: "estimated",
      note: "The source gives no quantity; this is a typical value, not the creator's.",
    };
  }

  if (stated !== undefined && expected) {
    const deviation = Math.abs(stated - expected.grams) / expected.grams;
    if (deviation > TOLERANCE) {
      const corrected = round(expected.grams);
      return {
        display: `${text} (about ${corrected} g)`,
        grams: corrected,
        provenance: "corrected",
        statedDisplay: `${text} (${round(stated)} g)`,
        note: `${expected.source} puts this at about ${corrected} g; the source's ${round(stated)} g does not match its own volume.`,
      };
    }
    return {
      display: textStatesGrams ? text : `${text} (${round(stated)} g)`,
      grams: round(stated),
      provenance: "stated",
    };
  }

  if (stated !== undefined) {
    return {
      display: textStatesGrams ? text : `${text} (${round(stated)} g)`,
      grams: round(stated),
      provenance: "stated",
    };
  }

  if (expected) {
    return {
      display: `${text} (about ${round(expected.grams)} g)`,
      grams: round(expected.grams),
      provenance: "stated",
      note: `Gram weight computed from the stated volume via ${expected.source}.`,
    };
  }

  return { display: text, provenance: "stated" };
}
