import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { STATUS_LABELS } from "@/lib/listings";
import { ADMIN_ROLES, apiFetch, getCurrentUser } from "@/lib/session";
import { SignOutButton } from "../sign-out-button";

export const metadata: Metadata = { title: "Espace pro · CornerGood" };

interface Listing {
  id: string;
  name: string;
  status: string;
}

export default async function ProPage() {
  const user = await getCurrentUser();
  // A cookie that no longer opens a session (expired, signed out elsewhere).
  if (!user) redirect("/connexion?suivant=/pro");

  const response = await apiFetch("/pro/listings");
  const { listings } = response.ok
    ? ((await response.json()) as { listings: Listing[] })
    : { listings: [] };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 py-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Espace pro</h1>
        <SignOutButton />
      </header>
      <p>Bonjour {user.fullName}.</p>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Mes fiches</h2>
        <Link
          href="/pro/fiches/nouvelle"
          className="rounded-md bg-accent px-4 py-3 text-center font-semibold text-white"
        >
          Créer une fiche
        </Link>
        {listings.length === 0 ? (
          <p className="opacity-80">
            Vous n&apos;avez pas encore de fiche. Le plus simple : placez-vous
            devant votre activité et créez-la sur place.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {listings.map((listing) => (
              <li key={listing.id}>
                <Link
                  href={`/pro/fiches/${listing.id}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-foreground/20 px-3 py-2"
                >
                  <span className="font-medium">{listing.name}</span>
                  <span className="text-sm opacity-70">
                    {STATUS_LABELS[listing.status] ?? listing.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {ADMIN_ROLES.includes(user.role) && (
        <Link href="/admin" className="font-semibold text-accent underline">
          Aller à la modération
        </Link>
      )}

      <Link href="/pro/compte" className="underline opacity-80">
        Mon compte et mes données
      </Link>
    </main>
  );
}
