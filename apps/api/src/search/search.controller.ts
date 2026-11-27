import {
  BadRequestException,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  HttpException,
  Injectable,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { InvalidInputError } from '../auth/account-input';
import { clientKey, tooManyAttemptsMessage } from '../auth/throttle';
import { ThrottleService } from '../auth/throttle.service';
import { readSearchQuery } from './search-input';
import type { SearchQuery } from './search-input';
import { SearchService } from './search.service';
import type { SearchPage } from './search.service';

/** Every search counts: 60 per minute per address (§9). */
@Injectable()
export class SearchThrottleGuard implements CanActivate {
  constructor(private readonly throttle: ThrottleService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const key = `search:ip:${clientKey(http.getRequest<Request>().ip)}`;
    const seconds = await this.throttle.retryAfter([key]);
    if (seconds > 0) {
      http.getResponse<Response>().setHeader('Retry-After', String(seconds));
      throw new HttpException(
        { message: tooManyAttemptsMessage(seconds) },
        429,
      );
    }
    await this.throttle.record(key, this.throttle.policies.searchIp);
    return true;
  }
}

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @UseGuards(SearchThrottleGuard)
  async search(
    @Query() raw: Record<string, unknown>,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SearchPage> {
    let query: SearchQuery;
    try {
      query = readSearchQuery(raw);
    } catch (error) {
      if (error instanceof InvalidInputError) {
        throw new BadRequestException({
          message: 'Vérifiez votre recherche.',
          fields: error.problems,
        });
      }
      throw error;
    }
    // Short cache (ADR-022). A position is personal: no shared cache then.
    response.setHeader(
      'Cache-Control',
      query.near ? 'private, max-age=60' : 'public, max-age=60',
    );
    return this.searchService.search(query);
  }
}
