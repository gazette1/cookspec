// Orchestrator: one input string (URL or pasted text) in, RecipeDoc plus run
// metadata out. Platform routing follows the canonicalizer.

import { canonicalizeUrl, canonicalUrlHash, type CanonicalResult } from "../recipe/canonical.ts";
import type { RecipeDoc } from "../recipe/types.ts";
import { fetchArticle } from "./article.ts";
import { extractRecipe, type ExtractionMeta } from "./extract.ts";

export interface CompileResult {
  doc: RecipeDoc;
  meta: ExtractionMeta & {
    sourceType: string;
    canonicalUrl?: string;
    canonicalHash?: string;
    elapsedMs: number;
  };
}

export interface CompileEnv {
  deepseekKey: string;
  geminiKey?: string;
}

function isUrl(input: string): boolean {
  return /^(https?:\/\/|www\.)\S+$/i.test(input.trim());
}

export async function compile(input: string, env: CompileEnv): Promise<CompileResult> {
  const started = Date.now();

  if (!isUrl(input)) {
    const { doc, meta } = await extractRecipe({
      apiKey: env.deepseekKey,
      sourceMaterial: `Convert this recipe:\n\n${input.trim().slice(0, 16000)}`,
    });
    return { doc, meta: { ...meta, sourceType: "text", elapsedMs: Date.now() - started } };
  }

  const canonical = canonicalizeUrl(input);
  switch (canonical.sourceType) {
    case "article":
      return compileArticle(input, canonical, env, started);
    case "tiktok":
    case "reel":
    case "shorts":
    case "youtube":
      throw new Error(`the ${canonical.sourceType} path is not wired yet; article URLs and pasted text work today`);
    default:
      throw new Error(`unsupported source type`);
  }
}

async function compileArticle(
  input: string,
  canonical: CanonicalResult,
  env: CompileEnv,
  started: number,
): Promise<CompileResult> {
  const article = await fetchArticle(input.trim());

  let material: string;
  if (article.kind === "jsonld" && article.recipe) {
    const r = article.recipe;
    material = [
      `Convert this recipe. Structured data from the page:`,
      `Title: ${r.name ?? article.title ?? "unknown"}`,
      r.recipeYield ? `Yield: ${r.recipeYield}` : "",
      `Ingredients:`,
      ...(r.recipeIngredient ?? []).map((i) => `- ${i}`),
      `Instructions:`,
      ...(r.recipeInstructions ?? []).map((s, n) => `${n + 1}. ${s}`),
    ]
      .filter(Boolean)
      .join("\n");
  } else {
    material = `Convert the recipe contained in this page text:\n\nTitle: ${article.title ?? "unknown"}\n\n${article.text ?? ""}`;
  }

  const host = new URL(canonical.canonicalUrl).hostname.replace(/^www\./, "");
  const { doc, meta } = await extractRecipe({
    apiKey: env.deepseekKey,
    sourceMaterial: material,
    source: { url: canonical.canonicalUrl, platform: host, creatorHandle: article.author },
  });

  return {
    doc,
    meta: {
      ...meta,
      sourceType: "article",
      canonicalUrl: canonical.canonicalUrl,
      canonicalHash: await canonicalUrlHash(canonical.canonicalUrl),
      elapsedMs: Date.now() - started,
    },
  };
}
