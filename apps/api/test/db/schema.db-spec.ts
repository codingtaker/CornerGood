import { Kysely, sql } from 'kysely';
import { Pool } from 'pg';
import { createDatabasePool } from '../../src/database/database.module';
import { Database } from '../../src/database/database.types';
import { createKysely } from '../../src/database/kysely';
import { runMigrations } from '../../src/database/migrator';
import { seedReferenceData } from '../../src/database/seeder';
import {
  assertDisposableConnectedDatabase,
  assertDisposableTestDatabaseUrl,
} from './test-database-guard';

/*
 * Runs against a real PostgreSQL + PostGIS database given by TEST_DATABASE_URL.
 * The public schema of that database is wiped, so the guard refuses any
 * database whose name does not end in "_test" or that is DATABASE_URL itself.
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl) {
  assertDisposableTestDatabaseUrl(testDatabaseUrl, process.env.DATABASE_URL);
}
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase('database schema', () => {
  let pool: Pool;
  let db: Kysely<Database>;
  let ownerId: string;
  let categoryId: string;
  let communeId: string;

  beforeAll(async () => {
    pool = createDatabasePool(testDatabaseUrl as string);
    db = createKysely(pool);
    const { rows } = await sql<{
      name: string;
    }>`SELECT current_database() AS name`.execute(db);
    assertDisposableConnectedDatabase(rows[0].name);
    await sql`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`.execute(db);

    const { error } = await runMigrations(db, 'latest');
    if (error) throw new Error('Test migrations failed', { cause: error });
    await seedReferenceData(db);

    ownerId = (
      await db
        .insertInto('users')
        .values({
          full_name: 'Kossi Mensah',
          phone: '+22890000001',
          password_hash: 'not-a-real-hash',
          role: 'PROFESSIONAL',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    categoryId = (
      await db
        .selectFrom('categories')
        .select('id')
        .where('slug', '=', 'reparation')
        .executeTakeFirstOrThrow()
    ).id;
    communeId = (
      await db
        .selectFrom('communes')
        .select('id')
        .where('slug', '=', 'agoe-nyive-1')
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    await db.destroy();
  });

  async function createDraft(name = 'Atelier Kossi'): Promise<string> {
    const row = await db
      .insertInto('establishments')
      .values({
        owner_id: ownerId,
        created_by_id: ownerId,
        category_id: categoryId,
        entity_type: 'BUSINESS',
        name,
        slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}-${Math.random()}`,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  const point = sql<string>`ST_SetSRID(ST_MakePoint(1.2087, 6.2301), 4326)::geography`;

  describe('reference data', () => {
    it('loads the 13 communes of Grand Lomé in 2 prefectures', async () => {
      const rows = await db
        .selectFrom('communes')
        .innerJoin('prefectures', 'prefectures.id', 'communes.prefecture_id')
        .select([
          'prefectures.slug as prefecture',
          db.fn.countAll<string>().as('total'),
        ])
        .groupBy('prefectures.slug')
        .orderBy('prefectures.slug')
        .execute();

      expect(rows).toEqual([
        { prefecture: 'agoe-nyive', total: '6' },
        { prefecture: 'golfe', total: '7' },
      ]);
    });

    it('can be seeded twice without duplicates', async () => {
      await seedReferenceData(db);
      const { total } = await db
        .selectFrom('communes')
        .select(db.fn.countAll<string>().as('total'))
        .executeTakeFirstOrThrow();
      expect(total).toBe('13');
    });
  });

  describe('locations (ADR-003, ADR-004, ADR-041)', () => {
    it('accepts a fixed location with a GPS point and its provenance', async () => {
      const establishmentId = await createDraft();
      await expect(
        db
          .insertInto('locations')
          .values({
            establishment_id: establishmentId,
            commune_id: communeId,
            location_type: 'FIXED',
            visibility: 'PUBLIC',
            geom: point,
            is_primary: true,
            position_source: 'DEVICE_GPS',
            position_accuracy_m: 12,
            position_captured_at: new Date(),
          })
          .execute(),
      ).resolves.toBeDefined();
    });

    it('rejects a fixed location without a point', async () => {
      const establishmentId = await createDraft();
      await expect(
        db
          .insertInto('locations')
          .values({
            establishment_id: establishmentId,
            commune_id: communeId,
            location_type: 'FIXED',
            visibility: 'PUBLIC',
          })
          .execute(),
      ).rejects.toThrow(/location_type_rules/);
    });

    it('rejects a mobile provider stored with a point', async () => {
      const establishmentId = await createDraft();
      await expect(
        db
          .insertInto('locations')
          .values({
            establishment_id: establishmentId,
            commune_id: communeId,
            location_type: 'MOBILE',
            visibility: 'APPROXIMATE',
            geom: point,
            position_source: 'MANUAL_PIN',
          })
          .execute(),
      ).rejects.toThrow(/location_type_rules/);
    });

    it('keeps a home-based point private (APPROXIMATE) when asked', async () => {
      const establishmentId = await createDraft();
      await expect(
        db
          .insertInto('locations')
          .values({
            establishment_id: establishmentId,
            commune_id: communeId,
            location_type: 'HOME_BASED',
            visibility: 'APPROXIMATE',
            geom: point,
            position_source: 'DEVICE_GPS',
          })
          .execute(),
      ).resolves.toBeDefined();
    });

    it('rejects a point without its provenance', async () => {
      const establishmentId = await createDraft();
      await expect(
        db
          .insertInto('locations')
          .values({
            establishment_id: establishmentId,
            commune_id: communeId,
            location_type: 'FIXED',
            visibility: 'PUBLIC',
            geom: point,
          })
          .execute(),
      ).rejects.toThrow(/point_has_source/);
    });

    it('allows only one primary location per listing', async () => {
      const establishmentId = await createDraft();
      const primaryMobile = {
        establishment_id: establishmentId,
        commune_id: communeId,
        location_type: 'MOBILE' as const,
        visibility: 'APPROXIMATE' as const,
        is_primary: true,
      };
      await db.insertInto('locations').values(primaryMobile).execute();
      await expect(
        db.insertInto('locations').values(primaryMobile).execute(),
      ).rejects.toThrow(/locations_one_primary_per_establishment/);
    });
  });

  describe('publication control (ADR-008 to ADR-011)', () => {
    it('refuses to submit a listing without phone and description', async () => {
      const establishmentId = await createDraft();
      await expect(
        db
          .updateTable('establishments')
          .set({ publication_status: 'PENDING' })
          .where('id', '=', establishmentId)
          .execute(),
      ).rejects.toThrow(/submitted_listing_is_complete/);
    });

    it('allows a single pending revision per listing', async () => {
      const establishmentId = await createDraft();
      const revision = {
        establishment_id: establishmentId,
        submitted_by_id: ownerId,
        proposed_changes: JSON.stringify({ phone: '+22890000002' }),
      };
      await db.insertInto('establishment_revisions').values(revision).execute();
      await expect(
        db.insertInto('establishment_revisions').values(revision).execute(),
      ).rejects.toThrow(/establishment_revisions_one_pending/);
    });

    it('requires a reason to reject', async () => {
      const establishmentId = await createDraft();
      await expect(
        db
          .insertInto('moderation_log')
          .values({
            establishment_id: establishmentId,
            actor_id: ownerId,
            action: 'REJECT',
            from_status: 'PENDING',
            to_status: 'REJECTED',
          })
          .execute(),
      ).rejects.toThrow(/decision_has_reason/);
    });

    it('requires a reason to reject a revision', async () => {
      const establishmentId = await createDraft();
      await expect(
        db
          .insertInto('establishment_revisions')
          .values({
            establishment_id: establishmentId,
            submitted_by_id: ownerId,
            proposed_changes: JSON.stringify({ name: 'Nouveau nom' }),
            status: 'REJECTED',
            decided_at: new Date(),
          })
          .execute(),
      ).rejects.toThrow(/rejected_revision_has_reason/);
    });

    it('never lets the moderation log be edited or deleted', async () => {
      const establishmentId = await createDraft();
      const entry = await db
        .insertInto('moderation_log')
        .values({
          establishment_id: establishmentId,
          actor_id: ownerId,
          action: 'SUBMIT',
          from_status: 'DRAFT',
          to_status: 'PENDING',
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await expect(
        db
          .updateTable('moderation_log')
          .set({ reason: 'edited' })
          .where('id', '=', entry.id)
          .execute(),
      ).rejects.toThrow(/append-only/);
      await expect(
        db.deleteFrom('moderation_log').where('id', '=', entry.id).execute(),
      ).rejects.toThrow(/append-only/);
    });
  });

  describe('accounts (ADR-020)', () => {
    it('rejects a phone number that is not in international format', async () => {
      await expect(
        db
          .insertInto('users')
          .values({
            full_name: 'Ama',
            phone: '90000003',
            password_hash: 'x',
            role: 'PROFESSIONAL',
          })
          .execute(),
      ).rejects.toThrow(/users_phone_check/);
    });

    it('treats two emails differing only by case as the same', async () => {
      const user = (phone: string, email: string) => ({
        full_name: 'Ama Dzifa',
        phone,
        email,
        password_hash: 'x',
        role: 'PROFESSIONAL' as const,
      });
      await db
        .insertInto('users')
        .values(user('+22890000004', 'ama@example.tg'))
        .execute();
      await expect(
        db
          .insertInto('users')
          .values(user('+22890000005', 'AMA@example.tg'))
          .execute(),
      ).rejects.toThrow(/users_email_unique/);
    });
  });

  describe('migrations', () => {
    it('can be reverted and applied again', async () => {
      const down = await runMigrations(db, 'down');
      expect(down.error).toBeUndefined();
      const tables = await sql<{ total: string }>`
        SELECT count(*) AS total FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'establishments'
      `.execute(db);
      expect(tables.rows[0].total).toBe('0');

      const up = await runMigrations(db, 'latest');
      expect(up.error).toBeUndefined();
    });
  });
});
