"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  countLabel,
  formatDistance,
  searchHref,
  type SearchCriteria,
  type SearchPage,
  type SearchResult,
} from "@/lib/search";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "done"; page: SearchPage };

const WHERE_LABEL: Record<SearchResult["locationType"], string> = {
  FIXED: "",
  MOBILE: "Se déplace",
  HOME_BASED: "À domicile",
};

/**
 * Asked from the browser, through the /api/v1 rewrite: the API then counts
 * the searches of each visitor, not those of the web server (§9), and the
 * position never goes through the pages' own server.
 */
export function SearchResults({
  criteria,
  query,
}: {
  criteria: SearchCriteria;
  query: string;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/search?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (response.ok) {
          setState({ kind: "done", page: body as SearchPage });
          return;
        }
        const message =
          (body as { message?: string } | null)?.message ??
          "La recherche n'a pas abouti. Réessayez dans un instant.";
        setState({ kind: "error", message });
      })
      .catch((error: unknown) => {
        if ((error as Error).name === "AbortError") return;
        setState({
          kind: "error",
          message: "Pas de connexion. Vérifiez le réseau, puis réessayez.",
        });
      });
    return () => controller.abort();
  }, [query]);

  if (state.kind === "loading") {
    return <p aria-live="polite">Recherche en cours…</p>;
  }
  if (state.kind === "error") {
    return (
      <p role="alert" className="text-red-700">
        {state.message}
      </p>
    );
  }

  const { data, meta } = state.page;
  const lastPage = Math.max(1, Math.ceil(meta.total / meta.limit));
  if (meta.total === 0) {
    return (
      <div aria-live="polite" className="flex flex-col gap-2">
        <p className="font-semibold">Aucune activité trouvée.</p>
        <p className="text-sm opacity-80">
          Essayez un autre mot, une autre commune, ou retirez un critère.
        </p>
      </div>
    );
  }

  return (
    <section aria-live="polite" className="flex flex-col gap-3">
      <p className="text-sm opacity-80">{countLabel(meta.total)}</p>
      <ul className="flex flex-col gap-3">
        {data.map((result) => (
          <li key={result.slug}>
            <ResultCard result={result} />
          </li>
        ))}
      </ul>
      {lastPage > 1 && (
        <nav className="flex items-center justify-between text-sm">
          {meta.page > 1 ? (
            <Link
              href={searchHref({ ...criteria, page: meta.page - 1 })}
              className="font-semibold text-accent underline"
            >
              Page précédente
            </Link>
          ) : (
            <span />
          )}
          <span>
            Page {meta.page} sur {lastPage}
          </span>
          {meta.page < lastPage ? (
            <Link
              href={searchHref({ ...criteria, page: meta.page + 1 })}
              className="font-semibold text-accent underline"
            >
              Page suivante
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </section>
  );
}

function ResultCard({ result }: { result: SearchResult }) {
  const where = WHERE_LABEL[result.locationType];
  return (
    <Link
      href={`/fiches/${encodeURIComponent(result.slug)}`}
      className="flex gap-3 rounded-md border border-foreground/15 p-3"
    >
      {result.coverPhotoUrl ? (
        // Approved photos only; cached briefly, no next/image optimisation.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={result.coverPhotoUrl}
          alt=""
          loading="lazy"
          className="h-20 w-20 shrink-0 rounded-md bg-foreground/5 object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md bg-accent/10 text-2xl font-bold text-accent"
        >
          {result.name.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-semibold">{result.name}</span>
        <span className="text-sm">{result.category.name}</span>
        {result.matchedServices.length > 0 && (
          <span className="truncate text-sm text-accent">
            {result.matchedServices.join(", ")}
          </span>
        )}
        <span className="text-sm opacity-80">
          {[
            result.commune.name,
            where,
            result.distanceMeters !== null
              ? `à ${formatDistance(result.distanceMeters)}`
              : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {result.verificationStatus === "VERIFIED" && (
          <span className="text-xs font-semibold text-green-800">
            Vérifiée par l&apos;équipe
          </span>
        )}
      </div>
    </Link>
  );
}
