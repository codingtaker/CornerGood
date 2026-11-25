import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Kysely, sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import sharp from 'sharp';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import {
  createDatabasePool,
  DATABASE_POOL,
} from '../../src/database/database.module';
import { Database, PublicationStatus } from '../../src/database/database.types';
import { createKysely } from '../../src/database/kysely';
import { runMigrations } from '../../src/database/migrator';
import { seedReferenceData } from '../../src/database/seeder';
import { LocalDiskStorage, MEDIA_STORAGE } from '../../src/media/media-storage';
import {
  assertDisposableConnectedDatabase,
  assertDisposableTestDatabaseUrl,
} from './test-database-guard';

/*
 * Photos (S4), over HTTP on the real application, a real folder and the
 * least-privilege role: what is stored carries no position, belongs to the
 * owner only, and waits for approval.
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (process.env.CI && !testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required in CI');
}
if (testDatabaseUrl) {
  assertDisposableTestDatabaseUrl(testDatabaseUrl, process.env.DATABASE_URL);
}
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase('photos of a listing (S4)', () => {
  const origin = process.env.WEB_ORIGIN as string;
  const password = 'sur le terrain';
  let pool: Pool;
  let db: Kysely<Database>;
  let app: INestApplication<App>;
  let folder: string;
  let categoryId: string;
  let owner: { id: string; cookie: string };
  let other: { id: string; cookie: string };
  let jpeg: Buffer;
  const http = () => request(app.getHttpServer());

  async function signUp(phone: string, ip: string) {
    const response = await http()
      .post('/api/v1/auth/register')
      .set('X-Forwarded-For', ip)
      .send({ fullName: 'Pro Photo', phone, password })
      .expect(201);
    const header = response.headers['set-cookie'] as unknown as string[];
    return {
      id: (response.body as { user: { id: string } }).user.id,
      cookie: header[0].split(';')[0],
    };
  }

  async function listing(
    ownerId = owner.id,
    status: PublicationStatus = 'DRAFT',
  ): Promise<string> {
    const { id } = await db
      .insertInto('establishments')
      .values({
        owner_id: ownerId,
        created_by_id: ownerId,
        category_id: categoryId,
        entity_type: 'BUSINESS',
        name: 'Fiche photo',
        slug: `fiche-${randomUUID()}`,
        description: 'Une activité.',
        phone: '+22890000001',
        publication_status: status,
        published_at: status === 'PUBLISHED' ? sql<Date>`now()` : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  }

  const upload = (
    id: string,
    file: Buffer | null = jpeg,
    as = owner.cookie,
    name = 'photo.jpg',
  ) => {
    const call = http()
      .post(`/api/v1/pro/listings/${id}/media`)
      .set('Cookie', as)
      .set('Origin', origin);
    return file ? call.attach('file', file, name) : call;
  };
  const photosOf = (id: string) =>
    db
      .selectFrom('media')
      .selectAll()
      .where('establishment_id', '=', id)
      .orderBy('display_order')
      .execute();
  const filesOf = (id: string) =>
    readdir(join(folder, id)).catch(() => [] as string[]);
  const resetLimit = () =>
    db.deleteFrom('auth_throttle').where('key', 'like', 'media:%').execute();

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
    folder = await mkdtemp(join(tmpdir(), 'cornergood-media-'));

    const appUrl = new URL(testDatabaseUrl as string);
    appUrl.searchParams.set('options', '-c role=cornergood_app');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE_POOL)
      .useValue(createDatabasePool(appUrl.toString()))
      .overrideProvider(MEDIA_STORAGE)
      .useValue(new LocalDiskStorage(folder))
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    owner = await signUp('96 20 00 01', '203.0.113.130');
    other = await signUp('96 20 00 02', '203.0.113.131');
    jpeg = await sharp({
      create: { width: 1600, height: 1200, channels: 3, background: '#c85a0a' },
    })
      .jpeg()
      .withExif({
        IFD0: { Artist: 'Secret Owner' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '6/1 13/1 12/1' },
      })
      .toBuffer();
  });
  beforeEach(resetLimit);

  afterAll(async () => {
    await app.close();
    await pool.end();
    await rm(folder, { recursive: true, force: true });
  });

  it('stores a clean, PENDING photo: no EXIF on the disk', async () => {
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();
    const id = await listing();
    const response = await upload(id).expect(201);
    expect(response.body).toMatchObject({
      photo: { status: 'PENDING', isCover: true },
    });
    // The file name and place are the server's secret.
    expect(JSON.stringify(response.body)).not.toContain('webp');

    const [row] = await photosOf(id);
    const stored = await readFile(join(folder, row.storage_key));
    expect(row).toMatchObject({
      status: 'PENDING',
      mime_type: 'image/webp',
      size_bytes: stored.length,
    });
    const metadata = await sharp(stored).metadata();
    expect([metadata.width, metadata.height]).toEqual([1280, 960]);
    expect(metadata.exif).toBeUndefined();
    expect(stored.toString('latin1')).not.toContain('Secret Owner');
  });

  it('shows it to its owner only, and never cached', async () => {
    const id = await listing();
    const body: unknown = (await upload(id).expect(201)).body;
    const path = `/api/v1/pro/listings/${id}/media`;
    const photo = `${path}/${(body as { photo: { id: string } }).photo.id}`;

    const response = await http()
      .get(photo)
      .set('Cookie', owner.cookie)
      .expect(200)
      .expect('Content-Type', 'image/webp')
      .expect('Cache-Control', 'no-store')
      .expect('X-Content-Type-Options', 'nosniff');
    expect(
      (await sharp(response.body as Buffer).metadata()).exif,
    ).toBeUndefined();

    await http().get(photo).expect(401);
    await http().get(photo).set('Cookie', other.cookie).expect(404);
    await http().delete(photo).set('Cookie', other.cookie).expect(404);
    // Nor through a listing of one's own.
    const mine = await listing(other.id);
    const through = photo.replace(id, mine);
    await http().get(through).set('Cookie', other.cookie).expect(404);
    await http().delete(through).set('Cookie', other.cookie).expect(404);
    expect(
      (await http().get(path).set('Cookie', other.cookie).expect(200)).body,
    ).toEqual({ photos: [] });
    expect(await photosOf(id)).toHaveLength(1);
  });

  it("refuses someone else's listing, and a visitor", async () => {
    const id = await listing();
    await upload(id, jpeg, other.cookie).expect(404);
    await upload(id, jpeg, '').expect(401);
    await upload(randomUUID()).expect(404);
    expect(await filesOf(id)).toEqual([]);
  });

  it('checks the content, not the name', async () => {
    const id = await listing();
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    await upload(id, html, owner.cookie, 'photo.jpg').expect(415);
    await upload(id, jpeg, owner.cookie, 'not-a-photo.exe').expect(201);
    expect(await photosOf(id)).toHaveLength(1);
  });

  it('refuses a file above 5 MB, several files, or none', async () => {
    const id = await listing();
    const tooBig = await upload(id, Buffer.alloc(5 * 1024 * 1024 + 1));
    expect([tooBig.status, tooBig.body]).toEqual([
      413,
      { message: 'Cette photo dépasse 5 Mo.' },
    ]);
    await upload(id)
      .attach('file', jpeg, 'two.jpg')
      .expect(/./)
      .expect((r) => {
        expect([400, 413]).toContain(r.status);
      });
    await upload(id, null).expect(400);
    expect(await photosOf(id)).toHaveLength(0);
  });

  it('refuses an upload without the Origin of the web app', async () => {
    const id = await listing();
    await http()
      .post(`/api/v1/pro/listings/${id}/media`)
      .set('Cookie', owner.cookie)
      .attach('file', jpeg, 'photo.jpg')
      .expect(415);
  });

  it('keeps six photos at most, even sent at the same time', async () => {
    const id = await listing();
    const responses = await Promise.all(
      Array.from({ length: 9 }, () => upload(id)),
    );
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 201, 201, 201, 201, 201, 422, 422, 422]);
    const rows = await photosOf(id);
    expect(rows).toHaveLength(6);
    expect(rows.filter((row) => row.is_cover)).toHaveLength(1);
    expect(rows.map((row) => row.display_order)).toEqual([0, 1, 2, 3, 4, 5]);
    // A refused photo leaves no file.
    expect(await filesOf(id)).toHaveLength(6);
  });

  it.each(['PENDING', 'PUBLISHED', 'SUSPENDED', 'ARCHIVED'] as const)(
    'changes nothing on a %s listing',
    async (status) => {
      const id = await listing();
      const body: unknown = (await upload(id).expect(201)).body;
      await db
        .updateTable('establishments')
        .set({
          publication_status: status,
          published_at: sql<Date>`now()`,
        })
        .where('id', '=', id)
        .execute();
      await upload(id).expect(409);
      const photoId = (body as { photo: { id: string } }).photo.id;
      await http()
        .delete(`/api/v1/pro/listings/${id}/media/${photoId}`)
        .set('Cookie', owner.cookie)
        .expect(409);
      expect(await photosOf(id)).toHaveLength(1);
    },
  );

  it('deletes a photo with its file; the next one becomes the cover', async () => {
    const id = await listing();
    await upload(id).expect(201);
    await upload(id).expect(201);
    const [first, second] = await photosOf(id);
    await http()
      .delete(`/api/v1/pro/listings/${id}/media/${first.id}`)
      .set('Cookie', owner.cookie)
      .expect(204);
    const left = await photosOf(id);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ id: second.id, is_cover: true });
    expect(await filesOf(id)).toEqual([second.storage_key.split('/')[1]]);
  });

  it('limits the uploads of one account (20 an hour)', async () => {
    const id = await listing();
    for (let index = 0; index < 20; index += 1) {
      await upload(id, Buffer.from('not a photo at all')).expect(415);
    }
    const response = await upload(id).expect(429);
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    await upload(await listing(other.id), jpeg, other.cookie).expect(201);
  });

  it('deletes the photos with the account, files included', async () => {
    const leaver = await signUp('96 20 00 03', '203.0.113.132');
    const id = await listing(leaver.id);
    await upload(id, jpeg, leaver.cookie).expect(201);
    expect(await filesOf(id)).toHaveLength(1);
    await http()
      .delete('/api/v1/auth/me')
      .set('Cookie', leaver.cookie)
      .send({ password })
      .expect(204);
    expect(await photosOf(id)).toEqual([]);
    expect(await filesOf(id)).toEqual([]);
  });
});
