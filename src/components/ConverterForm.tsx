"use client";

import { useState } from "react";
import type { RecipeDoc } from "@/lib/recipe/types.ts";
import { RecipeCard } from "./RecipeCard";

interface CompileMeta {
  sourceType: string;
  model: string;
  attempts: number;
  elapsedMs: number;
  cacheHit?: boolean;
  usage: { costUsd: number };
}

export function ConverterForm({ demo }: { demo: RecipeDoc }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<RecipeDoc | null>(null);
  const [meta, setMeta] = useState<CompileMeta | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || input.trim().length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const data = (await res.json()) as { doc?: RecipeDoc; meta?: CompileMeta; error?: string };
      if (!res.ok || !data.doc) {
        setError(data.error ?? `compile failed (HTTP ${res.status})`);
      } else {
        setDoc(data.doc);
        setMeta(data.meta ?? null);
      }
    } catch {
      setError("network error, try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="converter" onSubmit={onSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="https://www.tiktok.com/@creator/video/... or paste the recipe text"
          aria-label="recipe link or text"
          disabled={busy}
        />
        <button type="submit" disabled={busy || input.trim().length < 4}>
          {busy ? "Compiling" : "Compile"}
        </button>
      </form>
      {error ? <p className="compile-error">{error}</p> : null}
      {doc ? (
        <>
          {meta ? (
            <p className="build-note">
              Compiled from {meta.sourceType} in {(meta.elapsedMs / 1000).toFixed(1)}s
              {meta.cacheHit ? ", served from cache" : `, model ${meta.model}, cost $${meta.usage.costUsd.toFixed(4)}`}.
            </p>
          ) : null}
          <RecipeCard doc={doc} />
        </>
      ) : (
        <>
          <p className="build-note">
            Article links and pasted text compile live today; video links are being wired. The demo
            card below is the exemplar that started the project, including two gram values the unit
            validator corrected.
          </p>
          <RecipeCard doc={demo} />
        </>
      )}
    </>
  );
}
