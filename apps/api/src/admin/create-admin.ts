import { createDatabasePool } from '../database/database.module';
import { createKysely } from '../database/kysely';
import { readDatabaseUrl } from '../database/load-env';
import {
  createFirstAdmin,
  FirstAdminError,
  readFirstAdminInput,
} from './first-admin';

// Usage: npm run admin:create (after npm run db:migrate), with ADMIN_FULL_NAME,
// ADMIN_PHONE, ADMIN_PASSWORD and optionally ADMIN_EMAIL set (see README).
async function main(): Promise<void> {
  const databaseUrl = readDatabaseUrl(); // also loads the root .env file

  let input;
  try {
    input = readFirstAdminInput(process.env);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }

  const db = createKysely(createDatabasePool(databaseUrl));
  try {
    await createFirstAdmin(db, input);
    console.log(`Administrator created for ${input.phone}.`);
    console.log(
      'Now remove ADMIN_PASSWORD from .env or from your shell: it is no longer needed.',
    );
  } catch (error) {
    console.error(
      error instanceof FirstAdminError
        ? error.message
        : `Could not create the administrator: ${(error as Error).message}`,
    );
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

void main();
