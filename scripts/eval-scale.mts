// Scale eval runner. Compiles every corpus item through the real pipeline,
// grades it deterministically, and optionally has an independent judge score
// it. Results stream to JSONL so a crash or a stop loses nothing and the run
// resumes where it left off.
//
// This calls compile() in process. It does not touch the API route, so
// nothing evaluated here is persisted to the database or published.
//
// Usage:
//   node scripts/eval-scale.mts --tag baseline --limit 1000 --concurrency 6 --judge
//   node scripts/eval-scale.mts --tag baseline            (resumes)

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { compile } from "../src/lib/pipeline/compile.ts";
import { gradeCard, type CardGrade } from "../src/lib/eval/grade.ts";
import { judgeCard, type JudgeVerdict } from "../src/lib/eval/judge.ts";

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2]) out[m[1]] = m[2].trim();
  }
  return out;
}
const env = loadEnv();

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const TAG = arg("tag", "baseline") as string;
const LIMIT = Number(arg("limit", "1000"));
const CONCURRENCY = Number(arg("concurrency", "6"));
const MAX_COST = Number(arg("max-cost", "12"));
const USE_JUDGE = has("judge");
// The judge is an order of magnitude slower than a compile, so it runs on a
// sample. The deterministic grader still covers every item.
const JUDGE_RATE = Number(arg("judge-rate", "0.35"));
const CORPUS = arg("corpus", "corpus-1000.json") as string;

interface CorpusItem {
  id: string;
  channel: string;
  url?: string;
  text?: string;
  origin: string;
}

interface Row {
  id: string;
  channel: string;
  origin: string;
  ok: boolean;
  error?: string;
  dish?: string;
  sourceType?: string;
  attempts?: number;
  elapsedMs?: number;
  costUsd?: number;
  grade?: CardGrade;
  judge?: JudgeVerdict;
}

const corpus = JSON.parse(readFileSync(new URL(`../eval/${CORPUS}`, import.meta.url), "utf8")) as {
  items: CorpusItem[];
};

const outDir = new URL("../eval/scale/", import.meta.url);
mkdirSync(outDir, { recursive: true });
const outFile = new URL(`${TAG}.jsonl`, outDir);

const done = new Set<string>();
if (existsSync(outFile)) {
  for (const line of readFileSync(outFile, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      done.add((JSON.parse(line) as Row).id);
    } catch {
      // partial line from an interrupted write; ignore
    }
  }
}

const queue = corpus.items.filter((i) => !done.has(i.id)).slice(0, Math.max(0, LIMIT - done.size));
console.log(
  `tag=${TAG} corpus=${corpus.items.length} alreadyDone=${done.size} toRun=${queue.length} concurrency=${CONCURRENCY} judge=${USE_JUDGE ? `${Math.round(JUDGE_RATE * 100)}% sample` : "off"}`,
);

let spent = 0;
let completed = 0;
let failed = 0;
let stopped = false;
const started = Date.now();

async function runOne(item: CorpusItem): Promise<void> {
  const row: Row = { id: item.id, channel: item.channel, origin: item.origin, ok: false };
  try {
    const input = item.url ?? item.text ?? "";
    const { doc, meta } = await compile(input, {
      deepseekKey: env.DEEPSEEK_API_KEY,
      geminiKey: env.GEMINI_API_KEY,
      apifyToken: env.SCRAPER_API_TOKEN,
    });
    row.ok = true;
    row.dish = doc.dish;
    row.sourceType = meta.sourceType;
    row.attempts = meta.attempts;
    row.elapsedMs = meta.elapsedMs;
    row.costUsd = meta.usage.costUsd;
    spent += meta.usage.costUsd;
    row.grade = gradeCard(doc, meta.groundTruthIngredients);

    if (USE_JUDGE && env.MOONSHOT_API_KEY && Math.random() < JUDGE_RATE) {
      try {
        const verdict = await judgeCard({
          apiKey: env.MOONSHOT_API_KEY,
          doc,
          sourceExcerpt: meta.sourceExcerpt,
        });
        row.judge = verdict;
        spent += verdict.costUsd;
      } catch (err) {
        row.judge = undefined;
        row.error = `judge: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  } catch (err) {
    row.ok = false;
    row.error = err instanceof Error ? err.message : String(err);
    failed += 1;
  }
  appendFileSync(outFile, JSON.stringify(row) + "\n");
  completed += 1;
  if (completed % 20 === 0) {
    const rate = completed / ((Date.now() - started) / 1000);
    console.log(
      `  ${completed}/${queue.length} done, ${failed} failed, $${spent.toFixed(3)}, ${rate.toFixed(2)}/s`,
    );
  }
  if (spent > MAX_COST && !stopped) {
    stopped = true;
    console.log(`cost cap $${MAX_COST} reached, stopping`);
  }
}

const cursor = { i: 0 };
async function worker(): Promise<void> {
  while (cursor.i < queue.length && !stopped) {
    const item = queue[cursor.i];
    cursor.i += 1;
    await runOne(item);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

console.log(
  `\nrun complete: ${completed} items, ${failed} failed, $${spent.toFixed(3)}, ${((Date.now() - started) / 60000).toFixed(1)} min`,
);
writeFileSync(
  new URL(`${TAG}-run.json`, outDir),
  JSON.stringify({ tag: TAG, completed, failed, spent, judge: USE_JUDGE }, null, 2),
);
console.log(`node scripts/eval-report.mts --tag ${TAG}`);
