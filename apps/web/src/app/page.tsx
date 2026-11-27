import Link from "next/link";
import { connection } from "next/server";
import type { Category } from "@/lib/listings";
import { loadCategories, loadCommunes } from "@/lib/reference-data";
import { searchHref } from "@/lib/search";
import { SearchForm } from "./search-form";

/**
 * The home page is the search (ADR-014): what, where, or around me; then the
 * activities to browse, and the way in for professionals.
 */
export default async function HomePage() {
  // Rendered on each visit, never at build time: a build without the API
  // would otherwise serve empty lists for an hour. The lists themselves are
  // still read again at most every hour (reference-data.ts).
  await connection();
  const [categories, communes] = await Promise.all([
    loadCategories(),
    loadCommunes(),
  ]);
  const business = categories.filter(
    (category) => category.applicableTo !== "COMMUNITY",
  );
  const community = categories.filter(
    (category) => category.applicableTo !== "BUSINESS",
  );

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-accent">CornerGood</h1>
        <p className="text-lg">
          Trouvez les activités, artisans et services de proximité du Grand
          Lomé.
        </p>
      </header>

      <SearchForm categories={categories} communes={communes} />

      <CategoryLinks title="Activités et services" categories={business} />
      <CategoryLinks title="Structures du quartier" categories={community} />

      <section className="flex flex-col gap-2 rounded-md bg-accent/10 p-4">
        <h2 className="font-semibold">Vous avez une activité ?</h2>
        <p className="text-sm">
          Créez sa fiche gratuitement : elle sera visible après vérification par
          l&apos;équipe.
        </p>
        <nav className="flex gap-4">
          <Link
            href="/inscription"
            className="font-semibold text-accent underline"
          >
            Créer un compte pro
          </Link>
          <Link href="/pro" className="font-semibold underline">
            Espace pro
          </Link>
        </nav>
      </section>
    </main>
  );
}

function CategoryLinks({
  title,
  categories,
}: {
  title: string;
  categories: Category[];
}) {
  if (categories.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">{title}</h2>
      <ul className="flex flex-wrap gap-2">
        {categories.map((category) => (
          <li key={category.slug}>
            <Link
              href={searchHref({ category: category.slug })}
              className="inline-block rounded-full border border-foreground/20 px-3 py-1 text-sm"
            >
              {category.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
