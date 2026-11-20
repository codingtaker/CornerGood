import type { Metadata } from "next";
import Link from "next/link";
import { safeNextPath } from "@/lib/safe-next";
import { AccountForm } from "../account-form";

export const metadata: Metadata = { title: "Créer un compte · CornerGood" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ suivant?: string | string[] }>;
}) {
  const next = safeNextPath((await searchParams).suivant);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold">Créer un compte professionnel</h1>
        <p className="mt-1 opacity-80">
          Pour présenter votre activité sur CornerGood.
        </p>
      </div>
      <AccountForm mode="register" next={next} />
      <p>
        Déjà un compte ?{" "}
        <Link
          href={`/connexion?suivant=${encodeURIComponent(next)}`}
          className="font-semibold text-accent underline"
        >
          Se connecter
        </Link>
      </p>
    </main>
  );
}
