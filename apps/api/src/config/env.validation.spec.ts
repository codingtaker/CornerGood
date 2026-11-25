import { validateEnvironment } from './env.validation';

describe('validateEnvironment', () => {
  const validEnvironment = {
    DATABASE_URL: 'postgres://user:secret@localhost:5432/cornergood',
    API_PORT: '3001',
    WEB_ORIGIN: 'http://localhost:3000',
    OTP_SECRET: 'a-secret-of-at-least-32-characters!',
  };

  it('returns typed values for a valid environment', () => {
    expect(validateEnvironment(validEnvironment)).toEqual({
      DATABASE_URL: 'postgres://user:secret@localhost:5432/cornergood',
      API_PORT: 3001,
      WEB_ORIGIN: 'http://localhost:3000',
      NODE_ENV: 'development',
      TRUST_PROXY: 'loopback',
      OTP_SECRET: 'a-secret-of-at-least-32-characters!',
      SMS_PROVIDER: 'console',
      MEDIA_DIR: '../../var/media',
    });
  });

  it('requires an OTP_SECRET of 32 characters or more', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, OTP_SECRET: 'short' }),
    ).toThrow('OTP_SECRET must be at least 32 characters long');
  });

  it('refuses the console SMS provider in production, which logs the codes', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, NODE_ENV: 'production' }),
    ).toThrow('SMS_PROVIDER=console writes one-time codes in the logs');
  });

  it('reads TRUST_PROXY as a hop count or a list of proxies', () => {
    expect(
      validateEnvironment({ ...validEnvironment, TRUST_PROXY: '1' })
        .TRUST_PROXY,
    ).toBe(1);
    expect(
      validateEnvironment({
        ...validEnvironment,
        TRUST_PROXY: 'loopback, 10.0.0.0/8',
      }).TRUST_PROXY,
    ).toBe('loopback, 10.0.0.0/8');
  });

  it('refuses TRUST_PROXY=true, which lets anyone forge their address', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, TRUST_PROXY: 'true' }),
    ).toThrow('TRUST_PROXY must name the proxies');
  });

  it('keeps NODE_ENV, which makes the session cookie Secure in production', () => {
    expect(
      validateEnvironment({ ...validEnvironment, NODE_ENV: 'test' }).NODE_ENV,
    ).toBe('test');
  });

  it('lists every problem at once', () => {
    expect(() =>
      validateEnvironment({ DATABASE_URL: 'mysql://x', API_PORT: 'abc' }),
    ).toThrow(
      /DATABASE_URL must start with postgres[\s\S]*WEB_ORIGIN is required[\s\S]*API_PORT must be an integer/,
    );
  });
});
