import { Kysely, sql } from 'kysely';

/*
 * ADR-046 enforced on reading, not only on storing (code review of
 * 2026-11-20). The exact point of a home is stored, so its owner and the
 * moderators can see it; but anything shown to the public must read
 * public_locations, which never returns it:
 * - PUBLIC locations keep their point;
 * - APPROXIMATE ones (always the case for a home) get a point snapped to a
 *   grid of 0.005 degree, about 550 m around Lomé. The snap is deterministic:
 *   asking again gives the same point, so averaging many answers reveals
 *   nothing, unlike a random jitter;
 * - only locations of PUBLISHED listings appear.
 * security_barrier keeps a function in a caller's WHERE clause from seeing
 * the rows the view filters out.
 */

export const APPROXIMATE_GRID_DEGREES = 0.005;

export const APP_ROLE_GRANTS: Readonly<Record<string, string>> = {
  public_locations: 'SELECT',
};

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE VIEW public_locations WITH (security_barrier = true) AS
    SELECT
      l.id,
      l.establishment_id,
      l.commune_id,
      l.location_type,
      l.visibility,
      l.address_hint,
      l.is_primary,
      CASE
        WHEN l.visibility = 'PUBLIC' THEN l.geom
        ELSE ST_SnapToGrid(l.geom::geometry, ${sql.lit(APPROXIMATE_GRID_DEGREES)})::geography
      END AS geom
    FROM locations l
    JOIN establishments e ON e.id = l.establishment_id
    WHERE e.publication_status = 'PUBLISHED';

    COMMENT ON VIEW public_locations IS
      'Only source of locations for public pages: never the exact point of an APPROXIMATE location (ADR-046).';

    GRANT SELECT ON public_locations TO cornergood_app;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP VIEW IF EXISTS public_locations;`.execute(db);
}
