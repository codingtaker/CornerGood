import { Kysely, sql } from 'kysely';

/*
 * Counters that slow down password guessing (code review of 2026-11-20,
 * vulnerability 2). One row per key: "login:phone:+228…", "login:ip:…",
 * "register:ip:…". They live in the database, not in the memory of one API
 * process, so the limits hold with several API instances.
 */

export const APP_ROLE_GRANTS: Readonly<Record<string, string>> = {
  auth_throttle: 'SELECT, INSERT, UPDATE, DELETE',
};

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE auth_throttle (
      key text PRIMARY KEY CHECK (char_length(key) <= 200),
      failures integer NOT NULL CHECK (failures >= 0),
      window_started_at timestamptz NOT NULL,
      blocked_until timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    -- Used to purge counters nobody has touched for a while.
    CREATE INDEX auth_throttle_updated_at_idx ON auth_throttle (updated_at);

    GRANT SELECT, INSERT, UPDATE, DELETE ON auth_throttle TO cornergood_app;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS auth_throttle;`.execute(db);
}
