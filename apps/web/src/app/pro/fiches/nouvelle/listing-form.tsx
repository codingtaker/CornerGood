"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type {
  Category,
  Commune,
  EntityType,
  LocationType,
} from "@/lib/listings";
import { PositionCapture, type LocatedPosition } from "./position-capture";

interface ListingFormProps {
  communes: Commune[];
  categories: Category[];
}

const CHOICES: { type: LocationType; title: string; text: string }[] = [
  {
    type: "FIXED",
    title: "Je suis devant mon activité",
    text: "Boutique, atelier, kiosque, étal : on relève la position ici, maintenant.",
  },
  {
    type: "HOME_BASED",
    title: "Je travaille à domicile",
    text: "Votre adresse exacte n'est jamais montrée : le public ne voit qu'un secteur d'environ 500 m.",
  },
  {
    type: "MOBILE",
    title: "Je me déplace chez mes clients",
    text: "Pas d'adresse fixe : vous indiquez les communes où vous intervenez.",
  },
];

const field = "rounded-md border border-foreground/30 px-3 py-2 text-base";

/**
 * The listing form (S3): first where the activity happens, with the screen
 * "Je suis devant mon activité" for a fixed place, then what it is. It saves
 * a draft; publishing comes later, after moderation.
 */
export function ListingForm({ communes, categories }: ListingFormProps) {
  const router = useRouter();
  const [locationType, setLocationType] = useState<LocationType | null>(null);
  const [position, setPosition] = useState<LocatedPosition | null>(null);
  const [communeId, setCommuneId] = useState("");
  const [served, setServed] = useState<string[]>([]);
  const [entityType, setEntityType] = useState<EntityType>("BUSINESS");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function choose(type: LocationType) {
    setLocationType(type);
    setPosition(null);
    setCommuneId("");
    setServed([]);
    setErrors({});
    setMessage(null);
  }

  function captured(located: LocatedPosition) {
    setPosition(located);
    // Proposed, not imposed: the list stays editable (ADR-044).
    if (located.proposedCommuneId) setCommuneId(located.proposedCommuneId);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!locationType) return;
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "");

    setPending(true);
    setErrors({});
    setMessage(null);
    try {
      const response = await fetch("/api/v1/pro/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType,
          categoryId: text("categoryId"),
          name: text("name"),
          description: text("description"),
          phone: text("phone"),
          whatsapp: text("whatsapp"),
          location: {
            type: locationType,
            communeId,
            point: position ? { lat: position.lat, lng: position.lng } : null,
            source: position ? "DEVICE_GPS" : null,
            accuracyM: position?.accuracyM ?? null,
            capturedAt: position?.capturedAt ?? null,
            addressHint: text("addressHint"),
            servedCommuneIds: locationType === "MOBILE" ? served : [],
          },
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        listing?: { id: string };
        message?: string;
        fields?: Record<string, string>;
      };
      if (response.ok && body.listing) {
        router.replace(`/pro/fiches/${body.listing.id}`);
        router.refresh();
        return;
      }
      setMessage(body.message ?? "Une erreur est survenue. Réessayez.");
      setErrors(body.fields ?? {});
    } catch {
      setMessage("Connexion impossible. Vérifiez votre réseau et réessayez.");
    }
    setPending(false);
  }

  if (!locationType) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Où exercez-vous ?</h2>
        {CHOICES.map((choice) => (
          <button
            key={choice.type}
            type="button"
            onClick={() => choose(choice.type)}
            className="rounded-md border border-foreground/30 p-4 text-left hover:border-accent"
          >
            <span className="block font-semibold">{choice.title}</span>
            <span className="mt-1 block text-sm opacity-80">{choice.text}</span>
          </button>
        ))}
      </div>
    );
  }

  const choice = CHOICES.find((c) => c.type === locationType);
  const error = (name: string) =>
    errors[name] ? (
      <span className="text-sm text-red-700">{errors[name]}</span>
    ) : null;
  const shownCategories = categories.filter(
    (category) =>
      category.applicableTo === null || category.applicableTo === entityType,
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{choice?.title}</h2>
        <button
          type="button"
          onClick={() => setLocationType(null)}
          className="text-accent underline"
        >
          Changer
        </button>
      </div>

      {locationType !== "MOBILE" && (
        <section className="flex flex-col gap-2">
          {locationType === "HOME_BASED" && (
            <p className="text-sm opacity-80">
              Facultatif : relevez la position chez vous pour proposer la
              commune. Le public ne verra qu&apos;un secteur d&apos;environ 500
              m.
            </p>
          )}
          <PositionCapture
            position={position}
            onCaptured={captured}
            communes={communes}
            buttonLabel={
              locationType === "FIXED"
                ? "Relever ma position ici"
                : "Relever la position de mon domicile"
            }
          />
          {error("location.point")}
        </section>
      )}

      <label className="flex flex-col gap-1">
        <span className="font-medium">
          {locationType === "MOBILE" ? "Commune où vous êtes basé" : "Commune"}
        </span>
        <select
          name="communeId"
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

      {locationType === "MOBILE" && (
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

      {locationType === "FIXED" && (
        <label className="flex flex-col gap-1">
          <span className="font-medium">Repère (facultatif)</span>
          <input
            name="addressHint"
            placeholder="Ex. : en face de la pharmacie, portail bleu"
            maxLength={200}
            className={field}
          />
          {error("location.addressHint")}
        </label>
      )}

      <fieldset className="flex flex-col gap-1">
        <legend className="font-medium">Type de fiche</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={entityType === "BUSINESS"}
            onChange={() => setEntityType("BUSINESS")}
          />
          Activité (commerce, artisan, service…)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={entityType === "COMMUNITY"}
            onChange={() => setEntityType("COMMUNITY")}
          />
          Lieu communautaire (école, centre de santé, association…)
        </label>
      </fieldset>

      <label className="flex flex-col gap-1">
        <span className="font-medium">Catégorie</span>
        <select name="categoryId" defaultValue="" className={field}>
          <option value="">Choisissez…</option>
          {shownCategories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        {error("categoryId")}
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-medium">Nom</span>
        <input name="name" maxLength={120} className={field} />
        {error("name")}
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-medium">Description (facultatif)</span>
        <textarea
          name="description"
          rows={3}
          maxLength={2000}
          className={field}
        />
        {error("description")}
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-medium">Téléphone</span>
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            placeholder="90 12 34 56"
            className={field}
          />
          {error("phone")}
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">WhatsApp</span>
          <input name="whatsapp" type="tel" inputMode="tel" className={field} />
          {error("whatsapp")}
        </label>
      </div>
      <p className="text-sm opacity-70">
        Le téléphone et la description pourront être complétés plus tard : ils
        seront demandés avant l&apos;envoi en modération.
      </p>

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
        {pending ? "Enregistrement…" : "Enregistrer le brouillon"}
      </button>
    </form>
  );
}
