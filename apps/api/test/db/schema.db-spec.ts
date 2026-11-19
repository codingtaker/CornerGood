import { Kysely, sql } from 'kysely';
import { Pool } from 'pg';
import { createFirstAdmin } from '../../src/admin/first-admin';
import { verifyPassword } from '../../src/auth/password-hasher';
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
// Locally the suite is skipped without a database. In CI a skipped suite would
// still report success, so a missing variable must fail instead.
if (process.env.CI && !testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required in CI');
}
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

    it('loads a valid boundary for each of the 13 communes', async () => {
      const rows = await db
        .selectFrom('communes')
        .select([
          'slug',
          sql<boolean>`boundary IS NOT NULL AND ST_IsValid(boundary::geometry)`.as(
            'valid',
          ),
          sql<number>`round(ST_Area(boundary) / 1e6)::int`.as('km2'),
        ])
        .orderBy('slug')
        .execute();

      expect(rows).toHaveLength(13);
      expect(rows.filter((row) => !row.valid)).toEqual([]);
      // Vakpossito, the smallest commune of Grand Lomé.
      expect(rows.find((row) => row.slug === 'agoe-nyive-3')?.km2).toBe(4);
    });

    it('finds exactly one commune for a point inside each boundary', async () => {
      const rows = await db
        .selectFrom('communes as c')
        .select([
          'c.slug',
          sql<string[]>`(
            SELECT array_agg(o.slug ORDER BY o.slug) FROM communes o
            WHERE ST_Covers(o.boundary, ST_PointOnSurface(c.boundary::geometry)::geography)
          )`.as('found'),
        ])
        .execute();

      expect(rows).toHaveLength(13);
      for (const row of rows) {
        expect(row.found).toEqual([row.slug]);
      }
    });

    it('has no overlap between neighbouring communes', async () => {
      const { rows } = await sql<{ a: string; b: string; m2: number }>`
        SELECT a.slug AS a, b.slug AS b,
          ST_Area(ST_Intersection(a.boundary::geometry, b.boundary::geometry)::geography) AS m2
        FROM communes a JOIN communes b
          ON a.slug < b.slug AND ST_Intersects(a.boundary, b.boundary)
      `.execute(db);

      // Neighbours share their limit; any shared surface comes only from
      // rounding coordinates to 6 decimals (about 0.1 m).
      expect(rows.filter((row) => row.m2 >= 1)).toEqual([]);
    });

    it('can be seeded twice without duplicates', async () => {
      await seedReferenceData(db);
      const { total } = await db
        .selectFrom('communes')
        .select(db.fn.countAll<string>().as('total'))
        .executeTakeFirstOrThrow();
      expect(total).toBe('13');
    });

    it('keeps categories edited by an administrator when seeded again', async () => {
      const original = await db
        .selectFrom('categories')
        .select(['name', 'display_order'])
        .where('slug', '=', 'reparation')
        .executeTakeFirstOrThrow();
      await db
        .updateTable('categories')
        .set({ name: 'Réparations et dépannage', display_order: 99 })
        .where('slug', '=', 'reparation')
        .execute();

      try {
        await seedReferenceData(db);
        const edited = await db
          .selectFrom('categories')
          .select(['name', 'display_order'])
          .where('slug', '=', 'reparation')
          .executeTakeFirstOrThrow();
        expect(edited).toEqual({
          name: 'Réparations et dépannage',
          display_order: 99,
        });
      } finally {
        await db
          .updateTable('categories')
          .set(original)
          .where('slug', '=', 'reparation')
          .execute();
      }
    });

    it('recreates a missing category when seeded again', async () => {
      // No test establishment uses this category, so it can be deleted.
      await db
        .deleteFrom('categories')
        .where('slug', '=', 'bibliotheque')
        .execute();

      await seedReferenceData(db);

      const restored = await db
        .selectFrom('categories')
        .select('name')
        .where('slug', '=', 'bibliotheque')
        .executeTakeFirst();
      expect(restored).toEqual({ name: 'Bibliothèque' });
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

    it('never makes the exact point of a home public (ADR-046)', async () => {
      const establishmentId = await createDraft();
      await expect(
        db
          .insertInto('locations')
          .values({
            establishment_id: establishmentId,
            commune_id: communeId,
            location_type: 'HOME_BASED',
            visibility: 'PUBLIC',
            geom: point,
            position_source: 'DEVICE_GPS',
          })
          .execute(),
      ).rejects.toThrow(/home_point_stays_private/);
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

  describe('submission completeness (ADR-045)', () => {
    async function submit(
      establishmentId: string,
      fields: { description: string; phone?: string; whatsapp?: string },
    ) {
      return db
        .updateTable('establishments')
        .set({ ...fields, publication_status: 'PENDING' })
        .where('id', '=', establishmentId)
        .execute();
    }

    it('accepts a business reachable only on WhatsApp', async () => {
      const establishmentId = await createDraft();
      await expect(
        submit(establishmentId, {
          description: 'Réparation de téléphones',
          whatsapp: '+22890000010',
        }),
      ).resolves.toBeDefined();
    });

    it('refuses a business with no phone and no WhatsApp', async () => {
      const establishmentId = await createDraft();
      await expect(
        submit(establishmentId, { description: 'Réparation de téléphones' }),
      ).rejects.toThrow(/submitted_listing_is_complete/);
    });

    it('accepts a community place without any phone number', async () => {
      const { id: communityCategoryId } = await db
        .selectFrom('categories')
        .select('id')
        .where('slug', '=', 'equipement-sportif')
        .executeTakeFirstOrThrow();
      const { id: establishmentId } = await db
        .insertInto('establishments')
        .values({
          owner_id: ownerId,
          created_by_id: ownerId,
          category_id: communityCategoryId,
          entity_type: 'COMMUNITY',
          name: 'Terrain de quartier',
          slug: `terrain-de-quartier-${Date.now()}`,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await expect(
        submit(establishmentId, {
          description: 'Terrain de football ouvert à tous',
        }),
      ).resolves.toBeDefined();
    });

    it('refuses a description made of spaces only', async () => {
      const establishmentId = await createDraft();
      await expect(
        submit(establishmentId, { description: '   ', phone: '+22890000011' }),
      ).rejects.toThrow(/submitted_listing_is_complete/);
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
            reviewed_by_id: ownerId,
            decided_at: new Date(),
          })
          .execute(),
      ).rejects.toThrow(/rejected_revision_has_reason/);
    });

    it('records who decided on a revision (ADR-010)', async () => {
      const establishmentId = await createDraft();
      await expect(
        db
          .insertInto('establishment_revisions')
          .values({
            establishment_id: establishmentId,
            submitted_by_id: ownerId,
            proposed_changes: JSON.stringify({ name: 'Nouveau nom' }),
            status: 'APPROVED',
            decided_at: new Date(),
          })
          .execute(),
      ).rejects.toThrow(/decided_revision_has_reviewer/);
    });

    it.each(['EDIT', 'VERIFY', 'UNVERIFY'] as const)(
      'logs the %s action required by the API contract',
      async (action) => {
        const establishmentId = await createDraft();
        await expect(
          db
            .insertInto('moderation_log')
            .values({
              establishment_id: establishmentId,
              actor_id: ownerId,
              action,
            })
            .execute(),
        ).resolves.toBeDefined();
      },
    );

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

  describe('sessions (ADR-021)', () => {
    const tokenHash = (seed: string) =>
      sql<Buffer>`sha256(convert_to(${seed}, 'UTF8'))`;

    it('stores a session for a user', async () => {
      await expect(
        db
          .insertInto('sessions')
          .values({
            token_hash: tokenHash('session-a'),
            user_id: ownerId,
            expires_at: sql<Date>`now() + interval '30 days'`,
          })
          .execute(),
      ).resolves.toBeDefined();
    });

    it('rejects a session that expires before it starts', async () => {
      await expect(
        db
          .insertInto('sessions')
          .values({
            token_hash: tokenHash('session-b'),
            user_id: ownerId,
            expires_at: sql<Date>`now() - interval '1 minute'`,
          })
          .execute(),
      ).rejects.toThrow(/session_expires_after_creation/);
    });

    it('removes the sessions of a deleted user', async () => {
      const { id: userId } = await db
        .insertInto('users')
        .values({
          full_name: 'Compte temporaire',
          phone: '+22890000020',
          password_hash: 'x',
          role: 'PROFESSIONAL',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await db
        .insertInto('sessions')
        .values({
          token_hash: tokenHash('session-c'),
          user_id: userId,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .execute();

      await db.deleteFrom('users').where('id', '=', userId).execute();

      const { total } = await db
        .selectFrom('sessions')
        .select(db.fn.countAll<string>().as('total'))
        .where('user_id', '=', userId)
        .executeTakeFirstOrThrow();
      expect(total).toBe('0');
    });
  });

  describe('first administrator (ADR-047)', () => {
    const input = {
      fullName: 'Afi Kouma',
      phone: '+22890000099',
      email: 'afi.kouma@example.org',
      password: 'a long enough password',
    };

    it('refuses a phone already used by another account', async () => {
      await expect(
        createFirstAdmin(db, { ...input, phone: '+22890000001' }),
      ).rejects.toThrow('ADMIN_PHONE is already used by another account.');
    });

    it('creates one ADMIN whose password verifies', async () => {
      const { id } = await createFirstAdmin(db, input);
      const admin = await db
        .selectFrom('users')
        .select(['role', 'is_active', 'email', 'password_hash'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(admin).toMatchObject({
        role: 'ADMIN',
        is_active: true,
        email: input.email,
      });
      expect(admin.password_hash).not.toContain(input.password);
      await expect(
        verifyPassword(input.password, admin.password_hash),
      ).resolves.toBe(true);
    });

    it('refuses to run again once an administrator exists', async () => {
      await expect(
        createFirstAdmin(db, { ...input, phone: '+22890000098', email: null }),
      ).rejects.toThrow('An administrator already exists');
      const { total } = await db
        .selectFrom('users')
        .select((eb) => eb.fn.countAll<string>().as('total'))
        .where('role', '=', 'ADMIN')
        .executeTakeFirstOrThrow();
      expect(total).toBe('1');
    });
  });

  describe('migrations', () => {
    it('can all be reverted and applied again', async () => {
      // Start from an empty schema: some down() refuse on purpose to revert
      // over data they cannot keep (e.g. EDIT entries in the append-only log),
      // and the tests above wrote such data.
      await sql`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`.execute(db);
      const fresh = await runMigrations(db, 'latest');
      expect(fresh.error).toBeUndefined();

      // Revert one migration at a time until none is left, so the test keeps
      // checking every down() whatever the number of migrations.
      let down = await runMigrations(db, 'down');
      while (!down.error && down.results?.length) {
        down = await runMigrations(db, 'down');
      }
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
