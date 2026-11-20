import {
  InvalidInputError,
  normalisePhone,
  readCode,
  readOtpRequest,
  readPasswordReset,
  readSignIn,
  readSignUp,
} from './account-input';
import { otpMessage } from './otp.service';
import { readCookie } from './auth.guard';

describe('normalisePhone', () => {
  it.each([
    ['90 12 34 56', '+22890123456'],
    ['90.12.34.56', '+22890123456'],
    ['90-12-34-56', '+22890123456'],
    ['0022890123456', '+22890123456'],
    ['+228 90 12 34 56', '+22890123456'],
    ['+33 6 12 34 56 78', '+33612345678'],
  ])('reads %s as %s', (raw, expected) => {
    expect(normalisePhone(raw)).toBe(expected);
  });

  it.each(['', '123', '9012345', 'abc', '+0123456789'])('refuses %s', (raw) => {
    expect(normalisePhone(raw)).toBeNull();
  });

  it('refuses a value that is not a string', () => {
    expect(normalisePhone(90123456)).toBeNull();
  });
});

describe('readSignUp', () => {
  it('normalises the fields and ignores anything else', () => {
    expect(
      readSignUp({
        fullName: '  Kossi   Mensah ',
        phone: '90 12 34 56',
        email: ' Kossi@Example.ORG ',
        password: 'mon mot de passe',
        role: 'ADMIN',
      }),
    ).toEqual({
      fullName: 'Kossi Mensah',
      phone: '+22890123456',
      email: 'kossi@example.org',
      password: 'mon mot de passe',
    });
  });

  it('reports every problem by field, in French', () => {
    try {
      readSignUp({ fullName: 'K', phone: '1', email: 'x', password: 'court' });
      throw new Error('expected a failure');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidInputError);
      expect((error as InvalidInputError).problems).toEqual({
        fullName: 'Indiquez votre nom (2 à 120 caractères).',
        phone: 'Numéro invalide. Exemple : 90 12 34 56.',
        email: 'Adresse e-mail invalide.',
        password: 'Le mot de passe doit contenir au moins 8 caractères.',
      });
    }
  });

  it('accepts a missing body as all fields missing', () => {
    expect(() => readSignUp(undefined)).toThrow(InvalidInputError);
  });
});

describe('readSignIn', () => {
  it('normalises the phone', () => {
    expect(readSignIn({ phone: '90 12 34 56', password: 'x' })).toEqual({
      phone: '+22890123456',
      password: 'x',
    });
  });

  it('returns null rather than saying what is wrong', () => {
    expect(readSignIn({ phone: 'abc', password: 'x' })).toBeNull();
    expect(readSignIn({ phone: '90123456' })).toBeNull();
    expect(readSignIn(null)).toBeNull();
  });
});

describe('SMS code input', () => {
  it('reads a 6-digit code, spaces allowed', () => {
    expect(readCode('123 456')).toBe('123456');
    expect(readCode('12345')).toBeNull();
    expect(readCode('12345a')).toBeNull();
    expect(readCode(123456)).toBeNull();
  });

  it('passes an unlock code along with the sign-in', () => {
    expect(
      readSignIn({ phone: '90123456', password: 'x', code: '123 456' }),
    ).toEqual({ phone: '+22890123456', password: 'x', code: '123456' });
  });

  it('only sends codes to Togolese numbers, for a known purpose', () => {
    expect(
      readOtpRequest({ phone: '90 12 34 56', purpose: 'PASSWORD_RESET' }),
    ).toEqual({ phone: '+22890123456', purpose: 'PASSWORD_RESET' });
    try {
      readOtpRequest({ phone: '+33612345678', purpose: 'SOMETHING' });
      throw new Error('expected a failure');
    } catch (error) {
      expect((error as InvalidInputError).problems).toEqual({
        phone: 'Les codes sont envoyés aux numéros togolais (+228) uniquement.',
        purpose: 'Demande inconnue.',
      });
    }
  });

  it('checks the code and the new password of a reset', () => {
    expect(() =>
      readPasswordReset({ phone: '90123456', code: '12', password: 'court' }),
    ).toThrow(InvalidInputError);
    expect(
      readPasswordReset({
        phone: '90123456',
        code: '123456',
        password: 'assez long',
      }),
    ).toEqual({
      phone: '+22890123456',
      code: '123456',
      password: 'assez long',
    });
  });
});

describe('otpMessage', () => {
  it('says what the code is for, how long it lasts, and not to share it', () => {
    expect(otpMessage('042517', 'LOGIN_UNLOCK')).toBe(
      'CornerGood : votre code pour débloquer votre connexion est 042517. ' +
        'Valable 10 minutes. Ne le donnez à personne.',
    );
  });
});

describe('readCookie', () => {
  it('finds one cookie among several', () => {
    expect(readCookie('a=1; cg_session=abc%2D1; b=2', 'cg_session')).toBe(
      'abc-1',
    );
  });

  it('returns null for a value that cannot be decoded, instead of throwing', () => {
    expect(readCookie('cg_session=%E0%A4%A', 'cg_session')).toBeNull();
  });

  it('returns null when absent', () => {
    expect(readCookie(undefined, 'cg_session')).toBeNull();
    expect(readCookie('cg_session_old=1', 'cg_session')).toBeNull();
  });
});
