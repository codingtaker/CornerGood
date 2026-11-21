import { Kysely, sql, Transaction } from 'kysely';
import { normalisePhone } from '../auth/account-input';
import { hashPassword } from '../auth/password-hasher';
import { Database } from '../database/database.types';

/*
 * Creation of the first administrator (ADR-047). Public sign-up only creates
 * PROFESSIONAL accounts and only an administrator can create an ADMIN, so the
 * very first one is created by a command. The name, phone and email come
 * from the environment; the password is typed at the keyboard, hidden, so it
 * is never stored in a file or in the shell history. Once an ADMIN exists the
 * command refuses: further administrators are created from the application.
 */

export const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 256;
// Read like at sign-up ("90 12 34 56" is +22890123456), so the number of an
// account is written the same way everywhere.
const PHONE_PROBLEM =
  'ADMIN_PHONE is not a valid number, e.g. 90 12 34 56 or +22890123456';
const ENV_PASSWORD_PROBLEM =
  'Remove ADMIN_PASSWORD from .env and from your shell: the password is typed at the prompt';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface FirstAdminIdentity {
  fullName: string;
  phone: string;
  email: string | null;
}

export interface FirstAdminInput extends FirstAdminIdentity {
  password: string;
}

/** An error whose message can be shown as is: it never contains the password. */
export class FirstAdminError extends Error {}

export function readFirstAdminIdentity(
  env: NodeJS.ProcessEnv,
): FirstAdminIdentity {
  const fullName = (env.ADMIN_FULL_NAME ?? '').trim().replace(/\s+/g, ' ');
  const phone = normalisePhone(env.ADMIN_PHONE);
  const email = (env.ADMIN_EMAIL ?? '').trim().toLowerCase() || null;

  const problems: string[] = [];
  // ADR-047: the password is typed, never read from a file or a variable.
  if (env.ADMIN_PASSWORD !== undefined) {
    problems.push(ENV_PASSWORD_PROBLEM);
  }
  if (fullName.length < 2 || fullName.length > 120) {
    problems.push('ADMIN_FULL_NAME must be 2 to 120 characters long');
  }
  if (!phone) {
    problems.push(PHONE_PROBLEM);
  }
  if (email !== null && !EMAIL_PATTERN.test(email)) {
    problems.push('ADMIN_EMAIL is not a valid email address');
  }
  if (problems.length > 0) {
    throw new FirstAdminError(problems.join('\n'));
  }
  return { fullName, phone: phone as string, email };
}

/** For admin:recover, which only needs the phone of the account. */
export function readRecoveryPhone(env: NodeJS.ProcessEnv): string {
  const phone = normalisePhone(env.ADMIN_PHONE);
  const problems: string[] = [];
  if (env.ADMIN_PASSWORD !== undefined) problems.push(ENV_PASSWORD_PROBLEM);
  if (!phone) problems.push(PHONE_PROBLEM);
  if (problems.length > 0) {
    throw new FirstAdminError(problems.join('\n'));
  }
  return phone as string;
}

/**
 * Serialises admin:create and admin:recover until the end of the transaction,
 * so two runs cannot both see "no administrator" or "no active administrator".
 */
export async function lockAdminAccounts(trx: Transaction<Database>) {
  await sql`SELECT pg_advisory_xact_lock(hashtext('cornergood:first-admin'))`.execute(
    trx,
  );
}

/** Checks the password typed twice at the prompt. */
export function checkTypedPassword(
  password: string,
  confirmation: string,
): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new FirstAdminError(
      `The password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
    );
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new FirstAdminError(
      `The password must be at most ${MAX_PASSWORD_LENGTH} characters long.`,
    );
  }
  if (password !== confirmation) {
    throw new FirstAdminError('The two passwords do not match.');
  }
}

export async function createFirstAdmin(
  db: Kysely<Database>,
  input: FirstAdminInput,
): Promise<{ id: string }> {
  // Hashing is slow on purpose: do it before holding the lock.
  const passwordHash = await hashPassword(input.password);

  return db.transaction().execute(async (trx) => {
    // Two runs at the same time must not both see "no administrator yet".
    await lockAdminAccounts(trx);

    const existingAdmin = await trx
      .selectFrom('users')
      .select('id')
      .where('role', '=', 'ADMIN')
      .executeTakeFirst();
    if (existingAdmin) {
      throw new FirstAdminError(
        'An administrator already exists: create other administrators from the application.' +
          ' If no administrator can sign in any more, use npm run admin:recover.',
      );
    }

    const taken = await trx
      .selectFrom('users')
      .select(['phone', 'email'])
      .where((eb) =>
        eb.or([
          eb('phone', '=', input.phone),
          ...(input.email ? [eb(sql`lower(email)`, '=', input.email)] : []),
        ]),
      )
      .executeTakeFirst();
    if (taken) {
      throw new FirstAdminError(
        taken.phone === input.phone
          ? 'ADMIN_PHONE is already used by another account.'
          : 'ADMIN_EMAIL is already used by another account.',
      );
    }

    return trx
      .insertInto('users')
      .values({
        full_name: input.fullName,
        phone: input.phone,
        email: input.email,
        password_hash: passwordHash,
        role: 'ADMIN',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  });
}
