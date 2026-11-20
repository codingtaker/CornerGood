import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { DATABASE_POOL } from '../src/database/database.module';

// Boots the real application module with a stubbed database pool,
// so routing, global prefix and configuration are tested without PostgreSQL.
describe('API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE_POOL)
      .useValue({
        query: () => Promise.resolve({ rows: [{ version: '3.4.2' }] }),
        end: () => Promise.resolve(),
      })
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health answers 200', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect({ status: 'ok', database: 'ok', postgisVersion: '3.4.2' });
  });

  it('unknown routes answer 404', () => {
    return request(app.getHttpServer()).get('/api/v1/unknown').expect(404);
  });

  // Code review of 2026-11-20, medium point: security headers.
  it.each([
    ['an answer', '/api/v1/health'],
    ['an error', '/api/v1/unknown'],
  ])(
    'sends the security headers with %s, and no X-Powered-By',
    async (_kind, path) => {
      const response = await request(app.getHttpServer()).get(path);
      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.headers).toMatchObject({
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
        'referrer-policy': 'no-referrer',
        'cache-control': 'no-store',
      });
    },
  );

  // Code review of 2026-11-20, point 3: what another site's HTML form can send
  // never reaches the sign-in (login CSRF).
  describe('requests from another site', () => {
    it('refuses a sign-in posted as an HTML form', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .type('form')
        .send({ phone: '90123456', password: 'x' })
        .expect(415, { message: 'Le corps de la requête doit être du JSON.' });
    });

    it('refuses JSON sent by a page of another site', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', 'https://evil.example')
        .send({ phone: '90123456', password: 'x' })
        .expect(403, {
          message: 'Requête refusée : elle ne vient pas de CornerGood.',
        });
    });

    it('lets the web app sign out (a POST without a body)', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Origin', process.env.WEB_ORIGIN as string)
        .set('Sec-Fetch-Site', 'same-origin')
        .expect(204);
    });
  });
});
