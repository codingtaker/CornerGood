import type { EntityType } from "./listings";

/** One result of GET /search (contract §4.1). */
export interface SearchResult {
  slug: string;
  name: string;
  entityType: EntityType;
  category: { slug: string; name: string };
  matchedServices: string[];
  commune: { slug: string; name: string };
  locationType: "FIXED" | "MOBILE" | "HOME_BASED";
  position: { lat: number; lng: number } | null;
  distanceMeters: number | null;
  coverPhotoUrl: string | null;
  verificationStatus: "UNVERIFIED" | "VERIFIED" | "VERIFICATION_PENDING";
}

export interface SearchPage {
  data: SearchResult[];
  meta: { page: number; limit: number; total: number };
}

/** What the address bar of /recherche carries. */
export interface SearchCriteria {
  q?: string;
  category?: string;
  commune?: string;
  entityType?: EntityType;
  lat?: number;
  lng?: number;
  page?: number;
}

/** Same bounds as the API. */
export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 80;
export const PAGE_SIZE = 20;

/**
 * About 110 m: enough to sort by distance, without writing the exact place
 * of the visitor into their history and into server logs.
 */
export function roundCoordinate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function number(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Reads the criteria of /recherche, ignoring anything else. */
export function readCriteria(params: URLSearchParams): SearchCriteria {
  const criteria: SearchCriteria = {};
  const q = params.get("q")?.trim();
  if (q) criteria.q = q.slice(0, MAX_QUERY_LENGTH);
  for (const key of ["category", "commune"] as const) {
    const value = params.get(key)?.trim();
    if (value) criteria[key] = value;
  }
  const entityType = params.get("entityType");
  if (entityType === "BUSINESS" || entityType === "COMMUNITY") {
    criteria.entityType = entityType;
  }
  const lat = number(params.get("lat"));
  const lng = number(params.get("lng"));
  if (lat !== undefined && lng !== undefined) {
    criteria.lat = lat;
    criteria.lng = lng;
  }
  const page = number(params.get("page"));
  if (page !== undefined && Number.isInteger(page) && page > 1) {
    criteria.page = page;
  }
  return criteria;
}

/** The query string of a search, in a fixed order, without empty values. */
export function searchQuery(criteria: SearchCriteria): string {
  const params = new URLSearchParams();
  if (criteria.q) params.set("q", criteria.q);
  if (criteria.category) params.set("category", criteria.category);
  if (criteria.commune) params.set("commune", criteria.commune);
  if (criteria.entityType) params.set("entityType", criteria.entityType);
  if (criteria.lat !== undefined && criteria.lng !== undefined) {
    params.set("lat", String(roundCoordinate(criteria.lat)));
    params.set("lng", String(roundCoordinate(criteria.lng)));
  }
  if (criteria.page && criteria.page > 1) {
    params.set("page", String(criteria.page));
  }
  return params.toString();
}

export function searchHref(criteria: SearchCriteria): string {
  const query = searchQuery(criteria);
  return query ? `/recherche?${query}` : "/recherche";
}

/** Whether the API will accept it: at least one criterion (contract §4.1). */
export function hasCriterion(criteria: SearchCriteria): boolean {
  return Boolean(
    (criteria.q && criteria.q.length >= MIN_QUERY_LENGTH) ||
    criteria.category ||
    criteria.commune ||
    criteria.entityType ||
    criteria.lat !== undefined,
  );
}

/** "650 m", "1,2 km", "12 km". */
export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
  const km = metres / 1000;
  return km < 10
    ? `${km.toFixed(1).replace(".", ",")} km`
    : `${Math.round(km)} km`;
}

/** "1 résultat", "37 résultats". */
export function countLabel(total: number): string {
  return total <= 1 ? `${total} résultat` : `${total} résultats`;
}
