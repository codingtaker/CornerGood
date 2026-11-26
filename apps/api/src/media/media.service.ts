import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Kysely, Transaction } from 'kysely';
import { KYSELY } from '../database/database.module';
import type {
  Database,
  MediaStatus,
  PublicationStatus,
} from '../database/database.types';
import { MEDIA_STORAGE, newMediaKey } from './media-storage';
import type { MediaStorage } from './media-storage';
import { cleanPhoto, UnsupportedPhotoError } from './photo-processor';

/** Photos one listing may have (ADR-040). */
export const MAX_PHOTOS_PER_LISTING = 6;

/**
 * A listing under review must not change behind the moderator's back, and a
 * published one only changes through a revision (ADR-023).
 */
const EDITABLE: readonly PublicationStatus[] = ['DRAFT', 'REJECTED'];

export interface OwnPhoto {
  id: string;
  status: MediaStatus;
  isCover: boolean;
  /** Why a moderator refused it (REJECTED only). */
  rejectionReason: string | null;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
  ) {}

  async list(userId: string, listingId: string): Promise<OwnPhoto[]> {
    const rows = await this.db
      .selectFrom('media')
      .innerJoin('establishments', 'establishments.id', 'establishment_id')
      .select([
        'media.id',
        'media.status',
        'media.is_cover',
        'media.rejection_reason',
      ])
      .where('establishment_id', '=', listingId)
      .where('establishments.owner_id', '=', userId)
      .orderBy('media.is_cover', 'desc')
      .orderBy('media.display_order')
      .orderBy('media.created_at')
      .execute();
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      isCover: row.is_cover,
      rejectionReason: row.rejection_reason,
    }));
  }

  /** Adds a photo, always PENDING (ADR-019); the first one is the cover. */
  async add(
    userId: string,
    listingId: string,
    file: Buffer,
  ): Promise<OwnPhoto> {
    // First without a lock, so a refusal costs no image processing.
    await this.checkRoom(this.db, userId, listingId);

    let photo: Buffer;
    try {
      photo = await cleanPhoto(file);
    } catch (error) {
      if (error instanceof UnsupportedPhotoError) {
        throw new UnsupportedMediaTypeException({
          message:
            'Cette photo est illisible. Choisissez une image JPEG, PNG ou WebP.',
        });
      }
      throw error;
    }

    const key = newMediaKey(listingId);
    await this.storage.put(key, photo);
    try {
      return await this.db.transaction().execute(async (trx) => {
        // The lock makes simultaneous uploads count one after the other.
        const { count, last, hasCover } = await this.checkRoom(
          trx,
          userId,
          listingId,
        );
        const row = await trx
          .insertInto('media')
          .values({
            establishment_id: listingId,
            storage_key: key,
            mime_type: 'image/webp',
            size_bytes: photo.length,
            display_order: count === 0 ? 0 : last + 1,
            is_cover: !hasCover,
          })
          .returning(['id', 'status', 'is_cover'])
          .executeTakeFirstOrThrow();
        return {
          id: row.id,
          status: row.status,
          isCover: row.is_cover,
          rejectionReason: null,
        };
      });
    } catch (error) {
      await this.deleteFiles([key]);
      throw error;
    }
  }

  /** The file, for the owner of its listing; 404 for anyone else. */
  async read(
    userId: string,
    listingId: string,
    mediaId: string,
  ): Promise<Buffer> {
    const row = await this.db
      .selectFrom('media')
      .innerJoin('establishments', 'establishments.id', 'establishment_id')
      .select('media.storage_key')
      .where('media.id', '=', mediaId)
      .where('establishment_id', '=', listingId)
      .where('establishments.owner_id', '=', userId)
      .executeTakeFirst();
    const photo = row && (await this.storage.get(row.storage_key));
    if (!photo) throw new NotFoundException({ message: 'Photo introuvable.' });
    return photo;
  }

  /** Any photo, for moderators (the route checks the role). */
  async readForModeration(mediaId: string): Promise<Buffer> {
    const row = await this.db
      .selectFrom('media')
      .select('storage_key')
      .where('id', '=', mediaId)
      .executeTakeFirst();
    const photo = row && (await this.storage.get(row.storage_key));
    if (!photo) throw new NotFoundException({ message: 'Photo introuvable.' });
    return photo;
  }

  async remove(
    userId: string,
    listingId: string,
    mediaId: string,
  ): Promise<void> {
    const key = await this.db.transaction().execute(async (trx) => {
      await this.lockEditable(trx, userId, listingId);
      const row = await trx
        .deleteFrom('media')
        .where('id', '=', mediaId)
        .where('establishment_id', '=', listingId)
        .returning(['storage_key', 'is_cover'])
        .executeTakeFirst();
      if (!row) {
        throw new NotFoundException({ message: 'Photo introuvable.' });
      }
      if (row.is_cover) {
        // The next photo becomes the cover.
        await trx
          .updateTable('media')
          .set({ is_cover: true })
          .where('id', '=', (eb) =>
            eb
              .selectFrom('media')
              .select('id')
              .where('establishment_id', '=', listingId)
              .orderBy('display_order')
              .orderBy('created_at')
              .limit(1),
          )
          .execute();
      }
      return row.storage_key;
    });
    await this.deleteFiles([key]);
  }

  /**
   * Once the rows are gone the files are unreachable: a failure here is
   * logged and does not undo the deletion.
   */
  async deleteFiles(keys: string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.storage.delete(key);
      } catch (error) {
        this.logger.error(
          `Photo file ${key} could not be deleted: ${(error as Error).message}`,
        );
      }
    }
  }

  private async lockEditable(
    db: Kysely<Database> | Transaction<Database>,
    userId: string,
    listingId: string,
  ): Promise<void> {
    let query = db
      .selectFrom('establishments')
      .select('publication_status')
      .where('id', '=', listingId)
      .where('owner_id', '=', userId);
    if (db.isTransaction) query = query.forUpdate();
    const listing = await query.executeTakeFirst();
    if (!listing)
      throw new NotFoundException({ message: 'Fiche introuvable.' });
    if (!EDITABLE.includes(listing.publication_status)) {
      throw new ConflictException({
        message:
          'Les photos de cette fiche ne peuvent pas être modifiées dans son état actuel.',
      });
    }
  }

  private async checkRoom(
    db: Kysely<Database> | Transaction<Database>,
    userId: string,
    listingId: string,
  ): Promise<{ count: number; last: number; hasCover: boolean }> {
    await this.lockEditable(db, userId, listingId);
    const photos = await db
      .selectFrom('media')
      .select(['display_order', 'is_cover'])
      .where('establishment_id', '=', listingId)
      .execute();
    if (photos.length >= MAX_PHOTOS_PER_LISTING) {
      throw new UnprocessableEntityException({
        message: `Une fiche compte au plus ${MAX_PHOTOS_PER_LISTING} photos.`,
      });
    }
    return {
      count: photos.length,
      last: Math.max(0, ...photos.map((photo) => photo.display_order)),
      hasCover: photos.some((photo) => photo.is_cover),
    };
  }
}
