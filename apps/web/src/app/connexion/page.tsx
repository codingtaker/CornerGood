import type { Metadata } from "next";
import Link from "next/link";
import { safeNextPath } from "@/lib/safe-next";
import { AccountForm } from "../account-form";

export const metadata: Metadata = { title: "Connexion · CornerGood" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ suivant?: string | string[] }>;
}) {
  const next = safeNextPath((await searchParams).suivant);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold">Connexion</h1>
      <AccountForm mode="login" next={next} />
      <p>
        Pas encore de compte ?{" "}
        <Link
          href={`/inscription?suivant=${encodeURIComponent(next)}`}
          className="font-semibold text-accent underline"
        >
          Créer un compte
        </Link>
      </p>
    </main>
  );
}
