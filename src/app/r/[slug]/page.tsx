import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RecipeCard } from "@/components/RecipeCard";
import { getRecipeBySlug } from "@/lib/store.ts";

interface Props {
  params: Promise<{ slug: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const recipe = await getRecipeBySlug(slug);
  if (!recipe) return { title: "Recipe not found | CookSpec" };
  return {
    title: `${recipe.doc.dish} | CookSpec`,
    description: `${recipe.doc.dish} compiled into one engineering table: ${recipe.doc.ingredients.length} ingredients, ${recipe.doc.steps.length} operations.`,
  };
}

export default async function RecipePage({ params }: Props) {
  const { slug } = await params;
  const recipe = await getRecipeBySlug(slug);
  if (!recipe) notFound();

  return (
    <main>
      <nav className="crumbs no-print">
        <Link href="/">CookSpec</Link>
        <span aria-hidden="true"> / </span>
        <Link href="/recipes">library</Link>
      </nav>
      <RecipeCard
        doc={recipe.doc}
        meta={{ sourceLabel: recipe.sourceType, compiledAt: recipe.compiledAt }}
      />
      <p className="license-note no-print">
        {recipe.license ? `${recipe.license}. ` : ""}Compiled by Cookspec.{" "}
        <Link href="/">Paste a link and compile your own.</Link>
      </p>
    </main>
  );
}
