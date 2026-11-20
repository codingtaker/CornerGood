import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/*
 * Password hashing with Node's built-in scrypt: no native dependency to build.
 * Parameters follow the OWASP Password Storage Cheat Sheet (N=2^15, r=8, p=3,
 * about 32 MiB per hash). They are stored with each hash, so they can be raised
 * later without invalidating existing passwords.
 *
 * Stored format: scrypt$N=32768,r=8,p=3$<salt base64>$<key base64>
 */

interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

const DEFAULT_PARAMS: ScryptParams = { N: 2 ** 15, r: 8, p: 3 };
const SALT_BYTES = 16;
const KEY_BYTES = 32;

function derive(
  password: string,
  salt: Buffer,
  params: ScryptParams,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      // The same password typed on two devices can differ in Unicode form.
      password.normalize('NFKC'),
      salt,
      KEY_BYTES,
      { ...params, maxmem: 256 * params.N * params.r },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, DEFAULT_PARAMS);
  const { N, r, p } = DEFAULT_PARAMS;
  return `scrypt$N=${N},r=${r},p=${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function parseHash(
  stored: string,
): { params: ScryptParams; salt: Buffer; key: Buffer } | null {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return null;
  const match = /^N=(\d+),r=(\d+),p=(\d+)$/.exec(parts[1]);
  if (!match) return null;
  const [N, r, p] = match.slice(1).map(Number);
  // A stored hash comes from the database, so its parameters must not be able
  // to make verification hang: N=2^20, r=32, p=16 takes minutes.
  const powerOfTwo = (N & (N - 1)) === 0;
  if (
    N < 2 ||
    N > 2 ** 17 ||
    !powerOfTwo ||
    r < 1 ||
    r > 16 ||
    p < 1 ||
    p > 4
  ) {
    return null;
  }
  const salt = Buffer.from(parts[2], 'base64');
  const key = Buffer.from(parts[3], 'base64');
  if (salt.length === 0 || key.length !== KEY_BYTES) return null;
  return { params: { N, r, p }, salt, key };
}

/**
 * False for a wrong password and for a malformed stored hash. Either way it
 * takes as long as a real verification, so the answer time says nothing.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return spendVerificationTime(password);
  try {
    const candidate = await derive(password, parsed.salt, parsed.params);
    return timingSafeEqual(candidate, parsed.key);
  } catch {
    // scrypt refuses some parameter combinations: treat them as a bad hash.
    return false;
  }
}

/**
 * Does the work of verifying a password against a hash made today, then
 * answers false. Sign-in calls it when no account matches the phone: without
 * it, an unknown number would be answered at once and a known one after a
 * full scrypt, so the delay alone would reveal who has an account.
 */
export async function spendVerificationTime(password: string): Promise<false> {
  await derive(password, randomBytes(SALT_BYTES), DEFAULT_PARAMS);
  return false;
}
