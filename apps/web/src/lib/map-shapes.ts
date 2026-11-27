export interface MapPoint {
  lat: number;
  lng: number;
}

/** Polygon of a circle in metres (MapLibre circles are in pixels). */
export function circle(
  { lat, lng }: MapPoint,
  radiusM: number,
): GeoJSON.Feature {
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
