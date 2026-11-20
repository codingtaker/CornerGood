import {
  hashPassword,
  spendVerificationTime,
  verifyPassword,
} from './password-hasher';
import { medianMs } from '../../test/timing';

describe('password hasher', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(stored).toMatch(/^scrypt\$N=32768,r=8,p=3\$[^$]+\$[^$]+$/);
    await expect(verifyPassword('correct horse battery', stored)).resolves.toBe(
      true,
    );
    await expect(verifyPassword('correct horse batterY', stored)).resolves.toBe(
      false,
    );
  });

  it('salts every hash', async () => {
    const [first, second] = await Promise.all([
      hashPassword('same password here'),
      hashPassword('same password here'),
    ]);
    expect(first).not.toBe(second);
  });

  it('treats the composed and decomposed forms of an accent alike', async () => {
    const stored = await hashPassword('Kodjoé-2026!'); // é as one code point
    await expect(verifyPassword('Kodjoé-2026!', stored)).resolves.toBe(true);
  });

  it.each([
    'not-a-real-hash',
    'scrypt$N=32768,r=8,p=3$c2FsdA==',
    'scrypt$N=1048577,r=8,p=3$c2FsdA==$AAAA',
    // Valid-looking but too costly, or rejected by scrypt itself.
    `scrypt$N=1048576,r=32,p=16$c2FsdA==$${'A'.repeat(43)}=`,
    `scrypt$N=262144,r=8,p=1$c2FsdA==$${'A'.repeat(43)}=`,
    `scrypt$N=32768,r=0,p=3$c2FsdA==$${'A'.repeat(43)}=`,
    `scrypt$N=32768,r=8,p=0$c2FsdA==$${'A'.repeat(43)}=`,
    'bcrypt$N=32768,r=8,p=3$c2FsdA==$AAAA',
  ])('returns false for the malformed hash %s', async (stored) => {
    await expect(verifyPassword('whatever', stored)).resolves.toBe(false);
  });

  /*
   * Timing: a dummy or malformed check must cost about as much as a real one.
   * Without the dummy work it would take well under 1% of the time, so a loose
   * bound (at least half) is safe against machine noise.
   */
  describe('response time', () => {
    let stored: string;
    let realMs: number;

    beforeAll(async () => {
      stored = await hashPassword('the real password');
      realMs = await medianMs(() => verifyPassword('a wrong password', stored));
    });

    it('spends as long without an account as with one', async () => {
      await expect(spendVerificationTime('anything')).resolves.toBe(false);
      const dummyMs = await medianMs(() => spendVerificationTime('anything'));
      expect(dummyMs).toBeGreaterThan(realMs / 2);
    });

    it('spends as long on a malformed stored hash as on a real one', async () => {
      const malformedMs = await medianMs(() =>
        verifyPassword('a wrong password', 'not-a-real-hash'),
      );
      expect(malformedMs).toBeGreaterThan(realMs / 2);
    });
  });
});
