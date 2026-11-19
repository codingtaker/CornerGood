import { createDatabasePool } from '../database/database.module';
import { createKysely } from '../database/kysely';
import { readDatabaseUrl } from '../database/load-env';
import {
  checkTypedPassword,
  createFirstAdmin,
  FirstAdminError,
  FirstAdminInput,
  MIN_PASSWORD_LENGTH,
  readFirstAdminIdentity,
} from './first-admin';
import { readHiddenLine } from './hidden-prompt';

// Usage: npm run admin:create (after npm run db:migrate), with ADMIN_FULL_NAME,
// ADMIN_PHONE and optionally ADMIN_EMAIL set (see README). The password is
// typed at the prompt (ADR-047).
async function readInput(): Promise<FirstAdminInput> {
  const identity = readFirstAdminIdentity(process.env);
  console.log(
    `Creating the first administrator for ${identity.fullName} (${identity.phone}).`,
  );
  const password = await readHiddenLine(
    `Password (${MIN_PASSWORD_LENGTH} characters or more, not shown): `,
  );
  const confirmation = await readHiddenLine('Type it again: ');
  checkTypedPassword(password, confirmation);
  return { ...identity, password };
}

async function main(): Promise<void> {
  const databaseUrl = readDatabaseUrl(); // also loads the root .env file

  let input: FirstAdminInput;
  try {
    input = await readInput();
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }

  const db = createKysely(createDatabasePool(databaseUrl));
  try {
    await createFirstAdmin(db, input);
    console.log(`Administrator created for ${input.phone}.`);
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
