import { Kysely, sql } from 'kysely';

/*
 * Photo decisions (S4, ADR-019, ADR-039), logged like every other decision
 * (ADR-011).
 *
 * 1. media.rejection_reason: the professional sees why a photo was refused.
 * 2. moderation_log.media_id and the actions APPROVE_MEDIA and REJECT_MEDIA.
 *    media_id has no foreign key on purpose: the professional may delete a
 *    refused photo, and the log must keep the decision. ON DELETE SET NULL
 *    would be an UPDATE, which the append-only trigger refuses.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE media
      ADD COLUMN rejection_reason text,
      -- "IS NOT NULL" is required: a CHECK that evaluates to NULL is accepted.
      ADD CONSTRAINT rejected_media_has_reason CHECK (
        status <> 'REJECTED'
        OR (rejection_reason IS NOT NULL AND char_length(btrim(rejection_reason)) > 0)
      ),
      ADD CONSTRAINT media_reason_only_when_rejected CHECK (
        status = 'REJECTED' OR rejection_reason IS NULL
      );

    ALTER TABLE moderation_log
      ADD COLUMN media_id uuid,
      DROP CONSTRAINT moderation_log_action_check,
      ADD CONSTRAINT moderation_log_action_check CHECK (action IN (
        'SUBMIT', 'REQUEST_CHANGES', 'ESCALATE', 'APPROVE', 'REJECT',
        'SUSPEND', 'REINSTATE', 'ARCHIVE', 'EDIT', 'VERIFY', 'UNVERIFY',
        'APPROVE_MEDIA', 'REJECT_MEDIA'
      )),
      -- A photo decision names its photo and changes no listing status.
      ADD CONSTRAINT media_decision_names_its_photo CHECK (
        CASE WHEN action IN ('APPROVE_MEDIA', 'REJECT_MEDIA')
          THEN media_id IS NOT NULL AND from_status IS NULL AND to_status IS NULL
          ELSE media_id IS NULL
        END
      ),
      DROP CONSTRAINT decision_has_reason,
      ADD CONSTRAINT decision_has_reason CHECK (
        action NOT IN ('REQUEST_CHANGES', 'REJECT', 'SUSPEND', 'REJECT_MEDIA')
        OR (reason IS NOT NULL AND char_length(btrim(reason)) > 0)
      );
  `.execute(db);
}

/** Fails once a photo decision is logged: the log is never rewritten. */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE moderation_log
      DROP CONSTRAINT decision_has_reason,
      ADD CONSTRAINT decision_has_reason CHECK (
        action NOT IN ('REQUEST_CHANGES', 'REJECT', 'SUSPEND')
        OR (reason IS NOT NULL AND char_length(btrim(reason)) > 0)
      ),
      DROP CONSTRAINT media_decision_names_its_photo,
      DROP CONSTRAINT moderation_log_action_check,
      ADD CONSTRAINT moderation_log_action_check CHECK (action IN (
        'SUBMIT', 'REQUEST_CHANGES', 'ESCALATE', 'APPROVE', 'REJECT',
        'SUSPEND', 'REINSTATE', 'ARCHIVE', 'EDIT', 'VERIFY', 'UNVERIFY'
      )),
      DROP COLUMN media_id;

    ALTER TABLE media
      DROP CONSTRAINT media_reason_only_when_rejected,
      DROP CONSTRAINT rejected_media_has_reason,
      DROP COLUMN rejection_reason;
  `.execute(db);
}
