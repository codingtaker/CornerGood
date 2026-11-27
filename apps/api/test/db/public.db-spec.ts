import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Kysely, sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  LocalDiskStorage,
  MEDIA_STORAGE,
  newMediaKey,
} from '../../src/media/media-storage';
import {
  assertDisposableConnectedDatabase,
  assertDisposableTestDatabaseUrl,
} from './test-database-guard';

/*
 * The public page of a listing, over HTTP on the real application and the
 * least-privilege role: only what is published and approved, never the
 * owner, never the exact point of a home (ADR-019, ADR-046).
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (process.env.CI && !testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required in CI');
}
if (testDatabaseUrl) {
  assertDisposableTestDatabaseUrl(testDatabaseUrl, process.env.DATABASE_URL);
}
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/** A point inside Golfe 1, far from any grid line of 0.005°. */
const HOME = { lat: 6.13123, lng: 1.22281 };

describeWithDatabase('public page of a listing', () => {
  let pool: Pool;
  let db: Kysely<Database>;
  let app: INestApplication<App>;
  let storage: LocalDiskStorage;
  let folder: string;
  let ownerId: string;
  let categoryId: string;
  const communes: Record<string, string> = {};
  const http = () => request(app.getHttpServer());

  async function listing(
    options: {
      status?: PublicationStatus;
      type?: LocationType;
      name?: string;
    } = {},
  ): Promise<{ id: string; slug: string }> {
    const status = options.status ?? 'PUBLISHED';
    const type = options.type ?? 'FIXED';
    const slug = `fiche-${randomUUID().slice(0, 8)}`;
    const { id } = await db
      .insertInto('establishments')
      .values({
        owner_id: ownerId,
        created_by_id: ownerId,
        category_id: categoryId,
        entity_type: 'BUSINESS',
        name: options.name ?? 'Atelier Afi',
        slug,
        description: 'Réparation de téléphones.',
        phone: '+22890000001',
        whatsapp: '+22890000002',
        publication_status: status,
        published_at: status === 'PUBLISHED' ? sql<Date>`now()` : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('business_profiles')
      .values({ establishment_id: id })
      .execute();
    const location = await db
      .insertInto('locations')
      .values({
        establishment_id: id,
        commune_id: communes['golfe-1'],
        location_type: type,
        visibility: type === 'FIXED' ? 'PUBLIC' : 'APPROXIMATE',
        geom:
          type === 'MOBILE'
            ? null
            : sql<string>`ST_SetSRID(ST_MakePoint(${HOME.lng}, ${HOME.lat}), 4326)::geography`,
        position_source: type === 'MOBILE' ? null : 'DEVICE_GPS',
        address_hint: type === 'FIXED' ? 'Face à la pharmacie' : null,
        is_primary: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (type === 'MOBILE') {
      await db
        .insertInto('location_served_communes')
        .values(
          ['golfe-1', 'golfe-2'].map((slug) => ({
            location_id: location.id,
            commune_id: communes[slug],
          })),
        )
        .execute();
    }
    return { id, slug };
  }

  async function photo(
    listingId: string,
    status: MediaStatus,
    isCover = false,
  ): Promise<string> {
    const key = newMediaKey(listingId);
    await storage.put(key, Buffer.from('RIFF....WEBP'));
    const { id } = await db
      .insertInto('media')
      .values({
        establishment_id: listingId,
        storage_key: key,
        mime_type: 'image/webp',
        size_bytes: 12,
        status,
        is_cover: isCover,
        rejection_reason: status === 'REJECTED' ? 'Floue.' : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  }

  const page = (slug: string) => http().get(`/api/v1/listings/${slug}`);

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
    categoryId = (
      await db
        .selectFrom('categories')
        .select('id')
        .where('slug', '=', 'reparation')
        .executeTakeFirstOrThrow()
    ).id;
    for (const slug of ['golfe-1', 'golfe-2']) {
      communes[slug] = (
        await db
          .selectFrom('communes')
          .select('id')
          .where('slug', '=', slug)
          .executeTakeFirstOrThrow()
      ).id;
    }
    ownerId = (
      await db
        .insertInto('users')
        .values({
          full_name: 'Afi Propriétaire',
          phone: '+22896500001',
          password_hash: await hashPassword('mot de passe du pro'),
          role: 'PROFESSIONAL',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    folder = await mkdtemp(join(tmpdir(), 'cornergood-public-'));
    storage = new LocalDiskStorage(folder);

    const appUrl = new URL(testDatabaseUrl as string);
    appUrl.searchParams.set('options', '-c role=cornergood_app');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE_POOL)
      .useValue(createDatabasePool(appUrl.toString()))
      .overrideProvider(MEDIA_STORAGE)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await rm(folder, { recursive: true, force: true });
  });

  it('shows a published listing to anyone, for a short while in caches', async () => {
    const { slug } = await listing();
    const response = await page(slug)
      .expect(200)
      .expect('Cache-Control', 'public, max-age=60');
    const body: unknown = response.body;
    expect(body).toMatchObject({
      listing: {
        slug,
        name: 'Atelier Afi',
        category: { slug: 'reparation' },
        phone: '+22890000001',
        whatsapp: '+22890000002',
        location: {
          type: 'FIXED',
          commune: { slug: 'golfe-1', name: 'Golfe 1' },
          position: HOME,
          approximate: false,
          addressHint: 'Face à la pharmacie',
        },
      },
    });
  });

  it('says nothing of the owner', async () => {
    const { slug } = await listing();
    const text = JSON.stringify((await page(slug).expect(200)).body);
    expect(text).not.toContain('Propriétaire');
    expect(text).not.toContain('+22896500001');
    expect(text).not.toContain(ownerId);
  });

  it.each(['DRAFT', 'PENDING', 'REJECTED', 'SUSPENDED', 'ARCHIVED'] as const)(
    'answers 404 for a listing %s, even when its address is known',
    async (status) => {
      const { slug } = await listing({ status });
      await page(slug).expect(404);
    },
  );

  it('answers 404 for an unknown or malformed address', async () => {
    await page('fiche-inconnue').expect(404);
    await page('PAS%20UNE%20ADRESSE').expect(404);
  });

  it('never shows the exact point of a home: only its sector (ADR-046)', async () => {
    const { slug } = await listing({ type: 'HOME_BASED' });
    const body = (await page(slug).expect(200)).body as {
      listing: {
        location: {
          approximate: boolean;
          position: { lat: number; lng: number };
        };
      };
    };
    const { position, approximate } = body.listing.location;
    expect(approximate).toBe(true);
    expect(position).not.toEqual(HOME);
    // Snapped to the grid of 0.005°, about 550 m.
    expect(Math.abs(position.lat - HOME.lat)).toBeLessThan(0.005);
    expect(Math.abs(position.lng - HOME.lng)).toBeLessThan(0.005);
    expect(JSON.stringify(body)).not.toContain(String(HOME.lat));
  });

  it('gives a mobile activity its communes and no point', async () => {
    const { slug } = await listing({ type: 'MOBILE' });
    const body: unknown = (await page(slug).expect(200)).body;
    expect(body).toMatchObject({
      listing: {
        location: {
          type: 'MOBILE',
          position: null,
          servedCommunes: [
            { slug: 'golfe-1', name: 'Golfe 1' },
            { slug: 'golfe-2', name: 'Golfe 2' },
          ],
        },
      },
    });
  });

  it('lists and serves approved photos only (ADR-019)', async () => {
    const { id, slug } = await listing();
    const pending = await photo(id, 'PENDING', true);
    const approved = await photo(id, 'APPROVED');
    const rejected = await photo(id, 'REJECTED');

    const body = (await page(slug).expect(200)).body as {
      listing: { photos: { id: string; isCover: boolean }[] };
    };
    // The cover awaits a decision: the approved photo leads instead.
    expect(body.listing.photos).toEqual([{ id: approved, isCover: true }]);

    await http()
      .get(`/api/v1/listings/${slug}/photos/${approved}`)
      .expect(200)
      .expect('Content-Type', 'image/webp')
      .expect('Cache-Control', 'public, max-age=60');
    for (const hidden of [pending, rejected, randomUUID()]) {
      await http().get(`/api/v1/listings/${slug}/photos/${hidden}`).expect(404);
    }
  });

  it('hides the photos of a listing that is no longer published', async () => {
    const { id, slug } = await listing();
    const approved = await photo(id, 'APPROVED');
    await db
      .updateTable('establishments')
      .set({ publication_status: 'SUSPENDED' })
      .where('id', '=', id)
      .execute();
    await http().get(`/api/v1/listings/${slug}/photos/${approved}`).expect(404);
    // Nor through another listing's address.
    const other = await listing();
    await http()
      .get(`/api/v1/listings/${other.slug}/photos/${approved}`)
      .expect(404);
  });
});
