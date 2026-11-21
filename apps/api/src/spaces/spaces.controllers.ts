import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { Kysely } from 'kysely';
import { Roles, RolesGuard, SessionGuard } from '../auth/auth.guard';
import { KYSELY } from '../database/database.module';
import { Database } from '../database/database.types';

/*
 * Entry point of the moderation space: every route under /admin needs a
 * session and the MODERATOR or ADMIN role. The web app hides these pages
 * too, but this is where access is decided. The professional space (/pro)
 * lives in listings/listings.controller.ts.
 */

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
