import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  LOCATION_LABELS,
  STATUS_LABELS,
  type CatalogueService,
  type Category,
  type Commune,
  type OwnListing,
  type OwnPhoto,
} from "@/lib/listings";
import { apiFetch, getCurrentUser } from "@/lib/session";
import { OpeningHoursTable, ServicesList } from "../../../listing-extras";
import { DetailsForm } from "./details-form";
import { ServicesEditor } from "./services-editor";
import { LocationEditor } from "./location-editor";
import { PhotoSection } from "./photo-section";

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
  const photosResponse = await apiFetch(`/pro/listings/${listing.id}/media`);
  const photos = photosResponse.ok
    ? ((await photosResponse.json()) as { photos: OwnPhoto[] }).photos
    : null;
  const location = listing.location;
  const editable = listing.status === "DRAFT" || listing.status === "REJECTED";

  const [categoriesResponse, communesResponse] = editable
    ? await Promise.all([
        apiFetch(`/categories?entityType=${listing.entityType}`),
        apiFetch("/communes"),
      ])
    : [null, null];
  const { categories } = categoriesResponse?.ok
    ? ((await categoriesResponse.json()) as { categories: Category[] })
    : { categories: [] };
  const { communes } = communesResponse?.ok
    ? ((await communesResponse.json()) as { communes: Commune[] })
    : { communes: [] };
  // The catalogue of the listing's category, to tick its services.
  const categorySlug = categories.find(
    (c) => c.id === listing.category.id,
  )?.slug;
  const servicesResponse =
    editable && categorySlug
      ? await apiFetch(`/services?category=${encodeURIComponent(categorySlug)}`)
      : null;
  const { services: catalogue } = servicesResponse?.ok
    ? ((await servicesResponse.json()) as { services: CatalogueService[] })
    : { services: [] };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-4 py-8">
      <div>
        <p className="text-sm font-medium text-accent">
          {STATUS_LABELS[listing.status] ?? listing.status}
        </p>
        <h1 className="text-2xl font-bold">{listing.name}</h1>
        <p className="opacity-80">{listing.category.name}</p>
      </div>

      {listing.status === "PUBLISHED" && (
        <p
          role="status"
          className="rounded-md bg-green-50 px-3 py-2 text-green-900"
        >
          Votre fiche est publiée.{" "}
          <Link
            href={`/fiches/${listing.slug}`}
            className="font-semibold underline"
          >
            Voir la page publique
          </Link>
          , à partager avec vos clients.
        </p>
      )}

      {listing.status === "PENDING" && (
        <p
          role="status"
          className="rounded-md bg-green-50 px-3 py-2 text-green-900"
        >
          Votre fiche est envoyée. Elle sera publiée une fois vérifiée ; vous
          verrez la décision ici.
        </p>
      )}

      {listing.rejection && (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-md bg-red-50 px-3 py-2 text-red-900"
        >
          <p className="font-semibold">
            {listing.status === "REJECTED"
              ? "Votre fiche n'a pas été publiée. Motif :"
              : "Motif du refus, à corriger avant de renvoyer :"}
          </p>
          <p className="whitespace-pre-line">{listing.rejection.reason}</p>
          {listing.status === "REJECTED" && (
            <p className="text-sm">
              Corrigez la fiche ci-dessous, puis renvoyez-la pour validation.
            </p>
          )}
        </div>
      )}

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
      {editable && location && communes.length > 0 && (
        <LocationEditor
          listingId={listing.id}
          location={location}
          communes={communes}
        />
      )}

      {photos ? (
        <PhotoSection
          listingId={listing.id}
          initialPhotos={photos}
          editable={editable}
          locationType={location?.type ?? null}
        />
      ) : (
        <p role="alert">Les photos sont indisponibles pour le moment.</p>
      )}

      {editable ? (
        <>
          <ServicesEditor
            listingId={listing.id}
            catalogue={catalogue}
            initial={listing.services}
          />
          <DetailsForm listing={listing} categories={categories} />
        </>
      ) : (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Informations</h2>
          {listing.description && (
            <p className="whitespace-pre-line">{listing.description}</p>
          )}
          {listing.phone && <p>Téléphone : {listing.phone}</p>}
          {listing.whatsapp && <p>WhatsApp : {listing.whatsapp}</p>}
          {listing.email && <p>E-mail : {listing.email}</p>}
          {listing.services.length > 0 && (
            <ServicesList services={listing.services} />
          )}
          {listing.openingHours && (
            <OpeningHoursTable hours={listing.openingHours} />
          )}
        </section>
      )}
      <Link href="/pro" className="text-accent underline">
        Retour à mon espace pro
      </Link>
    </main>
  );
}
