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
  postgisVersion: string;
}

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  // Used by deployment monitoring. Also checks PostGIS, because the search
  // cannot work on a database where the extension is missing.
  @Get()
  async check(): Promise<HealthReport> {
    try {
      const result = await this.pool.query<{ version: string }>(
        'SELECT postgis_lib_version() AS version',
      );
      return {
        status: 'ok',
        database: 'ok',
        postgisVersion: result.rows[0].version,
      };
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
