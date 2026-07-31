"use client";

// The card renderer. Applying design.md Part 1 sections 4.3, 5, 6 and Part 2
// Components: datasheet title block, validation strip with filters, the merge
// table as the wide view, and the step view projection for phones. One
// structure, two projections.

import { useEffect, useState } from "react";
import type { Ingredient, RecipeDoc, Step } from "@/lib/recipe/types";
import { layoutRecipe } from "@/lib/recipe/layout";
import styles from "./RecipeCard.module.css";

export interface CardMeta {
  sourceLabel?: string;
  compiledAt?: string;
}

type QtyStatus = "ok" | "converted" | "corrected" | "unresolved";
type Filter = null | "converted" | "corrected" | "unresolved";
type View = "wide" | "steps";

function qtyStatus(ing: Ingredient): QtyStatus {
  const q = ing.quantity;
  if (q.provenance === "corrected") return "corrected";
  if (q.provenance === "estimated" || q.provenance === "fetched" || q.provenance === "inferred") {
    return "unresolved";
  }
  if (q.grams !== undefined && q.note) return "converted";
  return "ok";
}

function volumeText(ing: Ingredient): string | null {
  const q = ing.quantity;
  if (q.grams === undefined) return null;
  const base = q.display.split(" (")[0].trim();
  if (!base || /^\d+(\.\d+)?\s*(g|kg)\b/i.test(base)) return null;
  return base;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function splitLabel(label: string): { label: string; detail: string | null } {
  const m = label.match(/^([^,]+),\s*(.+)$/);
  if (m) return { label: capitalize(m[1].trim()), detail: m[2].trim() };
  return { label: capitalize(label), detail: null };
}

function QtyCell({ ing, filter, as: Tag = "td" }: { ing: Ingredient; filter: Filter; as?: "td" | "span" }) {
  const status = qtyStatus(ing);
  const q = ing.quantity;
  const dimmed = filter !== null && status !== filter;
  const classes = [
    styles.qty,
    status === "corrected" ? styles.corrected : "",
    status === "unresolved" ? styles.unresolved : "",
    dimmed ? styles.dim : "",
  ]
    .filter(Boolean)
    .join(" ");
  const vol = volumeText(ing);
  const body = (
    <>
      {q.grams !== undefined ? (
        <span className={styles.num}>
          {q.grams} <span className={styles.u}>g</span>
        </span>
      ) : (
        q.display
      )}
      {vol && status !== "corrected" ? <span className={styles.vol}>{vol}</span> : null}
      {status === "corrected" && q.statedDisplay ? <span className={styles.was}>{q.statedDisplay}</span> : null}
      {status === "corrected" ? (
        <span className={styles.why} title={q.note}>
          density check
        </span>
      ) : null}
      {status === "unresolved" ? (
        <span className={styles.why} title={q.note}>
          not stated, researched
        </span>
      ) : null}
    </>
  );
  if (Tag === "span") return <span className={classes}>{body}</span>;
  return <td className={classes}>{body}</td>;
}

export function RecipeCard({ doc, meta }: { doc: RecipeDoc; meta?: CardMeta }) {
  const [filter, setFilter] = useState<Filter>(null);
  const [view, setView] = useState<View>("wide");
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem("cookspec-view") : null;
    if (saved === "wide" || saved === "steps") setView(saved);
    else if (typeof matchMedia !== "undefined" && matchMedia("(max-width: 640px)").matches) setView("steps");
  }, []);

  function pickView(v: View) {
    setView(v);
    try {
      localStorage.setItem("cookspec-view", v);
    } catch {
      // private mode; the toggle still works for the session
    }
  }

  const layout = layoutRecipe(doc);
  const opCols = layout.columns - 1;
  const stepById = new Map(doc.steps.map((s) => [s.id, s]));
  const ingredientById = new Map(doc.ingredients.map((i) => [i.id, i]));

  const starts = new Map<string, { step: Step; rowSpan: number; opIdx: number }>();
  const covered = new Set<string>();
  for (const cell of layout.cells) {
    if (cell.kind !== "step") continue;
    const opIdx = cell.col - 1;
    starts.set(`${cell.row}:${opIdx}`, {
      step: stepById.get(cell.refId) as Step,
      rowSpan: cell.rowSpan,
      opIdx,
    });
    for (let r = cell.row; r < cell.row + cell.rowSpan; r += 1) covered.add(`${r}:${opIdx}`);
  }

  const counts = {
    total: doc.ingredients.length,
    converted: doc.ingredients.filter((i) => qtyStatus(i) === "converted").length,
    corrected: doc.ingredients.filter((i) => qtyStatus(i) === "corrected").length,
    unresolved: doc.ingredients.filter((i) => qtyStatus(i) === "unresolved").length,
  };

  const source = doc.source;
  const sourceName = source?.creatorHandle ?? source?.platform ?? null;

  return (
    <article className={styles.card}>
      <header className={styles.titleBlock}>
        <h2 className={styles.dish}>{doc.dish}</h2>
        <div className={styles.meta}>
          {doc.servings ? (
            <div>
              <span className="micro">Yield</span>
              <b>{doc.servings}</b>
            </div>
          ) : null}
          {meta?.sourceLabel ? (
            <div>
              <span className="micro">Source</span>
              <b>{meta.sourceLabel}</b>
            </div>
          ) : null}
          {meta?.compiledAt ? (
            <div>
              <span className="micro">Compiled</span>
              <b>{meta.compiledAt}</b>
            </div>
          ) : null}
          <div>
            <span className="micro">Rev</span>
            <b>A</b>
          </div>
          {doc.inferred ? (
            <div>
              <span className="micro">Status</span>
              <b>inferred</b>
            </div>
          ) : null}
        </div>
      </header>
      <hr className={styles.ruleHeavy} />
      <hr className={styles.ruleThin} />

      <div className={styles.validation} role="group" aria-label="validation">
        <button type="button" className={styles.seg} aria-pressed={filter === null} onClick={() => setFilter(null)}>
          <span className={styles.n}>{counts.total}</span>
          <span className={`micro ${styles.segLabel}`}>Quantities</span>
        </button>
        <button
          type="button"
          className={styles.seg}
          aria-pressed={filter === "converted"}
          onClick={() => setFilter(filter === "converted" ? null : "converted")}
        >
          <span className={styles.n}>{counts.converted}</span>
          <span className={`micro ${styles.segLabel}`}>Converted</span>
        </button>
        <button
          type="button"
          className={styles.seg}
          aria-pressed={filter === "corrected"}
          onClick={() => setFilter(filter === "corrected" ? null : "corrected")}
        >
          <span className={styles.n}>{counts.corrected}</span>
          <span className={`micro ${styles.segLabel}`}>Corrections</span>
        </button>
        <button
          type="button"
          className={styles.seg}
          aria-pressed={filter === "unresolved"}
          onClick={() => setFilter(filter === "unresolved" ? null : "unresolved")}
        >
          <span className={styles.n}>{counts.unresolved}</span>
          <span className={`micro ${styles.segLabel}`}>Unresolved</span>
        </button>
        <span className={styles.viewToggle}>
          <button type="button" className={styles.seg} aria-pressed={view === "wide"} onClick={() => pickView("wide")}>
            <span className={`micro ${styles.segLabel}`}>Wide</span>
          </button>
          <button
            type="button"
            className={styles.seg}
            aria-pressed={view === "steps"}
            onClick={() => pickView("steps")}
          >
            <span className={`micro ${styles.segLabel}`}>Steps</span>
          </button>
        </span>
      </div>

      {doc.prepNotes.length > 0 ? (
        <p className={styles.prep}>
          <span className="micro">Prep</span> {doc.prepNotes.join("; ")}
        </p>
      ) : null}

      <div className={`${styles.scroller} ${view === "steps" ? styles.scrollerHidden : ""}`}>
        <table className={styles.table}>
          <colgroup>
            <col style={{ width: "21%" }} />
            <col style={{ width: "13%" }} />
            {Array.from({ length: opCols }, (_, c) => (
              <col key={c} style={{ width: `${66 / Math.max(opCols, 1)}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className={styles.ing} scope="col">
                Ingredient
              </th>
              <th className={styles.qtyHead} scope="col">
                Mass
              </th>
              {opCols > 0 ? (
                <th scope="col" colSpan={opCols}>
                  Operations
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {doc.ingredients.map((ing, r) => (
              <tr key={ing.id} style={{ animationDelay: `${Math.min(r, 10) * 20}ms` }}>
                <td className={styles.ing}>{ing.name}</td>
                <QtyCell ing={ing} filter={filter} />
                {Array.from({ length: opCols }, (_, c) => {
                  const start = starts.get(`${r}:${c}`);
                  if (start) {
                    const { label, detail } = splitLabel(start.step.label);
                    const isFinal = c === opCols - 1;
                    return (
                      <td
                        key={c}
                        className={`${styles.op} ${isFinal ? styles.final : ""}`}
                        rowSpan={start.rowSpan}
                        style={{ animationDelay: `${200 + c * 80}ms` }}
                      >
                        <span className={styles.opLabel}>{label}</span>
                        {detail ? <span className={styles.opDetail}>{detail}</span> : null}
                      </td>
                    );
                  }
                  if (covered.has(`${r}:${c}`)) return null;
                  return <td key={c} className={styles.opEmpty} />;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {view === "steps" ? (
        <div className={`${styles.stepPanel} no-print`}>
          <div className={styles.map} role="tablist" aria-label="operations">
            {doc.steps.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={i === stepIdx}
                aria-label={s.label}
                className={i === stepIdx ? styles.mapDotActive : styles.mapDot}
                onClick={() => setStepIdx(i)}
              />
            ))}
          </div>
          {(() => {
            const step = doc.steps[Math.min(stepIdx, doc.steps.length - 1)];
            const { label, detail } = splitLabel(step.label);
            const upstream = step.inputs.filter((id) => stepById.has(id));
            const ingredients = step.inputs.filter((id) => ingredientById.has(id));
            return (
              <>
                <p className={`micro ${styles.stepPos}`}>
                  Operation {stepIdx + 1} of {doc.steps.length}
                </p>
                <h3 className={styles.stepLabel}>{label}</h3>
                {detail ? <p className={styles.stepDetail}>{detail}</p> : null}
                {upstream.length > 0 ? (
                  <div className={styles.chips}>
                    {upstream.map((id) => (
                      <span key={id} className={styles.chip}>
                        {splitLabel((stepById.get(id) as Step).label).label}
                      </span>
                    ))}
                  </div>
                ) : null}
                {ingredients.length > 0 ? (
                  <ul className={styles.stepIngs}>
                    {ingredients.map((id) => {
                      const ing = ingredientById.get(id) as Ingredient;
                      return (
                        <li key={id}>
                          <span className={styles.stepIngName}>{ing.name}</span>
                          <QtyCell ing={ing} filter={null} as="span" />
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                <div className={styles.stepNav}>
                  <button type="button" disabled={stepIdx === 0} onClick={() => setStepIdx(stepIdx - 1)}>
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={stepIdx === doc.steps.length - 1}
                    onClick={() => setStepIdx(stepIdx + 1)}
                  >
                    Next
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      ) : null}

      <footer className={styles.foot}>
        <span className="micro">
          {sourceName ? (
            <>
              Compiled from{" "}
              {source?.url ? (
                <a href={source.url} rel="noreferrer noopener">
                  {sourceName}
                </a>
              ) : (
                sourceName
              )}
            </>
          ) : (
            "Compiled from pasted input"
          )}
        </span>
        <span className="micro">Cookspec</span>
      </footer>
    </article>
  );
}
