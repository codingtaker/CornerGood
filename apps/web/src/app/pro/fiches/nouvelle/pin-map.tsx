"use client";

import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { MAP_ATTRIBUTION, TILES_URL } from "@/lib/map-tiles";

export interface MapPoint {
  lat: number;
  lng: number;
}

interface PinMapProps {
  /** Null until a point is placed by hand. */
  point: MapPoint | null;
  /** Radius of the uncertainty circle, for a GPS position. */
  accuracyM: number | null;
  /** The pin was put down or dragged by hand. */
  onMoved: (point: MapPoint) => void;
}

/** West, south, east, north of Grand Lomé, with a little margin. */
const GRAND_LOME: [number, number, number, number] = [1.07, 6.1, 1.36, 6.33];

/** Polygon of the accuracy circle (MapLibre circles are in pixels). */
function circle({ lat, lng }: MapPoint, radiusM: number): GeoJSON.Feature {
  const dLat = radiusM / 111_320;
  const dLng = dLat / Math.cos((lat * Math.PI) / 180);
  const ring = Array.from({ length: 49 }, (_, i) => {
    const angle = (i / 48) * 2 * Math.PI;
    return [lng + dLng * Math.cos(angle), lat + dLat * Math.sin(angle)];
  });
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

const EMPTY: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

/** Map to check or place the pin of a listing (ADR-001, ADR-041). */
export function PinMap({ point, accuracyM, onMoved }: PinMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const latest = useRef({ point, onMoved });
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    latest.current = { point, onMoved };
  });

  useEffect(() => {
    let cancelled = false;
    // Loaded only when a map is shown: it is the heaviest part of the page.
    import("maplibre-gl")
      .then((maplibre) => {
        if (cancelled || !container.current) return;
        // MapLibre 6 looks for its worker next to its own file, which the
        // bundler renames: without this, the pin, the circle and the commune
        // borders never draw. The bundler publishes the file on our origin,
        // so the CSP (worker-src 'self') allows it.
        maplibre.setWorkerUrl(
          new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url)
            .href,
        );
        const start = latest.current.point;
        const map = new maplibre.Map({
          container: container.current,
          attributionControl: { compact: false },
          dragRotate: false,
          pitchWithRotate: false,
          maxZoom: 19,
          ...(start
            ? { center: [start.lng, start.lat], zoom: 17 }
            : { bounds: GRAND_LOME }),
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
              communes: {
                type: "geojson",
                data: new URL("/data/communes.geojson", window.location.href)
                  .href,
              },
              accuracy: { type: "geojson", data: EMPTY },
            },
            layers: [
              { id: "tiles", type: "raster", source: "tiles" },
              {
                id: "communes",
                type: "line",
                source: "communes",
                paint: { "line-color": "#e8590c", "line-width": 1.5 },
              },
              {
                id: "accuracy",
                type: "fill",
                source: "accuracy",
                paint: { "fill-color": "#e8590c", "fill-opacity": 0.15 },
              },
            ],
          },
        });
        map.touchZoomRotate.disableRotation();
        map.addControl(
          new maplibre.NavigationControl({ showCompass: false }),
          "top-right",
        );
        const marker = new maplibre.Marker({
          color: "#e8590c",
          draggable: true,
        });
        const moved = ({ lat, lng }: MapPoint) =>
          latest.current.onMoved({
            // Six decimals: about 10 cm.
            lat: Number(lat.toFixed(6)),
            lng: Number(lng.toFixed(6)),
          });
        marker.on("dragend", () => moved(marker.getLngLat()));
        map.on("click", (event) => moved(event.lngLat));
        map.on("load", () => !cancelled && setReady(true));
        mapRef.current = map;
        markerRef.current = marker;
      })
      // No WebGL, or the library could not be downloaded.
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  const lat = point?.lat;
  const lng = point?.lng;
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!ready || !map || !marker) return;
    const source = map.getSource<GeoJSONSource>("accuracy");
    if (lat === undefined || lng === undefined) {
      marker.remove();
      source?.setData(EMPTY);
      return;
    }
    marker.setLngLat([lng, lat]).addTo(map);
    source?.setData(accuracyM ? circle({ lat, lng }, accuracyM) : EMPTY);
    // A new GPS reading can be off screen; a pin placed by hand never is.
    if (!map.getBounds().contains([lng, lat])) {
      map.jumpTo({ center: [lng, lat], zoom: 17 });
    }
  }, [ready, lat, lng, accuracyM]);

  if (failed) {
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-800">
        La carte ne peut pas s&apos;afficher sur cet appareil ou sans réseau.
      </p>
    );
  }
  return (
    <div
      ref={container}
      aria-label="Carte pour placer l'épingle"
      className="h-72 w-full overflow-hidden rounded-md border border-foreground/30"
    />
  );
}
