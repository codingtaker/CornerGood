"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  LOCATION_LABELS,
  type Commune,
  type LocationType,
  type OwnListing,
} from "@/lib/listings";
import {
  PositionCapture,
  type LocatedPosition,
} from "../nouvelle/position-capture";

const field = "rounded-md border border-foreground/30 px-3 py-2 text-base";
const TYPES: LocationType[] = ["FIXED", "HOME_BASED", "MOBILE"];

type Location = NonNullable<OwnListing["location"]>;

/** The saved point, as if just checked: it was confirmed when it was saved. */
function savedPosition(location: Location): LocatedPosition | null {
  if (!location.point) return null;
  return {
    ...location.point,
    source: location.source === "DEVICE_GPS" ? "DEVICE_GPS" : "MANUAL_PIN",
    accuracyM: location.accuracyM,
    capturedAt: location.capturedAt,
    proposedCommuneId: location.commune.id,
    confirmed: true,
  };
}

/**
 * Corrects where a draft, or a rejected listing, takes place: a pin moved, a
 * wrong commune, a fixed place that is in fact mobile (S4). Saving a rejected
 * listing makes it a draft again, to send once corrected.
 */
export function LocationEditor({
  listingId,
  location,
  communes,
}: {
  listingId: string;
  location: Location;
  communes: Commune[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<LocationType>(location.type);
  const [position, setPosition] = useState(() => savedPosition(location));
  const [communeId, setCommuneId] = useState(location.commune.id);
  const [served, setServed] = useState(
    location.servedCommunes.map((commune) => commune.id),
  );
  const [addressHint, setAddressHint] = useState(location.addressHint ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reset() {
    setType(location.type);
    setPosition(savedPosition(location));
    setCommuneId(location.commune.id);
    setServed(location.servedCommunes.map((commune) => commune.id));
    setAddressHint(location.addressHint ?? "");
    setErrors({});
    setMessage(null);
  }

  function chooseType(next: LocationType) {
    setType(next);
    // A mobile activity has no point; a point taken elsewhere is not reused.
    if (next === "MOBILE") setPosition(null);
    setErrors({});
  }

  function positionChanged(located: LocatedPosition) {
    setPosition(located);
    // Proposed, never imposed (ADR-044).
    if (
      located.proposedCommuneId &&
      located.proposedCommuneId !== position?.proposedCommuneId
    ) {
      setCommuneId(located.proposedCommuneId);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Choosing "mobile" already cleared the point.
    const point = position;
    if (point && !point.confirmed) {
      setMessage("Vérifiez les champs indiqués.");
      setErrors({
        "location.point":
          "Vérifiez l'épingle sur la carte, puis touchez « Oui, c'est ici ».",
      });
      return;
    }
    setPending(true);
    setErrors({});
    setMessage(null);
    try {
      const response = await fetch(
        `/api/v1/pro/listings/${listingId}/location`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            location: {
              type,
              communeId,
              point: point ? { lat: point.lat, lng: point.lng } : null,
              source: point?.source ?? null,
              accuracyM: point?.accuracyM ?? null,
              capturedAt: point?.capturedAt ?? null,
              addressHint: type === "FIXED" ? addressHint : "",
              servedCommuneIds: type === "MOBILE" ? served : [],
            },
          }),
        },
      );
      if (response.ok) {
        setOpen(false);
        router.refresh();
      } else {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
          fields?: Record<string, string>;
        };
        setMessage(body.message ?? "Une erreur est survenue. Réessayez.");
        setErrors(body.fields ?? {});
      }
    } catch {
      setMessage("Connexion impossible. Vérifiez votre réseau et réessayez.");
    }
    setPending(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="self-start text-accent underline"
      >
        Modifier le lieu
      </button>
    );
  }

  const error = (name: string) =>
    errors[name] ? (
      <span className="text-sm text-red-700">{errors[name]}</span>
    ) : null;

  return (
    <form
      onSubmit={save}
      className="flex flex-col gap-4 rounded-md border border-foreground/20 p-4"
      noValidate
    >
      <h2 className="text-lg font-semibold">Modifier le lieu</h2>
      <fieldset className="flex flex-col gap-1">
        <legend className="font-medium">Type de lieu</legend>
        {TYPES.map((choice) => (
          <label key={choice} className="flex items-center gap-2">
            <input
              type="radio"
              name="type"
              checked={type === choice}
              onChange={() => chooseType(choice)}
            />
            {LOCATION_LABELS[choice]}
          </label>
        ))}
        {error("location.type")}
      </fieldset>

      {type !== "MOBILE" && (
        <section className="flex flex-col gap-2">
          {type === "HOME_BASED" && (
            <p className="text-sm opacity-80">
              Facultatif. Le public ne verra qu&apos;un secteur d&apos;environ
              500 m.
            </p>
          )}
          <PositionCapture
            position={position}
            onChange={positionChanged}
            withMap={type === "FIXED"}
            communes={communes}
            buttonLabel={
              type === "FIXED"
                ? "Relever ma position ici"
                : "Relever la position de mon domicile"
            }
          />
          {error("location.point")}
        </section>
      )}

      <label className="flex flex-col gap-1">
        <span className="font-medium">
          {type === "MOBILE" ? "Commune où vous êtes basé" : "Commune"}
        </span>
        <select
          value={communeId}
          onChange={(event) => setCommuneId(event.target.value)}
          className={field}
        >
          <option value="">Choisissez…</option>
          {communes.map((commune) => (
            <option key={commune.id} value={commune.id}>
              {commune.name}
            </option>
          ))}
        </select>
        {error("location.communeId")}
      </label>

      {type === "MOBILE" && (
        <fieldset className="flex flex-col gap-1">
          <legend className="font-medium">Communes où vous intervenez</legend>
          <div className="grid grid-cols-2 gap-1">
            {communes.map((commune) => (
              <label key={commune.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={served.includes(commune.id)}
                  onChange={(event) =>
                    setServed((current) =>
                      event.target.checked
                        ? [...current, commune.id]
                        : current.filter((id) => id !== commune.id),
                    )
                  }
                />
                {commune.name}
              </label>
            ))}
          </div>
          {error("location.servedCommuneIds")}
        </fieldset>
      )}

      {type === "FIXED" && (
        <label className="flex flex-col gap-1">
          <span className="font-medium">Repère (facultatif)</span>
          <input
            value={addressHint}
            onChange={(event) => setAddressHint(event.target.value)}
            placeholder="Ex. : en face de la pharmacie, portail bleu"
            maxLength={200}
            className={field}
          />
          {error("location.addressHint")}
        </label>
      )}

      {message && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-800">
          {message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-4 py-3 font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Enregistrement…" : "Enregistrer le lieu"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        disabled={pending}
        className="text-accent underline"
      >
        Annuler
      </button>
    </form>
  );
}
