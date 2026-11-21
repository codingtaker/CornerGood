// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

const request = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : {},
  });

describe("proxy", () => {
  it("sends a visitor without a session to the sign-in page, keeping where they were going", () => {
    const response = proxy(request("/admin?onglet=fiches"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") as string);
    expect(location.pathname).toBe("/connexion");
    expect(location.searchParams.get("suivant")).toBe("/admin?onglet=fiches");
  });

  it("lets a visitor with a session cookie through: the page and the API check it", () => {
    const response = proxy(request("/pro", "cg_session=abc"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("only guards /pro and /admin", () => {
    expect(config.matcher).toEqual(["/pro/:path*", "/admin/:path*"]);
  });
});
