import { NextResponse } from "next/server";
import { compile, compileImage, compileVideoFile, type CompileResult } from "@/lib/pipeline/compile.ts";
import { canonicalizeUrl, canonicalUrlHash } from "@/lib/recipe/canonical.ts";
import { findByCanonicalHash, logConversion, persistRecipe } from "@/lib/store.ts";

export const maxDuration = 120;

async function textHash(prefix: string, value: string): Promise<string> {
  const data = new TextEncoder().encode(`${prefix}:${value}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: { input?: unknown; image?: unknown; mimeType?: unknown; dishHint?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (!deepseekKey) {
    return NextResponse.json({ error: "server is missing DEEPSEEK_API_KEY" }, { status: 500 });
  }
  const env = { deepseekKey, geminiKey: process.env.GEMINI_API_KEY };

  try {
    let dedupeHash: string;
    let run: () => Promise<CompileResult>;

    if (typeof body.image === "string" && body.image.length > 0) {
      const mimeType = typeof body.mimeType === "string" ? body.mimeType : "image/jpeg";
      const isVideo = mimeType.startsWith("video/");
      if (body.image.length > (isVideo ? 26_000_000 : 8_000_000)) {
        return NextResponse.json(
          { error: isVideo ? "video too large; keep it under 18 MB" : "image too large; keep it under 5 MB" },
          { status: 400 },
        );
      }
      const base64 = body.image;
      const dishHint =
        typeof body.dishHint === "string" && body.dishHint.trim() ? body.dishHint.trim() : undefined;
      dedupeHash = await textHash(isVideo ? "video" : "image", base64);
      run = () =>
        isVideo ? compileVideoFile({ base64, mimeType }, env) : compileImage({ base64, mimeType, dishHint }, env);
    } else {
      const input = body.input;
      if (typeof input !== "string" || input.trim().length < 4) {
        return NextResponse.json({ error: "paste a link or a recipe" }, { status: 400 });
      }
      const trimmed = input.trim();
      dedupeHash = /^(https?:\/\/|www\.)\S+$/i.test(trimmed)
        ? await canonicalUrlHash(canonicalizeUrl(trimmed).canonicalUrl)
        : await textHash("text", trimmed);
      run = () => compile(trimmed, env);
    }

    const cached = await findByCanonicalHash(dedupeHash);
    if (cached) {
      void logConversion({ recipeSlug: cached.slug, cacheHit: true });
      return NextResponse.json({
        doc: cached.doc,
        meta: { sourceType: cached.sourceType ?? "cache", model: "cache", attempts: 0, usage: { costUsd: 0 }, elapsedMs: 0, cacheHit: true },
        publicUrl: `/r/${cached.slug}`,
      });
    }

    const result = await run();
    // persist under the pre-compile hash; short links also register their
    // resolved canonical hash through the row's canonical_url_hash
    const persistHash = result.meta.canonicalHash ?? dedupeHash;
    let publicUrl: string | undefined;
    try {
      const persisted = await persistRecipe({
        doc: result.doc,
        canonicalHash: persistHash,
        canonicalUrl: result.meta.canonicalUrl,
        sourceType: result.meta.sourceType,
      });
      if (persisted) publicUrl = `/r/${persisted.slug}`;
    } catch {
      // persistence is best-effort; the compile still succeeded
    }
    void logConversion({ cacheHit: false, costUsd: result.meta.usage.costUsd });
    return NextResponse.json({ ...result, publicUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : "compile failed";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
