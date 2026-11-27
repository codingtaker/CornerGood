"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { MAP_ATTRIBUTION, TILES_URL } from "@/lib/map-tiles";
import { setWorkerUrl } from "@/lib/maplibre-worker";
import {
  AROUND_ME_ZOOM,
  GRAND_LOME_CENTER,
  GRAND_LOME_ZOOM,
  mapQuery,
  mapStatus,
  toFeatures,
} from "@/lib/results-map";
import type { SearchCriteria, SearchPage, SearchResult } from "@/lib/search";

const ACCENT = "#e8590c";
/** Wait for the map to stop before asking: one search per move, not per frame. */
const SETTLE_MS = 400;

type Status =
  | { kind: "loading" }
  | { kind: "done"; text: string }
  | { kind: "error"; text: string };

/** The card of a tapped listing, built from nodes: names are never parsed as HTML. */
function card(result: SearchResult): HTMLElement {
  const box = document.createElement("div");
  box.className = "flex flex-col gap-0.5 text-sm";
  const name = document.createElement("strong");
  name.textContent = result.name;
  const what = document.createElement("span");
  what.textContent = [
    result.category.name,
    result.commune.name,
    result.locationType === "HOME_BASED" ? "À domicile (secteur)" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const link = document.createElement("a");
  link.href = `/fiches/${encodeURIComponent(result.slug)}`;
  link.textContent = "Voir la fiche";
  link.className = "font-semibold text-accent underline";
  box.append(name, what, link);
  return box;
}

/**
 * The results of /recherche on a map (contract §4.1, bbox): the best 50 of
 * the visible area, asked again each time the map stops moving. A fixed place
 * is a dot, a home a sector of about 550 m (ADR-046); mobile activities have
 * no point and stay in the list.
 *
 * The tile server sees the area displayed: that is why the map only opens
 * when the visitor chooses it.
 */
export function ResultsMap({ criteria }: { criteria: SearchCriteria }) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | null = null;
    const bySlug = new Map<string, SearchResult>();

    import("maplibre-gl")
      .then((maplibre) => {
        if (cancelled || !container.current) return;
        setWorkerUrl(maplibre);
        const around =
          criteria.lat !== undefined && criteria.lng !== undefined
            ? { lat: criteria.lat, lng: criteria.lng }
            : null;
        const center = around ?? GRAND_LOME_CENTER;
        const empty: GeoJSON.FeatureCollection = {
          type: "FeatureCollection",
          features: [],
        };
        const current = new maplibre.Map({
          container: container.current,
          attributionControl: { compact: false },
          dragRotate: false,
          pitchWithRotate: false,
          minZoom: 10,
          maxZoom: 18,
          center: [center.lng, center.lat],
          zoom: around ? AROUND_ME_ZOOM : GRAND_LOME_ZOOM,
          style: {
            version: 8,
            sources: {
              tiles: {
                type: "raster",
                tiles: [TILES_URL],
                tileSize: 256,
                maxzoom: 19,
                attribution: MAP_ATTRIBUTION,
              },
              sectors: { type: "geojson", data: empty },
              points: { type: "geojson", data: empty },
            },
            layers: [
              { id: "tiles", type: "raster", source: "tiles" },
              {
                id: "sectors",
                type: "fill",
                source: "sectors",
                paint: {
                  "fill-color": ACCENT,
                  "fill-opacity": 0.2,
                  "fill-outline-color": ACCENT,
                },
              },
              {
                id: "points",
                type: "circle",
                source: "points",
                paint: {
                  "circle-color": ACCENT,
                  "circle-radius": 8,
                  "circle-stroke-color": "#ffffff",
                  "circle-stroke-width": 2,
                },
              },
            ],
          },
        });
        map = current;
        current.touchZoomRotate.disableRotation();
        current.addControl(
          new maplibre.NavigationControl({ showCompass: false }),
          "top-right",
        );

        const draw = (page: SearchPage) => {
          bySlug.clear();
          for (const result of page.data) bySlug.set(result.slug, result);
          const { points, sectors } = toFeatures(page.data);
          (current.getSource("points") as GeoJSONSource).setData(points);
          (current.getSource("sectors") as GeoJSONSource).setData(sectors);
        };

        const ask = () => {
          request?.abort();
          const controller = new AbortController();
          request = controller;
          setStatus({ kind: "loading" });
          const bounds = current.getBounds();
          const query = mapQuery(criteria, {
            west: bounds.getWest(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            north: bounds.getNorth(),
          });
          fetch(`/api/v1/search?${query}`, { signal: controller.signal })
            .then(async (response) => {
              const body: unknown = await response.json().catch(() => null);
              if (!response.ok) {
                setStatus({
                  kind: "error",
                  text:
                    (body as { message?: string } | null)?.message ??
                    "La recherche n'a pas abouti. Réessayez dans un instant.",
                });
                return;
              }
              const page = body as SearchPage;
              draw(page);
              setStatus({ kind: "done", text: mapStatus(page) });
            })
            .catch((error: unknown) => {
              if ((error as Error).name === "AbortError") return;
              setStatus({
                kind: "error",
                text: "Pas de connexion. Vérifiez le réseau, puis réessayez.",
              });
            });
        };

        current.on("load", ask);
        current.on("moveend", () => {
          clearTimeout(timer);
          timer = setTimeout(ask, SETTLE_MS);
        });

        for (const layer of ["points", "sectors"]) {
          current.on("click", layer, (event) => {
            const slug = event.features?.[0]?.properties?.slug as
              string | undefined;
            const result = slug ? bySlug.get(slug) : undefined;
            if (!result) return;
            new maplibre.Popup({ closeButton: true, maxWidth: "240px" })
              .setLngLat(event.lngLat)
              .setDOMContent(card(result))
              .addTo(current);
          });
          current.on("mouseenter", layer, () => {
            current.getCanvas().style.cursor = "pointer";
          });
          current.on("mouseleave", layer, () => {
            current.getCanvas().style.cursor = "";
          });
        }
      })
      // No WebGL, or the library could not be downloaded.
      .catch(() => !cancelled && setFailed(true));

    return () => {
      cancelled = true;
      clearTimeout(timer);
      request?.abort();
      map?.remove();
    };
  }, [criteria]);

  if (failed) {
    return (
      <p role="alert">
        La carte ne peut pas s&apos;afficher sur cet appareil ou sans réseau.
        Utilisez la liste.
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <div
        ref={container}
        role="region"
        aria-label="Carte des résultats"
        className="h-[60dvh] min-h-80 w-full overflow-hidden rounded-md border border-foreground/30"
      />
      <p
        aria-live="polite"
        role={status.kind === "error" ? "alert" : undefined}
        className={`text-sm ${status.kind === "error" ? "text-red-700" : ""}`}
      >
        {status.kind === "loading" ? "Recherche dans la zone…" : status.text}
      </p>
      <p className="text-xs opacity-70">
        Point : lieu fixe. Cercle : activité à domicile, montrée par son
        secteur. Les activités qui se déplacent n&apos;apparaissent que dans la
        liste.
      </p>
    </section>
  );
}
