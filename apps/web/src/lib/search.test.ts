import { describe, expect, it } from "vitest";
import {
  countLabel,
  formatDistance,
  hasCriterion,
  readCriteria,
  roundCoordinate,
  searchHref,
} from "./search";

describe("search criteria", () => {
  it("reads the address bar and ignores the rest", () => {
    const params = new URLSearchParams(
      "q=+couture+&category=artisanat&entityType=PERSON&lat=6.13&lng=&page=2&publicationStatus=DRAFT",
    );
    expect(readCriteria(params)).toEqual({
      q: "couture",
      category: "artisanat",
      page: 2,
    });
  });

  it("keeps a position only with both coordinates", () => {
    expect(readCriteria(new URLSearchParams("lat=6.131&lng=1.222"))).toEqual({
      lat: 6.131,
      lng: 1.222,
    });
  });

  it("rounds the position to about 110 m in the address", () => {
    expect(roundCoordinate(6.131234)).toBe(6.131);
    expect(searchHref({ q: "plombier", lat: 6.131234, lng: 1.222876 })).toBe(
      "/recherche?q=plombier&lat=6.131&lng=1.223",
    );
  });

  it("leaves out the first page and empty values", () => {
    expect(searchHref({ category: "reparation", page: 1 })).toBe(
      "/recherche?category=reparation",
    );
    expect(searchHref({})).toBe("/recherche");
  });

  it("knows when the API will refuse a search", () => {
    expect(hasCriterion({})).toBe(false);
    expect(hasCriterion({ q: "a" })).toBe(false);
    expect(hasCriterion({ q: "ab" })).toBe(true);
    expect(hasCriterion({ lat: 6.1, lng: 1.2 })).toBe(true);
  });
});

describe("labels", () => {
  it("writes distances the French way", () => {
    expect(formatDistance(3)).toBe("10 m");
    expect(formatDistance(644)).toBe("640 m");
    expect(formatDistance(1234)).toBe("1,2 km");
    expect(formatDistance(12345)).toBe("12 km");
  });

  it("counts results", () => {
    expect(countLabel(0)).toBe("0 résultat");
    expect(countLabel(1)).toBe("1 résultat");
    expect(countLabel(37)).toBe("37 résultats");
  });
});
