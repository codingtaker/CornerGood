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
import { SMS_SENDER, SmsSender } from '../../src/sms/sms.module';

/** Keeps the SMS in memory instead of sending them. */
class FakeSms implements SmsSender {
  readonly sent: { to: string; text: string }[] = [];
  send(to: string, text: string): Promise<void> {
    this.sent.push({ to, text });
    return Promise.resolve();
  }
  /** The code of the last SMS to `to`, waiting a little: it is sent in the background. */
  async codeFor(to: string): Promise<string> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const last = [...this.sent].reverse().find((sms) => sms.to === to);
      const code = last && /\b(\d{6})\b/.exec(last.text)?.[1];
      if (code) return code;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`No SMS sent to ${to}`);
  }
}
const sms = new FakeSms();
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
      .overrideProvider(SMS_SENDER)
      .useValue(sms)
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

  // Code review of 2026-11-20, point 2. Requests come from the loopback, which
  // is a trusted proxy (TRUST_PROXY default), so X-Forwarded-For sets the
  // visitor's address, as the web app does.
  describe('sign-in limits', () => {
    const login = (from: string, phone: string, password: string) =>
      http()
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', from)
        .send({ phone, password });
    const expireBlock = (key: string) =>
      db
        .updateTable('auth_throttle')
        .set({ blocked_until: sql<Date>`now() - interval '1 second'` })
        .where('key', '=', key)
        .execute();
    const blockLeft = async (key: string) =>
      (
        await db
          .selectFrom('auth_throttle')
          .select(
            sql<number>`extract(epoch FROM blocked_until - now())::int`.as(
              'seconds',
            ),
          )
          .where('key', '=', key)
          .executeTakeFirstOrThrow()
      ).seconds;

    const victim = { phone: '91 11 11 11', password: 'le bon mot de passe' };
    const phoneKey = 'login:phone:+22891111111';

    beforeAll(async () => {
      await http()
        .post('/api/v1/auth/register')
        .set('X-Forwarded-For', '203.0.113.10')
        .send({ ...victim, fullName: 'Ama Victime' })
        .expect(201);
    });

    it('blocks a number after 5 wrong passwords, even with the right one, from any address', async () => {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        await login('203.0.113.11', victim.phone, `faux-${attempt}`).expect(
          401,
        );
      }

      const started = performance.now();
      const blocked = await login(
        '203.0.113.11',
        victim.phone,
        victim.password,
      ).expect(429);
      // Refused before the password is hashed: a blocked client costs nothing.
      expect(performance.now() - started).toBeLessThan(100);
      expect(blocked.body).toEqual({
        message: 'Trop de tentatives. Réessayez dans 1 minute.',
        retryAfterSeconds: expect.any(Number) as number,
        // The form may offer a code by SMS instead of waiting.
        unlockBySms: true,
      });
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(50);

      await login('198.51.100.20', victim.phone, victim.password).expect(429);
    });

    it('doubles the block on each further failure', async () => {
      await expireBlock(phoneKey);
      await login('203.0.113.11', victim.phone, 'faux-6').expect(401);
      expect(await blockLeft(phoneKey)).toBeGreaterThan(110); // 2 minutes
    });

    it('lets the right password in once the block is over, and clears the count', async () => {
      await expireBlock(phoneKey);
      await login('203.0.113.11', victim.phone, victim.password).expect(200);
      const left = await db
        .selectFrom('auth_throttle')
        .select('key')
        .where('key', '=', phoneKey)
        .execute();
      expect(left).toEqual([]);
    });

    it('blocks an address after 30 failures across numbers, and only that address', async () => {
      await db
        .insertInto('auth_throttle')
        .values({
          key: 'login:ip:198.51.100.7',
          failures: 29,
          window_started_at: sql<Date>`now()`,
        })
        .execute();
      await login('198.51.100.7', '92 00 00 01', 'x').expect(401); // 30th
      await login('198.51.100.7', '92 00 00 02', 'x').expect(429);
      await login('198.51.100.8', '92 00 00 03', 'x').expect(401);
    });

    it('limits sign-ups per address, failed ones included', async () => {
      await db
        .insertInto('auth_throttle')
        .values({
          key: 'register:ip:198.51.100.9',
          failures: 9,
          window_started_at: sql<Date>`now()`,
        })
        .execute();
      await http()
        .post('/api/v1/auth/register')
        .set('X-Forwarded-For', '198.51.100.9')
        .send({})
        .expect(400); // 10th attempt
      await http()
        .post('/api/v1/auth/register')
        .set('X-Forwarded-For', '198.51.100.9')
        .send({
          fullName: 'Nouveau',
          phone: '93 00 00 01',
          password: 'x'.repeat(10),
        })
        .expect(429);
    });

    // Through a trusted proxy, the address that counts is the one the proxy
    // saw: the rightmost untrusted entry. One a visitor writes into the header
    // themself ("6.6.6.6") is ignored, so they cannot escape the limit.
    it('counts the address the proxy saw, not one the visitor made up', async () => {
      await login('6.6.6.6, 203.0.113.40', '96 00 00 01', 'x').expect(401);
      const keys = await db
        .selectFrom('auth_throttle')
        .select('key')
        .where('key', 'like', 'login:ip:%')
        .where('key', 'in', ['login:ip:6.6.6.6', 'login:ip:203.0.113.40'])
        .execute();
      expect(keys).toEqual([{ key: 'login:ip:203.0.113.40' }]);
    });

    it('starts counting again once the window is over', async () => {
      await db
        .insertInto('auth_throttle')
        .values({
          key: 'login:phone:+22894000000',
          failures: 4,
          window_started_at: sql<Date>`now() - interval '25 hours'`,
        })
        .execute();
      await login('203.0.113.30', '94 00 00 00', 'x').expect(401);
      const { failures } = await db
        .selectFrom('auth_throttle')
        .select('failures')
        .where('key', '=', 'login:phone:+22894000000')
        .executeTakeFirstOrThrow();
      expect(failures).toBe(1);
    });
  });

  // Codes by SMS (decided on 2026-11-20): they lift a sign-in block and reset
  // a forgotten password.
  describe('codes by SMS', () => {
    const owner = { phone: '97 00 00 01', password: 'mot de passe initial' };
    const e164 = '+22897000001';
    const from = (ip: string) => ({ 'X-Forwarded-For': ip });
    const requestCode = (
      phone: string,
      purpose: string,
      ip = '203.0.113.60',
    ) => {
      // The SMS leaves in the background: forget the older ones, so codeFor()
      // waits for this one instead of returning a previous code.
      sms.sent.length = 0;
      return http()
        .post('/api/v1/auth/otp')
        .set(from(ip))
        .send({ phone, purpose });
    };
    /** Lets the next request for a code through at once. */
    const forgetOtpLimits = () =>
      db.deleteFrom('auth_throttle').where('key', 'like', 'otp:%').execute();
    const otherThan = (code: string) =>
      code === '000000' ? '111111' : '000000';

    beforeAll(async () => {
      await http()
        .post('/api/v1/auth/register')
        .set(from('203.0.113.61'))
        .send({ ...owner, fullName: 'Kodjo Proprio' })
        .expect(201);
    });
    beforeEach(forgetOtpLimits);

    it('answers the same with or without an account, and only texts the account', async () => {
      const withAccount = await requestCode(
        owner.phone,
        'PASSWORD_RESET',
      ).expect(202);
      const code = await sms.codeFor(e164);
      expect(code).toMatch(/^\d{6}$/);
      expect(sms.sent.at(-1)?.text).toContain(
        'votre code pour changer votre mot de passe est',
      );

      const without = await requestCode(
        '97 00 00 09',
        'PASSWORD_RESET',
        '203.0.113.62',
      ).expect(202);
      expect(without.body).toEqual(withAccount.body);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(sms.sent.some((message) => message.to === '+22897000009')).toBe(
        false,
      );
    });

    it('only texts Togolese numbers', async () => {
      await requestCode('+33 6 12 34 56 78', 'PASSWORD_RESET').expect(400);
    });

    it('makes a number wait before a new code', async () => {
      await requestCode(owner.phone, 'LOGIN_UNLOCK').expect(202);
      await requestCode(owner.phone, 'LOGIN_UNLOCK', '198.51.100.61').expect(
        429,
      );
    });

    it('lets the owner of a blocked number in with the code, not without', async () => {
      await db
        .insertInto('auth_throttle')
        .values({
          key: `login:phone:${e164}`,
          failures: 5,
          window_started_at: sql<Date>`now()`,
          blocked_until: sql<Date>`now() + interval '1 hour'`,
        })
        .onConflict((oc) =>
          oc.column('key').doUpdateSet({
            blocked_until: sql<Date>`now() + interval '1 hour'`,
          }),
        )
        .execute();
      const login = (extra: object = {}) =>
        http()
          .post('/api/v1/auth/login')
          .set(from('203.0.113.63'))
          .send({ ...owner, ...extra });

      const blocked = await login().expect(429);
      expect(blocked.body).toMatchObject({ unlockBySms: true });

      await requestCode(owner.phone, 'LOGIN_UNLOCK').expect(202);
      const code = await sms.codeFor(e164);
      await login({ code: otherThan(code) }).expect(400, {
        message: 'Code incorrect ou expiré.',
        field: 'code',
      });
      await login({ code }).expect(200);

      // The block is gone, and the code cannot be used twice.
      const rows = await db
        .selectFrom('auth_throttle')
        .select('key')
        .where('key', '=', `login:phone:${e164}`)
        .execute();
      expect(rows).toEqual([]);
      const reused = await db
        .selectFrom('otp_codes')
        .select('consumed_at')
        .where('purpose', '=', 'LOGIN_UNLOCK')
        .orderBy('created_at', 'desc')
        .executeTakeFirstOrThrow();
      expect(reused.consumed_at).not.toBeNull();
    });

    it('resets a forgotten password and signs out every other session', async () => {
      const before = await http()
        .post('/api/v1/auth/login')
        .set(from('203.0.113.64'))
        .send(owner)
        .expect(200);
      const oldCookie = sessionCookie(before);

      await requestCode(owner.phone, 'PASSWORD_RESET').expect(202);
      const code = await sms.codeFor(e164);
      const reset = await http()
        .post('/api/v1/auth/password-reset')
        .set(from('203.0.113.64'))
        .send({ phone: owner.phone, code, password: 'nouveau mot de passe' })
        .expect(200);

      await http()
        .get('/api/v1/auth/me')
        .set('Cookie', sessionCookie(reset))
        .expect(200);
      await http().get('/api/v1/auth/me').set('Cookie', oldCookie).expect(401);
      await http()
        .post('/api/v1/auth/login')
        .set(from('203.0.113.64'))
        .send(owner)
        .expect(401);
      await http()
        .post('/api/v1/auth/login')
        .set(from('203.0.113.64'))
        .send({ phone: owner.phone, password: 'nouveau mot de passe' })
        .expect(200);
      owner.password = 'nouveau mot de passe';
    });

    it('stops a code after 5 wrong tries, even before it expires', async () => {
      await requestCode(owner.phone, 'PASSWORD_RESET').expect(202);
      const code = await sms.codeFor(e164);
      const reset = (tried: string) =>
        http()
          .post('/api/v1/auth/password-reset')
          .set(from('203.0.113.65'))
          .send({
            phone: owner.phone,
            code: tried,
            password: 'encore un autre',
          });
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await reset(otherThan(code)).expect(400);
      }
      await reset(code).expect(400);
    });

    it('refuses an expired code', async () => {
      await requestCode(owner.phone, 'PASSWORD_RESET').expect(202);
      const code = await sms.codeFor(e164);
      await sql`
        UPDATE otp_codes SET created_at = now() - interval '20 minutes',
          expires_at = now() - interval '10 minutes'
        WHERE consumed_at IS NULL
      `.execute(db);
      await http()
        .post('/api/v1/auth/password-reset')
        .set(from('203.0.113.66'))
        .send({ phone: owner.phone, code, password: 'encore un autre' })
        .expect(400);
    });

    it('stores only a keyed hash of the code', async () => {
      await requestCode(owner.phone, 'PASSWORD_RESET').expect(202);
      const code = await sms.codeFor(e164);
      const row = await db
        .selectFrom('otp_codes')
        .select('code_hash')
        .where('consumed_at', 'is', null)
        .executeTakeFirstOrThrow();
      expect(row.code_hash.length).toBe(32);
      expect(row.code_hash.toString('latin1')).not.toContain(code);
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
      const { total } = await db
        .selectFrom('users')
        .select((eb) => eb.fn.countAll<string>().as('total'))
        .where('role', '=', 'PROFESSIONAL')
        .executeTakeFirstOrThrow();
      await http()
        .get('/api/v1/admin/overview')
        .set('Cookie', sessionCookie(response))
        .expect(200, { professionals: Number(total), pendingListings: 0 });
    });
  });
});
