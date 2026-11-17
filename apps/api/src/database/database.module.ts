import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { AppEnvironment } from '../config/env.validation';

export const DATABASE_POOL = Symbol('DATABASE_POOL');

const logger = new Logger('DatabasePool');

export function createDatabasePool(connectionString: string): Pool {
  const pool = new Pool({ connectionString, max: 10 });

  // When PostgreSQL closes an idle connection (restart, network cut), the pool
  // emits 'error'. Without a listener, Node.js treats it as unhandled and stops
  // the whole API. The pool already discards the broken connection, so logging is enough.
  pool.on('error', (error) => {
    logger.error(`Idle database connection lost: ${error.message}`);
  });

  return pool;
}

/**
 * Provides one shared PostgreSQL connection pool for the whole API.
 * The query layer used by feature modules is added with the first migrations.
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnvironment, true>) =>
        createDatabasePool(config.get('DATABASE_URL', { infer: true })),
    },
  ],
  exports: [DATABASE_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
