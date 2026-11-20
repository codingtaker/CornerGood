import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { Kysely } from 'kysely';
import {
  CurrentUser,
  Roles,
  RolesGuard,
  SessionGuard,
} from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/credentials';
import { KYSELY } from '../database/database.module';
import { Database, PublicationStatus } from '../database/database.types';

/*
 * Entry points of the two protected spaces. Every route under /pro needs a
 * session; every route under /admin also needs the MODERATOR or ADMIN role.
 * The web app hides these pages too, but this is where access is decided.
 */

@Controller('pro')
@UseGuards(SessionGuard, RolesGuard)
@Roles('PROFESSIONAL', 'MODERATOR', 'ADMIN')
export class ProController {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  /** The listings the signed-in professional owns (none yet after sign-up). */
  @Get('listings')
  async listings(@CurrentUser() user: AuthenticatedUser): Promise<{
    listings: { id: string; name: string; status: PublicationStatus }[];
  }> {
    const rows = await this.db
      .selectFrom('establishments')
      .select(['id', 'name', 'publication_status'])
      .where('owner_id', '=', user.id)
      .orderBy('created_at', 'desc')
      .execute();
    return {
      listings: rows.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.publication_status,
      })),
    };
  }
}

@Controller('admin')
@UseGuards(SessionGuard, RolesGuard)
@Roles('MODERATOR', 'ADMIN')
export class AdminController {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  /** Figures for the moderation home page. */
  @Get('overview')
  async overview(): Promise<{
    professionals: number;
    pendingListings: number;
  }> {
    const [users, pending] = await Promise.all([
      this.db
        .selectFrom('users')
        .select((eb) => eb.fn.countAll<string>().as('total'))
        .where('role', '=', 'PROFESSIONAL')
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('establishments')
        .select((eb) => eb.fn.countAll<string>().as('total'))
        .where('publication_status', '=', 'PENDING')
        .executeTakeFirstOrThrow(),
    ]);
    return {
      professionals: Number(users.total),
      pendingListings: Number(pending.total),
    };
  }
}
