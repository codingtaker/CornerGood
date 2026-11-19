import { Kysely, sql } from 'kysely';

/*
 * Aligns the schema with the API contract v1 (code review of 2026-11-18).
 * 0001 is merged, so it is never edited: every change lives here, with its down().
 *
 * 1. sessions table for server-side sessions (ADR-021).
 * 2. moderation_log also records EDIT, VERIFY and UNVERIFY (contract §6.2, §6.3).
 * 3. The exact point of a home is never public (ADR-046).
 * 4. Submission: a non-blank description, and a phone or WhatsApp number except
 *    for community places, which often have no number at all (ADR-045).
 * 5. A decided revision names the administrator who decided (ADR-010).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE sessions (
      -- SHA-256 of the cookie value. A leaked database therefore gives access
      -- to no session: the cookie value cannot be rebuilt from its hash.
      token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      CONSTRAINT session_expires_after_creation CHECK (expires_at > created_at)
    );
    -- Used to close every session of a deactivated account at once (RM-004).
    CREATE INDEX sessions_user_id_idx ON sessions (user_id);
    -- Used to purge expired sessions.
    CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

    ALTER TABLE moderation_log
      DROP CONSTRAINT moderation_log_action_check,
      ADD CONSTRAINT moderation_log_action_check CHECK (action IN (
        'SUBMIT', 'REQUEST_CHANGES', 'ESCALATE', 'APPROVE', 'REJECT',
        'SUSPEND', 'REINSTATE', 'ARCHIVE', 'EDIT', 'VERIFY', 'UNVERIFY'
      ));

    ALTER TABLE locations
      ADD CONSTRAINT home_point_stays_private
        CHECK (location_type <> 'HOME_BASED' OR visibility = 'APPROXIMATE');

    ALTER TABLE establishments
      DROP CONSTRAINT submitted_listing_is_complete,
      ADD CONSTRAINT submitted_listing_is_complete CHECK (
        publication_status IN ('DRAFT', 'ARCHIVED')
        OR (
          -- "IS NOT NULL" first: a CHECK that evaluates to NULL is accepted.
          description IS NOT NULL AND char_length(btrim(description)) > 0
          AND (entity_type = 'COMMUNITY' OR phone IS NOT NULL OR whatsapp IS NOT NULL)
        )
      );

    ALTER TABLE establishment_revisions
      ADD CONSTRAINT decided_revision_has_reviewer
        CHECK (status NOT IN ('APPROVED', 'REJECTED') OR reviewed_by_id IS NOT NULL);
  `.execute(db);
}

/*
 * Restores the 0001 rules. It fails on purpose if data written since then breaks
 * them (an EDIT log entry, a community place without phone): reverting must not
 * silently delete moderation history or listings.
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE establishment_revisions
      DROP CONSTRAINT decided_revision_has_reviewer;

    ALTER TABLE establishments
      DROP CONSTRAINT submitted_listing_is_complete,
      ADD CONSTRAINT submitted_listing_is_complete CHECK (
        publication_status IN ('DRAFT', 'ARCHIVED')
        OR (phone IS NOT NULL AND description IS NOT NULL)
      );

    ALTER TABLE locations
      DROP CONSTRAINT home_point_stays_private;

    ALTER TABLE moderation_log
      DROP CONSTRAINT moderation_log_action_check,
      ADD CONSTRAINT moderation_log_action_check CHECK (action IN (
        'SUBMIT', 'REQUEST_CHANGES', 'ESCALATE', 'APPROVE', 'REJECT',
        'SUSPEND', 'REINSTATE', 'ARCHIVE'
      ));

    DROP TABLE sessions;
  `.execute(db);
}
