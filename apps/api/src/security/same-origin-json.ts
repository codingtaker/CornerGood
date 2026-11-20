import type { NextFunction, Request, Response } from 'express';

/*
 * Protection against cross-site requests (code review of 2026-11-20, point 3).
 * Without it, a page on another site could post an ordinary HTML form to
 * /auth/login and sign the visitor into the attacker's account (login CSRF),
 * or make them act without knowing it.
 *
 * On every request that changes something:
 * 1. A body must be JSON. An HTML form can only send urlencoded, multipart or
 *    text/plain, and a cross-site fetch with JSON needs a CORS preflight that
 *    only WEB_ORIGIN passes.
 * 2. A browser request must come from the web app: refused when its Origin is
 *    another site, or when Sec-Fetch-Site says "cross-site". Requests without
 *    these headers do not come from a browser (curl, server to server), so no
 *    visitor's cookies can be abused through them.
 *
 * Reads (GET, HEAD, OPTIONS) change nothing and are left alone.
 */

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function hasBody(request: Request): boolean {
  const length = request.headers['content-length'];
  return (
    request.headers['transfer-encoding'] !== undefined ||
    (length !== undefined && length !== '0')
  );
}

export function isJson(contentType: string | undefined): boolean {
  const mediaType = (contentType ?? '').split(';')[0].trim().toLowerCase();
  return mediaType === 'application/json';
}

export function sameOriginJson(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins.map((origin) => origin.toLowerCase()));

  return (request: Request, response: Response, next: NextFunction): void => {
    if (!UNSAFE_METHODS.has(request.method)) return next();

    const origin = request.headers.origin;
    const site = request.headers['sec-fetch-site'];
    if (
      (origin !== undefined && !allowed.has(origin.toLowerCase())) ||
      site === 'cross-site'
    ) {
      response.status(403).json({
        message: 'Requête refusée : elle ne vient pas de CornerGood.',
      });
      return;
    }

    if (hasBody(request) && !isJson(request.headers['content-type'])) {
      response.status(415).json({
        message: 'Le corps de la requête doit être du JSON.',
      });
      return;
    }
    next();
  };
}
