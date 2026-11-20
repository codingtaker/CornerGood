import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { createHash, randomBytes } from 'node:crypto';
import { KYSELY } from '../database/database.module';
import { Database } from '../database/database.types';
import { AuthenticatedUser } from './credentials';

/*
 * Server-side sessions (ADR-021). The browser holds a random token in an
 * HttpOnly cookie; the database holds only its SHA-256, so a leaked database
 * opens no session.
 */

export const SESSION_COOKIE = 'cg_session';
export const SESSION_DAYS = 30;
const TOKEN_BYTES = 32;

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

@Injectable()
export class SessionService {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  /** Opens a session and returns the token to put in the cookie. */
  async open(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    await this.db
      .insertInto('sessions')
      .values({
        token_hash: hashToken(token),
        user_id: userId,
        expires_at: expiresAt,
      })
      .execute();
    return { token, expiresAt };
  }

  /** The user of a valid session, or null (unknown, expired, or deactivated). */
  async findUser(token: string): Promise<AuthenticatedUser | null> {
    const row = await this.db
      .selectFrom('sessions')
      .innerJoin('users', 'users.id', 'sessions.user_id')
      .select(['users.id', 'users.role', 'users.full_name'])
      .where('sessions.token_hash', '=', hashToken(token))
      .where('sessions.expires_at', '>', sql<Date>`now()`)
      .where('users.is_active', '=', true)
      .executeTakeFirst();
    return row ? { id: row.id, role: row.role, fullName: row.full_name } : null;
  }

  async close(token: string): Promise<void> {
    await this.db
      .deleteFrom('sessions')
      .where('token_hash', '=', hashToken(token))
      .execute();
  }

  /** Expired rows serve no purpose; cheap thanks to sessions_expires_at_idx. */
  async purgeExpired(): Promise<void> {
    await this.db
      .deleteFrom('sessions')
      .where('expires_at', '<=', sql<Date>`now()`)
      .execute();
  }
}
