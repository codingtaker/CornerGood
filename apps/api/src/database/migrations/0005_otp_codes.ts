import { Kysely, sql } from 'kysely';

/*
 * One-time codes sent by SMS (decided on 2026-11-20): they let the owner of a
 * number lift a sign-in block (LOGIN_UNLOCK) or choose a new password
 * (PASSWORD_RESET). Only an HMAC of the code is stored, with a server secret
 * (OTP_SECRET), so a leaked table does not give live codes.
 */

export const APP_ROLE_GRANTS: Readonly<Record<string, string>> = {
  otp_codes: 'SELECT, INSERT, UPDATE, DELETE',
};

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE otp_codes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      purpose text NOT NULL CHECK (purpose IN ('LOGIN_UNLOCK', 'PASSWORD_RESET')),
      code_hash bytea NOT NULL CHECK (octet_length(code_hash) = 32),
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      CONSTRAINT otp_expires_after_creation CHECK (expires_at > created_at)
    );
    -- A new code replaces the previous one: one live code per account and purpose.
    CREATE UNIQUE INDEX otp_codes_one_live
      ON otp_codes (user_id, purpose) WHERE consumed_at IS NULL;
    CREATE INDEX otp_codes_expires_at_idx ON otp_codes (expires_at);

    GRANT SELECT, INSERT, UPDATE, DELETE ON otp_codes TO cornergood_app;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS otp_codes;`.execute(db);
}
