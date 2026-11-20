import { validateEnvironment } from './env.validation';

describe('validateEnvironment', () => {
  const validEnvironment = {
    DATABASE_URL: 'postgres://user:secret@localhost:5432/cornergood',
    API_PORT: '3001',
    WEB_ORIGIN: 'http://localhost:3000',
  };

  it('returns typed values for a valid environment', () => {
    expect(validateEnvironment(validEnvironment)).toEqual({
      DATABASE_URL: 'postgres://user:secret@localhost:5432/cornergood',
      API_PORT: 3001,
      WEB_ORIGIN: 'http://localhost:3000',
      NODE_ENV: 'development',
    });
  });

  it('keeps NODE_ENV, which makes the session cookie Secure in production', () => {
    expect(
      validateEnvironment({ ...validEnvironment, NODE_ENV: 'production' })
        .NODE_ENV,
    ).toBe('production');
  });

  it('lists every problem at once', () => {
    expect(() =>
      validateEnvironment({ DATABASE_URL: 'mysql://x', API_PORT: 'abc' }),
    ).toThrow(
      /DATABASE_URL must start with postgres[\s\S]*WEB_ORIGIN is required[\s\S]*API_PORT must be an integer/,
    );
  });
});
