import { Kysely } from 'kysely';
import { assertMigrationAllowed, runMigrations } from './migrator';

describe('assertMigrationAllowed', () => {
  it('refuses to revert a migration in production', () => {
    expect(() => assertMigrationAllowed('down', 'production')).toThrow(
      'Refusing to revert a migration in production',
    );
  });

  it.each([['development'], ['test'], [undefined]])(
    'allows reverting when NODE_ENV is %s',
    (nodeEnv) => {
      expect(() => assertMigrationAllowed('down', nodeEnv)).not.toThrow();
    },
  );

  it('always allows applying migrations', () => {
    expect(() => assertMigrationAllowed('latest', 'production')).not.toThrow();
  });
});

describe('runMigrations', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('refuses to go down in production before touching the database', () => {
    process.env.NODE_ENV = 'production';
    // Any use of the database would fail: the guard must run first.
    const db = {} as Kysely<unknown>;
    expect(() => runMigrations(db, 'down')).toThrow(
      'Refusing to revert a migration in production',
    );
  });
});
