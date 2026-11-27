"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { circle, type MapPoint } from "@/lib/map-shapes";
import { MAP_ATTRIBUTION, TILES_URL } from "@/lib/map-tiles";
import { setWorkerUrl } from "@/lib/maplibre-worker";

/** Half of the grid of public_locations (about 550 m): the sector shown. */
const SECTOR_RADIUS_M = 350;

/**
 * Where a published listing is, for the public: a pin for a fixed place, a
 * sector for a home, never its exact point (ADR-046). Read-only.
 */
export function PlaceMap({
  point,
  approximate,
  label,
}: {
  point: MapPoint;
  approximate: boolean;
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let remove = () => {};
    import("maplibre-gl")
      .then((maplibre) => {
        if (cancelled || !container.current) return;
        setWorkerUrl(maplibre);
        const map = new maplibre.Map({
          container: container.current,
          attributionControl: { compact: false },
          dragRotate: false,
          pitchWithRotate: false,
          maxZoom: approximate ? 15 : 19,
          center: [point.lng, point.lat],
          zoom: approximate ? 14 : 16,
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
              sector: {
                type: "geojson",
                data: approximate
                  ? circle(point, SECTOR_RADIUS_M)
                  : { type: "FeatureCollection", features: [] },
              },
            },
            layers: [
              { id: "tiles", type: "raster", source: "tiles" },
              {
                id: "sector",
                type: "fill",
                source: "sector",
                paint: { "fill-color": "#e8590c", "fill-opacity": 0.2 },
              },
            ],
          },
        });
        map.touchZoomRotate.disableRotation();
        map.addControl(
          new maplibre.NavigationControl({ showCompass: false }),
          "top-right",
        );
        if (!approximate) {
          new maplibre.Marker({ color: "#e8590c" })
            .setLngLat([point.lng, point.lat])
            .addTo(map);
        }
        remove = () => map.remove();
      })
      // No WebGL, or the library could not be downloaded.
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      remove();
    };
  }, [point, approximate]);

  if (failed) {
    return (
      <p className="text-sm opacity-70">
        La carte ne peut pas s&apos;afficher sur cet appareil ou sans réseau.
      </p>
    );
  }
  return (
    <div
      ref={container}
      role="img"
      aria-label={label}
      className="h-64 w-full overflow-hidden rounded-md border border-foreground/30"
    />
  );
}
