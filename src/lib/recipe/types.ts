// Structured recipe document produced by the extraction pipeline and consumed
// by the layout engine. Every quantity carries provenance so the card can be
// honest about what the source said versus what we corrected, estimated,
// fetched from elsewhere, or inferred from a photo.

export type Provenance =
  | "stated" // exactly what the source gives
  | "corrected" // source value failed unit validation; we show the corrected value
  | "estimated" // source was vague ("a bit of flour"); we filled a sensible value
  | "fetched" // missing from the source; filled from web research
  | "inferred"; // no recipe existed; generated from a dish photo or name

export interface Quantity {
  /** What the card displays, e.g. "1 cup (200 g)" */
  display: string;
  grams?: number;
  provenance: Provenance;
  /** Original source value when provenance is not "stated" */
  statedDisplay?: string;
  /** Why it was corrected, or where a fetched value came from */
  note?: string;
}

export interface Ingredient {
  id: string;
  name: string;
  quantity: Quantity;
}

export interface Step {
  id: string;
  /** Verb plus params as shown in the cell, e.g. "bake 350°F, 30 to 40 min" */
  label: string;
  /**
   * Ingredient ids or prior step ids this step consumes. Their rows must be
   * contiguous in the ingredient order; the extractor is responsible for
   * ordering ingredients so this holds.
   */
  inputs: string[];
}

export interface RecipeSource {
  url?: string;
  platform?: string;
  creatorHandle?: string;
}

export interface RecipeDoc {
  slug: string;
  dish: string;
  source?: RecipeSource;
  /** Full-width banner rows above the grid, e.g. "Preheat oven to 350°F" */
  prepNotes: string[];
  ingredients: Ingredient[];
  /** Topologically ordered; the last step is the finished dish */
  steps: Step[];
  /** Yield as the source states it, e.g. "4 servings" */
  servings?: string;
  /** True when the whole recipe is a generated guess from a photo */
  inferred?: boolean;
}
