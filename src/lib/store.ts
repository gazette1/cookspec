// Recipe store, Supabase-backed. Falls back to the statically bundled seed
// pack when the environment has no Supabase credentials (fresh clones still
// run). Reads use the anon key under RLS; anonymous conversion writes are
// allowed by the interim policies and tightened when auth lands.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { seedRecipes } from "./recipe/seed-data.ts";
import type { RecipeDoc } from "./recipe/types.ts";

export interface StoredRecipe {
  doc: RecipeDoc;
  slug: string;
  attributionUrl?: string;
  license?: string;
  sourceType?: string;
}

interface RecipeRow {
  slug: string | null;
  source_url: string | null;
  source_type: string;
  recipe_json: RecipeDoc & { seedLicense?: string };
}

let cached: SupabaseClient | null | undefined;

function client(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  cached = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return cached;
}

function rowToStored(row: RecipeRow): StoredRecipe {
  const { seedLicense, ...doc } = row.recipe_json;
  return {
    doc: doc as RecipeDoc,
    slug: row.slug ?? doc.slug,
    attributionUrl: row.source_url ?? undefined,
    license: seedLicense,
    sourceType: row.source_type,
  };
}

export async function listPublicRecipes(): Promise<StoredRecipe[]> {
  const db = client();
  if (!db) {
    return seedRecipes
      .map((s) => ({
        doc: s.doc,
        slug: s.doc.slug,
        attributionUrl: s.seed.attributionUrl,
        license: s.seed.license,
      }))
      .sort((a, b) => a.doc.dish.localeCompare(b.doc.dish));
  }
  const { data, error } = await db
    .from("recipes")
    .select("slug, source_url, source_type, recipe_json")
    .eq("is_public", true)
    .order("dish_name");
  if (error) throw new Error(`recipes query failed: ${error.message}`);
  return (data as RecipeRow[]).map(rowToStored);
}

export async function getRecipeBySlug(slug: string): Promise<StoredRecipe | null> {
  const db = client();
  if (!db) {
    const entry = seedRecipes.find((s) => s.doc.slug === slug);
    return entry
      ? { doc: entry.doc, slug: entry.doc.slug, attributionUrl: entry.seed.attributionUrl, license: entry.seed.license }
      : null;
  }
  const { data, error } = await db
    .from("recipes")
    .select("slug, source_url, source_type, recipe_json")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`recipe query failed: ${error.message}`);
  return data ? rowToStored(data as RecipeRow) : null;
}

export async function findByCanonicalHash(hash: string): Promise<StoredRecipe | null> {
  const db = client();
  if (!db) return null;
  const { data, error } = await db
    .from("recipes")
    .select("slug, source_url, source_type, recipe_json")
    .eq("canonical_url_hash", hash)
    .maybeSingle();
  if (error) throw new Error(`dedupe query failed: ${error.message}`);
  return data ? rowToStored(data as RecipeRow) : null;
}

export async function persistRecipe(args: {
  doc: RecipeDoc;
  canonicalHash: string;
  canonicalUrl?: string;
  sourceType: string;
}): Promise<{ slug: string } | null> {
  const db = client();
  if (!db) return null;

  const base = {
    canonical_url_hash: args.canonicalHash,
    source_url: args.canonicalUrl ?? args.doc.source?.url ?? null,
    source_type: args.sourceType,
    source_platform: args.doc.source?.platform ?? null,
    creator_handle: args.doc.source?.creatorHandle ?? null,
    dish_name: args.doc.dish,
    recipe_json: args.doc,
    is_public: true,
    is_inferred: args.doc.inferred ?? false,
  };

  for (const slug of [args.doc.slug, `${args.doc.slug}-${args.canonicalHash.slice(0, 8)}`]) {
    const { error } = await db.from("recipes").insert({ ...base, slug });
    if (!error) return { slug };
    if (error.code === "23505" && /canonical_url_hash/.test(error.message)) {
      const existing = await findByCanonicalHash(args.canonicalHash);
      return existing ? { slug: existing.slug } : null;
    }
    if (error.code !== "23505") throw new Error(`persist failed: ${error.message}`);
  }
  return null;
}

export async function logConversion(event: {
  recipeSlug?: string;
  cacheHit: boolean;
  costUsd?: number;
}): Promise<void> {
  const db = client();
  if (!db) return;
  // best-effort metric; never let logging break a compile
  await db
    .from("conversion_events")
    .insert({ cache_hit: event.cacheHit, cost_usd: event.costUsd ?? null })
    .then(() => undefined);
}
