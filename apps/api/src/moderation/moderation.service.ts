import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY } from '../database/database.module';
import type {
  Database,
  EntityType,
  LocationType,
  MediaStatus,
  ModerationAction,
  PublicationStatus,
  UserRole,
} from '../database/database.types';
import { ListingsService } from '../listings/listings.service';
import type { OwnListing } from '../listings/listings.service';

/** Long enough to explain, short enough to read on a phone. */
export const MAX_REASON_LENGTH = 500;

export interface QueuedListing {
  id: string;
  name: string;
  entityType: EntityType;
  category: string;
  commune: string | null;
  locationType: LocationType | null;
  submittedAt: Date;
  pendingPhotos: number;
}

export interface ModerationPhoto {
  id: string;
  status: MediaStatus;
  isCover: boolean;
  rejectionReason: string | null;
}

export interface LogEntry {
  id: string;
  action: ModerationAction;
  fromStatus: PublicationStatus | null;
  toStatus: PublicationStatus | null;
  reason: string | null;
  mediaId: string | null;
  actor: { name: string; role: UserRole };
  at: Date;
}

export interface ModerationListing extends OwnListing {
  /** Null once the account is deleted. */
  owner: { name: string; phone: string | null } | null;
  publishedAt: Date | null;
  photos: ModerationPhoto[];
  log: LogEntry[];
}

/** 409 with a stable code: a repeated or late decision fails cleanly. */
function invalidState(message: string): ConflictException {
  return new ConflictException({ code: 'INVALID_STATE', message });
}

/** The reason of a refusal: required, trimmed, bounded (ADR-011). */
export function readReason(body: unknown): string {
  const raw =
    typeof body === 'object' && body !== null
      ? (body as { reason?: unknown }).reason
      : undefined;
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (reason.length === 0 || reason.length > MAX_REASON_LENGTH) {
    throw new UnprocessableEntityException({
      code: 'REASON_REQUIRED',
      message: `Expliquez la décision en 1 à ${MAX_REASON_LENGTH} caractères : le professionnel la lira.`,
      fields: { reason: 'Motif requis.' },
    });
  }
  return reason;
}

/**
 * Decisions of the back-office (S4). Each one changes a status and writes its
 * line in moderation_log in the same transaction (ADR-011), behind a row lock:
 * two moderators deciding at once see the first decision, not the old status.
 */
@Injectable()
export class ModerationService {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    private readonly listings: ListingsService,
  ) {}

  /** Listings awaiting a decision, the oldest submission first. */
  async queue(): Promise<QueuedListing[]> {
    const rows = await this.db
      .selectFrom('establishments')
      .innerJoin('categories', 'categories.id', 'establishments.category_id')
      .leftJoin('locations', (join) =>
        join
          .onRef('locations.establishment_id', '=', 'establishments.id')
          .on('locations.is_primary', '=', true),
      )
      .leftJoin('communes', 'communes.id', 'locations.commune_id')
      .select((eb) => [
        'establishments.id',
        'establishments.name',
        'establishments.entity_type',
        'categories.name as category',
        'communes.name as commune',
        'locations.location_type',
        eb
          .selectFrom('moderation_log')
          .select((inner) => inner.fn.max('created_at').as('at'))
          .whereRef('moderation_log.establishment_id', '=', 'establishments.id')
          .where('moderation_log.action', '=', 'SUBMIT')
          .as('submitted_at'),
        eb
          .selectFrom('media')
          .select((inner) => inner.fn.countAll<string>().as('count'))
          .whereRef('media.establishment_id', '=', 'establishments.id')
          .where('media.status', '=', 'PENDING')
          .as('pending_photos'),
      ])
      .where('establishments.publication_status', '=', 'PENDING')
      .orderBy('submitted_at', 'asc')
      .execute();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      entityType: row.entity_type,
      category: row.category,
      commune: row.commune,
      locationType: row.location_type,
      submittedAt: row.submitted_at as Date,
      pendingPhotos: Number(row.pending_photos),
    }));
  }

  /** Everything needed to decide: private data, photos and history. */
  async get(id: string): Promise<ModerationListing> {
    const listing = await this.listings.getForModeration(id);
    const [extra, photos, log] = await Promise.all([
      this.db
        .selectFrom('establishments')
        .leftJoin('users', 'users.id', 'establishments.owner_id')
        .select([
          'establishments.published_at',
          'users.full_name as owner_name',
          'users.phone as owner_phone',
          'users.deleted_at as owner_deleted_at',
        ])
        .where('establishments.id', '=', id)
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('media')
        .select(['id', 'status', 'is_cover', 'rejection_reason'])
        .where('establishment_id', '=', id)
        .orderBy('is_cover', 'desc')
        .orderBy('display_order')
        .orderBy('created_at')
        .execute(),
      this.db
        .selectFrom('moderation_log')
        .innerJoin('users', 'users.id', 'moderation_log.actor_id')
        .select([
          'moderation_log.id',
          'moderation_log.action',
          'moderation_log.from_status',
          'moderation_log.to_status',
          'moderation_log.reason',
          'moderation_log.media_id',
          'moderation_log.created_at',
          'users.full_name',
          'users.role',
        ])
        .where('moderation_log.establishment_id', '=', id)
        .orderBy('moderation_log.created_at', 'desc')
        .execute(),
    ]);

    return {
      ...listing,
      owner:
        extra.owner_name !== null && extra.owner_deleted_at === null
          ? { name: extra.owner_name, phone: extra.owner_phone }
          : null,
      publishedAt: extra.published_at,
      photos: photos.map((photo) => ({
        id: photo.id,
        status: photo.status,
        isCover: photo.is_cover,
        rejectionReason: photo.rejection_reason,
      })),
      log: log.map((entry) => ({
        id: entry.id,
        action: entry.action,
        fromStatus: entry.from_status,
        toStatus: entry.to_status,
        reason: entry.reason,
        mediaId: entry.media_id,
        actor: { name: entry.full_name, role: entry.role },
        at: entry.created_at,
      })),
    };
  }

  /** PENDING → PUBLISHED (ADR-010: administrator only, checked on the route). */
  async approve(actorId: string, id: string): Promise<ModerationListing> {
    await this.decide(actorId, id, {
      action: 'APPROVE',
      to: 'PUBLISHED',
      reason: null,
    });
    return this.get(id);
  }

  /** PENDING → REJECTED; the professional reads the reason, corrects, resends. */
  async reject(
    actorId: string,
    id: string,
    reason: string,
  ): Promise<ModerationListing> {
    await this.decide(actorId, id, {
      action: 'REJECT',
      to: 'REJECTED',
      reason,
    });
    return this.get(id);
  }

  private async decide(
    actorId: string,
    id: string,
    decision: {
      action: 'APPROVE' | 'REJECT';
      to: 'PUBLISHED' | 'REJECTED';
      reason: string | null;
    },
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const listing = await trx
        .selectFrom('establishments')
        .select('publication_status')
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!listing) {
        throw new NotFoundException({ message: 'Fiche introuvable.' });
      }
      if (listing.publication_status !== 'PENDING') {
        throw invalidState(
          "Cette fiche n'est plus en attente de validation : une décision a déjà été prise.",
        );
      }
      await trx
        .updateTable('establishments')
        .set({
          publication_status: decision.to,
          ...(decision.to === 'PUBLISHED'
            ? { published_at: sql<Date>`now()` }
            : {}),
        })
        .where('id', '=', id)
        .execute();
      await trx
        .insertInto('moderation_log')
        .values({
          establishment_id: id,
          actor_id: actorId,
          action: decision.action,
          from_status: 'PENDING',
          to_status: decision.to,
          reason: decision.reason,
        })
        .execute();
    });
  }

  /**
   * A photo of a listing sent for validation, or already published, becomes
   * public or is refused (ADR-019, ADR-039: moderator or administrator).
   * Drafts are the professional's work in progress: not decided on.
   */
  async decidePhoto(
    actorId: string,
    mediaId: string,
    reason: string | null,
  ): Promise<ModerationPhoto> {
    return this.db.transaction().execute(async (trx) => {
      const found = await trx
        .selectFrom('media')
        .select('establishment_id')
        .where('id', '=', mediaId)
        .executeTakeFirst();
      if (!found)
        throw new NotFoundException({ message: 'Photo introuvable.' });
      // The listing first, as the professional's deletion does: same order,
      // no deadlock; and its status cannot change while we decide.
      const listing = await trx
        .selectFrom('establishments')
        .select('publication_status')
        .where('id', '=', found.establishment_id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const photo = await trx
        .selectFrom('media')
        .select('status')
        .where('id', '=', mediaId)
        .forUpdate()
        .executeTakeFirst();
      if (!photo)
        throw new NotFoundException({ message: 'Photo introuvable.' });
      if (
        listing.publication_status !== 'PENDING' &&
        listing.publication_status !== 'PUBLISHED'
      ) {
        throw invalidState(
          "Cette photo n'est pas envoyée pour validation : sa fiche est en cours de modification.",
        );
      }
      if (photo.status !== 'PENDING') {
        throw invalidState('Une décision a déjà été prise sur cette photo.');
      }

      const status: MediaStatus = reason === null ? 'APPROVED' : 'REJECTED';
      const row = await trx
        .updateTable('media')
        .set({ status, rejection_reason: reason })
        .where('id', '=', mediaId)
        .returning(['id', 'status', 'is_cover', 'rejection_reason'])
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('moderation_log')
        .values({
          establishment_id: found.establishment_id,
          media_id: mediaId,
          actor_id: actorId,
          action: reason === null ? 'APPROVE_MEDIA' : 'REJECT_MEDIA',
          reason,
        })
        .execute();
      return {
        id: row.id,
        status: row.status,
        isCover: row.is_cover,
        rejectionReason: row.rejection_reason,
      };
    });
  }
}
