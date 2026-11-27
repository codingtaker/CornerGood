import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Kysely, sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { hashPassword } from '../../src/auth/password-hasher';
import {
  createDatabasePool,
  DATABASE_POOL,
} from '../../src/database/database.module';
import {
  Database,
  LocationType,
  MediaStatus,
  PublicationStatus,
} from '../../src/database/database.types';
import { createKysely } from '../../src/database/kysely';
import { runMigrations } from '../../src/database/migrator';
import { seedReferenceData } from '../../src/database/seeder';
import {
  assertDisposableConnectedDatabase,
  assertDisposableTestDatabaseUrl,
} from './test-database-guard';

/*
 * The public search (contract §4.1, ADR-014, ADR-015, ADR-064), over HTTP on
 * the real application and the least-privilege role.
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (process.env.CI && !testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required in CI');
}
if (testDatabaseUrl) {
  assertDisposableTestDatabaseUrl(testDatabaseUrl, process.env.DATABASE_URL);
}
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** In Golfe 1, far from any grid line of 0.005°. */
const HERE = { lat: 6.13123, lng: 1.22281 };
/**
 * Identifiers that sort first and last: ties are broken by id, so giving the
 * expected loser the first id makes a wrong ranking fail every time.
 */
const FIRST_ID = '00000000-0000-4000-8000-000000000000';
const LAST_ID = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
/** About 200 m and 2 km north of HERE. */
const NEAR = { lat: HERE.lat + 0.0018, lng: HERE.lng };
const FAR = { lat: HERE.lat + 0.018, lng: HERE.lng };

interface Result {
  slug: string;
  name: string;
  matchedServices: string[];
  position: { lat: number; lng: number } | null;
  distanceMeters: number | null;
  coverPhotoUrl: string | null;
  locationType: LocationType;
}
interface Page {
  data: Result[];
  meta: { page: number; limit: number; total: number };
}

describeWithDatabase('public search', () => {
  let pool: Pool;
  let db: Kysely<Database>;
  let app: INestApplication<App>;
  let ownerId: string;
  const categories: Record<string, string> = {};
  const services: Record<string, string> = {};
  const communes: Record<string, string> = {};
  /** A point inside Golfe 2, for mobile activities. */
  let golfe2Point: { lat: number; lng: number };

  async function listing(
    options: {
      id?: string;
      name?: string;
      category?: string;
      status?: PublicationStatus;
      type?: LocationType;
      at?: { lat: number; lng: number };
      commune?: string;
      served?: string[];
      services?: string[];
      hours?: boolean;
      whatsapp?: boolean;
      photo?: MediaStatus;
    } = {},
  ): Promise<{ id: string; slug: string }> {
    const status = options.status ?? 'PUBLISHED';
    const type = options.type ?? 'FIXED';
    const slug = `fiche-${randomUUID().slice(0, 8)}`;
    const { id } = await db
      .insertInto('establishments')
      .values({
        id: options.id ?? randomUUID(),
        owner_id: ownerId,
        created_by_id: ownerId,
        category_id: categories[options.category ?? 'reparation'],
        entity_type: 'BUSINESS',
        name: options.name ?? 'Atelier',
        slug,
        description: 'Une activité du quartier.',
        phone: '+22890000001',
        whatsapp: options.whatsapp ? '+22890000002' : null,
        opening_hours: options.hours ? { mon: [['08:00', '18:00']] } : null,
        publication_status: status,
        published_at: status === 'PUBLISHED' ? sql<Date>`now()` : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const at = options.at ?? HERE;
    const location = await db
      .insertInto('locations')
      .values({
        establishment_id: id,
        commune_id: communes[options.commune ?? 'golfe-1'],
        location_type: type,
        visibility: type === 'FIXED' ? 'PUBLIC' : 'APPROXIMATE',
        geom:
          type === 'MOBILE'
            ? null
            : sql<string>`ST_SetSRID(ST_MakePoint(${at.lng}, ${at.lat}), 4326)::geography`,
        position_source: type === 'MOBILE' ? null : 'DEVICE_GPS',
        is_primary: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (options.served?.length) {
      await db
        .insertInto('location_served_communes')
        .values(
          options.served.map((commune) => ({
            location_id: location.id,
            commune_id: communes[commune],
          })),
        )
        .execute();
    }
    if (options.services?.length) {
      await db
        .insertInto('establishment_services')
        .values(
          options.services.map((service) => ({
            establishment_id: id,
            service_id: services[service],
          })),
        )
        .execute();
    }
    if (options.photo) {
      await db
        .insertInto('media')
        .values({
          establishment_id: id,
          storage_key: `test/${randomUUID()}.webp`,
          mime_type: 'image/webp',
          size_bytes: 12,
          status: options.photo,
          is_cover: true,
          rejection_reason: options.photo === 'REJECTED' ? 'Floue.' : null,
        })
        .execute();
    }
    return { id, slug };
  }

  const search = (query: Record<string, string | number>) =>
    request(app.getHttpServer()).get('/api/v1/search').query(query);
  async function found(query: Record<string, string | number>): Promise<Page> {
    const response = await search(query).expect(200);
    return response.body as Page;
  }
  const names = (page: Page) => page.data.map((result) => result.name);

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

    for (const row of await db
      .selectFrom('categories')
      .select(['id', 'slug'])
      .execute()) {
      categories[row.slug] = row.id;
    }
    for (const row of await db
      .selectFrom('services')
      .select(['id', 'slug'])
      .execute()) {
      services[row.slug] = row.id;
    }
    for (const row of await db
      .selectFrom('communes')
      .select(['id', 'slug'])
      .execute()) {
      communes[row.slug] = row.id;
    }
    const inside = await sql<{ lat: number; lng: number }>`
      SELECT ST_Y(p) AS lat, ST_X(p) AS lng
      FROM (SELECT ST_PointOnSurface(boundary::geometry) AS p
            FROM communes WHERE slug = 'golfe-2') AS points`.execute(db);
    golfe2Point = inside.rows[0];
    ownerId = (
      await db
        .insertInto('users')
        .values({
          full_name: 'Afi Propriétaire',
          phone: '+22896600001',
          password_hash: await hashPassword('mot de passe du pro'),
          role: 'PROFESSIONAL',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    const appUrl = new URL(testDatabaseUrl as string);
    appUrl.searchParams.set('options', '-c role=cornergood_app');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE_POOL)
      .useValue(createDatabasePool(appUrl.toString()))
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  beforeEach(async () => {
    // Each test sees only its own listings, and has its own 60 searches.
    await db.deleteFrom('establishments').execute();
    await db.deleteFrom('auth_throttle').execute();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('finds published listings only', async () => {
    await listing({ name: 'Garage Publié' });
    for (const status of [
      'DRAFT',
      'PENDING',
      'REJECTED',
      'SUSPENDED',
      'ARCHIVED',
    ] as const) {
      await listing({ name: `Garage ${status}`, status });
    }
    const page = await found({ q: 'garage' });
    expect(names(page)).toEqual(['Garage Publié']);
    expect(page.meta).toEqual({ page: 1, limit: 20, total: 1 });
  });

  it('matches name, category and services, without accents or case', async () => {
    await listing({
      name: 'Chez Kossi',
      services: ['reparation-ecran-telephone'],
    });
    await listing({ name: 'Boutique Ama', category: 'commerce' });
    expect(names(await found({ q: 'ECRAN' }))).toEqual(['Chez Kossi']);
    expect(names(await found({ q: 'réparation' }))).toEqual(['Chez Kossi']);
    expect(names(await found({ q: 'boutique' }))).toEqual(['Boutique Ama']);
    // Every word must be found somewhere in the listing.
    expect(names(await found({ q: 'ecran boutique' }))).toEqual([]);
  });

  it('names the services that answer the query', async () => {
    await listing({
      name: 'Chez Kossi',
      services: ['reparation-ecran-telephone', 'reparation-ordinateurs'],
    });
    const [result] = (await found({ q: 'telephone' })).data;
    expect(result.matchedServices).toEqual([
      "Remplacement d'écran de téléphone",
    ]);
    const [byService] = (await found({ service: 'reparation-ordinateurs' }))
      .data;
    expect(byService.matchedServices).toEqual(["Réparation d'ordinateurs"]);
  });

  it('keeps to the listings that offer the requested service', async () => {
    await listing({
      name: 'Chez Kossi',
      services: ['reparation-ecran-telephone'],
    });
    await listing({
      name: 'Atelier Kodjo',
      services: ['reparation-ordinateurs'],
    });
    await listing({ name: 'Sans service' });
    expect(
      names(await found({ service: 'reparation-ecran-telephone' })),
    ).toEqual(['Chez Kossi']);
  });

  it('ignores a service the catalogue has deactivated', async () => {
    await listing({
      name: 'Chez Kossi',
      services: ['reparation-ecran-telephone'],
    });
    await db
      .updateTable('services')
      .set({ is_active: false })
      .where('slug', '=', 'reparation-ecran-telephone')
      .execute();
    try {
      expect(names(await found({ q: 'ecran' }))).toEqual([]);
      expect(
        names(await found({ service: 'reparation-ecran-telephone' })),
      ).toEqual([]);
    } finally {
      await db
        .updateTable('services')
        .set({ is_active: true })
        .where('slug', '=', 'reparation-ecran-telephone')
        .execute();
    }
  });

  it('ranks by category, then service, then proximity, then completeness (ADR-015)', async () => {
    // "telephone" is in the name of A, in a service of B, and B is far away
    // while A is next door and complete: the service still weighs more.
    await listing({
      id: FIRST_ID,
      name: 'Téléphones Afi',
      category: 'commerce',
      at: NEAR,
      hours: true,
      whatsapp: true,
      photo: 'APPROVED',
    });
    await listing({
      id: LAST_ID,
      name: 'Atelier Kodjo',
      at: FAR,
      services: ['reparation-ecran-telephone'],
    });
    const page = await found({
      q: 'telephone',
      lat: HERE.lat,
      lng: HERE.lng,
      radius: 5000,
    });
    expect(names(page)).toEqual(['Atelier Kodjo', 'Téléphones Afi']);
  });

  it('ranks the requested category above a name, however near and complete', async () => {
    await listing({
      id: FIRST_ID,
      name: 'Réparation Express',
      category: 'commerce',
      at: NEAR,
      hours: true,
      whatsapp: true,
      photo: 'APPROVED',
    });
    await listing({ id: LAST_ID, name: 'Atelier Kodjo', at: FAR });
    const page = await found({
      q: 'reparation',
      lat: HERE.lat,
      lng: HERE.lng,
      radius: 5000,
    });
    expect(names(page)).toEqual(['Atelier Kodjo', 'Réparation Express']);
  });

  it('puts the nearer listing first and leaves out those beyond the radius', async () => {
    await listing({ id: FIRST_ID, name: 'Loin', at: FAR });
    await listing({ id: LAST_ID, name: 'Près', at: NEAR });
    const page = await found({
      category: 'reparation',
      lat: HERE.lat,
      lng: HERE.lng,
      radius: 5000,
    });
    expect(names(page)).toEqual(['Près', 'Loin']);
    expect(page.data[0].distanceMeters).toBeGreaterThan(150);
    expect(page.data[0].distanceMeters).toBeLessThan(250);

    const close = await found({
      category: 'reparation',
      lat: HERE.lat,
      lng: HERE.lng,
      radius: 1000,
    });
    expect(names(close)).toEqual(['Près']);
  });

  it('puts the more complete listing first, all else equal', async () => {
    await listing({ id: FIRST_ID, name: 'Simple' });
    await listing({
      id: LAST_ID,
      name: 'Complète',
      services: ['reparation-ordinateurs'],
      hours: true,
      whatsapp: true,
      photo: 'APPROVED',
    });
    expect(names(await found({ category: 'reparation' }))).toEqual([
      'Complète',
      'Simple',
    ]);
  });

  it('does not count a photo that awaits a decision, nor show it', async () => {
    await listing({ id: FIRST_ID, name: 'Photo en attente', photo: 'PENDING' });
    const approved = await listing({
      id: LAST_ID,
      name: 'Photo validée',
      photo: 'APPROVED',
    });
    const page = await found({ category: 'reparation' });
    expect(names(page)).toEqual(['Photo validée', 'Photo en attente']);
    expect(page.data[0].coverPhotoUrl).toMatch(
      new RegExp(`^/api/v1/listings/${approved.slug}/photos/[0-9a-f-]{36}$`),
    );
    expect(page.data[1].coverPhotoUrl).toBeNull();
  });

  it('finds a mobile activity where it works, without a point (RM-023)', async () => {
    await listing({
      name: 'Plombier mobile',
      type: 'MOBILE',
      commune: 'golfe-1',
      served: ['golfe-2'],
    });
    await listing({ name: 'Atelier fixe', commune: 'golfe-1' });

    expect(names(await found({ commune: 'golfe-2' }))).toEqual([
      'Plombier mobile',
    ]);
    // 100 m: the fixed place of Golfe 1 is out of reach.
    const near = await found({
      lat: golfe2Point.lat,
      lng: golfe2Point.lng,
      radius: 100,
    });
    expect(near.data).toEqual([
      expect.objectContaining({
        name: 'Plombier mobile',
        locationType: 'MOBILE',
        position: null,
        distanceMeters: null,
      }),
    ]);
  });

  it('never reveals the exact point of a home (ADR-046)', async () => {
    await listing({ name: 'Couture à domicile', type: 'HOME_BASED' });
    const [result] = (await found({ q: 'couture' })).data;
    const { lat, lng } = result.position ?? { lat: NaN, lng: NaN };
    // Snapped to the grid of 0.005°, about 550 m (migration 0007).
    expect(lat).toBeCloseTo(6.13, 6);
    expect(lng).toBeCloseTo(1.225, 6);
  });

  it('keeps to the map viewport, only listings with a point', async () => {
    await listing({ name: 'Dans la zone', at: NEAR });
    await listing({ name: 'Hors zone', at: FAR });
    await listing({ name: 'Mobile', type: 'MOBILE', served: ['golfe-1'] });
    const bbox = [
      HERE.lng - 0.01,
      HERE.lat - 0.01,
      HERE.lng + 0.01,
      HERE.lat + 0.01,
    ].join(',');
    expect(names(await found({ bbox }))).toEqual(['Dans la zone']);
  });

  it('filters on the kind of listing and the category', async () => {
    await listing({ name: 'Atelier' });
    await db
      .updateTable('establishments')
      .set({
        entity_type: 'COMMUNITY',
        category_id: categories['bibliotheque'],
      })
      .where(
        'id',
        '=',
        (await listing({ name: 'Bibliothèque du quartier' })).id,
      )
      .execute();
    expect(names(await found({ entityType: 'COMMUNITY' }))).toEqual([
      'Bibliothèque du quartier',
    ]);
    expect(names(await found({ category: 'bibliotheque' }))).toEqual([
      'Bibliothèque du quartier',
    ]);
    expect(names(await found({ category: 'inconnue' }))).toEqual([]);
  });

  it('pages in a stable order and tells the total past the end', async () => {
    for (let index = 0; index < 5; index += 1) {
      await listing({ name: `Atelier ${index}` });
    }
    const first = await found({ category: 'reparation', limit: 2 });
    const second = await found({ category: 'reparation', limit: 2, page: 2 });
    const third = await found({ category: 'reparation', limit: 2, page: 3 });
    const all = [...names(first), ...names(second), ...names(third)];
    expect(new Set(all).size).toBe(5);
    expect(first.meta).toEqual({ page: 1, limit: 2, total: 5 });
    const beyond = await found({ category: 'reparation', limit: 2, page: 4 });
    expect(beyond).toEqual({ data: [], meta: { page: 4, limit: 2, total: 5 } });
  });

  it('answers 400 for an empty or invalid search', async () => {
    const response = await search({}).expect(400);
    const body = response.body as { fields: Record<string, string> };
    expect(Object.keys(body.fields)).toEqual(['q']);
    await search({ q: 'couture', radius: 500 }).expect(400);
  });

  it('is cached briefly, privately when it carries a position (ADR-022)', async () => {
    await search({ q: 'couture' }).expect(
      'Cache-Control',
      'public, max-age=60',
    );
    await search({ lat: HERE.lat, lng: HERE.lng }).expect(
      'Cache-Control',
      'private, max-age=60',
    );
  });

  it('allows 60 searches a minute from one address (§9)', async () => {
    for (let index = 0; index < 60; index += 1) {
      await search({ q: 'couture' }).expect(200);
    }
    const blocked = await search({ q: 'couture' }).expect(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });
});
