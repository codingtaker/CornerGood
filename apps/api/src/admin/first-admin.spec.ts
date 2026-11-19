import { FirstAdminError, readFirstAdminInput } from './first-admin';

const validEnv = {
  ADMIN_FULL_NAME: '  Afi   Kouma ',
  ADMIN_PHONE: '+228 90 00 00 00',
  ADMIN_EMAIL: ' Afi.Kouma@Example.org ',
  ADMIN_PASSWORD: 'a long enough password',
};

describe('readFirstAdminInput', () => {
  it('normalises the name, phone and email', () => {
    expect(readFirstAdminInput(validEnv)).toEqual({
      fullName: 'Afi Kouma',
      phone: '+22890000000',
      email: 'afi.kouma@example.org',
      password: 'a long enough password',
    });
  });

  it('makes the email optional', () => {
    expect(
      readFirstAdminInput({ ...validEnv, ADMIN_EMAIL: '' }).email,
    ).toBeNull();
  });

  it('lists every problem at once, without echoing the password', () => {
    const run = () =>
      readFirstAdminInput({
        ADMIN_PHONE: '90000000',
        ADMIN_EMAIL: 'not-an-email',
        ADMIN_PASSWORD: 'tiny',
      });
    expect(run).toThrow(FirstAdminError);
    expect(run).toThrow(
      [
        'ADMIN_FULL_NAME must be 2 to 120 characters long',
        'ADMIN_PHONE must be in international format, e.g. +22890000000',
        'ADMIN_EMAIL is not a valid email address',
        'ADMIN_PASSWORD must be at least 12 characters long',
      ].join('\n'),
    );
  });

  it('refuses a password shorter than 12 characters', () => {
    expect(() =>
      readFirstAdminInput({ ...validEnv, ADMIN_PASSWORD: 'elevenchars' }),
    ).toThrow('ADMIN_PASSWORD must be at least 12 characters long');
  });

  it('never puts the password in an error message', () => {
    try {
      readFirstAdminInput({ ...validEnv, ADMIN_PASSWORD: 'tiny-secret' });
    } catch (error) {
      expect((error as Error).message).not.toContain('tiny-secret');
    }
    expect.assertions(1);
  });
});
