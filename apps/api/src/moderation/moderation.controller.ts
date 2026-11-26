import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentUser,
  Roles,
  RolesGuard,
  SessionGuard,
} from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/credentials';
import { MediaService } from '../media/media.service';
import { ModerationService, readReason } from './moderation.service';
import type {
  ModerationListing,
  ModerationPhoto,
  QueuedListing,
} from './moderation.service';

const Uuid = () => new ParseUUIDPipe({ errorHttpStatusCode: 404 });

/*
 * Back-office (S4). Every route needs a session and the MODERATOR or ADMIN
 * role; approving or rejecting a listing is the administrator's alone
 * (ADR-010). A method's @Roles replaces the class one.
 */
@Controller('admin')
@UseGuards(SessionGuard, RolesGuard)
@Roles('MODERATOR', 'ADMIN')
export class ModerationController {
  constructor(
    private readonly moderation: ModerationService,
    private readonly media: MediaService,
  ) {}

  @Get('moderation')
  async queue(): Promise<{ listings: QueuedListing[] }> {
    return { listings: await this.moderation.queue() };
  }

  @Get('listings/:id')
  async get(
    @Param('id', Uuid()) id: string,
  ): Promise<{ listing: ModerationListing }> {
    return { listing: await this.moderation.get(id) };
  }

  @Post('listings/:id/approve')
  @HttpCode(200)
  @Roles('ADMIN')
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', Uuid()) id: string,
  ): Promise<{ listing: ModerationListing }> {
    return { listing: await this.moderation.approve(user.id, id) };
  }

  @Post('listings/:id/reject')
  @HttpCode(200)
  @Roles('ADMIN')
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', Uuid()) id: string,
    @Body() body: unknown,
  ): Promise<{ listing: ModerationListing }> {
    const reason = readReason(body);
    return { listing: await this.moderation.reject(user.id, id, reason) };
  }

  /** Not cached (no-store on every answer): this photo may not be public. */
  @Get('media/:id')
  @Header('Content-Disposition', 'inline')
  async photo(@Param('id', Uuid()) id: string): Promise<StreamableFile> {
    const photo = await this.media.readForModeration(id);
    return new StreamableFile(photo, {
      type: 'image/webp',
      length: photo.length,
    });
  }

  @Post('media/:id/approve')
  @HttpCode(200)
  async approvePhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', Uuid()) id: string,
  ): Promise<{ photo: ModerationPhoto }> {
    return { photo: await this.moderation.decidePhoto(user.id, id, null) };
  }

  @Post('media/:id/reject')
  @HttpCode(200)
  async rejectPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', Uuid()) id: string,
    @Body() body: unknown,
  ): Promise<{ photo: ModerationPhoto }> {
    const reason = readReason(body);
    return { photo: await this.moderation.decidePhoto(user.id, id, reason) };
  }
}
