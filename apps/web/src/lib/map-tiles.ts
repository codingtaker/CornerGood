/*
 * Background map (ADR-030). OpenStreetMap's own tiles suit a prototype, not
 * heavy traffic: change NEXT_PUBLIC_MAP_TILES_URL at build time for another
 * provider; the Content-Security-Policy follows it. The tile server sees the
 * visitor's address and the area displayed, so a home is never put on a map
 * (position-capture.tsx).
 */
export const DEFAULT_TILES_URL =
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export const TILES_URL =
  process.env.NEXT_PUBLIC_MAP_TILES_URL || DEFAULT_TILES_URL;

/** Origin of the tiles, for the Content-Security-Policy. */
export function tilesOrigin(url: string = TILES_URL): string {
  // An origin with a placeholder ({s}) is refused here, at build time.
  const { protocol, origin, host } = new URL(url);
  if (protocol !== "https:" || /[{}%]/.test(host)) {
    throw new Error(
      "NEXT_PUBLIC_MAP_TILES_URL must be an https URL with a fixed host",
    );
  }
  return origin;
}

export const MAP_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · Communes : MATDCL, 2019';
