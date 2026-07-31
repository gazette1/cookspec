// URL canonicalization for the dedupe cache. Two different shares of the same
// viral video must land on the same canonical URL, and therefore the same
// hash, or we pay for the pipeline twice. Short links (tiktok.com/t/...)
// cannot be canonicalized offline; they are flagged needsResolution and get
// expanded server-side at fetch time, then re-canonicalized.

export type SourceType = "tiktok" | "reel" | "shorts" | "youtube" | "article";

export interface CanonicalResult {
  sourceType: SourceType;
  canonicalUrl: string;
  needsResolution: boolean;
}

const TRACKING_PARAMS = new Set(["igsh", "is", "si", "fbclid", "gclid", "mc_cid", "mc_eid", "ref"]);

export function canonicalizeUrl(raw: string): CanonicalResult {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "");

  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    const short = path.match(/^\/t\/([A-Za-z0-9]+)$/);
    if (short) {
      return {
        sourceType: "tiktok",
        canonicalUrl: `https://www.tiktok.com/t/${short[1]}`,
        needsResolution: true,
      };
    }
    const video = path.match(/^\/(@[^/]+)\/video\/(\d+)$/);
    if (video) {
      return {
        sourceType: "tiktok",
        canonicalUrl: `https://www.tiktok.com/${video[1]}/video/${video[2]}`,
        needsResolution: false,
      };
    }
    return { sourceType: "tiktok", canonicalUrl: `https://www.tiktok.com${path}`, needsResolution: true };
  }

  if (host === "instagram.com" || host.endsWith(".instagram.com")) {
    const post = path.match(/^\/(reels?|p)\/([A-Za-z0-9_-]+)/);
    if (post) {
      return {
        sourceType: "reel",
        canonicalUrl: `https://www.instagram.com/reel/${post[2]}/`,
        needsResolution: false,
      };
    }
    return { sourceType: "reel", canonicalUrl: `https://www.instagram.com${path}`, needsResolution: true };
  }

  if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") {
    if (host === "youtu.be") {
      const id = path.replace(/^\//, "");
      return {
        sourceType: "youtube",
        canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
        needsResolution: false,
      };
    }
    const shorts = path.match(/^\/shorts\/([A-Za-z0-9_-]+)$/);
    if (shorts) {
      return {
        sourceType: "shorts",
        canonicalUrl: `https://www.youtube.com/shorts/${shorts[1]}`,
        needsResolution: false,
      };
    }
    const v = url.searchParams.get("v");
    if (path === "/watch" && v) {
      return {
        sourceType: "youtube",
        canonicalUrl: `https://www.youtube.com/watch?v=${v}`,
        needsResolution: false,
      };
    }
    return { sourceType: "youtube", canonicalUrl: `https://www.youtube.com${path}`, needsResolution: true };
  }

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key) || key.startsWith("utm_")) url.searchParams.delete(key);
  }
  const query = url.searchParams.toString();
  return {
    sourceType: "article",
    canonicalUrl: `https://${host}${path}${query ? `?${query}` : ""}`,
    needsResolution: false,
  };
}

export async function canonicalUrlHash(canonicalUrl: string): Promise<string> {
  const data = new TextEncoder().encode(canonicalUrl);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
