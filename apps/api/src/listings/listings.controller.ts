import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
import {
  readDraftListing,
  readListingDetails,
  readListingLocation,
  readListingServices,
} from './listing-input';
import { ListingsService } from './listings.service';
import type { ListingSummary, OwnListing } from './listings.service';

/** Explains a refused body field by field. */
function read<T>(reader: (body: unknown) => T, body: unknown): T {
  try {
    return reader(body);
  } catch (error) {
    if (error instanceof InvalidInputError) {
      throw new BadRequestException({
        message: 'Vérifiez les champs indiqués.',
        fields: error.problems,
      });
    }
    throw error;
  }
}

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
    const input = read(readDraftListing, body);
    return { listing: await this.listings.createDraft(user.id, input) };
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ): Promise<{ listing: OwnListing }> {
    return { listing: await this.listings.getOwn(user.id, id) };
  }

  /** Changes the details of a draft, or of a rejected listing (then a draft again). */
  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() body: unknown,
  ): Promise<{ listing: OwnListing }> {
    const input = read(readListingDetails, body);
    return { listing: await this.listings.updateDetails(user.id, id, input) };
  }

  /** Replaces the place of a draft, or of a rejected listing (then a draft again). */
  @Put(':id/location')
  async replaceLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() body: unknown,
  ): Promise<{ listing: OwnListing }> {
    const location = read(readListingLocation, body);
    return {
      listing: await this.listings.replaceLocation(user.id, id, location),
    };
  }

  /** Replaces the services of a draft, chosen in its category's catalogue. */
  @Put(':id/services')
  async replaceServices(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() body: unknown,
  ): Promise<{ listing: OwnListing }> {
    const services = read(readListingServices, body);
    return {
      listing: await this.listings.replaceServices(user.id, id, services),
    };
  }

  /** Sends a draft for validation (S4). */
  @Post(':id/submit')
  @HttpCode(200)
  async submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ): Promise<{ listing: OwnListing }> {
    return { listing: await this.listings.submit(user.id, id) };
  }
}
