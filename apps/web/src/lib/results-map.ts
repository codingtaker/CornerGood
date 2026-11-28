import { circle } from "./map-shapes";
import {
  countLabel,
  searchQuery,
  type SearchCriteria,
  type SearchPage,
  type SearchResult,
} from "./search";

/*
 * The map of /recherche (contract §4.1, bbox). It asks the API for the
 * listings inside the visible area, with the other criteria of the search.
 */

/** The API's page limit: the best 50 of the area are drawn. */
export const MAP_LIMIT = 50;

/** Grand Lomé, when the search carries no position. */
export const GRAND_LOME_CENTER = { lat: 6.17, lng: 1.21 };
export const GRAND_LOME_ZOOM = 12;
export const AROUND_ME_ZOOM = 14;

/** Half of the grid of public_locations (about 550 m), as on a listing page. */
export const SECTOR_RADIUS_M = 350;

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * minLng,minLat,maxLng,maxLat rounded to 4 decimals (about 11 m): small
 * moves give the same address, which caches can serve again.
 */
export function bboxParam(bounds: Bounds): string {
  const round = (value: number) => Math.round(value * 10_000) / 10_000;
  const clamp = (value: number, limit: number) =>
    Math.min(limit, Math.max(-limit, value));
  return [
    clamp(round(bounds.west), 180),
    clamp(round(bounds.south), 90),
    clamp(round(bounds.east), 180),
    clamp(round(bounds.north), 90),
  ].join(",");
}

/**
 * The query of the map. The position and the page are left out: the API
 * does not combine a radius with an area, and the map has no pages.
 */
export function mapQuery(criteria: SearchCriteria, bounds: Bounds): string {
  const rest: SearchCriteria = {
    q: criteria.q,
    category: criteria.category,
    commune: criteria.commune,
    entityType: criteria.entityType,
  };
  const base = searchQuery(rest);
  const area = `bbox=${encodeURIComponent(bboxParam(bounds))}&limit=${MAP_LIMIT}`;
  return base ? `${base}&${area}` : area;
}

/** Points for fixed places, sectors for homes; mobile activities have none. */
export function toFeatures(results: SearchResult[]): {
  points: GeoJSON.FeatureCollection;
  sectors: GeoJSON.FeatureCollection;
} {
  const points: GeoJSON.Feature[] = [];
  const sectors: GeoJSON.Feature[] = [];
  for (const result of results) {
    if (!result.position) continue;
    const properties = { slug: result.slug };
    if (result.locationType === "HOME_BASED") {
      sectors.push({
        ...circle(result.position, SECTOR_RADIUS_M),
        properties,
      });
    } else {
      points.push({
        type: "Feature",
        properties,
        geometry: {
          type: "Point",
          coordinates: [result.position.lng, result.position.lat],
        },
      });
    }
  }
  return {
    points: { type: "FeatureCollection", features: points },
    sectors: { type: "FeatureCollection", features: sectors },
  };
}

/** What the line under the map says about the area. */
export function mapStatus(page: SearchPage): string {
  const { total } = page.meta;
  if (total === 0) {
    return "Aucune activité dans cette zone. Déplacez la carte ou dézoomez.";
  }
  if (total > page.data.length) {
    return `Les ${page.data.length} premières sur ${total} : zoomez pour voir les autres.`;
  }
  return `${countLabel(total)} dans cette zone.`;
}
