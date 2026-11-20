import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Loads the root .env file for command-line scripts (migrations, seed),
 * which run outside NestJS and therefore without ConfigModule.
 */
function loadRootEnv(): void {
  // npm runs workspace scripts from apps/api, like ConfigModule's envFilePath.
  const envFile = resolve(process.cwd(), '../../.env');
  if (!process.env.DATABASE_URL && existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}

/** Connection of the API: the least-privilege role cornergood_app. */
export function readDatabaseUrl(): string {
  loadRootEnv();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set (see .env.example)');
  }
  return databaseUrl;
}

/**
 * Connection of the owner of the database, for what changes the schema or the
 * reference data: migrations, seed, db:app-role. Falls back to DATABASE_URL
 * for a setup that has a single role (the API then warns at startup).
 */
export function readOwnerDatabaseUrl(): string {
  loadRootEnv();
  return process.env.DATABASE_OWNER_URL || readDatabaseUrl();
}
