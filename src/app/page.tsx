import Link from "next/link";
import { ConverterForm } from "@/components/ConverterForm";
import { brownies } from "@/lib/recipe/fixtures/brownies.ts";

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
      <p className="library-link">
        <Link href="/recipes">Browse the recipe library</Link>
      </p>
      <ConverterForm demo={brownies} />
    </main>
  );
}
