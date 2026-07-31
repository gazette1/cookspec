// Recipe store. Interim implementation reads the statically bundled seed
// pack; after Supabase provisions, these functions swap to database queries
// with the same signatures and the pages do not change.

import { seedRecipes } from "./recipe/seed-data.ts";
import type { RecipeDoc } from "./recipe/types.ts";

export interface StoredRecipe {
  doc: RecipeDoc;
  attributionUrl: string;
  license: string;
}

export async function listPublicRecipes(): Promise<StoredRecipe[]> {
  return seedRecipes
    .map((s) => ({ doc: s.doc, attributionUrl: s.seed.attributionUrl, license: s.seed.license }))
    .sort((a, b) => a.doc.dish.localeCompare(b.doc.dish));
}

export async function getRecipeBySlug(slug: string): Promise<StoredRecipe | null> {
  const entry = seedRecipes.find((s) => s.doc.slug === slug);
  if (!entry) return null;
  return { doc: entry.doc, attributionUrl: entry.seed.attributionUrl, license: entry.seed.license };
}
