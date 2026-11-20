export interface AppEnvironment {
  DATABASE_URL: string;
  API_PORT: number;
  WEB_ORIGIN: string;
  /** "production" makes the session cookie Secure (HTTPS only). */
  NODE_ENV: string;
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
