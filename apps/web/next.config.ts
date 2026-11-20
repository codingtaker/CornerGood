import type { NextConfig } from "next";
import { API_URL } from "./src/lib/api-url";

const nextConfig: NextConfig = {
  // The browser calls the API through the web app's own origin (/api/v1/...).
  // The session cookie is then first-party, sent with page requests too, so
  // the server can check it; and the API needs no cross-site cookie.
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${API_URL}/:path*` }];
  },
};

export default nextConfig;
