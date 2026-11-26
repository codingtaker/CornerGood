"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  MAX_REASON_LENGTH,
  PHOTO_STATUS_LABELS,
  type OwnPhoto,
} from "@/lib/listings";
import { sendDecision } from "./listing-decision";

/**
 * Photos of a listing, each validated or refused on its own by a moderator
 * or the administrator (ADR-039). Only a photo awaiting a decision, on a
 * listing sent for validation, offers the buttons.
 */
export function PhotoReview({
  photos,
  decidable,
}: {
  photos: OwnPhoto[];
  decidable: boolean;
}) {
  const router = useRouter();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function decide(photo: OwnPhoto, action: "approve" | "reject") {
    const reason = reasons[photo.id] ?? "";
    if (action === "reject" && reason.trim() === "") {
      setErrors({ [photo.id]: "Écrivez pourquoi la photo est refusée." });
      return;
    }
    setPending(photo.id);
    setErrors({});
    const refused = await sendDecision(
      `/api/v1/admin/media/${photo.id}/${action}`,
      action === "reject" ? reason : undefined,
    );
    setPending(null);
    if (refused) setErrors({ [photo.id]: refused });
    router.refresh();
  }

  if (photos.length === 0) {
    return <p className="opacity-80">Aucune photo.</p>;
  }
  return (
    <ul className="flex flex-col gap-4">
      {photos.map((photo, index) => (
        <li key={photo.id} className="flex flex-col gap-2">
          {/* Private and never cached: nothing for next/image to optimise. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/v1/admin/media/${photo.id}`}
            alt={`Photo ${index + 1} de la fiche`}
            className="aspect-[4/3] w-full rounded-md bg-foreground/5 object-cover"
          />
          <span className="text-sm opacity-80">
            {PHOTO_STATUS_LABELS[photo.status] ?? photo.status}
            {photo.isCover && " · couverture"}
          </span>
          {photo.rejectionReason && (
            <span className="text-sm text-red-800">
              {photo.rejectionReason}
            </span>
          )}
          {decidable && photo.status === "PENDING" && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void decide(photo, "approve")}
                disabled={pending !== null}
                aria-label={`Valider la photo ${index + 1}`}
                className="rounded-md border border-foreground/30 px-4 py-2 font-semibold disabled:opacity-60"
              >
                Valider
              </button>
              <input
                value={reasons[photo.id] ?? ""}
                onChange={(event) =>
                  setReasons((current) => ({
                    ...current,
                    [photo.id]: event.target.value,
                  }))
                }
                maxLength={MAX_REASON_LENGTH}
                placeholder="Motif du refus"
                aria-label={`Motif du refus de la photo ${index + 1}`}
                className="rounded-md border border-foreground/30 px-3 py-2 text-base"
              />
              <button
                type="button"
                onClick={() => void decide(photo, "reject")}
                disabled={pending !== null}
                aria-label={`Refuser la photo ${index + 1}`}
                className="rounded-md border border-red-700 px-4 py-2 font-semibold text-red-700 disabled:opacity-60"
              >
                Refuser
              </button>
            </div>
          )}
          {errors[photo.id] && (
            <p
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-red-800"
            >
              {errors[photo.id]}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
