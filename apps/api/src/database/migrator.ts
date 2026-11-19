import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  FileMigrationProvider,
  Kysely,
  MigrationResultSet,
  Migrator,
} from 'kysely';

export type MigrationDirection = 'latest' | 'down';

/**
 * Reverting 0001 drops every table, moderation_log included (its trigger does
 * not stop DROP TABLE). In production a mistake is fixed by a new migration
 * and backups, never by going down.
 */
export function assertMigrationAllowed(
  direction: MigrationDirection,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): void {
  if (direction === 'down' && nodeEnv === 'production') {
    throw new Error('Refusing to revert a migration in production');
  }
}

/**
 * Applies the migrations of ./migrations in alphabetical order.
 * Kysely records applied migrations in the kysely_migration table and takes a
 * lock, so two API instances starting together cannot migrate twice.
 */
export function runMigrations<DB>(
  db: Kysely<DB>,
  direction: MigrationDirection,
): Promise<MigrationResultSet> {
  assertMigrationAllowed(direction);
  const migrator = new Migrator({
    // Migrations describe the schema before it exists, so they are untyped.
    db: db as Kysely<unknown>,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, 'migrations'),
    }),
  });

  return direction === 'latest'
    ? migrator.migrateToLatest()
    : migrator.migrateDown();
}
