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
      `Seeded ${report.communes} communes (${report.communesWithBoundary} with a boundary)` +
        ` and ${report.categories} categories.`,
    );
    if (report.communesWithoutLocation.length > 0) {
      console.warn(
        `No boundary or centre yet for: ${report.communesWithoutLocation.join(', ')}` +
          ' (the commune is chosen from a list, ADR-044).',
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
