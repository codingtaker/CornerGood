import { Pool } from 'pg';
import { createDatabasePool } from './database.module';
import { readDatabaseUrl, readOwnerDatabaseUrl } from './load-env';
import { APP_ROLE } from './migrations/0003_least_privilege_app_role';

/*
 * Usage: npm run db:app-role (once, after npm run db:migrate).
 *
 * Migration 0003 creates the API role without a password. This command lets
 * it sign in, with the user name and password written in DATABASE_URL, so the
 * password lives in .env (or the host's secrets) and nowhere else. Run it again
 * to change the password. It connects with DATABASE_OWNER_URL.
 */

const MIN_PASSWORD_LENGTH = 16;

export function readAppCredentials(databaseUrl: string): {
  user: string;
  password: string;
} {
  const url = new URL(databaseUrl);
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (user !== APP_ROLE) {
    throw new Error(
      `DATABASE_URL must connect as ${APP_ROLE} (found "${user}"); the owner goes in DATABASE_OWNER_URL`,
    );
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `The password of ${APP_ROLE} in DATABASE_URL must be at least ${MIN_PASSWORD_LENGTH} characters long`,
    );
  }
  return { user, password };
}

export async function enableAppRole(owner: Pool, password: string) {
  // ALTER ROLE takes no parameters: format(%L) quotes the password safely.
  const { rows } = await owner.query<{ statement: string }>(
    `SELECT format('ALTER ROLE ${APP_ROLE} LOGIN PASSWORD %L', $1::text) AS statement`,
    [password],
  );
  await owner.query(rows[0].statement);
}

async function main(): Promise<void> {
  let password: string;
  let ownerUrl: string;
  try {
    ({ password } = readAppCredentials(readDatabaseUrl()));
    ownerUrl = readOwnerDatabaseUrl();
    if (ownerUrl === process.env.DATABASE_URL) {
      throw new Error('Set DATABASE_OWNER_URL to the owner of the database');
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }

  const owner = createDatabasePool(ownerUrl);
  try {
    await enableAppRole(owner, password);
    console.log(
      `${APP_ROLE} can now sign in with the password of DATABASE_URL.`,
    );
  } catch (error) {
    console.error(
      `Could not enable ${APP_ROLE} (did you run npm run db:migrate?): ${(error as Error).message}`,
    );
    process.exitCode = 1;
  } finally {
    await owner.end();
  }
}

if (require.main === module) void main();
