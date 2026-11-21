import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY } from '../database/database.module';
import type { Database, EntityType } from '../database/database.types';

export interface CommuneSummary {
  id: string;
  slug: string;
  name: string;
  prefecture: string;
}

/**
 * How the commune of a point was found:
 * - "inside": the point is in its official boundary;
 * - "nearby": the point is just outside the union of the communes (GPS error
 *   near the edge of Grand Lomé), within NEARBY_METRES of this commune.
 */
export type LocateMethod = 'inside' | 'nearby';

/** Code review of 2026-11-19: fallback for a GPS fix just outside a boundary. */
export const NEARBY_METRES = 50;
/** A point farther than this from every commune is not in Grand Lomé. */
export const OUTSIDE_GRAND_LOME_METRES = 1000;

export interface Point {
  lat: number;
  lng: number;
}

/** ST_MakePoint takes the longitude first. */
const geography = (point: Point) =>
  sql<string>`ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography`;

@Injectable()
export class TerritoryService {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  /** The 13 communes, for choosing one from a list (ADR-044). */
  async communes(): Promise<CommuneSummary[]> {
    return this.db
      .selectFrom('communes')
      .innerJoin('prefectures', 'prefectures.id', 'communes.prefecture_id')
      .select([
        'communes.id',
        'communes.slug',
        'communes.name',
        'prefectures.name as prefecture',
      ])
      .orderBy('prefectures.name')
      .orderBy('communes.slug')
      .execute();
  }

  /**
   * The commune of a GPS point, on the full official boundaries (the light
   * copy of the web app is only for drawing). Null outside Grand Lomé.
   */
  async locate(
    point: Point,
  ): Promise<{ commune: CommuneSummary; method: LocateMethod } | null> {
    const here = geography(point);
    const base = this.db
      .selectFrom('communes')
      .innerJoin('prefectures', 'prefectures.id', 'communes.prefecture_id')
      .select([
        'communes.id',
        'communes.slug',
        'communes.name',
        'prefectures.name as prefecture',
      ]);

    const inside = await base
      .where(sql<boolean>`ST_Covers(communes.boundary, ${here})`)
      .executeTakeFirst();
    if (inside) return { commune: inside, method: 'inside' };

    const nearby = await base
      .where(
        sql<boolean>`ST_DWithin(communes.boundary, ${here}, ${NEARBY_METRES})`,
      )
      .orderBy(sql`ST_Distance(communes.boundary, ${here})`)
      .executeTakeFirst();
    return nearby ? { commune: nearby, method: 'nearby' } : null;
  }

  /** Whether a point is in Grand Lomé or within OUTSIDE_GRAND_LOME_METRES of it. */
  async isNearGrandLome(point: Point): Promise<boolean> {
    const row = await this.db
      .selectFrom('communes')
      .select('id')
      .where(
        sql<boolean>`ST_DWithin(boundary, ${geography(point)}, ${OUTSIDE_GRAND_LOME_METRES})`,
      )
      .executeTakeFirst();
    return row !== undefined;
  }

  /** Active categories, in display order, optionally for one kind of listing. */
  async categories(entityType?: EntityType) {
    let query = this.db
      .selectFrom('categories')
      .select(['id', 'slug', 'name', 'applicable_to as applicableTo'])
      .where('is_active', '=', true)
      .orderBy('display_order')
      .orderBy('name');
    if (entityType) {
      query = query.where((eb) =>
        eb.or([
          eb('applicable_to', '=', entityType),
          eb('applicable_to', 'is', null),
        ]),
      );
    }
    return query.execute();
  }
}
