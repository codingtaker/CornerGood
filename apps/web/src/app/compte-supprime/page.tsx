import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Compte supprimé · CornerGood" };

export default function DeletedAccountPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-bold">Votre compte est supprimé</h1>
      <p>
        Votre nom, votre numéro et votre e-mail ont été effacés, et vos fiches
        retirées du site.
      </p>
      <Link href="/" className="font-semibold text-accent underline">
        Retour à l&apos;accueil
      </Link>
    </main>
  );
}
