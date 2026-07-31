// Article ingestion. Workers-compatible: fetch plus regex, no DOM library.
// Strategy: schema.org Recipe JSON-LD first (most recipe blogs embed it and it
// is far more reliable than prose), readable text fallback second.

export interface ArticleContent {
  kind: "jsonld" | "text";
  title?: string;
  author?: string;
  /** JSON-LD recipe payload when kind is jsonld */
  recipe?: {
    name?: string;
    recipeIngredient?: string[];
    recipeInstructions?: string[];
    recipeYield?: string;
    prepTime?: string;
    cookTime?: string;
  };
  /** Cleaned page text when kind is text */
  text?: string;
}

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[::1\]|.*\.local)$|^172\.(1[6-9]|2\d|3[01])\./i;

export async function fetchArticle(url: string): Promise<ArticleContent> {
  const host = new URL(url).hostname;
  if (PRIVATE_HOST.test(host)) throw new Error("refusing to fetch private or local addresses");
  const res = await fetch(url, {
    headers: { "user-agent": BROWSER_UA, accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`article fetch failed: HTTP ${res.status}`);
  const html = await res.text();

  const jsonld = extractJsonLdRecipe(html);
  if (jsonld) return jsonld;

  return { kind: "text", title: matchTitle(html), text: htmlToText(html) };
}

function matchTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? decodeEntities(m[1].trim()) : undefined;
}

export function extractJsonLdRecipe(html: string): ArticleContent | null {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block[1].trim());
    } catch {
      continue;
    }
    const recipe = findRecipeNode(parsed);
    if (!recipe) continue;

    const instructions = normalizeInstructions(recipe["recipeInstructions"]);
    const ingredients = asStringArray(recipe["recipeIngredient"]);
    if (ingredients.length === 0 || instructions.length === 0) continue;

    return {
      kind: "jsonld",
      title: asString(recipe["name"]),
      author: authorName(recipe["author"]),
      recipe: {
        name: asString(recipe["name"]),
        recipeIngredient: ingredients,
        recipeInstructions: instructions,
        recipeYield: yieldText(recipe["recipeYield"]),
        prepTime: asString(recipe["prepTime"]),
        cookTime: asString(recipe["cookTime"]),
      },
    };
  }
  return null;
}

type JsonObject = Record<string, unknown>;

function findRecipeNode(node: unknown): JsonObject | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipeNode(item);
      if (found) return found;
    }
    return null;
  }
  if (node && typeof node === "object") {
    const obj = node as JsonObject;
    const type = obj["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((t) => typeof t === "string" && t.toLowerCase() === "recipe")) return obj;
    if (obj["@graph"]) return findRecipeNode(obj["@graph"]);
  }
  return null;
}

function normalizeInstructions(value: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (!v) return;
    if (typeof v === "string") {
      const text = decodeEntities(stripTags(v)).trim();
      if (text) out.push(text);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (typeof v === "object") {
      const obj = v as JsonObject;
      if (obj["itemListElement"]) {
        walk(obj["itemListElement"]);
        return;
      }
      if (typeof obj["text"] === "string") {
        walk(obj["text"]);
        return;
      }
      if (typeof obj["name"] === "string") walk(obj["name"]);
    }
  };
  walk(value);
  return out;
}

function authorName(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return authorName(value[0]);
  if (value && typeof value === "object") return asString((value as JsonObject)["name"]);
  return undefined;
}

function yieldText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return yieldText(value[0]);
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? decodeEntities(value).trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string").map((v) => decodeEntities(stripTags(v)).trim());
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

export function htmlToText(html: string): string {
  const withoutBlocks = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, " ");
  const text = decodeEntities(withoutBlocks.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 16000);
}
