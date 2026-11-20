import { hashPassword, verifyPassword } from './password-hasher';

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
});
