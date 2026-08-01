// Aggregate a scale run into a readable report: overall health, per-channel
// breakdown, and the failure modes ranked by how many cards they touch.
//
// Usage: node scripts/eval-report.mts --tag baseline [--compare previous]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { CardGrade } from "../src/lib/eval/grade.ts";
import type { JudgeVerdict } from "../src/lib/eval/judge.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}

interface Row {
  id: string;
  channel: string;
  origin: string;
  ok: boolean;
  error?: string;
  dish?: string;
  attempts?: number;
  elapsedMs?: number;
  costUsd?: number;
  grade?: CardGrade;
  judge?: JudgeVerdict;
}

/** Accepts one tag or a comma-separated list, so a run split across processes
 *  reports as one population. */
function load(tag: string): Row[] {
  const rows: Row[] = [];
  for (const part of tag.split(",").map((t) => t.trim()).filter(Boolean)) {
    const file = new URL(`../eval/scale/${part}.jsonl`, import.meta.url);
    if (!existsSync(file)) throw new Error(`no run named ${part}`);
    rows.push(
      ...readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as Row),
    );
  }
  return rows;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "n/a");

/** A refusal is correct behavior on a source that is not one recipe, so it
 *  must not be counted as a failure. */
const isRefusal = (r: Row) => Boolean(r.error && /not a single recipe/i.test(r.error));

interface Stats {
  n: number;
  compiled: number;
  refused: number;
  failed: number;
  rawStartHard: number;
  rawStartSoft: number;
  vagueOps: number;
  placeholder: number;
  wideBoards: number;
  meanUnresolved: number;
  meanCoverage: number | null;
  meanCols: number;
  meanSecs: number;
  meanCost: number;
  retryRate: number;
  judged: number;
  judgeFidelity: number | null;
  judgeCompleteness: number;
  judgeQuantity: number;
  judgeStructure: number;
  judgeRawFalse: number;
  judgeNotCookable: number;
}

function stats(rows: Row[]): Stats {
  const ok = rows.filter((r) => r.ok && r.grade);
  const grades = ok.map((r) => r.grade as CardGrade);
  const cov = grades.map((g) => g.coverage).filter((c): c is number => c !== null);
  const judged = rows.filter((r) => r.judge);
  const fid = judged.map((r) => (r.judge as JudgeVerdict).fidelity).filter((f): f is number => f !== null);
  return {
    n: rows.length,
    compiled: ok.length,
    refused: rows.filter((r) => !r.ok && isRefusal(r)).length,
    failed: rows.filter((r) => !r.ok && !isRefusal(r)).length,
    rawStartHard: grades.filter((g) => g.rawStartHard.length > 0).length,
    rawStartSoft: grades.filter((g) => g.rawStartSoft.length > 0).length,
    vagueOps: grades.filter((g) => g.vagueOps.length > 0).length,
    // a card with two or fewer ingredients is almost always a non-recipe page
    // that produced a placeholder rather than a refusal
    placeholder: grades.filter((g) => g.ingredients <= 2).length,
    wideBoards: grades.filter((g) => g.columns > 8).length,
    meanUnresolved: mean(grades.map((g) => g.unresolvedRate)),
    meanCoverage: cov.length ? mean(cov) : null,
    meanCols: mean(grades.map((g) => g.columns)),
    meanSecs: mean(ok.map((r) => (r.elapsedMs ?? 0) / 1000)),
    meanCost: mean(ok.map((r) => r.costUsd ?? 0)),
    retryRate: ok.length ? ok.filter((r) => (r.attempts ?? 1) > 1).length / ok.length : 0,
    judged: judged.length,
    judgeFidelity: fid.length ? mean(fid) : null,
    judgeCompleteness: mean(judged.map((r) => (r.judge as JudgeVerdict).completeness)),
    judgeQuantity: mean(judged.map((r) => (r.judge as JudgeVerdict).quantityIntegrity)),
    judgeStructure: mean(judged.map((r) => (r.judge as JudgeVerdict).structure)),
    judgeRawFalse: judged.filter((r) => !(r.judge as JudgeVerdict).startsFromRaw).length,
    judgeNotCookable: judged.filter((r) => !(r.judge as JudgeVerdict).cookable).length,
  };
}

function line(label: string, s: Stats): string {
  return [
    label.padEnd(12),
    String(s.n).padStart(5),
    pct(s.compiled, s.n).padStart(8),
    pct(s.refused, s.n).padStart(8),
    pct(s.rawStartHard, s.compiled).padStart(9),
    pct(s.vagueOps, s.compiled).padStart(9),
    pct(s.placeholder, s.compiled).padStart(8),
    (s.meanCoverage === null ? "n/a" : pct(s.meanCoverage, 1)).padStart(9),
    pct(s.meanUnresolved, 1).padStart(9),
    s.meanCols.toFixed(1).padStart(6),
    s.meanSecs.toFixed(1).padStart(7),
    (s.judged ? s.judgeCompleteness.toFixed(2) : "n/a").padStart(7),
    (s.judged ? pct(s.judgeRawFalse, s.judged) : "n/a").padStart(9),
  ].join(" ");
}

const tag = arg("tag", "baseline") as string;
const rows = load(tag);
const overall = stats(rows);

const out: string[] = [];
out.push(`SCALE EVAL: ${tag}`);
out.push("");
out.push(
  ["channel".padEnd(12), "n".padStart(5), "compiled".padStart(8), "refused".padStart(8), "rawStart".padStart(9), "vagueOp".padStart(9), "placehld".padStart(8), "coverage".padStart(9), "unresolv".padStart(9), "cols".padStart(6), "secs".padStart(7), "complete".padStart(7), "judgeRaw".padStart(9)].join(" "),
);
out.push("-".repeat(110));
const channels = [...new Set(rows.map((r) => r.channel))].sort();
for (const ch of channels) out.push(line(ch, stats(rows.filter((r) => r.channel === ch))));
out.push("-".repeat(110));
out.push(line("ALL", overall));
out.push("");
out.push(
  `compiled ${overall.compiled}/${overall.n}, refused as not-a-recipe ${overall.refused}, failed ${overall.failed}, retries ${pct(overall.retryRate, 1)}`,
);
out.push(`mean cost $${overall.meanCost.toFixed(4)} per item`);
if (overall.judged) {
  out.push(
    `judge means: fidelity ${overall.judgeFidelity?.toFixed(2) ?? "n/a"}, completeness ${overall.judgeCompleteness.toFixed(2)}, quantities ${overall.judgeQuantity.toFixed(2)}, structure ${overall.judgeStructure.toFixed(2)}`,
  );
  out.push(
    `judge flags: not starting from raw ${overall.judgeRawFalse}/${overall.judged} (${pct(overall.judgeRawFalse, overall.judged)}), not cookable ${overall.judgeNotCookable}/${overall.judged} (${pct(overall.judgeNotCookable, overall.judged)})`,
  );
}

// failure modes ranked
out.push("");
out.push("TOP FAILURE MODES");
const errorCounts = new Map<string, number>();
for (const r of rows.filter((x) => !x.ok)) {
  const key = (r.error ?? "unknown").replace(/https?:\/\/\S+/g, "<url>").slice(0, 90);
  errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1);
}
for (const [k, v] of [...errorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  out.push(`  ${String(v).padStart(4)}  compile failure: ${k}`);
}

const prepCounts = new Map<string, number>();
for (const r of rows) {
  for (const item of r.grade?.rawStartHard ?? []) {
    const prep = item.match(/\(([^)]+)\)$/)?.[1] ?? "?";
    prepCounts.set(prep, (prepCounts.get(prep) ?? 0) + 1);
  }
}
for (const [k, v] of [...prepCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  out.push(`  ${String(v).padStart(4)}  assumed already ${k}`);
}

const vagueVerbs = new Map<string, number>();
for (const r of rows) {
  for (const op of r.grade?.vagueOps ?? []) {
    const verb = op.toLowerCase().split(/[\s,]/)[0];
    vagueVerbs.set(verb, (vagueVerbs.get(verb) ?? 0) + 1);
  }
}
for (const [k, v] of [...vagueVerbs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  out.push(`  ${String(v).padStart(4)}  "${k}" with no time or temperature`);
}

const problems = new Map<string, number>();
for (const r of rows) {
  const p = r.judge?.worstProblem?.trim();
  if (p && p.toLowerCase() !== "none") {
    const key = p.toLowerCase().replace(/[^a-z ]/g, "").split(" ").slice(0, 6).join(" ");
    problems.set(key, (problems.get(key) ?? 0) + 1);
  }
}
if (problems.size > 0) {
  out.push("");
  out.push("JUDGE, MOST COMMON WORST PROBLEM");
  for (const [k, v] of [...problems.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    out.push(`  ${String(v).padStart(4)}  ${k}`);
  }
}

const compare = arg("compare");
if (compare) {
  const prev = stats(load(compare));
  out.push("");
  out.push(`COMPARED WITH ${compare}`);
  const d = (a: number, b: number, unit = "") => `${a.toFixed(2)}${unit} -> ${b.toFixed(2)}${unit}`;
  out.push(`  compiled           ${pct(prev.compiled, prev.n)} -> ${pct(overall.compiled, overall.n)}`);
  out.push(`  rawStart failures  ${pct(prev.rawStartHard, prev.compiled)} -> ${pct(overall.rawStartHard, overall.compiled)}`);
  out.push(`  vague operations   ${pct(prev.vagueOps, prev.compiled)} -> ${pct(overall.vagueOps, overall.compiled)}`);
  out.push(`  placeholder cards  ${pct(prev.placeholder, prev.compiled)} -> ${pct(overall.placeholder, overall.compiled)}`);
  out.push(`  coverage           ${prev.meanCoverage === null ? "n/a" : pct(prev.meanCoverage, 1)} -> ${overall.meanCoverage === null ? "n/a" : pct(overall.meanCoverage, 1)}`);
  if (prev.judged && overall.judged) {
    out.push(`  judge completeness ${d(prev.judgeCompleteness, overall.judgeCompleteness)}`);
    out.push(`  judge raw failures ${pct(prev.judgeRawFalse, prev.judged)} -> ${pct(overall.judgeRawFalse, overall.judged)}`);
  }
}

const text = out.join("\n");
console.log(text);
writeFileSync(new URL(`../eval/scale/${tag}-report.txt`, import.meta.url), text);
