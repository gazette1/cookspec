import type { RecipeDoc } from "./types";

// Turns a RecipeDoc DAG into the Cooking for Engineers merged-cell grid.
//
// Model: ingredients occupy rows in order. Each step's cell spans the union of
// its inputs' rows (which must be contiguous) and sits one column deeper than
// its deepest input. Every cell then stretches rightward until the column of
// the step that consumes it, so the grid has no holes. The final step
// stretches to the last column.

export interface LayoutCell {
  kind: "ingredient" | "step";
  refId: string;
  row: number;
  rowSpan: number;
  col: number;
  colSpan: number;
}

export interface RecipeLayout {
  columns: number;
  rows: number;
  /** Sorted by row, then column; ready to emit as table rows */
  cells: LayoutCell[];
}

interface NodeInfo {
  rowStart: number;
  rowEnd: number;
  depth: number;
  consumerDepth?: number;
}

export function layoutRecipe(doc: RecipeDoc): RecipeLayout {
  if (doc.ingredients.length === 0) throw new Error("recipe has no ingredients");
  if (doc.steps.length === 0) throw new Error("recipe has no steps");

  const info = new Map<string, NodeInfo>();
  doc.ingredients.forEach((ing, i) => {
    if (info.has(ing.id)) throw new Error(`duplicate node id ${ing.id}`);
    info.set(ing.id, { rowStart: i, rowEnd: i, depth: 0 });
  });

  for (const step of doc.steps) {
    if (info.has(step.id)) throw new Error(`duplicate node id ${step.id}`);
    if (step.inputs.length === 0) throw new Error(`step ${step.id} has no inputs`);

    let rowStart = Infinity;
    let rowEnd = -Infinity;
    let depth = 0;
    let coveredRows = 0;
    for (const inputId of step.inputs) {
      const input = info.get(inputId);
      if (!input) throw new Error(`step ${step.id} references unknown or later node ${inputId}`);
      if (input.consumerDepth !== undefined) throw new Error(`node ${inputId} is consumed by two steps`);
      rowStart = Math.min(rowStart, input.rowStart);
      rowEnd = Math.max(rowEnd, input.rowEnd);
      depth = Math.max(depth, input.depth + 1);
      coveredRows += input.rowEnd - input.rowStart + 1;
    }
    if (coveredRows !== rowEnd - rowStart + 1) {
      throw new Error(`step ${step.id} inputs are not contiguous rows; reorder ingredients`);
    }
    for (const inputId of step.inputs) {
      const input = info.get(inputId)!;
      info.set(inputId, { ...input, consumerDepth: depth });
    }
    info.set(step.id, { rowStart, rowEnd, depth });
  }

  const columns = Math.max(...doc.steps.map((s) => info.get(s.id)!.depth)) + 1;

  const cells: LayoutCell[] = [];
  for (const ing of doc.ingredients) {
    const n = info.get(ing.id)!;
    const endCol = (n.consumerDepth ?? columns) - 1;
    cells.push({
      kind: "ingredient",
      refId: ing.id,
      row: n.rowStart,
      rowSpan: 1,
      col: 0,
      colSpan: endCol + 1,
    });
  }
  for (const step of doc.steps) {
    const n = info.get(step.id)!;
    const endCol = (n.consumerDepth ?? columns) - 1;
    cells.push({
      kind: "step",
      refId: step.id,
      row: n.rowStart,
      rowSpan: n.rowEnd - n.rowStart + 1,
      col: n.depth,
      colSpan: endCol - n.depth + 1,
    });
  }
  cells.sort((a, b) => a.row - b.row || a.col - b.col);

  return { columns, rows: doc.ingredients.length, cells };
}
