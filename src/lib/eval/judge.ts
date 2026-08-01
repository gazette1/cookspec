// LLM judge. Runs on Kimi, which is not in the extraction path, so cards are
// not graded by the family that produced them.
//
// The rubric is scored per dimension rather than as one number, because a
// single score hides which part regressed.

import { kimiJson } from "../pipeline/llm.ts";
import type { RecipeDoc } from "../recipe/types.ts";
import { cardToText } from "./grade.ts";

export interface JudgeVerdict {
  fidelity: number | null;
  completeness: number;
  quantityIntegrity: number;
  structure: number;
  startsFromRaw: boolean;
  cookable: boolean;
  worstProblem: string;
  costUsd: number;
}

const SYSTEM = `You grade recipe cards produced by a compiler that turns any recipe source into one merge table: ingredients on the left, operations merging column by column into the finished dish.

Grade strictly and return only JSON. A card is a cooking document, not a summary. Someone holding only this card, with raw groceries and no access to the original source, must be able to produce the dish.

Score these 1 to 5, where 5 is flawless and 3 is usable with irritation:
- fidelity: does the card match what the source actually teaches, with no invented steps and no dropped steps. Use null if no source text was provided.
- completeness: could a competent cook execute this card start to finish without consulting anything else. Missing cooking times, temperatures, or whole preparation stages lower this hard.
- quantityIntegrity: are quantities present and sane, and are guessed values marked as estimated rather than asserted.
- structure: does the merge order make culinary sense, are things combined at the right moments.

Also return:
- startsFromRaw: true only if every component is either a raw purchasable ingredient or is produced by an operation on the card. If an ingredient reads like it was already cooked or prepared elsewhere ("cooked rice", "shredded rotisserie chicken", "prepared pie crust") and no operation on the card makes it, this is false. Common knife work like "chopped onion" does not make it false.
- cookable: true if the card alone gets you to the dish.
- worstProblem: one short sentence naming the single biggest defect, or "none".`;

export async function judgeCard(opts: {
  apiKey: string;
  doc: RecipeDoc;
  sourceExcerpt?: string;
}): Promise<JudgeVerdict> {
  const parts = [`CARD:\n${cardToText(opts.doc)}`];
  if (opts.sourceExcerpt) {
    parts.push(`\nSOURCE THE CARD WAS BUILT FROM:\n${opts.sourceExcerpt.slice(0, 6000)}`);
  } else {
    parts.push("\nNO SOURCE TEXT AVAILABLE (media source). Set fidelity to null and grade the rest.");
  }
  parts.push(
    '\nReturn JSON: {"fidelity":number|null,"completeness":number,"quantityIntegrity":number,"structure":number,"startsFromRaw":boolean,"cookable":boolean,"worstProblem":string}',
  );

  let parsed: Partial<JudgeVerdict> = {};
  let res = await kimiJson({ apiKey: opts.apiKey, system: SYSTEM, user: parts.join("\n") });
  let cost = res.usage.costUsd;
  for (let attempt = 1; ; attempt += 1) {
    try {
      parsed = JSON.parse(res.content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "")) as Partial<JudgeVerdict>;
      break;
    } catch {
      if (attempt >= 2) throw new Error("judge returned invalid JSON twice");
      res = await kimiJson({
        apiKey: opts.apiKey,
        system: SYSTEM,
        user: `${parts.join("\n")}\n\nYour previous reply was not valid JSON. Reply with the JSON object only.`,
      });
      cost += res.usage.costUsd;
    }
  }
  const clamp = (v: unknown): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 3;
  };
  return {
    fidelity: parsed.fidelity === null || parsed.fidelity === undefined ? null : clamp(parsed.fidelity),
    completeness: clamp(parsed.completeness),
    quantityIntegrity: clamp(parsed.quantityIntegrity),
    structure: clamp(parsed.structure),
    startsFromRaw: parsed.startsFromRaw === true,
    cookable: parsed.cookable === true,
    worstProblem: typeof parsed.worstProblem === "string" ? parsed.worstProblem.slice(0, 200) : "",
    costUsd: cost,
  };
}
