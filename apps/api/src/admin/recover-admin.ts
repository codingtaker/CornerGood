import { createDatabasePool } from '../database/database.module';
import { createKysely } from '../database/kysely';
import { readDatabaseUrl } from '../database/load-env';
import { recoverAdmin } from './admin-recovery';
import {
  checkTypedPassword,
  FirstAdminError,
  MIN_PASSWORD_LENGTH,
  readRecoveryPhone,
} from './first-admin';
import { readHiddenLine } from './hidden-prompt';

// Usage: npm run admin:recover, with ADMIN_PHONE set to the phone of the
// administrator account to restore. The new password is typed at the prompt.
async function readInput(): Promise<{ phone: string; password: string }> {
  const phone = readRecoveryPhone(process.env);
  console.log(`Restoring the administrator account ${phone}.`);
  const password = await readHiddenLine(
    `New password (${MIN_PASSWORD_LENGTH} characters or more, not shown): `,
  );
  const confirmation = await readHiddenLine('Type it again: ');
  checkTypedPassword(password, confirmation);
  return { phone, password };
}

async function main(): Promise<void> {
  const databaseUrl = readDatabaseUrl(); // also loads the root .env file

  let input: { phone: string; password: string };
  try {
    input = await readInput();
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }

  const db = createKysely(createDatabasePool(databaseUrl));
  try {
    const { wasActive } = await recoverAdmin(db, input.phone, input.password);
    console.log(
      wasActive
        ? `New password set for ${input.phone}; its sessions are closed.`
        : `Account ${input.phone} reactivated with a new password; its sessions are closed.`,
    );
  } catch (error) {
    console.error(
      error instanceof FirstAdminError
        ? error.message
        : `Could not restore the administrator: ${(error as Error).message}`,
    );
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

void main();
