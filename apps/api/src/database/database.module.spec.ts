import { Logger } from '@nestjs/common';
import { createDatabasePool } from './database.module';

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
