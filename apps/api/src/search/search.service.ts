import { Inject, Injectable } from '@nestjs/common';
import { Kysely, RawBuilder, sql } from 'kysely';
import { KYSELY } from '../database/database.module';
import type {
  Database,
  EntityType,
  LocationType,
  VerificationStatus,
} from '../database/database.types';
import type { SearchQuery } from './search-input';

/*
 * The public search (contract §4.1, ADR-014, ADR-015).
 *
 * Score = 0.40 × category + 0.30 × service + 0.20 × proximity
 *       + 0.10 × completeness, each part between 0 and 1 (ADR-064):
 * - category: 1 when the listing is in the requested category, or when a word
 *   of the query is in its category's name;
 * - service: 1 when it offers the requested service, or a service whose name
 *   holds a word of the query;
 * - proximity, only with a position: 1 − distance / radius for a listing with
 *   a public point (the sector centre for a home), 0.5 for a mobile activity
 *   that serves the commune of the position;
 * - completeness: a quarter each for an approved photo, opening hours, at
 *   least one service, and a second way to reach it (WhatsApp or email).
 *
 * Everything is read from what the public may see: published listings, their
 * primary location through public_locations (ADR-046), active services and
 * approved photos.
 */

export const SCORE_WEIGHTS = {
  category: 0.4,
  service: 0.3,
  proximity: 0.2,
  completeness: 0.1,
} as const;

/** A mobile activity has no point: it is near when it serves the commune. */
export const MOBILE_PROXIMITY = 0.5;

export interface SearchResult {
  slug: string;
  name: string;
  entityType: EntityType;
  category: { slug: string; name: string };
  /** Services of the listing that answer the query, by name. */
  matchedServices: string[];
  commune: { slug: string; name: string };
  locationType: LocationType;
  /** Exact for a fixed place, the sector centre for a home, null if mobile. */
  position: { lat: number; lng: number } | null;
  /** Null without a position in the query, or for a mobile activity. */
  distanceMeters: number | null;
  coverPhotoUrl: string | null;
  verificationStatus: VerificationStatus;
}

export interface SearchPage {
  data: SearchResult[];
  meta: { page: number; limit: number; total: number };
}

interface Row {
  id: string;
  slug: string;
  name: string;
  entity_type: EntityType;
  category_slug: string;
  category_name: string;
  commune_slug: string;
  commune_name: string;
  location_type: LocationType;
  lat: number | null;
  lng: number | null;
  distance: number | null;
  cover_id: string | null;
  verification_status: VerificationStatus;
  matched_services: string[];
  total: string;
}

const like = (word: string) => `%${word}%`;
const or = (parts: RawBuilder<unknown>[]) =>
  parts.length === 0 ? sql`false` : sql`(${sql.join(parts, sql` OR `)})`;

@Injectable()
export class SearchService {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  async search(query: SearchQuery): Promise<SearchPage> {
    const { words, near } = query;
    const here = near
      ? sql`ST_SetSRID(ST_MakePoint(${near.point.lng}, ${near.point.lat}), 4326)::geography`
      : null;

    // A word is found in the name, the category or an active service.
    const serviceHas = (word: string) => sql`EXISTS (
      SELECT 1 FROM establishment_services es
      JOIN services s ON s.id = es.service_id AND s.is_active
      WHERE es.establishment_id = e.id
        AND search_fold(s.name) LIKE ${like(word)})`;
    const wordFilters = words.map(
      (word) => sql`(search_fold(e.name) LIKE ${like(word)}
        OR search_fold(c.name) LIKE ${like(word)}
        OR ${serviceHas(word)})`,
    );

    const filters: RawBuilder<unknown>[] = [
      // public_locations already keeps only published listings; said again
      // here so that the rule does not rest on the view alone.
      sql`e.publication_status = 'PUBLISHED'`,
      ...wordFilters,
    ];
    if (query.category) filters.push(sql`c.slug = ${query.category}`);
    if (query.entityType)
      filters.push(sql`e.entity_type = ${query.entityType}`);
    if (query.service) {
      filters.push(sql`EXISTS (
        SELECT 1 FROM establishment_services es
        JOIN services s ON s.id = es.service_id AND s.is_active
        WHERE es.establishment_id = e.id AND s.slug = ${query.service})`);
    }
    // A mobile activity is where it works (RM-023); the others where they are.
    const inCommune = (commune: RawBuilder<unknown>) => sql`(
      pl.commune_id = ${commune}
      OR (pl.location_type = 'MOBILE' AND EXISTS (
        SELECT 1 FROM location_served_communes sc
        WHERE sc.location_id = pl.id AND sc.commune_id = ${commune})))`;
    if (query.commune) {
      filters.push(
        inCommune(sql`(SELECT id FROM communes WHERE slug = ${query.commune})`),
      );
    }
    // The commune of the position, for mobile activities and homes.
    const hereCommune = here
      ? sql`(SELECT id FROM communes WHERE ST_Covers(boundary, ${here}) LIMIT 1)`
      : null;
    if (here && near && hereCommune) {
      filters.push(sql`(
        (pl.geom IS NOT NULL AND ST_DWithin(pl.geom, ${here}, ${near.radiusMetres}))
        OR (pl.location_type <> 'FIXED' AND ${inCommune(hereCommune)}))`);
    }
    if (query.bbox) {
      const b = query.bbox;
      filters.push(sql`(pl.geom IS NOT NULL AND ST_Intersects(pl.geom,
        ST_MakeEnvelope(${b.minLng}, ${b.minLat}, ${b.maxLng}, ${b.maxLat}, 4326)::geography))`);
    }

    // The parts of the score (ADR-015, ADR-064).
    const categoryPart = or([
      ...(query.category ? [sql`c.slug = ${query.category}`] : []),
      ...words.map((word) => sql`search_fold(c.name) LIKE ${like(word)}`),
    ]);
    const serviceMatches = (alias: string) =>
      or([
        ...(query.service
          ? [sql`${sql.ref(`${alias}.slug`)} = ${query.service}`]
          : []),
        ...words.map(
          (word) =>
            sql`search_fold(${sql.ref(`${alias}.name`)}) LIKE ${like(word)}`,
        ),
      ]);
    const distance = here
      ? sql`ST_Distance(pl.geom, ${here})`
      : sql`NULL::float8`;
    const proximityPart =
      here && near
        ? sql`CASE
            WHEN pl.geom IS NOT NULL
              THEN GREATEST(0, 1 - ST_Distance(pl.geom, ${here}) / ${near.radiusMetres})
            WHEN pl.location_type = 'MOBILE' THEN ${sql.lit(MOBILE_PROXIMITY)}
            ELSE 0 END`
        : sql`0`;
    const completenessPart = sql`(
      (CASE WHEN EXISTS (SELECT 1 FROM media m
        WHERE m.establishment_id = e.id AND m.status = 'APPROVED') THEN 1 ELSE 0 END)
      + (CASE WHEN e.opening_hours IS NOT NULL THEN 1 ELSE 0 END)
      + (CASE WHEN EXISTS (SELECT 1 FROM establishment_services es
          JOIN services s ON s.id = es.service_id AND s.is_active
          WHERE es.establishment_id = e.id) THEN 1 ELSE 0 END)
      + (CASE WHEN e.whatsapp IS NOT NULL OR e.email IS NOT NULL THEN 1 ELSE 0 END)
    ) / 4.0`;
    const score = sql`(
      ${sql.lit(SCORE_WEIGHTS.category)} * (CASE WHEN ${categoryPart} THEN 1 ELSE 0 END)
      + ${sql.lit(SCORE_WEIGHTS.service)} * (CASE WHEN EXISTS (
          SELECT 1 FROM establishment_services es
          JOIN services s ON s.id = es.service_id AND s.is_active
          WHERE es.establishment_id = e.id AND ${serviceMatches('s')}) THEN 1 ELSE 0 END)
      + ${sql.lit(SCORE_WEIGHTS.proximity)} * ${proximityPart}
      + ${sql.lit(SCORE_WEIGHTS.completeness)} * ${completenessPart})`;

    const from = sql`
      FROM establishments e
      JOIN categories c ON c.id = e.category_id
      JOIN public_locations pl ON pl.establishment_id = e.id AND pl.is_primary
      JOIN communes co ON co.id = pl.commune_id
      WHERE ${sql.join(filters, sql` AND `)}`;
    const offset = (query.page - 1) * query.limit;
    const { rows } = await sql<Row>`
      SELECT
        e.id, e.slug, e.name, e.entity_type, e.verification_status,
        c.slug AS category_slug, c.name AS category_name,
        co.slug AS commune_slug, co.name AS commune_name,
        pl.location_type,
        ST_Y(pl.geom::geometry) AS lat, ST_X(pl.geom::geometry) AS lng,
        round(${distance})::integer AS distance,
        (SELECT m.id FROM media m
          WHERE m.establishment_id = e.id AND m.status = 'APPROVED'
          ORDER BY m.is_cover DESC, m.display_order, m.created_at
          LIMIT 1) AS cover_id,
        ARRAY(SELECT s.name FROM establishment_services es
          JOIN services s ON s.id = es.service_id AND s.is_active
          WHERE es.establishment_id = e.id AND ${serviceMatches('s')}
          ORDER BY s.name) AS matched_services,
        count(*) OVER () AS total
      ${from}
      ORDER BY ${score} DESC, e.id ASC
      LIMIT ${query.limit} OFFSET ${offset}
    `.execute(this.db);

    // Past the last page, the total still has to be told.
    let total = rows.length > 0 ? Number(rows[0].total) : 0;
    if (rows.length === 0 && offset > 0) {
      const counted = await sql<{ total: string }>`
        SELECT count(*) AS total ${from}`.execute(this.db);
      total = Number(counted.rows[0].total);
    }

    return {
      data: rows.map((row) => ({
        slug: row.slug,
        name: row.name,
        entityType: row.entity_type,
        category: { slug: row.category_slug, name: row.category_name },
        matchedServices: row.matched_services,
        commune: { slug: row.commune_slug, name: row.commune_name },
        locationType: row.location_type,
        position:
          row.lat !== null && row.lng !== null
            ? { lat: row.lat, lng: row.lng }
            : null,
        distanceMeters: row.distance,
        coverPhotoUrl: row.cover_id
          ? `/api/v1/listings/${row.slug}/photos/${row.cover_id}`
          : null,
        verificationStatus: row.verification_status,
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
      },
    };
  }
}
