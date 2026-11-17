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
});
