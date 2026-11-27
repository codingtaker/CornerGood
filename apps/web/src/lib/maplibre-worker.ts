/**
 * MapLibre 6 looks for its worker next to its own file, which the bundler
 * renames: without this, sources other than raster tiles (pins, circles,
 * commune borders) never draw. The bundler publishes the file on our origin,
 * so the CSP (worker-src 'self') allows it.
 */
export function setWorkerUrl(maplibre: {
  setWorkerUrl: (url: string) => void;
}): void {
  maplibre.setWorkerUrl(
    new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href,
  );
}
