import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { DeleteAccountForm } from "./delete-account-form";

export const metadata: Metadata = { title: "Mon compte · CornerGood" };

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion?suivant=/pro/compte");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold">Mon compte et mes données</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Supprimer mon compte</h2>
        <p>La suppression est définitive. CornerGood efface :</p>
        <ul className="list-disc pl-5">
          <li>votre nom, votre numéro de téléphone et votre e-mail ;</li>
          <li>votre mot de passe et toutes vos connexions ouvertes.</li>
        </ul>
        <p>
          Vos fiches sont retirées du site. Les décisions de modération qui les
          concernent sont conservées, sans votre nom, comme trace du contrôle
          exercé. Votre numéro pourra ensuite servir à créer un nouveau compte.
        </p>
        <DeleteAccountForm />
      </section>

      <Link href="/pro" className="text-accent underline">
        Retour à mon espace pro
      </Link>
    </main>
  );
}
