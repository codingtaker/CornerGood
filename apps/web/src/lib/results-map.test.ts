import { describe, expect, it } from "vitest";
import { bboxParam, mapQuery, mapStatus, toFeatures } from "./results-map";
import type { SearchResult } from "./search";

const bounds = { west: 1.201234, south: 6.12, east: 1.25, north: 6.150049 };

function result(overrides: Partial<SearchResult>): SearchResult {
  return {
    slug: "atelier",
    name: "Atelier",
    entityType: "BUSINESS",
    category: { slug: "reparation", name: "Réparation" },
    matchedServices: [],
    commune: { slug: "golfe-1", name: "Golfe 1" },
    locationType: "FIXED",
    position: { lat: 6.13, lng: 1.22 },
    distanceMeters: null,
    coverPhotoUrl: null,
    verificationStatus: "UNVERIFIED",
    ...overrides,
  };
}

describe("results map", () => {
  it("writes the visible area rounded to about 11 m", () => {
    expect(bboxParam(bounds)).toBe("1.2012,6.12,1.25,6.15");
    expect(bboxParam({ west: -200, south: -95, east: 200, north: 95 })).toBe(
      "-180,-90,180,90",
    );
  });

  it("keeps the criteria but not the position nor the page", () => {
    expect(
      mapQuery(
        { q: "écran", category: "reparation", lat: 6.1, lng: 1.2, page: 3 },
        bounds,
      ),
    ).toBe(
      "q=%C3%A9cran&category=reparation&bbox=1.2012%2C6.12%2C1.25%2C6.15&limit=50",
    );
    expect(mapQuery({}, bounds)).toBe(
      "bbox=1.2012%2C6.12%2C1.25%2C6.15&limit=50",
    );
  });

  it("draws a point for a place, a sector for a home, nothing if mobile", () => {
    const { points, sectors } = toFeatures([
      result({ slug: "fixe" }),
      result({ slug: "domicile", locationType: "HOME_BASED" }),
      result({ slug: "mobile", locationType: "MOBILE", position: null }),
    ]);
    expect(points.features).toEqual([
      {
        type: "Feature",
        properties: { slug: "fixe" },
        geometry: { type: "Point", coordinates: [1.22, 6.13] },
      },
    ]);
    expect(sectors.features).toHaveLength(1);
    expect(sectors.features[0].properties).toEqual({ slug: "domicile" });
    expect(sectors.features[0].geometry.type).toBe("Polygon");
  });

  it("says how much of the area is shown", () => {
    const page = (count: number, total: number) => ({
      data: Array.from({ length: count }, () => result({})),
      meta: { page: 1, limit: 50, total },
    });
    expect(mapStatus(page(0, 0))).toContain("Aucune activité");
    expect(mapStatus(page(3, 3))).toBe("3 résultats dans cette zone.");
    expect(mapStatus(page(50, 120))).toBe(
      "Les 50 premières sur 120 : zoomez pour voir les autres.",
    );
  });
});
