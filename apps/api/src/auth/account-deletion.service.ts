import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { lockAdminAccounts } from '../admin/first-admin';
import { KYSELY } from '../database/database.module';
import type { Database } from '../database/database.types';
import { MediaService } from '../media/media.service';
import { verifyPassword } from './password-hasher';

/*
 * A user deletes their own account (code review of 2026-11-20, personal data;
 * Togolese law on the protection of personal data). The row stays, because
 * listings and the moderation log refer to it, but every personal datum goes
 * (migration 0006):
 * - name "Compte supprimé", no phone, no email, an unusable password,
 *   inactive, deleted_at set;
 * - sessions, SMS codes and the sign-in counters of the number are deleted;
 * - the account's listings are archived, each with a line in the moderation
 *   log, so they leave the public site and the trace stays;
 * - the photos of all its listings are deleted, files included.
 */

export const DELETED_NAME = 'Compte supprimé';
/** Not a valid stored hash: verifyPassword() always answers false for it. */
const UNUSABLE_PASSWORD = '!deleted';

export type DeletionOutcome = 'DELETED' | 'WRONG_PASSWORD' | 'LAST_ADMIN';

@Injectable()
export class AccountDeletionService {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    private readonly media: MediaService,
  ) {}

  async deleteAccount(
    userId: string,
    password: string,
  ): Promise<DeletionOutcome> {
    const user = await this.db
      .selectFrom('users')
      .select(['phone', 'password_hash', 'role'])
      .where('id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    // The password again: a session left open on a shared phone must not be
    // enough to delete someone's account.
    if (!(await verifyPassword(password, user.password_hash))) {
      return 'WRONG_PASSWORD';
    }

    let photoKeys: string[] = [];
    const outcome = await this.db.transaction().execute(async (trx) => {
      if (user.role === 'ADMIN') {
        // Same lock as admin:create and admin:recover.
        await lockAdminAccounts(trx);
        const otherAdmin = await trx
          .selectFrom('users')
          .select('id')
          .where('role', '=', 'ADMIN')
          .where('is_active', '=', true)
          .where('id', '!=', userId)
          .executeTakeFirst();
        // Without an administrator, nobody could moderate any more.
        if (!otherAdmin) return 'LAST_ADMIN' as const;
      }

      // Status read before the change, for the log's from_status.
      const listings = await trx
        .selectFrom('establishments')
        .select(['id', 'publication_status'])
        .where('owner_id', '=', userId)
        .where('publication_status', '!=', 'ARCHIVED')
        .forUpdate()
        .execute();
      if (listings.length > 0) {
        await trx
          .updateTable('establishments')
          .set({ publication_status: 'ARCHIVED' })
          .where(
            'id',
            'in',
            listings.map((listing) => listing.id),
          )
          .execute();
        await trx
          .insertInto('moderation_log')
          .values(
            listings.map((listing) => ({
              establishment_id: listing.id,
              actor_id: userId,
              action: 'ARCHIVE' as const,
              from_status: listing.publication_status,
              to_status: 'ARCHIVED' as const,
              reason: 'Compte supprimé par son titulaire',
            })),
          )
          .execute();
      }

      // Locked first, like an upload does: one that is still running adds its
      // photo before this, or finds an archived listing and gives up.
      const photos = await trx
        .deleteFrom('media')
        .where('establishment_id', 'in', (eb) =>
          eb
            .selectFrom('establishments')
            .select('id')
            .where('owner_id', '=', userId),
        )
        .returning('storage_key')
        .execute();
      photoKeys = photos.map((photo) => photo.storage_key);

      await trx.deleteFrom('sessions').where('user_id', '=', userId).execute();
      await trx.deleteFrom('otp_codes').where('user_id', '=', userId).execute();
      if (user.phone) {
        await trx
          .deleteFrom('auth_throttle')
          .where('key', 'in', [
            `login:phone:${user.phone}`,
            `otp:phone:${user.phone}`,
          ])
          .execute();
      }

      await trx
        .updateTable('users')
        .set({
          full_name: DELETED_NAME,
          phone: null,
          email: null,
          password_hash: UNUSABLE_PASSWORD,
          is_active: false,
          last_login_at: null,
          deleted_at: sql<Date>`now()`,
        })
        .where('id', '=', userId)
        .execute();
      return 'DELETED' as const;
    });
    // Only once the rows are gone for good.
    await this.media.deleteFiles(photoKeys);
    return outcome;
  }
}
