import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
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

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Mes fiches</h2>
        {listings.length === 0 ? (
          <p className="opacity-80">
            Vous n&apos;avez pas encore de fiche. La création de fiche arrive
            bientôt.
          </p>
        ) : (
          <ul className="list-disc pl-5">
            {listings.map((listing) => (
              <li key={listing.id}>{listing.name}</li>
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
