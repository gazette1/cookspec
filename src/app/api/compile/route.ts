import { NextResponse } from "next/server";
import { compile, compileImage, type CompileResult } from "@/lib/pipeline/compile.ts";

export const maxDuration = 120;

// Dev-lifetime memo so repeat compiles of the same input are free until the
// database dedupe lands. Keyed on trimmed input.
const memo = new Map<string, CompileResult>();

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

  if (typeof body.image === "string" && body.image.length > 0) {
    if (body.image.length > 8_000_000) {
      return NextResponse.json({ error: "image too large; keep it under 5 MB" }, { status: 400 });
    }
    try {
      const result = await compileImage(
        {
          base64: body.image,
          mimeType: typeof body.mimeType === "string" ? body.mimeType : "image/jpeg",
          dishHint: typeof body.dishHint === "string" && body.dishHint.trim() ? body.dishHint.trim() : undefined,
        },
        { deepseekKey, geminiKey: process.env.GEMINI_API_KEY },
      );
      return NextResponse.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "compile failed";
      return NextResponse.json({ error: message }, { status: 422 });
    }
  }

  const input = body.input;
  if (typeof input !== "string" || input.trim().length < 4) {
    return NextResponse.json({ error: "paste a link or a recipe" }, { status: 400 });
  }

  const key = input.trim();
  const cached = memo.get(key);
  if (cached) {
    return NextResponse.json({ ...cached, meta: { ...cached.meta, cacheHit: true } });
  }

  try {
    const result = await compile(key, { deepseekKey, geminiKey: process.env.GEMINI_API_KEY });
    memo.set(key, result);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "compile failed";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
