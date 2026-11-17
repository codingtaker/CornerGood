import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DATABASE_POOL } from '../database/database.module';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const query = jest.fn();
  let controller: HealthController;

  beforeEach(async () => {
    query.mockReset();
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DATABASE_POOL, useValue: { query } }],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('reports the PostGIS version when the database answers', async () => {
    query.mockResolvedValue({ rows: [{ version: '3.4.2' }] });

    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      database: 'ok',
      postgisVersion: '3.4.2',
    });
  });

  it('answers 503 without exposing the error when the database is down', async () => {
    query.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5432'));

    const failure = controller.check();

    await expect(failure).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(failure).rejects.toMatchObject({
      response: { status: 'error', database: 'unavailable' },
    });
  });
});
