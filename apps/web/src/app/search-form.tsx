"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { capturePosition } from "@/lib/geolocation";
import type { Category, Commune } from "@/lib/listings";
import {
  hasCriterion,
  MAX_QUERY_LENGTH,
  searchHref,
  type SearchCriteria,
} from "@/lib/search";

/**
 * What the visitor looks for, where (contract §4.1). Used on the home page
 * and above the results, prefilled there with the current search.
 */
export function SearchForm({
  categories,
  communes,
  initial = {},
}: {
  categories: Category[];
  communes: Commune[];
  initial?: SearchCriteria;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initial.q ?? "");
  const [category, setCategory] = useState(initial.category ?? "");
  const [commune, setCommune] = useState(initial.commune ?? "");
  const [position, setPosition] = useState(
    initial.lat !== undefined && initial.lng !== undefined
      ? { lat: initial.lat, lng: initial.lng }
      : null,
  );
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function criteria(near = position): SearchCriteria {
    return {
      q: q.trim() || undefined,
      category: category || undefined,
      commune: commune || undefined,
      entityType: initial.entityType,
      view: initial.view,
      ...(near ? near : {}),
    };
  }

  function go(next: SearchCriteria) {
    // The map needs no criterion: it shows everything in the area.
    if (!hasCriterion(next) && next.view !== "map") {
      setMessage(
        "Tapez au moins 2 lettres, ou choisissez une activité ou une commune.",
      );
      return;
    }
    setMessage(null);
    router.push(searchHref(next));
  }

  async function aroundMe() {
    setLocating(true);
    setMessage(null);
    try {
      const { lat, lng } = await capturePosition();
      setPosition({ lat, lng });
      go(criteria({ lat, lng }));
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLocating(false);
    }
  }

  return (
    <form
      role="search"
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        go(criteria());
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Que cherchez-vous ?</span>
        <input
          type="search"
          name="q"
          value={q}
          maxLength={MAX_QUERY_LENGTH}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Couturière, écran de téléphone, pharmacie…"
          className="rounded-md border border-foreground/20 px-3 py-2"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span>Activité</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="rounded-md border border-foreground/20 px-2 py-2"
          >
            <option value="">Toutes</option>
            {categories.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Commune</span>
          <select
            value={commune}
            onChange={(event) => setCommune(event.target.value)}
            className="rounded-md border border-foreground/20 px-2 py-2"
          >
            <option value="">Tout le Grand Lomé</option>
            {communes.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {position && (
        <p className="flex items-center justify-between rounded-md bg-accent/10 px-3 py-2 text-sm">
          Autour de ma position
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => setPosition(null)}
          >
            Retirer
          </button>
        </p>
      )}

      <button
        type="submit"
        className="rounded-md bg-accent px-4 py-3 font-semibold text-white"
      >
        Rechercher
      </button>
      <button
        type="button"
        onClick={() => void aroundMe()}
        disabled={locating}
        className="rounded-md border border-accent px-4 py-3 font-semibold text-accent disabled:opacity-60"
      >
        {locating ? "Recherche de votre position…" : "Autour de moi"}
      </button>
      {message && (
        <p role="alert" className="text-sm text-red-700">
          {message}
        </p>
      )}
    </form>
  );
}
