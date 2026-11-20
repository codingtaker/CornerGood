import { Kysely } from 'kysely';
import { hashPassword } from '../auth/password-hasher';
import { Database } from '../database/database.types';
import { FirstAdminError, lockAdminAccounts } from './first-admin';

/*
 * Way out when no administrator can sign in any more: the only administrator
 * was deactivated, or forgot their password. Without it the only fix would be
 * hand-written SQL.
 *
 * It reactivates an existing ADMIN account, gives it a new password and closes
 * its sessions. It refuses while another administrator is active: that
 * administrator can do the same from the application, with a trace. Running it
 * needs access to the server and its database, like any SQL fix would.
 */
export async function recoverAdmin(
  db: Kysely<Database>,
  phone: string,
  password: string,
): Promise<{ id: string; wasActive: boolean }> {
  // Hashing is slow on purpose: do it before holding the lock.
  const passwordHash = await hashPassword(password);

  return db.transaction().execute(async (trx) => {
    await lockAdminAccounts(trx);

    const account = await trx
      .selectFrom('users')
      .select(['id', 'role', 'is_active'])
      .where('phone', '=', phone)
      .executeTakeFirst();
    if (!account) {
      throw new FirstAdminError('No account uses this ADMIN_PHONE.');
    }
    if (account.role !== 'ADMIN') {
      throw new FirstAdminError(
        'This account is not an administrator: admin:recover only restores administrators.',
      );
    }

    const otherActiveAdmin = await trx
      .selectFrom('users')
      .select('id')
      .where('role', '=', 'ADMIN')
      .where('is_active', '=', true)
      .where('id', '!=', account.id)
      .executeTakeFirst();
    if (otherActiveAdmin) {
      throw new FirstAdminError(
        'Another administrator is active: ask them to reactivate this account or reset its password from the application.',
      );
    }

    await trx
      .updateTable('users')
      .set({ is_active: true, password_hash: passwordHash })
      .where('id', '=', account.id)
      .execute();
    // Whoever knew the old password must not stay signed in.
    await trx
      .deleteFrom('sessions')
      .where('user_id', '=', account.id)
      .execute();

    return { id: account.id, wasActive: account.is_active };
  });
}
