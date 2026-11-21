import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Kysely, sql } from 'kysely';
import { Pool } from 'pg';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import {
  createDatabasePool,
  DATABASE_POOL,
} from '../../src/database/database.module';
import { Database } from '../../src/database/database.types';
import { createKysely } from '../../src/database/kysely';
import { runMigrations } from '../../src/database/migrator';
import { seedReferenceData } from '../../src/database/seeder';
import {
  assertDisposableConnectedDatabase,
  assertDisposableTestDatabaseUrl,
} from './test-database-guard';

/*
 * Sprint S3 acceptance, over HTTP on the real application, the seeded
 * territory and the least-privilege role: a draft listing is created on the
 * spot, with its position and its commune.
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (process.env.CI && !testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required in CI');
}
if (testDatabaseUrl) {
  assertDisposableTestDatabaseUrl(testDatabaseUrl, process.env.DATABASE_URL);
}
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

interface Point {
  lat: number;
  lng: number;
}

describeWithDatabase('listing form and communes/locate (S3)', () => {
  let pool: Pool;
  let appPool: Pool;
  let db: Kysely<Database>;
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());

  let cookie: string;
  let otherCookie: string;
  let insideAgoeNyive3: Point;
  let justOutside: Point;
  const paris: Point = { lat: 48.8566, lng: 2.3522 };
  const ids: Record<string, string> = {};

  async function signUp(phone: string, ip: string): Promise<string> {
    const response = await http()
      .post('/api/v1/auth/register')
      .set('X-Forwarded-For', ip)
      .send({ fullName: 'Pro Terrain', phone, password: 'sur le terrain' })
      .expect(201);
    const header = response.headers['set-cookie'] as unknown as string[];
    return header[0].split(';')[0];
  }

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

    // Points computed from the official boundaries themselves.
    const points = await sql<{
      in_lat: number;
      in_lng: number;
      out_lat: number;
      out_lng: number;
    }>`
      WITH inside AS (
        SELECT ST_PointOnSurface(boundary::geometry) AS p
        FROM communes WHERE slug = 'agoe-nyive-3'
      ),
      northmost AS (
        SELECT (ST_DumpPoints(ST_Union(boundary::geometry))).geom AS p FROM communes
        ORDER BY ST_Y((ST_DumpPoints(ST_Union(boundary::geometry))).geom) DESC LIMIT 1
      ),
      outside AS (
        -- 20 m north of the northernmost point of Grand Lomé.
        SELECT ST_Project(p::geography, 20, 0)::geometry AS p FROM northmost
      )
      SELECT ST_Y(inside.p) AS in_lat, ST_X(inside.p) AS in_lng,
             ST_Y(outside.p) AS out_lat, ST_X(outside.p) AS out_lng
      FROM inside, outside
    `.execute(db);
    insideAgoeNyive3 = {
      lat: points.rows[0].in_lat,
      lng: points.rows[0].in_lng,
    };
    justOutside = { lat: points.rows[0].out_lat, lng: points.rows[0].out_lng };

    for (const slug of ['agoe-nyive-3', 'golfe-1', 'golfe-2']) {
      ids[slug] = (
        await db
          .selectFrom('communes')
          .select('id')
          .where('slug', '=', slug)
          .executeTakeFirstOrThrow()
      ).id;
    }
    for (const slug of ['reparation', 'etablissement-scolaire']) {
      ids[slug] = (
        await db
          .selectFrom('categories')
          .select('id')
          .where('slug', '=', slug)
          .executeTakeFirstOrThrow()
      ).id;
    }

    const appUrl = new URL(testDatabaseUrl as string);
    appUrl.searchParams.set('options', '-c role=cornergood_app');
    appPool = createDatabasePool(appUrl.toString());
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE_POOL)
      .useValue(appPool)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    cookie = await signUp('96 10 00 01', '203.0.113.120');
    otherCookie = await signUp('96 10 00 02', '203.0.113.121');
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('reference data', () => {
    it('lists the 13 communes to choose from', async () => {
      const response = await http().get('/api/v1/communes').expect(200);
      expect((response.body as { communes: unknown[] }).communes).toHaveLength(
        13,
      );
    });

    it('lists the categories of one kind of listing', async () => {
      const response = await http()
        .get('/api/v1/categories?type=COMMUNITY')
        .expect(200);
      const categories = (
        response.body as { categories: { applicableTo: string | null }[] }
      ).categories;
      expect(categories.length).toBeGreaterThan(0);
      expect(categories.every((c) => c.applicableTo !== 'BUSINESS')).toBe(true);
    });
  });

  describe('GET /communes/locate', () => {
    const locate = (point: Point) =>
      http().get(`/api/v1/communes/locate?lat=${point.lat}&lng=${point.lng}`);

    it('finds the commune whose official boundary covers the point', async () => {
      const response = await locate(insideAgoeNyive3).expect(200);
      expect(response.body).toMatchObject({
        commune: {
          slug: 'agoe-nyive-3',
          name: 'Agoè-Nyivé 3',
          prefecture: 'Agoè-Nyivé',
        },
        method: 'inside',
      });
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('still proposes the nearest commune for a fix 20 m outside Grand Lomé', async () => {
      const response = await locate(justOutside).expect(200);
      expect(response.body).toMatchObject({ method: 'nearby' });
      expect((response.body as { commune: unknown }).commune).not.toBeNull();
    });

    it('answers no commune far from Grand Lomé', async () => {
      await locate(paris).expect(200, { commune: null, method: null });
    });

    it('refuses a missing or impossible position', async () => {
      await http().get('/api/v1/communes/locate?lat=abc&lng=1').expect(400);
      await http().get('/api/v1/communes/locate?lat=95&lng=1').expect(400);
    });
  });

  describe('POST /pro/listings (draft created on the spot)', () => {
    const create = (body: object, as = cookie) =>
      http().post('/api/v1/pro/listings').set('Cookie', as).send(body);
    const base = () => ({
      entityType: 'BUSINESS',
      categoryId: ids.reparation,
      name: 'Réparation Kossi',
    });

    it('creates a fixed activity with the position taken in front of it (sprint criterion)', async () => {
      const capturedAt = new Date().toISOString();
      const response = await create({
        ...base(),
        location: {
          type: 'FIXED',
          communeId: ids['agoe-nyive-3'],
          point: insideAgoeNyive3,
          source: 'DEVICE_GPS',
          accuracyM: 8,
          capturedAt,
        },
      }).expect(201);

      const listing = (response.body as { listing: Record<string, unknown> })
        .listing;
      expect(listing).toMatchObject({
        name: 'Réparation Kossi',
        status: 'DRAFT',
        entityType: 'BUSINESS',
        location: {
          type: 'FIXED',
          visibility: 'PUBLIC',
          commune: { id: ids['agoe-nyive-3'], name: 'Agoè-Nyivé 3' },
          accuracyM: 8,
          servedCommunes: [],
        },
      });
      const point = (listing.location as { point: Point }).point;
      expect(point.lat).toBeCloseTo(insideAgoeNyive3.lat, 6);
      expect(point.lng).toBeCloseTo(insideAgoeNyive3.lng, 6);

      const stored = await db
        .selectFrom('locations')
        .innerJoin(
          'establishments',
          'establishments.id',
          'locations.establishment_id',
        )
        .select([
          'establishments.publication_status',
          'locations.position_source',
          'locations.is_primary',
          sql<boolean>`EXISTS (SELECT 1 FROM business_profiles b WHERE b.establishment_id = establishments.id)`.as(
            'has_profile',
          ),
        ])
        .where('establishments.id', '=', listing.id as string)
        .executeTakeFirstOrThrow();
      expect(stored).toEqual({
        publication_status: 'DRAFT',
        position_source: 'DEVICE_GPS',
        is_primary: true,
        has_profile: true,
      });

      // Listed in the professional space, readable by its owner only.
      const own = await http()
        .get('/api/v1/pro/listings')
        .set('Cookie', cookie)
        .expect(200);
      expect((own.body as { listings: { id: string }[] }).listings[0].id).toBe(
        listing.id,
      );
      await http()
        .get(`/api/v1/pro/listings/${listing.id as string}`)
        .set('Cookie', otherCookie)
        .expect(404);
    });

    it('keeps a home private: approximate, never public', async () => {
      const response = await create({
        ...base(),
        name: 'Couture à domicile',
        location: {
          type: 'HOME_BASED',
          communeId: ids['agoe-nyive-3'],
          point: insideAgoeNyive3,
          source: 'DEVICE_GPS',
        },
      }).expect(201);
      expect(
        (response.body as { listing: { location: { visibility: string } } })
          .listing.location.visibility,
      ).toBe('APPROXIMATE');
    });

    it('creates a mobile activity with the communes it serves, without a point', async () => {
      const response = await create({
        ...base(),
        name: 'Plombier mobile',
        location: {
          type: 'MOBILE',
          communeId: ids['golfe-1'],
          servedCommuneIds: [ids['golfe-1'], ids['golfe-2']],
        },
      }).expect(201);
      const location = (
        response.body as {
          listing: {
            location: { point: unknown; servedCommunes: { id: string }[] };
          };
        }
      ).listing.location;
      expect(location.point).toBeNull();
      expect(location.servedCommunes.map((c) => c.id).sort()).toEqual(
        [ids['golfe-1'], ids['golfe-2']].sort(),
      );
    });

    it('refuses a position far from Grand Lomé', async () => {
      const response = await create({
        ...base(),
        location: {
          type: 'FIXED',
          communeId: ids['agoe-nyive-3'],
          point: paris,
          source: 'DEVICE_GPS',
        },
      }).expect(400);
      expect(
        (response.body as { fields: Record<string, string> }).fields,
      ).toHaveProperty(['location.point']);
    });

    it('refuses a category of the other kind of listing', async () => {
      await create({
        ...base(),
        categoryId: ids['etablissement-scolaire'],
        location: {
          type: 'HOME_BASED',
          communeId: ids['agoe-nyive-3'],
        },
      }).expect(400);
    });

    it('needs a session', async () => {
      await http().post('/api/v1/pro/listings').send(base()).expect(401);
    });

    it('caps the drafts of one account', async () => {
      const { id: ownerId } = await db
        .selectFrom('users')
        .select('id')
        .where('phone', '=', '+22896100002')
        .executeTakeFirstOrThrow();
      for (let index = 0; index < 20; index += 1) {
        await db
          .insertInto('establishments')
          .values({
            owner_id: ownerId,
            created_by_id: ownerId,
            category_id: ids.reparation,
            entity_type: 'BUSINESS',
            name: `Brouillon ${index}`,
            slug: `brouillon-cap-${index}`,
          })
          .execute();
      }
      await create(
        {
          ...base(),
          location: { type: 'HOME_BASED', communeId: ids['golfe-1'] },
        },
        otherCookie,
      ).expect(409);
    });
  });
});
