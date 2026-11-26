import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  formatDate,
  LOCATION_LABELS,
  type QueuedListing,
} from "@/lib/listings";
import { ADMIN_ROLES, apiFetch, getCurrentUser } from "@/lib/session";
import { AccessDenied } from "../access-denied";

export const metadata: Metadata = { title: "File de modération · CornerGood" };

/** Listings awaiting a decision, the oldest submission first (S4). */
export default async function ModerationQueuePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion?suivant=/admin/moderation");
  if (!ADMIN_ROLES.includes(user.role)) return <AccessDenied />;

  const response = await apiFetch("/admin/moderation");
  const listings = response.ok
    ? ((await response.json()) as { listings: QueuedListing[] }).listings
    : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-4 py-8">
      <div>
        <Link href="/admin" className="text-sm text-accent underline">
          Modération
        </Link>
        <h1 className="text-2xl font-bold">Fiches à examiner</h1>
      </div>

      {listings === null && (
        <p role="alert">La file est indisponible pour le moment.</p>
      )}
      {listings?.length === 0 && (
        <p role="status" className="opacity-80">
          Aucune fiche n&apos;attend de décision.
        </p>
      )}
      {listings && listings.length > 0 && (
        <ol className="flex flex-col gap-3">
          {listings.map((listing) => (
            <li key={listing.id}>
              <Link
                href={`/admin/fiches/${listing.id}`}
                className="flex flex-col gap-1 rounded-md border border-foreground/20 p-4 focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="font-semibold">{listing.name}</span>
                <span className="text-sm opacity-80">
                  {listing.category}
                  {listing.commune && ` · ${listing.commune}`}
                  {listing.locationType &&
                    ` · ${LOCATION_LABELS[listing.locationType]}`}
                </span>
                <span className="text-sm opacity-70">
                  Envoyée le {formatDate(listing.submittedAt)}
                  {listing.pendingPhotos > 0 &&
                    ` · ${listing.pendingPhotos} photo${listing.pendingPhotos > 1 ? "s" : ""} à vérifier`}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
