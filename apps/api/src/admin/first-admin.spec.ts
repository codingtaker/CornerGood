import {
  checkTypedPassword,
  FirstAdminError,
  readFirstAdminIdentity,
} from './first-admin';

const validEnv = {
  ADMIN_FULL_NAME: '  Afi   Kouma ',
  ADMIN_PHONE: '+228 90 00 00 00',
  ADMIN_EMAIL: ' Afi.Kouma@Example.org ',
};

describe('readFirstAdminIdentity', () => {
  it('normalises the name, phone and email', () => {
    expect(readFirstAdminIdentity(validEnv)).toEqual({
      fullName: 'Afi Kouma',
      phone: '+22890000000',
      email: 'afi.kouma@example.org',
    });
  });

  it('makes the email optional', () => {
    expect(
      readFirstAdminIdentity({ ...validEnv, ADMIN_EMAIL: '' }).email,
    ).toBeNull();
  });

  it('lists every problem at once', () => {
    const run = () =>
      readFirstAdminIdentity({
        ADMIN_PHONE: '90000000',
        ADMIN_EMAIL: 'not-an-email',
      });
    expect(run).toThrow(FirstAdminError);
    expect(run).toThrow(
      [
        'ADMIN_FULL_NAME must be 2 to 120 characters long',
        'ADMIN_PHONE must be in international format, e.g. +22890000000',
        'ADMIN_EMAIL is not a valid email address',
      ].join('\n'),
    );
  });

  // ADR-047: the password is typed at the keyboard, never read from a variable.
  it('refuses to run while ADMIN_PASSWORD is set, without echoing it', () => {
    const run = () =>
      readFirstAdminIdentity({
        ...validEnv,
        ADMIN_PASSWORD: 'left-in-env-file',
      });
    expect(run).toThrow(
      'Remove ADMIN_PASSWORD from .env and from your shell: the password is typed at the prompt',
    );
    expect(run).not.toThrow('left-in-env-file');
  });
});

describe('checkTypedPassword', () => {
  it('accepts a long enough password typed twice', () => {
    expect(() =>
      checkTypedPassword('a long enough password', 'a long enough password'),
    ).not.toThrow();
  });

  it('refuses a password shorter than 12 characters', () => {
    expect(() => checkTypedPassword('elevenchars', 'elevenchars')).toThrow(
      'The password must be at least 12 characters long.',
    );
  });

  it('refuses two different passwords, without echoing them', () => {
    const run = () =>
      checkTypedPassword('a long enough password', 'a long enough passw0rd');
    expect(run).toThrow('The two passwords do not match.');
    expect(run).not.toThrow('long enough');
  });
});
