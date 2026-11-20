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
  return { phone, password };
}

function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null
    ? (body as Record<string, unknown>)
    : {};
}
