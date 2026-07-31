import type { Metadata } from "next";
import Link from "next/link";
import { listPublicRecipes } from "@/lib/store.ts";

export const metadata: Metadata = {
  title: "Recipe library | CookSpec",
  description: "Every public recipe on CookSpec, compiled into one engineering table each.",
};

export default async function RecipesPage() {
  const recipes = await listPublicRecipes();

  return (
    <main>
      <nav className="crumbs">
        <Link href="/">CookSpec</Link>
      </nav>
      <h1>Recipe library</h1>
      <p className="tagline">
        {recipes.length} recipes, each compiled into one table. The current set is the USDA MyPlate
        Kitchen seed pack, public domain; your own conversions join them once accounts land.
      </p>
      <ul className="recipe-list">
        {recipes.map((r) => (
          <li key={r.doc.slug}>
            <Link href={`/r/${r.doc.slug}`}>
              <span className="recipe-name">{r.doc.dish}</span>
              <span className="recipe-meta">
                {r.doc.ingredients.length} ingredients, {r.doc.steps.length} operations
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
