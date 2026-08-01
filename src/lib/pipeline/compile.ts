// Orchestrator: one input (URL, text, image, or video file) in, RecipeDoc
// plus run metadata out. Media paths are single-call by default (Gemini sees
// the media and emits the structured JSON directly), with a two-step
// watch-then-structure fallback when validation rejects both fast attempts.

import { canonicalizeUrl, canonicalUrlHash, type CanonicalResult } from "../recipe/canonical.ts";
import type { RecipeDoc, RecipeSource } from "../recipe/types.ts";
import { BROWSER_UA, fetchArticle } from "./article.ts";
import { extractRecipe, finalizeExtraction, STRUCTURING_RULES, type ExtractionMeta } from "./extract.ts";
import { geminiGenerate, type GeminiPart, type LlmUsage } from "./llm.ts";

export interface CompileResult {
  doc: RecipeDoc;
  meta: ExtractionMeta & {
    sourceType: string;
    canonicalUrl?: string;
    canonicalHash?: string;
    elapsedMs: number;
    /** The text the structurer actually saw. Present for text-bearing sources
     *  (article, pasted text); absent for media, where there is no
     *  intermediate text. Used by the eval judge to grade fidelity. */
    sourceExcerpt?: string;
    /** Ingredient lines from schema.org data, when the page carried it */
    groundTruthIngredients?: string[];
  };
}

export interface CompileEnv {
  deepseekKey: string;
  geminiKey?: string;
  apifyToken?: string;
}

function isUrl(input: string): boolean {
  return /^(https?:\/\/|www\.)\S+$/i.test(input.trim());
}

export async function compile(input: string, env: CompileEnv): Promise<CompileResult> {
  const started = Date.now();

  if (!isUrl(input)) {
    const material = input.trim().slice(0, 16000);
    const { doc, meta } = await extractRecipe({
      apiKey: env.deepseekKey,
      fastGeminiKey: env.geminiKey,
      sourceMaterial: `Convert this recipe:\n\n${material}`,
    });
    return {
      doc,
      meta: { ...meta, sourceType: "text", elapsedMs: Date.now() - started, sourceExcerpt: material },
    };
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
      return compileReel(canonical, env, started);
    default:
      throw new Error("unsupported source type");
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
    fastGeminiKey: env.geminiKey,
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
      sourceExcerpt: material.slice(0, 12000),
      groundTruthIngredients: article.kind === "jsonld" ? article.recipe?.recipeIngredient : undefined,
    },
  };
}

interface MediaExtractOpts {
  env: CompileEnv;
  /** Media parts (video fileData, image or video inlineData, thumbnails) */
  parts: GeminiPart[];
  /** Path-specific preamble prepended to the structuring rules */
  contextText: string;
  /** Prose watch prompt for the two-step fallback */
  fallbackWatchText: string;
  source?: RecipeSource;
  inferred?: boolean;
  sourceType: string | ((doc: RecipeDoc) => string);
  canonicalUrl?: string;
  canonicalHash?: string;
  started: number;
}

// Single Gemini call: media in, structured recipe JSON out. Two fast
// attempts, then the reliable two-step fallback (Gemini transcribes, DeepSeek
// structures). Validation gates every road.
async function mediaExtract(o: MediaExtractOpts): Promise<CompileResult> {
  if (!o.env.geminiKey) throw new Error("server is missing GEMINI_API_KEY for media sources");

  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const modelsUsed: string[] = [];
  const singlePrompt = `${o.contextText}\n\n${STRUCTURING_RULES}\n\nOutput only the JSON object.`;
  let promptText = singlePrompt;
  let lastError = "";

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const res = await geminiGenerate({
      apiKey: o.env.geminiKey,
      jsonOutput: true,
      parts: [...o.parts, { text: promptText }],
    });
    if (!modelsUsed.includes(res.model)) modelsUsed.push(res.model);
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    usage.costUsd += res.usage.costUsd;
    try {
      const doc = finalizeExtraction(res.content, { source: o.source, inferred: o.inferred });
      return makeMediaResult(o, doc, modelsUsed, attempt, usage);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      promptText = `${singlePrompt}\n\nYour previous JSON failed validation: ${lastError}. Output the full corrected JSON.`;
    }
  }

  const watch = await geminiGenerate({ apiKey: o.env.geminiKey, parts: [...o.parts, { text: o.fallbackWatchText }] });
  if (!modelsUsed.includes(watch.model)) modelsUsed.push(watch.model);
  usage.inputTokens += watch.usage.inputTokens;
  usage.outputTokens += watch.usage.outputTokens;
  usage.costUsd += watch.usage.costUsd;

  const { doc, meta } = await extractRecipe({
    apiKey: o.env.deepseekKey,
    sourceMaterial: `Convert this recipe transcribed from the source:\n\n${watch.content.slice(0, 16000)}`,
    source: o.source,
    inferred: o.inferred,
  });
  for (const m of meta.model.split(" + ")) if (!modelsUsed.includes(m)) modelsUsed.push(m);
  usage.inputTokens += meta.usage.inputTokens;
  usage.outputTokens += meta.usage.outputTokens;
  usage.costUsd += meta.usage.costUsd;

  return makeMediaResult(o, doc, modelsUsed, 2 + meta.attempts, usage);
}

function makeMediaResult(
  o: MediaExtractOpts,
  doc: RecipeDoc,
  modelsUsed: string[],
  attempts: number,
  usage: LlmUsage,
): CompileResult {
  return {
    doc,
    meta: {
      model: modelsUsed.join(" + "),
      attempts,
      usage,
      sourceType: typeof o.sourceType === "function" ? o.sourceType(doc) : o.sourceType,
      canonicalUrl: o.canonicalUrl,
      canonicalHash: o.canonicalHash,
      elapsedMs: Date.now() - o.started,
    },
  };
}

const VIDEO_WATCH_TEXT =
  "Watch this cooking video. Report exactly what it teaches, as text: the dish name, every ingredient with its quantity as spoken or shown on screen (write 'not stated' when the video gives none), and the operations in order with times, temperatures, and which ingredients each operation combines. Include any on-screen text. Do not invent quantities.";

const VIDEO_CONTEXT =
  "You are watching a cooking video. Extract the recipe it actually teaches: quantities as spoken or shown on screen, operations with their times and temperatures. Where the video states no quantity, use your typical value and set estimated true on that qty.";

async function compileYouTube(canonical: CanonicalResult, env: CompileEnv, started: number): Promise<CompileResult> {
  return mediaExtract({
    env,
    parts: [{ fileData: { fileUri: canonical.canonicalUrl } }],
    contextText: VIDEO_CONTEXT,
    fallbackWatchText: VIDEO_WATCH_TEXT,
    source: { url: canonical.canonicalUrl, platform: "youtube.com" },
    sourceType: canonical.sourceType,
    canonicalUrl: canonical.canonicalUrl,
    canonicalHash: await canonicalUrlHash(canonical.canonicalUrl),
    started,
  });
}

export async function compileVideoFile(
  video: { base64: string; mimeType: string },
  env: CompileEnv,
): Promise<CompileResult> {
  return mediaExtract({
    env,
    parts: [{ inlineData: { mimeType: video.mimeType, data: video.base64 } }],
    contextText: VIDEO_CONTEXT,
    fallbackWatchText: VIDEO_WATCH_TEXT,
    source: { platform: "upload" },
    sourceType: "video_upload",
    started: Date.now(),
  });
}

export async function compileImage(
  image: { base64: string; mimeType: string; dishHint?: string },
  env: CompileEnv,
): Promise<CompileResult> {
  const hint = image.dishHint ? ` The user says it shows: ${image.dishHint}.` : "";
  return mediaExtract({
    env,
    parts: [{ inlineData: { mimeType: image.mimeType, data: image.base64 } }],
    contextText: `Look at this image.${hint} If it contains recipe text (a screenshot, cookbook page, or app screen), extract that recipe faithfully. If it shows only prepared food with no recipe text, name the dish${image.dishHint ? " (trust the user's name unless the photo clearly contradicts it)" : ""}, generate a standard recipe for it with typical quantities marked estimated, and set the top-level JSON key inferredGuess to true.`,
    fallbackWatchText: `Look at this image.${hint} If it contains recipe text, transcribe the recipe faithfully and completely: dish, every ingredient with its stated quantity, the instructions in order. If it shows only prepared food, name the dish and write a standard recipe for it with typical quantities.`,
    sourceType: (doc) => (doc.inferred ? "dish_photo" : "image"),
    started: Date.now(),
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Instagram Reels through the Apify scraper: pull caption, thumbnail, and
// where possible the video itself, then extract like any other media. With
// the full video in hand the card is a real extraction, not an inferred guess.
async function compileReel(canonical: CanonicalResult, env: CompileEnv, started: number): Promise<CompileResult> {
  if (!env.apifyToken) {
    throw new Error("Instagram needs the scraper token; screen-record the Reel and upload it meanwhile");
  }
  if (!env.geminiKey) throw new Error("server is missing GEMINI_API_KEY for video sources");

  const runRes = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${encodeURIComponent(env.apifyToken)}&timeout=120&memory=1024`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        directUrls: [canonical.canonicalUrl],
        resultsType: "posts",
        resultsLimit: 1,
        addParentData: false,
      }),
    },
  );
  if (!runRes.ok) {
    throw new Error(`Instagram scraper failed: HTTP ${runRes.status} ${(await runRes.text()).slice(0, 160)}`);
  }
  const items = (await runRes.json()) as {
    caption?: string;
    ownerUsername?: string;
    videoUrl?: string;
    displayUrl?: string;
  }[];
  const post = items[0];
  if (!post) throw new Error("the scraper returned nothing for this Reel; it may be private");

  const caption = post.caption ?? "";
  const author = post.ownerUsername ? `@${post.ownerUsername}` : undefined;

  const parts: GeminiPart[] = [];
  let haveVideo = false;
  if (post.videoUrl) {
    try {
      const vid = await fetch(post.videoUrl, { headers: { "user-agent": BROWSER_UA } });
      if (vid.ok) {
        const bytes = new Uint8Array(await vid.arrayBuffer());
        if (bytes.byteLength > 0 && bytes.byteLength <= 19_000_000) {
          parts.push({
            inlineData: { mimeType: vid.headers.get("content-type") ?? "video/mp4", data: bytesToBase64(bytes) },
          });
          haveVideo = true;
        }
      }
    } catch {
      // fall through to thumbnail
    }
  }
  if (!haveVideo && post.displayUrl) {
    const img = await fetch(post.displayUrl, { headers: { "user-agent": BROWSER_UA } });
    if (img.ok) {
      const bytes = new Uint8Array(await img.arrayBuffer());
      parts.push({
        inlineData: { mimeType: img.headers.get("content-type") ?? "image/jpeg", data: bytesToBase64(bytes) },
      });
    }
  }

  const statedAmounts = (caption.match(/\d+\s*(g|kg|ml|l|cup|cups|tbsp|tsp|oz|lb|cloves?)\b/gi) ?? []).length;
  const inferred = !haveVideo && statedAmounts < 3;

  const captionBlock = caption ? ` The creator's caption: "${caption.slice(0, 3000)}".` : "";
  return mediaExtract({
    env,
    parts,
    contextText: haveVideo
      ? `${VIDEO_CONTEXT}${captionBlock}`
      : `Instagram Reel from ${author ?? "the creator"}.${captionBlock} Reconstruct the recipe from the caption and the attached thumbnail. If the caption contains the full recipe, restate it faithfully and completely. Use typical values with estimated true for anything not stated.`,
    fallbackWatchText: haveVideo
      ? VIDEO_WATCH_TEXT
      : `Instagram Reel from ${author ?? "the creator"}.${captionBlock} Report the recipe as text: dish, ingredients with stated quantities, likely operations in order. Mark anything not stated.`,
    source: { url: canonical.canonicalUrl, platform: "instagram.com", creatorHandle: author },
    inferred,
    sourceType: "reel",
    canonicalUrl: canonical.canonicalUrl,
    canonicalHash: await canonicalUrlHash(canonical.canonicalUrl),
    started,
  });
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

  const parts: GeminiPart[] = [];
  if (oembed.thumbnail_url) {
    const img = await fetch(oembed.thumbnail_url, { headers: { "user-agent": BROWSER_UA } });
    if (img.ok) {
      const bytes = new Uint8Array(await img.arrayBuffer());
      parts.push({
        inlineData: { mimeType: img.headers.get("content-type") ?? "image/jpeg", data: bytesToBase64(bytes) },
      });
    }
  }

  // Captions with almost no stated amounts mean the card is a labeled guess.
  const statedAmounts = (caption.match(/\d+\s*(g|kg|ml|l|cup|cups|tbsp|tsp|oz|lb|cloves?)\b/gi) ?? []).length;
  const inferred = statedAmounts < 3;

  return mediaExtract({
    env,
    parts,
    contextText: `TikTok cooking video caption from ${author ?? "the creator"}: "${caption}". Reconstruct the recipe from this caption and the attached thumbnail. If the caption contains the full recipe, restate it faithfully and completely. Use typical values with estimated true for anything the caption does not state.`,
    fallbackWatchText: `TikTok cooking video caption from ${author ?? "the creator"}: "${caption}".\n\nFrom this caption and the attached thumbnail, report the recipe as text: the dish, the ingredients with quantities where the caption states them, and the likely operations in order. For anything the caption does not state, mark it "not stated". Do not invent quantities.`,
    source: { url: videoUrl, platform: "tiktok.com", creatorHandle: author ?? undefined },
    inferred,
    sourceType: "tiktok",
    canonicalUrl: videoUrl,
    canonicalHash: await canonicalUrlHash(videoUrl),
    started,
  });
}
