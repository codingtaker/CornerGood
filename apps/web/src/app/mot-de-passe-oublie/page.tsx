import type { Metadata } from "next";
import Link from "next/link";
import { PasswordResetForm } from "./password-reset-form";

export const metadata: Metadata = {
  title: "Mot de passe oublié · CornerGood",
};

export default function ForgottenPasswordPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold">Mot de passe oublié</h1>
        <p className="mt-1 opacity-80">
          Recevez un code par SMS sur le numéro de votre compte, puis choisissez
          un nouveau mot de passe.
        </p>
      </div>
      <PasswordResetForm />
      <Link href="/connexion" className="text-accent underline">
        Retour à la connexion
      </Link>
    </main>
  );
}
