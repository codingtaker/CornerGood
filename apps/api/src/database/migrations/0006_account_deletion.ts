import { Kysely, sql } from 'kysely';

/*
 * Deleting an account (code review of 2026-11-20, personal data). The row of a
 * user cannot be deleted: listings, revisions and the moderation log refer to
 * it with ON DELETE RESTRICT, and the log must stay as evidence. So a deleted
 * account keeps its row, emptied of personal data:
 * - deleted_at is set, and the account is inactive for good;
 * - name "Compte supprimé", no phone, no email, an unusable password.
 * The phone becomes optional for that reason only: a live account still needs
 * one. A number freed this way can open a new account.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE users
      ADD COLUMN deleted_at timestamptz,
      ALTER COLUMN phone DROP NOT NULL,
      ADD CONSTRAINT live_account_has_phone
        CHECK (deleted_at IS NOT NULL OR phone IS NOT NULL),
      ADD CONSTRAINT deleted_account_is_anonymous CHECK (
        deleted_at IS NULL OR (
          NOT is_active AND phone IS NULL AND email IS NULL
          AND full_name = 'Compte supprimé'
        )
      );
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Refused while a deleted account exists: it has no phone to give back.
  await sql`
    ALTER TABLE users
      DROP CONSTRAINT deleted_account_is_anonymous,
      DROP CONSTRAINT live_account_has_phone,
      ALTER COLUMN phone SET NOT NULL,
      DROP COLUMN deleted_at;
  `.execute(db);
}
