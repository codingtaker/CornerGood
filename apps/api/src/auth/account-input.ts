/*
 * Validation of what a person types to create an account or sign in.
 * Messages are product text, so they are in French.
 */

/** Minimum for professionals. Administrators need 12 (ADR-047). */
export const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 256;
// Same rule as the CHECK constraint on users.phone (E.164).
const E164 = /^\+[1-9][0-9]{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class InvalidInputError extends Error {
  constructor(readonly problems: Record<string, string>) {
    super('Invalid input');
  }
}

/**
 * Accepts the ways a Togolese number is usually written: "90 12 34 56",
 * "90.12.34.56", "0022890123456", "+228 90 12 34 56". Eight digits are a
 * Togolese number. Returns null when the result is not a valid E.164 number.
 */
export function normalisePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let phone = raw.replace(/[\s.()-]/g, '');
  if (phone.startsWith('00')) phone = `+${phone.slice(2)}`;
  if (/^[0-9]{8}$/.test(phone)) phone = `+228${phone}`;
  return E164.test(phone) ? phone : null;
}

export interface SignUpInput {
  fullName: string;
  phone: string;
  email: string | null;
  password: string;
}

export function readSignUp(body: unknown): SignUpInput {
  const raw = asRecord(body);
  const problems: Record<string, string> = {};

  const fullName =
    typeof raw.fullName === 'string'
      ? raw.fullName.trim().replace(/\s+/g, ' ')
      : '';
  if (fullName.length < 2 || fullName.length > 120) {
    problems.fullName = 'Indiquez votre nom (2 à 120 caractères).';
  }

  const phone = normalisePhone(raw.phone);
  if (!phone) {
    problems.phone = 'Numéro invalide. Exemple : 90 12 34 56.';
  }

  const email =
    typeof raw.email === 'string' && raw.email.trim() !== ''
      ? raw.email.trim().toLowerCase()
      : null;
  if (email !== null && (!EMAIL.test(email) || email.length > 254)) {
    problems.email = 'Adresse e-mail invalide.';
  }

  const password = typeof raw.password === 'string' ? raw.password : '';
  if (password.length < MIN_PASSWORD_LENGTH) {
    problems.password = `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`;
  } else if (password.length > MAX_PASSWORD_LENGTH) {
    problems.password = `Le mot de passe doit contenir au plus ${MAX_PASSWORD_LENGTH} caractères.`;
  }

  if (Object.keys(problems).length > 0) throw new InvalidInputError(problems);
  return { fullName, phone: phone as string, email, password };
}

export interface SignInInput {
  phone: string;
  password: string;
  /** SMS code that lifts a block on this number (LOGIN_UNLOCK). */
  code?: string;
}

const OTP_CODE = /^[0-9]{6}$/;

/** A 6-digit code, spaces allowed ("123 456"); null otherwise. */
export function readCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.replace(/\s/g, '');
  return OTP_CODE.test(code) ? code : null;
}

const OTP_PURPOSES = ['LOGIN_UNLOCK', 'PASSWORD_RESET'] as const;
export type OtpRequestPurpose = (typeof OTP_PURPOSES)[number];

/** Codes are only sent to Togolese numbers: SMS abroad cost more and invite fraud. */
export function readOtpRequest(body: unknown): {
  phone: string;
  purpose: OtpRequestPurpose;
} {
  const raw = asRecord(body);
  const problems: Record<string, string> = {};
  const phone = normalisePhone(raw.phone);
  if (!phone) {
    problems.phone = 'Numéro invalide. Exemple : 90 12 34 56.';
  } else if (!phone.startsWith('+228')) {
    problems.phone =
      'Les codes sont envoyés aux numéros togolais (+228) uniquement.';
  }
  const purpose = OTP_PURPOSES.find((value) => value === raw.purpose);
  if (!purpose) problems.purpose = 'Demande inconnue.';
  if (Object.keys(problems).length > 0) throw new InvalidInputError(problems);
  return { phone: phone as string, purpose: purpose as OtpRequestPurpose };
}

export interface PasswordResetInput {
  phone: string;
  code: string;
  password: string;
}

export function readPasswordReset(body: unknown): PasswordResetInput {
  const raw = asRecord(body);
  const problems: Record<string, string> = {};
  const phone = normalisePhone(raw.phone);
  if (!phone) problems.phone = 'Numéro invalide. Exemple : 90 12 34 56.';
  const code = readCode(raw.code);
  if (!code) problems.code = 'Le code reçu par SMS compte 6 chiffres.';
  const password = typeof raw.password === 'string' ? raw.password : '';
  if (password.length < MIN_PASSWORD_LENGTH) {
    problems.password = `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`;
  } else if (password.length > MAX_PASSWORD_LENGTH) {
    problems.password = `Le mot de passe doit contenir au plus ${MAX_PASSWORD_LENGTH} caractères.`;
  }
  if (Object.keys(problems).length > 0) throw new InvalidInputError(problems);
  return { phone: phone as string, code: code as string, password };
}

/**
 * Sign-in input. A malformed phone is not reported as such: the caller answers
 * every failure with the same message, so the form says nothing about accounts.
 */
export function readSignIn(body: unknown): SignInInput | null {
  const raw = asRecord(body);
  const phone = normalisePhone(raw.phone);
  const password = typeof raw.password === 'string' ? raw.password : '';
  if (!phone || password === '' || password.length > MAX_PASSWORD_LENGTH) {
    return null;
  }
  const code = readCode(raw.code);
  return code ? { phone, password, code } : { phone, password };
}

function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null
    ? (body as Record<string, unknown>)
    : {};
}
