import type { Ingredient, RecipeDoc } from "@/lib/recipe/types";
import { layoutRecipe, type LayoutCell } from "@/lib/recipe/layout";
import styles from "./RecipeCard.module.css";

// Renders a RecipeDoc as the merged-cell table. Server component, no client
// JS: the card is a static artifact by design.

export function RecipeCard({ doc }: { doc: RecipeDoc }) {
  const layout = layoutRecipe(doc);
  const ingredientById = new Map(doc.ingredients.map((i) => [i.id, i]));
  const stepById = new Map(doc.steps.map((s) => [s.id, s]));

  const footnotes = doc.ingredients.filter((i) => i.quantity.provenance !== "stated");
  const footnoteIndex = new Map(footnotes.map((i, n) => [i.id, n + 1]));

  const rowCells: LayoutCell[][] = Array.from({ length: layout.rows }, () => []);
  for (const cell of layout.cells) rowCells[cell.row].push(cell);

  return (
    <figure className={styles.card}>
      <figcaption className={styles.title}>
        {doc.dish}
        {doc.inferred ? <span className={styles.inferredTag}> (inferred, unverified)</span> : null}
      </figcaption>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <tbody>
          {doc.prepNotes.map((note) => (
            <tr key={note}>
              <td className={styles.prep} colSpan={layout.columns}>
                {note}
              </td>
            </tr>
          ))}
          {rowCells.map((cells, r) => (
            <tr key={r}>
              {cells.map((cell) =>
                cell.kind === "ingredient" ? (
                  <td key={cell.refId} className={styles.ingredient} colSpan={cell.colSpan} rowSpan={cell.rowSpan}>
                    <IngredientText
                      ingredient={ingredientById.get(cell.refId)!}
                      footnote={footnoteIndex.get(cell.refId)}
                    />
                  </td>
                ) : (
                  <td key={cell.refId} className={styles.step} colSpan={cell.colSpan} rowSpan={cell.rowSpan}>
                    {stepById.get(cell.refId)!.label}
                  </td>
                ),
              )}
            </tr>
          ))}
          </tbody>
        </table>
      </div>
      {footnotes.length > 0 ? (
        <ol className={styles.footnotes}>
          {footnotes.map((i) => (
            <li key={i.id}>
              {i.name}: source said {i.quantity.statedDisplay}. {i.quantity.note}
            </li>
          ))}
        </ol>
      ) : null}
      {doc.source?.creatorHandle || doc.source?.url ? (
        <p className={styles.source}>
          Source:{" "}
          {doc.source.url ? (
            <a href={doc.source.url}>{doc.source.creatorHandle ?? doc.source.url}</a>
          ) : (
            <span>
              {doc.source.creatorHandle}
              {doc.source.platform ? ` on ${doc.source.platform}` : null}
            </span>
          )}
        </p>
      ) : null}
    </figure>
  );
}

function IngredientText({ ingredient, footnote }: { ingredient: Ingredient; footnote?: number }) {
  return (
    <span>
      {ingredient.quantity.display} {ingredient.name}
      {footnote ? <sup className={styles.marker}>{footnote}</sup> : null}
    </span>
  );
}
