import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  StreamableFile,
} from '@nestjs/common';
import { PublicListingsService } from './public-listings.service';
import type { PublicListing } from './public-listings.service';

/*
 * Public pages: no session. A short cache (ADR-022): a suspended listing must
 * not stay visible for long, so 60 seconds, replacing the API's no-store.
 */
const PUBLIC_CACHE = 'public, max-age=60';

@Controller('listings')
export class PublicListingsController {
  constructor(private readonly listings: PublicListingsService) {}

  @Get(':slug')
  @Header('Cache-Control', PUBLIC_CACHE)
  async get(@Param('slug') slug: string): Promise<{ listing: PublicListing }> {
    return { listing: await this.listings.get(slug) };
  }

  @Get(':slug/photos/:id')
  @Header('Cache-Control', PUBLIC_CACHE)
  @Header('Content-Disposition', 'inline')
  async photo(
    @Param('slug') slug: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ): Promise<StreamableFile> {
    const photo = await this.listings.photo(slug, id);
    return new StreamableFile(photo, {
      type: 'image/webp',
      length: photo.length,
    });
  }
}
