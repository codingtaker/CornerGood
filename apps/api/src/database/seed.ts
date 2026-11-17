import { createDatabasePool } from './database.module';
import { createKysely } from './kysely';
import { readDatabaseUrl } from './load-env';
import { seedReferenceData } from './seeder';

// Usage: npm run db:seed (after npm run db:migrate)
async function main(): Promise<void> {
  const db = createKysely(createDatabasePool(readDatabaseUrl()));

  try {
    const report = await seedReferenceData(db);
    console.log(
      `Seeded ${report.communes} communes and ${report.categories} categories.`,
    );
    if (report.communesWithoutCentroid.length > 0) {
      console.warn(
        `No approximate centre yet for: ${report.communesWithoutCentroid.join(', ')}` +
          ' (fill COMMUNE_CENTROIDS in seed-data/territory.ts).',
      );
    }
  } catch (error) {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

void main();
