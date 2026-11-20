import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Kysely, sql } from 'kysely';
import { Pool } from 'pg';
import request from 'supertest';
import { App } from 'supertest/types';
import { createFirstAdmin } from '../../src/admin/first-admin';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import {
  createDatabasePool,
  DATABASE_POOL,
} from '../../src/database/database.module';
import { Database } from '../../src/database/database.types';
import { createKysely } from '../../src/database/kysely';
import { runMigrations } from '../../src/database/migrator';
import {
  assertDisposableConnectedDatabase,
  assertDisposableTestDatabaseUrl,
} from './test-database-guard';

/*
 * Sprint S2 acceptance, through HTTP on the real application and a real
 * database: a professional creates an account and signs in; /admin refuses
 * them. Same guard as schema.db-spec.ts: the public schema is wiped.
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (process.env.CI && !testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required in CI');
}
if (testDatabaseUrl) {
  assertDisposableTestDatabaseUrl(testDatabaseUrl, process.env.DATABASE_URL);
}
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const COOKIE = 'cg_session';

function sessionCookie(response: request.Response): string {
  const header = response.headers['set-cookie'] as unknown as
    string[] | undefined;
  const cookie = header?.find((value) => value.startsWith(`${COOKIE}=`));
  if (!cookie) throw new Error('No session cookie in the response');
  return cookie.split(';')[0];
}

describeWithDatabase('accounts, sessions and roles (S2)', () => {
  let pool: Pool; // owner: sets up and inspects the database
  let appPool: Pool; // API
  let db: Kysely<Database>;
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());

  const professional = {
    fullName: 'Kossi Mensah',
    phone: '90 12 34 56',
    password: 'mon mot de passe',
  };

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

    // The API runs as the least-privilege role, as in production: every test
    // below also proves that its grants are enough (migration 0003).
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
  });

  afterAll(async () => {
    await app.close(); // also ends appPool (DatabaseModule shutdown hook)
    await pool.end();
  });

  it('runs the API as cornergood_app', async () => {
    const { rows } = await appPool.query<{ role: string }>(
      'SELECT current_user AS role',
    );
    expect(rows[0].role).toBe('cornergood_app');
  });

  describe('the sprint scenario', () => {
    let cookie: string;

    it('lets a professional create an account, signed in at once', async () => {
      const response = await http()
        .post('/api/v1/auth/register')
        // A sign-up form cannot choose its role.
        .send({ ...professional, role: 'ADMIN' })
        .expect(201);

      expect(response.body).toEqual({
        user: {
          id: expect.any(String) as string,
          role: 'PROFESSIONAL',
          fullName: 'Kossi Mensah',
        },
      });
      const header = (response.headers['set-cookie'] as unknown as string[])[0];
      expect(header).toMatch(/HttpOnly/i);
      expect(header).toMatch(/SameSite=Lax/i);
      cookie = sessionCookie(response);

      const stored = await db
        .selectFrom('users')
        .select(['phone', 'role'])
        .executeTakeFirstOrThrow();
      expect(stored).toEqual({ phone: '+22890123456', role: 'PROFESSIONAL' });
    });

    it('opens the professional space', async () => {
      await http()
        .get('/api/v1/auth/me')
        .set('Cookie', cookie)
        .expect(200)
        .expect((response) => {
          expect((response.body as { user: { role: string } }).user.role).toBe(
            'PROFESSIONAL',
          );
        });
      await http()
        .get('/api/v1/pro/listings')
        .set('Cookie', cookie)
        .expect(200, { listings: [] });
    });

    it('refuses /admin to the professional', async () => {
      await http()
        .get('/api/v1/admin/overview')
        .set('Cookie', cookie)
        .expect(403, {
          message: "Vous n'avez pas accès à cet espace.",
        });
    });

    it('signs out: the old cookie no longer opens anything', async () => {
      await http()
        .post('/api/v1/auth/logout')
        .set('Cookie', cookie)
        .expect(204);
      await http().get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
      await http()
        .get('/api/v1/pro/listings')
        .set('Cookie', cookie)
        .expect(401);
    });

    it('signs in again with the phone written another way', async () => {
      const response = await http()
        .post('/api/v1/auth/login')
        .send({ phone: '+228 90.12.34.56', password: professional.password })
        .expect(200);
      cookie = sessionCookie(response);
      await http().get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
      const { last_login_at } = await db
        .selectFrom('users')
        .select('last_login_at')
        .executeTakeFirstOrThrow();
      expect(last_login_at).not.toBeNull();
    });
  });

  describe('sign-in failures', () => {
    const failed = { message: 'Numéro ou mot de passe incorrect.' };

    it('gives one answer for a wrong password, an unknown number or bad input', async () => {
      await http()
        .post('/api/v1/auth/login')
        .send({ phone: professional.phone, password: 'pas le bon' })
        .expect(401)
        .expect((response) => expect(response.body).toMatchObject(failed));
      await http()
        .post('/api/v1/auth/login')
        .send({ phone: '91 00 00 00', password: professional.password })
        .expect(401)
        .expect((response) => expect(response.body).toMatchObject(failed));
      await http()
        .post('/api/v1/auth/login')
        .send({ phone: 'abc' })
        .expect(401)
        .expect((response) => expect(response.body).toMatchObject(failed));
    });

    it('refuses a deactivated account and closes its open sessions', async () => {
      const response = await http()
        .post('/api/v1/auth/login')
        .send(professional)
        .expect(200);
      const cookie = sessionCookie(response);
      await db.updateTable('users').set({ is_active: false }).execute();

      await http().get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
      await http().post('/api/v1/auth/login').send(professional).expect(401);
      await db.updateTable('users').set({ is_active: true }).execute();
    });

    it('refuses an expired session', async () => {
      const response = await http()
        .post('/api/v1/auth/login')
        .send(professional)
        .expect(200);
      await db
        .updateTable('sessions')
        .set({ expires_at: sql<Date>`created_at + interval '1 second'` })
        .execute();
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await http()
        .get('/api/v1/auth/me')
        .set('Cookie', sessionCookie(response))
        .expect(401);
    });
  });

  describe('sign-up checks', () => {
    it('refuses a number that already has an account', async () => {
      await http()
        .post('/api/v1/auth/register')
        .send({ ...professional, fullName: 'Autre Personne' })
        .expect(409)
        .expect((response) =>
          expect(response.body).toMatchObject({ field: 'phone' }),
        );
    });

    it('reports every invalid field at once', async () => {
      await http()
        .post('/api/v1/auth/register')
        .send({ fullName: 'K', phone: '123', email: 'x', password: 'court' })
        .expect(400)
        .expect((response) => {
          expect(
            Object.keys((response.body as { fields: object }).fields).sort(),
          ).toEqual(['email', 'fullName', 'password', 'phone']);
        });
    });
  });

  describe('protected routes', () => {
    it('answer 401 without a session', async () => {
      await http().get('/api/v1/pro/listings').expect(401);
      await http().get('/api/v1/admin/overview').expect(401);
      await http()
        .get('/api/v1/admin/overview')
        .set('Cookie', `${COOKIE}=forged-token`)
        .expect(401);
    });

    it('open /admin to an administrator', async () => {
      await createFirstAdmin(db, {
        fullName: 'Afi Kouma',
        phone: '+22890000099',
        email: null,
        password: 'mot de passe administrateur',
      });
      const response = await http()
        .post('/api/v1/auth/login')
        .send({ phone: '90000099', password: 'mot de passe administrateur' })
        .expect(200);
      await http()
        .get('/api/v1/admin/overview')
        .set('Cookie', sessionCookie(response))
        .expect(200, { professionals: 1, pendingListings: 0 });
    });
  });
});
