export interface AppEnvironment {
  DATABASE_URL: string;
  API_PORT: number;
  WEB_ORIGIN: string;
  /** "production" makes the session cookie Secure (HTTPS only). */
  NODE_ENV: string;
  /**
   * Proxies allowed to tell the client's address (X-Forwarded-For), as Express
   * "trust proxy" accepts it: "loopback" (the default, the web app on the same
   * machine), addresses or subnets, or a number of hops. Never "true": anyone
   * could then forge their address and escape the sign-in limits.
   */
  TRUST_PROXY: string | number;
}

/**
 * Fails fast at startup when a required variable is missing or malformed,
 * instead of failing later on the first request that needs it.
 */
export function validateEnvironment(
  rawEnvironment: Record<string, unknown>,
): AppEnvironment {
  const errors: string[] = [];

  const databaseUrl = readString(rawEnvironment, 'DATABASE_URL', errors);
  if (databaseUrl && !/^postgres(ql)?:\/\//.test(databaseUrl)) {
    errors.push('DATABASE_URL must start with postgres:// or postgresql://');
  }

  const webOrigin = readString(rawEnvironment, 'WEB_ORIGIN', errors);

  const apiPort = Number(rawEnvironment.API_PORT ?? 3001);
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) {
    errors.push('API_PORT must be an integer between 1 and 65535');
  }

  const rawTrustProxy =
    typeof rawEnvironment.TRUST_PROXY === 'string' &&
    rawEnvironment.TRUST_PROXY.trim() !== ''
      ? rawEnvironment.TRUST_PROXY.trim()
      : 'loopback';
  if (/^(true|\*)$/i.test(rawTrustProxy)) {
    errors.push(
      'TRUST_PROXY must name the proxies (e.g. loopback, 10.0.0.0/8) or a hop count, not "true"',
    );
  }
  const trustProxy = /^\d+$/.test(rawTrustProxy)
    ? Number(rawTrustProxy)
    : rawTrustProxy;

  if (errors.length > 0) {
    throw new Error(`Invalid environment:\n- ${errors.join('\n- ')}`);
  }

  return {
    DATABASE_URL: databaseUrl,
    API_PORT: apiPort,
    WEB_ORIGIN: webOrigin,
    NODE_ENV:
      typeof rawEnvironment.NODE_ENV === 'string'
        ? rawEnvironment.NODE_ENV
        : 'development',
    TRUST_PROXY: trustProxy,
  };
}

function readString(
  rawEnvironment: Record<string, unknown>,
  key: string,
  errors: string[],
): string {
  const value = rawEnvironment[key];
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${key} is required`);
    return '';
  }
  return value.trim();
}
