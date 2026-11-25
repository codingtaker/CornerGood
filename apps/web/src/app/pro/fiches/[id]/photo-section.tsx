"use client";

import { useState, type ChangeEvent } from "react";
import {
  MAX_PHOTOS,
  PHOTO_STATUS_LABELS,
  type LocationType,
  type OwnPhoto,
} from "@/lib/listings";
import { preparePhoto } from "@/lib/photo";

interface PhotoSectionProps {
  listingId: string;
  initialPhotos: OwnPhoto[];
  /** False while the listing is under review or published. */
  editable: boolean;
  locationType: LocationType | null;
}

/** Photos of one's own listing: added one by one, each awaiting approval. */
export function PhotoSection({
  listingId,
  initialPhotos,
  editable,
  locationType,
}: PhotoSectionProps) {
  const [photos, setPhotos] = useState(initialPhotos);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/v1/pro/listings/${listingId}/media`;

  async function send(request: () => Promise<Response>) {
    try {
      const response = await request();
      if (response.ok) return response;
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      setError(body.message ?? "Une erreur est survenue. Réessayez.");
    } catch {
      setError("Connexion impossible. Vérifiez votre réseau et réessayez.");
    }
    return null;
  }

  async function add(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setError(null);
    setPending("Préparation de la photo…");
    try {
      const photo = await preparePhoto(file);
      setPending("Envoi de la photo…");
      const form = new FormData();
      // The original name can say where or who: it is not sent.
      form.append("file", photo, "photo");
      const response = await send(() =>
        fetch(url, { method: "POST", body: form }),
      );
      if (response) {
        const body = (await response.json()) as { photo: OwnPhoto };
        setPhotos((current) => [...current, body.photo]);
      }
    } catch (failure) {
      setError((failure as Error).message);
    }
    // The same file can be chosen again after a failure.
    input.value = "";
    setPending(null);
  }

  async function remove(photo: OwnPhoto) {
    if (!window.confirm("Supprimer cette photo ?")) return;
    setError(null);
    setPending("Suppression…");
    const response = await send(() =>
      fetch(`${url}/${photo.id}`, { method: "DELETE" }),
    );
    if (response) {
      setPhotos((current) => {
        const left = current.filter((other) => other.id !== photo.id);
        // As the API does: the next photo becomes the cover.
        return photo.isCover
          ? left.map((other, index) => ({ ...other, isCover: index === 0 }))
          : left;
      });
    }
    setPending(null);
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">
        Photos ({photos.length}/{MAX_PHOTOS})
      </h2>
      {photos.length > 0 && (
        <ul className="grid grid-cols-2 gap-3">
          {photos.map((photo, index) => (
            <li key={photo.id} className="flex flex-col gap-1">
              {/* Private and never cached: nothing for next/image to optimise. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${url}/${photo.id}`}
                alt={`Photo ${index + 1} de la fiche`}
                className="aspect-[4/3] w-full rounded-md bg-foreground/5 object-cover"
              />
              <span className="text-sm opacity-80">
                {PHOTO_STATUS_LABELS[photo.status] ?? photo.status}
                {photo.isCover && " · couverture"}
              </span>
              {editable && (
                <button
                  type="button"
                  onClick={() => remove(photo)}
                  disabled={pending !== null}
                  aria-label={`Supprimer la photo ${index + 1}`}
                  className="self-start text-sm text-red-700 underline disabled:opacity-60"
                >
                  Supprimer
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && photos.length < MAX_PHOTOS && (
        <>
          <label className="cursor-pointer rounded-md border border-dashed border-foreground/40 px-4 py-3 text-center font-semibold focus-within:ring-2 focus-within:ring-accent">
            {pending ?? "Ajouter une photo"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={add}
              disabled={pending !== null}
              aria-label="Ajouter une photo"
              className="sr-only"
            />
          </label>
          <p className="text-sm opacity-70">
            La position enregistrée dans la photo est toujours retirée. Chaque
            photo est vérifiée avant d&apos;être publique.
            {locationType === "HOME_BASED" &&
              " Ne montrez ni votre façade, ni le numéro de votre maison : la photo révélerait votre adresse."}
          </p>
        </>
      )}

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-800">
          {error}
        </p>
      )}
    </section>
  );
}
