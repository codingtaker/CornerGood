import {
  blockSeconds,
  clientKey,
  DEFAULT_THROTTLE_POLICIES,
  tooManyAttemptsMessage,
} from './throttle';

describe('blockSeconds', () => {
  const { loginPhone } = DEFAULT_THROTTLE_POLICIES;

  it('lets the first failures through', () => {
    expect([1, 2, 3, 4].map((n) => blockSeconds(n, loginPhone))).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it('then blocks 1, 2, 4… minutes, up to one hour', () => {
    expect(
      [5, 6, 7, 8, 9, 10, 11, 50].map((n) => blockSeconds(n, loginPhone)),
    ).toEqual([60, 120, 240, 480, 960, 1920, 3600, 3600]);
  });
});

describe('clientKey', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['2001:db8:85a3:12:8a2e:370:7334:1', '2001:db8:85a3:12::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['2001:DB8:0:0:ffff::2', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    [undefined, 'unknown'],
  ])('keys %s as %s', (ip, expected) => {
    expect(clientKey(ip)).toBe(expected);
  });

  it('puts two addresses of the same IPv6 /64 under one key', () => {
    expect(clientKey('2001:db8:1:2::a')).toBe(clientKey('2001:db8:1:2:ff::b'));
  });
});

describe('tooManyAttemptsMessage', () => {
  it('rounds up to whole minutes, in French', () => {
    expect(tooManyAttemptsMessage(30)).toBe(
      'Trop de tentatives. Réessayez dans 1 minute.',
    );
    expect(tooManyAttemptsMessage(61)).toBe(
      'Trop de tentatives. Réessayez dans 2 minutes.',
    );
  });
});
