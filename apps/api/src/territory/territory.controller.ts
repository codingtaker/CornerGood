import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
} from '@nestjs/common';
import type { EntityType } from '../database/database.types';
import { readPoint } from '../listings/listing-input';
import { TerritoryService } from './territory.service';

/*
 * Public reference data. Nothing personal: the communes, the commune of a GPS
 * point, and the categories.
 */
@Controller()
export class TerritoryController {
  constructor(private readonly territory: TerritoryService) {}

  @Get('communes')
  async communes() {
    return { communes: await this.territory.communes() };
  }

  /**
   * GET /communes/locate?lat=6.17&lng=1.21: the commune of a point, to
   * propose it; the person always confirms or changes it (ADR-044).
   * { commune: null } outside Grand Lomé.
   */
  @Get('communes/locate')
  // A position is personal: no cache, not even in the browser.
  @Header('Cache-Control', 'no-store')
  async locate(@Query('lat') lat: unknown, @Query('lng') lng: unknown) {
    const point = readPoint({ lat, lng });
    if (!point) {
      throw new BadRequestException({
        message: 'Position invalide : lat et lng sont attendus en degrés.',
      });
    }
    const found = await this.territory.locate(point);
    return found
      ? { commune: found.commune, method: found.method }
      : { commune: null, method: null };
  }

  /** GET /services?category=reparation: what a listing of it may offer. */
  @Get('services')
  async services(@Query('category') category: unknown) {
    if (typeof category !== 'string' || !/^[a-z0-9-]{1,80}$/.test(category)) {
      throw new BadRequestException({
        message: 'Indiquez la catégorie : ?category=reparation.',
      });
    }
    return { services: await this.territory.services(category) };
  }

  @Get('categories')
  async categories(@Query('entityType') type: unknown) {
    const entityType: EntityType | undefined =
      type === 'BUSINESS' || type === 'COMMUNITY' ? type : undefined;
    return { categories: await this.territory.categories(entityType) };
  }
}
