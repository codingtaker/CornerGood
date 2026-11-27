import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { API_URL } from "@/lib/api-url";
import {
  callLink,
  directionsLink,
  displayPhone,
  whatsappLink,
} from "@/lib/contact-links";
import { formatDate, type PublicListing } from "@/lib/listings";
import { PlaceMapLoader } from "./place-map-loader";
import { ReportForm } from "./report-form";

/**
 * The listing as anyone sees it (contract §4.2), the address shared on
 * WhatsApp. Read again at most every 60 seconds, as the API's cache says:
 * a suspended listing disappears quickly (ADR-022).
 */
const loadListing = cache(
  async (slug: string): Promise<PublicListing | null> => {
    const response = await fetch(
      `${API_URL}/listings/${encodeURIComponent(slug)}`,
      { next: { revalidate: 60 } },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`API answered ${response.status}`);
    return ((await response.json()) as { listing: PublicListing }).listing;
  },
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const listing = await loadListing((await params).slug);
  if (!listing) return { title: "Fiche introuvable · CornerGood" };
  const where = listing.location ? ` à ${listing.location.commune.name}` : "";
  const description = `${listing.category.name}${where}. Sur CornerGood, les activités du Grand Lomé.`;
  return {
    title: `${listing.name} · CornerGood`,
    description,
    openGraph: { title: listing.name, description, type: "website" },
  };
}

export default async function PublicListingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const listing = await loadListing((await params).slug);
  if (!listing) notFound();

  const { location } = listing;
  const photo = (id: string) =>
    `/api/v1/listings/${encodeURIComponent(listing.slug)}/photos/${id}`;
  const [cover, ...others] = listing.photos;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-4 py-6">
      <Link href="/" className="text-sm font-semibold text-accent">
        CornerGood
      </Link>

      {cover && (
        // Approved photos only; cached briefly, no next/image optimisation.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo(cover.id)}
          alt={`Photo : ${listing.name}`}
          className="aspect-[4/3] w-full rounded-md bg-foreground/5 object-cover"
        />
      )}

      <div>
        <h1 className="text-2xl font-bold">{listing.name}</h1>
        <p className="opacity-80">
          {listing.category.name}
          {listing.entityType === "COMMUNITY" && " · Lieu communautaire"}
        </p>
        {listing.verificationStatus === "VERIFIED" && (
          <p className="mt-1 text-sm font-medium text-green-800">
            Informations vérifiées par CornerGood
          </p>
        )}
      </div>

      {(listing.phone || listing.whatsapp) && (
        <div
          className={`grid gap-3 ${listing.phone && listing.whatsapp ? "grid-cols-2" : "grid-cols-1"}`}
        >
          {listing.phone && (
            <a
              href={callLink(listing.phone)}
              className="rounded-md bg-accent px-4 py-3 text-center font-semibold text-white"
            >
              Appeler
              <span className="block text-sm font-normal">
                {displayPhone(listing.phone)}
              </span>
            </a>
          )}
          {listing.whatsapp && (
            <a
              href={whatsappLink(listing.whatsapp, listing.name)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-foreground/30 px-4 py-3 text-center font-semibold"
            >
              WhatsApp
              <span className="block text-sm font-normal">
                {displayPhone(listing.whatsapp)}
              </span>
            </a>
          )}
        </div>
      )}

      {listing.description && (
        <p className="whitespace-pre-line">{listing.description}</p>
      )}

      {location && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Où ?</h2>
          {location.type === "FIXED" && (
            <p>
              {location.commune.name}
              {location.addressHint && ` · ${location.addressHint}`}
            </p>
          )}
          {location.type === "HOME_BASED" && (
            <p>
              À domicile, secteur de {location.commune.name}. L&apos;adresse
              exacte se demande par téléphone.
            </p>
          )}
          {location.type === "MOBILE" && (
            <p>
              Se déplace chez ses clients :{" "}
              {location.servedCommunes.map((c) => c.name).join(", ")}.
            </p>
          )}
          {location.position && (
            <PlaceMapLoader
              point={location.position}
              approximate={location.approximate}
              label={
                location.approximate
                  ? `Secteur de ${listing.name}`
                  : `Emplacement de ${listing.name}`
              }
            />
          )}
          {location.position && !location.approximate && (
            <a
              href={directionsLink(location.position)}
              target="_blank"
              rel="noopener noreferrer"
              className="self-start font-semibold text-accent underline"
            >
              Itinéraire
            </a>
          )}
        </section>
      )}

      {others.length > 0 && (
        <section className="grid grid-cols-2 gap-3">
          {others.map((other, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={other.id}
              src={photo(other.id)}
              alt={`Photo ${index + 2} : ${listing.name}`}
              loading="lazy"
              className="aspect-[4/3] w-full rounded-md bg-foreground/5 object-cover"
            />
          ))}
        </section>
      )}

      <p className="text-sm opacity-60">
        Mise à jour le {formatDate(listing.updatedAt)}
      </p>
      <ReportForm slug={listing.slug} />
    </main>
  );
}
