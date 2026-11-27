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
  PublicationStatus,
  UserRole,
  VerificationStatus,
} from '../../src/database/database.types';
import { createKysely } from '../../src/database/kysely';
import { runMigrations } from '../../src/database/migrator';
import { seedReferenceData } from '../../src/database/seeder';
import {
  assertDisposableConnectedDatabase,
  assertDisposableTestDatabaseUrl,
} from './test-database-guard';

/*
 * Reports (ADR-017, ADR-018, contract §4.2 and §6.5), over HTTP on the real
 * application and the least-privilege role: anyone may report a published
 * listing; the team takes, resolves or dismisses; the listing itself never
 * changes, except a VERIFIED one that loses its seal until checked again.
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

describeWithDatabase('reports', () => {
  const origin = process.env.WEB_ORIGIN as string;
  let pool: Pool;
  let db: Kysely<Database>;
  let app: INestApplication<App>;
  let categoryId: string;
  let ownerId: string;
  let pro: Account;
  let moderator: Account;
  let ipCounter = 0;
  const http = () => request(app.getHttpServer());
  /** A new address each time, so the limit of 5 per address stays out. */
  const nextIp = () => `198.51.100.${(ipCounter += 1)}`;

  async function account(role: UserRole, phone: string): Promise<Account> {
    const password = `mot de passe ${role.toLowerCase()} rapports`;
    const { id } = await db
      .insertInto('users')
      .values({
        full_name: role === 'MODERATOR' ? 'Modo Ama' : 'Pro Kossi',
        phone: `+228${phone}`,
        password_hash: await hashPassword(password),
        role,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const response = await http()
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ phone, password })
      .expect(200);
    const header = response.headers['set-cookie'] as unknown as string[];
    return { id, cookie: header[0].split(';')[0] };
  }

  async function listing(
    status: PublicationStatus = 'PUBLISHED',
    verification: VerificationStatus = 'UNVERIFIED',
  ): Promise<{ id: string; slug: string }> {
    const slug = `fiche-${randomUUID().slice(0, 8)}`;
    const { id } = await db
      .insertInto('establishments')
      .values({
        owner_id: ownerId,
        created_by_id: ownerId,
        category_id: categoryId,
        entity_type: 'BUSINESS',
        name: 'Atelier signalé',
        slug,
        description: 'Réparation.',
        phone: '+22890000001',
        publication_status: status,
        verification_status: verification,
        published_at: status === 'PUBLISHED' ? sql<Date>`now()` : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { id, slug };
  }

  const report = (slug: string, body: object, ip = nextIp()) =>
    http()
      .post(`/api/v1/listings/${slug}/reports`)
      .set('Origin', origin)
      .set('X-Forwarded-For', ip)
      .send(body);
  const valid = {
    reason: 'CLOSED',
    description: "L'atelier a fermé le mois dernier.",
    reporterContact: '91 23 45 67',
  };
  const admin = (path: string, as: Account | null, body?: object) => {
    const call = http()
      .post(`/api/v1/admin/reports/${path}`)
      .set('Cookie', as?.cookie ?? '')
      .set('Origin', origin);
    return body ? call.send(body) : call;
  };
  const reportsOf = (listingId: string) =>
    db
      .selectFrom('reports')
      .selectAll()
      .where('establishment_id', '=', listingId)
      .execute();
  const listingRow = (id: string) =>
    db
      .selectFrom('establishments')
      .select(['publication_status', 'verification_status'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  async function openReport(): Promise<{ listingId: string; id: string }> {
    const { id: listingId, slug } = await listing();
    const response = await report(slug, valid).expect(201);
    return { listingId, id: (response.body as { id: string }).id };
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
    categoryId = (
      await db
        .selectFrom('categories')
        .select('id')
        .where('slug', '=', 'reparation')
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

    pro = await account('PROFESSIONAL', '96600001');
    ownerId = pro.id;
    moderator = await account('MODERATOR', '96600002');
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('from the public page', () => {
    it('lets a visitor without an account report a published listing', async () => {
      const { id, slug } = await listing();
      const response = await report(slug, valid).expect(201);
      expect(response.body).toEqual({ id: expect.any(String) as string });
      expect(await reportsOf(id)).toMatchObject([
        {
          reason: 'CLOSED',
          description: "L'atelier a fermé le mois dernier.",
          reporter_contact: '91 23 45 67',
          reporter_id: null,
          status: 'OPEN',
          handled_by_id: null,
        },
      ]);
    });

    it('takes the seal off a verified listing until it is checked again (ADR-018)', async () => {
      const verified = await listing('PUBLISHED', 'VERIFIED');
      await report(verified.slug, valid).expect(201);
      expect(await listingRow(verified.id)).toEqual({
        publication_status: 'PUBLISHED',
        verification_status: 'VERIFICATION_PENDING',
      });
      const plain = await listing();
      await report(plain.slug, valid).expect(201);
      expect((await listingRow(plain.id)).verification_status).toBe(
        'UNVERIFIED',
      );
    });

    it.each(['DRAFT', 'PENDING', 'REJECTED', 'SUSPENDED', 'ARCHIVED'] as const)(
      'answers 404 for a listing %s, and stores nothing',
      async (status) => {
        const { id, slug } = await listing(status);
        await report(slug, valid).expect(404);
        expect(await reportsOf(id)).toEqual([]);
      },
    );

    it('explains a wrong report, and stores nothing', async () => {
      const { id, slug } = await listing();
      for (const [body, field] of [
        [{ ...valid, reason: 'PAS_UNE_RAISON' }, 'reason'],
        [{ ...valid, description: '   ' }, 'description'],
        [{ ...valid, description: 'x'.repeat(1001) }, 'description'],
        [{ ...valid, reporterContact: 'x'.repeat(121) }, 'reporterContact'],
      ] as const) {
        const refused = await report(slug, body).expect(400);
        expect(refused.body).toHaveProperty(['fields', field]);
      }
      expect(await reportsOf(id)).toEqual([]);
    });

    it('limits one address to 5 reports an hour', async () => {
      const { slug } = await listing();
      const ip = '198.51.100.250';
      for (let i = 0; i < 5; i += 1) await report(slug, valid, ip).expect(201);
      const blocked = await report(slug, valid, ip).expect(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      await report(slug, valid, '198.51.100.251').expect(201);
    });

    it('never shows the contact on the public page', async () => {
      const { slug } = await listing();
      await report(slug, valid).expect(201);
      const page = await http().get(`/api/v1/listings/${slug}`).expect(200);
      expect(JSON.stringify(page.body)).not.toContain('91 23 45 67');
    });
  });

  describe('in the back-office', () => {
    it('is closed to professionals and to visitors', async () => {
      await http()
        .get('/api/v1/admin/reports')
        .set('Cookie', pro.cookie)
        .expect(403);
      await http().get('/api/v1/admin/reports').expect(401);
      const { id } = await openReport();
      await admin(`${id}/take`, pro).expect(403);
    });

    it('lists open reports first, and shows the private contact', async () => {
      const { id } = await openReport();
      const list = await http()
        .get('/api/v1/admin/reports?status=OPEN')
        .set('Cookie', moderator.cookie)
        .expect(200);
      const reports = (
        list.body as { reports: { id: string; status: string }[] }
      ).reports;
      expect(reports.some((item) => item.id === id)).toBe(true);
      expect(reports.every((item) => item.status === 'OPEN')).toBe(true);

      const detail = await http()
        .get(`/api/v1/admin/reports/${id}`)
        .set('Cookie', moderator.cookie)
        .expect(200);
      expect(detail.body).toMatchObject({
        report: {
          id,
          status: 'OPEN',
          reporterContact: '91 23 45 67',
          listing: { name: 'Atelier signalé', status: 'PUBLISHED' },
        },
      });
      await http()
        .get(`/api/v1/admin/reports/${randomUUID()}`)
        .set('Cookie', moderator.cookie)
        .expect(404);
    });

    it('takes a report once', async () => {
      const { id } = await openReport();
      const taken = await admin(`${id}/take`, moderator).expect(200);
      expect(taken.body).toMatchObject({
        report: { status: 'IN_REVIEW', handledBy: 'Modo Ama' },
      });
      const again = await admin(`${id}/take`, moderator).expect(409);
      expect(again.body).toMatchObject({ code: 'INVALID_STATE' });
    });

    it('closes a report with a note, once, and never touches the listing', async () => {
      const { listingId, id } = await openReport();
      for (const body of [{}, { note: '  ' }, { note: 'x'.repeat(1001) }]) {
        const refused = await admin(`${id}/resolve`, moderator, body).expect(
          422,
        );
        expect(refused.body).toMatchObject({ code: 'NOTE_REQUIRED' });
      }
      await admin(`${id}/take`, moderator).expect(200);
      const resolved = await admin(`${id}/resolve`, moderator, {
        note: 'Appelé : fermé pour travaux, rouvre lundi.',
      }).expect(200);
      expect(resolved.body).toMatchObject({
        report: {
          status: 'RESOLVED',
          resolutionNote: 'Appelé : fermé pour travaux, rouvre lundi.',
          handledBy: 'Modo Ama',
          resolvedAt: expect.any(String) as string,
        },
      });
      await admin(`${id}/dismiss`, moderator, { note: 'Encore' }).expect(409);
      await admin(`${id}/take`, moderator).expect(409);
      expect(await listingRow(listingId)).toEqual({
        publication_status: 'PUBLISHED',
        verification_status: 'UNVERIFIED',
      });
    });

    it('dismisses an open report directly', async () => {
      const { id } = await openReport();
      await admin(`${id}/dismiss`, moderator, {
        note: 'Signalement sans rapport avec la fiche.',
      }).expect(200);
      const row = await db
        .selectFrom('reports')
        .select(['status', 'handled_by_id', 'resolved_at'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({
        status: 'DISMISSED',
        handled_by_id: moderator.id,
      });
      expect(row.resolved_at).toBeInstanceOf(Date);
    });

    it('closes a report once when two people close it at once', async () => {
      const { id } = await openReport();
      // The row is held while both requests arrive, so they really overlap.
      const held = await db.transaction().execute(async (trx) => {
        await trx
          .selectFrom('reports')
          .select('id')
          .where('id', '=', id)
          .forUpdate()
          .execute();
        const answers = Promise.all(
          ['Fermé.', 'Doublon.'].map((note) =>
            admin(`${id}/dismiss`, moderator, { note }).then((r) => r.status),
          ),
        );
        await new Promise((resolve) => setTimeout(resolve, 1500));
        // In an object: returned as is, it would be awaited inside the lock.
        return { answers };
      });
      // Without the API's own lock, both would read OPEN and both succeed.
      expect((await held.answers).sort()).toEqual([200, 409]);
    });
  });

  describe('schema (migration 0009)', () => {
    it('requires a note to close a report, and a handler once taken', async () => {
      const { id } = await openReport();
      await expect(
        sql`UPDATE reports SET status = 'RESOLVED', resolved_at = now(),
              handled_by_id = ${moderator.id} WHERE id = ${id}`.execute(db),
      ).rejects.toThrow(/closed_report_has_note/);
      await expect(
        sql`UPDATE reports SET status = 'IN_REVIEW' WHERE id = ${id}`.execute(
          db,
        ),
      ).rejects.toThrow(/handled_report_has_handler/);
    });
  });
});
