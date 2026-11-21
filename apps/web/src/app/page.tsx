import Link from "next/link";

// Placeholder home page until the search screen is built (calendar, week S5).
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="text-3xl font-bold text-accent">CornerGood</h1>
      <p className="text-lg">
        Trouvez les activités, artisans et services de proximité du Grand Lomé.
      </p>
      <p className="text-sm opacity-70">Plateforme en cours de construction.</p>
      <nav className="flex gap-4">
        <Link
          href="/inscription"
          className="font-semibold text-accent underline"
        >
          Créer un compte pro
        </Link>
        <Link href="/pro" className="font-semibold underline">
          Espace pro
        </Link>
      </nav>
    </main>
  );
}
