import Link from "next/link";
import { ConverterForm } from "@/components/ConverterForm";
import { brownies } from "@/lib/recipe/fixtures/brownies.ts";

export default function Home() {
  return (
    <main>
      <nav className="top-nav no-print">
        <Link href="/recipes">library</Link>
      </nav>
      <h1>Cookspec</h1>
      <p className="tagline">Any recipe, one table, numbers checked.</p>
      <ConverterForm demo={brownies} demoMeta={{ sourceLabel: "post", compiledAt: "2026-07-30" }} />
    </main>
  );
}
