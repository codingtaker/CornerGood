import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { randomBytes } from 'node:crypto';
import { KYSELY } from '../database/database.module';
import type {
  Database,
  EntityType,
  LocationType,
  LocationVisibility,
  PublicationStatus,
} from '../database/database.types';
import { TerritoryService } from '../territory/territory.service';
import type { DraftListingInput } from './listing-input';

/** Drafts one account may keep: enough for real use, not for flooding. */
export const MAX_DRAFTS_PER_USER = 20;

/** A home is never public (ADR-046); a mobile activity has no point. */
const VISIBILITY: Record<LocationType, LocationVisibility> = {
  FIXED: 'PUBLIC',
  MOBILE: 'APPROXIMATE',
  HOME_BASED: 'APPROXIMATE',
};

export interface ListingSummary {
  id: string;
  name: string;
  status: PublicationStatus;
}

export interface OwnListing extends ListingSummary {
  entityType: EntityType;
  category: { id: string; name: string };
  description: string | null;
  phone: string | null;
  whatsapp: string | null;
  location: {
    type: LocationType;
    visibility: LocationVisibility;
    commune: { id: string; name: string };
    /** Exact, for the owner only; public pages use public_locations. */
    point: { lat: number; lng: number } | null;
    accuracyM: number | null;
    addressHint: string | null;
    servedCommunes: { id: string; name: string }[];
  } | null;
}

/** "Atelier de Kossi" → "atelier-de-kossi-4f9k2a": readable and unique. */
export function listingSlug(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const suffix = randomBytes(4).readUInt32BE(0).toString(36).padStart(6, '0');
  return `${base || 'fiche'}-${suffix.slice(0, 6)}`;
}

function badField(field: string, message: string): BadRequestException {
  return new BadRequestException({
    message: 'Vérifiez les champs indiqués.',
    fields: { [field]: message },
  });
}

@Injectable()
export class ListingsService {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    private readonly territory: TerritoryService,
  ) {}

  async listOwn(userId: string): Promise<ListingSummary[]> {
    const rows = await this.db
      .selectFrom('establishments')
      .select(['id', 'name', 'publication_status'])
      .where('owner_id', '=', userId)
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.publication_status,
    }));
  }

  /**
   * Creates a DRAFT listing with its primary location (S3). Drafts may be
   * incomplete: the phone and description are checked at submission
   * (submitted_listing_is_complete, ADR-045).
   */
  async createDraft(
    userId: string,
    input: DraftListingInput,
  ): Promise<OwnListing> {
    const { location } = input;

    const category = await this.db
      .selectFrom('categories')
      .select(['id', 'applicable_to'])
      .where('id', '=', input.categoryId)
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (
      !category ||
      (category.applicable_to !== null &&
        category.applicable_to !== input.entityType)
    ) {
      throw badField(
        'categoryId',
        "Cette catégorie n'existe pas pour ce type de fiche.",
      );
    }

    const communeIds = [location.communeId, ...location.servedCommuneIds];
    const known = await this.db
      .selectFrom('communes')
      .select('id')
      .where('id', 'in', communeIds)
      .execute();
    if (new Set(known.map((row) => row.id)).size !== new Set(communeIds).size) {
      throw badField('location.communeId', 'Commune inconnue.');
    }

    if (
      location.point &&
      !(await this.territory.isNearGrandLome(location.point))
    ) {
      throw badField(
        'location.point',
        'Cette position est hors du Grand Lomé. Relevez-la devant votre activité.',
      );
    }

    const { drafts } = await this.db
      .selectFrom('establishments')
      .select((eb) => eb.fn.countAll<string>().as('drafts'))
      .where('owner_id', '=', userId)
      .where('publication_status', '=', 'DRAFT')
      .executeTakeFirstOrThrow();
    if (Number(drafts) >= MAX_DRAFTS_PER_USER) {
      throw new ConflictException({
        message: `Vous avez déjà ${MAX_DRAFTS_PER_USER} brouillons : terminez ou supprimez-en un avant d'en créer un autre.`,
      });
    }

    const id = await this.db.transaction().execute(async (trx) => {
      const listing = await trx
        .insertInto('establishments')
        .values({
          owner_id: userId,
          created_by_id: userId,
          category_id: input.categoryId,
          entity_type: input.entityType,
          name: input.name,
          slug: listingSlug(input.name),
          description: input.description,
          phone: input.phone,
          whatsapp: input.whatsapp,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      if (input.entityType === 'BUSINESS') {
        await trx
          .insertInto('business_profiles')
          .values({ establishment_id: listing.id })
          .execute();
      } else {
        await trx
          .insertInto('community_profiles')
          .values({ establishment_id: listing.id })
          .execute();
      }

      const point = location.point;
      const saved = await trx
        .insertInto('locations')
        .values({
          establishment_id: listing.id,
          commune_id: location.communeId,
          location_type: location.type,
          visibility: VISIBILITY[location.type],
          // ST_MakePoint takes the longitude first.
          geom: point
            ? sql<string>`ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography`
            : null,
          position_source: point ? location.source : null,
          position_accuracy_m: point ? location.accuracyM : null,
          position_captured_at: point
            ? (location.capturedAt ?? sql<Date>`now()`)
            : null,
          address_hint: location.addressHint,
          is_primary: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      if (location.servedCommuneIds.length > 0) {
        await trx
          .insertInto('location_served_communes')
          .values(
            location.servedCommuneIds.map((communeId) => ({
              location_id: saved.id,
              commune_id: communeId,
            })),
          )
          .execute();
      }
      return listing.id;
    });

    return this.getOwn(userId, id);
  }

  /** One listing of its owner, exact point included; 404 for anyone else. */
  async getOwn(userId: string, id: string): Promise<OwnListing> {
    const listing = await this.db
      .selectFrom('establishments')
      .innerJoin('categories', 'categories.id', 'establishments.category_id')
      .select([
        'establishments.id',
        'establishments.name',
        'establishments.publication_status',
        'establishments.entity_type',
        'establishments.description',
        'establishments.phone',
        'establishments.whatsapp',
        'categories.id as category_id',
        'categories.name as category_name',
      ])
      .where('establishments.id', '=', id)
      .where('establishments.owner_id', '=', userId)
      .executeTakeFirst();
    // Same answer for "not yours" and "does not exist".
    if (!listing)
      throw new NotFoundException({ message: 'Fiche introuvable.' });

    const location = await this.db
      .selectFrom('locations')
      .innerJoin('communes', 'communes.id', 'locations.commune_id')
      .select([
        'locations.id',
        'locations.location_type',
        'locations.visibility',
        'locations.position_accuracy_m',
        'locations.address_hint',
        'communes.id as commune_id',
        'communes.name as commune_name',
        sql<number | null>`ST_Y(locations.geom::geometry)`.as('lat'),
        sql<number | null>`ST_X(locations.geom::geometry)`.as('lng'),
      ])
      .where('locations.establishment_id', '=', id)
      .where('locations.is_primary', '=', true)
      .executeTakeFirst();

    const served = location
      ? await this.db
          .selectFrom('location_served_communes')
          .innerJoin(
            'communes',
            'communes.id',
            'location_served_communes.commune_id',
          )
          .select(['communes.id', 'communes.name'])
          .where('location_served_communes.location_id', '=', location.id)
          .orderBy('communes.slug')
          .execute()
      : [];

    return {
      id: listing.id,
      name: listing.name,
      status: listing.publication_status,
      entityType: listing.entity_type,
      category: { id: listing.category_id, name: listing.category_name },
      description: listing.description,
      phone: listing.phone,
      whatsapp: listing.whatsapp,
      location: location
        ? {
            type: location.location_type,
            visibility: location.visibility,
            commune: { id: location.commune_id, name: location.commune_name },
            point:
              location.lat !== null && location.lng !== null
                ? { lat: location.lat, lng: location.lng }
                : null,
            accuracyM: location.position_accuracy_m,
            addressHint: location.address_hint,
            servedCommunes: served,
          }
        : null,
    };
  }
}
