import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely, sql } from 'kysely';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { AppEnvironment } from '../config/env.validation';
import { KYSELY } from '../database/database.module';
import type { Database, OtpPurpose } from '../database/database.types';
import { SMS_SENDER } from '../sms/sms.module';
import type { SmsSender } from '../sms/sms.module';

/*
 * One-time codes sent by SMS (migration 0005): 6 digits, valid 10 minutes,
 * 5 tries, single use. A new code replaces the previous one.
 */

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;

const PURPOSE_TEXT: Record<OtpPurpose, string> = {
  LOGIN_UNLOCK: 'pour débloquer votre connexion',
  PASSWORD_RESET: 'pour changer votre mot de passe',
};

export function otpMessage(code: string, purpose: OtpPurpose): string {
  return (
    `CornerGood : votre code ${PURPOSE_TEXT[purpose]} est ${code}. ` +
    `Valable ${OTP_TTL_MINUTES} minutes. Ne le donnez à personne.`
  );
}

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly secret: string;

  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    config: ConfigService<AppEnvironment, true>,
  ) {
    this.secret = config.get('OTP_SECRET', { infer: true });
  }

  private hash(code: string): Buffer {
    return createHmac('sha256', this.secret).update(code).digest();
  }

  /**
   * Sends a code when an active account has this number, and does nothing
   * otherwise. Callers must not await it before answering: the answer would
   * then take longer for numbers that have an account.
   */
  async issue(phone: string, purpose: OtpPurpose): Promise<void> {
    const user = await this.db
      .selectFrom('users')
      .select('id')
      .where('phone', '=', phone)
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (!user) return;

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.db.transaction().execute(async (trx) => {
      // The previous live code of this purpose stops working.
      await trx
        .updateTable('otp_codes')
        .set({ consumed_at: sql<Date>`now()` })
        .where('user_id', '=', user.id)
        .where('purpose', '=', purpose)
        .where('consumed_at', 'is', null)
        .execute();
      await trx
        .insertInto('otp_codes')
        .values({
          user_id: user.id,
          purpose,
          code_hash: this.hash(code),
          expires_at: sql<Date>`now() + ${`${OTP_TTL_MINUTES} minutes`}::interval`,
        })
        .execute();
      await trx
        .deleteFrom('otp_codes')
        .where('expires_at', '<', sql<Date>`now() - interval '1 day'`)
        .execute();
    });
    await this.sms.send(phone, otpMessage(code, purpose));
  }

  /** Starts issue() without waiting for it; failures are logged. */
  issueInBackground(phone: string, purpose: OtpPurpose): void {
    this.issue(phone, purpose).catch((error: unknown) => {
      this.logger.error(
        `Could not send a ${purpose} code: ${(error as Error).message}`,
      );
    });
  }

  /**
   * Checks a code and uses it up. Returns the account's id, or null when the
   * code is wrong, expired, already used or out of tries.
   */
  async consume(
    phone: string,
    purpose: OtpPurpose,
    code: string,
  ): Promise<string | null> {
    // Takes one try first, in a single statement: concurrent guesses cannot
    // get more than OTP_MAX_ATTEMPTS tries between them.
    const live = await this.db
      .updateTable('otp_codes')
      .set({ attempts: sql<number>`attempts + 1` })
      .where('purpose', '=', purpose)
      .where('consumed_at', 'is', null)
      .where('expires_at', '>', sql<Date>`now()`)
      .where('attempts', '<', OTP_MAX_ATTEMPTS)
      .where('user_id', '=', (eb) =>
        eb
          .selectFrom('users')
          .select('id')
          .where('phone', '=', phone)
          .where('is_active', '=', true),
      )
      .returning(['id', 'user_id', 'code_hash'])
      .executeTakeFirst();
    if (!live || !timingSafeEqual(this.hash(code), live.code_hash)) {
      return null;
    }

    const used = await this.db
      .updateTable('otp_codes')
      .set({ consumed_at: sql<Date>`now()` })
      .where('id', '=', live.id)
      .where('consumed_at', 'is', null)
      .returning('user_id')
      .executeTakeFirst();
    return used?.user_id ?? null;
  }
}
