import { createDatabasePool } from './database.module';
import { createKysely } from './kysely';
import { readDatabaseUrl } from './load-env';
import {
  assertMigrationAllowed,
  MigrationDirection,
  runMigrations,
} from './migrator';

// Usage: npm run db:migrate            (apply every pending migration)
//        npm run db:migrate:down       (revert the last migration;
//                                       refused when NODE_ENV=production)
async function main(): Promise<void> {
  const direction: MigrationDirection =
    process.argv[2] === 'down' ? 'down' : 'latest';
  // Checked before connecting, so a refused run touches nothing.
  try {
    assertMigrationAllowed(direction);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }
  const db = createKysely(createDatabasePool(readDatabaseUrl()));

  try {
    const { error, results } = await runMigrations(db, direction);

    for (const result of results ?? []) {
      console.log(
        `${result.status.padEnd(8)} ${result.direction.padEnd(4)} ${result.migrationName}`,
      );
    }
    if (results?.length === 0) {
      console.log('Nothing to migrate.');
    }
    if (error) {
      console.error('Migration failed:', error);
      process.exitCode = 1;
    }
  } finally {
    await db.destroy();
  }
}

void main();
