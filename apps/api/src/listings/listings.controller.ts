import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InvalidInputError } from '../auth/account-input';
import {
  CurrentUser,
  Roles,
  RolesGuard,
  SessionGuard,
} from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/credentials';
import { readDraftListing } from './listing-input';
import { ListingsService } from './listings.service';
import type { ListingSummary, OwnListing } from './listings.service';

/** The professional's own listings (S3: drafts created on the spot). */
@Controller('pro/listings')
@UseGuards(SessionGuard, RolesGuard)
@Roles('PROFESSIONAL', 'MODERATOR', 'ADMIN')
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ listings: ListingSummary[] }> {
    return { listings: await this.listings.listOwn(user.id) };
  }

  @Post()
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<{ listing: OwnListing }> {
    let input;
    try {
      input = readDraftListing(body);
    } catch (error) {
      if (error instanceof InvalidInputError) {
        throw new BadRequestException({
          message: 'Vérifiez les champs indiqués.',
          fields: error.problems,
        });
      }
      throw error;
    }
    return { listing: await this.listings.createDraft(user.id, input) };
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ): Promise<{ listing: OwnListing }> {
    return { listing: await this.listings.getOwn(user.id, id) };
  }
}
