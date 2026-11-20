import { Kysely, sql } from 'kysely';

/*
 * The API no longer connects as the owner of the database (code review of
 * 2026-11-20, vulnerability 1). It uses cornergood_app, which can only read
 * and write rows, table by table, as the application needs:
 * - no DDL, no TRUNCATE, no TRIGGER: it cannot drop a table or disable the
 *   append-only trigger of moderation_log;
 * - moderation_log: SELECT and INSERT only, so the log stays append-only even
 *   before the trigger is reached;
 * - territory: read only (the seed, run by the owner, maintains it);
 * - categories, services, establishments, users: no DELETE, since they are
 *   deactivated or archived, never deleted;
 * - kysely_migration tables: no access.
 *
 * The role is created here without a password (NOLOGIN), so nothing secret is
 * committed. `npm run db:app-role` gives it the password of DATABASE_URL.
 * Roles are shared by every database of the server, so down() only revokes
 * the grants of this database and keeps the role.
 *
 * Every new table needs its grant in a later migration: a database test fails
 * when a table has none.
 */

export const APP_ROLE = 'cornergood_app';

const GRANTS: Record<string, string> = {
  regions: 'SELECT',
  prefectures: 'SELECT',
  communes: 'SELECT',
  users: 'SELECT, INSERT, UPDATE',
  sessions: 'SELECT, INSERT, DELETE',
  categories: 'SELECT, INSERT, UPDATE',
  services: 'SELECT, INSERT, UPDATE',
  establishments: 'SELECT, INSERT, UPDATE',
  business_profiles: 'SELECT, INSERT, UPDATE, DELETE',
  community_profiles: 'SELECT, INSERT, UPDATE, DELETE',
  locations: 'SELECT, INSERT, UPDATE, DELETE',
  location_served_communes: 'SELECT, INSERT, DELETE',
  establishment_services: 'SELECT, INSERT, UPDATE, DELETE',
  media: 'SELECT, INSERT, UPDATE, DELETE',
  establishment_revisions: 'SELECT, INSERT, UPDATE',
  moderation_log: 'SELECT, INSERT',
  reports: 'SELECT, INSERT, UPDATE',
};

export const APP_ROLE_GRANTS: Readonly<Record<string, string>> = GRANTS;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cornergood_app') THEN
        CREATE ROLE cornergood_app NOLOGIN;
      END IF;
      -- Also when the role existed already: it must never hold more power.
      ALTER ROLE cornergood_app
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO cornergood_app', current_database());
    END
    $$;
    GRANT USAGE ON SCHEMA public TO cornergood_app;
  `.execute(db);

  for (const [table, privileges] of Object.entries(GRANTS)) {
    await sql
      .raw(`GRANT ${privileges} ON TABLE public.${table} TO ${APP_ROLE}`)
      .execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM cornergood_app;
    REVOKE USAGE ON SCHEMA public FROM cornergood_app;
    DO $$
    BEGIN
      EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM cornergood_app', current_database());
    END
    $$;
  `.execute(db);
}
