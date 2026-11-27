"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CatalogueService, ListedService } from "@/lib/listings";

/** Same limit as the API. */
const MAX_DETAILS = 300;

/**
 * The services of a draft, ticked in the catalogue of its category, each with
 * what the listing adds ("écrans Tecno et Infinix", ADR-006). A service
 * missing from the catalogue goes in the description; the team adds it to the
 * catalogue if it comes back often (ADR-024).
 */
export function ServicesEditor({
  listingId,
  catalogue,
  initial,
}: {
  listingId: string;
  catalogue: CatalogueService[];
  initial: ListedService[];
}) {
  const router = useRouter();
  const [ticked, setTicked] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial.map((s) => [s.id, s.details ?? ""])),
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setPending(true);
    setMessage(null);
    setSaved(false);
    try {
      const response = await fetch(
        `/api/v1/pro/listings/${listingId}/services`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            services: catalogue
              .filter((service) => service.id in ticked)
              .map((service) => ({
                serviceId: service.id,
                details: ticked[service.id],
              })),
          }),
        },
      );
      if (response.ok) {
        setSaved(true);
        router.refresh();
      } else {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
          fields?: Record<string, string>;
        };
        setMessage(
          Object.values(body.fields ?? {})[0] ??
            body.message ??
            "Une erreur est survenue. Réessayez.",
        );
      }
    } catch {
      setMessage("Connexion impossible. Vérifiez votre réseau et réessayez.");
    }
    setPending(false);
  }

  if (catalogue.length === 0) {
    return (
      <p className="text-sm opacity-70">
        Pas encore de services proposés pour cette catégorie : décrivez-les dans
        la description.
      </p>
    );
  }
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Services proposés</h2>
      <ul className="flex flex-col gap-2">
        {catalogue.map((service) => {
          const on = service.id in ticked;
          return (
            <li key={service.id} className="flex flex-col gap-1">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(event) => {
                    setSaved(false);
                    setTicked((current) => {
                      const next = { ...current };
                      if (event.target.checked) next[service.id] = "";
                      else delete next[service.id];
                      return next;
                    });
                  }}
                />
                {service.name}
              </label>
              {on && (
                <input
                  value={ticked[service.id]}
                  onChange={(event) => {
                    setSaved(false);
                    setTicked((current) => ({
                      ...current,
                      [service.id]: event.target.value,
                    }));
                  }}
                  maxLength={MAX_DETAILS}
                  placeholder="Précision (facultatif)"
                  aria-label={`${service.name} : précision`}
                  className="ml-6 rounded-md border border-foreground/30 px-3 py-2 text-base"
                />
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-sm opacity-70">
        Un service manque ? Décrivez-le dans la description de la fiche.
      </p>
      {message && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-800">
          {message}
        </p>
      )}
      {saved && (
        <p
          role="status"
          className="rounded-md bg-green-50 px-3 py-2 text-green-900"
        >
          Services enregistrés.
        </p>
      )}
      <button
        type="button"
        onClick={() => void save()}
        disabled={pending}
        className="rounded-md border border-foreground/30 px-4 py-3 font-semibold disabled:opacity-60"
      >
        {pending ? "Enregistrement…" : "Enregistrer les services"}
      </button>
    </section>
  );
}
