import { readAppCredentials } from './app-role';

describe('readAppCredentials', () => {
  it('reads the role and password of DATABASE_URL', () => {
    expect(
      readAppCredentials(
        'postgres://cornergood_app:a%40long%2Fpassword-123@localhost:5433/cornergood',
      ),
    ).toEqual({ user: 'cornergood_app', password: 'a@long/password-123' });
  });

  it('refuses a DATABASE_URL that still connects as the owner', () => {
    expect(() =>
      readAppCredentials(
        'postgres://cornergood:a-long-enough-password@localhost:5432/cornergood',
      ),
    ).toThrow(
      'DATABASE_URL must connect as cornergood_app (found "cornergood")',
    );
  });

  it('refuses a short password', () => {
    expect(() =>
      readAppCredentials(
        'postgres://cornergood_app:short@localhost/cornergood',
      ),
    ).toThrow('must be at least 16 characters long');
  });
});
