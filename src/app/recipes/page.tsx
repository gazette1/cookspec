import type { Metadata } from "next";
import Link from "next/link";
import { listPublicRecipes } from "@/lib/store.ts";

// The library. Applying design.md Part 1 section 5.5: a table, not a board.

export const metadata: Metadata = {
  title: "Library | Cookspec",
  description: "Every public recipe on Cookspec, one compiled table each.",
};

export const dynamic = "force-dynamic";

export default async function RecipesPage() {
  const recipes = await listPublicRecipes();

  return (
    <main>
      <nav className="crumbs">
        <Link href="/">Cookspec</Link>
      </nav>
      <h1>Library</h1>
      <p className="tagline">
        {recipes.length} compiled recipes. Paste a link on the front page to add one.
      </p>
      <table className="library-table">
        <thead>
          <tr>
            <th scope="col">Dish</th>
            <th scope="col">Source</th>
            <th scope="col" style={{ textAlign: "right" }}>
              Ingredients
            </th>
            <th scope="col" style={{ textAlign: "right" }}>
              Unresolved
            </th>
            <th scope="col" style={{ textAlign: "right" }}>
              Compiled
            </th>
          </tr>
        </thead>
        <tbody>
          {recipes.map((r) => {
            const unresolved = r.doc.ingredients.filter(
              (i) =>
                i.quantity.provenance === "estimated" ||
                i.quantity.provenance === "fetched" ||
                i.quantity.provenance === "inferred",
            ).length;
            return (
              <tr key={r.slug}>
                <td>
                  <Link href={`/r/${r.slug}`}>{r.doc.dish}</Link>
                </td>
                <td className="num">{r.sourceType ?? "seed"}</td>
                <td className="num">{r.doc.ingredients.length}</td>
                <td className={`num ${unresolved > 0 ? "flagged" : ""}`}>{unresolved}</td>
                <td className="num">{r.compiledAt ?? ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
