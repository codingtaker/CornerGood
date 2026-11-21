import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next";

describe("safeNextPath", () => {
  it.each(["/pro", "/admin?onglet=fiches", "/pro/compte"])(
    "keeps a path of this site: %s",
    (path) => {
      expect(safeNextPath(path)).toBe(path);
    },
  );

  it.each([
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "pro",
    "",
    undefined,
    ["/pro", "/admin"],
  ])("falls back to /pro for %j, which could leave the site", (value) => {
    expect(safeNextPath(value)).toBe("/pro");
  });
});
