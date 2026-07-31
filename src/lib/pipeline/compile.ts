// Orchestrator: one input string (URL or pasted text) in, RecipeDoc plus run
// metadata out. Platform routing follows the canonicalizer.

import { canonicalizeUrl, canonicalUrlHash, type CanonicalResult } from "../recipe/canonical.ts";
import type { RecipeDoc } from "../recipe/types.ts";
import { BROWSER_UA, fetchArticle } from "./article.ts";
import { extractRecipe, type ExtractionMeta } from "./extract.ts";
import { geminiGenerate } from "./llm.ts";

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
    case "shorts":
    case "youtube":
      return compileYouTube(canonical, env, started);
    case "tiktok":
      return compileTikTok(canonical, env, started);
    case "reel":
      throw new Error(`the reel path is not wired yet; article URLs, TikTok, YouTube, and pasted text work today`);
    default:
      throw new Error(`unsupported source type`);
  }
}

// Image upload: recipe screenshots, cookbook pages, or plated-dish photos.
// Gemini reports whether the image contains recipe text or only a dish; dish
// photos produce a generated recipe flagged inferred, keyed to the user's
// name-the-dish hint when given.
export async function compileImage(
  image: { base64: string; mimeType: string; dishHint?: string },
  env: CompileEnv,
): Promise<CompileResult> {
  const started = Date.now();
  if (!env.geminiKey) throw new Error("server is missing GEMINI_API_KEY for image sources");

  const look = await geminiGenerate({
    apiKey: env.geminiKey,
    parts: [
      { inlineData: { mimeType: image.mimeType, data: image.base64 } },
      {
        text: `Look at this image.${image.dishHint ? ` The user says it shows: ${image.dishHint}.` : ""}\n\nIf it contains recipe text (a screenshot, cookbook page, or app screen), start your reply with RECIPE_TEXT on its own line, then transcribe the recipe faithfully and completely: dish, every ingredient with its stated quantity, and the instructions in order. Mark anything unreadable "not stated".\n\nIf it shows only prepared food with no recipe text, start your reply with DISH_PHOTO on its own line, name the dish${image.dishHint ? " (trust the user's name unless the photo clearly contradicts it)" : ""}, then write a standard recipe for it: typical ingredients with typical quantities and the usual operations in order.`,
      },
    ],
  });

  const isDishPhoto = /^\s*DISH_PHOTO/m.test(look.content.slice(0, 200));
  const material = look.content.replace(/^\s*(RECIPE_TEXT|DISH_PHOTO)\s*/m, "").slice(0, 16000);

  const { doc, meta } = await extractRecipe({
    apiKey: env.deepseekKey,
    sourceMaterial: isDishPhoto
      ? `Convert this generated standard recipe (from a dish photo, quantities are typical values):\n\n${material}`
      : `Convert this recipe transcribed from an image:\n\n${material}`,
    inferred: isDishPhoto,
  });

  return {
    doc,
    meta: {
      ...meta,
      model: `${look.model} + ${meta.model}`,
      usage: {
        inputTokens: meta.usage.inputTokens + look.usage.inputTokens,
        outputTokens: meta.usage.outputTokens + look.usage.outputTokens,
        costUsd: meta.usage.costUsd + look.usage.costUsd,
      },
      sourceType: isDishPhoto ? "dish_photo" : "image",
      elapsedMs: Date.now() - started,
    },
  };
}

// Screen-recording upload: the Reels fallback until the scraper vendor lands,
// and a general path for any saved cooking video. Gemini watches the clip the
// same way it watches a YouTube URL.
export async function compileVideoFile(
  video: { base64: string; mimeType: string },
  env: CompileEnv,
): Promise<CompileResult> {
  const started = Date.now();
  if (!env.geminiKey) throw new Error("server is missing GEMINI_API_KEY for video sources");

  const watch = await geminiGenerate({
    apiKey: env.geminiKey,
    parts: [
      { inlineData: { mimeType: video.mimeType, data: video.base64 } },
      {
        text: "Watch this cooking video. Report exactly what it teaches, as text: the dish name, every ingredient with its quantity as spoken or shown on screen (write 'not stated' when the video gives none), and the operations in order with times, temperatures, and which ingredients each operation combines. Include any on-screen text. Do not invent quantities.",
      },
    ],
  });

  const { doc, meta } = await extractRecipe({
    apiKey: env.deepseekKey,
    sourceMaterial: `Convert this recipe transcribed from an uploaded cooking video:\n\n${watch.content.slice(0, 16000)}`,
    source: { platform: "upload" },
  });

  return {
    doc,
    meta: {
      ...meta,
      model: `${watch.model} + ${meta.model}`,
      usage: {
        inputTokens: meta.usage.inputTokens + watch.usage.inputTokens,
        outputTokens: meta.usage.outputTokens + watch.usage.outputTokens,
        costUsd: meta.usage.costUsd + watch.usage.costUsd,
      },
      sourceType: "video_upload",
      elapsedMs: Date.now() - started,
    },
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// TikTok without a scraper vendor: resolve the share link, read the public
// oEmbed caption and thumbnail, and let Gemini reason over both. Honest about
// its limits: when the caption does not carry the recipe, the card is flagged
// inferred. The full-video path arrives with the scraper vendor.
async function compileTikTok(canonical: CanonicalResult, env: CompileEnv, started: number): Promise<CompileResult> {
  if (!env.geminiKey) throw new Error("server is missing GEMINI_API_KEY for video sources");

  let videoUrl = canonical.canonicalUrl;
  if (canonical.needsResolution) {
    const res = await fetch(videoUrl, { redirect: "follow", headers: { "user-agent": BROWSER_UA } });
    const resolved = canonicalizeUrl(res.url);
    if (resolved.needsResolution) throw new Error("could not resolve this TikTok share link");
    videoUrl = resolved.canonicalUrl;
  }

  const oembedRes = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`, {
    headers: { "user-agent": BROWSER_UA },
  });
  if (!oembedRes.ok) {
    throw new Error("could not read this TikTok's public data; the full-video path needs the scraper vendor");
  }
  const oembed = (await oembedRes.json()) as {
    title?: string;
    author_name?: string;
    author_unique_id?: string;
    thumbnail_url?: string;
  };
  const caption = oembed.title ?? "";
  const author = oembed.author_unique_id ? `@${oembed.author_unique_id}` : oembed.author_name;

  const parts: Parameters<typeof geminiGenerate>[0]["parts"] = [];
  if (oembed.thumbnail_url) {
    const img = await fetch(oembed.thumbnail_url, { headers: { "user-agent": BROWSER_UA } });
    if (img.ok) {
      const bytes = new Uint8Array(await img.arrayBuffer());
      parts.push({
        inlineData: { mimeType: img.headers.get("content-type") ?? "image/jpeg", data: bytesToBase64(bytes) },
      });
    }
  }
  parts.push({
    text: `TikTok cooking video caption from ${author ?? "the creator"}: "${caption}".\n\nFrom this caption and the attached thumbnail, report the recipe as text: the dish, the ingredients with quantities where the caption states them, and the likely operations in order. If the caption contains the full recipe, restate it faithfully and completely. For anything the caption does not state, mark it "not stated". Do not invent quantities.`,
  });

  const watch = await geminiGenerate({ apiKey: env.geminiKey, parts });

  // Captions with almost no stated amounts mean the card is a labeled guess.
  const statedAmounts = (caption.match(/\d+\s*(g|kg|ml|l|cup|cups|tbsp|tsp|oz|lb|cloves?)\b/gi) ?? []).length;
  const inferred = statedAmounts < 3;

  const { doc, meta } = await extractRecipe({
    apiKey: env.deepseekKey,
    sourceMaterial: `Convert this recipe reconstructed from a TikTok caption and thumbnail:\n\n${watch.content.slice(0, 16000)}`,
    source: { url: videoUrl, platform: "tiktok.com", creatorHandle: author ?? undefined },
    inferred,
  });

  return {
    doc,
    meta: {
      ...meta,
      model: `${watch.model} + ${meta.model}`,
      usage: {
        inputTokens: meta.usage.inputTokens + watch.usage.inputTokens,
        outputTokens: meta.usage.outputTokens + watch.usage.outputTokens,
        costUsd: meta.usage.costUsd + watch.usage.costUsd,
      },
      sourceType: "tiktok",
      canonicalUrl: videoUrl,
      canonicalHash: await canonicalUrlHash(videoUrl),
      elapsedMs: Date.now() - started,
    },
  };
}

// YouTube: Gemini watches the video directly (no scraper needed), produces a
// faithful transcription of the recipe, and DeepSeek structures it. Model
// routing keeps the cheap structurer and its tested prompt for every source.
async function compileYouTube(canonical: CanonicalResult, env: CompileEnv, started: number): Promise<CompileResult> {
  if (!env.geminiKey) throw new Error("server is missing GEMINI_API_KEY for video sources");

  const watch = await geminiGenerate({
    apiKey: env.geminiKey,
    parts: [
      { fileData: { fileUri: canonical.canonicalUrl } },
      {
        text: "Watch this cooking video. Report exactly what it teaches, as text: the dish name, every ingredient with its quantity as spoken or shown on screen (write 'not stated' when the video gives none), and the operations in order with times, temperatures, and which ingredients each operation combines. Include any on-screen text. Do not invent quantities.",
      },
    ],
  });

  const { doc, meta } = await extractRecipe({
    apiKey: env.deepseekKey,
    sourceMaterial: `Convert this recipe transcribed from a cooking video:\n\n${watch.content.slice(0, 16000)}`,
    source: { url: canonical.canonicalUrl, platform: "youtube.com" },
  });

  return {
    doc,
    meta: {
      ...meta,
      model: `${watch.model} + ${meta.model}`,
      usage: {
        inputTokens: meta.usage.inputTokens + watch.usage.inputTokens,
        outputTokens: meta.usage.outputTokens + watch.usage.outputTokens,
        costUsd: meta.usage.costUsd + watch.usage.costUsd,
      },
      sourceType: canonical.sourceType,
      canonicalUrl: canonical.canonicalUrl,
      canonicalHash: await canonicalUrlHash(canonical.canonicalUrl),
      elapsedMs: Date.now() - started,
    },
  };
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
