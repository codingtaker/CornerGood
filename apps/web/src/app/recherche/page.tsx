import type { Metadata } from "next";
import Link from "next/link";
import { loadCategories, loadCommunes } from "@/lib/reference-data";
import {
  hasCriterion,
  readCriteria,
  searchHref,
  searchQuery,
  type SearchCriteria,
} from "@/lib/search";
import { SearchForm } from "../search-form";
import { ResultsMapLoader } from "./results-map-loader";
import { SearchResults } from "./search-results";

export const metadata: Metadata = {
  title: "Recherche · CornerGood",
  // Result pages change all the time and may carry a position.
  robots: { index: false },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) params.set(key, first);
  }
  const criteria = readCriteria(params);
  const query = searchQuery(criteria);
  const [categories, communes] = await Promise.all([
    loadCategories(),
    loadCommunes(),
  ]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-4 py-6">
      <Link href="/" className="text-sm font-semibold text-accent">
        CornerGood
      </Link>
      <h1 className="text-2xl font-bold">Recherche</h1>
      {/* key: a new search starts from its own address, not the last form. */}
      <SearchForm
        key={`form-${query}`}
        categories={categories}
        communes={communes}
        initial={criteria}
      />
      <ViewSwitch criteria={criteria} />
      {criteria.view === "map" ? (
        <ResultsMapLoader key={query} criteria={criteria} />
      ) : hasCriterion(criteria) ? (
        <SearchResults key={query} criteria={criteria} query={query} />
      ) : (
        <p>Dites ce que vous cherchez, ou choisissez une commune.</p>
      )}
    </main>
  );
}

/** Liste or Carte, for the same search; the map has no pages. */
function ViewSwitch({ criteria }: { criteria: SearchCriteria }) {
  const views = [
    { label: "Liste", view: undefined },
    { label: "Carte", view: "map" as const },
  ];
  return (
    <nav aria-label="Affichage des résultats" className="flex gap-2">
      {views.map(({ label, view }) => {
        const current = criteria.view === view;
        return (
          <Link
            key={label}
            href={searchHref({ ...criteria, view, page: undefined })}
            aria-current={current ? "page" : undefined}
            className={`flex-1 rounded-md border px-3 py-2 text-center font-semibold ${
              current
                ? "border-accent bg-accent text-white"
                : "border-foreground/20"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
