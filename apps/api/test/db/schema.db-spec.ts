import { Kysely, sql } from 'kysely';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { WEB_BOUNDARIES_PATH } from '../../src/database/geodata/generate-web-boundaries';
import { recoverAdmin } from '../../src/admin/admin-recovery';
import { createFirstAdmin, FirstAdminError } from '../../src/admin/first-admin';
import { checkCredentials } from '../../src/auth/credentials';
import { hashPassword, verifyPassword } from '../../src/auth/password-hasher';
import { medianMs } from '../timing';
import { createDatabasePool } from '../../src/database/database.module';
import { Database } from '../../src/database/database.types';
import { createKysely } from '../../src/database/kysely';
import { runMigrations } from '../../src/database/migrator';
import { APP_ROLE_GRANTS } from '../../src/database/migrations/0003_least_privilege_app_role';
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

    // The invariant, not an example: a point anywhere inside Grand Lomé must
    // fall in a commune, so the union of the communes has no hole at all.
    it('leaves no gap between communes', async () => {
      const { rows } = await sql<{ parts: number; holes: number }>`
        SELECT count(*)::int AS parts, sum(ST_NumInteriorRings(part))::int AS holes
        FROM (
          SELECT (ST_Dump(ST_Union(boundary::geometry))).geom AS part
          FROM communes WHERE boundary IS NOT NULL
        ) union_parts
      `.execute(db);
      expect(rows[0]).toEqual({ parts: 1, holes: 0 });
    });

    // The light copy drawn by the web app (npm run geo:web).
    it('keeps the web boundaries close, valid and without gap or overlap', async () => {
      const web = readFileSync(WEB_BOUNDARIES_PATH, 'utf8');
      const { rows } = await sql<{
        maxShiftM: number;
        invalid: number;
        overlapM2: number;
        holes: number;
      }>`
        WITH web AS (
          SELECT f->'properties'->>'slug' AS slug,
            ST_SetSRID(ST_GeomFromGeoJSON(f->>'geometry'), 4326) AS g
          FROM json_array_elements(${web}::json->'features') f
        )
        SELECT
          (SELECT max(ST_HausdorffDistance(ST_Transform(web.g, 32631),
                    ST_Transform(c.boundary::geometry, 32631)))
             FROM web JOIN communes c USING (slug))::float8 AS "maxShiftM",
          (SELECT count(*) FROM web WHERE NOT ST_IsValid(g))::int AS invalid,
          (SELECT COALESCE(sum(ST_Area(ST_Intersection(a.g, b.g)::geography)), 0)
             FROM web a JOIN web b ON a.slug < b.slug AND ST_Intersects(a.g, b.g))::float8
            AS "overlapM2",
          (SELECT sum(ST_NumInteriorRings(part))
             FROM (SELECT (ST_Dump(ST_Union(g))).geom AS part FROM web) parts)::int AS holes
      `.execute(db);

      expect(rows[0].invalid).toBe(0);
      expect(rows[0].holes).toBe(0);
      expect(rows[0].overlapM2).toBeLessThan(1);
      // Measured: 23 m (MIN_TRIANGLE_AREA_M2 in generate-web-boundaries.ts).
      expect(rows[0].maxShiftM).toBeLessThan(30);
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

    describe('admin:recover', () => {
      const newPassword = 'a brand new password';
      const setActive = (phone: string, isActive: boolean) =>
        db
          .updateTable('users')
          .set({ is_active: isActive })
          .where('phone', '=', phone)
          .execute();

      it('refuses an unknown phone and a non-administrator', async () => {
        await expect(
          recoverAdmin(db, '+22899999999', newPassword),
        ).rejects.toThrow('No account uses this ADMIN_PHONE.');
        await expect(
          recoverAdmin(db, '+22890000001', newPassword),
        ).rejects.toThrow('This account is not an administrator');
      });

      it('restores the only administrator once deactivated, and closes its sessions', async () => {
        const { id } = await db
          .selectFrom('users')
          .select('id')
          .where('phone', '=', input.phone)
          .executeTakeFirstOrThrow();
        await setActive(input.phone, false);
        await db
          .insertInto('sessions')
          .values({
            token_hash: Buffer.alloc(32, 7),
            user_id: id,
            expires_at: new Date(Date.now() + 3_600_000),
          })
          .execute();

        await expect(
          recoverAdmin(db, input.phone, newPassword),
        ).resolves.toEqual({ id, wasActive: false });

        const admin = await db
          .selectFrom('users')
          .select(['is_active', 'password_hash'])
          .where('id', '=', id)
          .executeTakeFirstOrThrow();
        expect(admin.is_active).toBe(true);
        await expect(
          verifyPassword(newPassword, admin.password_hash),
        ).resolves.toBe(true);
        await expect(
          verifyPassword(input.password, admin.password_hash),
        ).resolves.toBe(false);
        const sessions = await db
          .selectFrom('sessions')
          .select('token_hash')
          .where('user_id', '=', id)
          .execute();
        expect(sessions).toEqual([]);
      });

      it('refuses while another administrator is active', async () => {
        await db
          .insertInto('users')
          .values({
            full_name: 'Second Admin',
            phone: '+22890000097',
            password_hash: 'x',
            role: 'ADMIN',
          })
          .execute();
        await setActive(input.phone, false);

        await expect(
          recoverAdmin(db, input.phone, newPassword),
        ).rejects.toThrow('Another administrator is active');

        await db
          .deleteFrom('users')
          .where('phone', '=', '+22890000097')
          .execute();
        await setActive(input.phone, true);
      });
    });

    it('lets only one of two simultaneous runs create the first administrator', async () => {
      await db.deleteFrom('users').where('role', '=', 'ADMIN').execute();

      // Force the worst interleaving. A SHARE lock on users lets the runs read
      // but blocks their INSERT, so without the advisory lock both would see
      // "no administrator" and both insert once it is released. With it, the
      // second run waits for the first one to finish and then sees its admin.
      const blocker = await pool.connect();
      let runs: Promise<PromiseSettledResult<{ id: string }>[]>;
      try {
        await blocker.query('BEGIN; LOCK TABLE users IN SHARE MODE');
        runs = Promise.allSettled([
          createFirstAdmin(db, {
            ...input,
            phone: '+22890000096',
            email: null,
          }),
          createFirstAdmin(db, {
            ...input,
            phone: '+22890000095',
            email: null,
          }),
        ]);
        // Wait until both runs are blocked: one on the table, one on the
        // advisory lock (or both on the table, without the advisory lock).
        // Asked from another connection: inside the blocker's transaction,
        // pg_stat_activity would stay frozen at its first read.
        for (let attempt = 0; ; attempt += 1) {
          const { rows } = await sql<{ waiting: number }>`
            SELECT count(*)::int AS waiting FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
          `.execute(db);
          if (rows[0].waiting >= 2) break;
          if (attempt > 200) throw new Error('The two runs never both waited');
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } finally {
        await blocker.query('COMMIT');
        blocker.release();
      }
      const results = await runs;

      expect(results.map((result) => result.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      const failure = results.find((result) => result.status === 'rejected');
      expect((failure as PromiseRejectedResult).reason).toBeInstanceOf(
        FirstAdminError,
      );
      const { total } = await db
        .selectFrom('users')
        .select((eb) => eb.fn.countAll<string>().as('total'))
        .where('role', '=', 'ADMIN')
        .executeTakeFirstOrThrow();
      expect(total).toBe('1');
    });
  });

  describe('sign-in credentials (S2)', () => {
    const phone = '+22890000080';
    const password = 'the right password';

    beforeAll(async () => {
      await db
        .insertInto('users')
        .values({
          full_name: 'Yawa Agbeko',
          phone,
          password_hash: await hashPassword(password),
          role: 'PROFESSIONAL',
        })
        .execute();
    });

    it('returns the user for the right password', async () => {
      await expect(checkCredentials(db, phone, password)).resolves.toEqual({
        id: expect.any(String) as string,
        role: 'PROFESSIONAL',
        fullName: 'Yawa Agbeko',
      });
    });

    it('returns null for a wrong password or an unknown phone', async () => {
      await expect(
        checkCredentials(db, phone, 'not the password'),
      ).resolves.toBeNull();
      await expect(
        checkCredentials(db, '+22899999990', password),
      ).resolves.toBeNull();
    });

    it('returns null for a deactivated account, even with its password', async () => {
      await db
        .updateTable('users')
        .set({ is_active: false })
        .where('phone', '=', phone)
        .execute();
      await expect(checkCredentials(db, phone, password)).resolves.toBeNull();
      await db
        .updateTable('users')
        .set({ is_active: true })
        .where('phone', '=', phone)
        .execute();
    });

    // Without the dummy hash an unknown phone is answered in about 1 ms and a
    // known one after a full scrypt: the delay alone would reveal accounts.
    it('takes as long for an unknown phone as for a known one', async () => {
      const knownMs = await medianMs(() =>
        checkCredentials(db, phone, 'not the password'),
      );
      const unknownMs = await medianMs(() =>
        checkCredentials(db, '+22899999990', 'not the password'),
      );
      expect(unknownMs).toBeGreaterThan(knownMs / 2);
    });
  });

  describe('least-privilege API role (migration 0003)', () => {
    /** Runs `query` as cornergood_app, in a transaction rolled back after. */
    async function asApp(query: string): Promise<void> {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL ROLE cornergood_app`.execute(trx);
        await sql.raw(query).execute(trx);
        throw new RollBack();
      });
    }
    class RollBack extends Error {}
    const allowed = async (query: string) =>
      expect(asApp(query)).rejects.toBeInstanceOf(RollBack);
    const refused = async (query: string, reason: RegExp) =>
      expect(asApp(query)).rejects.toThrow(reason);

    it('has no administrative rights', async () => {
      const { rows } = await sql<{ powerful: boolean }>`
        SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication
          AS powerful
        FROM pg_roles WHERE rolname = 'cornergood_app'
      `.execute(db);
      expect(rows).toEqual([{ powerful: false }]);
    });

    it('has exactly the grants of the migration, on every table', async () => {
      const { rows } = await sql<{ table: string; privileges: string }>`
        SELECT c.relname AS table,
          COALESCE((
            SELECT string_agg(p, ', ' ORDER BY p) FROM unnest(
              ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
            ) AS p
            WHERE has_table_privilege('cornergood_app', c.oid, p)
          ), '') AS privileges
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'spatial_ref_sys'
        ORDER BY c.relname
      `.execute(db);

      const expected = Object.fromEntries(
        Object.entries(APP_ROLE_GRANTS).map(([table, privileges]) => [
          table,
          privileges.split(', ').sort().join(', '),
        ]),
      );
      // A new table without its grant shows up here with ''.
      expect(
        Object.fromEntries(rows.map((row) => [row.table, row.privileges])),
      ).toEqual({
        ...expected,
        kysely_migration: '',
        kysely_migration_lock: '',
      });
    });

    it('reads and writes the rows the API needs', async () => {
      await allowed('SELECT count(*) FROM communes');
      await allowed(
        `INSERT INTO users (full_name, phone, password_hash, role)
         VALUES ('Role Test', '+22890000070', 'x', 'PROFESSIONAL')`,
      );
    });

    it('cannot tamper with the moderation log, even before its trigger', async () => {
      await refused('DELETE FROM moderation_log', /permission denied/);
      await refused(
        'UPDATE moderation_log SET reason = NULL',
        /permission denied/,
      );
      await refused('TRUNCATE moderation_log', /permission denied/);
      await refused(
        'ALTER TABLE moderation_log DISABLE TRIGGER moderation_log_append_only',
        /must be owner/,
      );
    });

    it('cannot change the schema, the territory or the migration history', async () => {
      await refused('CREATE TABLE stolen (id int)', /permission denied/);
      await refused('DROP TABLE reports', /must be owner/);
      await refused("UPDATE communes SET name = 'x'", /permission denied/);
      await refused('SELECT * FROM kysely_migration', /permission denied/);
      await refused('DELETE FROM users', /permission denied/);
    });

    it('cannot become another role or run programs on the server', async () => {
      // SET ROLE is checked against the role that signed in. Here that is the
      // test superuser, so it cannot be tried directly: what forbids it for the
      // API is that cornergood_app is a member of no other role.
      const { rows } = await sql<{ memberships: number }>`
        SELECT count(*)::int AS memberships FROM pg_auth_members m
        JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = 'cornergood_app'
      `.execute(db);
      expect(rows[0].memberships).toBe(0);
      await refused(
        "COPY (SELECT 1) TO PROGRAM 'echo pwned'",
        /permission denied/,
      );
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
