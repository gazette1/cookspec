import { RecipeCard } from "@/components/RecipeCard";
import { brownies } from "@/lib/recipe/fixtures/brownies";

const INPUT_TYPES = ["TikTok", "Reels", "Shorts", "YouTube", "Articles", "Pasted text", "Photos"];

export default function Home() {
  return (
    <main>
      <h1>CookSpec</h1>
      <p className="tagline">
        Paste a link. Get the whole recipe back as one table: every ingredient, every operation,
        no scrolling through a life story to find the oven temperature.
      </p>
      <ul className="input-chips" aria-label="supported inputs">
        {INPUT_TYPES.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <form className="converter">
        <input
          type="url"
          disabled
          placeholder="https://www.tiktok.com/@creator/video/..."
          aria-label="recipe link"
        />
        <button type="button" disabled>
          Compile
        </button>
      </form>
      <p className="build-note">
        Converter under construction. The card below is rendered live by the layout engine from
        structured data, including two gram values the unit validator corrected.
      </p>
      <RecipeCard doc={brownies} />
    </main>
  );
}
