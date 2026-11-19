/*
 * The schema tests wipe the public schema of the database they run against.
 * These checks make sure that database is a disposable one, so a wrong
 * TEST_DATABASE_URL can never destroy real data.
 */

const TEST_DATABASE_SUFFIX = '_test';

/** Database name of a postgres:// URL, or undefined when the URL names none. */
function databaseName(url: URL): string | undefined {
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  return name === '' ? undefined : name;
}

function sameServer(a: URL, b: URL): boolean {
  return a.hostname === b.hostname && (a.port || '5432') === (b.port || '5432');
}

/**
 * Throws unless testUrl names a database ending in "_test" that is not the
 * application database given by appUrl (DATABASE_URL).
 * Runs before any connection is opened.
 */
export function assertDisposableTestDatabaseUrl(
  testUrl: string,
  appUrl?: string,
): void {
  let parsed: URL;
  try {
    parsed = new URL(testUrl);
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid URL');
  }

  const name = databaseName(parsed);
  if (!name || !name.endsWith(TEST_DATABASE_SUFFIX)) {
    throw new Error(
      `Refusing to run: TEST_DATABASE_URL must name a database ending in "${TEST_DATABASE_SUFFIX}" ` +
        `(got "${name ?? '(none)'}"). Its public schema is wiped by the tests.`,
    );
  }

  if (appUrl) {
    let app: URL | undefined;
    try {
      app = new URL(appUrl);
    } catch {
      app = undefined;
    }
    if (app && sameServer(parsed, app) && databaseName(app) === name) {
      throw new Error(
        'Refusing to run: TEST_DATABASE_URL points at the same database as DATABASE_URL.',
      );
    }
  }
}

/**
 * Second check once connected: the server's own current_database() must end
 * in "_test". Catches proxies or aliases that map the URL to another database.
 */
export function assertDisposableConnectedDatabase(
  currentDatabase: string,
): void {
  if (!currentDatabase.endsWith(TEST_DATABASE_SUFFIX)) {
    throw new Error(
      `Refusing to run: connected to "${currentDatabase}", which does not end in "${TEST_DATABASE_SUFFIX}".`,
    );
  }
}
