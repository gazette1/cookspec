"use client";

// The paste bar. Applying design.md Part 1 section 4.1: one field that detects
// the type, a quiet sources line, no tabs, no account gate.

import { useRef, useState } from "react";
import type { RecipeDoc } from "@/lib/recipe/types.ts";
import { RecipeCard, type CardMeta } from "./RecipeCard";

interface CompileMeta {
  sourceType: string;
  model: string;
  attempts: number;
  elapsedMs: number;
  cacheHit?: boolean;
  usage: { costUsd: number };
}

export function ConverterForm({ demo, demoMeta }: { demo: RecipeDoc; demoMeta?: CardMeta }) {
  const [input, setInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dishHint, setDishHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<RecipeDoc | null>(null);
  const [meta, setMeta] = useState<CompileMeta | null>(null);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
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
      const data = (await res.json()) as {
        doc?: RecipeDoc;
        meta?: CompileMeta;
        publicUrl?: string;
        error?: string;
      };
      if (!res.ok || !data.doc) {
        setError(data.error ?? `compile failed with HTTP ${res.status}; try the link again or paste the text`);
      } else {
        setDoc(data.doc);
        setMeta(data.meta ?? null);
        setPublicUrl(data.publicUrl ?? null);
      }
    } catch {
      setError("network failed; check the connection and compile again");
    } finally {
      setBusy(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const dropped = e.dataTransfer.files?.[0];
    if (dropped && /^(image|video)\//.test(dropped.type)) setFile(dropped);
  }

  return (
    <>
      <form className="converter" onSubmit={onSubmit} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="paste a link, text, or drop a photo"
          aria-label="recipe link or text"
          disabled={busy || file !== null}
        />
        <button type="submit" disabled={busy || !ready}>
          {busy ? "Compiling" : "Compile"}
        </button>
      </form>
      <div className="image-row no-print">
        <label className="image-pick">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file ? `file: ${file.name}` : "or choose a photo or screen recording"}
        </label>
        {file ? (
          <>
            <input
              type="text"
              className="hint-input"
              value={dishHint}
              onChange={(e) => setDishHint(e.target.value)}
              placeholder="what dish is this, if the photo has no text"
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
      <p className="sources-line">tiktok · reel · short · article · text · photo · video</p>
      {error ? <p className="compile-error">{error}</p> : null}
      {doc ? (
        <>
          {meta ? (
            <p className="build-note">
              {meta.cacheHit
                ? "Compiled. Served from the library."
                : `Compiled from ${meta.sourceType} in ${(meta.elapsedMs / 1000).toFixed(1)}s at $${meta.usage.costUsd.toFixed(4)}.`}
              {publicUrl ? (
                <>
                  {" "}
                  <a href={publicUrl}>Permanent page</a>
                </>
              ) : null}
            </p>
          ) : null}
          <RecipeCard doc={doc} meta={meta ? { sourceLabel: meta.sourceType } : undefined} />
        </>
      ) : (
        <RecipeCard doc={demo} meta={demoMeta} />
      )}
    </>
  );
}
