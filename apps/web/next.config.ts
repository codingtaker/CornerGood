import type { NextConfig } from "next";
import { API_URL } from "./src/lib/api-url";
import { webSecurityHeaders } from "./src/lib/security-headers";

const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  // No "X-Powered-By: Next.js": it only helps someone looking for a known flaw.
  poweredByHeader: false,

  // The browser calls the API through the web app's own origin (/api/v1/...).
  // The session cookie is then first-party, sent with page requests too, so
  // the server can check it; and the API needs no cross-site cookie.
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${API_URL}/:path*` }];
  },

  async headers() {
    return [
      {
        // Every page; /api/v1 answers carry the API's own headers.
        source: "/((?!api/v1/).*)",
        headers: webSecurityHeaders(isDev),
      },
    ];
  },
};

export default nextConfig;
