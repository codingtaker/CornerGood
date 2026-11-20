import type { NextFunction, Request, Response } from 'express';

/*
 * HTTP security headers of the API (code review of 2026-11-20, medium point).
 * The API only answers JSON, so it allows nothing to be loaded or framed.
 * Written by hand rather than with helmet: a short, fixed list, tested below.
 */

export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  // The browser must not guess another type than the declared JSON.
  'X-Content-Type-Options': 'nosniff',
  // A JSON answer is never a page: nothing to run, load or frame.
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-site',
  // Answers about accounts must not be kept by a shared cache or a proxy.
  'Cache-Control': 'no-store',
};

/** HTTPS only, for a year. Sent in production only: development runs on http. */
export const HSTS = 'max-age=31536000; includeSubDomains';

export function securityHeaders(nodeEnv: string) {
  return (_request: Request, response: Response, next: NextFunction): void => {
    for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
      response.setHeader(name, value);
    }
    if (nodeEnv === 'production') {
      response.setHeader('Strict-Transport-Security', HSTS);
    }
    next();
  };
}
