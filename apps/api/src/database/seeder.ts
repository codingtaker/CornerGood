import { Kysely, sql } from 'kysely';
import { Database } from './database.types';
import { CATEGORIES } from './seed-data/categories';
import { COMMUNE_BOUNDARIES } from './seed-data/commune-boundaries';
import { SERVICES } from './seed-data/services';
import { PREFECTURES, REGION } from './seed-data/territory';

export interface SeedReport {
  communes: number;
  categories: number;
  services: number;
  communesWithBoundary: number;
  /** Communes with neither a boundary nor a centre: no automatic proposal. */
  communesWithoutLocation: string[];
}

/**
 * Loads reference data. Safe to run several times: every row is matched on its
 * slug, never duplicated.
 * - Territory (region, prefectures, communes) is updated, so a corrected name,
 *   boundary or centre is applied by simply running the seed again.
 * - Categories and services are only created when missing: existing ones are
 *   left as the administrators edited them.
 */
export async function seedReferenceData(
  db: Kysely<Database>,
): Promise<SeedReport> {
  return db.transaction().execute(async (trx) => {
    const region = await trx
      .insertInto('regions')
      .values(REGION)
      .onConflict((oc) =>
        oc
          .column('slug')
          .doUpdateSet({ name: (eb) => eb.ref('excluded.name') }),
      )
      .returning('id')
      .executeTakeFirstOrThrow();

    let communeCount = 0;
    for (const prefectureSeed of PREFECTURES) {
      const prefecture = await trx
        .insertInto('prefectures')
        .values({
          region_id: region.id,
          name: prefectureSeed.name,
          slug: prefectureSeed.slug,
        })
        .onConflict((oc) =>
          oc.column('slug').doUpdateSet({
            name: (eb) => eb.ref('excluded.name'),
            region_id: (eb) => eb.ref('excluded.region_id'),
          }),
        )
        .returning('id')
        .executeTakeFirstOrThrow();

      for (const commune of prefectureSeed.communes) {
        await trx
          .insertInto('communes')
          .values({ prefecture_id: prefecture.id, ...commune })
          .onConflict((oc) =>
            oc.column('slug').doUpdateSet({
              name: (eb) => eb.ref('excluded.name'),
              prefecture_id: (eb) => eb.ref('excluded.prefecture_id'),
            }),
          )
          .execute();
        communeCount += 1;
      }
    }

    for (const boundary of COMMUNE_BOUNDARIES) {
      const geoJson = JSON.stringify({
        type: 'MultiPolygon',
        coordinates: boundary.multiPolygon,
      });
      const result = await trx
        .updateTable('communes')
        .set({
          boundary: sql<string>`ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${geoJson}), 4326))::geography`,
        })
        .where('slug', '=', boundary.slug)
        .executeTakeFirst();
      if (result.numUpdatedRows !== 1n) {
        throw new Error(`Boundary for unknown commune "${boundary.slug}"`);
      }
    }

    for (const [index, category] of CATEGORIES.entries()) {
      await trx
        .insertInto('categories')
        .values({
          name: category.name,
          slug: category.slug,
          applicable_to: category.applicableTo,
          display_order: index,
        })
        // Categories belong to the administrators once created: a new run only
        // adds the missing ones and never overwrites a renamed or reordered one.
        .onConflict((oc) => oc.column('slug').doNothing())
        .execute();
    }

    // The provisional starter catalogue of services (seed-data/services.ts).
    const categoryIds = new Map(
      (await trx.selectFrom('categories').select(['id', 'slug']).execute()).map(
        (row) => [row.slug, row.id],
      ),
    );
    let services = 0;
    for (const [categorySlug, list] of Object.entries(SERVICES)) {
      const categoryId = categoryIds.get(categorySlug);
      if (!categoryId)
        throw new Error(`Services for unknown category "${categorySlug}"`);
      for (const service of list) {
        await trx
          .insertInto('services')
          .values({
            category_id: categoryId,
            name: service.name,
            slug: service.slug,
          })
          .onConflict((oc) => oc.column('slug').doNothing())
          .execute();
        services += 1;
      }
    }

    const missing = await trx
      .selectFrom('communes')
      .select('name')
      .where('boundary', 'is', null)
      .where('centroid', 'is', null)
      .orderBy('slug')
      .execute();

    return {
      communes: communeCount,
      categories: CATEGORIES.length,
      services,
      communesWithBoundary: COMMUNE_BOUNDARIES.length,
      communesWithoutLocation: missing.map((row) => row.name),
    };
  });
}
