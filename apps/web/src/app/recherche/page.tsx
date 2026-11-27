import type { Metadata } from "next";
import Link from "next/link";
import { loadCategories, loadCommunes } from "@/lib/reference-data";
import { hasCriterion, readCriteria, searchQuery } from "@/lib/search";
import { SearchForm } from "../search-form";
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
      {hasCriterion(criteria) ? (
        <SearchResults key={query} criteria={criteria} query={query} />
      ) : (
        <p>Dites ce que vous cherchez, ou choisissez une commune.</p>
      )}
    </main>
  );
}
