/**
 * Address of the API as the web server sees it (never sent to browsers, which
 * go through the /api/v1 rewrite). Set API_URL in .env.local or the host.
 */
export const API_URL = (
  process.env.API_URL ?? "http://localhost:3001/api/v1"
).replace(/\/$/, "");
