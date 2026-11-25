/*
 * HTTP security headers of the web app (code review of 2026-11-20, medium
 * point), applied by next.config.ts to every page.
 *
 * The Content-Security-Policy is the "without nonces" variant of the Next.js
 * guide: static pages stay static and cacheable (scalability), at the price
 * of 'unsafe-inline' for scripts, which Next.js needs without nonces. What it
 * does block: being framed by another site (clickjacking), plugins, a <base>
 * hijack, forms or fetches sent anywhere but this site, and images, fonts or
 * scripts from other hosts (map tiles excepted). React escapes what it renders, which remains the
 * main defence against script injection. Moving to nonces is possible later
 * (every page then rendered on each request).
 */

import { tilesOrigin } from "./map-tiles";

export function contentSecurityPolicy(isDev: boolean): string {
  const tiles = tilesOrigin();
  return [
    "default-src 'self'",
    // 'unsafe-eval' only in development: React uses eval for its debug tools.
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${tiles}`,
    "font-src 'self'",
    // The API is reached through /api/v1 on this same origin; MapLibre fetches
    // the tiles.
    `connect-src 'self' ${tiles}`,
    "manifest-src 'self'",
    // MapLibre starts its worker from a blob.
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // No other site may show these pages in a frame (clickjacking).
    "frame-ancestors 'none'",
    // Production runs on HTTPS only; development runs on plain http.
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function webSecurityHeaders(
  isDev: boolean,
): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(isDev) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // For browsers that ignore frame-ancestors.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Position (placing a listing) and camera (its photos) on this site only.
    {
      key: "Permissions-Policy",
      value: "geolocation=(self), camera=(self), microphone=(), payment=()",
    },
    ...(isDev
      ? []
      : [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ]),
  ];
}
