import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ACTION_LABELS,
  formatDate,
  LOCATION_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  type ModerationListing,
} from "@/lib/listings";
import { ADMIN_ROLES, apiFetch, getCurrentUser } from "@/lib/session";
import { AccessDenied } from "../../access-denied";
import { ListingDecision } from "./listing-decision";
import { PhotoReview } from "./photo-review";

export const metadata: Metadata = { title: "Examen d'une fiche · CornerGood" };

/** Everything needed to decide on one listing (S4). */
export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/connexion?suivant=/admin/fiches/${id}`);
  if (!ADMIN_ROLES.includes(user.role)) return <AccessDenied />;

  const response = await apiFetch(`/admin/listings/${encodeURIComponent(id)}`);
  if (response.status === 404) notFound();
  if (!response.ok) {
    return (
      <main className="mx-auto max-w-md px-4 py-8">
        <p role="alert">La fiche est indisponible pour le moment.</p>
      </main>
    );
  }
  const { listing } = (await response.json()) as {
    listing: ModerationListing;
  };
  const location = listing.location;
  const pending = listing.status === "PENDING";
  const photosDecidable = pending || listing.status === "PUBLISHED";

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 py-8">
      <div>
        <Link
          href="/admin/moderation"
          className="text-sm text-accent underline"
        >
          Fiches à examiner
        </Link>
        <p className="mt-2 text-sm font-medium text-accent">
          {STATUS_LABELS[listing.status] ?? listing.status}
        </p>
        <h1 className="text-2xl font-bold">{listing.name}</h1>
        <p className="opacity-80">
          {listing.category.name} ·{" "}
          {listing.entityType === "BUSINESS"
            ? "Activité"
            : "Lieu communautaire"}
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Informations</h2>
        {listing.description ? (
          <p className="whitespace-pre-line">{listing.description}</p>
        ) : (
          <p className="opacity-70">Pas de description.</p>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="font-medium">Téléphone</dt>
          <dd>{listing.phone ?? "—"}</dd>
          <dt className="font-medium">WhatsApp</dt>
          <dd>{listing.whatsapp ?? "—"}</dd>
          <dt className="font-medium">Compte</dt>
          <dd>
            {listing.owner
              ? `${listing.owner.name}${listing.owner.phone ? ` · ${listing.owner.phone}` : ""}`
              : "Compte supprimé"}
          </dd>
        </dl>
      </section>

      {location && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Lieu</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="font-medium">Type</dt>
            <dd>{LOCATION_LABELS[location.type]}</dd>
            <dt className="font-medium">Commune</dt>
            <dd>{location.commune.name}</dd>
            {location.point && (
              <>
                <dt className="font-medium">Position</dt>
                <dd>
                  {location.point.lat.toFixed(5)},{" "}
                  {location.point.lng.toFixed(5)}
                  {location.accuracyM !== null &&
                    ` (± ${location.accuracyM} m)`}
                  {location.source && (
                    <span className="block text-sm opacity-70">
                      {SOURCE_LABELS[location.source] ?? location.source}
                    </span>
                  )}
                  {location.visibility === "APPROXIMATE" && (
                    <span className="block text-sm opacity-70">
                      Privée : le public ne verra qu&apos;un secteur
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
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          Photos ({listing.photos.length})
        </h2>
        <PhotoReview photos={listing.photos} decidable={photosDecidable} />
      </section>

      {pending &&
        (user.role === "ADMIN" ? (
          <ListingDecision listingId={listing.id} />
        ) : (
          <p
            role="status"
            className="rounded-md bg-foreground/5 px-3 py-2 opacity-90"
          >
            Vous pouvez vérifier les photos. La publication ou le refus de la
            fiche revient à l&apos;administrateur.
          </p>
        ))}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Historique</h2>
        <ol className="flex flex-col gap-2">
          {listing.log.map((entry) => (
            <li
              key={entry.id}
              className="border-l-2 border-foreground/20 pl-3 text-sm"
            >
              <span className="font-medium">
                {ACTION_LABELS[entry.action] ?? entry.action}
              </span>{" "}
              · {formatDate(entry.at)} · {entry.actor.name}
              {entry.reason && (
                <span className="block whitespace-pre-line opacity-80">
                  {entry.reason}
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
