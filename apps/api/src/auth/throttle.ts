/*
 * Rules that slow down password guessing (code review of 2026-11-20, point 2).
 * Pure functions here; the database side is in throttle.service.ts.
 */

export interface ThrottlePolicy {
  /** Failures counted from the first one, for this long. */
  windowSeconds: number;
  /** Failures allowed before the first block. */
  threshold: number;
  /** First block; each further failure doubles it, up to maxBlockSeconds. */
  baseBlockSeconds: number;
  maxBlockSeconds: number;
}

export interface ThrottlePolicies {
  /** Per phone number, whether or not it has an account. */
  loginPhone: ThrottlePolicy;
  /**
   * Per address. Generous: mobile operators put many customers behind one
   * public address (carrier-grade NAT), so a low limit would block strangers.
   */
  loginIp: ThrottlePolicy;
  /** Every sign-up attempt counts, successful or not. */
  registerIp: ThrottlePolicy;
  /** Every SMS code request for a number, whether it has an account or not. */
  otpPhone: ThrottlePolicy;
  /** SMS code requests per address: each SMS costs money (SMS pumping). */
  otpIp: ThrottlePolicy;
  /** Wrong codes per address, on top of the 5 tries of each code. */
  otpFailureIp: ThrottlePolicy;
  /** Photo uploads per account: each one costs image processing. */
  mediaUser: ThrottlePolicy;
  /** Reports per address: anyone may report, without an account (ADR-017). */
  reportIp: ThrottlePolicy;
}

export const DEFAULT_THROTTLE_POLICIES: ThrottlePolicies = {
  // 5 tries, then 1, 2, 4… minutes, up to 1 hour; counted over 24 hours, so
  // about 30 guesses a day on one number at most.
  loginPhone: {
    windowSeconds: 24 * 3600,
    threshold: 5,
    baseBlockSeconds: 60,
    maxBlockSeconds: 3600,
  },
  loginIp: {
    windowSeconds: 3600,
    threshold: 30,
    baseBlockSeconds: 60,
    maxBlockSeconds: 1800,
  },
  registerIp: {
    windowSeconds: 3600,
    threshold: 10,
    baseBlockSeconds: 300,
    maxBlockSeconds: 3600,
  },
  // One code, then wait 1, 2, 4… minutes before the next, up to 1 hour.
  otpPhone: {
    windowSeconds: 24 * 3600,
    threshold: 1,
    baseBlockSeconds: 60,
    maxBlockSeconds: 3600,
  },
  otpIp: {
    windowSeconds: 3600,
    threshold: 10,
    baseBlockSeconds: 300,
    maxBlockSeconds: 3600,
  },
  otpFailureIp: {
    windowSeconds: 3600,
    threshold: 20,
    baseBlockSeconds: 300,
    maxBlockSeconds: 3600,
  },
  mediaUser: {
    windowSeconds: 3600,
    threshold: 20,
    baseBlockSeconds: 600,
    maxBlockSeconds: 3600,
  },
  // 5 reports per hour (contract §9), then a pause of 10 minutes up to 1 hour.
  reportIp: {
    windowSeconds: 3600,
    threshold: 5,
    baseBlockSeconds: 600,
    maxBlockSeconds: 3600,
  },
};

export const THROTTLE_POLICIES = Symbol('THROTTLE_POLICIES');

/** Seconds of block after this many failures, 0 below the threshold. */
export function blockSeconds(failures: number, policy: ThrottlePolicy): number {
  if (failures < policy.threshold) return 0;
  const doublings = Math.min(failures - policy.threshold, 30);
  return Math.min(
    policy.baseBlockSeconds * 2 ** doublings,
    policy.maxBlockSeconds,
  );
}

/**
 * The address a limit applies to. IPv4 as is; IPv6 by its /64 network, since
 * one subscriber usually gets a whole /64 and could rotate inside it.
 */
export function clientKey(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const address = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (!address.includes(':')) return address;

  const [head, tail = ''] = address.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups = address.includes('::')
    ? [
        ...headGroups,
        ...Array<string>(Math.max(missing, 0)).fill('0'),
        ...tailGroups,
      ]
    : headGroups;
  return `${groups
    .slice(0, 4)
    .map((group) => parseInt(group || '0', 16).toString(16))
    .join(':')}::/64`;
}

/** "Trop de tentatives…" with a rounded-up delay in minutes. */
export function tooManyAttemptsMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Trop de tentatives. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`;
}
