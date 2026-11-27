import { InvalidInputError } from '../auth/account-input';
import type { EntityType } from '../database/database.types';
import { readPoint } from '../listings/listing-input';
import type { Point } from '../territory/territory.service';

/*
 * The parameters of GET /search (contract §4.1, ADR-014), read one by one:
 * anything else in the query string is ignored.
 */

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 80;
/** More words would only make the query slower, not better. */
export const MAX_WORDS = 6;
export const DEFAULT_RADIUS_METRES = 3000;
export const MIN_RADIUS_METRES = 100;
export const MAX_RADIUS_METRES = 20000;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
/** Deeper pages are never read; a cap keeps OFFSET cheap. */
export const MAX_PAGE = 50;

/**
 * Words that say nothing about what is sought. They are dropped, so that
 * "réparation de téléphone" asks for "reparation" and "telephone".
 */
const STOP_WORDS = new Set([
  'a',
  'au',
  'aux',
  'avec',
  'ce',
  'ces',
  'chez',
  'd',
  'dans',
  'de',
  'des',
  'du',
  'en',
  'et',
  'l',
  'la',
  'le',
  'les',
  'ou',
  'par',
  'pour',
  'pres',
  'sur',
  'un',
  'une',
  'qui',
  'mon',
  'ma',
  'mes',
  'moi',
]);

const SLUG = /^[a-z0-9-]{1,80}$/;

export interface Bbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface SearchQuery {
  /** Folded words of q, each to find in the name, category or services. */
  words: string[];
  category: string | null;
  service: string | null;
  commune: string | null;
  entityType: EntityType | null;
  /** The visitor's position, with the radius around it. */
  near: { point: Point; radiusMetres: number } | null;
  bbox: Bbox | null;
  page: number;
  limit: number;
}

/**
 * Lowercase without accents, as search_fold() does in the database
 * (migration 0010): "Écran" and "ecran" compare equal.
 */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** The useful words of a query: folded, letters and digits only, no repeats. */
export function queryWords(q: string): string[] {
  const words = fold(q)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2 && !STOP_WORDS.has(word));
  return [...new Set(words)].slice(0, MAX_WORDS);
}

function one(value: unknown): string | undefined {
  if (Array.isArray(value)) return one(value[0]);
  return typeof value === 'string' ? value.trim() : undefined;
}

function integer(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  return /^\d{1,6}$/.test(value) ? Number(value) : NaN;
}

function readBbox(value: string): Bbox | null {
  const parts = value.split(',').map((part) => part.trim());
  if (parts.length !== 4 || parts.some((part) => part === '')) return null;
  const [minLng, minLat, maxLng, maxLat] = parts.map(Number);
  const inRange =
    [minLng, maxLng].every((lng) => lng >= -180 && lng <= 180) &&
    [minLat, maxLat].every((lat) => lat >= -90 && lat <= 90);
  if (!inRange || !(minLng < maxLng) || !(minLat < maxLat)) return null;
  return { minLng, minLat, maxLng, maxLat };
}

export function readSearchQuery(query: Record<string, unknown>): SearchQuery {
  const problems: Record<string, string> = {};

  let words: string[] = [];
  const q = one(query.q)?.replace(/\s+/g, ' ');
  if (q) {
    if (q.length < MIN_QUERY_LENGTH || q.length > MAX_QUERY_LENGTH) {
      problems.q = `Tapez de ${MIN_QUERY_LENGTH} à ${MAX_QUERY_LENGTH} caractères.`;
    } else {
      words = queryWords(q);
      if (words.length === 0) problems.q = 'Précisez ce que vous cherchez.';
    }
  }

  const slug = (name: 'category' | 'service' | 'commune'): string | null => {
    const value = one(query[name]);
    if (!value) return null;
    if (!SLUG.test(value)) problems[name] = 'Valeur inconnue.';
    return value;
  };
  const category = slug('category');
  const service = slug('service');
  const commune = slug('commune');

  let entityType: EntityType | null = null;
  const type = one(query.entityType);
  if (type) {
    if (type === 'BUSINESS' || type === 'COMMUNITY') entityType = type;
    else problems.entityType = 'BUSINESS ou COMMUNITY.';
  }

  let near: SearchQuery['near'] = null;
  const lat = one(query.lat);
  const lng = one(query.lng);
  const radius = integer(one(query.radius));
  if (lat || lng) {
    const point = readPoint({ lat, lng });
    if (!point) {
      problems.position =
        'Position invalide : lat et lng sont attendus en degrés.';
    } else if (
      radius !== null &&
      !(radius >= MIN_RADIUS_METRES && radius <= MAX_RADIUS_METRES)
    ) {
      problems.radius = `Rayon de ${MIN_RADIUS_METRES} à ${MAX_RADIUS_METRES} mètres.`;
    } else {
      near = { point, radiusMetres: radius ?? DEFAULT_RADIUS_METRES };
    }
  } else if (radius !== null) {
    problems.radius = 'Le rayon demande une position (lat et lng).';
  }

  let bbox: Bbox | null = null;
  const box = one(query.bbox);
  if (box) {
    bbox = readBbox(box);
    if (!bbox) problems.bbox = 'Zone invalide : minLng,minLat,maxLng,maxLat.';
    else if (radius !== null) {
      problems.bbox = 'Une zone de carte ne se combine pas avec un rayon.';
    }
  }

  const page = integer(one(query.page)) ?? 1;
  if (!(page >= 1 && page <= MAX_PAGE)) {
    problems.page = `Page de 1 à ${MAX_PAGE}.`;
  }
  const limit = integer(one(query.limit)) ?? DEFAULT_LIMIT;
  if (!(limit >= 1 && limit <= MAX_LIMIT)) {
    problems.limit = `De 1 à ${MAX_LIMIT} résultats par page.`;
  }

  if (Object.keys(problems).length > 0) throw new InvalidInputError(problems);

  const hasCriterion =
    words.length > 0 ||
    [category, service, commune, entityType, near, bbox].some(
      (value) => value !== null,
    );
  if (!hasCriterion) {
    throw new InvalidInputError({ q: 'Dites ce que vous cherchez ou où.' });
  }

  return {
    words,
    category,
    service,
    commune,
    entityType,
    near,
    bbox,
    page,
    limit,
  };
}
