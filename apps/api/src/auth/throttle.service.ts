import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY } from '../database/database.module';
import { Database } from '../database/database.types';
import { blockSeconds, THROTTLE_POLICIES } from './throttle';
import type { ThrottlePolicies, ThrottlePolicy } from './throttle';

/** Counters untouched for this long are deleted. */
const PURGE_AFTER_SECONDS = 2 * 24 * 3600;

@Injectable()
export class ThrottleService {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    @Inject(THROTTLE_POLICIES) readonly policies: ThrottlePolicies,
  ) {}

  /**
   * Seconds left before any of these keys may try again, or 0. Checked before
   * the password is hashed, so a blocked client costs no scrypt.
   */
  async retryAfter(keys: string[]): Promise<number> {
    const row = await this.db
      .selectFrom('auth_throttle')
      .select(
        sql<number>`ceil(extract(epoch FROM max(blocked_until) - now()))::int`.as(
          'seconds',
        ),
      )
      .where('key', 'in', keys)
      .where('blocked_until', '>', sql<Date>`now()`)
      .executeTakeFirst();
    return Math.max(row?.seconds ?? 0, 0);
  }

  /**
   * Counts one failure (or one attempt) in a single statement, so concurrent
   * requests cannot both read the old count. Returns the new count.
   */
  async record(key: string, policy: ThrottlePolicy): Promise<number> {
    const window = `${policy.windowSeconds} seconds`;
    const { failures } = await this.db
      .insertInto('auth_throttle')
      .values({ key, failures: 1, window_started_at: sql<Date>`now()` })
      .onConflict((oc) =>
        oc.column('key').doUpdateSet({
          // A window that is over starts again from 1.
          failures: sql<number>`CASE
            WHEN auth_throttle.window_started_at < now() - ${window}::interval THEN 1
            ELSE auth_throttle.failures + 1 END`,
          window_started_at: sql<Date>`CASE
            WHEN auth_throttle.window_started_at < now() - ${window}::interval THEN now()
            ELSE auth_throttle.window_started_at END`,
          updated_at: sql<Date>`now()`,
        }),
      )
      .returning('failures')
      .executeTakeFirstOrThrow();

    const seconds = blockSeconds(failures, policy);
    if (seconds > 0) {
      await this.db
        .updateTable('auth_throttle')
        .set({
          blocked_until: sql<Date>`now() + ${`${seconds} seconds`}::interval`,
        })
        .where('key', '=', key)
        .execute();
    }
    return failures;
  }

  /** A successful sign-in clears the counter of that phone number. */
  async clear(key: string): Promise<void> {
    await this.db.deleteFrom('auth_throttle').where('key', '=', key).execute();
  }

  async purgeStale(): Promise<void> {
    await this.db
      .deleteFrom('auth_throttle')
      .where(
        'updated_at',
        '<',
        sql<Date>`now() - ${`${PURGE_AFTER_SECONDS} seconds`}::interval`,
      )
      .where((eb) =>
        eb.or([
          eb('blocked_until', 'is', null),
          eb('blocked_until', '<', sql<Date>`now()`),
        ]),
      )
      .execute();
  }
}
