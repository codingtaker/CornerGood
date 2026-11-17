import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Loads the root .env file for command-line scripts (migrations, seed),
 * which run outside NestJS and therefore without ConfigModule.
 */
export function readDatabaseUrl(): string {
  // npm runs workspace scripts from apps/api, like ConfigModule's envFilePath.
  const envFile = resolve(process.cwd(), '../../.env');
  if (!process.env.DATABASE_URL && existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set (see .env.example)');
  }
  return databaseUrl;
}
