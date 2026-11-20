import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { AppEnvironment } from '../config/env.validation';
import { createKysely } from './kysely';

export const DATABASE_POOL = Symbol('DATABASE_POOL');
// Typed query builder for feature modules; it shares the pool above.
export const KYSELY = Symbol('KYSELY');

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
 * The API must connect with the least-privilege role (migration 0003), never
 * as a superuser or a role that can create roles or databases: a flaw in the
 * API would then give the whole database server. Refused in production; a
 * warning elsewhere, so a fresh local setup still starts.
 */
export async function checkDatabaseRole(
  pool: Pick<Pool, 'query'>,
  nodeEnv: string,
): Promise<void> {
  const { rows } = await pool.query<{
    role: string;
    powerful: boolean;
  }>(
    `SELECT current_user AS role,
       (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls) AS powerful
     FROM pg_roles WHERE rolname = current_user`,
  );
  if (!rows[0]?.powerful) return;

  const message =
    `The API connects to the database as "${rows[0].role}", a role with administrative rights. ` +
    'Connect as cornergood_app (DATABASE_URL) and keep the owner in DATABASE_OWNER_URL; see the README.';
  if (nodeEnv === 'production') throw new Error(message);
  logger.warn(message);
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
    {
      provide: KYSELY,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => createKysely(pool),
    },
  ],
  exports: [DATABASE_POOL, KYSELY],
})
export class DatabaseModule implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    await checkDatabaseRole(
      this.pool,
      this.config.get('NODE_ENV', { infer: true }),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
