import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "./security-headers";
import { DEFAULT_TILES_URL, tilesOrigin } from "./map-tiles";

describe("map tiles", () => {
  it("gives the CSP the host of the tiles", () => {
    expect(tilesOrigin(DEFAULT_TILES_URL)).toBe(
      "https://tile.openstreetmap.org",
    );
    const policy = contentSecurityPolicy(false);
    for (const directive of ["img-src", "connect-src"]) {
      const line = policy.split("; ").find((d) => d.startsWith(directive));
      expect(line).toContain("https://tile.openstreetmap.org");
    }
    // MapLibre runs its worker from a blob.
    expect(policy).toContain("worker-src 'self' blob:");
  });

  it.each([
    "http://tiles.example/{z}/{x}/{y}.png",
    "https://{s}.tiles.example/{z}/{x}/{y}.png",
    "not a url",
  ])("refuses %s", (url) => {
    expect(() => tilesOrigin(url)).toThrow();
  });
});
