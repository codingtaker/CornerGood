import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, webSecurityHeaders } from "./security-headers";

const header = (isDev: boolean, key: string) =>
  webSecurityHeaders(isDev).find((entry) => entry.key === key)?.value;

describe("web security headers", () => {
  it("forbids being framed by another site (clickjacking)", () => {
    expect(contentSecurityPolicy(false)).toContain("frame-ancestors 'none'");
    expect(header(false, "X-Frame-Options")).toBe("DENY");
  });

  it("keeps fetches, forms and plugins on this site", () => {
    const policy = contentSecurityPolicy(false);
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("object-src 'none'");
  });

  it("allows eval only in development", () => {
    expect(contentSecurityPolicy(true)).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy(false)).not.toContain("'unsafe-eval'");
  });

  it("forces HTTPS in production only", () => {
    expect(header(false, "Strict-Transport-Security")).toContain("max-age=");
    expect(header(true, "Strict-Transport-Security")).toBeUndefined();
    expect(contentSecurityPolicy(false)).toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy(true)).not.toContain(
      "upgrade-insecure-requests",
    );
  });
});
