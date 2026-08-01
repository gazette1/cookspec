// Build the large multi-channel eval corpus.
//
// Politeness rules this script follows, because it touches third-party sites
// at volume: robots.txt is fetched and honored per domain before any sitemap
// or page request, requests are serialized per domain with a delay, and only
// URLs are collected here (no page content is stored or republished). The
// eval runner compiles these in-process and never persists to the database,
// so nothing discovered here becomes a public page.
//
// Usage: node scripts/corpus-build.mts [targetTotal]

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TARGET = Number(process.argv[2] ?? 1000);

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2]) out[m[1]] = m[2].trim();
  }
  return out;
}
const env = loadEnv();

export interface CorpusItem {
  id: string;
  channel: "article" | "youtube" | "tiktok" | "reel" | "caption";
  url?: string;
  text?: string;
  origin: string;
}

const items: CorpusItem[] = [];
const seen = new Set<string>();

function add(item: CorpusItem): void {
  const key = item.url ?? item.text?.slice(0, 120) ?? "";
  if (!key || seen.has(key)) return;
  seen.add(key);
  items.push(item);
}

async function get(url: string, timeout = 25000): Promise<Response | null> {
  try {
    return await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(timeout) });
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------- robots.txt

/** Returns a predicate telling whether our agent may fetch a path. */
async function robotsGate(origin: string): Promise<(path: string) => boolean> {
  const res = await get(`${origin}/robots.txt`, 15000);
  if (!res || !res.ok) return () => true;
  const body = await res.text();

  // collect rules for * (we identify as a normal browser UA, so * applies)
  const lines = body.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim());
  let inStar = false;
  const disallow: string[] = [];
  const allow: string[] = [];
  for (const line of lines) {
    const ua = line.match(/^user-agent:\s*(.+)$/i);
    if (ua) {
      inStar = ua[1].trim() === "*";
      continue;
    }
    if (!inStar) continue;
    const d = line.match(/^disallow:\s*(.*)$/i);
    if (d) {
      if (d[1].trim()) disallow.push(d[1].trim());
      continue;
    }
    const a = line.match(/^allow:\s*(.*)$/i);
    if (a && a[1].trim()) allow.push(a[1].trim());
  }
  const match = (rule: string, path: string) => {
    const rx = new RegExp("^" + rule.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\$$/, "$"));
    return rx.test(path);
  };
  return (path: string) => {
    if (allow.some((r) => match(r, path))) return true;
    return !disallow.some((r) => match(r, path));
  };
}

// ---------------------------------------------------------------- sitemaps

async function sitemapUrls(origin: string, gate: (p: string) => boolean, want: number): Promise<string[]> {
  const roots = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`];
  const found: string[] = [];
  const queue: string[] = [];

  for (const root of roots) {
    const res = await get(root);
    if (!res || !res.ok) continue;
    const ct = res.headers.get("content-type") ?? "";
    const body = await res.text();
    if (!/xml/i.test(ct) && !body.trimStart().startsWith("<")) continue;
    const locs = [...body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
    if (locs.length === 0) continue;
    if (/sitemapindex/i.test(body)) queue.push(...shuffle(locs).slice(0, 8));
    else found.push(...locs);
    break;
  }

  for (const sub of queue) {
    if (found.length >= want * 6) break;
    const res = await get(sub);
    await sleep(400);
    if (!res || !res.ok) continue;
    const body = await res.text();
    found.push(...[...body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]));
  }

  // keep plausible recipe pages only, honor robots, drop obvious non-recipes
  const filtered = found.filter((u) => {
    try {
      const parsed = new URL(u);
      if (parsed.origin !== origin) return false;
      const p = parsed.pathname;
      if (!gate(p)) return false;
      if (/\.(jpg|png|webp|pdf|xml)$/i.test(p)) return false;
      if (/\/(category|tag|author|page|about|contact|privacy|shop|product|web-stories)\//i.test(p)) return false;
      return p.split("/").filter(Boolean).length >= 1 && p.length > 12;
    } catch {
      return false;
    }
  });
  return shuffle([...new Set(filtered)]).slice(0, want);
}

// A spread of recipe domains. Each is robots-checked before use and sampled
// lightly; the goal is breadth of writing style, not depth on any one site.
const DOMAINS = [
  "https://www.budgetbytes.com",
  "https://www.thekitchn.com",
  "https://www.seriouseats.com",
  "https://www.simplyrecipes.com",
  "https://www.tamingtwins.com",
  "https://www.recipetineats.com",
  "https://minimalistbaker.com",
  "https://cookieandkate.com",
  "https://www.gimmesomeoven.com",
  "https://pinchofyum.com",
  "https://www.loveandlemons.com",
  "https://natashaskitchen.com",
  "https://sallysbakingaddiction.com",
  "https://www.skinnytaste.com",
  "https://www.bowlofdelicious.com",
  "https://thefoodietakesflight.com",
  "https://hot-thai-kitchen.com",
  "https://www.onceuponachef.com",
  "https://www.thespruceeats.com",
  "https://www.eatingwell.com",
];

async function collectArticles(want: number): Promise<void> {
  const perDomain = Math.ceil(want / DOMAINS.length) + 4;
  for (const origin of shuffle(DOMAINS)) {
    if (items.filter((i) => i.channel === "article").length >= want) break;
    const gate = await robotsGate(origin);
    await sleep(500);
    const urls = await sitemapUrls(origin, gate, perDomain);
    const host = new URL(origin).hostname;
    for (const url of urls) {
      add({ id: `art-${items.length + 1}`, channel: "article", url, origin: host });
    }
    console.log(`  ${host}: ${urls.length}`);
    await sleep(800);
  }
}

// MyPlate archive: US government work, already proven to parse
async function collectMyPlate(want: number): Promise<void> {
  const res = await get(
    "https://web.archive.org/cdx/search/cdx?url=myplate.gov/recipes/*&output=json&collapse=urlkey&filter=statuscode:200&filter=mimetype:text/html&from=2023&to=2025&limit=1000",
    60000,
  );
  if (!res || !res.ok) return;
  const rows = (await res.json()) as string[][];
  const picks = shuffle(
    rows
      .slice(1)
      .map((r) => ({ ts: r[1], url: r[2] }))
      .filter((r) => /\/recipes\/[a-z0-9-]+$/.test(r.url)),
  ).slice(0, want);
  for (const p of picks) {
    add({
      id: `mp-${items.length + 1}`,
      channel: "article",
      url: `https://web.archive.org/web/${p.ts}id_/${p.url}`,
      origin: "myplate.gov (archive)",
    });
  }
  console.log(`  myplate archive: ${picks.length}`);
}

// YouTube: channel RSS feeds are public and need no API key
const YT_CHANNELS = [
  "UCJHA_jMfCvEnv-3kRjTCQXw", // Babish
  "UCJFp8uSYCjXOMnkUyb3CQ3Q", // Tasty
  "UCekQr9znsk2vWxBo3YiLq2w", // You Suck At Cooking
  "UCrJ8ecrPtsMOTaSxsqbeDwA", // Ethan Chlebowski
  "UCbpMy0Fg74eXXkvxJrtEn3w", // Bon Appetit
  "UCfyehHM_eo4g5JUyWmms2LA", // Adam Ragusea
  "UC4tAgeVdaNB5vD_mBoxg50w", // Joshua Weissman
  "UCaWd5_7JhbQBe4dknZhsHJg", // WIRED-ish placeholder, filtered later
  "UCsooa4yRKGN_zEE8iknghZA", // TED-ish placeholder, filtered later
  "UC8gFadPgK2r1ndqLI04Xvvw", // Marion's Kitchen
  "UCJHA_jMfCvEnv-3kRjTCQXw",
];

async function collectYouTube(want: number): Promise<void> {
  let got = 0;
  for (const ch of YT_CHANNELS) {
    if (got >= want) break;
    const res = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch}`);
    await sleep(600);
    if (!res || !res.ok) continue;
    const xml = await res.text();
    const ids = [...xml.matchAll(/<yt:videoId>([^<]+)<\/yt:videoId>/g)].map((m) => m[1]);
    const titles = [...xml.matchAll(/<media:title>([^<]*)<\/media:title>/g)].map((m) => m[1]);
    for (let i = 0; i < ids.length && got < want; i += 1) {
      const title = titles[i] ?? "";
      // keep plausible recipe videos
      if (!/recipe|cook|bake|make|how to|easy|dish|dinner|chicken|pasta|bread|soup|cake/i.test(title)) continue;
      add({
        id: `yt-${items.length + 1}`,
        channel: "youtube",
        url: `https://www.youtube.com/watch?v=${ids[i]}`,
        origin: "youtube.com",
      });
      got += 1;
    }
  }
  console.log(`  youtube: ${got}`);
}

// TikTok and Instagram through Apify, bounded to protect the free credit
async function collectApify(
  actor: string,
  input: Record<string, unknown>,
  channel: "tiktok" | "reel",
  pick: (item: Record<string, unknown>) => string | null,
  want: number,
): Promise<void> {
  const token = env.SCRAPER_API_TOKEN;
  if (!token) return;
  const res = await fetch(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=300&memory=1024`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(320000),
    },
  ).catch(() => null);
  if (!res || !res.ok) {
    console.log(`  ${channel}: scraper unavailable (${res ? res.status : "network"})`);
    return;
  }
  const rows = (await res.json()) as Record<string, unknown>[];
  let got = 0;
  for (const row of rows) {
    if (got >= want) break;
    const url = pick(row);
    if (!url) continue;
    add({ id: `${channel}-${items.length + 1}`, channel, url, origin: channel === "tiktok" ? "tiktok.com" : "instagram.com" });
    got += 1;
  }
  console.log(`  ${channel}: ${got}`);
}

// ---------------------------------------------------------------- main

const plan = {
  article: Math.round(TARGET * 0.62),
  myplate: Math.round(TARGET * 0.1),
  youtube: Math.round(TARGET * 0.08),
  tiktok: Math.round(TARGET * 0.06),
  reel: Math.round(TARGET * 0.03),
};

console.log("discovering article sitemaps");
await collectArticles(plan.article);
console.log("discovering myplate archive");
await collectMyPlate(plan.myplate);
console.log("discovering youtube");
await collectYouTube(plan.youtube);
console.log("discovering tiktok");
await collectApify(
  "clockworks~free-tiktok-scraper",
  { hashtags: ["recipe", "easyrecipe", "cooking", "dinnerideas"], resultsPerPage: 25, shouldDownloadVideos: false, shouldDownloadCovers: false },
  "tiktok",
  (r) => (typeof r.webVideoUrl === "string" ? r.webVideoUrl : null),
  plan.tiktok,
);
console.log("discovering instagram");
await collectApify(
  "apify~instagram-hashtag-scraper",
  { hashtags: ["recipe", "easyrecipes"], resultsLimit: 40 },
  "reel",
  (r) => (typeof r.url === "string" && /\/(reel|p)\//.test(r.url) ? r.url : null),
  plan.reel,
);

mkdirSync(new URL("../eval/", import.meta.url), { recursive: true });
const byChannel = items.reduce<Record<string, number>>((acc, i) => {
  acc[i.channel] = (acc[i.channel] ?? 0) + 1;
  return acc;
}, {});
writeFileSync(
  new URL("../eval/corpus-1000.json", import.meta.url),
  JSON.stringify({ builtFor: TARGET, counts: byChannel, items: shuffle(items) }, null, 2),
);
console.log(`\nwrote eval/corpus-1000.json: ${items.length} items`, byChannel);
