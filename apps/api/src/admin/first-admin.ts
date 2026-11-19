import { Kysely, sql } from 'kysely';
import { hashPassword } from '../auth/password-hasher';
import { Database } from '../database/database.types';

/*
 * Creation of the first administrator (ADR-047). Public sign-up only creates
 * PROFESSIONAL accounts and only an administrator can create an ADMIN, so the
 * very first one is created by a command, with a password read from the
 * environment and never committed. Once an ADMIN exists the command refuses:
 * further administrators are created from the application.
 */

export const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 256;
// Same rule as the CHECK constraint on users.phone (E.164).
const PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface FirstAdminInput {
  fullName: string;
  phone: string;
  email: string | null;
  password: string;
}

/** An error whose message can be shown as is: it never contains the password. */
export class FirstAdminError extends Error {}

export function readFirstAdminInput(env: NodeJS.ProcessEnv): FirstAdminInput {
  const fullName = (env.ADMIN_FULL_NAME ?? '').trim().replace(/\s+/g, ' ');
  const phone = (env.ADMIN_PHONE ?? '').replace(/[\s.-]/g, '');
  const email = (env.ADMIN_EMAIL ?? '').trim().toLowerCase() || null;
  const password = env.ADMIN_PASSWORD ?? '';

  const problems: string[] = [];
  if (fullName.length < 2 || fullName.length > 120) {
    problems.push('ADMIN_FULL_NAME must be 2 to 120 characters long');
  }
  if (!PHONE_PATTERN.test(phone)) {
    problems.push(
      'ADMIN_PHONE must be in international format, e.g. +22890000000',
    );
  }
  if (email !== null && !EMAIL_PATTERN.test(email)) {
    problems.push('ADMIN_EMAIL is not a valid email address');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    problems.push(
      `ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters long`,
    );
  } else if (password.length > MAX_PASSWORD_LENGTH) {
    problems.push(
      `ADMIN_PASSWORD must be at most ${MAX_PASSWORD_LENGTH} characters long`,
    );
  }
  if (problems.length > 0) {
    throw new FirstAdminError(problems.join('\n'));
  }
  return { fullName, phone, email, password };
}

export async function createFirstAdmin(
  db: Kysely<Database>,
  input: FirstAdminInput,
): Promise<{ id: string }> {
  // Hashing is slow on purpose: do it before holding the lock.
  const passwordHash = await hashPassword(input.password);

  return db.transaction().execute(async (trx) => {
    // Two runs at the same time must not both see "no administrator yet".
    await sql`SELECT pg_advisory_xact_lock(hashtext('cornergood:first-admin'))`.execute(
      trx,
    );

    const existingAdmin = await trx
      .selectFrom('users')
      .select('id')
      .where('role', '=', 'ADMIN')
      .executeTakeFirst();
    if (existingAdmin) {
      throw new FirstAdminError(
        'An administrator already exists: create other administrators from the application.',
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
