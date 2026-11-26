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
  PublicationStatus,
  UserRole,
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
 * Back-office (S4), over HTTP on the real application and the least-privilege
 * role: who may decide, what each decision changes, and that the status and
 * its log line never part (ADR-010, ADR-011, ADR-019, ADR-039).
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (process.env.CI && !testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required in CI');
}
if (testDatabaseUrl) {
  assertDisposableTestDatabaseUrl(testDatabaseUrl, process.env.DATABASE_URL);
}
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

interface Account {
  id: string;
  cookie: string;
}

describeWithDatabase('back-office (S4)', () => {
  const origin = process.env.WEB_ORIGIN as string;
  let pool: Pool;
  let db: Kysely<Database>;
  let app: INestApplication<App>;
  let storage: LocalDiskStorage;
  let folder: string;
  let categoryId: string;
  let communeId: string;
  let pro: Account;
  let moderator: Account;
  let admin: Account;
  const http = () => request(app.getHttpServer());

  function cookieOf(response: request.Response): string {
    const header = response.headers['set-cookie'] as unknown as string[];
    return header[0].split(';')[0];
  }

  async function staff(role: UserRole, phone: string, ip: string) {
    const password = `mot de passe ${role.toLowerCase()}`;
    const { id } = await db
      .insertInto('users')
      .values({
        full_name: role === 'ADMIN' ? 'Admin Kodjo' : 'Modo Ama',
        phone: `+228${phone.replace(/ /g, '')}`,
        password_hash: await hashPassword(password),
        role,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const response = await http()
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ phone, password })
      .expect(200);
    return { id, cookie: cookieOf(response) };
  }

  /** A complete listing in the given status, with its primary location. */
  async function listing(
    status: PublicationStatus = 'PENDING',
    name = 'Atelier Afi',
  ): Promise<string> {
    const { id } = await db
      .insertInto('establishments')
      .values({
        owner_id: pro.id,
        created_by_id: pro.id,
        category_id: categoryId,
        entity_type: 'BUSINESS',
        name,
        slug: `fiche-${randomUUID()}`,
        description: 'Réparation de téléphones.',
        phone: '+22890000001',
        publication_status: status,
        published_at: status === 'PUBLISHED' ? sql<Date>`now()` : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('business_profiles')
      .values({ establishment_id: id })
      .execute();
    await db
      .insertInto('locations')
      .values({
        establishment_id: id,
        commune_id: communeId,
        location_type: 'FIXED',
        visibility: 'PUBLIC',
        geom: sql<string>`ST_SetSRID(ST_MakePoint(1.2228, 6.1319), 4326)::geography`,
        position_source: 'MANUAL_PIN',
        is_primary: true,
      })
      .execute();
    if (status === 'PENDING') {
      await db
        .insertInto('moderation_log')
        .values({
          establishment_id: id,
          actor_id: pro.id,
          action: 'SUBMIT',
          from_status: 'DRAFT',
          to_status: 'PENDING',
        })
        .execute();
    }
    return id;
  }

  async function photo(listingId: string): Promise<string> {
    const key = newMediaKey(listingId);
    await storage.put(key, Buffer.from('RIFF....WEBP'));
    const { id } = await db
      .insertInto('media')
      .values({
        establishment_id: listingId,
        storage_key: key,
        mime_type: 'image/webp',
        size_bytes: 12,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  }

  const post = (path: string, as: Account | null, body?: object) => {
    const call = http()
      .post(`/api/v1/admin/${path}`)
      .set('Cookie', as?.cookie ?? '')
      .set('Origin', origin);
    return body ? call.send(body) : call;
  };
  const get = (path: string, as: Account | null) =>
    http()
      .get(`/api/v1/${path}`)
      .set('Cookie', as?.cookie ?? '');
  const statusOf = async (id: string) =>
    db
      .selectFrom('establishments')
      .select(['publication_status', 'published_at'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  const decisionsOf = (id: string) =>
    db
      .selectFrom('moderation_log')
      .select([
        'action',
        'from_status',
        'to_status',
        'reason',
        'actor_id',
        'media_id',
      ])
      .where('establishment_id', '=', id)
      .where('action', '!=', 'SUBMIT')
      .orderBy('created_at')
      .execute();

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
    communeId = (
      await db
        .selectFrom('communes')
        .select('id')
        .where('slug', '=', 'golfe-1')
        .executeTakeFirstOrThrow()
    ).id;
    folder = await mkdtemp(join(tmpdir(), 'cornergood-moderation-'));
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

    const registered = await http()
      .post('/api/v1/auth/register')
      .set('X-Forwarded-For', '203.0.113.140')
      .send({
        fullName: 'Pro Afi',
        phone: '96 30 00 01',
        password: 'sur le terrain',
      })
      .expect(201);
    pro = {
      id: (registered.body as { user: { id: string } }).user.id,
      cookie: cookieOf(registered),
    };
    moderator = await staff('MODERATOR', '96 30 00 02', '203.0.113.141');
    admin = await staff('ADMIN', '96 30 00 03', '203.0.113.142');
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    await rm(folder, { recursive: true, force: true });
  });

  describe('queue and decision page', () => {
    it('is closed to professionals and to visitors', async () => {
      const id = await listing();
      await get('admin/moderation', pro).expect(403);
      await get('admin/moderation', null).expect(401);
      await get(`admin/listings/${id}`, pro).expect(403);
    });

    it('lists what awaits a decision, the oldest submission first', async () => {
      const first = await listing('PENDING', 'Première');
      const second = await listing('PENDING', 'Seconde');
      const draft = await listing('DRAFT', 'Brouillon');
      await photo(second);
      await photo(second);

      const body: unknown = (
        await get('admin/moderation', moderator).expect(200)
      ).body;
      const queue = (
        body as { listings: { id: string; pendingPhotos: number }[] }
      ).listings;
      const ids = queue.map((item) => item.id);
      expect(ids.indexOf(first)).toBeLessThan(ids.indexOf(second));
      expect(ids).not.toContain(draft);
      expect(queue.find((item) => item.id === second)).toMatchObject({
        name: 'Seconde',
        category: expect.any(String) as string,
        commune: 'Golfe 1',
        pendingPhotos: 2,
      });
    });

    it('shows the private data, the photos and the history', async () => {
      const id = await listing();
      const photoId = await photo(id);
      const body: unknown = (
        await get(`admin/listings/${id}`, moderator).expect(200)
      ).body;
      expect(body).toMatchObject({
        listing: {
          id,
          status: 'PENDING',
          phone: '+22890000001',
          owner: { name: 'Pro Afi', phone: '+22896300001' },
          location: {
            point: { lat: 6.1319, lng: 1.2228 },
            source: 'MANUAL_PIN',
          },
          photos: [{ id: photoId, status: 'PENDING' }],
          log: [{ action: 'SUBMIT', actor: { name: 'Pro Afi' } }],
        },
      });
      await get(`admin/listings/${randomUUID()}`, moderator).expect(404);
      await get('admin/listings/pas-un-id', moderator).expect(404);
    });

    it('shows a photo to moderators only, never cached', async () => {
      const photoId = await photo(await listing());
      await get(`admin/media/${photoId}`, moderator)
        .expect(200)
        .expect('Content-Type', 'image/webp')
        .expect('Cache-Control', 'no-store');
      await get(`admin/media/${photoId}`, pro).expect(403);
      await get(`admin/media/${randomUUID()}`, moderator).expect(404);
    });
  });

  describe('listing decisions (ADR-010, ADR-011)', () => {
    it('lets the administrator publish, with its log line', async () => {
      const id = await listing();
      const body: unknown = (
        await post(`listings/${id}/approve`, admin).expect(200)
      ).body;
      expect(body).toMatchObject({ listing: { status: 'PUBLISHED' } });

      const after = await statusOf(id);
      expect(after.publication_status).toBe('PUBLISHED');
      expect(after.published_at).toBeInstanceOf(Date);
      expect(await decisionsOf(id)).toEqual([
        {
          action: 'APPROVE',
          from_status: 'PENDING',
          to_status: 'PUBLISHED',
          reason: null,
          actor_id: admin.id,
          media_id: null,
        },
      ]);
      // Now public: the public view returns its location.
      const visible = await db
        .selectFrom('public_locations')
        .select('id')
        .where('establishment_id', '=', id)
        .execute();
      expect(visible).toHaveLength(1);
    });

    it('keeps publication and rejection for the administrator', async () => {
      const id = await listing();
      await post(`listings/${id}/approve`, moderator).expect(403);
      await post(`listings/${id}/reject`, moderator, { reason: 'Non' }).expect(
        403,
      );
      await post(`listings/${id}/approve`, pro).expect(403);
      expect((await statusOf(id)).publication_status).toBe('PENDING');
      expect(await decisionsOf(id)).toEqual([]);
    });

    it('decides once: a second decision fails cleanly', async () => {
      const id = await listing();
      await post(`listings/${id}/approve`, admin).expect(200);
      const again = await post(`listings/${id}/approve`, admin).expect(409);
      expect(again.body).toMatchObject({ code: 'INVALID_STATE' });
      await post(`listings/${id}/reject`, admin, {
        reason: 'Trop tard',
      }).expect(409);
      await post(`listings/${await listing('DRAFT')}/approve`, admin).expect(
        409,
      );
      await post(`listings/${randomUUID()}/approve`, admin).expect(404);
      expect(await decisionsOf(id)).toHaveLength(1);
    });

    it('takes one of two simultaneous decisions', async () => {
      const id = await listing();
      // The row is held while both requests arrive, so they really overlap:
      // without the API's own lock, both would read PENDING.
      const held = await db.transaction().execute(async (trx) => {
        await trx
          .selectFrom('establishments')
          .select('id')
          .where('id', '=', id)
          .forUpdate()
          .execute();
        const answers = Promise.all([
          post(`listings/${id}/approve`, admin).then((r) => r.status),
          post(`listings/${id}/reject`, admin, { reason: 'Doublon' }).then(
            (r) => r.status,
          ),
        ]);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        // In an object: returned as is, it would be awaited inside the lock.
        return { answers };
      });
      expect((await held.answers).sort()).toEqual([200, 409]);
      expect(await decisionsOf(id)).toHaveLength(1);
    });

    it('keeps the status together with its log line', async () => {
      const id = await listing();
      await sql`REVOKE INSERT ON moderation_log FROM cornergood_app`.execute(
        db,
      );
      try {
        await post(`listings/${id}/approve`, admin).expect(500);
      } finally {
        await sql`GRANT INSERT ON moderation_log TO cornergood_app`.execute(db);
      }
      const after = await statusOf(id);
      expect(after.publication_status).toBe('PENDING');
      expect(after.published_at).toBeNull();
    });

    it('requires a reason to reject, and changes nothing without one', async () => {
      const id = await listing();
      for (const body of [
        {},
        { reason: '   ' },
        { reason: 'x'.repeat(501) },
        { reason: 4 },
      ]) {
        const refused = await post(`listings/${id}/reject`, admin, body).expect(
          422,
        );
        expect(refused.body).toMatchObject({ code: 'REASON_REQUIRED' });
      }
      expect((await statusOf(id)).publication_status).toBe('PENDING');
      expect(await decisionsOf(id)).toEqual([]);
    });

    it('goes from draft to published: rejected, corrected, sent again, approved', async () => {
      const id = await listing();
      await post(`listings/${id}/reject`, admin, {
        reason: '  Ajoutez une description de vos services.  ',
      }).expect(200);

      // The professional sees why, while correcting.
      const own = () => get(`pro/listings/${id}`, pro).expect(200);
      expect((await own()).body).toMatchObject({
        listing: {
          status: 'REJECTED',
          rejection: { reason: 'Ajoutez une description de vos services.' },
        },
      });
      await http()
        .patch(`/api/v1/pro/listings/${id}`)
        .set('Cookie', pro.cookie)
        .send({
          name: 'Atelier Afi',
          categoryId,
          description: 'Réparation de téléphones et de radios, sur place.',
          phone: '90 00 00 01',
          whatsapp: '',
        })
        .expect(200);
      expect((await own()).body).toMatchObject({
        listing: {
          status: 'DRAFT',
          rejection: { reason: expect.any(String) as string },
        },
      });
      await http()
        .post(`/api/v1/pro/listings/${id}/submit`)
        .set('Cookie', pro.cookie)
        .expect(200);
      expect((await own()).body).toMatchObject({
        listing: { status: 'PENDING', rejection: null },
      });

      await post(`listings/${id}/approve`, admin).expect(200);
      expect((await own()).body).toMatchObject({
        listing: { status: 'PUBLISHED', rejection: null },
      });
      expect((await decisionsOf(id)).map((line) => line.action)).toEqual([
        'REJECT',
        'EDIT',
        'APPROVE',
      ]);
    });
  });

  describe('photo decisions (ADR-019, ADR-039)', () => {
    const photoOf = (id: string) =>
      db
        .selectFrom('media')
        .select(['status', 'rejection_reason'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

    it('lets a moderator approve a photo, once, with its log line', async () => {
      const listingId = await listing();
      const id = await photo(listingId);
      const body: unknown = (
        await post(`media/${id}/approve`, moderator).expect(200)
      ).body;
      expect(body).toMatchObject({ photo: { id, status: 'APPROVED' } });
      expect(await photoOf(id)).toEqual({
        status: 'APPROVED',
        rejection_reason: null,
      });
      expect(await decisionsOf(listingId)).toEqual([
        {
          action: 'APPROVE_MEDIA',
          from_status: null,
          to_status: null,
          reason: null,
          actor_id: moderator.id,
          media_id: id,
        },
      ]);
      const again = await post(`media/${id}/approve`, admin).expect(409);
      expect(again.body).toMatchObject({ code: 'INVALID_STATE' });
      await post(`media/${id}/approve`, pro).expect(403);
    });

    it('refuses a photo with a reason the professional reads', async () => {
      const listingId = await listing();
      const id = await photo(listingId);
      await post(`media/${id}/reject`, moderator, { reason: ' ' }).expect(422);
      expect((await photoOf(id)).status).toBe('PENDING');

      await post(`media/${id}/reject`, moderator, {
        reason: 'On lit le numéro de la maison.',
      }).expect(200);
      const body: unknown = (
        await get(`pro/listings/${listingId}/media`, pro).expect(200)
      ).body;
      expect(body).toEqual({
        photos: [
          {
            id,
            status: 'REJECTED',
            isCover: false,
            rejectionReason: 'On lit le numéro de la maison.',
          },
        ],
      });
    });

    it('leaves the photos of a draft to its owner', async () => {
      const id = await photo(await listing('DRAFT'));
      await post(`media/${id}/approve`, moderator).expect(409);
      expect((await photoOf(id)).status).toBe('PENDING');
      await post(`media/${randomUUID()}/approve`, moderator).expect(404);
    });

    it('keeps the decision once the refused photo is deleted', async () => {
      const listingId = await listing();
      const id = await photo(listingId);
      await post(`media/${id}/reject`, moderator, { reason: 'Floue.' }).expect(
        200,
      );
      await post(`listings/${listingId}/reject`, admin, {
        reason: 'Remplacez la photo floue.',
      }).expect(200);
      await http()
        .delete(`/api/v1/pro/listings/${listingId}/media/${id}`)
        .set('Cookie', pro.cookie)
        .expect(204);
      expect(
        (await decisionsOf(listingId)).map((line) => line.media_id),
      ).toEqual([id, null]);
    });

    it('keeps the photo status together with its log line', async () => {
      const id = await photo(await listing());
      await sql`REVOKE INSERT ON moderation_log FROM cornergood_app`.execute(
        db,
      );
      try {
        await post(`media/${id}/approve`, moderator).expect(500);
      } finally {
        await sql`GRANT INSERT ON moderation_log TO cornergood_app`.execute(db);
      }
      expect((await photoOf(id)).status).toBe('PENDING');
    });
  });
});
