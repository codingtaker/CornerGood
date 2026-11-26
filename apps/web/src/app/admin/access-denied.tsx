import Link from "next/link";

/** Shown to a professional who opens /admin: the API would answer 403. */
export function AccessDenied() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-bold">Accès refusé</h1>
      <p>Cet espace est réservé à l&apos;équipe de modération de CornerGood.</p>
      <Link href="/pro" className="font-semibold text-accent underline">
        Retour à mon espace pro
      </Link>
    </main>
  );
}
