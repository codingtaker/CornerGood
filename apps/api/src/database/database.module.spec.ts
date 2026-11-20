import { Logger } from '@nestjs/common';
import { checkDatabaseRole, createDatabasePool } from './database.module';

describe('checkDatabaseRole', () => {
  const poolAs = (powerful: boolean) => ({
    query: jest.fn().mockResolvedValue({
      rows: [{ role: powerful ? 'cornergood' : 'cornergood_app', powerful }],
    }),
  });

  it('accepts the least-privilege role', async () => {
    await expect(
      checkDatabaseRole(poolAs(false) as never, 'production'),
    ).resolves.toBeUndefined();
  });

  it('refuses a role with administrative rights in production', async () => {
    await expect(
      checkDatabaseRole(poolAs(true) as never, 'production'),
    ).rejects.toThrow(
      'The API connects to the database as "cornergood", a role with administrative rights.',
    );
  });

  it('only warns elsewhere, so a fresh local setup still starts', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    await expect(
      checkDatabaseRole(poolAs(true) as never, 'development'),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

describe('createDatabasePool', () => {
  it('keeps the process alive when an idle connection is lost', async () => {
    const logSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const pool = createDatabasePool('postgres://user:pass@localhost:5432/db');

    // An EventEmitter without an 'error' listener throws on emit:
    // this is what used to crash the API.
    expect(() =>
      pool.emit('error', new Error('terminating connection'), undefined),
    ).not.toThrow();
    expect(logSpy).toHaveBeenCalledWith(
      'Idle database connection lost: terminating connection',
    );

    logSpy.mockRestore();
    await pool.end();
  });
});
