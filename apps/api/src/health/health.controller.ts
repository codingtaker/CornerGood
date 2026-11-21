import {
  Controller,
  Get,
  Inject,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.module';

export interface HealthReport {
  status: 'ok';
  database: 'ok';
}

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  // Used by deployment monitoring. Also checks PostGIS, because the search
  // cannot work on a database where the extension is missing. The version is
  // not returned: this route is public, and a version number only helps
  // someone looking for a known flaw (code review of 2026-11-20).
  @Get()
  async check(): Promise<HealthReport> {
    try {
      await this.pool.query('SELECT postgis_lib_version()');
      return { status: 'ok', database: 'ok' };
    } catch (error) {
      this.logger.error('Database health check failed', error as Error);
      // The cause stays in the server logs; clients only learn that the API is degraded.
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'unavailable',
      });
    }
  }
}
