import type { Request, Response } from 'express';
import {
  API_SECURITY_HEADERS,
  HSTS,
  securityHeaders,
} from './security-headers';

function headersFor(nodeEnv: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const response = {
    setHeader: (name: string, value: string) => (headers[name] = value),
  };
  const next = jest.fn();
  securityHeaders(nodeEnv)(
    {} as Request,
    response as unknown as Response,
    next,
  );
  expect(next).toHaveBeenCalled();
  return headers;
}

describe('securityHeaders', () => {
  it('forbids sniffing, framing and loading anything', () => {
    expect(headersFor('development')).toEqual(API_SECURITY_HEADERS);
    expect(API_SECURITY_HEADERS).toMatchObject({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    });
  });

  it('asks for HTTPS only in production', () => {
    expect(headersFor('development')['Strict-Transport-Security']).toBe(
      undefined,
    );
    expect(headersFor('production')['Strict-Transport-Security']).toBe(HSTS);
  });
});
