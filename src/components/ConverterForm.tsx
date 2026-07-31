"use client";

import { useRef, useState } from "react";
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
  const [file, setFile] = useState<File | null>(null);
  const [dishHint, setDishHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<RecipeDoc | null>(null);
  const [meta, setMeta] = useState<CompileMeta | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const ready = file !== null || input.trim().length >= 4;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    try {
      let body: Record<string, string>;
      if (file) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
        body = { image: base64, mimeType: file.type || "image/jpeg" };
        if (dishHint.trim()) body.dishHint = dishHint.trim();
      } else {
        body = { input };
      }
      const res = await fetch("/api/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
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
          disabled={busy || file !== null}
        />
        <button type="submit" disabled={busy || !ready}>
          {busy ? "Compiling" : "Compile"}
        </button>
      </form>
      <div className="image-row">
        <label className="image-pick">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file ? `file: ${file.name}` : "or upload a photo, or a screen recording of a Reel"}
        </label>
        {file ? (
          <>
            <input
              type="text"
              className="hint-input"
              value={dishHint}
              onChange={(e) => setDishHint(e.target.value)}
              placeholder="what is this? (optional, helps dish photos)"
              aria-label="dish name hint"
              disabled={busy}
            />
            <button
              type="button"
              className="clear-file"
              disabled={busy}
              onClick={() => {
                setFile(null);
                setDishHint("");
                if (fileRef.current) fileRef.current.value = "";
              }}
            >
              clear
            </button>
          </>
        ) : null}
      </div>
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
            Article links, TikTok, YouTube, pasted text, photos, and uploaded videos compile live
            today; direct Reel links wait on one more integration, so screen-record the Reel and
            upload it meanwhile. The demo card below is the exemplar that started the project,
            including two gram values the unit validator corrected.
          </p>
          <RecipeCard doc={demo} />
        </>
      )}
    </>
  );
}
