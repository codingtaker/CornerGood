import {
  assertDisposableConnectedDatabase,
  assertDisposableTestDatabaseUrl,
} from './test-database-guard';

// Pure checks: these run even when no TEST_DATABASE_URL is set.
describe('test database guard', () => {
  const app = 'postgres://cornergood:secret@localhost:5433/cornergood';

  it('accepts a dedicated *_test database', () => {
    expect(() =>
      assertDisposableTestDatabaseUrl(
        'postgres://cornergood:secret@localhost:5433/cornergood_test',
        app,
      ),
    ).not.toThrow();
  });

  it.each([
    ['the application database', 'postgres://u:p@localhost:5433/cornergood'],
    ['a name that only contains "test"', 'postgres://u:p@localhost/test_data'],
    ['a URL without a database name', 'postgres://u:p@localhost:5433'],
    ['a URL with an empty database name', 'postgres://u:p@localhost:5433/'],
  ])('rejects %s', (_label, url) => {
    expect(() => assertDisposableTestDatabaseUrl(url, app)).toThrow(
      /Refusing to run/,
    );
  });

  it('rejects an invalid URL', () => {
    expect(() => assertDisposableTestDatabaseUrl('not a url')).toThrow(
      /not a valid URL/,
    );
  });

  it('rejects a *_test URL equal to DATABASE_URL', () => {
    const same = 'postgres://u:p@localhost:5432/shared_test';
    expect(() => assertDisposableTestDatabaseUrl(same, same)).toThrow(
      /same database as DATABASE_URL/,
    );
    // The default port counts as 5432.
    expect(() =>
      assertDisposableTestDatabaseUrl(
        'postgres://u:p@localhost/shared_test',
        same,
      ),
    ).toThrow(/same database as DATABASE_URL/);
  });

  it('accepts the same *_test name on another server', () => {
    expect(() =>
      assertDisposableTestDatabaseUrl(
        'postgres://u:p@localhost:5433/shared_test',
        'postgres://u:p@localhost:5432/shared_test',
      ),
    ).not.toThrow();
  });

  it('checks the database the server reports once connected', () => {
    expect(() =>
      assertDisposableConnectedDatabase('cornergood_test'),
    ).not.toThrow();
    expect(() => assertDisposableConnectedDatabase('cornergood')).toThrow(
      /Refusing to run/,
    );
  });
});
