import { Kysely } from 'kysely';
import { Database, UserRole } from '../database/database.types';
import { spendVerificationTime, verifyPassword } from './password-hasher';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  fullName: string;
}

/**
 * Checks a phone and password for sign-in (S2). Returns the user, or null for
 * every kind of failure: unknown phone, wrong password, deactivated account.
 * The caller answers all of them with the same message.
 *
 * Every call does exactly one scrypt verification, against a dummy hash when
 * no account matches, so the response time does not reveal which numbers have
 * an account. A deactivated account is checked like any other for the same
 * reason.
 *
 * @param phone already normalised to E.164 (+228…), as stored in users.phone.
 */
export async function checkCredentials(
  db: Kysely<Database>,
  phone: string,
  password: string,
): Promise<AuthenticatedUser | null> {
  const user = await db
    .selectFrom('users')
    .select(['id', 'role', 'full_name', 'is_active', 'password_hash'])
    .where('phone', '=', phone)
    .executeTakeFirst();

  if (!user) {
    await spendVerificationTime(password);
    return null;
  }

  const passwordMatches = await verifyPassword(password, user.password_hash);
  if (!passwordMatches || !user.is_active) return null;
  return {
    id: user.id,
    role: user.role,
    fullName: user.full_name,
  };
}
