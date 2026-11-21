import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Category, Commune } from "@/lib/listings";
import { apiFetch, getCurrentUser } from "@/lib/session";
import { ListingForm } from "./listing-form";

export const metadata: Metadata = { title: "Nouvelle fiche · CornerGood" };

export default async function NewListingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion?suivant=/pro/fiches/nouvelle");

  const [communesResponse, categoriesResponse] = await Promise.all([
    apiFetch("/communes"),
    apiFetch("/categories"),
  ]);
  const { communes } = communesResponse.ok
    ? ((await communesResponse.json()) as { communes: Commune[] })
    : { communes: [] };
  const { categories } = categoriesResponse.ok
    ? ((await categoriesResponse.json()) as { categories: Category[] })
    : { categories: [] };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold">Nouvelle fiche</h1>
      {communes.length === 0 ? (
        <p role="alert">
          Les communes sont indisponibles pour le moment. Réessayez plus tard.
        </p>
      ) : (
        <ListingForm communes={communes} categories={categories} />
      )}
      <Link href="/pro" className="text-accent underline">
        Retour à mon espace pro
      </Link>
    </main>
  );
}
