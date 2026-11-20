import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ADMIN_ROLES, apiFetch, getCurrentUser } from "@/lib/session";
import { SignOutButton } from "../sign-out-button";

export const metadata: Metadata = { title: "Modération · CornerGood" };

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion?suivant=/admin");

  // The API refuses these figures to a professional (403); the page says so
  // instead of showing an empty space.
  if (!ADMIN_ROLES.includes(user.role)) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
        <h1 className="text-2xl font-bold">Accès refusé</h1>
        <p>
          Cet espace est réservé à l&apos;équipe de modération de CornerGood.
        </p>
        <Link href="/pro" className="font-semibold text-accent underline">
          Retour à mon espace pro
        </Link>
      </main>
    );
  }

  const response = await apiFetch("/admin/overview");
  const overview = response.ok
    ? ((await response.json()) as {
        professionals: number;
        pendingListings: number;
      })
    : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 py-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Modération</h1>
        <SignOutButton />
      </header>
      {overview ? (
        <dl className="grid grid-cols-2 gap-4">
          <div className="rounded-md border border-foreground/20 p-4">
            <dt className="text-sm opacity-70">Professionnels inscrits</dt>
            <dd className="text-2xl font-bold">{overview.professionals}</dd>
          </div>
          <div className="rounded-md border border-foreground/20 p-4">
            <dt className="text-sm opacity-70">Fiches à modérer</dt>
            <dd className="text-2xl font-bold">{overview.pendingListings}</dd>
          </div>
        </dl>
      ) : (
        <p role="alert">Les chiffres sont indisponibles pour le moment.</p>
      )}
    </main>
  );
}
