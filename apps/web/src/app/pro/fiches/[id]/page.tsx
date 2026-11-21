import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  LOCATION_LABELS,
  STATUS_LABELS,
  type OwnListing,
} from "@/lib/listings";
import { apiFetch, getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Ma fiche · CornerGood" };

export default async function OwnListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/connexion?suivant=/pro/fiches/${id}`);

  const response = await apiFetch(`/pro/listings/${encodeURIComponent(id)}`);
  if (response.status === 404) notFound();
  if (!response.ok) {
    return (
      <main className="mx-auto max-w-md px-4 py-8">
        <p role="alert">La fiche est indisponible pour le moment.</p>
      </main>
    );
  }
  const { listing } = (await response.json()) as { listing: OwnListing };
  const location = listing.location;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-4 py-8">
      <div>
        <p className="text-sm font-medium text-accent">
          {STATUS_LABELS[listing.status] ?? listing.status}
        </p>
        <h1 className="text-2xl font-bold">{listing.name}</h1>
        <p className="opacity-80">{listing.category.name}</p>
      </div>

      {location && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="font-medium">Lieu</dt>
          <dd>{LOCATION_LABELS[location.type]}</dd>
          <dt className="font-medium">Commune</dt>
          <dd>{location.commune.name}</dd>
          {location.point && (
            <>
              <dt className="font-medium">Position</dt>
              <dd>
                {location.point.lat.toFixed(5)}, {location.point.lng.toFixed(5)}
                {location.accuracyM !== null && ` (± ${location.accuracyM} m)`}
                {location.visibility === "APPROXIMATE" && (
                  <span className="block text-sm opacity-70">
                    Visible par vous seul : le public verra un secteur
                    d&apos;environ 500 m.
                  </span>
                )}
              </dd>
            </>
          )}
          {location.addressHint && (
            <>
              <dt className="font-medium">Repère</dt>
              <dd>{location.addressHint}</dd>
            </>
          )}
          {location.servedCommunes.length > 0 && (
            <>
              <dt className="font-medium">Intervient à</dt>
              <dd>{location.servedCommunes.map((c) => c.name).join(", ")}</dd>
            </>
          )}
        </dl>
      )}

      <p className="rounded-md bg-foreground/5 px-3 py-2 text-sm">
        Brouillon enregistré. Vous pourrez le compléter (photos, horaires) puis
        l&apos;envoyer en modération.
      </p>
      <Link href="/pro" className="text-accent underline">
        Retour à mon espace pro
      </Link>
    </main>
  );
}
