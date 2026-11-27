import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY } from '../database/database.module';
import type {
  Database,
  EntityType,
  LocationType,
  VerificationStatus,
} from '../database/database.types';
import { loadServices } from '../listings/listings.service';
import type { ListedService } from '../listings/listings.service';
import type { OpeningHours } from '../listings/opening-hours';
import { MEDIA_STORAGE } from '../media/media-storage';
import type { MediaStorage } from '../media/media-storage';

/** What anyone may see of a published listing (contract §4.2). */
export interface PublicListing {
  slug: string;
  name: string;
  entityType: EntityType;
  category: { slug: string; name: string };
  description: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  openingHours: OpeningHours | null;
  services: ListedService[];
  verificationStatus: VerificationStatus;
  publishedAt: Date | null;
  updatedAt: Date;
  location: {
    type: LocationType;
    commune: { slug: string; name: string };
    /**
     * Exact for a fixed place; the centre of a sector of about 550 m for a
     * home (ADR-046); null for a mobile activity.
     */
    position: { lat: number; lng: number } | null;
    approximate: boolean;
    addressHint: string | null;
    servedCommunes: { slug: string; name: string }[];
  } | null;
  /** Approved photos only (ADR-019), the cover first. */
  photos: { id: string; isCover: boolean }[];
}

/** Slugs are made by listingSlug(): lowercase letters, digits and dashes. */
const SLUG = /^[a-z0-9-]{1,80}$/;

function notFound(): NotFoundException {
  return new NotFoundException({ message: 'Fiche introuvable.' });
}

/*
 * The public projection. It never reads `locations`, only the view
 * public_locations (ADR-046), and never the owner, the exact point of a home,
 * a photo awaiting a decision or a listing that is not PUBLISHED. Every other
 * status answers 404, even when the address is known.
 */
@Injectable()
export class PublicListingsService {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
  ) {}

  async get(slug: string): Promise<PublicListing> {
    if (!SLUG.test(slug)) throw notFound();
    const listing = await this.db
      .selectFrom('establishments')
      .innerJoin('categories', 'categories.id', 'establishments.category_id')
      .select([
        'establishments.id',
        'establishments.slug',
        'establishments.name',
        'establishments.entity_type',
        'establishments.description',
        'establishments.phone',
        'establishments.whatsapp',
        'establishments.email',
        'establishments.opening_hours',
        'establishments.verification_status',
        'establishments.published_at',
        'establishments.updated_at',
        'categories.slug as category_slug',
        'categories.name as category_name',
      ])
      .where('establishments.slug', '=', slug)
      .where('establishments.publication_status', '=', 'PUBLISHED')
      .executeTakeFirst();
    if (!listing) throw notFound();

    const [location, photos] = await Promise.all([
      this.db
        .selectFrom('public_locations')
        .innerJoin('communes', 'communes.id', 'public_locations.commune_id')
        .select([
          'public_locations.id',
          'public_locations.location_type',
          'public_locations.visibility',
          'public_locations.address_hint',
          'communes.slug as commune_slug',
          'communes.name as commune_name',
          sql<number | null>`ST_Y(public_locations.geom::geometry)`.as('lat'),
          sql<number | null>`ST_X(public_locations.geom::geometry)`.as('lng'),
        ])
        .where('public_locations.establishment_id', '=', listing.id)
        .where('public_locations.is_primary', '=', true)
        .executeTakeFirst(),
      this.db
        .selectFrom('media')
        .select(['id', 'is_cover'])
        .where('establishment_id', '=', listing.id)
        .where('status', '=', 'APPROVED')
        .orderBy('is_cover', 'desc')
        .orderBy('display_order')
        .orderBy('created_at')
        .execute(),
    ]);

    const served = location
      ? await this.db
          .selectFrom('location_served_communes')
          .innerJoin(
            'communes',
            'communes.id',
            'location_served_communes.commune_id',
          )
          .select(['communes.slug', 'communes.name'])
          .where('location_served_communes.location_id', '=', location.id)
          .orderBy('communes.slug')
          .execute()
      : [];

    return {
      slug: listing.slug,
      name: listing.name,
      entityType: listing.entity_type,
      category: { slug: listing.category_slug, name: listing.category_name },
      description: listing.description,
      phone: listing.phone,
      whatsapp: listing.whatsapp,
      email: listing.email,
      openingHours: (listing.opening_hours as OpeningHours | null) ?? null,
      services: await loadServices(this.db, listing.id),
      verificationStatus: listing.verification_status,
      publishedAt: listing.published_at,
      updatedAt: listing.updated_at,
      location: location
        ? {
            type: location.location_type,
            commune: {
              slug: location.commune_slug,
              name: location.commune_name,
            },
            position:
              location.lat !== null && location.lng !== null
                ? { lat: location.lat, lng: location.lng }
                : null,
            approximate: location.visibility === 'APPROXIMATE',
            addressHint: location.address_hint,
            servedCommunes: served,
          }
        : null,
      // The cover may be awaiting a decision: then the first approved one leads.
      photos: photos.map((photo, index) => ({
        id: photo.id,
        isCover: index === 0,
      })),
    };
  }

  /** An approved photo of a published listing; 404 for anything else. */
  async photo(slug: string, mediaId: string): Promise<Buffer> {
    if (!SLUG.test(slug)) throw notFound();
    const row = await this.db
      .selectFrom('media')
      .innerJoin(
        'establishments',
        'establishments.id',
        'media.establishment_id',
      )
      .select('media.storage_key')
      .where('media.id', '=', mediaId)
      .where('media.status', '=', 'APPROVED')
      .where('establishments.slug', '=', slug)
      .where('establishments.publication_status', '=', 'PUBLISHED')
      .executeTakeFirst();
    const photo = row && (await this.storage.get(row.storage_key));
    if (!photo) throw new NotFoundException({ message: 'Photo introuvable.' });
    return photo;
  }
}
