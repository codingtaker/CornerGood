import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Kysely, sql, Transaction } from 'kysely';
import { randomBytes } from 'node:crypto';
import { KYSELY } from '../database/database.module';
import type {
  Database,
  EntityType,
  LocationType,
  LocationVisibility,
  PositionSource,
  PublicationStatus,
} from '../database/database.types';
import { TerritoryService } from '../territory/territory.service';
import type {
  DraftListingInput,
  DraftLocationInput,
  ListingDetailsInput,
  ListingServiceInput,
} from './listing-input';
import type { OpeningHours } from './opening-hours';
import { missingForSubmission } from './submission';

/**
 * Unpublished listings one account may have: enough for real use, not for
 * flooding. Those awaiting validation count, or the queue could be flooded.
 */
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
  /** The public address once published: /fiches/{slug}. */
  slug: string;
  entityType: EntityType;
  category: { id: string; name: string };
  description: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  openingHours: OpeningHours | null;
  /** Ticked in the catalogue of the listing's category (ADR-006). */
  services: ListedService[];
  /** Why the listing was refused, until it is sent again (UC20). */
  rejection: { reason: string; at: Date } | null;
  location: {
    type: LocationType;
    visibility: LocationVisibility;
    commune: { id: string; name: string };
    /** Exact, for the owner only; public pages use public_locations. */
    point: { lat: number; lng: number } | null;
    accuracyM: number | null;
    capturedAt: Date | null;
    source: PositionSource | null;
    addressHint: string | null;
    servedCommunes: { id: string; name: string }[];
  } | null;
}

export interface ListedService {
  id: string;
  name: string;
  details: string | null;
}

/** The services of a listing, in the catalogue's order of names. */
export async function loadServices(
  db: Kysely<Database>,
  establishmentId: string,
): Promise<ListedService[]> {
  return db
    .selectFrom('establishment_services')
    .innerJoin('services', 'services.id', 'establishment_services.service_id')
    .select(['services.id', 'services.name', 'establishment_services.details'])
    .where('establishment_services.establishment_id', '=', establishmentId)
    .orderBy('services.name')
    .execute();
}

/** Stored as jsonb; read back as the object it was. */
function hoursColumn(hours: OpeningHours | null): string | null {
  return hours ? JSON.stringify(hours) : null;
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

/** The columns of a location row, the same at creation and on a change. */
function locationColumns(location: DraftLocationInput) {
  const point = location.point;
  return {
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
  };
}

/** A rejected listing being corrected is a draft again (ADR-009 cycle). */
async function logReopening(
  trx: Transaction<Database>,
  userId: string,
  id: string,
): Promise<void> {
  await trx
    .insertInto('moderation_log')
    .values({
      establishment_id: id,
      actor_id: userId,
      action: 'EDIT',
      from_status: 'REJECTED',
      to_status: 'DRAFT',
    })
    .execute();
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

    await this.checkCategory(this.db, input.categoryId, input.entityType);
    await this.checkLocation(location);

    const { drafts } = await this.db
      .selectFrom('establishments')
      .select((eb) => eb.fn.countAll<string>().as('drafts'))
      .where('owner_id', '=', userId)
      .where('publication_status', 'in', ['DRAFT', 'PENDING', 'REJECTED'])
      .executeTakeFirstOrThrow();
    if (Number(drafts) >= MAX_DRAFTS_PER_USER) {
      throw new ConflictException({
        message: `Vous avez déjà ${MAX_DRAFTS_PER_USER} fiches non publiées : terminez-les avant d'en créer une autre.`,
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
          email: input.email,
          opening_hours: hoursColumn(input.openingHours),
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

      const saved = await trx
        .insertInto('locations')
        .values({
          establishment_id: listing.id,
          is_primary: true,
          ...locationColumns(location),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.saveServedCommunes(trx, saved.id, location);
      return listing.id;
    });

    return this.getOwn(userId, id);
  }

  /**
   * Replaces the details of a draft. A rejected listing becomes a draft again
   * (ADR-009 cycle), which the log records.
   */
  async updateDetails(
    userId: string,
    id: string,
    input: ListingDetailsInput,
  ): Promise<OwnListing> {
    await this.db.transaction().execute(async (trx) => {
      const listing = await this.lockOwn(trx, userId, id);
      if (listing.status !== 'DRAFT' && listing.status !== 'REJECTED') {
        throw new ConflictException({
          message:
            'Cette fiche ne peut pas être modifiée dans son état actuel.',
        });
      }
      await this.checkCategory(trx, input.categoryId, listing.entityType);
      await trx
        .updateTable('establishments')
        .set({
          category_id: input.categoryId,
          name: input.name,
          description: input.description,
          phone: input.phone,
          whatsapp: input.whatsapp,
          email: input.email,
          opening_hours: hoursColumn(input.openingHours),
          publication_status: 'DRAFT',
          // Never published yet, so no public address depends on it.
          ...(input.name === listing.name
            ? {}
            : { slug: listingSlug(input.name) }),
        })
        .where('id', '=', id)
        .execute();
      if (input.categoryId !== listing.categoryId) {
        // The catalogue depends on the category: the old ticks no longer apply.
        await trx
          .deleteFrom('establishment_services')
          .where('establishment_id', '=', id)
          .where('service_id', 'not in', (eb) =>
            eb
              .selectFrom('services')
              .select('id')
              .where('category_id', '=', input.categoryId),
          )
          .execute();
      }
      if (listing.status === 'REJECTED') await logReopening(trx, userId, id);
    });
    return this.getOwn(userId, id);
  }

  /**
   * Replaces the services of a draft, chosen in the catalogue of its
   * category; a rejected listing becomes a draft again, as for its details.
   */
  async replaceServices(
    userId: string,
    id: string,
    services: ListingServiceInput[],
  ): Promise<OwnListing> {
    await this.db.transaction().execute(async (trx) => {
      const listing = await this.lockOwn(trx, userId, id);
      if (listing.status !== 'DRAFT' && listing.status !== 'REJECTED') {
        throw new ConflictException({
          message:
            'Cette fiche ne peut pas être modifiée dans son état actuel.',
        });
      }
      const ids = services.map((service) => service.serviceId);
      const known =
        ids.length === 0
          ? []
          : await trx
              .selectFrom('services')
              .select('id')
              .where('id', 'in', ids)
              .where('category_id', '=', listing.categoryId)
              .where('is_active', '=', true)
              .execute();
      if (known.length !== ids.length) {
        throw badField(
          'services',
          "Un service choisi n'existe pas pour la catégorie de cette fiche.",
        );
      }
      await trx
        .deleteFrom('establishment_services')
        .where('establishment_id', '=', id)
        .execute();
      if (services.length > 0) {
        await trx
          .insertInto('establishment_services')
          .values(
            services.map((service) => ({
              establishment_id: id,
              service_id: service.serviceId,
              details: service.details,
            })),
          )
          .execute();
      }
      if (listing.status === 'REJECTED') {
        await trx
          .updateTable('establishments')
          .set({ publication_status: 'DRAFT' })
          .where('id', '=', id)
          .execute();
        await logReopening(trx, userId, id);
      }
    });
    return this.getOwn(userId, id);
  }

  /**
   * Replaces the place of a draft: type, commune, point, landmark, served
   * communes. A rejected listing becomes a draft again, as for its details:
   * a refusal for a wrong position can now be corrected.
   */
  async replaceLocation(
    userId: string,
    id: string,
    location: DraftLocationInput,
  ): Promise<OwnListing> {
    // Before the lock: it reads the territory, and a refusal costs nothing.
    await this.checkLocation(location);
    await this.db.transaction().execute(async (trx) => {
      const listing = await this.lockOwn(trx, userId, id);
      if (listing.status !== 'DRAFT' && listing.status !== 'REJECTED') {
        throw new ConflictException({
          message:
            'Cette fiche ne peut pas être modifiée dans son état actuel.',
        });
      }
      const saved = await trx
        .updateTable('locations')
        .set(locationColumns(location))
        .where('establishment_id', '=', id)
        .where('is_primary', '=', true)
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .deleteFrom('location_served_communes')
        .where('location_id', '=', saved.id)
        .execute();
      await this.saveServedCommunes(trx, saved.id, location);
      if (listing.status === 'REJECTED') {
        await trx
          .updateTable('establishments')
          .set({ publication_status: 'DRAFT' })
          .where('id', '=', id)
          .execute();
        await logReopening(trx, userId, id);
      }
    });
    return this.getOwn(userId, id);
  }

  /** Communes that exist, and a point in or near Grand Lomé. */
  private async checkLocation(location: DraftLocationInput): Promise<void> {
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
  }

  private async saveServedCommunes(
    trx: Transaction<Database>,
    locationId: string,
    location: DraftLocationInput,
  ): Promise<void> {
    if (location.servedCommuneIds.length === 0) return;
    await trx
      .insertInto('location_served_communes')
      .values(
        location.servedCommuneIds.map((communeId) => ({
          location_id: locationId,
          commune_id: communeId,
        })),
      )
      .execute();
  }

  /**
   * DRAFT → PENDING, with its line in the log, in one transaction. The row
   * lock makes a double tap submit once: the second one finds it PENDING.
   */
  async submit(userId: string, id: string): Promise<OwnListing> {
    await this.db.transaction().execute(async (trx) => {
      const listing = await this.lockOwn(trx, userId, id);
      if (listing.status !== 'DRAFT') {
        throw new ConflictException({
          message:
            listing.status === 'PENDING'
              ? 'Cette fiche est déjà en attente de validation.'
              : listing.status === 'REJECTED'
                ? 'Corrigez la fiche avant de la renvoyer.'
                : 'Cette fiche ne peut pas être envoyée dans son état actuel.',
        });
      }

      const category = await trx
        .selectFrom('categories')
        .select('is_active')
        .where('id', '=', listing.categoryId)
        .executeTakeFirst();
      const location = await trx
        .selectFrom('locations')
        .select((eb) => [
          'location_type',
          sql<boolean>`geom IS NOT NULL`.as('has_point'),
          eb
            .selectFrom('location_served_communes')
            .select((inner) => inner.fn.countAll<string>().as('count'))
            .whereRef(
              'location_served_communes.location_id',
              '=',
              'locations.id',
            )
            .as('served'),
        ])
        .where('establishment_id', '=', id)
        .where('is_primary', '=', true)
        .executeTakeFirst();

      const missing = missingForSubmission({
        ...listing,
        categoryActive: category?.is_active ?? false,
        location: location
          ? {
              type: location.location_type,
              hasPoint: location.has_point,
              servedCommunes: Number(location.served),
            }
          : null,
      });
      if (Object.keys(missing).length > 0) {
        throw new UnprocessableEntityException({
          code: 'SUBMISSION_INCOMPLETE',
          message: "Complétez la fiche avant de l'envoyer.",
          fields: missing,
        });
      }

      await trx
        .updateTable('establishments')
        .set({ publication_status: 'PENDING' })
        .where('id', '=', id)
        .execute();
      await trx
        .insertInto('moderation_log')
        .values({
          establishment_id: id,
          actor_id: userId,
          action: 'SUBMIT',
          from_status: 'DRAFT',
          to_status: 'PENDING',
        })
        .execute();
    });
    return this.getOwn(userId, id);
  }

  private async lockOwn(
    trx: Transaction<Database>,
    userId: string,
    id: string,
  ) {
    const listing = await trx
      .selectFrom('establishments')
      .select([
        'name',
        'publication_status as status',
        'entity_type as entityType',
        'category_id as categoryId',
        'description',
        'phone',
        'whatsapp',
      ])
      .where('id', '=', id)
      .where('owner_id', '=', userId)
      .forUpdate()
      .executeTakeFirst();
    if (!listing)
      throw new NotFoundException({ message: 'Fiche introuvable.' });
    return listing;
  }

  private async checkCategory(
    db: Kysely<Database>,
    categoryId: string,
    entityType: EntityType,
  ): Promise<void> {
    const category = await db
      .selectFrom('categories')
      .select('applicable_to')
      .where('id', '=', categoryId)
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (
      !category ||
      (category.applicable_to !== null && category.applicable_to !== entityType)
    ) {
      throw badField(
        'categoryId',
        "Cette catégorie n'existe pas pour ce type de fiche.",
      );
    }
  }

  /** One listing of its owner, exact point included; 404 for anyone else. */
  getOwn(userId: string, id: string): Promise<OwnListing> {
    return this.load(id, userId);
  }

  /** Any listing, for moderators (the route checks the role). */
  getForModeration(id: string): Promise<OwnListing> {
    return this.load(id, null);
  }

  private async load(id: string, ownerId: string | null): Promise<OwnListing> {
    let query = this.db
      .selectFrom('establishments')
      .innerJoin('categories', 'categories.id', 'establishments.category_id')
      .select([
        'establishments.id',
        'establishments.name',
        'establishments.slug',
        'establishments.publication_status',
        'establishments.entity_type',
        'establishments.description',
        'establishments.phone',
        'establishments.whatsapp',
        'establishments.email',
        'establishments.opening_hours',
        'categories.id as category_id',
        'categories.name as category_name',
      ])
      .where('establishments.id', '=', id);
    if (ownerId !== null) {
      query = query.where('establishments.owner_id', '=', ownerId);
    }
    const listing = await query.executeTakeFirst();
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
        'locations.position_source',
        'locations.position_captured_at',
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

    // The last refusal, unless the listing was sent again since.
    const lastDecision = await this.db
      .selectFrom('moderation_log')
      .select(['action', 'reason', 'created_at'])
      .where('establishment_id', '=', id)
      .where('action', 'in', ['REJECT', 'SUBMIT'])
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    return {
      id: listing.id,
      name: listing.name,
      slug: listing.slug,
      status: listing.publication_status,
      entityType: listing.entity_type,
      category: { id: listing.category_id, name: listing.category_name },
      description: listing.description,
      phone: listing.phone,
      whatsapp: listing.whatsapp,
      email: listing.email,
      openingHours: (listing.opening_hours as OpeningHours | null) ?? null,
      services: await loadServices(this.db, id),
      rejection:
        lastDecision?.action === 'REJECT' && lastDecision.reason
          ? { reason: lastDecision.reason, at: lastDecision.created_at }
          : null,
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
            capturedAt: location.position_captured_at,
            source: location.position_source,
            addressHint: location.address_hint,
            servedCommunes: served,
          }
        : null,
    };
  }
}
