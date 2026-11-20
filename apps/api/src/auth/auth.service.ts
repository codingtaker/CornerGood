import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY } from '../database/database.module';
import { Database } from '../database/database.types';
import { SignInInput, SignUpInput } from './account-input';
import { AuthenticatedUser, checkCredentials } from './credentials';
import { hashPassword } from './password-hasher';

@Injectable()
export class AuthService {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  /** Public sign-up only ever creates PROFESSIONAL accounts (ADR-047). */
  async signUp(input: SignUpInput): Promise<AuthenticatedUser> {
    const passwordHash = await hashPassword(input.password);

    const taken = await this.db
      .selectFrom('users')
      .select(['phone'])
      .where((eb) =>
        eb.or([
          eb('phone', '=', input.phone),
          ...(input.email ? [eb(sql`lower(email)`, '=', input.email)] : []),
        ]),
      )
      .executeTakeFirst();
    if (taken) throw this.alreadyUsed(taken.phone === input.phone);

    try {
      const user = await this.db
        .insertInto('users')
        .values({
          full_name: input.fullName,
          phone: input.phone,
          email: input.email,
          password_hash: passwordHash,
          role: 'PROFESSIONAL',
        })
        .returning(['id', 'role', 'full_name'])
        .executeTakeFirstOrThrow();
      return { id: user.id, role: user.role, fullName: user.full_name };
    } catch (error) {
      // Two sign-ups with the same number at the same time: the unique
      // constraint decides, and the loser gets the same answer as above.
      if ((error as { code?: string }).code === '23505') {
        throw this.alreadyUsed(
          (error as { constraint?: string }).constraint !==
            'users_email_unique',
        );
      }
      throw error;
    }
  }

  async signIn(input: SignInInput): Promise<AuthenticatedUser | null> {
    const user = await checkCredentials(this.db, input.phone, input.password);
    if (user) {
      await this.db
        .updateTable('users')
        .set({ last_login_at: sql<Date>`now()` })
        .where('id', '=', user.id)
        .execute();
    }
    return user;
  }

  /** New password for an active account (after a PASSWORD_RESET code). */
  async setPassword(
    userId: string,
    password: string,
  ): Promise<AuthenticatedUser> {
    const passwordHash = await hashPassword(password);
    const user = await this.db
      .updateTable('users')
      .set({ password_hash: passwordHash, last_login_at: sql<Date>`now()` })
      .where('id', '=', userId)
      .where('is_active', '=', true)
      .returning(['id', 'role', 'full_name'])
      .executeTakeFirstOrThrow();
    return { id: user.id, role: user.role, fullName: user.full_name };
  }

  private alreadyUsed(phone: boolean): ConflictException {
    return new ConflictException({
      message: phone
        ? 'Ce numéro a déjà un compte. Connectez-vous.'
        : 'Cette adresse e-mail a déjà un compte.',
      field: phone ? 'phone' : 'email',
    });
  }
}
