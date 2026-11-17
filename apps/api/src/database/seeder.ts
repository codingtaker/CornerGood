import { Kysely, sql } from 'kysely';
import { Database } from './database.types';
import { CATEGORIES } from './seed-data/categories';
import { COMMUNE_CENTROIDS, PREFECTURES, REGION } from './seed-data/territory';

export interface SeedReport {
  communes: number;
  categories: number;
  communesWithoutCentroid: string[];
}

/**
 * Loads reference data. Safe to run several times: every row is matched on its
 * slug and updated instead of duplicated, so a corrected name or coordinate is
 * applied by simply running the seed again.
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

    for (const centroid of COMMUNE_CENTROIDS) {
      // ST_MakePoint takes longitude first, then latitude.
      await trx
        .updateTable('communes')
        .set({
          centroid: sql<string>`ST_SetSRID(ST_MakePoint(${centroid.lng}, ${centroid.lat}), 4326)::geography`,
          centroid_is_approximate: true,
        })
        .where('slug', '=', centroid.slug)
        .execute();
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
        .onConflict((oc) =>
          oc.column('slug').doUpdateSet({
            name: (eb) => eb.ref('excluded.name'),
            applicable_to: (eb) => eb.ref('excluded.applicable_to'),
            display_order: (eb) => eb.ref('excluded.display_order'),
          }),
        )
        .execute();
    }

    const missing = await trx
      .selectFrom('communes')
      .select('name')
      .where('centroid', 'is', null)
      .orderBy('slug')
      .execute();

    return {
      communes: communeCount,
      categories: CATEGORIES.length,
      communesWithoutCentroid: missing.map((row) => row.name),
    };
  });
}
